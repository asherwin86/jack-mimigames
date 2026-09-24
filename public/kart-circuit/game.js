const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const overlay = document.getElementById("overlay");
const overlayDescription = document.getElementById("overlayDescription");
const startButton = document.getElementById("startButton");
const statusText = document.getElementById("statusText");
const raceInfo = document.getElementById("raceInfo");
const difficultyStatus = document.getElementById("difficultyStatus");
const cupStatus = document.getElementById("cupStatus");
const cupSummary = document.getElementById("cupSummary");
const mapStatus = document.getElementById("mapStatus");
const mapButton = document.getElementById("mapButton");
const autoSteerButton = document.getElementById("autoSteerButton");
const miniMapButton = document.getElementById("miniMapButton");
const devModeButton = document.getElementById("devModeButton");
const themeButton = document.getElementById("themeButton");
const modeButton = document.getElementById("modeButton");
const camButton = document.getElementById("camButton");
const audioButton = document.getElementById("audioButton");
const fullScreenButton = document.getElementById("fullScreenButton");
const pauseButton = document.getElementById("pauseButton");
const difficultyButtons = document.querySelectorAll("[data-difficulty]");
const cupButtons = document.querySelectorAll("[data-cup]");
const mapButtons = document.querySelectorAll("[data-map]");
const touchButtons = document.querySelectorAll("[data-key]");

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const CENTER = { x: WIDTH / 2, y: HEIGHT / 2 };
const MAX_SPEED = 100;
const BOOST_SPEED_BONUS = 28;
const BOOST_KICK = 18;
const START_COUNTDOWN_SECONDS = 3;

function getLapsToWin() {
    const map = maps[currentMapKey] ?? maps.neon;
    return map.lapsToWin ?? 5;
}

const keys = new Set();
const gamepadKeys = new Set();
const mouseButtons = {
    left: false,
    right: false,
};
const mouseState = {
    active: false,
    steer: 0,
};
let gamepadConnected = false;
let gamepadLabel = "Disconnected";
const gamepadActionLatch = {
    start: false,
    pause: false,
    camera: false,
    map: false,
    theme: false,
    mode: false,
    autoSteer: false,
    miniMap: false,
    devMode: false,
    restart: false,
};

function hasInput(code) {
    return keys.has(code) || gamepadKeys.has(code);
}

function getCanvasLocalPoint(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
        return { x: WIDTH / 2, y: HEIGHT / 2 };
    }
    return {
        x: ((event.clientX - rect.left) / rect.width) * WIDTH,
        y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
    };
}

function updateMouseSteer(event) {
    const point = getCanvasLocalPoint(event);
    const normalized = clamp((point.x - CENTER.x) / (WIDTH * 0.44), -1, 1);
    mouseState.steer = Math.abs(normalized) < 0.08 ? 0 : normalized;
    mouseState.active = true;
    if (typeof event.buttons === "number") {
        mouseButtons.left = Boolean(event.buttons & 1);
        mouseButtons.right = Boolean(event.buttons & 2);
    }
}

function clearMouseInput() {
    mouseButtons.left = false;
    mouseButtons.right = false;
    mouseState.active = false;
    mouseState.steer = 0;
}

function addRoundedRectPath(x, y, width, height, radius) {
    const safeRadius = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
    ctx.moveTo(x + safeRadius, y);
    ctx.lineTo(x + width - safeRadius, y);
    ctx.arcTo(x + width, y, x + width, y + safeRadius, safeRadius);
    ctx.lineTo(x + width, y + height - safeRadius);
    ctx.arcTo(x + width, y + height, x + width - safeRadius, y + height, safeRadius);
    ctx.lineTo(x + safeRadius, y + height);
    ctx.arcTo(x, y + height, x, y + height - safeRadius, safeRadius);
    ctx.lineTo(x, y + safeRadius);
    ctx.arcTo(x, y, x + safeRadius, y, safeRadius);
}

function fillRoundedRect(x, y, width, height, radius) {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
        ctx.roundRect(x, y, width, height, radius);
    } else {
        addRoundedRectPath(x, y, width, height, radius);
    }
    ctx.fill();
}

const audioState = {
    enabled: true,
    context: null,
    masterGain: null,
    engineOscillator: null,
    engineTone: null,
    engineGain: null,
};

function getAudioContext() {
    if (typeof window === "undefined") return null;
    return window.AudioContext || window.webkitAudioContext || null;
}

function ensureAudioContext() {
    const AudioContextClass = getAudioContext();
    if (!AudioContextClass) return null;
    if (audioState.context) return audioState.context;

    const context = new AudioContextClass();
    const masterGain = context.createGain();
    masterGain.gain.value = 0.22;
    masterGain.connect(context.destination);

    const engineOscillator = context.createOscillator();
    engineOscillator.type = "sawtooth";
    const engineTone = context.createOscillator();
    engineTone.type = "triangle";
    const engineGain = context.createGain();
    engineGain.gain.value = 0.0001;

    engineOscillator.connect(engineGain);
    engineTone.connect(engineGain);
    engineGain.connect(masterGain);

    engineOscillator.start();
    engineTone.start();

    audioState.context = context;
    audioState.masterGain = masterGain;
    audioState.engineOscillator = engineOscillator;
    audioState.engineTone = engineTone;
    audioState.engineGain = engineGain;
    return context;
}

function primeAudio() {
    if (!audioState.enabled) return;
    const context = ensureAudioContext();
    if (!context) return;
    if (context.state === "suspended") {
        context.resume().catch(() => { });
    }
}

function setMasterVolume(value, time = 0.04) {
    if (!audioState.masterGain || !audioState.context) return;
    const now = audioState.context.currentTime;
    audioState.masterGain.gain.cancelScheduledValues(now);
    audioState.masterGain.gain.setTargetAtTime(value, now, time);
}

function playTone({
    frequency = 440,
    endFrequency = frequency,
    duration = 0.12,
    type = "square",
    volume = 0.1,
    attack = 0.005,
    release = 0.07,
}) {
    if (!audioState.enabled) return;
    const context = ensureAudioContext();
    if (!context || context.state !== "running") return;

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    const stopAt = now + duration;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.linearRampToValueAtTime(endFrequency, stopAt);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, stopAt + release);
    oscillator.connect(gain);
    gain.connect(audioState.masterGain);
    oscillator.start(now);
    oscillator.stop(stopAt + release + 0.02);
}

function playCountdownTickSound() {
    playTone({ frequency: 720, endFrequency: 540, duration: 0.09, type: "square", volume: 0.055 });
}

function playGoSound() {
    playTone({ frequency: 420, endFrequency: 860, duration: 0.18, type: "sawtooth", volume: 0.09 });
    playTone({ frequency: 620, endFrequency: 1040, duration: 0.2, type: "triangle", volume: 0.055, attack: 0.01 });
}

function playBoostSound() {
    playTone({ frequency: 180, endFrequency: 760, duration: 0.22, type: "sawtooth", volume: 0.085, release: 0.12 });
}

function playCheckpointSound() {
    playTone({ frequency: 640, endFrequency: 820, duration: 0.1, type: "triangle", volume: 0.05 });
}

function playLapSound() {
    playTone({ frequency: 520, endFrequency: 780, duration: 0.12, type: "triangle", volume: 0.06 });
    playTone({ frequency: 780, endFrequency: 1040, duration: 0.14, type: "square", volume: 0.045, attack: 0.02 });
}

function playPickupSound() {
    playTone({ frequency: 700, endFrequency: 1100, duration: 0.12, type: "square", volume: 0.055 });
}

function playErrorSound() {
    playTone({ frequency: 220, endFrequency: 130, duration: 0.16, type: "sawtooth", volume: 0.07, release: 0.1 });
}

function playFinishSound(won) {
    if (won) {
        playTone({ frequency: 520, endFrequency: 900, duration: 0.18, type: "triangle", volume: 0.08 });
        playTone({ frequency: 760, endFrequency: 1280, duration: 0.24, type: "square", volume: 0.06, attack: 0.03, release: 0.16 });
        return;
    }
    playTone({ frequency: 320, endFrequency: 180, duration: 0.26, type: "sawtooth", volume: 0.07, release: 0.15 });
}

function playPauseSound(isPaused) {
    playTone({
        frequency: isPaused ? 480 : 360,
        endFrequency: isPaused ? 320 : 560,
        duration: 0.08,
        type: "square",
        volume: 0.045,
    });
}

function syncEngineAudio() {
    const context = audioState.context;
    if (!context || !audioState.engineGain || !audioState.enabled || context.state !== "running") return;
    const player = racers[0];
    const isActive = running && !raceOver && !paused && raceCountdown <= 0 && player;
    const speedRatio = isActive ? clamp(Math.abs(player.speed) / (MAX_SPEED + (player.topSpeedBonus ?? 0)), 0, 1.25) : 0;
    const accelerating = isActive && (hasInput("ArrowUp") || hasInput("KeyW") || mouseButtons.left);
    const targetFrequency = isActive ? 92 + speedRatio * 210 + (accelerating ? 18 : 0) : 70;
    const targetHarmonic = isActive ? targetFrequency * 1.98 : 140;
    const targetGain = isActive ? 0.018 + speedRatio * 0.055 + (accelerating ? 0.01 : 0) : 0.0001;
    const now = context.currentTime;
    audioState.engineOscillator.frequency.setTargetAtTime(targetFrequency, now, 0.05);
    audioState.engineTone.frequency.setTargetAtTime(targetHarmonic, now, 0.05);
    audioState.engineGain.gain.setTargetAtTime(targetGain, now, 0.08);
}

function setGamepadKey(code, pressed) {
    if (pressed) {
        gamepadKeys.add(code);
    } else {
        gamepadKeys.delete(code);
    }
}

function triggerGamepadAction(actionKey, pressed, action) {
    if (pressed && !gamepadActionLatch[actionKey]) {
        action();
    }
    gamepadActionLatch[actionKey] = pressed;
}

function resetGamepadActionLatch() {
    Object.keys(gamepadActionLatch).forEach((key) => {
        gamepadActionLatch[key] = false;
    });
}

function updateGamepadInput() {
    gamepadKeys.clear();
    gamepadConnected = false;
    gamepadLabel = "Disconnected";

    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
        gamepadLabel = "Unsupported";
        return;
    }

    const pads = navigator.getGamepads();
    const pad = Array.from(pads).find((candidate) => candidate?.connected);
    if (!pad) {
        resetGamepadActionLatch();
        return;
    }

    gamepadConnected = true;
    gamepadLabel = "Connected";

    const axisThreshold = 0.3;
    const rightHorizontal = pad.axes[2] ?? 0;
    const leftHorizontal = pad.axes[0] ?? 0;
    const steeringHorizontal = Math.abs(rightHorizontal) > axisThreshold ? rightHorizontal : leftHorizontal;
    const rightVertical = pad.axes[3] ?? 0;

    setGamepadKey("ArrowLeft", steeringHorizontal < -axisThreshold || Boolean(pad.buttons[14]?.pressed));
    setGamepadKey("ArrowRight", steeringHorizontal > axisThreshold || Boolean(pad.buttons[15]?.pressed));
    setGamepadKey("ArrowUp", Boolean(pad.buttons[7]?.pressed) || Boolean(pad.buttons[5]?.pressed) || Boolean(pad.buttons[12]?.pressed));
    setGamepadKey("ArrowDown", Boolean(pad.buttons[6]?.pressed) || Boolean(pad.buttons[4]?.pressed) || rightVertical > axisThreshold || Boolean(pad.buttons[13]?.pressed));
    setGamepadKey("Space", Boolean(pad.buttons[0]?.pressed));

    const raceActive = running && !raceOver;

    triggerGamepadAction("start", Boolean(pad.buttons[9]?.pressed), () => {
        if (!running || raceOver) {
            startRace();
            return;
        }
        togglePause();
    });

    if (raceActive) {
        triggerGamepadAction("camera", Boolean(pad.buttons[3]?.pressed), toggleCameraMode);
        triggerGamepadAction("map", Boolean(pad.buttons[2]?.pressed), cycleMap);
        triggerGamepadAction("theme", Boolean(pad.buttons[1]?.pressed), toggleDayNightMode);
        triggerGamepadAction("mode", Boolean(pad.buttons[8]?.pressed), toggleRenderMode);
        triggerGamepadAction("autoSteer", Boolean(pad.buttons[10]?.pressed), toggleAutoSteer);
        triggerGamepadAction("restart", Boolean(pad.buttons[11]?.pressed), startRace);
    } else {
        gamepadActionLatch.camera = false;
        gamepadActionLatch.map = false;
        gamepadActionLatch.theme = false;
        gamepadActionLatch.mode = false;
        gamepadActionLatch.autoSteer = false;
        gamepadActionLatch.restart = false;
    }

    gamepadActionLatch.pause = false;
    gamepadActionLatch.miniMap = false;
    gamepadActionLatch.devMode = false;
}

