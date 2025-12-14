const CFG = {
    TILE_SIZE: 16,
    SCALE: 2,
    ANIM_SPEED: 200,
    IDLE_TIME: 3000
};
const DSZ = CFG.TILE_SIZE * CFG.SCALE;

const TILE = {
    EMPTY: 18, STAR: 19, TRACE: 20, START: 21,
    BTN_OFF: 22, BTN_ON: 23,
    TRAP_OFF: 30, TRAP_ON: 31,
    KEY_S: 32, LOCK_S: 33, KEY_G: 34, LOCK_G: 35, KEY_C: 36, LOCK_C: 37,
    ICE: 38, FINISH: 44,
    ICE_BLOCK: 59,
    ICE_M1: 60, ICE_M2: 61, ICE_M3: 62, ICE_MELTED: 63,

    IS_SOLID: (id) => (id <= 17) || (id === 59) || (id >= 60 && id <= 62),

    IS_LASER_BLOCKER: (id) => {
        if (id >= 59 && id <= 62) return true;
        return false;
    },
    IS_ROT_WALL: (id) => id >= 24 && id <= 27,

    ROT_START: 24, ROT_END: 27, WALL_H: 28, WALL_V: 29,
    IS_MIRROR: (id) => id >= 45 && id <= 48,
    MIR_START: 45, MIR_END: 48,
    IS_LASER: (id) => id >= 49 && id <= 52
};

const DIR = { LEFT: 0, UP: 1, RIGHT: 2, DOWN: 3 };
const VEC = [[-1, 0], [0, -1], [1, 0], [0, 1]];


const ROT_EXIT_MASK = {
    24: [false, false, true, true],
    25: [true, false, false, true],
    26: [true, true, false, false],
    27: [false, true, true, false],
    28: [true, false, true, false],
    29: [false, true, false, true]
};
const ROT_ENTER_MASK = {
    24: [true, true, false, false],
    25: [false, true, true, false],
    26: [false, false, true, true],
    27: [true, false, false, true],
    28: [true, false, true, false],
    29: [false, true, false, true]
};
const MIRROR_REF = {
    45: [3, 2, null, null],
    46: [null, 0, 3, null],
    47: [null, null, 1, 0],
    48: [1, null, null, 2]
};

const SaveManager = {
    KEY: 'bobby2_save_v3',
    data: {},
    init: function () {
        const str = localStorage.getItem(this.KEY);
        if (str) {
            try { this.data = JSON.parse(str); }
            catch (e) { this.data = {}; }
        }
    },
    submit: function (lvl, time, steps, history) {
        const old = this.data[lvl];
        let isBest = false;
        if (!old) isBest = true;
        else if (steps < old.steps) isBest = true;
        else if (steps === old.steps && time < old.time) isBest = true;

        if (isBest) {
            this.data[lvl] = {
                passed: true, time, steps, history, date: Date.now()
            };
            localStorage.setItem(this.KEY, JSON.stringify(this.data));
        }
    },
    get: function (lvl) { return this.data[lvl]; }
};
SaveManager.init();

const Assets = {
    imgs: {},
    sources: {
        tiles: 'src/tilemap.png',
        idle: 'src/BobbyCarrot.png',
        idle_anim: 'src/bobby_idle.png',
        move_l: 'src/bobby_left.png',
        move_r: 'src/bobby_right.png',
        move_u: 'src/bobby_up.png',
        move_d: 'src/bobby_down.png',
        death: 'src/bobby_death.png',
        win: 'src/bobby_fade.png',
        finish: 'src/tile_finish.png',
        flake: 'src/flake.png'
    },
    load: async function () {
        const tasks = Object.keys(this.sources).map(k => new Promise(resolve => {
            const img = new Image();
            img.src = this.sources[k];
            img.onload = () => { this.imgs[k] = img; resolve(); };
            img.onerror = () => { console.warn("Miss:", k); resolve(); };
        }));
        await Promise.all(tasks);
    }
};