const maps = {
    neon: {
        label: "Neon Loop",
        lapsToWin: 5,
        color: "#53e0ff",
        worldScale: 1.22,
        roadHalfWidth: 78,
        shoulderHalfWidth: 112,
        checkpoints: [
            { x: 220, y: 150 },
            { x: 760, y: 150 },
            { x: 820, y: 400 },
            { x: 620, y: 530 },
            { x: 300, y: 520 },
            { x: 140, y: 330 },
        ],
        trackPath: [
            { x: 250, y: 130 },
            { x: 430, y: 92 },
            { x: 610, y: 110 },
            { x: 760, y: 180 },
            { x: 840, y: 320 },
            { x: 790, y: 470 },
            { x: 640, y: 560 },
            { x: 450, y: 580 },
            { x: 270, y: 540 },
            { x: 150, y: 440 },
            { x: 120, y: 280 },
            { x: 170, y: 170 },
        ],
        itemBoxes: [
            { x: 340, y: 180 },
            { x: 650, y: 210 },
            { x: 770, y: 390 },
            { x: 520, y: 500 },
            { x: 220, y: 430 },
        ],
        finishLine: { x1: 375, y1: 165, x2: 375, y2: 260 },
        startSide: { x: 375, y: 212 },
        spawnPoints: [
            { x: 330, y: 210 },
            { x: 350, y: 250 },
            { x: 300, y: 240 },
            { x: 370, y: 280 },
            { x: 320, y: 300 },
        ],
    },
    harbor: {
        label: "Harbor Bend",
        lapsToWin: 6,
        color: "#4e9fd6",
        worldScale: 1.28,
        roadHalfWidth: 82,
        shoulderHalfWidth: 118,
        checkpoints: [
            { x: 250, y: 150 },
            { x: 720, y: 180 },
            { x: 810, y: 310 },
            { x: 730, y: 500 },
            { x: 420, y: 550 },
            { x: 180, y: 470 },
            { x: 120, y: 290 },
        ],
        trackPath: [
            { x: 270, y: 110 },
            { x: 460, y: 96 },
            { x: 650, y: 116 },
            { x: 800, y: 180 },
            { x: 870, y: 300 },
            { x: 850, y: 460 },
            { x: 760, y: 560 },
            { x: 560, y: 608 },
            { x: 350, y: 600 },
            { x: 200, y: 540 },
            { x: 110, y: 420 },
            { x: 92, y: 280 },
            { x: 140, y: 170 },
        ],
        itemBoxes: [
            { x: 330, y: 210 },
            { x: 620, y: 170 },
            { x: 790, y: 350 },
            { x: 610, y: 530 },
            { x: 260, y: 520 },
        ],
        finishLine: { x1: 410, y1: 140, x2: 410, y2: 240 },
        startSide: { x: 410, y: 192 },
        spawnPoints: [
            { x: 360, y: 230 },
            { x: 340, y: 270 },
            { x: 385, y: 262 },
            { x: 320, y: 305 },
            { x: 370, y: 300 },
        ],
    },
    canyon: {
        label: "Canyon Run",
        lapsToWin: 4,
        color: "#d9754d",
        worldScale: 1.35,
        roadHalfWidth: 86,
        shoulderHalfWidth: 124,
        checkpoints: [
            { x: 210, y: 190 },
            { x: 460, y: 120 },
            { x: 770, y: 210 },
            { x: 770, y: 470 },
            { x: 510, y: 560 },
            { x: 220, y: 500 },
            { x: 120, y: 330 },
        ],
        trackPath: [
            { x: 220, y: 140 },
            { x: 420, y: 88 },
            { x: 620, y: 110 },
            { x: 820, y: 210 },
            { x: 860, y: 350 },
            { x: 820, y: 520 },
            { x: 650, y: 610 },
            { x: 440, y: 620 },
            { x: 230, y: 566 },
            { x: 110, y: 450 },
            { x: 86, y: 300 },
            { x: 130, y: 190 },
        ],
        itemBoxes: [
            { x: 280, y: 180 },
            { x: 560, y: 165 },
            { x: 760, y: 330 },
            { x: 680, y: 520 },
            { x: 330, y: 540 },
        ],
        finishLine: { x1: 300, y1: 160, x2: 300, y2: 264 },
        startSide: { x: 300, y: 212 },
        spawnPoints: [
            { x: 265, y: 230 },
            { x: 245, y: 268 },
            { x: 292, y: 260 },
            { x: 225, y: 300 },
            { x: 275, y: 300 },
        ],
    },
    metro: {
        label: "Metro Surge",
        lapsToWin: 4,
        color: "#ff9f6e",
        worldScale: 1.38,
        roadHalfWidth: 88,
        shoulderHalfWidth: 126,
        checkpoints: [
            { x: 220, y: 150 },
            { x: 400, y: 106 },
            { x: 650, y: 108 },
            { x: 835, y: 180 },
            { x: 870, y: 360 },
            { x: 760, y: 540 },
            { x: 540, y: 610 },
            { x: 320, y: 588 },
            { x: 160, y: 486 },
            { x: 108, y: 296 },
        ],
        trackPath: [
            { x: 240, y: 108 },
            { x: 360, y: 84 },
            { x: 500, y: 78 },
            { x: 670, y: 92 },
            { x: 812, y: 146 },
            { x: 892, y: 250 },
            { x: 900, y: 392 },
            { x: 842, y: 514 },
            { x: 730, y: 596 },
            { x: 580, y: 638 },
            { x: 424, y: 646 },
            { x: 286, y: 620 },
            { x: 174, y: 552 },
            { x: 106, y: 446 },
            { x: 80, y: 312 },
            { x: 102, y: 194 },
            { x: 158, y: 126 },
        ],
        itemBoxes: [
            { x: 306, y: 166 },
            { x: 566, y: 146 },
            { x: 780, y: 262 },
            { x: 814, y: 472 },
            { x: 596, y: 572 },
            { x: 330, y: 568 },
            { x: 166, y: 366 },
        ],
        finishLine: { x1: 312, y1: 146, x2: 312, y2: 280 },
        startSide: { x: 312, y: 214 },
        spawnPoints: [
            { x: 274, y: 206 },
            { x: 254, y: 246 },
            { x: 300, y: 248 },
            { x: 232, y: 286 },
            { x: 282, y: 292 },
        ],
    },
    summit: {
        label: "Summit Spiral",
        lapsToWin: 3,
        color: "#9bc7ff",
        worldScale: 1.42,
        roadHalfWidth: 90,
        shoulderHalfWidth: 132,
        checkpoints: [
            { x: 190, y: 160 },
            { x: 356, y: 110 },
            { x: 576, y: 98 },
            { x: 780, y: 148 },
            { x: 866, y: 280 },
            { x: 860, y: 456 },
            { x: 734, y: 574 },
            { x: 544, y: 628 },
            { x: 348, y: 610 },
            { x: 206, y: 526 },
            { x: 118, y: 392 },
            { x: 112, y: 234 },
        ],
        trackPath: [
            { x: 214, y: 112 },
            { x: 332, y: 82 },
            { x: 474, y: 72 },
            { x: 624, y: 78 },
            { x: 760, y: 118 },
            { x: 858, y: 194 },
            { x: 904, y: 304 },
            { x: 906, y: 430 },
            { x: 866, y: 540 },
            { x: 776, y: 620 },
            { x: 650, y: 664 },
            { x: 504, y: 680 },
            { x: 366, y: 664 },
            { x: 242, y: 612 },
            { x: 152, y: 530 },
            { x: 94, y: 424 },
            { x: 76, y: 300 },
            { x: 102, y: 188 },
            { x: 156, y: 124 },
        ],
        itemBoxes: [
            { x: 272, y: 172 },
            { x: 520, y: 142 },
            { x: 766, y: 230 },
            { x: 822, y: 420 },
            { x: 676, y: 574 },
            { x: 430, y: 594 },
            { x: 200, y: 470 },
        ],
        finishLine: { x1: 280, y1: 154, x2: 280, y2: 296 },
        startSide: { x: 280, y: 226 },
        spawnPoints: [
            { x: 240, y: 214 },
            { x: 220, y: 254 },
            { x: 266, y: 258 },
            { x: 196, y: 296 },
            { x: 246, y: 302 },
        ],
    },
    boardwalk: {
        label: "Boardwalk Dash",
        lapsToWin: 5,
        color: "#49c0a8",
        worldScale: 1.34,
        roadHalfWidth: 84,
        shoulderHalfWidth: 120,
        checkpoints: [
            { x: 236, y: 154 },
            { x: 472, y: 110 },
            { x: 716, y: 136 },
            { x: 846, y: 278 },
            { x: 822, y: 472 },
            { x: 622, y: 592 },
            { x: 356, y: 612 },
            { x: 146, y: 474 },
            { x: 104, y: 272 },
        ],
        trackPath: [
            { x: 256, y: 118 },
            { x: 420, y: 84 },
            { x: 596, y: 82 },
            { x: 760, y: 112 },
            { x: 876, y: 200 },
            { x: 922, y: 340 },
            { x: 896, y: 500 },
            { x: 786, y: 604 },
            { x: 614, y: 668 },
            { x: 410, y: 684 },
            { x: 238, y: 642 },
            { x: 118, y: 540 },
            { x: 72, y: 392 },
            { x: 84, y: 228 },
            { x: 156, y: 136 },
        ],
        itemBoxes: [
            { x: 314, y: 176 },
            { x: 592, y: 148 },
            { x: 824, y: 246 },
            { x: 848, y: 466 },
            { x: 608, y: 584 },
            { x: 298, y: 570 },
            { x: 140, y: 332 },
        ],
        finishLine: { x1: 320, y1: 148, x2: 320, y2: 280 },
        startSide: { x: 320, y: 214 },
        spawnPoints: [
            { x: 284, y: 210 },
            { x: 262, y: 250 },
            { x: 308, y: 252 },
            { x: 238, y: 292 },
            { x: 290, y: 294 },
        ],
    },
    grove: {
        label: "Grove Circuit",
        lapsToWin: 4,
        color: "#8dd66e",
        worldScale: 1.31,
        roadHalfWidth: 86,
        shoulderHalfWidth: 122,
        checkpoints: [
            { x: 214, y: 168 },
            { x: 392, y: 116 },
            { x: 638, y: 118 },
            { x: 824, y: 208 },
            { x: 850, y: 404 },
            { x: 700, y: 572 },
            { x: 444, y: 616 },
            { x: 214, y: 532 },
            { x: 108, y: 334 },
        ],
        trackPath: [
            { x: 228, y: 108 },
            { x: 354, y: 78 },
            { x: 502, y: 72 },
            { x: 666, y: 88 },
            { x: 816, y: 154 },
            { x: 894, y: 270 },
            { x: 904, y: 422 },
            { x: 828, y: 554 },
            { x: 676, y: 644 },
            { x: 486, y: 678 },
            { x: 300, y: 650 },
            { x: 160, y: 566 },
            { x: 82, y: 444 },
            { x: 70, y: 304 },
            { x: 116, y: 184 },
        ],
        itemBoxes: [
            { x: 276, y: 182 },
            { x: 530, y: 146 },
            { x: 786, y: 252 },
            { x: 792, y: 470 },
            { x: 560, y: 604 },
            { x: 256, y: 574 },
            { x: 120, y: 386 },
        ],
        finishLine: { x1: 292, y1: 152, x2: 292, y2: 284 },
        startSide: { x: 292, y: 218 },
        spawnPoints: [
            { x: 256, y: 214 },
            { x: 236, y: 254 },
            { x: 282, y: 258 },
            { x: 212, y: 296 },
            { x: 264, y: 300 },
        ],
    },
    foundry: {
        label: "Foundry Drift",
        lapsToWin: 4,
        color: "#ff7d5a",
        worldScale: 1.37,
        roadHalfWidth: 90,
        shoulderHalfWidth: 128,
        checkpoints: [
            { x: 240, y: 180 },
            { x: 478, y: 118 },
            { x: 736, y: 162 },
            { x: 862, y: 338 },
            { x: 790, y: 536 },
            { x: 548, y: 620 },
            { x: 278, y: 590 },
            { x: 118, y: 420 },
        ],
        trackPath: [
            { x: 260, y: 124 },
            { x: 410, y: 88 },
            { x: 584, y: 92 },
            { x: 736, y: 128 },
            { x: 850, y: 220 },
            { x: 904, y: 362 },
            { x: 872, y: 514 },
            { x: 768, y: 626 },
            { x: 610, y: 688 },
            { x: 424, y: 694 },
            { x: 262, y: 652 },
            { x: 142, y: 560 },
            { x: 84, y: 434 },
            { x: 90, y: 286 },
            { x: 152, y: 168 },
        ],
        itemBoxes: [
            { x: 312, y: 198 },
            { x: 610, y: 164 },
            { x: 812, y: 286 },
            { x: 794, y: 516 },
            { x: 510, y: 612 },
            { x: 224, y: 560 },
            { x: 110, y: 356 },
        ],
        finishLine: { x1: 332, y1: 156, x2: 332, y2: 294 },
        startSide: { x: 332, y: 224 },
        spawnPoints: [
            { x: 294, y: 218 },
            { x: 272, y: 258 },
            { x: 320, y: 262 },
            { x: 246, y: 300 },
            { x: 300, y: 304 },
        ],
    },
};

const cups = {
    neon: {
        label: "Neon Cup",
        color: "#53e0ff",
        maps: ["neon", "harbor", "canyon", "boardwalk"],
    },
    skyline: {
        label: "Skyline Cup",
        color: "#ff9f6e",
        maps: ["metro", "summit", "grove", "foundry"],
    },
};

const AI_BOT_COUNT = 12;
const botNames = [
    "Volt",
    "Ember",
    "Mint",
    "Nova",
    "Drift",
    "Blaze",
    "Rook",
    "Dash",
    "Axel",
    "Skid",
    "Jinx",
    "Pulse",
];
const racerPalette = [
    "#ffd166",
    "#53e0ff",
    "#ff6b6b",
    "#9bff8f",
    "#c792ff",
    "#5dd6ff",
    "#ff9f6e",
    "#63f0b1",
    "#ffd36f",
    "#8ec5ff",
    "#ff88ad",
    "#9cf77e",
    "#f4a7ff",
];
const racerBlueprints = [
    { name: "Player", color: racerPalette[0], isPlayer: true },
    ...botNames.slice(0, AI_BOT_COUNT).map((name, index) => ({
        name,
        color: racerPalette[(index + 1) % racerPalette.length],
    })),
];

function getCupPointsForPlace(placeIndex) {
    const points = [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    return points[placeIndex] ?? 0;
}

function createCupPoints() {
    return Object.fromEntries(racerBlueprints.map((racer) => [racer.name, 0]));
}

function getCupConfig() {
    return currentCupKey ? cups[currentCupKey] ?? null : null;
}

function getRaceRanking() {
    return racers
        .map((racer) => ({
            racer,
            score: racer.lap * centerlinePath.length + getNearestTrackProgress(racer),
        }))
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.racer);
}

function getCupRanking() {
    return racerBlueprints
        .map((racer) => ({
            name: racer.name,
            color: racer.color,
            points: cupPoints[racer.name] ?? 0,
        }))
        .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

let currentMapKey = "neon";
let currentCupKey = null;
let currentCupRaceIndex = 0;
let cupPoints = createCupPoints();
let cupAdvancePending = false;
let checkpoints = [];
let trackPath = [];
let itemBoxes = [];
let finishLine = { x1: 375, y1: 165, x2: 375, y2: 260 };
let startSide = { x: 375, y: 212 };
let centerlinePath = [];
let roadHalfWidth = 72;
let shoulderHalfWidth = 104;
let worldBounds = {
    minX: 0,
    maxX: WIDTH,
    minY: 0,
    maxY: HEIGHT,
};
let racerLoadout = [];

function buildCenterlinePath(points, subdivisions = 10) {
    const result = [];
    const total = points.length;

    for (let index = 0; index < total; index += 1) {
        const p0 = points[(index - 1 + total) % total];
        const p1 = points[index];
        const p2 = points[(index + 1) % total];
        const p3 = points[(index + 2) % total];

        for (let step = 0; step < subdivisions; step += 1) {
            const t = step / subdivisions;
            const t2 = t * t;
            const t3 = t2 * t;
            result.push({
                x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
                y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
            });
        }
    }

    return result;
}

const difficultySettings = {
    easy: {
        label: "Easy",
        aiPaceMin: 0.5,
        aiPaceMax: 0.64,
        aiSpeedBonus: -14,
        aiCatchUpBoost: 14,
        aiPlaceCatchUp: 0.6,
        aiLeaderPenalty: 5,
        aiLaneSpread: 1.18,
        aiAvoidanceStrength: 1.22,
        aiTrafficWidth: 24,
        aiTrafficPenalty: 22,
        collisionSpacing: 1.14,
        collisionDamping: 1.12,
        playerAccel: 1.12,
        playerBrake: 1.08,
        boostTime: 0.72,
    },
    medium: {
        label: "Medium",
        aiPaceMin: 0.7,
        aiPaceMax: 0.9,
        aiSpeedBonus: 0,
        aiCatchUpBoost: 18,
        aiPlaceCatchUp: 0.8,
        aiLeaderPenalty: 4,
        aiLaneSpread: 1,
        aiAvoidanceStrength: 1,
        aiTrafficWidth: 20,
        aiTrafficPenalty: 17,
        collisionSpacing: 1,
        collisionDamping: 1,
        playerAccel: 1,
        playerBrake: 1,
        boostTime: 0.6,
    },
    hard: {
        label: "Hard",
        aiPaceMin: 0.9,
        aiPaceMax: 1.08,
        aiSpeedBonus: 22,
        aiCatchUpBoost: 22,
        aiPlaceCatchUp: 1,
        aiLeaderPenalty: 3,
        aiLaneSpread: 0.82,
        aiAvoidanceStrength: 0.84,
        aiTrafficWidth: 16,
        aiTrafficPenalty: 11,
        collisionSpacing: 0.9,
        collisionDamping: 0.9,
        playerAccel: 0.96,
        playerBrake: 0.94,
        boostTime: 0.5,
    },
};

let currentDifficulty = "medium";

function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function distancePointToSegment(point, segmentStart, segmentEnd) {
    const segX = segmentEnd.x - segmentStart.x;
    const segY = segmentEnd.y - segmentStart.y;
    const segLengthSquared = segX * segX + segY * segY;
    if (segLengthSquared === 0) return dist(point, segmentStart);

    const projection = clamp(
        ((point.x - segmentStart.x) * segX + (point.y - segmentStart.y) * segY) / segLengthSquared,
        0,
        1,
    );

    return dist(point, {
        x: segmentStart.x + segX * projection,
        y: segmentStart.y + segY * projection,
    });
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function wrapAngle(angle) {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function inverseLerp(a, b, value) {
    if (a === b) return 0;
    return (value - a) / (b - a);
}

function normalizeVector(x, y) {
    const length = Math.hypot(x, y) || 1;
    return { x: x / length, y: y / length };
}

function lerpAngle(current, target, amount) {
    return current + wrapAngle(target - current) * amount;
}

function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x;
        const yi = polygon[i].y;
        const xj = polygon[j].x;
        const yj = polygon[j].y;
        const intersect = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
}

function getCenterlinePoint(progress) {
    const total = centerlinePath.length;
    const wrapped = ((progress % total) + total) % total;
    const index = Math.floor(wrapped);
    const nextIndex = (index + 1) % total;
    const amount = wrapped - index;
    return {
        x: lerp(centerlinePath[index].x, centerlinePath[nextIndex].x, amount),
        y: lerp(centerlinePath[index].y, centerlinePath[nextIndex].y, amount),
    };
}

function getCenterlineDirection(progress) {
    const total = centerlinePath.length;
    const wrapped = ((progress % total) + total) % total;
    const index = Math.floor(wrapped);
    const nextIndex = (index + 1) % total;
    return normalizeVector(
        centerlinePath[nextIndex].x - centerlinePath[index].x,
        centerlinePath[nextIndex].y - centerlinePath[index].y,
    );
}

function getNearestTrackProgress(position) {
    let bestProgress = 0;
    let bestDistance = Infinity;

    for (let index = 0; index < centerlinePath.length; index += 1) {
        const start = centerlinePath[index];
        const end = centerlinePath[(index + 1) % centerlinePath.length];
        const segmentX = end.x - start.x;
        const segmentY = end.y - start.y;
        const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY || 1;
        const projection = clamp(
            ((position.x - start.x) * segmentX + (position.y - start.y) * segmentY) / segmentLengthSquared,
            0,
            1,
        );
        const closestPoint = {
            x: start.x + segmentX * projection,
            y: start.y + segmentY * projection,
        };
        const distance = dist(position, closestPoint);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestProgress = index + projection;
        }
    }

    return bestProgress;
}

function getMapTransform() {
    const paddingX = 110;
    const paddingY = 84;
    const worldWidth = worldBounds.maxX - worldBounds.minX;
    const worldHeight = worldBounds.maxY - worldBounds.minY;
    const scale = Math.min((WIDTH - paddingX * 2) / worldWidth, (HEIGHT - paddingY * 2) / worldHeight);
    const offsetX = (WIDTH - worldWidth * scale) / 2 - worldBounds.minX * scale;
    const offsetY = (HEIGHT - worldHeight * scale) / 2 - worldBounds.minY * scale;
    return { scale, offsetX, offsetY };
}

function projectToMap(point, transform) {
    return {
        x: point.x * transform.scale + transform.offsetX,
        y: point.y * transform.scale + transform.offsetY,
    };
}

function getVerticalGateCross(prevPoint, nextPoint, gateX) {
    const deltaX = nextPoint.x - prevPoint.x;
    if (deltaX === 0) return null;

    const crossesForward = prevPoint.x < gateX && nextPoint.x >= gateX;
    const crossesBackward = prevPoint.x > gateX && nextPoint.x <= gateX;
    if (!crossesForward && !crossesBackward) return null;

    const travel = (gateX - prevPoint.x) / deltaX;
    if (travel < 0 || travel > 1) return null;

    return {
        y: lerp(prevPoint.y, nextPoint.y, travel),
        direction: crossesForward ? 1 : -1,
    };
}

function createCamera(player) {
    const cameraMode = getCameraModeConfig();
    const modeChanged = cameraState.modeKey !== cameraMode.key;
    const speedFactor = clamp(Math.abs(player.speed) / MAX_SPEED, 0, 1);
    const trackProgress = getNearestTrackProgress(player);
    const lowSpeedLookFactor = 0.18 + speedFactor * 0.82;
    const dynamicAngleTrackOffset = cameraMode.angleTrackOffset * lowSpeedLookFactor;
    const dynamicLookAheadBase = cameraMode.lookAheadBase * (0.4 + speedFactor * 0.6);
    const dynamicLookAheadSpeed = cameraMode.lookAheadSpeed * speedFactor;
    const trackDirection = getCenterlineDirection(trackProgress + dynamicAngleTrackOffset);
    const trackAngle = Math.atan2(trackDirection.y, trackDirection.x);
    const playerInfluence = clamp(
        Math.max(cameraMode.playerInfluenceBase + speedFactor * cameraMode.playerInfluenceSpeed, cameraMode.playerInfluenceMin ?? 0.5),
        0,
        0.96,
    );
    const targetAngle = trackAngle + wrapAngle(player.angle - trackAngle) * playerInfluence;
    cameraState.angle = modeChanged
        ? targetAngle
        : lerpAngle(cameraState.angle, targetAngle, cameraMode.angleLerpBase + speedFactor * cameraMode.angleLerpSpeed);
    const forward = {
        x: Math.cos(cameraState.angle),
        y: Math.sin(cameraState.angle),
    };
    const right = {
        x: -forward.y,
        y: forward.x,
    };

    const followDistance = cameraMode.followDistanceBase + speedFactor * cameraMode.followDistanceSpeed;
    const offsetRight = cameraMode.offsetRightBase + speedFactor * cameraMode.offsetRightSpeed;
    const lookAhead = getCenterlinePoint(trackProgress + dynamicLookAheadBase + dynamicLookAheadSpeed);
    const focusX = lerp(player.x, lookAhead.x, cameraMode.focusBlend);
    const focusY = lerp(player.y, lookAhead.y, cameraMode.focusBlend);
    const targetX = focusX - forward.x * followDistance + right.x * offsetRight;
    const targetY = focusY - forward.y * followDistance + right.y * offsetRight;
    cameraState.x = modeChanged ? targetX : lerp(cameraState.x, targetX, cameraMode.positionLerp);
    cameraState.y = modeChanged ? targetY : lerp(cameraState.y, targetY, cameraMode.positionLerp);
    cameraState.modeKey = cameraMode.key;

    return {
        x: cameraState.x,
        y: cameraState.y,
        forward,
        right,
        height: cameraMode.heightBase + speedFactor * cameraMode.heightSpeed,
        horizon: HEIGHT * (cameraMode.horizonBase - speedFactor * cameraMode.horizonSpeed),
        projection: cameraMode.projectionBase + speedFactor * cameraMode.projectionSpeed,
        nearPlane: cameraMode.nearPlane,
        showCockpit: cameraMode.showCockpit,
    };
}

function projectWorldPoint(x, y, height, camera) {
    const dx = x - camera.x;
    const dy = y - camera.y;
    const lateral = dx * camera.right.x + dy * camera.right.y;
    const forward = dx * camera.forward.x + dy * camera.forward.y;

    if (forward <= camera.nearPlane) {
        return null;
    }

    const scale = camera.projection / forward;
    return {
        x: CENTER.x + lateral * scale,
        y: camera.horizon + (camera.height - height) * scale,
        scale,
        depth: forward,
    };
}

function projectBotSprite(racer, camera) {
    const dx = racer.x - camera.x;
    const dy = racer.y - camera.y;
    const lateral = dx * camera.right.x + dy * camera.right.y;
    const forward = dx * camera.forward.x + dy * camera.forward.y;

    if (forward <= -28) {
        return null;
    }

    const depth = Math.max(forward, camera.nearPlane * 0.72);
    const scale = camera.projection / depth;
    return {
        depth,
        rearBias: clamp(inverseLerp(camera.nearPlane, -20, forward), 0, 1),
        base: {
            x: CENTER.x + lateral * scale,
            y: camera.horizon + camera.height * scale,
        },
        top: {
            x: CENTER.x + lateral * scale,
            y: camera.horizon + (camera.height - 24) * scale,
        },
    };
}

function drawQuad(points, fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
        ctx.lineTo(points[index].x, points[index].y);
    }
    ctx.closePath();
    ctx.fill();
}

function checkpointApproachVector(index) {
    const current = checkpoints[index];
    const previous = checkpoints[(index - 1 + checkpoints.length) % checkpoints.length];
    return {
        x: current.x - previous.x,
        y: current.y - previous.y,
    };
}

function isWrongSideOfCheckpoint(position, index) {
    const checkpoint = checkpoints[index];
    const approachVector = checkpointApproachVector(index);
    const relative = {
        x: position.x - checkpoint.x,
        y: position.y - checkpoint.y,
    };
    return relative.x * approachVector.x + relative.y * approachVector.y > 0;
}

function getDifficultySetting() {
    return difficultySettings[currentDifficulty] ?? difficultySettings.medium;
}

function createRacer(name, color, x, y, isPlayer = false) {
    const difficulty = getDifficultySetting();
    const laneSeed = isPlayer ? 0 : Math.sin((name.length * 17.37) + (x * 0.013) + (y * 0.009));
    return {
        name,
        color,
        x,
        y,
        prevX: x,
        prevY: y,
        angle: -Math.PI / 2,
        speed: 0,
        width: 18,
        length: 30,
        lap: 0,
        checkpointIndex: 0,
        boostCharge: 1,
        boostTimer: 0,
        invulnTimer: 0,
        isPlayer,
        accelMultiplier: isPlayer ? 1.14 : 1,
        topSpeedBonus: isPlayer ? 10 : 0,
        steerGrip: isPlayer ? 1.08 : 1,
        coastDrag: isPlayer ? 1.5 : 1.7,
        brakePower: isPlayer ? 172 : 160,
        aiPace: isPlayer ? 0 : difficulty.aiPaceMin + Math.random() * (difficulty.aiPaceMax - difficulty.aiPaceMin),
        aiLaneBias: isPlayer ? 0 : clamp(laneSeed * 0.55, -0.55, 0.55),
        aiLookAhead: isPlayer ? 0 : 5 + Math.random() * 1.8,
        previousSide: x < startSide.x,
        finished: false,
        place: 1,
        driftEnergy: 0,
        gateLockTimer: 0,
        stuckTimer: 0,
    };
}

function alignRacerToTrack(racer) {
    const progress = getNearestTrackProgress(racer);
    const direction = getCenterlineDirection(progress + 0.75);
    racer.angle = Math.atan2(direction.y, direction.x);
    racer.prevX = racer.x;
    racer.prevY = racer.y;
    racer.previousSide = racer.x < startSide.x;
}

let racers = [];

const cameraState = {
    x: CENTER.x,
    y: CENTER.y,
    angle: -Math.PI / 2,
    modeKey: "chase",
};

const cameraModes = [
    {
        key: "chase",
        label: "Chase",
        angleTrackOffset: 0.65,
        playerInfluenceBase: 0.22,
        playerInfluenceSpeed: 0.4,
        playerInfluenceMin: 0.62,
        angleLerpBase: 0.18,
        angleLerpSpeed: 0.08,
        followDistanceBase: 42,
        followDistanceSpeed: 24,
        lookAheadBase: 3.9,
        lookAheadSpeed: 1.4,
        focusBlend: 0.34,
        positionLerp: 0.24,
        heightBase: 116,
        heightSpeed: 9,
        horizonBase: 0.35,
        horizonSpeed: 0.03,
        projectionBase: 730,
        projectionSpeed: 90,
        nearPlane: 16,
        offsetRightBase: 0,
        offsetRightSpeed: 0,
        showCockpit: true,
    },
    {
        key: "hood",
        label: "Hood",
        angleTrackOffset: 0.55,
        playerInfluenceBase: 0.46,
        playerInfluenceSpeed: 0.32,
        playerInfluenceMin: 0.54,
        angleLerpBase: 0.24,
        angleLerpSpeed: 0.08,
        followDistanceBase: 12,
        followDistanceSpeed: 10,
        lookAheadBase: 3.5,
        lookAheadSpeed: 1.3,
        focusBlend: 0.48,
        positionLerp: 0.24,
        heightBase: 92,
        heightSpeed: 7,
        horizonBase: 0.42,
        horizonSpeed: 0.022,
        projectionBase: 900,
        projectionSpeed: 110,
        nearPlane: 8,
        offsetRightBase: 0,
        offsetRightSpeed: 0,
        showCockpit: false,
    },
    {
        key: "wide",
        label: "Wide",
        angleTrackOffset: 0.75,
        playerInfluenceBase: 0.18,
        playerInfluenceSpeed: 0.24,
        playerInfluenceMin: 0.46,
        angleLerpBase: 0.14,
        angleLerpSpeed: 0.06,
        followDistanceBase: 72,
        followDistanceSpeed: 34,
        lookAheadBase: 4.9,
        lookAheadSpeed: 1.8,
        focusBlend: 0.28,
        positionLerp: 0.16,
        heightBase: 138,
        heightSpeed: 10,
        horizonBase: 0.29,
        horizonSpeed: 0.03,
        projectionBase: 650,
        projectionSpeed: 75,
        nearPlane: 12,
        offsetRightBase: 0,
        offsetRightSpeed: 0,
        showCockpit: true,
    },
    {
        key: "outside",
        label: "Outside",
        angleTrackOffset: 0.58,
        playerInfluenceBase: 0.34,
        playerInfluenceSpeed: 0.3,
        playerInfluenceMin: 0.5,
        angleLerpBase: 0.2,
        angleLerpSpeed: 0.07,
        followDistanceBase: 70,
        followDistanceSpeed: 26,
        lookAheadBase: 3.4,
        lookAheadSpeed: 1.1,
        focusBlend: 0.28,
        positionLerp: 0.18,
        heightBase: 148,
        heightSpeed: 12,
        horizonBase: 0.28,
        horizonSpeed: 0.02,
        projectionBase: 690,
        projectionSpeed: 80,
        nearPlane: 10,
        offsetRightBase: 5,
        offsetRightSpeed: 2,
        showCockpit: false,
    },
];