const SnowSystem = {
    flakes: [], count: 40,
    init: function () {
        this.flakes = [];
        const w = window.innerWidth;
        for (let i = 0; i < this.count; i++) {
            this.flakes.push({
                x: Math.random() * 800,
                y: Math.random() * 600,
                speed: 0.5 + Math.random() * 1.5,
                drift: Math.random() * Math.PI * 2
            });
        }
    },
    update: function (dt) {
        const h = 600; const w = 800;
        this.flakes.forEach(f => {
            f.y += f.speed * (dt / 16);
            f.x += Math.sin(Date.now() / 500 + f.drift) * 0.5;
            if (f.y > h) { f.y = -10; f.x = Math.random() * w; }
        });
    },
    draw: function (ctx) {
        const img = Assets.imgs.flake;
        if (!img) return;
        ctx.globalAlpha = 0.6;
        this.flakes.forEach(f => ctx.drawImage(img, f.x, f.y));
        ctx.globalAlpha = 1.0;
    }
};

const Game = {
    canvas: null,
    context: null,
    frameTick: 0,
    state: {
        currentLevel: 1,
        mapData: [],
        width: 16,
        height: 16,

        bobby: {
            gridX: 0,
            gridY: 0,
            direction: 3
        },

        animation: {
            isActive: false,
            type: 'IDLE',
            timer: 0,
            pixelStartX: 0, pixelStartY: 0,
            pixelTargetX: 0, pixelTargetY: 0
        },

        starsCollected: 0,
        starsTotal: 0,
        keys: { silver: 0, gold: 0, copper: 0 },

        laserPath: null,

        actionQueue: [],
        replayDataString: "",
        replayStack: [],
        inputHistory: "",

        lastInputTime: 0,
        stepCount: 0,
        gameTime: 0,
        isPaused: false,
        timeScale: 1,
        gameMode: 'PLAY'
    },

    inputKeys: { up: false, down: false, left: false, right: false },

    exportSave: function () {
        const dataStr = localStorage.getItem(SaveManager.KEY);
        if (!dataStr) {
            alert("暂无存档记录！");
            return;
        }

        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        const date = new Date().toISOString().slice(0, 10);
        a.download = `bobby2_save_${date}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    importSave: function (inputElement) {
        const file = inputElement.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const jsonStr = e.target.result;
                const data = JSON.parse(jsonStr);
                if (typeof data === 'object' && data !== null) {
                    if (confirm("确定要覆盖当前存档吗？此操作不可逆。")) {
                        localStorage.setItem(SaveManager.KEY, jsonStr);
                        SaveManager.init();
                        this.renderMenu();
                        alert("存档导入成功！");
                    }
                } else {
                    throw new Error("格式无效");
                }
            } catch (err) {
                alert("存档文件无效或已损坏！");
                console.error(err);
            }
            inputElement.value = '';
        };
        reader.readAsText(file);
    },

    init: async function () {
        this.canvas = document.getElementById('gameCanvas');
        this.context = this.canvas.getContext('2d');
        this.context.imageSmoothingEnabled = false;

        this.renderMenu();
        await Assets.load();
        this.bindInputEvents();
        this.lastFrameTime = performance.now();
        requestAnimationFrame(this.gameLoop.bind(this));

        if (typeof SnowSystem !== 'undefined') SnowSystem.init();
    },

    renderMenu: function () {
        const grid = document.getElementById('level-grid');
        grid.innerHTML = '';
        for (let i = 1; i <= 30; i++) {
            const record = SaveManager.get(i);
            const card = document.createElement('div');
            card.className = `lvl-card ${record ? 'passed' : ''}`;

            let html = `<div class="lvl-num">${i}</div>`;
            if (record) {
                const sec = (record.time / 1000).toFixed(1);
                html += `<div class="lvl-stats">Steps: ${record.steps}<br>Time: ${sec}s</div>`;
                html += `<div style="margin-top:5px;display:flex;gap:2px">
                    <button class="btn-replay user">我的回放</button>
                </div>`;
            } else {
                html += `<div class="lvl-stats" style="color:#888">未完成</div>`;
            }

            const hasSolution = (typeof AUTO_SOLVED_PATHS !== 'undefined'
                && AUTO_SOLVED_PATHS.carrot
                && AUTO_SOLVED_PATHS.carrot[i - 1]); 

            if (hasSolution) {
                html += `<button class="btn-replay cpu" style="margin-top:2px;background:#673ab7">参考解法</button>`;
            } else {
                html += `<button class="btn-replay cpu" style="margin-top:2px;background:#444;color:#666;cursor:default">无解法</button>`;
            }

            card.innerHTML = html;
            card.onclick = (e) => {
                e.stopPropagation();
                if (e.target.classList.contains('user') && record) {
                    this.startLevel(i, 'REPLAY', record.history);
                }
                else if (e.target.classList.contains('cpu') && hasSolution) {
                    const sol = AUTO_SOLVED_PATHS.carrot[i - 1];
                    this.startLevel(i, 'REPLAY', sol);
                }
                else if (!e.target.classList.contains('cpu')) {
                    this.startLevel(i, 'PLAY');
                }
            };
            grid.appendChild(card);
        }
    },
    showMenu: function () {
        this.state.gameMode = 'MENU';
        this.state.paused = false;
        this.state.animation.active = false;
        this.state.queue = [];
        this.state.replayQueue = [];
        this.state.laser = null;
        document.getElementById('menu-screen').classList.remove('hidden');
        document.getElementById('game-screen').classList.add('hidden');
        document.getElementById('overlay').classList.add('hidden');
        this.renderMenu();
    },

    startLevel: async function (levelIndex, mode = 'PLAY', replayString = "") {
        const state = this.state;
        state.currentLevel = levelIndex;
        state.gameMode = mode;
        state.replayStack = [];
        state.actionQueue = [];
        state.stepCount = 0;
        state.gameTime = 0;
        state.isPaused = false;
        state.inputHistory = "";
        state.laserPath = null;
        state.animation.isActive = false;
        state.lastInputTime = 0;
        document.getElementById('menu-screen').classList.add('hidden');
        document.getElementById('game-screen').classList.remove('hidden');
        document.getElementById('overlay').classList.add('hidden');
        if (typeof LEVELS !== 'undefined' && LEVELS[levelIndex]) {
            const hex = LEVELS[levelIndex];
            const cleanHex = hex.replace(/\s+/g, '');
            const buffer = new Uint8Array(cleanHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16))).buffer;

            this.parseLevelData(buffer);
        } else {
            console.error(`Level ${levelIndex} data not found!`);
            alert("关卡数据丢失！");
            this.showMenu();
            return;
        }
        if (mode === 'REPLAY' && replayString) {
            state.replayStack = replayString.split('');
            console.log(`回放就绪: ${state.replayStack.length} 步`);
        }
        this.updateHUD();
    },

    restart: function () { this.startLevel(this.state.currentLevel); },
    nextLevel: function () { this.startLevel(this.state.currentLevel + 1); },

    parseLevelData: function (buffer) {
        const view = new DataView(buffer);
        const state = this.state;
        state.width = 16;
        state.height = Math.floor((buffer.byteLength - 4) / 16);
        state.mapData = [];
        state.starsTotal = 0;
        state.starsCollected = 0;
        state.keys = { silver: 0, gold: 0, copper: 0 };
        for (let y = 0; y < state.height; y++) {
            let row = [];
            for (let x = 0; x < state.width; x++) {
                const id = view.getUint8(4 + y * 16 + x);
                row.push(id);
                if (id === TILE.START) {
                    state.bobby.gridX = x;
                    state.bobby.gridY = y;
                    state.bobby.direction = 3;
                }
                if (id === TILE.STAR) state.starsTotal++;
            }
            state.mapData.push(row);
        }
        this.canvas.width = state.width * DSZ;
        this.canvas.height = state.height * DSZ;
        this.context.imageSmoothingEnabled = false;
    },

    gameLoop: function (timestamp) {
        const dt = timestamp - this.lastFrameTime;
        this.lastFrameTime = timestamp;
        if (this.state.gameMode === 'MENU') {
            requestAnimationFrame(this.gameLoop.bind(this));
            return;
        }
        if (!this.state.isPaused) {
            const gameDeltaTime = dt * this.state.timeScale;
            const isPlaying = this.state.gameMode === 'PLAY';
            const isNotWon = this.state.animation.type !== 'WIN';
            if (isPlaying && isNotWon) {
                this.state.gameTime += gameDeltaTime;
            }
            if (!this.state.animation.isActive && this.state.actionQueue.length === 0) {
                if (this.state.gameMode === 'PLAY') {
                    if (this.inputKeys.up) this.queueMoveInput(0, -1);
                    else if (this.inputKeys.down) this.queueMoveInput(0, 1);
                    else if (this.inputKeys.left) this.queueMoveInput(-1, 0);
                    else if (this.inputKeys.right) this.queueMoveInput(1, 0);
                }
                else if (this.state.gameMode === 'REPLAY') {
                    if (this.state.replayStack.length > 0) {
                        const char = this.state.replayStack.shift();
                        let dx = 0, dy = 0;
                        if (char === 'l') dx = -1; else if (char === 'r') dx = 1;
                        else if (char === 'u') dy = -1; else if (char === 'd') dy = 1;

                        this.queueMoveInput(dx, dy);
                    }
                }
            }
            if (!this.state.animation.isActive && this.state.actionQueue.length > 0) {
                const action = this.state.actionQueue.shift();

                if (action.type === 'MOVE') {
                    this.executeMove(action.dx, action.dy, action.isManual, action.recordChar);
                }
                else if (action.type === 'LASER') {
                    this.executeLaser(action.dir);
                }
            }
            if (this.state.animation.isActive) {
                this.updateAnimation(gameDeltaTime);
            }
        }
        this.render();
        this.updateHUD();
        if (typeof SnowSystem !== 'undefined') {
            SnowSystem.update(dt * this.state.timeScale);
            SnowSystem.draw(this.context);
        }
        requestAnimationFrame(this.gameLoop.bind(this));
    },

    queueMoveInput: function (dx, dy) {
        this.state.lastInputTime = Date.now();
        if (dx === -1) this.state.bobby.direction = DIR.LEFT;
        if (dx === 1) this.state.bobby.direction = DIR.RIGHT;
        if (dy === -1) this.state.bobby.direction = DIR.UP;
        if (dy === 1) this.state.bobby.direction = DIR.DOWN;
        let char = '';
        if (dx === -1) char = 'l'; else if (dx === 1) char = 'r';
        else if (dy === -1) char = 'u'; else if (dy === 1) char = 'd';
        this.state.actionQueue.push({
            type: 'MOVE',
            dx: dx, dy: dy,
            isManual: true,
            recordChar: char
        });
    },
    executeMove: function (dx, dy, isManual, recordChar) {
        const state = this.state;
        const nextX = state.bobby.gridX + dx;
        const nextY = state.bobby.gridY + dy;
        if (dx === -1) state.bobby.direction = DIR.LEFT;
        if (dx === 1) state.bobby.direction = DIR.RIGHT;
        if (dy === -1) state.bobby.direction = DIR.UP;
        if (dy === 1) state.bobby.direction = DIR.DOWN;
        if (nextX < 0 || nextX >= state.width || nextY < 0 || nextY >= state.height) return;
        const currentId = state.mapData[state.bobby.gridY][state.bobby.gridX];
        const moveDir = state.bobby.direction;
        const nextId = state.mapData[nextY][nextX];
        if (currentId >= 24 && currentId <= 29) {
            if (!ROT_EXIT_MASK[currentId][moveDir]) return;
        }
        const tileId = state.mapData[nextY][nextX];
        if (TILE.IS_SOLID(tileId)) return;
        if (tileId === TILE.LOCK_S && state.keys.silver <= 0) return;
        if (tileId === TILE.LOCK_G && state.keys.gold <= 0) return;
        if (tileId === TILE.LOCK_C && state.keys.copper <= 0) return;
        if (tileId === TILE.WALL_H && dy !== 0) return;
        if (tileId === TILE.WALL_V && dx !== 0) return;
        if (TILE.IS_ROT_WALL(nextId)) {
            if (!ROT_ENTER_MASK[nextId][moveDir]) return;
        }
        if (isManual) {
            state.stepCount++;
            if (state.gameMode === 'PLAY' && recordChar) {
                state.inputHistory += recordChar;
            }
        }
        const anim = state.animation;
        anim.isActive = true;
        anim.type = 'MOVE';
        anim.timer = 0;
        anim.pixelStartX = state.bobby.gridX * DSZ;
        anim.pixelStartY = state.bobby.gridY * DSZ;
        anim.pixelTargetX = nextX * DSZ;
        anim.pixelTargetY = nextY * DSZ;
        this.pendingMove = { x: nextX, y: nextY, dx: dx, dy: dy };
    },

    finalizeMove: function () {
        const state = this.state;
        const { x, y, dx, dy } = this.pendingMove;
        const oldX = state.bobby.gridX;
        const oldY = state.bobby.gridY;
        const oldTile = state.mapData[oldY][oldX];
        if (oldTile === TILE.TRAP_OFF) state.mapData[oldY][oldX] = TILE.TRAP_ON;
        if (TILE.IS_ROT_WALL(oldTile)) {
            let n = oldTile + 1;
            if (n > TILE.ROT_END) n = TILE.ROT_START;
            state.mapData[oldY][oldX] = n;
        }
        if (oldTile === TILE.WALL_H) state.mapData[oldY][oldX] = TILE.WALL_V;
        else if (oldTile === TILE.WALL_V) state.mapData[oldY][oldX] = TILE.WALL_H;
        if (TILE.IS_MIRROR(oldTile)) {
            let n = oldTile + 1;
            if (n > TILE.MIR_END) n = TILE.MIR_START;
            state.mapData[oldY][oldX] = n;
        }
        state.bobby.gridX = x;
        state.bobby.gridY = y;
        const tileId = state.mapData[y][x];
        if (tileId === TILE.STAR) { state.starsCollected++; state.mapData[y][x] = TILE.TRACE; }
        if (tileId === TILE.KEY_S) { state.keys.silver++; state.mapData[y][x] = TILE.EMPTY; }
        if (tileId === TILE.KEY_G) { state.keys.gold++; state.mapData[y][x] = TILE.EMPTY; }
        if (tileId === TILE.KEY_C) { state.keys.copper++; state.mapData[y][x] = TILE.EMPTY; }
        if (tileId === TILE.LOCK_S) { state.keys.silver--; state.mapData[y][x] = TILE.EMPTY; }
        if (tileId === TILE.LOCK_G) { state.keys.gold--; state.mapData[y][x] = TILE.EMPTY; }
        if (tileId === TILE.LOCK_C) { state.keys.copper--; state.mapData[y][x] = TILE.EMPTY; }
        if (tileId === TILE.BTN_OFF) {
            this.rotateAllWalls();
        }
        if (tileId === TILE.TRAP_ON) {
            this.triggerAnimation('DEATH');
            return;
        }
        if (tileId === TILE.FINISH && state.starsCollected >= state.starsTotal) {
            this.triggerAnimation('WIN');
            return;
        }
        if (tileId === TILE.ICE) {
            const nextX = x + dx;
            const nextY = y + dy;
            if (nextX >= 0 && nextX < state.width && nextY >= 0 && nextY < state.height) {
                const nextTile = state.mapData[nextY][nextX];
                if (!TILE.IS_SOLID(nextTile)) {
                    state.actionQueue.push({
                        type: 'MOVE',
                        dx: dx, dy: dy,
                        isManual: false,
                        recordChar: null
                    });
                }
            }
        }
        else if (TILE.IS_LASER(tileId)) {
            state.actionQueue.push({ type: 'LASER', dir: tileId - 49 });
        }

        state.animation.isActive = false;
    },
    rotateAllWalls: function () {
        const map = this.state.mapData;
        for (let y = 0; y < this.state.height; y++) {
            for (let x = 0; x < this.state.width; x++) {
                const id = map[y][x];
                if (id >= 24 && id <= 29) {
                    if (id >= 24 && id <= 29) {
                        if (id < 28) {
                            map[y][x] = 24 + (id + 1) % 4;
                        }
                        else {
                            map[y][x] = 28 + (id + 1) % 2;
                        }
                    }
                }
                if (id == 22 || id == 23) {
                    map[y][x] = 22 + (id + 1) % 2;
                }
            }
        }
    },
    executeLaser: function (dir) {
        this.triggerAnimation('LASER');
        let path = [];
        let cx = this.state.bobby.gridX;
        let cy = this.state.bobby.gridY;
        for (let i = 0; i < 300; i++) {
            cx += VEC[dir][0];
            cy += VEC[dir][1];
            if (cx < 0 || cx >= this.state.width || cy < 0 || cy >= this.state.height) break;
            const id = this.state.mapData[cy][cx];
            path.push({ x: cx, y: cy });
            if (id === TILE.ICE_BLOCK) {
                this.meltIce(cx, cy);
                break;
            }
            if (TILE.IS_MIRROR(id)) {
                const newDir = MIRROR_REF[id][dir];
                if (newDir !== null && newDir !== undefined) {
                    dir = newDir;
                    continue;
                } else {
                    break; 
                }
            }
            if (TILE.IS_LASER_BLOCKER(id)) break;
        }
        this.state.laserPath = path;
    },

    meltIce: function (x, y) {
        const s = this.state;
        const seq = [60, 61, 62, 63];
        seq.forEach((newId, idx) => {
            setTimeout(() => {
                if (s.mapData[y] && s.mapData[y][x] >= 59 && s.mapData[y][x] < 63) {
                    s.mapData[y][x] = newId;
                }
            }, (idx + 1) * 80);
        });
    },

    updateAnimation: function (gameDt) {
        const anim = this.state.animation;
        anim.timer += gameDt;
        if (anim.type === 'MOVE' || anim.type === 'SLIDE') {
            if (anim.timer >= CFG.ANIM_SPEED) {
                this.finalizeMove();
            }
        }
        else if (anim.type === 'LASER') {
            if (anim.timer > 300) {
                this.state.laserPath = null;
                anim.isActive = false;
            }
        }
        else if (anim.type === 'DEATH') {
            if (anim.timer > 800) {
                anim.isActive = false;
                this.showMsg("失败", "你踩到了陷阱!", true, false);
            }
        }
        else if (anim.type === 'WIN') {
            if (anim.timer > 900) {
                anim.isActive = false;
                if (this.state.gameMode === 'PLAY') {
                    SaveManager.submit(
                        this.state.currentLevel,
                        this.state.gameTime,
                        this.state.stepCount,
                        this.state.inputHistory
                    );
                }
                this.renderMenu(); 
                this.showMsg("胜利", "关卡完成!", false, true);
            }
        }
    },

    triggerAnimation: function (type) {
        this.state.animation.isActive = true;
        this.state.animation.type = type;
        this.state.animation.timer = 0;
    },

    render: function () {
        const ctx = this.context;
        const s = this.state;

        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        if (!s.mapData.length) return;
        const finishImg = Assets.imgs.finish;
        const finishFrame = Math.floor(this.frameTick / 10) % 4;
        const finishReady = s.starsCollected >= s.starsTotal;
        for (let y = 0; y < s.height; y++) {
            for (let x = 0; x < s.width; x++) {
                const id = s.mapData[y][x];
                if (id === TILE.FINISH && finishReady && finishImg) {
                    ctx.drawImage(finishImg, finishFrame * 16, 0, 16, 16, x * DSZ, y * DSZ, DSZ, DSZ);
                } else {
                    const sx = (id % 8) * CFG.TILE_SIZE;
                    const sy = Math.floor(id / 8) * CFG.TILE_SIZE;
                    ctx.drawImage(Assets.imgs.tiles, sx, sy, 16, 16, x * DSZ, y * DSZ, DSZ, DSZ);
                }
            }
        }

        if (s.laserPath) {
            ctx.lineWidth = 4; ctx.strokeStyle = "rgba(231,76,60,0.8)";
            ctx.beginPath();
            const off = DSZ / 2;
            const bx = s.bobby.gridX * DSZ + off;
            const by = s.bobby.gridY * DSZ + off;
            ctx.moveTo(bx, by);
            s.laserPath.forEach(p => ctx.lineTo(p.x * DSZ + off, p.y * DSZ + off));
            ctx.stroke();
        }

        this.drawBobby();
        this.frameTick++;
    },
    drawBobby: function () {
        const ctx = this.context;
        const s = this.state;
        const anim = s.animation;

        let img = null;
        let frame = 0;
        let drawX = s.bobby.gridX * DSZ;
        let drawY = s.bobby.gridY * DSZ;
        if (anim.isActive && (anim.type === 'MOVE' || anim.type === 'SLIDE')) {
            const p = Math.min(anim.timer / CFG.ANIM_SPEED, 1);
            drawX = anim.pixelStartX + (anim.pixelTargetX - anim.pixelStartX) * p;
            drawY = anim.pixelStartY + (anim.pixelTargetY - anim.pixelStartY) * p;
            const d = s.bobby.direction;
            let rawFrame = Math.floor(p * 8);
            if (rawFrame > 7) rawFrame = 7;
            if (d === DIR.LEFT) {
                img = Assets.imgs.move_l;
                frame = (rawFrame + 4) % 8;
            } else if (d === DIR.RIGHT) {
                img = Assets.imgs.move_r;
                frame = (rawFrame + 4) % 8;
            } else if (d === DIR.UP) {
                img = Assets.imgs.move_u;
                frame = rawFrame;
            } else {
                img = Assets.imgs.move_d;
                frame = rawFrame;
            }
        }
        else if (anim.isActive && anim.type === 'DEATH') {
            img = Assets.imgs.death; frame = Math.min(Math.floor(anim.timer / 100), 7);
        }
        else if (anim.isActive && anim.type === 'WIN') {
            img = Assets.imgs.win; frame = Math.min(Math.floor(anim.timer / 100), 8);
        }
        else {
            if (s.lastInputTime === 0) {
                img = Assets.imgs.idle;
                frame = 0;
            } else if (Date.now() - s.lastInputTime > CFG.IDLE_TIME) {
                img = Assets.imgs.idle_anim;
                frame = Math.floor(Date.now() / 200) % 3;
            } else {
                const d = s.bobby.direction;
                if (d === DIR.LEFT) { img = Assets.imgs.move_l; frame = 3; }
                else if (d === DIR.RIGHT) { img = Assets.imgs.move_r; frame = 3; }
                else if (d === DIR.UP) { img = Assets.imgs.move_u; frame = 7; }
                else { img = Assets.imgs.move_d; frame = 7; }
            }
        }
        if (!img) return;
        let w = 18, h = 25;
        if (img === Assets.imgs.death) { w = 22; h = 27; }
        else if (img === Assets.imgs.idle_anim || img === Assets.imgs.idle) { w = 18; h = 24; }
        const sx = frame * w;
        const dw = w * CFG.SCALE;
        const dh = h * CFG.SCALE;
        const ox = (DSZ - dw) / 2;
        const oy = DSZ - dh;
        ctx.drawImage(img, sx, 0, w, h, Math.floor(drawX + ox), Math.floor(drawY + oy), dw, dh);
    },

    bindInputEvents: function () {
        const setKey = (k, v) => { this.inputKeys[k] = v; };
        window.onkeydown = e => {
            if (this.state.animation.type === 'DEATH') return;
            if (e.key === 'w' || e.key === 'ArrowUp') setKey('up', true);
            if (e.key === 's' || e.key === 'ArrowDown') setKey('down', true);
            if (e.key === 'a' || e.key === 'ArrowLeft') setKey('left', true);
            if (e.key === 'd' || e.key === 'ArrowRight') setKey('right', true);
            if (e.key === 'r') this.restart();
            if (e.key === 'Escape') this.togglePause();
        };
        window.onkeyup = e => {
            if (e.key === 'w' || e.key === 'ArrowUp') setKey('up', false);
            if (e.key === 's' || e.key === 'ArrowDown') setKey('down', false);
            if (e.key === 'a' || e.key === 'ArrowLeft') setKey('left', false);
            if (e.key === 'd' || e.key === 'ArrowRight') setKey('right', false);
        };
        const bindBtn = (id, key) => {
            const b = document.getElementById(id);
            b.ontouchstart = (e) => { e.preventDefault(); setKey(key, true); };
            b.ontouchend = (e) => { e.preventDefault(); setKey(key, false); };
            b.onmousedown = () => setKey(key, true);
            b.onmouseup = () => setKey(key, false);
        };
        bindBtn('btn-up', 'up'); bindBtn('btn-down', 'down');
        bindBtn('btn-left', 'left'); bindBtn('btn-right', 'right');
    },
    toggleSpeed: function () {
        this.state.timeScale = (this.state.timeScale === 1) ? 2 : 1;
        document.getElementById('btn-speed').innerText = 'x' + this.state.timeScale;
        document.getElementById('btn-speed').blur();
    },
    togglePause: function () {
        if (this.state.animation.isActive && this.state.animation.type !== 'MOVE') return;
        this.state.isPaused = !this.state.isPaused;
        const btn = document.getElementById('btn-pause');
        btn.innerText = this.state.isPaused ? "▶" : "II";
        if (this.state.isPaused) {
            const ov = document.getElementById('overlay');
            ov.classList.remove('hidden');
            document.getElementById('msg-title').innerText = "暂停";
            document.getElementById('msg-text').innerText = "游戏已暂停";
            const b1 = document.getElementById('btn-retry');
            const b2 = document.getElementById('btn-next');
            b1.innerText = "继续"; b1.onclick = () => this.togglePause();
            b1.style.display = 'inline-block'; b2.style.display = 'none';
        } else {
            document.getElementById('overlay').classList.add('hidden');
            document.getElementById('btn-retry').innerText = "重试";
            document.getElementById('btn-retry').onclick = () => this.restart();
            this.lastFrameTime = performance.now();
        }
        btn.blur();
    },

    updateHUD: function () {
        const s = this.state;
        document.getElementById('disp-level').innerText = s.currentLevel;
        document.getElementById('disp-stars').innerText = `${s.starsCollected}/${s.starsTotal}`;
        const k = s.keys;
        const set = (id, n) => {
            const el = document.getElementById(id);
            if (el) {
                el.style.backgroundColor = n > 0 ? (id === 'k-s' ? '#bdc3c7' : id === 'k-g' ? '#f1c40f' : '#d35400') : '#444';
                el.style.boxShadow = n > 0 ? '0 0 5px #fff' : 'none';
            }
        };
        set('k-s', k.silver); set('k-g', k.gold); set('k-c', k.copper);

        document.getElementById('disp-steps').innerText = s.stepCount;

        if (document.getElementById('disp-time')) {
            const totalSec = Math.floor(s.gameTime / 1000);
            const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
            const sec = (totalSec % 60).toString().padStart(2, '0');
            document.getElementById('disp-time').innerText = `${m}:${sec}`;
        }
    },

    showMsg: function (t, txt, retry, next) {
        const ov = document.getElementById('overlay');
        ov.classList.remove('hidden');
        document.getElementById('msg-title').innerText = t;
        document.getElementById('msg-text').innerText = txt;
        document.getElementById('btn-retry').style.display = retry ? 'inline-block' : 'none';
        document.getElementById('btn-next').style.display = next ? 'inline-block' : 'none';
        document.getElementById('btn-retry').innerText = "重试";
        document.getElementById('btn-retry').onclick = () => this.restart();
    }
};

window.app = Game;
window.onload = () => Game.init();