const themePalettes = {
    day: {
        skyTop: "#8ad4ff",
        skyMid: "#4e9fd6",
        skyBottom: "#16334f",
        sunColor: "rgba(255, 220, 128, 0.86)",
        mountainColor: "rgba(28, 62, 96, 0.86)",
        grassTop: "#2e7c45",
        grassBottom: "#1f4f2f",
        hazeTop: "rgba(255,255,255,0.24)",
        hazeBottom: "rgba(255,255,255,0)",
        shoulderA: "#2f6c47",
        shoulderB: "#27593b",
        roadA: "#46506f",
        roadB: "#3a425e",
        curbA: "#ff6f6f",
        curbB: "#fff4d2",
        lane: "rgba(255,255,255,0.78)",
        farFog: "rgba(234, 245, 255, __ALPHA__)",
        finish: "rgba(255, 248, 214, 0.95)",
        mapBgTop: "#20385b",
        mapBgBottom: "#102238",
        mapGrass: "#27613a",
    },
    night: {
        skyTop: "#0d1833",
        skyMid: "#16305e",
        skyBottom: "#070c18",
        sunColor: "rgba(255, 232, 168, 0.9)",
        mountainColor: "rgba(13, 24, 44, 0.92)",
        grassTop: "#235234",
        grassBottom: "#11261a",
        hazeTop: "rgba(170, 205, 255, 0.22)",
        hazeBottom: "rgba(255,255,255,0)",
        shoulderA: "#2b6648",
        shoulderB: "#214f38",
        roadA: "#38435f",
        roadB: "#2a324a",
        curbA: "#e85e5e",
        curbB: "#c8d0ff",
        lane: "rgba(228, 236, 255, 0.72)",
        farFog: "rgba(210, 226, 255, __ALPHA__)",
        finish: "rgba(255, 240, 194, 0.95)",
        mapBgTop: "#172548",
        mapBgBottom: "#0b1424",
        mapGrass: "#173322",
    },
};

function getThemePalette() {
    return themePalettes[dayNightMode] ?? themePalettes.night;
}

function clonePoints(points) {
    return points.map((point) => ({ ...point }));
}

function centerOfPoints(points) {
    const sum = points.reduce((acc, point) => ({
        x: acc.x + point.x,
        y: acc.y + point.y,
    }), { x: 0, y: 0 });
    const count = Math.max(points.length, 1);
    return {
        x: sum.x / count,
        y: sum.y / count,
    };
}

function scalePoint(point, center, scale) {
    return {
        x: center.x + (point.x - center.x) * scale,
        y: center.y + (point.y - center.y) * scale,
    };
}

function scaleVerticalLine(line, center, scale) {
    const top = scalePoint({ x: line.x1, y: line.y1 }, center, scale);
    const bottom = scalePoint({ x: line.x2, y: line.y2 }, center, scale);
    const lineX = (top.x + bottom.x) / 2;
    return {
        x1: lineX,
        y1: top.y,
        x2: lineX,
        y2: bottom.y,
    };
}

function buildScaledMapLayout(map) {
    const worldScale = map.worldScale ?? 1;
    if (worldScale === 1) {
        return {
            checkpoints: clonePoints(map.checkpoints),
            trackPath: clonePoints(map.trackPath),
            itemBoxes: clonePoints(map.itemBoxes),
            finishLine: { ...map.finishLine },
            startSide: { ...map.startSide },
            spawnPoints: clonePoints(map.spawnPoints),
        };
    }

    const pivot = centerOfPoints(map.trackPath);
    return {
        checkpoints: map.checkpoints.map((point) => scalePoint(point, pivot, worldScale)),
        trackPath: map.trackPath.map((point) => scalePoint(point, pivot, worldScale)),
        itemBoxes: map.itemBoxes.map((point) => scalePoint(point, pivot, worldScale)),
        finishLine: scaleVerticalLine(map.finishLine, pivot, worldScale),
        startSide: scalePoint(map.startSide, pivot, worldScale),
        spawnPoints: map.spawnPoints.map((point) => scalePoint(point, pivot, worldScale)),
    };
}

function computeWorldBounds(points) {
    return points.reduce((bounds, point) => ({
        minX: Math.min(bounds.minX, point.x),
        maxX: Math.max(bounds.maxX, point.x),
        minY: Math.min(bounds.minY, point.y),
        maxY: Math.max(bounds.maxY, point.y),
    }), {
        minX: Infinity,
        maxX: -Infinity,
        minY: Infinity,
        maxY: -Infinity,
    });
}

function syncMapUI() {
    const map = maps[currentMapKey] ?? maps.neon;
    if (mapStatus) {
        mapStatus.textContent = `Map: ${map.label}`;
    }
    if (mapButton) {
        mapButton.textContent = `Map: ${map.label}`;
    }
    mapButtons.forEach((button) => {
        button.classList.toggle("is-selected", button.dataset.map === currentMapKey);
    });
}

function syncCupUI() {
    const cup = getCupConfig();
    if (cupStatus) {
        cupStatus.textContent = cup
            ? `Cup: ${cup.label} ${Math.min(currentCupRaceIndex + 1, cup.maps.length)}/${cup.maps.length}`
            : "Cup: Free Play";
    }
    cupButtons.forEach((button) => {
        const isFreePlay = (button.dataset.cup ?? "") === "free";
        button.classList.toggle("is-selected", isFreePlay ? currentCupKey === null : button.dataset.cup === currentCupKey);
    });
    if (!cupSummary) return;
    if (!cup) {
        cupSummary.textContent = "Free Play: pick any track or choose a cup.";
        return;
    }
    const ranking = getCupRanking();
    const standings = ranking
        .slice(0, 6)
        .map((entry, index) => `${index + 1}. ${entry.name} ${entry.points}`)
        .join(" | ");
    const playerRank = ranking.findIndex((entry) => entry.name === "Player");
    const playerLabel = playerRank >= 0 && playerRank >= 6
        ? ` | You: ${playerRank + 1}. ${ranking[playerRank].points}`
        : "";
    const raceNumber = cupAdvancePending && currentCupRaceIndex < cup.maps.length - 1
        ? currentCupRaceIndex + 2
        : currentCupRaceIndex + 1;
    cupSummary.textContent = `${cup.label} • Race ${Math.min(raceNumber, cup.maps.length)}/${cup.maps.length} • ${standings}${playerLabel}`;
}

function resetCupSelection() {
    currentCupKey = null;
    currentCupRaceIndex = 0;
    cupAdvancePending = false;
    cupPoints = createCupPoints();
}

function setCup(nextCupKey) {
    if (!cups[nextCupKey]) {
        resetCupSelection();
        startButton.textContent = "Start Race";
        if (overlayDescription) {
            overlayDescription.textContent = "Hold your line, hit the boosts, and manage speed through the corners. Cross the finish gate after every checkpoint to score a lap.";
        }
        syncCupUI();
        draw();
        return;
    }

    currentCupKey = nextCupKey;
    currentCupRaceIndex = 0;
    cupAdvancePending = false;
    cupPoints = createCupPoints();
    const cup = cups[nextCupKey];
    applyMap(cup.maps[0]);
    resetRace();
    startButton.textContent = `Start ${cup.label}`;
    if (overlayDescription) {
        overlayDescription.textContent = `${cup.label}: race four tracks in order and build the most points across the cup.`;
    }
    statusText.textContent = `${cup.label} selected.`;
    syncCupUI();
    draw();
}

function awardCupPoints() {
    getRaceRanking().forEach((racer, index) => {
        cupPoints[racer.name] = (cupPoints[racer.name] ?? 0) + getCupPointsForPlace(index);
    });
}

function buildRaceSpawnPoints(layout, racerCount) {
    const result = clonePoints(layout.spawnPoints).slice(0, racerCount);
    if (result.length >= racerCount) return result;

    const baseProgress = getNearestTrackProgress(layout.startSide);
    for (let index = result.length; index < racerCount; index += 1) {
        const progress = baseProgress - (index - result.length + 1) * 2.3;
        const center = getCenterlinePoint(progress);
        const direction = getCenterlineDirection(progress);
        const normal = { x: -direction.y, y: direction.x };
        const sideOffset = (index % 2 === 0 ? -1 : 1) * Math.min(roadHalfWidth * 0.28, 22);
        result.push({
            x: center.x + normal.x * sideOffset,
            y: center.y + normal.y * sideOffset,
        });
    }

    return result;
}

function applyMap(mapKey) {
    const map = maps[mapKey] ?? maps.neon;
    currentMapKey = maps[mapKey] ? mapKey : "neon";
    const layout = buildScaledMapLayout(map);

    checkpoints = layout.checkpoints;
    trackPath = layout.trackPath;
    itemBoxes = layout.itemBoxes.map((box) => ({ ...box, active: true, respawnTimer: 0 }));
    finishLine = layout.finishLine;
    startSide = layout.startSide;
    roadHalfWidth = map.roadHalfWidth ?? 72;
    shoulderHalfWidth = map.shoulderHalfWidth ?? 104;
    centerlinePath = buildCenterlinePath(checkpoints, 10);
    worldBounds = computeWorldBounds(trackPath);
    const raceSpawnPoints = buildRaceSpawnPoints(layout, racerBlueprints.length);

    racerLoadout = racerBlueprints.map((racer, index) => ({
        ...racer,
        ...raceSpawnPoints[index],
    }));
    racers = racerLoadout.map((entry) =>
        createRacer(entry.name, entry.color, entry.x, entry.y, entry.isPlayer),
    );
    racers.forEach(alignRacerToTrack);
    cameraState.x = racers[0]?.x ?? CENTER.x;
    cameraState.y = racers[0]?.y ?? CENTER.y;
    cameraState.angle = racers[0]?.angle ?? -Math.PI / 2;
    syncMapUI();
    syncCupUI();
}

let running = false;
let raceOver = false;
let raceStartedAt = 0;
let lastTimestamp = 0;
let finishedCount = 0;
let raceCountdown = 0;
let raceCountdownDisplay = 0;
let raceGoTimer = 0;
let raceElapsed = 0;
let startBoostPrimed = false;
let renderMode = "3d";
let currentCameraMode = "chase";
let dayNightMode = "day";
let autoSteerEnabled = false;
let miniMapEnabled = true;
let devModeEnabled = false;
let paused = false;
let audioEnabled = true;

function getCameraModeConfig() {
    return cameraModes.find((mode) => mode.key === currentCameraMode) ?? cameraModes[0];
}

function resetRace() {
    racerLoadout.forEach((entry, index) => {
        racers[index] = createRacer(entry.name, entry.color, entry.x, entry.y, entry.isPlayer);
    });
    racers.forEach(alignRacerToTrack);
    raceOver = false;
    finishedCount = 0;
    itemBoxes.forEach((box) => {
        box.active = true;
        box.respawnTimer = 0;
    });
    cameraState.x = racers[0].x;
    cameraState.y = racers[0].y;
    cameraState.angle = racers[0].angle;
    raceCountdown = 0;
    raceCountdownDisplay = 0;
    raceGoTimer = 0;
    raceElapsed = 0;
    startBoostPrimed = false;
    paused = false;
    syncPauseButton();
    statusText.textContent = "Ready on the grid.";
    raceInfo.textContent = `Lap 1 / ${getLapsToWin()}`;
    syncCupUI();
}

function updateItemBoxes(dt) {
    itemBoxes.forEach((box) => {
        if (box.active) return;
        box.respawnTimer = Math.max(0, (box.respawnTimer ?? 0) - dt);
        if (box.respawnTimer <= 0) {
            box.active = true;
        }
    });
}

function startRace() {
    primeAudio();
    overlay.classList.add("hidden");
    const cup = getCupConfig();
    if (cup) {
        if (raceOver && !cupAdvancePending && currentCupRaceIndex >= cup.maps.length - 1) {
            currentCupRaceIndex = 0;
            cupPoints = createCupPoints();
        }
        if (cupAdvancePending) {
            currentCupRaceIndex = Math.min(currentCupRaceIndex + 1, cup.maps.length - 1);
        }
        applyMap(cup.maps[currentCupRaceIndex]);
        cupAdvancePending = false;
    } else {
        applyMap(currentMapKey);
    }
    resetRace();
    running = true;
    raceStartedAt = performance.now();
    lastTimestamp = raceStartedAt;
    raceCountdown = START_COUNTDOWN_SECONDS;
    raceCountdownDisplay = START_COUNTDOWN_SECONDS + 1;
    raceGoTimer = 0;
    raceElapsed = 0;
    startBoostPrimed = false;
    paused = false;
    syncPauseButton();
    statusText.textContent = `Race starts in ${START_COUNTDOWN_SECONDS}...`;
    requestAnimationFrame(loop);
}

function finishRace(message) {
    raceOver = true;
    paused = false;
    syncPauseButton();
    statusText.textContent = message;
    playFinishSound(message.startsWith("You win"));
    overlay.classList.remove("hidden");
    const cup = getCupConfig();
    if (cup) {
        awardCupPoints();
        const finalRace = currentCupRaceIndex >= cup.maps.length - 1;
        const leader = getCupRanking()[0];
        overlay.querySelector("h2").textContent = finalRace ? `${cup.label} Complete` : message;
        if (overlayDescription) {
            overlayDescription.textContent = finalRace
                ? `${leader.name} wins the ${cup.label} with ${leader.points} points.`
                : `${message}. Next track: ${maps[cup.maps[currentCupRaceIndex + 1]].label}.`;
        }
        cupAdvancePending = !finalRace;
        startButton.textContent = finalRace ? `Replay ${cup.label}` : "Next Race";
        syncCupUI();
        return;
    }
    overlay.querySelector("h2").textContent = message;
    if (overlayDescription) {
        overlayDescription.textContent = "Hit Start Race to run it back.";
    }
    startButton.textContent = "Race Again";
}

function syncDifficultyUI() {
    const difficulty = getDifficultySetting();
    if (difficultyStatus) {
        difficultyStatus.textContent = `Difficulty: ${difficulty.label}`;
    }
    difficultyButtons.forEach((button) => {
        button.classList.toggle("is-selected", button.dataset.difficulty === currentDifficulty);
    });
}

function setDifficulty(nextDifficulty) {
    if (!difficultySettings[nextDifficulty]) return;
    currentDifficulty = nextDifficulty;
    syncDifficultyUI();
    if (running && !raceOver) {
        statusText.textContent = `Difficulty set to ${getDifficultySetting().label}. Applies after restart.`;
    } else {
        resetRace();
        draw();
    }
}

function setMap(nextMapKey, preserveCup = false) {
    if (!maps[nextMapKey]) return;
    if (!preserveCup) {
        resetCupSelection();
    }
    applyMap(nextMapKey);
    resetRace();
    if (running && !raceOver) {
        statusText.textContent = `Map switched to ${maps[nextMapKey].label}.`;
    }
    startButton.textContent = "Start Race";
    if (overlayDescription && !preserveCup) {
        overlayDescription.textContent = "Hold your line, hit the boosts, and manage speed through the corners. Cross the finish gate after every checkpoint to score a lap.";
    }
    syncCupUI();
    draw();
}

function cycleMap() {
    const mapKeys = Object.keys(maps);
    const currentIndex = mapKeys.indexOf(currentMapKey);
    const nextIndex = (currentIndex + 1) % mapKeys.length;
    setMap(mapKeys[nextIndex]);
}

function randomizeMap() {
    const mapKeys = Object.keys(maps);
    const randomIndex = Math.floor(Math.random() * mapKeys.length);
    applyMap(mapKeys[randomIndex]);
}

function syncModeButton() {
    if (!modeButton) return;
    modeButton.textContent = `Mode: ${renderMode === "3d" ? "3D" : "2D Map"}`;
}

function syncThemeButton() {
    if (!themeButton) return;
    themeButton.textContent = `Theme: ${dayNightMode === "day" ? "Day" : "Night"}`;
}

function syncAutoSteerButton() {
    if (!autoSteerButton) return;
    autoSteerButton.textContent = `Auto Steer: ${autoSteerEnabled ? "On" : "Off"}`;
}

function syncMiniMapButton() {
    if (!miniMapButton) return;
    miniMapButton.textContent = `Mini Map: ${miniMapEnabled ? "On" : "Off"}`;
}

function syncDevModeButton() {
    if (!devModeButton) return;
    devModeButton.textContent = `Dev Mode: ${devModeEnabled ? "On" : "Off"}`;
}

function syncCamButton() {
    if (!camButton) return;
    camButton.textContent = `Cam: ${getCameraModeConfig().label}`;
}

function syncPauseButton() {
    if (!pauseButton) return;
    pauseButton.textContent = `Pause: ${paused ? "On" : "Off"}`;
}

function syncAudioButton() {
    if (!audioButton) return;
    audioButton.textContent = `Audio: ${audioEnabled ? "On" : "Off"}`;
}

function isFullScreenActive() {
    return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

function syncFullScreenButton() {
    if (!fullScreenButton) return;
    const shell = document.querySelector(".shell") || document.documentElement;
    const supported = Boolean(shell.requestFullscreen || shell.webkitRequestFullscreen);
    if (!supported) {
        fullScreenButton.textContent = "Full: N/A";
        return;
    }
    fullScreenButton.textContent = `Full: ${isFullScreenActive() ? "On" : "Off"}`;
}

async function toggleFullScreen() {
    const target = document.querySelector(".shell") || document.documentElement;
    const request = target.requestFullscreen?.bind(target) || target.webkitRequestFullscreen?.bind(target);
    const exit = document.exitFullscreen?.bind(document) || document.webkitExitFullscreen?.bind(document);

    if (!request || !exit) {
        statusText.textContent = "Fullscreen is not supported in this browser.";
        syncFullScreenButton();
        return;
    }

    try {
        if (!isFullScreenActive()) {
            await request();
            statusText.textContent = "Fullscreen enabled.";
        } else {
            await exit();
            statusText.textContent = "Fullscreen disabled.";
        }
    } catch {
        statusText.textContent = "Fullscreen request was blocked.";
    }

    syncFullScreenButton();
}

function toggleRenderMode() {
    renderMode = renderMode === "3d" ? "2d" : "3d";
    syncModeButton();
    draw();
}

function isDriveInputActive() {
    return hasInput("ArrowUp") || hasInput("KeyW") || mouseButtons.left;
}

function applyStartBoost() {
    const player = racers[0];
    if (!player) return;
    const difficulty = getDifficultySetting();
    player.boostTimer = Math.max(player.boostTimer, difficulty.boostTime * 0.9);
    player.speed = Math.max(player.speed, MAX_SPEED + BOOST_KICK + 10);
    player.invulnTimer = Math.max(player.invulnTimer, 0.35);
    statusText.textContent = "Rocket Start!";
    playBoostSound();
}

function toggleCameraMode() {
    if (renderMode !== "3d") {
        statusText.textContent = "Switch to 3D mode to change camera.";
        return;
    }

    const currentIndex = cameraModes.findIndex((mode) => mode.key === currentCameraMode);
    const nextIndex = (currentIndex + 1) % cameraModes.length;
    currentCameraMode = cameraModes[nextIndex].key;
    syncCamButton();
    statusText.textContent = `Camera: ${cameraModes[nextIndex].label}`;
    draw();
}

function togglePause() {
    if (!running || raceOver) {
        statusText.textContent = "Start a race to use pause.";
        return;
    }

    paused = !paused;
    syncPauseButton();
    statusText.textContent = paused ? "Paused" : "Resumed";
    playPauseSound(paused);
    draw();
}

function toggleAudio() {
    audioEnabled = !audioEnabled;
    audioState.enabled = audioEnabled;
    if (audioEnabled) {
        primeAudio();
        setMasterVolume(0.22, 0.06);
    } else {
        setMasterVolume(0.0001, 0.04);
    }
    syncAudioButton();
    statusText.textContent = `Audio ${audioEnabled ? "enabled" : "disabled"}.`;
}

function toggleDayNightMode() {
    dayNightMode = dayNightMode === "night" ? "day" : "night";
    syncThemeButton();
    draw();
}

function toggleAutoSteer() {
    autoSteerEnabled = !autoSteerEnabled;
    syncAutoSteerButton();
    statusText.textContent = `Auto steer ${autoSteerEnabled ? "enabled" : "disabled"}.`;
}

function toggleMiniMap() {
    miniMapEnabled = !miniMapEnabled;
    syncMiniMapButton();
    statusText.textContent = `Mini map ${miniMapEnabled ? "enabled" : "disabled"}.`;
    draw();
}

function toggleDevMode() {
    devModeEnabled = !devModeEnabled;
    syncDevModeButton();
    statusText.textContent = `Dev mode ${devModeEnabled ? "enabled" : "disabled"}.`;
    draw();
}

function useBoost(racer) {
    if (racer.boostCharge <= 0 || racer.boostTimer > 0) return;
    const difficulty = getDifficultySetting();
    racer.boostCharge -= 1;
    racer.boostTimer = racer.isPlayer ? difficulty.boostTime : 0.6;
    racer.speed = Math.max(racer.speed, MAX_SPEED + BOOST_KICK);
    racer.invulnTimer = Math.max(racer.invulnTimer, 0.4);
    if (racer.isPlayer) {
        playBoostSound();
    }
}

function updatePlayer(racer, dt) {
    const difficulty = getDifficultySetting();
    const accelerate = hasInput("ArrowUp") || hasInput("KeyW") || mouseButtons.left;
    const brake = hasInput("ArrowDown") || hasInput("KeyS") || mouseButtons.right;
    const left = hasInput("ArrowLeft") || hasInput("KeyA");
    const right = hasInput("ArrowRight") || hasInput("KeyD");
    const boosting = hasInput("Space");

    const manualSteer = (left ? -1 : 0) + (right ? 1 : 0);
    const mouseSteer = mouseState.active && (mouseButtons.left || mouseButtons.right) ? mouseState.steer : 0;
    let steer = clamp(manualSteer + mouseSteer * 0.92, -1, 1);
    if (autoSteerEnabled) {
        const target = checkpoints[racer.checkpointIndex % checkpoints.length];
        const targetAngle = Math.atan2(target.y - racer.y, target.x - racer.x);
        const angleDiff = wrapAngle(targetAngle - racer.angle);
        const assistedSteer = clamp(angleDiff / 0.8, -1, 1);
        const assistBlend = manualSteer === 0 ? 0.9 : 0.45;
        steer = clamp(manualSteer + assistedSteer * assistBlend, -1, 1);
    }
    const speedFactor = clamp(Math.abs(racer.speed) / 8, 0.35, 1.2);
    racer.angle += steer * 2.7 * racer.steerGrip * dt * speedFactor;

    if (accelerate) racer.speed += 200 * difficulty.playerAccel * racer.accelMultiplier * dt;
    if (brake) racer.speed -= racer.brakePower * difficulty.playerBrake * dt;

    racer.speed *= 1 - racer.coastDrag * dt;
    const playerTopSpeed = racer.boostTimer > 0
        ? MAX_SPEED + BOOST_SPEED_BONUS + racer.topSpeedBonus
        : MAX_SPEED + racer.topSpeedBonus;
    racer.speed = clamp(racer.speed, -60, playerTopSpeed);

    if (boosting) useBoost(racer);
}

function nearestWaypointIndex(racer) {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < trackPath.length; i += 1) {
        const waypoint = trackPath[i];
        const distance = dist(racer, waypoint);
        if (distance < bestDistance) {
            best = i;
            bestDistance = distance;
        }
    }
    return best;
}

function updateAI(racer, dt) {
    const difficulty = getDifficultySetting();
    const currentProgress = getNearestTrackProgress(racer);
    const targetProgress = currentProgress + racer.aiLookAhead;
    const target = getCenterlinePoint(targetProgress);
    const direction = getCenterlineDirection(targetProgress);
    const normal = { x: -direction.y, y: direction.x };
    const laneOffset = racer.aiLaneBias * Math.min(roadHalfWidth * 0.24, 18) * (difficulty.aiLaneSpread ?? 1);
    target.x += normal.x * laneOffset;
    target.y += normal.y * laneOffset;

    let avoidX = 0;
    let avoidY = 0;
    let frontTraffic = 0;
    racers.forEach((other) => {
        if (other === racer || other.finished) return;
        const offsetX = other.x - racer.x;
        const offsetY = other.y - racer.y;
        const distance = Math.hypot(offsetX, offsetY);
        if (distance <= 0.001 || distance > 84) return;

        const separation = 84 - distance;
        const weight = separation / 84;
        const toOther = { x: offsetX / distance, y: offsetY / distance };
        const avoidanceStrength = 24 * (difficulty.aiAvoidanceStrength ?? 1);
        avoidX -= toOther.x * weight * avoidanceStrength;
        avoidY -= toOther.y * weight * avoidanceStrength;

        const aheadness = offsetX * direction.x + offsetY * direction.y;
        const lateral = Math.abs(offsetX * normal.x + offsetY * normal.y);
        if (aheadness > 0 && aheadness < 52 && lateral < (difficulty.aiTrafficWidth ?? 20)) {
            frontTraffic = Math.max(frontTraffic, (52 - aheadness) / 52);
        }
    });

    target.x += avoidX;
    target.y += avoidY;
    const targetAngle = Math.atan2(target.y - racer.y, target.x - racer.x);
    const diff = wrapAngle(targetAngle - racer.angle);

    const devPaceBoost = devModeEnabled ? 10 : 0;
    const devTurnBoost = devModeEnabled ? 0.35 : 0;
    racer.angle += clamp(diff, -1.2 - devTurnBoost, 1.2 + devTurnBoost) * dt * (2.8 + devTurnBoost * 2);
    const cornerPenalty = clamp(Math.abs(diff), 0, 1.3) * 11;
    const trafficPenalty = frontTraffic * (difficulty.aiTrafficPenalty ?? 17);
    const racerScore = racer.lap * centerlinePath.length + currentProgress;
    const leaderScore = racers.reduce((best, other) => {
        if (other.finished) return best;
        const score = other.lap * centerlinePath.length + getNearestTrackProgress(other);
        return Math.max(best, score);
    }, racerScore);
    const scoreGap = Math.max(0, leaderScore - racerScore);
    const gapScale = Math.max(centerlinePath.length * 0.16, 26);
    const gapCatchUp = clamp(scoreGap / gapScale, 0, 1.35) * (difficulty.aiCatchUpBoost ?? 18);
    const placeCatchUp = Math.max(0, racer.place - 3) * (difficulty.aiPlaceCatchUp ?? 0.8);
    const leaderPenalty = racer.place === 1 ? (difficulty.aiLeaderPenalty ?? 4) : 0;
    const desiredSpeed = MAX_SPEED - 18 + racer.aiPace * 24 + difficulty.aiSpeedBonus + devPaceBoost + gapCatchUp + placeCatchUp - leaderPenalty - cornerPenalty - trafficPenalty;
    racer.speed = lerp(racer.speed, desiredSpeed, dt * 0.9);
}

function resolveRacerCollisions(dt) {
    const difficulty = getDifficultySetting();
    const startPackBoost = raceElapsed < 4 ? 1.18 : 1;
    const minDistance = 22 * startPackBoost * (difficulty.collisionSpacing ?? 1);

    for (let i = 0; i < racers.length; i += 1) {
        for (let j = i + 1; j < racers.length; j += 1) {
            const a = racers[i];
            const b = racers[j];
            if (a.finished || b.finished) continue;

            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let distance = Math.hypot(dx, dy);
            if (distance < 0.001) {
                dx = Math.sin((i + 1) * 1.7) * 0.01;
                dy = Math.cos((j + 1) * 1.4) * 0.01;
                distance = Math.hypot(dx, dy);
            }
            if (distance >= minDistance) continue;

            const overlap = minDistance - distance;
            const nx = dx / distance;
            const ny = dy / distance;
            const shift = overlap * 0.5;

            a.x -= nx * shift;
            a.y -= ny * shift;
            b.x += nx * shift;
            b.y += ny * shift;

            const impact = clamp(overlap / minDistance, 0, 1);
            const damping = 1 - (0.18 * (difficulty.collisionDamping ?? 1)) * impact * clamp(dt * 60, 0.2, 1.1);
            a.speed *= damping;
            b.speed *= damping;
        }
    }

    const worldMargin = 24;
    racers.forEach((racer) => {
        racer.x = clamp(racer.x, worldBounds.minX + worldMargin, worldBounds.maxX - worldMargin);
        racer.y = clamp(racer.y, worldBounds.minY + worldMargin, worldBounds.maxY - worldMargin);
    });
}

function updateRacer(racer, dt) {
    if (racer.finished) return;

    racer.prevX = racer.x;
    racer.prevY = racer.y;
    racer.gateLockTimer = Math.max(0, racer.gateLockTimer - dt);

    if (racer.isPlayer) {
        updatePlayer(racer, dt);
    } else {
        updateAI(racer, dt);
    }

    const boostActive = racer.boostTimer > 0;
    if (boostActive) {
        racer.boostTimer = Math.max(0, racer.boostTimer - dt);
        racer.speed = Math.max(racer.speed, MAX_SPEED + BOOST_KICK);
    }

    const offRoad = !pointInPolygon({ x: racer.x, y: racer.y }, trackPath);
    if (offRoad) {
        racer.speed *= 1 - 0.4 * dt;
        racer.speed = Math.min(racer.speed, 135);
    }

    const friction = offRoad ? 0.35 : 0.7;
    racer.speed *= 1 - friction * dt;
    const maxAllowedSpeed = boostActive ? MAX_SPEED + BOOST_SPEED_BONUS : MAX_SPEED;
    racer.speed = clamp(racer.speed, -60, maxAllowedSpeed);

    racer.x += Math.cos(racer.angle) * racer.speed * dt;
    racer.y += Math.sin(racer.angle) * racer.speed * dt;

    const worldMargin = 24;
    racer.x = clamp(racer.x, worldBounds.minX + worldMargin, worldBounds.maxX - worldMargin);
    racer.y = clamp(racer.y, worldBounds.minY + worldMargin, worldBounds.maxY - worldMargin);

    racer.speed *= 1 - 0.005 * dt;

    const checkpointIndex = racer.checkpointIndex % checkpoints.length;
    const checkpoint = checkpoints[checkpointIndex];
    const checkpointRadius = 48;
    const checkpointDistance = dist(racer, checkpoint);
    const sweptDistance = distancePointToSegment(
        checkpoint,
        { x: racer.prevX, y: racer.prevY },
        { x: racer.x, y: racer.y },
    );
    const crossedCheckpoint = Math.min(checkpointDistance, sweptDistance) < checkpointRadius;
    const cameFromWrongSide = isWrongSideOfCheckpoint({ x: racer.prevX, y: racer.prevY }, checkpointIndex);

    if (crossedCheckpoint && racer.gateLockTimer <= 0) {
        if (cameFromWrongSide) {
            if (racer.isPlayer) {
                racer.speed = Math.min(racer.speed, 18);
                racer.gateLockTimer = 0.22;
                statusText.textContent = "Use the checkpoint from the correct side.";
                playErrorSound();
            } else {
                const pushVector = normalizeVector(racer.x - checkpoint.x, racer.y - checkpoint.y);
                racer.x = checkpoint.x + pushVector.x * 56;
                racer.y = checkpoint.y + pushVector.y * 56;
                racer.speed = Math.min(racer.speed, 24);
                racer.gateLockTimer = 0.28;
            }
        } else {
            racer.checkpointIndex = (racer.checkpointIndex + 1) % checkpoints.length;
            racer.gateLockTimer = 0.18;
            if (racer.isPlayer) {
                statusText.textContent = `Checkpoint ${racer.checkpointIndex + 1} reached.`;
                playCheckpointSound();
            }
        }
    }

    const finishCross = getVerticalGateCross(
        { x: racer.prevX, y: racer.prevY },
        { x: racer.x, y: racer.y },
        startSide.x,
    );
    const isInsideFinishLane = finishCross && finishCross.y > finishLine.y1 && finishCross.y < finishLine.y2;

    if (
        racer.checkpointIndex === 0 &&
        finishCross?.direction === 1 &&
        isInsideFinishLane &&
        racer.gateLockTimer <= 0
    ) {
        racer.lap += 1;
        racer.gateLockTimer = 0.28;
        if (racer.isPlayer) {
            raceInfo.textContent = `Lap ${Math.min(racer.lap + 1, getLapsToWin())} / ${getLapsToWin()}`;
            statusText.textContent = `Lap ${racer.lap} complete.`;
            playLapSound();
        }
        if (racer.lap >= getLapsToWin()) {
            racer.finished = true;
            finishedCount += 1;
            if (racer.isPlayer) {
                finishRace("You win the circuit");
            } else if (!raceOver) {
                finishRace(`${racer.name} won the circuit`);
            }
        }
    } else if (isInsideFinishLane && racer.gateLockTimer <= 0) {
        if (racer.isPlayer) {
            racer.speed = Math.min(racer.speed, 20);
            racer.gateLockTimer = 0.25;
            statusText.textContent = "Finish gate is one-way.";
            playErrorSound();
        } else {
            const laneY = clamp(finishCross?.y ?? racer.y, finishLine.y1 + 8, finishLine.y2 - 8);
            racer.x = startSide.x + (finishCross?.direction === 1 ? -34 : 34);
            racer.y = laneY;
            racer.speed = Math.min(Math.abs(racer.speed), 20);
            racer.gateLockTimer = 0.35;
        }
    }

    const movedDistance = dist(racer, { x: racer.prevX, y: racer.prevY });
    const appearsStuck = Math.abs(racer.speed) < 8 && movedDistance < 0.45;
    racer.stuckTimer = appearsStuck ? racer.stuckTimer + dt : 0;
    if (racer.stuckTimer > 1.6) {
        if (racer.isPlayer) {
            racer.speed = Math.max(racer.speed, 16);
            racer.stuckTimer = 0;
            racer.gateLockTimer = 0.25;
            statusText.textContent = "Press forward to recover from a stuck spot.";
            playErrorSound();
        } else {
            const recoveryCheckpoint = checkpoints[racer.checkpointIndex % checkpoints.length];
            const approach = checkpointApproachVector(racer.checkpointIndex % checkpoints.length);
            const recoveryDir = normalizeVector(-approach.x, -approach.y);
            racer.x = recoveryCheckpoint.x + recoveryDir.x * 56;
            racer.y = recoveryCheckpoint.y + recoveryDir.y * 56;
            racer.angle = Math.atan2(approach.y, approach.x);
            racer.speed = 32;
            racer.gateLockTimer = 0.4;
            racer.stuckTimer = 0;
        }
    }

    itemBoxes.forEach((box) => {
        if (!box.active) return;
        if (dist(racer, box) < 24) {
            box.active = false;
            box.respawnTimer = 5;
            racer.boostCharge = 1;
            if (racer.isPlayer) {
                statusText.textContent = "Boost collected. Press Space for a burst.";
                playPickupSound();
            }
        }
    });

    if (racer.invulnTimer > 0) {
        racer.invulnTimer -= dt;
    }
}

function updatePlacements() {
    const ranking = racers
        .map((racer) => ({
            racer,
            score: racer.lap * centerlinePath.length + getNearestTrackProgress(racer),
        }))
        .sort((a, b) => b.score - a.score);

    ranking.forEach((entry, index) => {
        entry.racer.place = index + 1;
    });
}

function drawSky(camera, player) {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    const palette = getThemePalette();

    const skyGradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    skyGradient.addColorStop(0, palette.skyTop);
    skyGradient.addColorStop(0.42, palette.skyMid);
    skyGradient.addColorStop(1, palette.skyBottom);
    ctx.fillStyle = skyGradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const sunX = WIDTH * 0.74 - camera.right.x * 44;
    ctx.fillStyle = palette.sunColor;
    ctx.beginPath();
    ctx.arc(sunX, camera.horizon - 58, 34, 0, Math.PI * 2);
    ctx.fill();

    const mountainBase = camera.horizon + 34;
    ctx.fillStyle = palette.mountainColor;
    ctx.beginPath();
    ctx.moveTo(0, mountainBase + 32);
    ctx.lineTo(100, mountainBase - 16);
    ctx.lineTo(240, mountainBase + 12);
    ctx.lineTo(380, mountainBase - 52);
    ctx.lineTo(540, mountainBase + 4);
    ctx.lineTo(720, mountainBase - 34);
    ctx.lineTo(860, mountainBase + 22);
    ctx.lineTo(WIDTH, mountainBase - 10);
    ctx.lineTo(WIDTH, HEIGHT);
    ctx.lineTo(0, HEIGHT);
    ctx.closePath();
    ctx.fill();

    const grassGradient = ctx.createLinearGradient(0, camera.horizon, 0, HEIGHT);
    grassGradient.addColorStop(0, palette.grassTop);
    grassGradient.addColorStop(1, palette.grassBottom);
    ctx.fillStyle = grassGradient;
    ctx.fillRect(0, camera.horizon, WIDTH, HEIGHT - camera.horizon);

    ctx.fillStyle = "rgba(255,255,255,0.05)";
    for (let stripe = 0; stripe < 14; stripe += 1) {
        const y = lerp(camera.horizon, HEIGHT, stripe / 13);
        const alpha = inverseLerp(camera.horizon, HEIGHT, y) * 0.12;
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.fillRect(0, y, WIDTH, 2);
    }

    const haze = ctx.createLinearGradient(0, camera.horizon - 18, 0, camera.horizon + 160);
    haze.addColorStop(0, palette.hazeTop);
    haze.addColorStop(1, palette.hazeBottom);
    ctx.fillStyle = haze;
    ctx.fillRect(0, camera.horizon - 18, WIDTH, 178);
}

function drawRoad(player, camera) {
    const palette = getThemePalette();
    const sampleCount = 70;
    const drawDistance = 9;
    const startProgress = getNearestTrackProgress(player) + 0.12;
    const samples = [];

    for (let index = 0; index <= sampleCount; index += 1) {
        const progress = startProgress + (index / sampleCount) * drawDistance;
        const center = getCenterlinePoint(progress);
        const direction = getCenterlineDirection(progress);
        const normal = { x: -direction.y, y: direction.x };
        const leftShoulder = projectWorldPoint(
            center.x - normal.x * shoulderHalfWidth,
            center.y - normal.y * shoulderHalfWidth,
            0,
            camera,
        );
        const leftRoad = projectWorldPoint(
            center.x - normal.x * roadHalfWidth,
            center.y - normal.y * roadHalfWidth,
            0,
            camera,
        );
        const rightRoad = projectWorldPoint(
            center.x + normal.x * roadHalfWidth,
            center.y + normal.y * roadHalfWidth,
            0,
            camera,
        );
        const rightShoulder = projectWorldPoint(
            center.x + normal.x * shoulderHalfWidth,
            center.y + normal.y * shoulderHalfWidth,
            0,
            camera,
        );

        if (leftShoulder && leftRoad && rightRoad && rightShoulder) {
            samples.push({
                progress,
                leftShoulder,
                leftRoad,
                rightRoad,
                rightShoulder,
            });
        }
    }

    for (let index = samples.length - 1; index > 0; index -= 1) {
        const far = samples[index];
        const near = samples[index - 1];
        const stripe = index % 2 === 0;
        const distanceFade = clamp((index - 6) / samples.length, 0, 1);

        drawQuad([
            near.leftShoulder,
            far.leftShoulder,
            far.rightShoulder,
            near.rightShoulder,
        ], stripe ? palette.shoulderA : palette.shoulderB);

        drawQuad([
            near.leftRoad,
            far.leftRoad,
            far.rightRoad,
            near.rightRoad,
        ], stripe ? palette.roadA : palette.roadB);

        drawQuad([
            near.leftShoulder,
            far.leftShoulder,
            far.leftRoad,
            near.leftRoad,
        ], stripe ? palette.curbA : palette.curbB);

        drawQuad([
            near.rightRoad,
            far.rightRoad,
            far.rightShoulder,
            near.rightShoulder,
        ], stripe ? palette.curbB : palette.curbA);

        if (distanceFade > 0) {
            drawQuad([
                near.leftShoulder,
                far.leftShoulder,
                far.rightShoulder,
                near.rightShoulder,
            ], palette.farFog.replace("__ALPHA__", `${0.16 * distanceFade}`));
        }

        if (index % 5 === 0) {
            const laneNearLeft = {
                x: lerp(near.leftRoad.x, near.rightRoad.x, 0.48),
                y: lerp(near.leftRoad.y, near.rightRoad.y, 0.48),
            };
            const laneNearRight = {
                x: lerp(near.leftRoad.x, near.rightRoad.x, 0.52),
                y: lerp(near.leftRoad.y, near.rightRoad.y, 0.52),
            };
            const laneFarLeft = {
                x: lerp(far.leftRoad.x, far.rightRoad.x, 0.48),
                y: lerp(far.leftRoad.y, far.rightRoad.y, 0.48),
            };
            const laneFarRight = {
                x: lerp(far.leftRoad.x, far.rightRoad.x, 0.52),
                y: lerp(far.leftRoad.y, far.rightRoad.y, 0.52),
            };
            drawQuad([laneNearLeft, laneFarLeft, laneFarRight, laneNearRight], palette.lane);
        }
    }

    const gateLeft = projectWorldPoint(finishLine.x1, finishLine.y1, 0, camera);
    const gateRight = projectWorldPoint(finishLine.x2, finishLine.y2, 0, camera);
    if (gateLeft && gateRight) {
        ctx.strokeStyle = palette.finish;
        ctx.lineWidth = Math.max(2, 16 / Math.min(gateLeft.depth, gateRight.depth));
        ctx.beginPath();
        ctx.moveTo(gateLeft.x, gateLeft.y);
        ctx.lineTo(gateRight.x, gateRight.y);
        ctx.stroke();
    }
}

function drawCheckpointMarker(player, camera) {
    const checkpoint = checkpoints[player.checkpointIndex % checkpoints.length];
    const base = projectWorldPoint(checkpoint.x, checkpoint.y, 0, camera);
    const top = projectWorldPoint(checkpoint.x, checkpoint.y, 44, camera);
    if (!base || !top) return;

    const arrowHeight = Math.max(20, (base.y - top.y) * 1.4);
    const arrowWidth = arrowHeight * 0.6;
    const arrowX = base.x;
    const arrowY = top.y - arrowHeight * 0.2;

    ctx.save();
    ctx.translate(arrowX, arrowY);

    ctx.fillStyle = "rgba(255, 209, 102, 0.95)";
    ctx.strokeStyle = "rgba(255, 230, 150, 0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -arrowHeight * 0.5);
    ctx.lineTo(-arrowWidth * 0.5, arrowHeight * 0.3);
    ctx.lineTo(-arrowWidth * 0.15, arrowHeight * 0.3);
    ctx.lineTo(-arrowWidth * 0.15, arrowHeight * 0.5);
    ctx.lineTo(arrowWidth * 0.15, arrowHeight * 0.5);
    ctx.lineTo(arrowWidth * 0.15, arrowHeight * 0.3);
    ctx.lineTo(arrowWidth * 0.5, arrowHeight * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
}

function drawPlayerHeadlights(camera) {
    if (dayNightMode !== "night") return;

    const beamLeftNear = { x: CENTER.x - 56, y: HEIGHT - 18 };
    const beamRightNear = { x: CENTER.x + 56, y: HEIGHT - 18 };
    const beamLeftFar = { x: CENTER.x - 170, y: camera.horizon + 78 };
    const beamRightFar = { x: CENTER.x + 170, y: camera.horizon + 78 };

    const beamGradient = ctx.createLinearGradient(CENTER.x, HEIGHT - 18, CENTER.x, camera.horizon + 78);
    beamGradient.addColorStop(0, "rgba(255, 233, 168, 0.34)");
    beamGradient.addColorStop(1, "rgba(255, 233, 168, 0)");
    drawQuad([beamLeftNear, beamLeftFar, beamRightFar, beamRightNear], beamGradient);

    const coreGlow = ctx.createRadialGradient(CENTER.x, HEIGHT - 22, 10, CENTER.x, HEIGHT - 22, 130);
    coreGlow.addColorStop(0, "rgba(255, 238, 176, 0.32)");
    coreGlow.addColorStop(1, "rgba(255, 238, 176, 0)");
    ctx.fillStyle = coreGlow;
    ctx.beginPath();
    ctx.ellipse(CENTER.x, HEIGHT - 22, 148, 52, 0, 0, Math.PI * 2);
    ctx.fill();
}

function drawBillboard(sprite) {
    ctx.save();
    ctx.globalAlpha = sprite.alpha ?? 1;
    ctx.translate(sprite.x, sprite.y);

    if (sprite.shadowWidth) {
        ctx.fillStyle = "rgba(0,0,0,0.24)";
        ctx.beginPath();
        ctx.ellipse(0, 4, sprite.shadowWidth, sprite.shadowHeight, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    sprite.draw();
    ctx.restore();
}

function drawWorldObjects(player, camera) {
    const sprites = [];
    const maxBotDrawDepth = currentCameraMode === "outside" ? 720 : 780;

    racers.forEach((racer) => {
        if (racer.isPlayer) return;
        const projection = projectBotSprite(racer, camera);
        if (!projection) return;
        const { base, top, depth, rearBias } = projection;
        if (depth > maxBotDrawDepth) return;
        if (base.x < -220 || base.x > WIDTH + 220 || base.y < -180 || base.y > HEIGHT + 220) return;
        const farFade = clamp(inverseLerp(340, maxBotDrawDepth, depth), 0, 1);
        const height = Math.max(16, (base.y - top.y) * 1.18);
        const width = height * 0.78;
        sprites.push({
            depth,
            x: base.x,
            y: top.y,
            alpha: (1 - farFade * 0.58) * (1 - rearBias * 0.38),
            shadowWidth: width * 0.38,
            shadowHeight: height * 0.1,
            draw: () => {
                ctx.fillStyle = racer.color;
                fillRoundedRect(-width * 0.54, height * 0.04, width * 1.08, height * 0.34, 8);
                ctx.fillStyle = "rgba(255,255,255,0.22)";
                fillRoundedRect(-width * 0.1, height * 0.02, width * 0.48, height * 0.1, 5);
                ctx.fillStyle = "#0c1220";
                fillRoundedRect(-width * 0.2, -height * 0.02, width * 0.4, height * 0.54, 6);
                fillRoundedRect(-width * 0.34, height * 0.14, width * 0.68, height * 0.16, 6);
                ctx.fillStyle = "#07101a";
                fillRoundedRect(-width * 0.52, height * 0.08, width * 0.16, height * 0.26, 4);
                fillRoundedRect(width * 0.36, height * 0.08, width * 0.16, height * 0.26, 4);
                ctx.fillStyle = "rgba(255, 209, 102, 0.92)";
                ctx.fillRect(-width * 0.03, height * 0.04, width * 0.06, height * 0.32);
                ctx.fillStyle = "rgba(255,255,255,0.9)";
                fillRoundedRect(width * 0.14, height * 0.14, width * 0.18, height * 0.07, 3);
                fillRoundedRect(width * 0.14, height * 0.26, width * 0.18, height * 0.07, 3);
                if (dayNightMode === "night") {
                    ctx.fillStyle = "rgba(255, 236, 168, 0.95)";
                    fillRoundedRect(width * 0.3, height * 0.14, width * 0.14, height * 0.07, 3);
                    fillRoundedRect(width * 0.3, height * 0.26, width * 0.14, height * 0.07, 3);
                    ctx.fillStyle = "rgba(255, 236, 168, 0.22)";
                    ctx.beginPath();
                    ctx.ellipse(width * 0.58, height * 0.22, width * 0.36, height * 0.14, 0, 0, Math.PI * 2);
                    ctx.fill();
                }
                if (racer.boostTimer > 0) {
                    ctx.fillStyle = "rgba(83, 224, 255, 0.4)";
                    ctx.beginPath();
                    ctx.ellipse(-width * 0.6, height * 0.2, width * 0.18, height * 0.08, 0, 0, Math.PI * 2);
                    ctx.fill();
                }
            },
        });
    });

    itemBoxes.forEach((box) => {
        if (!box.active) return;
        const base = projectWorldPoint(box.x, box.y, 0, camera);
        const top = projectWorldPoint(box.x, box.y, 22, camera);
        if (!base || !top) return;
        const size = Math.max(12, base.y - top.y);
        sprites.push({
            depth: base.depth,
            x: base.x,
            y: top.y,
            shadowWidth: size * 0.28,
            shadowHeight: size * 0.08,
            alpha: 0.98,
            draw: () => {
                ctx.rotate(Math.PI / 4);
                ctx.fillStyle = "#53e0ff";
                ctx.shadowColor = "#53e0ff";
                ctx.shadowBlur = 16;
                ctx.fillRect(-size * 0.34, -size * 0.34, size * 0.68, size * 0.68);
                ctx.shadowBlur = 0;
                ctx.fillStyle = "#09101c";
                ctx.fillRect(-size * 0.1, -size * 0.36, size * 0.2, size * 0.72);
                ctx.fillRect(-size * 0.36, -size * 0.1, size * 0.72, size * 0.2);
            },
        });
    });

    sprites
        .sort((a, b) => b.depth - a.depth)
        .forEach(drawBillboard);
}

function drawCockpit(player) {
    ctx.save();
    ctx.translate(CENTER.x, HEIGHT - 28);

    const glow = ctx.createRadialGradient(0, 0, 10, 0, 0, 122);
    glow.addColorStop(0, "rgba(83, 224, 255, 0.22)");
    glow.addColorStop(1, "rgba(83, 224, 255, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(0, 0, 132, 66, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#10192d";
    ctx.beginPath();
    ctx.moveTo(-120, 48);
    ctx.quadraticCurveTo(-80, -14, 0, -8);
    ctx.quadraticCurveTo(80, -14, 120, 48);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.moveTo(-82, 44);
    ctx.quadraticCurveTo(-46, 2, 0, 10);
    ctx.quadraticCurveTo(46, 2, 82, 44);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.moveTo(-32, 22);
    ctx.quadraticCurveTo(-14, 6, 0, 8);
    ctx.quadraticCurveTo(14, 6, 32, 22);
    ctx.lineTo(24, 28);
    ctx.quadraticCurveTo(0, 16, -24, 28);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(255, 209, 102, 0.96)";
    fillRoundedRect(-5, 10, 10, 32, 4);
    ctx.fillStyle = "#0b1322";
    fillRoundedRect(-50, 22, 14, 18, 5);
    fillRoundedRect(36, 22, 14, 18, 5);

    ctx.fillStyle = "#0a1020";
    fillRoundedRect(-10, 8, 20, 38, 5);
    fillRoundedRect(-34, 22, 68, 12, 5);

    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 34, 22, Math.PI * 0.1, Math.PI * 0.9);
    ctx.stroke();

    if (player.boostTimer > 0) {
        ctx.fillStyle = "rgba(83, 224, 255, 0.36)";
        ctx.beginPath();
        ctx.ellipse(-82, 38, 24, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(82, 38, 24, 9, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    if (dayNightMode === "night") {
        const lampGlow = ctx.createRadialGradient(0, 0, 6, 0, 0, 36);
        lampGlow.addColorStop(0, "rgba(255, 235, 166, 0.9)");
        lampGlow.addColorStop(1, "rgba(255, 235, 166, 0)");
        ctx.fillStyle = lampGlow;
        ctx.beginPath();
        ctx.ellipse(-64, 44, 24, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(64, 44, 24, 10, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "rgba(255, 238, 170, 0.95)";
        ctx.beginPath();
        ctx.ellipse(-64, 44, 6, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(64, 44, 6, 3, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

function drawTrack2D() {
    const transform = getMapTransform();
    const palette = getThemePalette();
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    const backgroundGradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    backgroundGradient.addColorStop(0, palette.mapBgTop);
    backgroundGradient.addColorStop(1, palette.mapBgBottom);
    ctx.fillStyle = backgroundGradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = palette.mapGrass;
    ctx.beginPath();
    trackPath.forEach((point, index) => {
        const mapped = projectToMap(point, transform);
        if (index === 0) {
            ctx.moveTo(mapped.x, mapped.y);
        } else {
            ctx.lineTo(mapped.x, mapped.y);
        }
    });
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.strokeStyle = "#2c334b";
    ctx.lineWidth = shoulderHalfWidth * 0.92 * transform.scale;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    checkpoints.forEach((point, index) => {
        const mapped = projectToMap(point, transform);
        if (index === 0) {
            ctx.moveTo(mapped.x, mapped.y);
        } else {
            ctx.lineTo(mapped.x, mapped.y);
        }
    });
    const firstCheckpoint = projectToMap(checkpoints[0], transform);
    ctx.lineTo(firstCheckpoint.x, firstCheckpoint.y);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 8 * transform.scale;
    ctx.setLineDash([18 * transform.scale, 18 * transform.scale]);
    ctx.beginPath();
    checkpoints.forEach((point, index) => {
        const mapped = projectToMap(point, transform);
        if (index === 0) {
            ctx.moveTo(mapped.x, mapped.y);
        } else {
            ctx.lineTo(mapped.x, mapped.y);
        }
    });
    ctx.lineTo(firstCheckpoint.x, firstCheckpoint.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    const finishTop = projectToMap({ x: finishLine.x1, y: finishLine.y1 }, transform);
    const finishBottom = projectToMap({ x: finishLine.x2, y: finishLine.y2 }, transform);
    ctx.strokeStyle = "#f7f3d2";
    ctx.lineWidth = 14 * transform.scale;
    ctx.beginPath();
    ctx.moveTo(finishTop.x, finishTop.y);
    ctx.lineTo(finishBottom.x, finishBottom.y);
    ctx.stroke();

    itemBoxes.forEach((box) => {
        if (!box.active) return;
        const mapped = projectToMap(box, transform);
        const size = 18 * transform.scale;
        ctx.save();
        ctx.translate(mapped.x, mapped.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = "#53e0ff";
        ctx.shadowColor = "#53e0ff";
        ctx.shadowBlur = 12;
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.restore();
    });

    const activeCheckpoint = checkpoints[racers[0].checkpointIndex % checkpoints.length];
    const checkpointMarker = projectToMap(activeCheckpoint, transform);
    ctx.strokeStyle = "rgba(255, 209, 102, 0.92)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(checkpointMarker.x, checkpointMarker.y, 24, 0, Math.PI * 2);
    ctx.stroke();

    if (dayNightMode === "night") {
        racers.forEach((racer) => {
            const mapped = projectToMap(racer, transform);
            const heading = { x: Math.cos(racer.angle), y: Math.sin(racer.angle) };
            const normal = { x: -heading.y, y: heading.x };
            const front = {
                x: mapped.x + heading.x * 12,
                y: mapped.y + heading.y * 12,
            };
            const leftFar = {
                x: front.x + heading.x * 62 + normal.x * 22,
                y: front.y + heading.y * 62 + normal.y * 22,
            };
            const rightFar = {
                x: front.x + heading.x * 62 - normal.x * 22,
                y: front.y + heading.y * 62 - normal.y * 22,
            };

            const beamGradient = ctx.createLinearGradient(front.x, front.y, leftFar.x, leftFar.y);
            beamGradient.addColorStop(0, "rgba(255, 236, 170, 0.24)");
            beamGradient.addColorStop(1, "rgba(255, 236, 170, 0)");
            ctx.fillStyle = beamGradient;
            ctx.beginPath();
            ctx.moveTo(front.x, front.y);
            ctx.lineTo(leftFar.x, leftFar.y);
            ctx.lineTo(rightFar.x, rightFar.y);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = "rgba(255, 238, 176, 0.9)";
            ctx.beginPath();
            ctx.arc(front.x + normal.x * 3, front.y + normal.y * 3, 2.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(front.x - normal.x * 3, front.y - normal.y * 3, 2.4, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    racers.slice().sort((a, b) => a.place - b.place).reverse().forEach((racer) => {
        const mapped = projectToMap(racer, transform);
        ctx.save();
        ctx.translate(mapped.x, mapped.y);
        ctx.rotate(racer.angle);
        ctx.fillStyle = racer.color;
        fillRoundedRect(-17, -9, 34, 18, 7);
        ctx.fillStyle = "rgba(255,255,255,0.2)";
        fillRoundedRect(-6, -8, 12, 5, 3);
        ctx.fillStyle = "#09101c";
        fillRoundedRect(-4, -11, 8, 22, 4);
        fillRoundedRect(-10, -4, 20, 8, 4);
        ctx.fillStyle = racer.isPlayer ? "#ffd166" : "rgba(255,255,255,0.78)";
        ctx.fillRect(-2, -8, 4, 16);
        ctx.restore();
    });

    ctx.fillStyle = "rgba(4, 8, 16, 0.62)";
    ctx.fillRect(WIDTH - 186, HEIGHT - 82, 158, 48);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.strokeRect(WIDTH - 185.5, HEIGHT - 81.5, 157, 47);
    ctx.fillStyle = "#f2f5ff";
    ctx.font = "700 16px Space Grotesk";
    ctx.fillText("2D Tactical Map", WIDTH - 168, HEIGHT - 52);
    ctx.fillStyle = "#9ea8cf";
    ctx.font = "500 13px Space Grotesk";
    ctx.fillText("Press M/N for view & theme", WIDTH - 178, HEIGHT - 32);
}

function getMiniMapTransform(panelX, panelY, panelWidth, panelHeight) {
    const padding = 10;
    const worldWidth = worldBounds.maxX - worldBounds.minX;
    const worldHeight = worldBounds.maxY - worldBounds.minY;
    const scale = Math.min(
        (panelWidth - padding * 2) / (worldWidth || 1),
        (panelHeight - padding * 2) / (worldHeight || 1),
    );
    const offsetX = panelX + (panelWidth - worldWidth * scale) / 2 - worldBounds.minX * scale;
    const offsetY = panelY + (panelHeight - worldHeight * scale) / 2 - worldBounds.minY * scale;
    return { scale, offsetX, offsetY };
}

function drawMiniMap3D() {
    const panelWidth = 192;
    const panelHeight = 144;
    const panelX = WIDTH - panelWidth - 14;
    const panelY = 76;
    const transform = getMiniMapTransform(panelX, panelY, panelWidth, panelHeight);
    const player = racers[0];

    ctx.save();
    ctx.fillStyle = "rgba(5, 10, 20, 0.68)";
    ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.strokeRect(panelX + 0.5, panelY + 0.5, panelWidth - 1, panelHeight - 1);
    ctx.beginPath();
    ctx.rect(panelX + 2, panelY + 2, panelWidth - 4, panelHeight - 4);
    ctx.clip();

    ctx.strokeStyle = "#2f3a55";
    ctx.lineWidth = Math.max(2, shoulderHalfWidth * 0.72 * transform.scale);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    checkpoints.forEach((point, index) => {
        const mapped = projectToMap(point, transform);
        if (index === 0) {
            ctx.moveTo(mapped.x, mapped.y);
        } else {
            ctx.lineTo(mapped.x, mapped.y);
        }
    });
    const firstCheckpoint = projectToMap(checkpoints[0], transform);
    ctx.lineTo(firstCheckpoint.x, firstCheckpoint.y);
    ctx.stroke();

    const finishTop = projectToMap({ x: finishLine.x1, y: finishLine.y1 }, transform);
    const finishBottom = projectToMap({ x: finishLine.x2, y: finishLine.y2 }, transform);
    ctx.strokeStyle = "rgba(247, 243, 210, 0.95)";
    ctx.lineWidth = Math.max(2, 10 * transform.scale);
    ctx.beginPath();
    ctx.moveTo(finishTop.x, finishTop.y);
    ctx.lineTo(finishBottom.x, finishBottom.y);
    ctx.stroke();

    itemBoxes.forEach((box) => {
        if (!box.active) return;
        const mapped = projectToMap(box, transform);
        const size = Math.max(4, 12 * transform.scale);
        ctx.save();
        ctx.translate(mapped.x, mapped.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = "#53e0ff";
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.restore();
    });

    racers.slice().sort((a, b) => a.place - b.place).forEach((racer) => {
        const mapped = projectToMap(racer, transform);
        const radius = racer.isPlayer ? Math.max(4, 6 * transform.scale) : Math.max(3, 5 * transform.scale);
        ctx.fillStyle = racer.color;
        ctx.beginPath();
        ctx.arc(mapped.x, mapped.y, radius, 0, Math.PI * 2);
        ctx.fill();

        if (racer.isPlayer) {
            const heading = { x: Math.cos(racer.angle), y: Math.sin(racer.angle) };
            ctx.strokeStyle = "rgba(255,255,255,0.9)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(mapped.x, mapped.y);
            ctx.lineTo(mapped.x + heading.x * 12, mapped.y + heading.y * 12);
            ctx.stroke();
        }
    });

    const activeCheckpoint = checkpoints[player.checkpointIndex % checkpoints.length];
    const marker = projectToMap(activeCheckpoint, transform);
    ctx.strokeStyle = "rgba(255, 209, 102, 0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, Math.max(6, 10 * transform.scale), 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();

    ctx.fillStyle = "rgba(242,245,255,0.92)";
    ctx.font = "700 12px Space Grotesk";
    ctx.fillText("Mini Map", panelX + 10, panelY + 16);
}

function drawHUD() {
    const player = racers[0];
    ctx.fillStyle = "rgba(4, 6, 12, 0.55)";
    ctx.fillRect(18, 18, 190, 92);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.strokeRect(18.5, 18.5, 189, 91);

    ctx.fillStyle = "#f2f5ff";
    ctx.font = "700 16px Space Grotesk";
    ctx.fillText(`Place: ${player.place}/${racers.length}`, 32, 44);
    ctx.fillText(`Lap: ${Math.min(player.lap + 1, getLapsToWin())}/${getLapsToWin()}`, 32, 68);
    ctx.fillText(`Boost: ${player.boostCharge > 0 ? "Ready" : "Collect a pad"}`, 32, 92);

    const speedMeter = Math.min((Math.abs(player.speed) / MAX_SPEED) * 100, 100);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(WIDTH - 206, 26, 174, 18);
    ctx.fillStyle = "#53e0ff";
    ctx.fillRect(WIDTH - 206, 26, speedMeter + 6, 18);
    ctx.fillStyle = "#f2f5ff";
    ctx.font = "600 14px Space Grotesk";
    ctx.fillText(`Speed ${Math.round(player.speed)}`, WIDTH - 206, 62);

    ctx.fillStyle = gamepadConnected ? "#9bff8f" : "#9ea8cf";
    ctx.font = "600 12px Space Grotesk";
    ctx.fillText(`Pad: ${gamepadLabel}`, WIDTH - 206, 82);

    if (devModeEnabled) {
        ctx.fillStyle = "rgba(4, 6, 12, 0.7)";
        ctx.fillRect(18, 118, 190, 92);
        ctx.strokeStyle = "rgba(83,224,255,0.22)";
        ctx.strokeRect(18.5, 118.5, 189, 91);
        ctx.fillStyle = "#f2f5ff";
        ctx.font = "700 13px Space Grotesk";
        ctx.fillText("DEV MODE", 32, 140);
        ctx.font = "500 12px Space Grotesk";
        ctx.fillText(`Map: ${maps[currentMapKey]?.label ?? currentMapKey}`, 32, 160);
        ctx.fillText(`Checkpoint: ${player.checkpointIndex + 1}/${checkpoints.length}`, 32, 178);
        ctx.fillText(`Lap: ${player.lap}/${getLapsToWin()}`, 32, 196);
        ctx.fillText(`Bots: ${racers.length - 1}`, 32, 214);
    }
}

function drawRaceStartCountdown() {
    if (raceCountdown <= 0 && raceGoTimer <= 0) return;

    const isGo = raceCountdown <= 0;
    const label = isGo ? "GO!" : `${Math.ceil(raceCountdown)}`;
    const alpha = isGo ? clamp(raceGoTimer / 0.62, 0, 1) : 1;

    ctx.save();
    ctx.globalAlpha = alpha;

    const glowRadius = isGo ? 180 : 132;
    const glow = ctx.createRadialGradient(CENTER.x, HEIGHT * 0.34, 20, CENTER.x, HEIGHT * 0.34, glowRadius);
    glow.addColorStop(0, isGo ? "rgba(83, 224, 255, 0.34)" : "rgba(255, 209, 102, 0.3)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(CENTER.x, HEIGHT * 0.34, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = `700 ${isGo ? 140 : 128}px Oswald`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 10;
    ctx.strokeStyle = "rgba(6, 10, 24, 0.72)";
    ctx.strokeText(label, CENTER.x, HEIGHT * 0.34);
    ctx.fillStyle = isGo ? "#53e0ff" : "#ffd166";
    ctx.fillText(label, CENTER.x, HEIGHT * 0.34);
    ctx.restore();
}

function drawPausedOverlay() {
    if (!paused) return;

    ctx.save();
    ctx.fillStyle = "rgba(6, 9, 18, 0.42)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 76px Oswald";
    ctx.lineWidth = 8;
    ctx.strokeStyle = "rgba(7, 10, 20, 0.8)";
    ctx.strokeText("PAUSED", CENTER.x, HEIGHT * 0.42);
    ctx.fillStyle = "#f2f5ff";
    ctx.fillText("PAUSED", CENTER.x, HEIGHT * 0.42);

    ctx.font = "600 22px Space Grotesk";
    ctx.fillStyle = "rgba(242,245,255,0.92)";
    ctx.fillText("Press P or Pause button to resume", CENTER.x, HEIGHT * 0.5);
    ctx.restore();
}

function draw() {
    const player = racers[0];
    if (renderMode === "2d") {
        drawTrack2D();
    } else {
        const camera = createCamera(player);
        drawSky(camera, player);
        drawRoad(player, camera);
        drawCheckpointMarker(player, camera);
        drawPlayerHeadlights(camera);
        drawWorldObjects(player, camera);
        if (camera.showCockpit) {
            drawCockpit(player);
        }
        if (miniMapEnabled) {
            drawMiniMap3D();
        }
    }
    drawRaceStartCountdown();
    drawPausedOverlay();
    drawHUD();
}

function update(dt) {
    updateGamepadInput();
    if (!running || raceOver) return;
    if (paused) return;

    if (raceCountdown > 0) {
        const driving = isDriveInputActive();
        if (driving && Math.ceil(raceCountdown) === 2) {
            startBoostPrimed = true;
        }
        raceCountdown = Math.max(0, raceCountdown - dt);
        const nextDisplay = Math.ceil(raceCountdown);
        if (nextDisplay > 0 && nextDisplay !== raceCountdownDisplay) {
            raceCountdownDisplay = nextDisplay;
            statusText.textContent = `Race starts in ${nextDisplay}...`;
            playCountdownTickSound();
        }
        if (raceCountdown === 0) {
            raceGoTimer = 0.62;
            statusText.textContent = "GO!";
            if (startBoostPrimed) {
                applyStartBoost();
            }
            playGoSound();
        }
        return;
    }

    if (raceGoTimer > 0) {
        raceGoTimer = Math.max(0, raceGoTimer - dt);
    }

    raceElapsed += dt;

    racers.forEach((racer) => updateRacer(racer, dt));
    resolveRacerCollisions(dt);
    updateItemBoxes(dt);
    updatePlacements();

    const player = racers[0];
    if (!raceOver) {
        const leader = racers.reduce((best, racer) => (racer.place < best.place ? racer : best), racers[0]);
        statusText.textContent = `P${player.place} | Leader: ${leader.name}`;
    }
}

function loop(timestamp) {
    if (!running) return;
    const delta = Math.min((timestamp - lastTimestamp) / 1000, 0.033);
    lastTimestamp = timestamp;
    update(delta);
    syncEngineAudio();
    draw();
    requestAnimationFrame(loop);
}

function setVirtualKey(key, pressed) {
    if (pressed) {
        keys.add(key);
    } else {
        keys.delete(key);
    }
}

function bindTouchButton(button) {
    const key = button.dataset.key;
    if (!key) return;

    const press = (event) => {
        event.preventDefault();
        button.classList.add("is-pressed");
        setVirtualKey(key, true);
    };

    const release = (event) => {
        event.preventDefault();
        button.classList.remove("is-pressed");
        setVirtualKey(key, false);
    };

    button.addEventListener("pointerdown", press);
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("pointerleave", release);

    // Fallback for older iOS Safari where pointer events can be inconsistent.
    button.addEventListener("touchstart", press, { passive: false });
    button.addEventListener("touchend", release, { passive: false });
    button.addEventListener("touchcancel", release, { passive: false });
}

function bindDifficultyButton(button) {
    const difficulty = button.dataset.difficulty;
    if (!difficulty) return;
    button.addEventListener("click", () => {
        setDifficulty(difficulty);
    });
}

function bindMapButton(button) {
    const mapKey = button.dataset.map;
    if (!mapKey) return;
    button.addEventListener("click", () => {
        setMap(mapKey);
    });
}

function bindCupButton(button) {
    const cupKey = button.dataset.cup;
    if (!cupKey) return;
    button.addEventListener("click", () => {
        if (cupKey === "free") {
            setCup("");
            return;
        }
        setCup(cupKey);
    });
}

window.addEventListener("keydown", (event) => {
    primeAudio();
    keys.add(event.code);
    if (event.code === "Space") {
        event.preventDefault();
    }
    if (event.code === "KeyN") {
        toggleDayNightMode();
    }
    if (event.code === "KeyT") {
        toggleAutoSteer();
    }
    if (event.code === "KeyH") {
        toggleMiniMap();
    }
    if (event.code === "KeyV") {
        toggleDevMode();
    }
    if (event.code === "KeyM") {
        toggleRenderMode();
    }
    if (event.code === "KeyC") {
        toggleCameraMode();
    }
    if (event.code === "KeyO") {
        toggleAudio();
    }
    if (event.code === "KeyF") {
        event.preventDefault();
        toggleFullScreen();
    }
    if (event.code === "KeyP") {
        togglePause();
    }
    if (event.code === "KeyB") {
        cycleMap();
    }
    if (event.code === "KeyR") {
        startRace();
    }
});

window.addEventListener("keyup", (event) => {
    keys.delete(event.code);
});

window.addEventListener("blur", () => {
    keys.clear();
    clearMouseInput();
    touchButtons.forEach((button) => {
        button.classList.remove("is-pressed");
    });
});

window.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        keys.clear();
        clearMouseInput();
        touchButtons.forEach((button) => {
            button.classList.remove("is-pressed");
        });
    }
});

canvas.addEventListener("mousemove", (event) => {
    updateMouseSteer(event);
});

canvas.addEventListener("mouseenter", (event) => {
    updateMouseSteer(event);
});

canvas.addEventListener("mouseleave", () => {
    clearMouseInput();
});

canvas.addEventListener("mousedown", (event) => {
    primeAudio();
    updateMouseSteer(event);
    if (event.button === 0) {
        mouseButtons.left = true;
    }
    if (event.button === 2) {
        mouseButtons.right = true;
    }
});

canvas.addEventListener("mouseup", (event) => {
    if (event.button === 0) {
        mouseButtons.left = false;
    }
    if (event.button === 2) {
        mouseButtons.right = false;
    }
});

window.addEventListener("mouseup", (event) => {
    if (event.button === 0) {
        mouseButtons.left = false;
    }
    if (event.button === 2) {
        mouseButtons.right = false;
    }
});

canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
});

touchButtons.forEach(bindTouchButton);
difficultyButtons.forEach(bindDifficultyButton);
cupButtons.forEach(bindCupButton);
mapButtons.forEach(bindMapButton);
cupButtons.forEach((button) => {
    const color = button.dataset.color;
    if (color) {
        button.style.setProperty("--map-color", color);
    }
});
mapButtons.forEach((button) => {
    const color = button.dataset.color;
    if (color) {
        button.style.setProperty("--map-color", color);
    }
});

startButton.addEventListener("click", startRace);
mapButton?.addEventListener("click", cycleMap);
autoSteerButton?.addEventListener("click", toggleAutoSteer);
miniMapButton?.addEventListener("click", toggleMiniMap);
devModeButton?.addEventListener("click", toggleDevMode);
themeButton?.addEventListener("click", toggleDayNightMode);
modeButton?.addEventListener("click", toggleRenderMode);
camButton?.addEventListener("click", toggleCameraMode);
audioButton?.addEventListener("click", toggleAudio);
fullScreenButton?.addEventListener("click", toggleFullScreen);
pauseButton?.addEventListener("click", togglePause);

document.addEventListener("fullscreenchange", syncFullScreenButton);
document.addEventListener("webkitfullscreenchange", syncFullScreenButton);

applyMap(currentMapKey);
resetRace();
syncDifficultyUI();
syncThemeButton();
syncModeButton();
syncMapUI();
syncAutoSteerButton();
syncMiniMapButton();
syncDevModeButton();
syncCamButton();
syncCupUI();
syncAudioButton();
syncFullScreenButton();
syncPauseButton();
draw();
