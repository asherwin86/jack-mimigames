const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
// See js/profiles.js for why a configured Server address override also
// counts as "not static mode" — it's a real backend even on a page loaded
// from GitHub Pages. Reads the same localStorage key directly rather than
// via serverWsBaseOverride() below since only presence-of-override matters
// here, not its ws:// form.
const STATIC_MODE = window.MIMI_STATIC_MODE === true && !(() => {
    try {
        return (localStorage.getItem("mimiServerOverride") || "").trim();
    } catch (e) {
        return "";
    }
})();

// object-fit:contain on <canvas> is unreliable across browsers — canvas
// doesn't consistently expose an intrinsic aspect ratio for it the way
// <img>/<video> do, so at viewports far from the drawing buffer's 3:2 ratio
// (e.g. wide desktop windows, since the hub embeds this at 100% width) the
// canvas just stretches edge-to-edge instead of staying letterboxed and
// centered. Size it explicitly instead.
function syncCanvasSize() {
    const frame = canvas.closest(".game-frame");
    if (!frame) return;
    const availW = frame.clientWidth;
    const availH = frame.clientHeight;
    if (!availW || !availH) return;
    const targetRatio = 3 / 2; // matches canvas width="960" height="640"
    let w = availW;
    let h = w / targetRatio;
    if (h > availH) {
        h = availH;
        w = h * targetRatio;
    }
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
}
window.addEventListener("resize", syncCanvasSize);
document.addEventListener("fullscreenchange", syncCanvasSize);
document.addEventListener("webkitfullscreenchange", syncCanvasSize);
syncCanvasSize();
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
const devCheatPanel = document.getElementById("devCheatPanel");
const devFlyButton = document.getElementById("devFlyButton");
const devGodModeButton = document.getElementById("devGodModeButton");
const devInfiniteItemsButton = document.getElementById("devInfiniteItemsButton");
const devItemChoice = document.getElementById("devItemChoice");
const devSpeedTarget = document.getElementById("devSpeedTarget");
const devSpeedInput = document.getElementById("devSpeedInput");
const devSpeedSetButton = document.getElementById("devSpeedSetButton");
const devSpeedClearButton = document.getElementById("devSpeedClearButton");
const themeButton = document.getElementById("themeButton");
const modeButton = document.getElementById("modeButton");
const camButton = document.getElementById("camButton");
const hdrButton = document.getElementById("hdrButton");
const audioButton = document.getElementById("audioButton");
const fullScreenButton = document.getElementById("fullScreenButton");
const vrButton = document.getElementById("vrButton");
const pauseButton = document.getElementById("pauseButton");
const difficultyButtons = document.querySelectorAll("[data-difficulty]");
const cupButtons = document.querySelectorAll("[data-cup]");
const mapButtons = document.querySelectorAll("[data-map]");
const touchButtons = document.querySelectorAll("[data-key]");
const mpStatus = document.getElementById("mpStatus");
const mpNameInput = document.getElementById("mpNameInput");
// prefill with whoever's signed in on the hub's profile system, so you don't
// have to retype your name every time you host/join a race
if (mpNameInput) {
    const signedInSession = activeProfileSession();
    if (signedInSession?.name) mpNameInput.value = signedInSession.name;
}
const mpHostButton = document.getElementById("mpHostButton");
const mpJoinCodeInput = document.getElementById("mpJoinCodeInput");
const mpJoinButton = document.getElementById("mpJoinButton");
const mpRoomInfo = document.getElementById("mpRoomInfo");
const mpControls = document.querySelector(".mp-controls");
const mpLeaveButton = document.getElementById("mpLeaveButton");
const mpRoomCodeEl = document.getElementById("mpRoomCode");
const mpPlayerListEl = document.getElementById("mpPlayerList");
const mpVoiceButton = document.getElementById("mpVoiceButton");
const mpVideoButton = document.getElementById("mpVideoButton");
const mpVideosEl = document.getElementById("mpVideos");
const mpMediaTestButton = document.getElementById("mpMediaTestButton");
const mpChat = document.getElementById("mpChat");
const mpChatLog = document.getElementById("mpChatLog");
const mpChatForm = document.getElementById("mpChatForm");
const mpChatInput = document.getElementById("mpChatInput");
if (STATIC_MODE) {
    // GitHub Pages has no server to relay a room over — no point offering
    // controls that can only fail. Solo/local-multiplayer racing is unaffected.
    if (mpStatus) mpStatus.textContent = "Wireless racing needs the full hosted version — not available on this static GitHub Pages preview. Solo and local multiplayer still work normally.";
    if (mpControls) mpControls.classList.add("hidden");
    if (mpMediaTestButton) mpMediaTestButton.classList.add("hidden");
}
const localPlayerButtons = document.querySelectorAll("[data-local-players]");
const localPlayerHint = document.getElementById("localPlayerHint");
const localRosterSoloRow = document.getElementById("localRosterSoloRow");
const localSoloSelect = document.getElementById("localSoloSelect");
const gamepadStatusLine = document.getElementById("gamepadStatusLine");
const gamepadPadList = document.getElementById("gamepadPadList");
const gamepadMapList = document.getElementById("gamepadMapList");
const gamepadResetButton = document.getElementById("gamepadResetButton");
const p1Prompt = document.getElementById("p1PromptBanner");
const p1PromptList = document.getElementById("p1PromptList");
const p1PromptDismissBtn = document.getElementById("p1PromptDismiss");

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const CENTER = { x: WIDTH / 2, y: HEIGHT / 2 };
const MAX_SPEED = 100;
const BOOST_SPEED_BONUS = 28;
const BOOST_KICK = 18;
const START_COUNTDOWN_SECONDS = 3;
const OFF_ROAD_FALL_DELAY = 1.1; // seconds of continuous off-road driving before falling
const FALL_DURATION = 0.9;
const COIN_MAX = 10;
const COIN_SPEED_BONUS = 0.8; // top-speed added per coin held
const COINS_LOST_ON_FALL = 3;
const SPIN_OUT_DURATION = 1.0;
const DRIFT_STAGE1 = 0.9; // seconds of drift charge for a blue mini-turbo
const DRIFT_STAGE2 = 1.9; // orange turbo
const HOP_DURATION = 0.24; // the little jump that kicks off a power-slide, classic kart-racer style
const HOP_HEIGHT = 22;
// big-kart-racer-style flight: small trick ramps pop you airborne for a
// landing boost; big glide ramps launch a long soaring stretch. Wall zones
// let you ride the wall beyond the road edge and cash the ride in as a boost.
const JUMP_DURATION = 0.7;
const GLIDE_DURATION = 2.8;
const JUMP_AIR_HEIGHT = 36;
const GLIDE_AIR_HEIGHT = 95;
// boost pads give an instant kick; loops run a scripted 360° roll with airtime
const LOOP_DURATION = 1.15;
const LOOP_AIR_HEIGHT = 60;
// Dev "Fly" cheat: noticeably higher than any real jump/glide (95 at most)
// so it unmistakably reads as flying above the track, not just a big jump.
const FLY_HOVER_HEIGHT = 150;
// weighted item pool: lightning is the rare game-changer, star is uncommon
const ITEM_TYPES = ["boost", "rocket", "shield", "oil", "boost", "rocket", "shield", "oil", "coinbag", "coinbag", "star", "lightning", "boo"];
const ITEM_LABELS = { boost: "Turbo", rocket: "Rocket", shield: "Shield", oil: "Oil Slick", star: "⭐ Star", lightning: "⚡ Lightning", coinbag: "💰 Coins", boo: "👻 Boo" };

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

// Same as fillRoundedRect, but with a thin dark outline around it too — used
// for each racer's kart chassis, the one shape whose FILL color is the only
// thing telling two racers apart. Without an outline, a racer whose assigned
// color happens to be a close hue match for whatever's behind them (a warm
// red kart against Neon Loop's magenta-saturated curbs/sky, say) can all but
// disappear into the background at a glance, even though the color itself
// isn't actually wrong. A dark edge keeps every kart legible against any
// map's palette, not just the ones its color happens to contrast with.
function outlinedRoundedRect(x, y, width, height, radius) {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
        ctx.roundRect(x, y, width, height, radius);
    } else {
        addRoundedRectPath(x, y, width, height, radius);
    }
    ctx.fill();
    ctx.stroke();
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
    ensureMusicScheduler();
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

function playHopSound() {
    playTone({ frequency: 380, endFrequency: 560, duration: 0.08, type: "sine", volume: 0.05 });
}

function playJumpSound() {
    playTone({ frequency: 300, endFrequency: 720, duration: 0.18, type: "sine", volume: 0.07 });
}

function playGlideSound() {
    playTone({ frequency: 420, endFrequency: 980, duration: 0.5, type: "triangle", volume: 0.06, release: 0.3 });
    playTone({ frequency: 220, endFrequency: 440, duration: 0.4, type: "sine", volume: 0.04, attack: 0.05 });
}

function playErrorSound() {
    playTone({ frequency: 220, endFrequency: 130, duration: 0.16, type: "sawtooth", volume: 0.07, release: 0.1 });
}

function playFallSound() {
    playTone({ frequency: 340, endFrequency: 70, duration: 0.55, type: "sawtooth", volume: 0.08, release: 0.2 });
}

// --- Background music: a generated chiptune loop (no audio files — same
// WebAudio synth as the sound effects). A standard lookahead scheduler keeps
// timing steady even when the tab hiccups: a coarse interval wakes up every
// 25ms and schedules any notes that fall inside the next 0.12s window at
// exact AudioContext timestamps.
const MUSIC_BPM = 132;
const musicState = {
    schedulerId: null,
    nextNoteTime: 0,
    step: 0,
    wasEmitting: false,
};

// Am — F — C — G, 8 sixteenth-steps per chord, 32-step loop.
const MUSIC_BASS = [
    110.0, 0, 110.0, 0, 110.0, 0, 220.0, 0,
    87.31, 0, 87.31, 0, 87.31, 0, 174.61, 0,
    130.81, 0, 130.81, 0, 130.81, 0, 261.63, 0,
    98.0, 0, 98.0, 0, 98.0, 0, 196.0, 0,
];
// A-minor pentatonic melody, one note per 16th step (0 = rest)
const MUSIC_LEAD = [
    440.0, 0, 523.25, 0, 659.25, 0, 523.25, 440.0,
    0, 349.23, 0, 440.0, 523.25, 0, 440.0, 0,
    523.25, 0, 659.25, 0, 783.99, 0, 659.25, 523.25,
    0, 587.33, 0, 523.25, 493.88, 0, 440.0, 0,
];

function musicShouldEmit() {
    return audioState.enabled && running && !paused && !raceOver;
}

function scheduleMusicStep(stepIndex, time) {
    const context = audioState.context;
    // final lap pushes the whole loop up a whole step for that classic urgency
    const finalLap = racers[0]?.lap >= getLapsToWin();
    const transpose = finalLap ? 1.1225 : 1; // +2 semitones

    const note = (frequency, type, volume, duration) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency * transpose, time);
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.linearRampToValueAtTime(volume, time + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
        oscillator.connect(gain);
        gain.connect(audioState.masterGain);
        oscillator.start(time);
        oscillator.stop(time + duration + 0.02);
    };

    const bass = MUSIC_BASS[stepIndex % MUSIC_BASS.length];
    if (bass) note(bass, "triangle", 0.055, 0.16);
    const lead = MUSIC_LEAD[stepIndex % MUSIC_LEAD.length];
    if (lead) note(lead, "square", 0.028, 0.14);
    if (stepIndex % 4 === 0) note(52, "sine", 0.09, 0.1); // kick thump
    if (stepIndex % 4 === 2) note(6200, "square", 0.012, 0.03); // offbeat hat tick
}

function musicSchedulerTick() {
    const context = audioState.context;
    if (!context || context.state !== "running") return;
    if (!musicShouldEmit()) {
        // paused/finished/setup: stay silent but keep the clock aligned so the
        // beat doesn't fire a burst of "missed" notes the moment racing resumes
        musicState.nextNoteTime = context.currentTime + 0.05;
        musicState.wasEmitting = false;
        return;
    }
    if (!musicState.wasEmitting) {
        musicState.step = 0; // restart the loop from the top on resume
        musicState.wasEmitting = true;
    }
    const finalLap = racers[0]?.lap >= getLapsToWin();
    const secondsPerStep = 60 / (MUSIC_BPM * (finalLap ? 1.1 : 1)) / 4;
    while (musicState.nextNoteTime < context.currentTime + 0.12) {
        scheduleMusicStep(musicState.step, musicState.nextNoteTime);
        musicState.nextNoteTime += secondsPerStep;
        musicState.step = (musicState.step + 1) % MUSIC_BASS.length;
    }
}

function ensureMusicScheduler() {
    if (musicState.schedulerId !== null) return;
    musicState.schedulerId = setInterval(musicSchedulerTick, 25);
}

function playRespawnSound() {
    playTone({ frequency: 480, endFrequency: 680, duration: 0.16, type: "triangle", volume: 0.06 });
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

// Gamepad support: one pad per local player (pad 1 -> P1, pad 2 -> P2, ...),
// analog stick steering, and a remappable button layout stored in localStorage.
const GAMEPAD_MAPPING_STORAGE_KEY = "kartGamepadMapping";
// Default layout mirrors console kart racers: A accelerates, B brakes,
// ZR/R drifts, ZL/L uses the item, X changes camera, + pauses.
// (Standard-mapping indexes: 0 = bottom button, 1 = right, 2 = left, 3 = top.)
// Flight sticks / HOTAS units (e.g. a Thrustmaster T.Flight) report as a
// *non-standard* gamepad — the browser can't normalize their raw button/axis
// order to this layout at all, so these defaults will likely land on the
// wrong physical control. Every action here is remappable from the setup
// screen's gamepad panel (press the button you want it bound to); the
// analog stick's X axis (steering) is read directly and needs no remap,
// since axis 0 = the primary stick's left/right tilt on virtually all
// joystick-like devices regardless of mapping.
const GAMEPAD_DEFAULT_MAPPING = {
    accelerate: [1, 12], // A, D-Up
    brake: [0, 13], // B, D-Down
    item: [6, 4], // ZL, L
    drift: [7, 5], // ZR, R
    steerLeft: [14], // D-Left
    steerRight: [15], // D-Right
    camera: [3], // X (top)
    startPause: [9], // +
    renderMode: [8], // −
    autoSteer: [10], // L3
    restart: [11], // R3
    fullscreen: [2], // Y
    cursorClick: [6], // ZL / LT
};
const GAMEPAD_BUTTON_NAMES = ["B", "A", "Y", "X", "L", "R", "ZL", "ZR", "−", "+", "L3", "R3", "D-Up", "D-Down", "D-Left", "D-Right", "Home"];
const GAMEPAD_REMAPPABLE = [
    { key: "accelerate", label: "Accelerate" },
    { key: "brake", label: "Brake / Reverse" },
    { key: "item", label: "Use Item" },
    { key: "drift", label: "Drift" },
    { key: "camera", label: "Camera" },
    { key: "startPause", label: "Start / Pause" },
    { key: "fullscreen", label: "Fullscreen" },
    { key: "cursorClick", label: "Menu Cursor Click" },
];

function gamepadButtonName(index, isStandard = true) {
    // Nintendo-style names (A/B/X/Y/ZL/ZR...) only mean anything on a
    // "standard"-mapping gamepad — a flight stick/HOTAS reports its raw HID
    // button order instead, so "Button 3" is more honest than a made-up "Y"
    if (!isStandard) return `Button ${index}`;
    return GAMEPAD_BUTTON_NAMES[index] || `B${index}`;
}

function loadGamepadMapping() {
    try {
        const stored = JSON.parse(localStorage.getItem(GAMEPAD_MAPPING_STORAGE_KEY) || "{}");
        return { ...GAMEPAD_DEFAULT_MAPPING, ...stored };
    } catch (e) {
        return { ...GAMEPAD_DEFAULT_MAPPING };
    }
}

function saveGamepadMapping() {
    try {
        localStorage.setItem(GAMEPAD_MAPPING_STORAGE_KEY, JSON.stringify(gamepadMapping));
    } catch (e) {
        /* private mode etc. */
    }
}

let gamepadMapping = loadGamepadMapping();
let gamepadCount = 0;
let gamepadSeatInputs = [null, null, null, null]; // per local-player seat
let gamepadRemapAction = null;
const gamepadPrevPressed = new Map(); // pad.index -> Set of pressed button indexes
// Seat order is otherwise whatever raw order the browser enumerates
// navigator.getGamepads() in, which is arbitrary from a player's point of
// view (often just connection/first-input order) — with two people each
// holding their own controller, "who ends up P1" shouldn't be down to
// browser internals. preferredPadOrder holds pad.id strings, most-preferred
// seat first; getOrderedPads() below sorts by it, falling back to natural
// order for anything not yet chosen. A pad's own id is stable across
// reconnects (same physical device string) even though its numeric index
// isn't, so that's the right thing to key on rather than pad.index.
let preferredPadOrder = [];
function getOrderedPads(pads) {
    return pads.slice().sort((a, b) => {
        const ai = preferredPadOrder.indexOf(a.id);
        const bi = preferredPadOrder.indexOf(b.id);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
    });
}
function makePreferredPad(padId) {
    preferredPadOrder = [padId, ...preferredPadOrder.filter((id) => id !== padId)];
    p1PromptResolved = true;
    syncGamepadPanel();
}

// Surfaced right on the setup screen the moment two-plus controllers are
// already connected — asked once per visit, not buried in the gamepad panel
// further down where two people about to play together might never look
// before one of them just starts pressing buttons.
let p1PromptResolved = false;
function syncP1Prompt(pads) {
    if (!p1Prompt || !p1PromptList) return;
    if (pads.length < 2 || p1PromptResolved) {
        p1Prompt.classList.add("hidden");
        return;
    }
    p1Prompt.classList.remove("hidden");
    p1PromptList.innerHTML = "";
    pads.slice(0, 4).forEach((pad, index) => {
        const choice = document.createElement("button");
        choice.type = "button";
        choice.className = "mode-button p1-prompt-choice";
        choice.textContent = shortPadName(pad.id, index);
        choice.addEventListener("click", () => makePreferredPad(pad.id));
        p1PromptList.appendChild(choice);
    });
}
p1PromptDismissBtn?.addEventListener("click", () => {
    p1PromptResolved = true;
    p1Prompt?.classList.add("hidden");
});
const BACK_HOLD_SECONDS = 0.7; // hold physical B to exit to the hub; a tap still brakes
let backHoldStart = 0;
let backHoldTriggered = false;

function exitToHub() {
    // same-origin iframe embed (the normal way this page is played) — reach
    // into the parent hub and close back to the game grid. No-op standalone.
    try {
        if (window.parent && window.parent !== window && typeof window.parent.MimiApp?.closeGame === "function") {
            window.parent.MimiApp.closeGame();
        }
        // (arcade) ask the arcade around this frame to go back to its menu
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ source: "kart-circuit", type: "exit" }, "*");
        }
    } catch (e) { /* cross-origin or standalone — nothing to back out to */ }
}

function padButtonPressed(pad, indexes) {
    return (indexes || []).some((i) => pad.buttons[i]?.pressed);
}

// --- gamepad mouse cursor: point-and-click the setup screen with the stick,
// press A to click (so you can pick maps and hit Start Race from the couch) ---
const padCursor = document.createElement("div");
padCursor.className = "pad-cursor hidden";
padCursor.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2 L20 11.5 L12.5 13.2 L9.5 21 Z" fill="#ffffff" stroke="#0a1020" stroke-width="1.8" stroke-linejoin="round"/></svg>';
// appended inside .shell (the element that actually goes fullscreen), not
// document.body directly — the Fullscreen API only renders elements inside
// the fullscreen element's subtree, so a body-level sibling would just
// vanish the moment fullscreen was entered
(document.querySelector(".shell") || document.body).appendChild(padCursor);
let padHoveredEl = null;
// elementFromPoint returns the deepest node (often an icon/text span *inside*
// a button), so walk up to the nearest interactive ancestor rather than
// requiring the cursor to be over the button's own hit area
function findPadInteractive(el) {
    return el?.closest?.("button, a, input, select, textarea, [role='button'], [tabindex]") || null;
}
function setPadHover(el) {
    const next = findPadInteractive(el);
    if (next === padHoveredEl) return;
    padHoveredEl?.classList.remove("pad-hover-target");
    next?.classList.add("pad-hover-target");
    padHoveredEl = next;
}
const padCursorState = {
    x: typeof window !== "undefined" ? window.innerWidth / 2 : 480,
    y: typeof window !== "undefined" ? window.innerHeight / 2 : 320,
    visible: false,
    clickHeld: false,
    lastMove: 0,
};

// pointer size & speed prefs, shared with the hub via localStorage
const PAD_CURSOR_PREFS_KEY = "mimiPadCursor";
function loadPadCursorPrefs() {
    try {
        return { size: 1, speed: 1, ...JSON.parse(localStorage.getItem(PAD_CURSOR_PREFS_KEY) || "{}") };
    } catch (e) {
        return { size: 1, speed: 1 };
    }
}
let padCursorPrefs = loadPadCursorPrefs();
window.addEventListener("storage", (event) => {
    if (event.key === PAD_CURSOR_PREFS_KEY) {
        padCursorPrefs = loadPadCursorPrefs();
        renderCursorPrefButtons();
    }
});
function savePadCursorPrefs(next) {
    padCursorPrefs = { ...padCursorPrefs, ...next };
    try { localStorage.setItem(PAD_CURSOR_PREFS_KEY, JSON.stringify(padCursorPrefs)); } catch (e) { /* private mode */ }
}

function renderCursorPrefButtons() {
    const container = document.getElementById("gamepadCursorPrefs");
    if (!container) return;
    container.innerHTML = "";
    const groups = [
        ["size", "Cursor size", 0.7, 2.5],
        ["speed", "Cursor speed", 0.3, 2.5],
    ];
    groups.forEach(([key, label, min, max]) => {
        const row = document.createElement("div");
        row.className = "gamepad-map-row";
        const name = document.createElement("span");
        name.className = "gamepad-map-label";
        name.textContent = label;
        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = String(min);
        slider.max = String(max);
        slider.step = "0.1";
        slider.value = String(padCursorPrefs[key]);
        slider.className = "gamepad-cursor-slider";
        const readout = document.createElement("span");
        readout.className = "gamepad-cursor-readout";
        readout.textContent = `${Number(padCursorPrefs[key]).toFixed(1)}×`;
        slider.addEventListener("input", () => {
            const value = parseFloat(slider.value);
            savePadCursorPrefs({ [key]: value });
            readout.textContent = `${value.toFixed(1)}×`;
        });
        row.appendChild(name);
        row.appendChild(slider);
        row.appendChild(readout);
        container.appendChild(row);
    });
}

function hidePadCursor() {
    setPadHover(null);
    if (!padCursorState.visible) return;
    padCursorState.visible = false;
    padCursor.classList.add("hidden");
}

function updatePadCursor(pad) {
    // embedded in the hub, the hub's own page-wide cursor takes over — it can
    // travel in and out of this frame, so ours would just double up. EXCEPT:
    // when this frame's own .shell goes fullscreen, the Fullscreen API hides
    // everything else in the hub's top-level document (the hub cursor lives
    // there, as a sibling of the iframe) — so the hub's cursor becomes
    // invisible with no way to reach us. In that one case we have to take
    // over locally, since we're the only cursor that's still actually visible.
    const embedded = false; // (arcade) no page-wide hub cursor exists here — keep this page's own gamepad cursor
    const weAreFullscreen = isFullScreenActive();
    const hubCursorReachable = embedded && !weAreFullscreen;
    const overlayVisible = !overlay.classList.contains("hidden");
    if (hubCursorReachable || !overlayVisible || !pad) {
        hidePadCursor();
        padCursorState.clickHeld = false;
        return;
    }

    const now = performance.now();
    const dt = padCursorState.lastMove ? Math.min(0.1, (now - padCursorState.lastMove) / 1000) : 0.016;
    padCursorState.lastMove = now;

    // left stick (or d-pad) moves the cursor, right stick scrolls, LT/ZL clicks
    const dead = 0.22;
    const stickX = Math.abs(pad.axes[0] ?? 0) > dead ? pad.axes[0] : 0;
    const stickY = Math.abs(pad.axes[1] ?? 0) > dead ? pad.axes[1] : 0;
    const dpadX = (pad.buttons[14]?.pressed ? -1 : 0) + (pad.buttons[15]?.pressed ? 1 : 0);
    const dpadY = (pad.buttons[12]?.pressed ? -1 : 0) + (pad.buttons[13]?.pressed ? 1 : 0);
    const moveX = clamp(stickX + dpadX, -1, 1);
    const moveY = clamp(stickY + dpadY, -1, 1);

    const speed = 620 * padCursorPrefs.speed; // px/s
    padCursorState.x = clamp(padCursorState.x + moveX * speed * dt, 0, window.innerWidth - 2);
    padCursorState.y = clamp(padCursorState.y + moveY * speed * dt, 0, window.innerHeight - 2);

    if (!padCursorState.visible) {
        padCursorState.visible = true;
        padCursor.classList.remove("hidden");
    }
    padCursor.style.transform = `translate(${padCursorState.x}px, ${padCursorState.y}px) scale(${padCursorPrefs.size})`;
    padCursor.style.transformOrigin = "0 0";

    const scrollY = Math.abs(pad.axes[3] ?? 0) > dead ? pad.axes[3] : 0;
    if (scrollY !== 0) {
        const delta = scrollY * 900 * dt;
        const card = overlay.querySelector(".overlay-card");
        if (card && card.scrollHeight > card.clientHeight + 4) {
            card.scrollTop += delta; // the setup card is the scrollable element
        } else if (overlay.scrollHeight > overlay.clientHeight + 4) {
            overlay.scrollTop += delta;
        } else {
            window.scrollBy(0, delta);
        }
    }

    const hoverTarget = document.elementFromPoint(padCursorState.x, padCursorState.y);
    setPadHover(hoverTarget && !padCursor.contains(hoverTarget) ? hoverTarget : null);

    const clickPressed = padButtonPressed(pad, gamepadMapping.cursorClick);
    if (clickPressed && !padCursorState.clickHeld) {
        padCursor.classList.add("clicking");
        setTimeout(() => padCursor.classList.remove("clicking"), 140);
        if (hoverTarget && !padCursor.contains(hoverTarget)) {
            // requestFullscreen() needs real input activation, which a synthetic
            // .click() never carries — call it directly instead so the fullscreen
            // button actually works when clicked with the gamepad cursor.
            if (hoverTarget.closest("#fullScreenButton")) toggleFullScreen("gamepad");
            else hoverTarget.click();
        }
    }
    padCursorState.clickHeld = clickPressed;
}

const GAMEPAD_VENDOR_NAMES = {
    "2dc8": "8BitDo",
    "057e": "Nintendo",
    "054c": "PlayStation",
    "045e": "Xbox",
    "046d": "Logitech",
    "0f0d": "HORI",
    "28de": "Steam",
    "044f": "Thrustmaster",
};

function shortPadName(id, index = 0) {
    let raw = String(id || "");
    // Firefox prefixes ids with vendor-product hex ("2dc8-3106-8BitDo Pro 2"),
    // Chrome appends "(... Vendor: 2dc8 Product: 3106)" — grab the vendor either way
    let vendor = null;
    const hexPrefix = raw.match(/^([0-9a-f]{4})-[0-9a-f]{4}-(.*)$/i);
    if (hexPrefix) {
        vendor = hexPrefix[1].toLowerCase();
        raw = hexPrefix[2];
    }
    const vendorTail = raw.match(/vendor:\s*([0-9a-f]{4})/i);
    if (vendorTail) vendor = vendorTail[1].toLowerCase();

    let name = raw.split(" (")[0].replace(/vendor:.*$/i, "").trim();
    // pads in XInput mode masquerade as a generic device and hide their real name
    const generic = !name
        || /^x-?input$/i.test(name)
        || /^(xinput )?standard gamepad$/i.test(name)
        || /^wireless controller$/i.test(name)
        || /^usb\s*gamepad$/i.test(name)
        || /^generic/i.test(name);
    if (generic) {
        if (GAMEPAD_VENDOR_NAMES[vendor]) {
            name = `${GAMEPAD_VENDOR_NAMES[vendor]} Controller`;
        } else if (/x-?input/i.test(String(id || ""))) {
            // XInput is the Xbox protocol — pads reporting only "xinput" are
            // Xbox-compatible (8BitDo & co. in X mode included)
            name = "Xbox Controller";
        } else {
            name = `Controller ${index + 1}`;
        }
    }
    if (name.length > 30) name = name.slice(0, 28) + "…";
    return name;
}

let gamepadPadRows = [];

function syncGamepadPanel() {
    if (!gamepadStatusLine) return;
    const rawPads = typeof navigator !== "undefined" && typeof navigator.getGamepads === "function"
        ? Array.from(navigator.getGamepads()).filter((candidate) => candidate?.connected)
        : [];
    const pads = getOrderedPads(rawPads);
    syncP1Prompt(pads);
    if (gamepadPadList) {
        gamepadPadList.innerHTML = "";
        gamepadPadRows = [];
        // identical pads get the same name — number them so P1/P2 are tellable apart
        const usablePads = Math.min(pads.length, localPlayerCount);
        const seatOffset = localPlayerCount - usablePads;
        const names = pads.slice(0, 4).map((pad, index) => shortPadName(pad.id, index));
        const counts = {};
        names.forEach((name) => { counts[name] = (counts[name] || 0) + 1; });
        const seen = {};
        pads.slice(0, 4).forEach((pad, index) => {
            let name = names[index];
            if (counts[name] > 1) {
                seen[name] = (seen[name] || 0) + 1;
                name = `${name} #${seen[name]}`;
            }
            const row = document.createElement("div");
            row.className = "gamepad-pad-row";
            const tag = document.createElement("strong");
            if (index < usablePads) {
                const seat = seatOffset + index;
                tag.textContent = `P${seat + 1}`;
                tag.style.color = racerPalette[seat % racerPalette.length];
            } else {
                tag.textContent = "spare";
                tag.style.color = "var(--muted)";
            }
            row.appendChild(tag);
            row.appendChild(document.createTextNode(` ${name}`));
            // With two or more controllers connected, which one lands on
            // which seat is otherwise just whatever order the browser
            // happens to report them in — not a real choice anyone made.
            // Let whoever's holding a controller claim P1 for it directly.
            if (pads.length > 1 && index !== 0) {
                const claimBtn = document.createElement("button");
                claimBtn.type = "button";
                claimBtn.className = "mode-button gamepad-claim-btn";
                claimBtn.textContent = "Make P1";
                claimBtn.addEventListener("click", () => makePreferredPad(pad.id));
                row.appendChild(claimBtn);
            }
            gamepadPadList.appendChild(row);
            gamepadPadRows[index] = row;
        });
    }
    if (!pads.length) {
        gamepadStatusLine.textContent = "No gamepads detected — press any button on your controller.";
    } else if (pads.length === 1) {
        gamepadStatusLine.textContent = localPlayerCount > 1
            ? `1 gamepad connected → drives P${localPlayerCount}. Keyboard players take P1–P${localPlayerCount - 1}.`
            : "1 gamepad connected → drives P1. Plug in more for P2–P4.";
    } else {
        gamepadStatusLine.textContent = `${pads.length} gamepads connected — choose who's P1 below (defaults to whichever connected first):`;
    }
}

function renderGamepadMapList() {
    if (!gamepadMapList) return;
    gamepadMapList.innerHTML = "";
    const firstPad = typeof navigator !== "undefined" && typeof navigator.getGamepads === "function"
        ? Array.from(navigator.getGamepads()).find((p) => p?.connected)
        : null;
    const isStandard = !firstPad || firstPad.mapping === "standard";
    GAMEPAD_REMAPPABLE.forEach(({ key, label }) => {
        const row = document.createElement("div");
        row.className = "gamepad-map-row";
        const name = document.createElement("span");
        name.className = "gamepad-map-label";
        name.textContent = label;
        const binding = document.createElement("button");
        binding.type = "button";
        binding.className = "mode-button gamepad-map-binding";
        binding.textContent = gamepadRemapAction === key
            ? "Press a button…"
            : (gamepadMapping[key] || []).map((i) => gamepadButtonName(i, isStandard)).join(" / ") || "—";
        binding.addEventListener("click", () => {
            gamepadRemapAction = gamepadRemapAction === key ? null : key;
            renderGamepadMapList();
        });
        row.appendChild(name);
        row.appendChild(binding);
        gamepadMapList.appendChild(row);
    });
}

function updateGamepadInput() {
    gamepadConnected = false;
    gamepadSeatInputs = [null, null, null, null];
    const previousLabel = gamepadLabel;
    gamepadLabel = "Disconnected";

    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
        gamepadLabel = "Unsupported";
        return;
    }

    // ordered by preferredPadOrder (see getOrderedPads) so seat assignment,
    // the "which pad am I?" row highlighting, and which pad drives global
    // actions (pause/fullscreen/camera below) all agree with whichever pad
    // the player actually claimed as P1 in the gamepad panel — not just
    // whatever order the browser happens to enumerate them in.
    const pads = getOrderedPads(Array.from(navigator.getGamepads()).filter((candidate) => candidate?.connected));
    gamepadCount = pads.length;
    if (!pads.length) {
        resetGamepadActionLatch();
        gamepadPrevPressed.clear();
        hidePadCursor();
        if (previousLabel !== gamepadLabel) syncGamepadPanel();
        return;
    }

    gamepadConnected = true;
    gamepadLabel = pads.length === 1 ? shortPadName(pads[0].id) : `${pads.length} pads`;
    if (previousLabel !== gamepadLabel) syncGamepadPanel();

    // remap capture: first newly-pressed button on any pad becomes the binding
    if (gamepadRemapAction) {
        outer: for (const pad of pads) {
            const prev = gamepadPrevPressed.get(pad.index) || new Set();
            for (let b = 0; b < pad.buttons.length; b += 1) {
                if (pad.buttons[b]?.pressed && !prev.has(b)) {
                    gamepadMapping[gamepadRemapAction] = [b];
                    saveGamepadMapping();
                    gamepadRemapAction = null;
                    renderGamepadMapList();
                    syncFullScreenButton();
                    break outer;
                }
            }
        }
    }

    pads.forEach((pad) => {
        const pressed = new Set();
        for (let b = 0; b < pad.buttons.length; b += 1) {
            if (pad.buttons[b]?.pressed) pressed.add(b);
        }
        gamepadPrevPressed.set(pad.index, pressed);
    });

    // "which pad am I?" — light up a pad's row while any of its buttons is held
    pads.slice(0, 4).forEach((pad, seat) => {
        const row = gamepadPadRows[seat];
        if (!row) return;
        const anyPressed = pad.buttons.some((button) => button?.pressed);
        row.classList.toggle("active", anyPressed);
    });

    updatePadCursor(pads[0]);

    const axisThreshold = 0.22;
    // pads fill seats from the LAST player backward, so keyboard players keep the
    // front seats: 1 pad + 2 local players → keyboard drives P1, the pad drives P2.
    // With as many pads as players (or solo), this is pad 1 → P1, pad 2 → P2, etc.
    const usablePads = Math.min(pads.length, localPlayerCount);
    const seatOffset = localPlayerCount - usablePads;
    pads.slice(0, usablePads).forEach((pad, index) => {
        const seat = seatOffset + index;
        const leftX = pad.axes[0] ?? 0;
        const stickSteer = Math.abs(leftX) > axisThreshold ? leftX : 0;
        const dpadSteer = (padButtonPressed(pad, gamepadMapping.steerLeft) ? -1 : 0)
            + (padButtonPressed(pad, gamepadMapping.steerRight) ? 1 : 0);
        gamepadSeatInputs[seat] = {
            steer: clamp(stickSteer + dpadSteer, -1, 1),
            accelerate: padButtonPressed(pad, gamepadMapping.accelerate),
            brake: padButtonPressed(pad, gamepadMapping.brake),
            item: padButtonPressed(pad, gamepadMapping.item),
            drift: padButtonPressed(pad, gamepadMapping.drift),
        };
    });

    // global actions come from the first pad only, so P2's buttons don't pause P1's race
    const pad = pads[0];
    const raceActive = running && !raceOver;

    // hold physical B (not the remappable "brake" action — the actual button
    // in the B position) to back out to the hub's game grid; a quick tap
    // still just brakes, same as always
    if (pad.buttons[0]?.pressed) {
        if (!backHoldStart) backHoldStart = performance.now();
        else if (!backHoldTriggered && (performance.now() - backHoldStart) / 1000 >= BACK_HOLD_SECONDS) {
            backHoldTriggered = true;
            exitToHub();
        }
    } else {
        backHoldStart = 0;
        backHoldTriggered = false;
    }

    triggerGamepadAction("start", padButtonPressed(pad, gamepadMapping.startPause), () => {
        if (!running || raceOver) {
            startRace();
            return;
        }
        togglePause();
    });

    // NOTE: browsers require a real mouse/touch/keyboard event to grant
    // requestFullscreen() — the Gamepad API is explicitly excluded from that
    // list on every browser (a background tab could otherwise force fullscreen
    // just by polling a held button). So this will always be refused; it exists
    // only to surface a clear "use a keyboard/mouse instead" message rather than
    // doing nothing when Y is pressed. See toggleFullScreen()'s "blocked" branch.
    triggerGamepadAction("fullscreen", padButtonPressed(pad, gamepadMapping.fullscreen), () => toggleFullScreen("gamepad"));

    if (raceActive) {
        triggerGamepadAction("camera", padButtonPressed(pad, gamepadMapping.camera), toggleCameraMode);
        triggerGamepadAction("mode", padButtonPressed(pad, gamepadMapping.renderMode), toggleRenderMode);
        triggerGamepadAction("autoSteer", padButtonPressed(pad, gamepadMapping.autoSteer), toggleAutoSteer);
        triggerGamepadAction("restart", padButtonPressed(pad, gamepadMapping.restart), startRace);
    } else {
        gamepadActionLatch.camera = false;
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
        lapsToWin: 4,
        color: "#53e0ff",
        worldScale: 1.85,
        roadHalfWidth: 92,
        shoulderHalfWidth: 132,
        biome: {
            skyTop: "#2a0e57", skyMid: "#7b2fb5", skyBottom: "#1a0630",
            sunColor: "rgba(255, 110, 220, 0.85)",
            mountainColor: "rgba(255, 60, 220, 0.55)", mountainStyle: "skyline",
            grassTop: "#1c1033", grassBottom: "#0e081c",
            hazeTop: "rgba(150, 90, 255, 0.28)", hazeBottom: "rgba(255,255,255,0)",
            // road/shoulder were only ~8 luminance units brighter than the
            // grass either side of them — close enough to blend together
            // at a glance, especially with the bright curb stripes right
            // next to them drawing all the visual attention. The road was
            // never actually missing (confirmed by sampling real rendered
            // pixels), it just read as a gap between the two curb lines
            // instead of a filled lane. Brightened, same hue.
            shoulderA: "#4d2f80", shoulderB: "#3d2570",
            roadA: "#33205a", roadB: "#2a1848",
            curbA: "#00eaff", curbB: "#ff2fd6",
            lane: "rgba(0, 234, 255, 0.85)",
            mapBgTop: "#1a0a33", mapBgBottom: "#0c0518", mapGrass: "#1c0f30",
        },
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
        lapsToWin: 5,
        color: "#4e9fd6",
        worldScale: 1.95,
        roadHalfWidth: 96,
        shoulderHalfWidth: 136,
        biome: {
            skyTop: "#3aa8e8", skyMid: "#7fcdf2", skyBottom: "#d3efff",
            sunColor: "rgba(255, 244, 200, 0.9)",
            mountainColor: "rgba(104, 174, 196, 0.5)", mountainStyle: "waves",
            grassTop: "#5cbfa4", grassBottom: "#2f8672",
            hazeTop: "rgba(226,245,255,0.4)", hazeBottom: "rgba(255,255,255,0)",
            shoulderA: "#45a08e", shoulderB: "#368175",
            // was only ~4 luminance units brighter than the grass — same
            // "reads as a gap between the curb stripes" issue as Neon
            // Loop's palette, just less extreme. Brightened, same hue.
            roadA: "#828a9c", roadB: "#71798b",
            curbA: "#ff6f6f", curbB: "#fff4d2",
            lane: "rgba(255,255,255,0.8)",
            mapBgTop: "#173654", mapBgBottom: "#0c1e30", mapGrass: "#1f5048",
        },
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
        lapsToWin: 3,
        color: "#d9754d",
        worldScale: 2.05,
        roadHalfWidth: 100,
        shoulderHalfWidth: 140,
        biome: {
            skyTop: "#f5a95f", skyMid: "#ffc98d", skyBottom: "#ffe3c2",
            sunColor: "rgba(255, 210, 140, 0.9)",
            mountainColor: "rgba(202, 134, 96, 0.62)", mountainStyle: "dunes",
            grassTop: "#e3aa6c", grassBottom: "#b87d40",
            hazeTop: "rgba(255,210,150,0.3)", hazeBottom: "rgba(255,255,255,0)",
            shoulderA: "#c9834e", shoulderB: "#ab6c44",
            roadA: "#8e7c6a", roadB: "#7c6b5c",
            curbA: "#ffb84d", curbB: "#7a3420",
            lane: "rgba(255,220,180,0.75)",
            mapBgTop: "#7a3420", mapBgBottom: "#3f1a10", mapGrass: "#8a5626",
        },
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
        lapsToWin: 3,
        color: "#ff9f6e",
        worldScale: 2.1,
        roadHalfWidth: 102,
        shoulderHalfWidth: 142,
        biome: {
            skyTop: "#ff9f7a", skyMid: "#7a6ea8", skyBottom: "#241d3d",
            sunColor: "rgba(255, 190, 140, 0.85)",
            mountainColor: "rgba(40, 36, 58, 0.9)", mountainStyle: "skyline",
            grassTop: "#454b5e", grassBottom: "#26293a",
            hazeTop: "rgba(255,170,140,0.24)", hazeBottom: "rgba(255,255,255,0)",
            shoulderA: "#4a5064", shoulderB: "#3a3f50",
            // was only ~9 luminance units brighter than the grass, same
            // hue family too — the same low-contrast "reads as a gap
            // between the curb stripes" issue. Brightened, same hue.
            roadA: "#4d5268", roadB: "#3f4457",
            curbA: "#ffce54", curbB: "#333846",
            lane: "rgba(255,255,255,0.75)",
            mapBgTop: "#332c4a", mapBgBottom: "#181428", mapGrass: "#33384a",
        },
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
        worldScale: 2.2,
        roadHalfWidth: 104,
        shoulderHalfWidth: 146,
        biome: {
            skyTop: "#dff3ff", skyMid: "#8fc4ea", skyBottom: "#e8f6ff",
            sunColor: "rgba(255, 255, 240, 0.95)",
            mountainColor: "rgba(90, 120, 150, 0.65)", mountainStyle: "peaks",
            grassTop: "#e6f2f8", grassBottom: "#c2d8e4",
            hazeTop: "rgba(255,255,255,0.4)", hazeBottom: "rgba(255,255,255,0)",
            shoulderA: "#c9dde8", shoulderB: "#b2ccd9",
            roadA: "#4a5566", roadB: "#3c4453",
            curbA: "#ff5f5f", curbB: "#ffffff",
            lane: "rgba(255,255,255,0.85)",
            mapBgTop: "#9fc7e0", mapBgBottom: "#587e97", mapGrass: "#d9eaf2",
        },
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
        lapsToWin: 4,
        color: "#49c0a8",
        worldScale: 2.05,
        roadHalfWidth: 98,
        shoulderHalfWidth: 138,
        biome: {
            skyTop: "#bdf0ff", skyMid: "#5fd3e6", skyBottom: "#e8f0a0",
            sunColor: "rgba(255, 244, 190, 0.9)",
            mountainColor: "rgba(10, 90, 125, 0.8)", mountainStyle: "waves",
            grassTop: "#f0dfa0", grassBottom: "#d8be6e",
            hazeTop: "rgba(255,255,255,0.3)", hazeBottom: "rgba(255,255,255,0)",
            shoulderA: "#e8cf8a", shoulderB: "#d4b96e",
            roadA: "#4a5f66", roadB: "#3c4d54",
            curbA: "#ff6f6f", curbB: "#fff4d2",
            lane: "rgba(255,255,255,0.8)",
            mapBgTop: "#0e8f9e", mapBgBottom: "#063f47", mapGrass: "#e8cf8a",
        },
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
        lapsToWin: 3,
        color: "#8dd66e",
        worldScale: 2.0,
        roadHalfWidth: 100,
        shoulderHalfWidth: 140,
        biome: {
            skyTop: "#38a2e0", skyMid: "#7ecdf0", skyBottom: "#daf1ff",
            sunColor: "rgba(255, 236, 168, 0.88)",
            mountainColor: "rgba(112, 168, 124, 0.6)", mountainStyle: "hills",
            grassTop: "#72c85c", grassBottom: "#379140",
            hazeTop: "rgba(230,246,255,0.4)", hazeBottom: "rgba(255,255,255,0)",
            shoulderA: "#5cb14c", shoulderB: "#489440",
            // was essentially the SAME brightness as the grass (diff of
            // well under 1) — the worst case of this palette-wide issue,
            // road and grass were nearly indistinguishable. Brightened,
            // same hue.
            roadA: "#8d9086", roadB: "#7c7f75",
            curbA: "#ff6f6f", curbB: "#fff4d2",
            lane: "rgba(255,255,255,0.78)",
            mapBgTop: "#123a2a", mapBgBottom: "#081f16", mapGrass: "#215c34",
        },
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
        lapsToWin: 3,
        color: "#ff7d5a",
        worldScale: 2.1,
        roadHalfWidth: 104,
        shoulderHalfWidth: 144,
        biome: {
            skyTop: "#e0a86a", skyMid: "#8a5a42", skyBottom: "#241814",
            sunColor: "rgba(255, 160, 90, 0.8)",
            mountainColor: "rgba(30, 22, 20, 0.92)", mountainStyle: "towers",
            grassTop: "#4a3c34", grassBottom: "#241a16",
            hazeTop: "rgba(255,180,120,0.26)", hazeBottom: "rgba(255,255,255,0)",
            shoulderA: "#544238", shoulderB: "#3e2f28",
            // was only ~8 luminance units brighter than the grass — same
            // low-contrast issue as the other maps here. Brightened, same
            // hue (curbB intentionally matches the old roadB — foundry's
            // curb reads mostly through curbA's orange stripe against a
            // dark base — so it's bumped the same amount to keep matching).
            roadA: "#5c4f45", roadB: "#463a32",
            curbA: "#ff9f2f", curbB: "#463a32",
            lane: "rgba(255,190,120,0.7)",
            mapBgTop: "#4a2e1e", mapBgBottom: "#1c1210", mapGrass: "#3e2f28",
        },
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
    // --- "World" maps: big-kart-racer-scale mega tracks. So big that the 2D
    // tactical map can't usefully frame them — threeDOnly locks 2D mode off
    // while one of these is selected (see toggleRenderMode / applyMap).
    skyway: {
        label: "Rainbow Skyway",
        lapsToWin: 2,
        color: "#a06bff",
        worldScale: 3.2,
        roadHalfWidth: 112,
        shoulderHalfWidth: 156,
        threeDOnly: true,
        racerCount: 24,
        decor: { types: ["star", "star", "arch"], every: 4 },
        ramps: [{ t: 0.22 }, { t: 0.68, glide: true }],
        wallZones: [{ from: 0.4, to: 0.52, side: 1 }],
        boostPads: [{ t: 0.06 }, { t: 0.58 }, { t: 0.87 }],
        loops: [{ t: 0.32 }],
        movers: [{ t: 0.45, amplitude: 65, period: 2.4 }, { t: 0.78, amplitude: 60, period: 3 }],
        biome: {
            skyTop: "#050514", skyMid: "#1b1040", skyBottom: "#2f1b63",
            sunColor: "rgba(190, 220, 255, 0.9)",
            mountainColor: "rgba(96, 70, 210, 0.55)", mountainStyle: "towers",
            grassTop: "#0b0724", grassBottom: "#040211",
            hazeTop: "rgba(130, 140, 255, 0.24)", hazeBottom: "rgba(255,255,255,0)",
            shoulderA: "#4a3a85", shoulderB: "#3d2f70",
            roadA: "#3b2f6b", roadB: "#2f2557",
            curbA: "#ff2fd6", curbB: "#53e0ff",
            lane: "rgba(255, 255, 255, 0.82)",
            mapBgTop: "#0a0820", mapBgBottom: "#050310", mapGrass: "#161238",
        },
        checkpoints: [
            { x: 150, y: 140 },
            { x: 320, y: 90 },
            { x: 520, y: 130 },
            { x: 680, y: 80 },
            { x: 840, y: 140 },
            { x: 880, y: 320 },
            { x: 800, y: 480 },
            { x: 620, y: 560 },
            { x: 430, y: 500 },
            { x: 260, y: 560 },
            { x: 120, y: 450 },
            { x: 90, y: 280 },
        ],
        trackPath: [
            { x: 150, y: 140 },
            { x: 320, y: 90 },
            { x: 520, y: 130 },
            { x: 680, y: 80 },
            { x: 840, y: 140 },
            { x: 880, y: 320 },
            { x: 800, y: 480 },
            { x: 620, y: 560 },
            { x: 430, y: 500 },
            { x: 260, y: 560 },
            { x: 120, y: 450 },
            { x: 90, y: 280 },
        ],
        itemBoxes: [
            { x: 420, y: 108 },
            { x: 760, y: 106 },
            { x: 868, y: 232 },
            { x: 846, y: 402 },
            { x: 716, y: 526 },
            { x: 342, y: 528 },
            { x: 184, y: 508 },
            { x: 100, y: 362 },
        ],
        finishLine: { x1: 235, y1: 65, x2: 235, y2: 165 },
        startSide: { x: 235, y: 115 },
        spawnPoints: [
            { x: 200, y: 112 },
            { x: 182, y: 142 },
            { x: 218, y: 148 },
            { x: 162, y: 128 },
            { x: 196, y: 168 },
        ],
    },
    savanna: {
        label: "Great Savanna",
        lapsToWin: 2,
        color: "#ffb75e",
        worldScale: 3.0,
        roadHalfWidth: 108,
        shoulderHalfWidth: 150,
        threeDOnly: true,
        racerCount: 24,
        decor: { types: ["tree", "rock", "tree"], every: 4 },
        ramps: [{ t: 0.3 }, { t: 0.75 }],
        wallZones: [{ from: 0.55, to: 0.66, side: -1 }],
        boostPads: [{ t: 0.1 }, { t: 0.45 }, { t: 0.9 }],
        movers: [{ t: 0.2, amplitude: 55, period: 2.8 }, { t: 0.6, amplitude: 60, period: 2.2 }],
        biome: {
            skyTop: "#ffd194", skyMid: "#ff9d63", skyBottom: "#e26a3f",
            sunColor: "rgba(255, 150, 60, 0.95)",
            mountainColor: "rgba(120, 70, 40, 0.55)", mountainStyle: "hills",
            grassTop: "#dda953", grassBottom: "#a06e2e",
            hazeTop: "rgba(255, 200, 120, 0.3)", hazeBottom: "rgba(255,255,255,0)",
            shoulderA: "#8a5a2b", shoulderB: "#7a4e24",
            roadA: "#4a3b31", roadB: "#3f322a",
            curbA: "#ffd166", curbB: "#e2574f",
            lane: "rgba(255, 240, 200, 0.8)",
            mapBgTop: "#3a2412", mapBgBottom: "#1d1207", mapGrass: "#6b4a1e",
        },
        checkpoints: [
            { x: 180, y: 120 },
            { x: 430, y: 80 },
            { x: 700, y: 110 },
            { x: 870, y: 240 },
            { x: 850, y: 430 },
            { x: 680, y: 560 },
            { x: 470, y: 520 },
            { x: 300, y: 580 },
            { x: 140, y: 470 },
            { x: 80, y: 280 },
        ],
        trackPath: [
            { x: 180, y: 120 },
            { x: 430, y: 80 },
            { x: 700, y: 110 },
            { x: 870, y: 240 },
            { x: 850, y: 430 },
            { x: 680, y: 560 },
            { x: 470, y: 520 },
            { x: 300, y: 580 },
            { x: 140, y: 470 },
            { x: 80, y: 280 },
        ],
        itemBoxes: [
            { x: 560, y: 88 },
            { x: 806, y: 168 },
            { x: 866, y: 340 },
            { x: 762, y: 502 },
            { x: 384, y: 546 },
            { x: 206, y: 528 },
            { x: 98, y: 372 },
            { x: 118, y: 192 },
        ],
        finishLine: { x1: 300, y1: 50, x2: 300, y2: 150 },
        startSide: { x: 300, y: 100 },
        spawnPoints: [
            { x: 262, y: 100 },
            { x: 242, y: 130 },
            { x: 280, y: 136 },
            { x: 222, y: 112 },
            { x: 254, y: 158 },
        ],
    },
    volcano: {
        label: "Volcano Rim",
        lapsToWin: 2,
        color: "#ff5d3a",
        worldScale: 3.1,
        roadHalfWidth: 106,
        shoulderHalfWidth: 148,
        threeDOnly: true,
        racerCount: 24,
        decor: { types: ["lava", "rock", "lava"], every: 4 },
        ramps: [{ t: 0.18 }, { t: 0.5, glide: true }],
        wallZones: [{ from: 0.68, to: 0.8, side: 1 }],
        boostPads: [{ t: 0.05 }, { t: 0.35 }, { t: 0.62 }, { t: 0.92 }],
        movers: [{ t: 0.25, amplitude: 58, period: 2.5 }, { t: 0.78, amplitude: 55, period: 3.1 }],
        biome: {
            skyTop: "#1c0806", skyMid: "#571f10", skyBottom: "#8a2f12",
            sunColor: "rgba(255, 120, 50, 0.9)",
            mountainColor: "rgba(60, 18, 10, 0.75)", mountainStyle: "peaks",
            grassTop: "#2b1512", grassBottom: "#140806",
            hazeTop: "rgba(255, 110, 50, 0.26)", hazeBottom: "rgba(255,255,255,0)",
            shoulderA: "#4a2a20", shoulderB: "#3d221a",
            roadA: "#3a3236", roadB: "#2f282c",
            curbA: "#ff9f43", curbB: "#ffd166",
            lane: "rgba(255, 190, 120, 0.85)",
            mapBgTop: "#230b06", mapBgBottom: "#100403", mapGrass: "#33150e",
        },
        checkpoints: [
            { x: 200, y: 110 },
            { x: 450, y: 70 },
            { x: 690, y: 100 },
            { x: 860, y: 210 },
            { x: 900, y: 380 },
            { x: 790, y: 530 },
            { x: 590, y: 590 },
            { x: 400, y: 545 },
            { x: 240, y: 585 },
            { x: 110, y: 470 },
            { x: 70, y: 290 },
            { x: 120, y: 170 },
        ],
        trackPath: [
            { x: 200, y: 110 },
            { x: 450, y: 70 },
            { x: 690, y: 100 },
            { x: 860, y: 210 },
            { x: 900, y: 380 },
            { x: 790, y: 530 },
            { x: 590, y: 590 },
            { x: 400, y: 545 },
            { x: 240, y: 585 },
            { x: 110, y: 470 },
            { x: 70, y: 290 },
            { x: 120, y: 170 },
        ],
        itemBoxes: [
            { x: 570, y: 82 },
            { x: 800, y: 152 },
            { x: 888, y: 296 },
            { x: 852, y: 462 },
            { x: 692, y: 566 },
            { x: 318, y: 560 },
            { x: 158, y: 528 },
            { x: 86, y: 372 },
        ],
        finishLine: { x1: 320, y1: 40, x2: 320, y2: 140 },
        startSide: { x: 320, y: 90 },
        spawnPoints: [
            { x: 282, y: 92 },
            { x: 262, y: 122 },
            { x: 300, y: 128 },
            { x: 242, y: 104 },
            { x: 274, y: 150 },
        ],
    },
    fjord: {
        label: "Frost Fjord",
        lapsToWin: 2,
        color: "#9be4ff",
        worldScale: 3.3,
        roadHalfWidth: 110,
        shoulderHalfWidth: 152,
        threeDOnly: true,
        racerCount: 24,
        decor: { types: ["crystal", "rock", "crystal"], every: 4 },
        ramps: [{ t: 0.35 }, { t: 0.85 }],
        wallZones: [{ from: 0.12, to: 0.24, side: -1 }],
        boostPads: [{ t: 0.02 }, { t: 0.5 }, { t: 0.68 }],
        movers: [{ t: 0.2, amplitude: 58, period: 2.6 }, { t: 0.58, amplitude: 60, period: 2.3 }],
        biome: {
            skyTop: "#bfe9ff", skyMid: "#8ecdf2", skyBottom: "#5da9d8",
            sunColor: "rgba(255, 252, 240, 0.9)",
            mountainColor: "rgba(70, 110, 150, 0.6)", mountainStyle: "peaks",
            grassTop: "#dceef8", grassBottom: "#9dc4dd",
            hazeTop: "rgba(255, 255, 255, 0.36)", hazeBottom: "rgba(255,255,255,0)",
            shoulderA: "#7ba6c2", shoulderB: "#6b94b0",
            roadA: "#41586e", roadB: "#374c60",
            curbA: "#53e0ff", curbB: "#ffffff",
            lane: "rgba(255, 255, 255, 0.9)",
            mapBgTop: "#1d3a52", mapBgBottom: "#0e1f30", mapGrass: "#b9d8ea",
        },
        checkpoints: [
            { x: 140, y: 150 },
            { x: 360, y: 100 },
            { x: 560, y: 150 },
            { x: 760, y: 100 },
            { x: 900, y: 220 },
            { x: 860, y: 400 },
            { x: 700, y: 470 },
            { x: 500, y: 420 },
            { x: 320, y: 500 },
            { x: 150, y: 430 },
            { x: 80, y: 280 },
        ],
        trackPath: [
            { x: 140, y: 150 },
            { x: 360, y: 100 },
            { x: 560, y: 150 },
            { x: 760, y: 100 },
            { x: 900, y: 220 },
            { x: 860, y: 400 },
            { x: 700, y: 470 },
            { x: 500, y: 420 },
            { x: 320, y: 500 },
            { x: 150, y: 430 },
            { x: 80, y: 280 },
        ],
        itemBoxes: [
            { x: 460, y: 122 },
            { x: 662, y: 120 },
            { x: 856, y: 158 },
            { x: 884, y: 314 },
            { x: 782, y: 440 },
            { x: 408, y: 456 },
            { x: 228, y: 470 },
            { x: 104, y: 350 },
        ],
        finishLine: { x1: 250, y1: 75, x2: 250, y2: 175 },
        startSide: { x: 250, y: 125 },
        spawnPoints: [
            { x: 212, y: 124 },
            { x: 192, y: 154 },
            { x: 230, y: 160 },
            { x: 172, y: 136 },
            { x: 204, y: 182 },
        ],
    },
    cloud: {
        label: "Cloud Canyon",
        lapsToWin: 2,
        color: "#ffe9a8",
        worldScale: 3.6,
        roadHalfWidth: 114,
        shoulderHalfWidth: 158,
        threeDOnly: true,
        racerCount: 24,
        decor: { types: ["cloud", "star", "cloud"], every: 4 },
        ramps: [{ t: 0.15 }, { t: 0.4, glide: true }, { t: 0.65 }, { t: 0.9, glide: true }],
        wallZones: [{ from: 0.25, to: 0.37, side: 1 }, { from: 0.7, to: 0.82, side: -1 }],
        boostPads: [{ t: 0.05 }, { t: 0.53 }, { t: 0.78 }],
        loops: [{ t: 0.28 }],
        movers: [{ t: 0.48, amplitude: 60, period: 2.4 }, { t: 0.72, amplitude: 55, period: 2.9 }],
        biome: {
            skyTop: "#8fd4ff", skyMid: "#bfe6ff", skyBottom: "#ffe9c9",
            sunColor: "rgba(255, 240, 180, 0.95)",
            mountainColor: "rgba(255, 255, 255, 0.55)", mountainStyle: "hills",
            grassTop: "#e8f4fc", grassBottom: "#b2cfe6",
            hazeTop: "rgba(255, 255, 255, 0.4)", hazeBottom: "rgba(255,255,255,0)",
            shoulderA: "#8ba8c8", shoulderB: "#7c98b8",
            roadA: "#4c5a78", roadB: "#414e6a",
            curbA: "#ffd166", curbB: "#ffffff",
            lane: "rgba(255, 255, 255, 0.9)",
            mapBgTop: "#2c4a6a", mapBgBottom: "#16283e", mapGrass: "#cfe4f4",
        },
        checkpoints: [
            { x: 170, y: 130 },
            { x: 400, y: 75 },
            { x: 640, y: 120 },
            { x: 830, y: 85 },
            { x: 920, y: 230 },
            { x: 880, y: 400 },
            { x: 740, y: 520 },
            { x: 540, y: 570 },
            { x: 360, y: 505 },
            { x: 200, y: 570 },
            { x: 90, y: 440 },
            { x: 65, y: 260 },
        ],
        trackPath: [
            { x: 170, y: 130 },
            { x: 400, y: 75 },
            { x: 640, y: 120 },
            { x: 830, y: 85 },
            { x: 920, y: 230 },
            { x: 880, y: 400 },
            { x: 740, y: 520 },
            { x: 540, y: 570 },
            { x: 360, y: 505 },
            { x: 200, y: 570 },
            { x: 90, y: 440 },
            { x: 65, y: 260 },
        ],
        itemBoxes: [
            { x: 520, y: 96 },
            { x: 760, y: 100 },
            { x: 906, y: 316 },
            { x: 816, y: 466 },
            { x: 448, y: 542 },
            { x: 276, y: 532 },
            { x: 96, y: 350 },
            { x: 110, y: 190 },
        ],
        finishLine: { x1: 280, y1: 50, x2: 280, y2: 150 },
        startSide: { x: 280, y: 100 },
        spawnPoints: [
            { x: 242, y: 100 },
            { x: 222, y: 130 },
            { x: 260, y: 136 },
            { x: 202, y: 112 },
            { x: 234, y: 158 },
        ],
    },
    turbo: {
        // the biggest track of all — 4.5x scale, dusk skyline, loaded with
        // every trick feature: boost pads, loops, ramps, wall rides
        label: "Turbo City",
        lapsToWin: 2,
        color: "#ff4fa3",
        worldScale: 4.5,
        roadHalfWidth: 118,
        shoulderHalfWidth: 162,
        threeDOnly: true,
        racerCount: 24,
        decor: { types: ["arch", "star", "rock"], every: 4 },
        ramps: [{ t: 0.12 }, { t: 0.46, glide: true }, { t: 0.8 }],
        wallZones: [{ from: 0.2, to: 0.32, side: 1 }, { from: 0.6, to: 0.72, side: -1 }],
        boostPads: [{ t: 0.04 }, { t: 0.38 }, { t: 0.56 }, { t: 0.68 }, { t: 0.88 }, { t: 0.95 }],
        loops: [{ t: 0.26 }, { t: 0.84 }],
        movers: [{ t: 0.22, amplitude: 68, period: 2.3 }, { t: 0.62, amplitude: 65, period: 2.7 }],
        biome: {
            skyTop: "#ff8fcf", skyMid: "#7a5fc8", skyBottom: "#1c1440",
            sunColor: "rgba(255, 200, 240, 0.9)",
            mountainColor: "rgba(30, 20, 50, 0.9)", mountainStyle: "skyline",
            grassTop: "#3a2e58", grassBottom: "#1a1430",
            hazeTop: "rgba(255, 140, 220, 0.28)", hazeBottom: "rgba(255,255,255,0)",
            shoulderA: "#4a3a70", shoulderB: "#3a2d5c",
            // was only ~8 luminance units brighter than the grass — same
            // low-contrast issue found on Neon Loop and others, just not
            // as visually obvious here since this track's longer, gentler
            // curves keep the road wide in view rather than narrowing
            // sharply the way a tight loop does. Brightened preventively,
            // same hue.
            roadA: "#463a66", roadB: "#362c54",
            curbA: "#ff4fa3", curbB: "#53e0ff",
            lane: "rgba(255, 255, 255, 0.88)",
            mapBgTop: "#241a44", mapBgBottom: "#100c22", mapGrass: "#332852",
        },
        checkpoints: [
            { x: 180, y: 100 },
            { x: 420, y: 60 },
            { x: 660, y: 90 },
            { x: 860, y: 180 },
            { x: 910, y: 340 },
            { x: 840, y: 490 },
            { x: 660, y: 580 },
            { x: 440, y: 600 },
            { x: 240, y: 560 },
            { x: 100, y: 460 },
            { x: 60, y: 300 },
            { x: 100, y: 160 },
        ],
        trackPath: [
            { x: 180, y: 100 },
            { x: 420, y: 60 },
            { x: 660, y: 90 },
            { x: 860, y: 180 },
            { x: 910, y: 340 },
            { x: 840, y: 490 },
            { x: 660, y: 580 },
            { x: 440, y: 600 },
            { x: 240, y: 560 },
            { x: 100, y: 460 },
            { x: 60, y: 300 },
            { x: 100, y: 160 },
        ],
        itemBoxes: [
            { x: 300, y: 70 },
            { x: 550, y: 66 },
            { x: 770, y: 122 },
            { x: 896, y: 258 },
            { x: 880, y: 416 },
            { x: 754, y: 542 },
            { x: 550, y: 596 },
            { x: 336, y: 588 },
            { x: 158, y: 512 },
            { x: 70, y: 378 },
            { x: 68, y: 226 },
        ],
        finishLine: { x1: 210, y1: 40, x2: 210, y2: 140 },
        startSide: { x: 210, y: 90 },
        spawnPoints: [
            { x: 172, y: 90 },
            { x: 152, y: 120 },
            { x: 190, y: 126 },
            { x: 132, y: 102 },
            { x: 164, y: 148 },
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
    grandprix: {
        label: "Grand Prix",
        color: "#ffd166",
        maps: ["neon", "canyon", "metro", "boardwalk", "summit", "grove", "harbor", "foundry"],
    },
    world: {
        label: "World Tour",
        color: "#a06bff",
        maps: ["skyway", "savanna", "volcano", "fjord", "cloud", "turbo"],
    },
};

// enough names for the 24-racer grids on World maps (23 bots + 1 player)
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
    "Turbo",
    "Comet",
    "Gecko",
    "Willow",
    "Piper",
    "Zippy",
    "Bolt",
    "Mango",
    "Frost",
    "Rally",
    "Koda",
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

// Default single-seat controls: accepts arrows or WASD together, plus mouse steering.
const DEFAULT_CONTROLS = {
    up: ["ArrowUp", "KeyW"],
    down: ["ArrowDown", "KeyS"],
    left: ["ArrowLeft", "KeyA"],
    right: ["ArrowRight", "KeyD"],
    boost: ["Space"],
    drift: ["ShiftLeft", "KeyZ"],
    mouse: true,
};
// One-PC local multiplayer: each seat gets its own non-overlapping key group.
const LOCAL_CONTROL_SCHEMES = [
    { label: "Arrows + Space (drift: R-Shift)", up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"], boost: ["Space"], drift: ["ShiftRight"], mouse: true },
    { label: "WASD + L-Shift (drift: Q)", up: ["KeyW"], down: ["KeyS"], left: ["KeyA"], right: ["KeyD"], boost: ["ShiftLeft"], drift: ["KeyQ"], mouse: false },
    { label: "IJKL + U (drift: Y)", up: ["KeyI"], down: ["KeyK"], left: ["KeyJ"], right: ["KeyL"], boost: ["KeyU"], drift: ["KeyY"], mouse: false },
    { label: "Numpad 8/4/5/6 + 0 (drift: +)", up: ["Numpad8"], down: ["Numpad5"], left: ["Numpad4"], right: ["Numpad6"], boost: ["Numpad0"], drift: ["NumpadAdd"], mouse: false },
];

let localPlayerCount = 1;
// Up to 4 people can sign into their own hub profile right here for local
// split-screen — {name, dev} per seat once signed in, null while empty.
// Declared before buildRacerBlueprints' module-load call reads it below.
let localRoster = [null, null, null, null];
// which roster slot is "you" when playing solo (localPlayerCount === 1);
// -1 means no one's picked one, so the character-select name is used instead
let soloDriverSlot = -1;
// declared before buildRacerBlueprints' module-load call reads it for racerCount
let currentMapKey = "neon";
let currentCupKey = null;

// --- character & kart select: your driver appears on the kart and in the
// standings; the kart changes real handling stats (accel / top speed / grip)
const CHARACTERS = [
    { key: "fox", name: "Foxy", emoji: "🦊" },
    { key: "turtle", name: "Sheldon", emoji: "🐢" },
    { key: "unicorn", name: "Star", emoji: "🦄" },
    { key: "frog", name: "Hopper", emoji: "🐸" },
    { key: "panda", name: "Bamboo", emoji: "🐼" },
    { key: "robot", name: "Bolt-o", emoji: "🤖" },
    { key: "ghost", name: "Boo", emoji: "👻" },
    { key: "octopus", name: "Inky", emoji: "🐙" },
    { key: "rexy", name: "Rexy", emoji: "🦖" },
    { key: "dragon", name: "Spark", emoji: "🐲" },
    // Dino roster, big-kart-racer-style: one model, a whole shelf of
    // colors. There's no separate art per color here (this hub draws
    // characters as plain emoji), so each variant reuses the same 🦕 glyph
    // and recolors it with a canvas filter when drawn on the kart (see
    // drawCockpit) — the same "one model, many palette-swaps" trick the
    // real games use under the hood, just done with CSS filters instead of
    // texture swaps. green is the unfiltered baseline (the emoji's natural color).
    { key: "dino", name: "Dino", emoji: "🦕", filter: "none" },
    { key: "dino-red", name: "Red Dino", emoji: "🦕", filter: "hue-rotate(260deg) saturate(1.4)" },
    { key: "dino-blue", name: "Blue Dino", emoji: "🦕", filter: "hue-rotate(110deg) saturate(1.3)" },
    { key: "dino-yellow", name: "Yellow Dino", emoji: "🦕", filter: "hue-rotate(-50deg) saturate(1.5)" },
    { key: "dino-cyan", name: "Light-Blue Dino", emoji: "🦕", filter: "hue-rotate(80deg) saturate(1.3)" },
    { key: "dino-orange", name: "Orange Dino", emoji: "🦕", filter: "hue-rotate(-70deg) saturate(1.6)" },
    { key: "dino-pink", name: "Pink Dino", emoji: "🦕", filter: "hue-rotate(230deg) saturate(1.2) brightness(1.15)" },
    { key: "dino-black", name: "Black Dino", emoji: "🦕", filter: "saturate(0.15) brightness(0.42)" },
    { key: "dino-white", name: "White Dino", emoji: "🦕", filter: "saturate(0.1) brightness(1.9)" },
];
const KARTS = [
    { key: "balanced", name: "Cruiser", emoji: "🚗", desc: "All-rounder", accel: 1, top: 0, grip: 1 },
    { key: "speedster", name: "Speedster", emoji: "🏎️", desc: "Fastest, but slippery", accel: 0.9, top: 16, grip: 0.92 },
    { key: "zippy", name: "Zippy", emoji: "🛵", desc: "Quick off the line", accel: 1.18, top: -8, grip: 1.1 },
    { key: "truck", name: "Grip Truck", emoji: "🛻", desc: "Steady and grippy", accel: 0.97, top: 4, grip: 1.16 },
];
let selectedCharacterKey = "fox";
let selectedKartKey = "balanced";
// null = use the default seat-based racerPalette color (same "null = no
// override" convention as the profile's avatar field)
let selectedKartColor = null;

function getSelectedCharacter() {
    return CHARACTERS.find((c) => c.key === selectedCharacterKey) ?? CHARACTERS[0];
}

function getSelectedKart() {
    return KARTS.find((k) => k.key === selectedKartKey) ?? KARTS[0];
}

function buildRacerBlueprints() {
    const humanCount = clamp(localPlayerCount, 1, 4);
    const humans = Array.from({ length: humanCount }, (_, index) => {
        // split-screen: seat N uses whoever signed into roster slot N, in
        // order. Solo: use whichever roster slot the "Playing as" selector
        // points at, if any. Either way, fall back to the old defaults
        // (P1..P4 / the selected character's name) once nobody's signed in.
        const rosterName = humanCount > 1
            ? localRoster[index]?.name
            : (soloDriverSlot >= 0 ? localRoster[soloDriverSlot]?.name : null);
        // Solo play's kart color can be overridden by the picker/profile;
        // split-screen seats keep the plain seat-index palette assignment —
        // extending per-seat profile-backed color would mean threading
        // kartColor through the local-roster sign-in flow too, out of scope
        // for v1 (see the color picker's own comment for more).
        const color = (humanCount === 1 && index === 0 && selectedKartColor) || racerPalette[index % racerPalette.length];
        return {
            name: rosterName || (humanCount > 1 ? `P${index + 1}` : getSelectedCharacter().name),
            color,
            isPlayer: true,
            controls: { ...(humanCount > 1 ? LOCAL_CONTROL_SCHEMES[index] : DEFAULT_CONTROLS), seat: index },
        };
    });
    // World-scale maps run big-kart-racer-sized 24-racer grids; classic
    // tracks keep the original 13 (they're too tight for a bigger field)
    const totalSeats = maps[currentMapKey]?.racerCount ?? 13;
    const botCount = totalSeats - humanCount;
    const bots = botNames.slice(0, botCount).map((name, index) => ({
        name,
        color: racerPalette[(humanCount + index) % racerPalette.length],
    }));
    return [...humans, ...bots];
}

let racerBlueprints = buildRacerBlueprints();

function syncLocalPlayerUI() {
    localPlayerButtons.forEach((button) => {
        const n = Number(button.dataset.localPlayers);
        button.classList.toggle("is-selected", n === localPlayerCount);
    });
    if (localPlayerHint) {
        localPlayerHint.textContent = localPlayerCount <= 1
            ? "P1: Arrows/WASD + Space for items · hold Shift while turning to drift"
            : LOCAL_CONTROL_SCHEMES.slice(0, localPlayerCount)
                .map((scheme, index) => `P${index + 1}: ${scheme.label}`)
                .join("   ·   ");
    }
    syncSoloSelect();
}

function setLocalPlayerCount(count) {
    const next = clamp(count, 1, 4);
    if (next === localPlayerCount) return;
    if (next > 1 && mpConnected) {
        mpStatus.textContent = "Leave the wireless room first to use local split-screen.";
        return;
    }
    // split-screen clips ONE 2D canvas into N flat rectangles — meaningless
    // once that canvas is replaced by a headset's own stereo swapchain
    if (next > 1 && renderer3D?.xr?.isPresenting) {
        statusText.textContent = "Exit VR to add local players.";
        return;
    }
    localPlayerCount = next;
    racerBlueprints = buildRacerBlueprints();
    syncLocalPlayerUI();
    syncGamepadPanel();
    syncVRButton();
    applyMap(currentMapKey);
    resetRace();
    startButton.textContent = "Start Race";
    statusText.textContent = localPlayerCount > 1
        ? `Local split-screen: ${localPlayerCount} players on this PC.`
        : "Ready on the grid.";
    draw();
}

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

// How far round the track a racer really is, as one number that only goes up when they go round.
//
// Ranking used to be `lap * trackLength + progress`, but the lap counter only ticks over when a racer crosses
// the finish gate, which is a good way past the point where `progress` wraps back to 0. In between, a racer who
// had just completed a lap scored a whole lap LESS than everyone else (confirmed live: 1st to 24th right after a
// lap, and the AI's catch-up speed read the leader as miles behind). Instead, add up the progress each racer
// makes frame to frame (wrapping the small step across the seam), so the score never drops at the seam.
function wrapHalfTrack(delta) {
    const total = centerlinePath.length;
    return ((delta + total / 2) % total + total) % total - total / 2;
}

function updateTrackScores() {
    if (!centerlinePath.length || !racers.length) return;
    const lead = racers[0];
    if (!Number.isFinite(lead.trackScore)) {
        lead.lastTrackProgress = getNearestTrackProgress(lead);
        lead.trackScore = lead.lastTrackProgress;
    }
    racers.forEach((racer) => {
        const progress = getNearestTrackProgress(racer);
        if (!Number.isFinite(racer.trackScore)) {
            // first sighting (the start grid, or someone who just joined): line up with the first racer
            racer.trackScore = lead.trackScore + wrapHalfTrack(progress - lead.lastTrackProgress);
        } else {
            racer.trackScore += wrapHalfTrack(progress - racer.lastTrackProgress);
        }
        racer.lastTrackProgress = progress;
    });
}

function getRaceScore(racer) {
    return Number.isFinite(racer.trackScore)
        ? racer.trackScore
        : racer.lap * centerlinePath.length + getNearestTrackProgress(racer);
}

function getRaceRanking() {
    return racers
        .map((racer) => ({
            racer,
            score: getRaceScore(racer),
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
    const total = centerlinePath.length;
    // A pure global nearest-point search can snap to a totally different lap
    // segment when the track passes close to itself (a hairpin, a bridge
    // crossing) — the racer's actual position ends up geometrically nearer
    // to a segment far ahead/behind in real progress, causing their score
    // (and therefore place) to jump wildly for a frame or two (confirmed
    // live: 1st to 24th mid-lap). Racers carry checkpointIndex — the next
    // checkpoint they're validly working toward, only advanced by the
    // gated, direction-checked crossing logic below — so search only the
    // segments near it instead of the whole track. Plain points (initial
    // spawn placement etc.) have no checkpointIndex and keep the old
    // full-track search.
    let searchIndices;
    if (Number.isFinite(position.checkpointIndex)) {
        const hintIndex = (position.checkpointIndex * 10) % total;
        const span = 15;
        searchIndices = [];
        for (let offset = -span; offset <= span; offset += 1) {
            searchIndices.push(((hintIndex + offset) % total + total) % total);
        }
    } else {
        searchIndices = Array.from({ length: total }, (_, i) => i);
    }

    function search(indices) {
        let progress = 0;
        let distance = Infinity;
        for (const index of indices) {
            const start = centerlinePath[index];
            const end = centerlinePath[(index + 1) % total];
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
            const d = dist(position, closestPoint);
            if (d < distance) {
                distance = d;
                progress = index + projection;
            }
        }
        return { progress, distance };
    }

    const windowed = search(searchIndices);
    // The window is only a good bet when checkpointIndex is actually close
    // to the racer's real position — true while they're mid-race and
    // advancing normally, but not for a fresh spawn: every racer starts at
    // checkpointIndex 0 as a placeholder, and a mid/back starting-grid row
    // can sit well outside a ±15-sample window of checkpoint 0's location
    // (confirmed live: bots and the player both reading as permanently
    // off-track from the green light, in a big grid-start pileup, since
    // their spawn point genuinely was that far from the nearest point the
    // window could see). A result that's absurdly far from the actual
    // position is a sign the hint was wrong, not that the racer really is
    // that far from the track — fall back to the full search rather than
    // trusting it.
    if (Number.isFinite(position.checkpointIndex) && windowed.distance > shoulderHalfWidth + 40) {
        return search(Array.from({ length: total }, (_, i) => i)).progress;
    }
    return windowed.progress;
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
    const cameraState = player.cameraState;
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
    // during a spin-out crash animation racer.angle is overwritten every frame to
    // whirl through two full rotations for the visual tumble (see updateRacer) —
    // the camera must not chase that raw value or it whirls too, so use the
    // heading from just before the crash instead and hold a sane view of the road
    const steadyPlayerAngle = player.spinTimer > 0 ? player.spinBaseAngle : player.angle;
    const targetAngle = trackAngle + wrapAngle(steadyPlayerAngle - trackAngle) * playerInfluence;
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

    const horizon = HEIGHT * (cameraMode.horizonBase - speedFactor * cameraMode.horizonSpeed);
    lastCameraHorizon = horizon;

    return {
        x: cameraState.x,
        y: cameraState.y,
        forward,
        right,
        height: cameraMode.heightBase + speedFactor * cameraMode.heightSpeed,
        horizon,
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

// Like projectWorldPoint, but for ground-level pickups and decals (coins,
// item boxes, boost pads, ramps, loop rings) placed near turns.
// projectWorldPoint rejects a point outright once its "forward" component
// dips to/below the near plane — fine for the long, continuous road (handled
// separately), but these are short-lived props that sit right where the
// player is about to be, and a single fixed camera-forward-for-the-frame can
// drift enough on a turn to reject a point that's genuinely right in front
// of the kart. The decal would then vanish exactly as the player approaches
// it — the pickup still triggers (world-space distance check, unrelated to
// the camera), but there is no visual confirmation.
//
// Depth (and therefore on-screen size/closeness) is based on the point's
// true 3D distance from the camera, NOT the camera-forward-axis component —
// using "forward" alone (or flooring it at half of trueDistance, an earlier
// version of this function) makes the prop read as noticeably closer than it
// actually is whenever the camera's angle lags the true bearing, which is
// exactly what happens approaching a turn. trueDistance keeps the prop's
// apparent distance in agreement with the 2D minimap and the world-space
// pickup trigger at all times, while still never rejecting the point (so it
// never vanishes) and staying stable as the camera passes right over it.
function projectGroundPoint(x, y, height, camera) {
    const dx = x - camera.x;
    const dy = y - camera.y;
    const lateral = dx * camera.right.x + dy * camera.right.y;
    const forward = dx * camera.forward.x + dy * camera.forward.y;
    const trueDistance = Math.hypot(dx, dy);
    const depth = Math.max(trueDistance, camera.nearPlane * 0.6);
    const scale = Math.min(camera.projection / depth, 10);
    return {
        x: CENTER.x + lateral * scale,
        y: camera.horizon + (camera.height - height) * scale,
        scale,
        depth,
        forward,
    };
}

// For a flat, multi-corner ground decal (boost pad chevron, ramp quad, loop
// entry line): projecting each corner independently through
// projectGroundPoint gives each one its OWN true-distance-based scale, and
// up close those scales can diverge sharply between corners just a few
// world units apart — turning what should be a flat rectangle/chevron into
// a warped, spiky shape (screenshotted as looking like a stray "hand").
// Real perspective foreshortening (the near edge of a flat decal legitimately
// looking wider than the far edge) is fine and expected; per-corner scale
// *disagreement* on top of that is not. The fix: compute ONE shared scale
// from the decal's own anchor point (its center, projected normally) and
// reuse that same scale for every corner's size — corners still get their
// own screen X/Y from their own lateral offset and height, so the decal
// still skews correctly with viewing angle, it just no longer balloons
// unevenly corner-to-corner.
function projectGroundPointAtScale(x, y, height, camera, scale) {
    const dx = x - camera.x;
    const dy = y - camera.y;
    const lateral = dx * camera.right.x + dy * camera.right.y;
    return {
        x: CENTER.x + lateral * scale,
        y: camera.horizon + (camera.height - height) * scale,
        scale,
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
    const air = racer.airHeight || 0; // ramp jumps / glides lift the sprite off the ground
    return {
        depth,
        rearBias: clamp(inverseLerp(camera.nearPlane, -20, forward), 0, 1),
        base: {
            x: CENTER.x + lateral * scale,
            y: camera.horizon + (camera.height - air) * scale,
        },
        top: {
            x: CENTER.x + lateral * scale,
            y: camera.horizon + (camera.height - air - 24) * scale,
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

function createRacer(name, color, x, y, isPlayer = false, controls = DEFAULT_CONTROLS) {
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
        lapArmed: false,
        boostTimer: 0,
        invulnTimer: 0,
        isPlayer,
        controls,
        cameraState: { x: 0, y: 0, angle: -Math.PI / 2, modeKey: null },
        // player stats fold in the selected kart's accel/top-speed/grip profile
        accelMultiplier: isPlayer ? 1.14 * getSelectedKart().accel : 1,
        topSpeedBonus: isPlayer ? 10 + getSelectedKart().top : 0,
        steerGrip: isPlayer ? 1.08 * getSelectedKart().grip : 1,
        characterEmoji: isPlayer ? getSelectedCharacter().emoji : null,
        characterFilter: isPlayer ? (getSelectedCharacter().filter ?? "none") : "none",
        coastDrag: isPlayer ? 1.5 : 1.7,
        brakePower: isPlayer ? 172 : 160,
        aiPace: isPlayer ? 0 : difficulty.aiPaceMin + Math.random() * (difficulty.aiPaceMax - difficulty.aiPaceMin),
        aiLaneBias: isPlayer ? 0 : clamp(laneSeed * 0.55, -0.55, 0.55),
        // Centerline resolution is a fixed 10 samples per checkpoint segment
        // (see buildCenterlinePath below), so a lookahead this large — over
        // half a whole segment, sometimes nearly reaching the next checkpoint
        // — cuts corners hard enough that AI racers could miss a checkpoint's
        // 48-unit trigger radius entirely on a tight turn near it, getting
        // permanently stuck unable to ever complete a lap. Scaled down to a
        // fraction of a segment instead of a large chunk of one.
        aiLookAhead: isPlayer ? 0 : 1.6 + Math.random() * 1.2,
        previousSide: x < startSide.x,
        finished: false,
        place: 1,
        driftEnergy: 0,
        gateLockTimer: 0,
        stuckTimer: 0,
        offRoadTimer: 0,
        isFalling: false,
        fallTimer: 0,
        coins: 0,
        item: null,
        shieldTimer: 0,
        spinTimer: 0,
        drifting: false,
        driftCharge: 0,
        hopTimer: 0,
        airTimer: 0,
        airTotal: 0,
        airHeight: 0,
        gliding: false,
        rampLock: 0,
        padLock: 0,
        loopTimer: 0,
        loopTotal: 0,
        wallCharge: 0,
        wallSide: 0,
        oilCooldown: 0,
        aiItemDelay: 0.8 + Math.random() * 2.2,
    };
}

function alignRacerToTrack(racer) {
    // Only called at spawn/reset, when every racer's checkpointIndex is
    // still its freshly-created placeholder value of 0 — not a real "next
    // checkpoint" hint yet. Passing the racer straight into
    // getNearestTrackProgress made it look like a real mid-race position and
    // triggered the narrow windowed search centered on checkpoint 0, instead
    // of the full-track search spawn placement actually needs; whichever
    // grid row/lane didn't happen to land within that window snapped to the
    // wrong point on the track and read as off-road from the first frame
    // (confirmed live: bots and the player both immediately falling "off
    // track" at race start). A plain {x, y} point has no checkpointIndex, so
    // it takes the full-track search this call was always meant to get.
    const progress = getNearestTrackProgress({ x: racer.x, y: racer.y });
    const direction = getCenterlineDirection(progress + 0.75);
    racer.angle = Math.atan2(direction.y, direction.x);
    racer.prevX = racer.x;
    racer.prevY = racer.y;
    racer.previousSide = racer.x < startSide.x;
}

function respawnRacerAtLastCheckpoint(racer) {
    const targetIndex = racer.checkpointIndex % checkpoints.length;
    const lastIndex = (targetIndex - 1 + checkpoints.length) % checkpoints.length;
    const checkpoint = checkpoints[lastIndex];
    const approach = checkpointApproachVector(targetIndex);
    const facing = normalizeVector(approach.x, approach.y);
    racer.x = checkpoint.x + facing.x * 12;
    racer.y = checkpoint.y + facing.y * 12;
    racer.prevX = racer.x;
    racer.prevY = racer.y;
    racer.angle = Math.atan2(facing.y, facing.x);
    racer.speed = 0;
    racer.gateLockTimer = 0.4;
    racer.offRoadTimer = 0;
    racer.invulnTimer = Math.max(racer.invulnTimer, 0.6);
    if (racer.isPlayer) {
        raceNotice("Off track! Back to the last checkpoint.");
        playRespawnSound();
    }
}

let racers = [];
let boostParticles = [];

function spawnBoostParticle(racer) {
    const back = 16 + Math.random() * 6;
    const spread = (Math.random() - 0.5) * 10;
    const backX = -Math.cos(racer.angle);
    const backY = -Math.sin(racer.angle);
    const sideX = -Math.sin(racer.angle);
    const sideY = Math.cos(racer.angle);
    const kick = 36 + Math.random() * 26;
    const life = 0.32 + Math.random() * 0.22;
    boostParticles.push({
        x: racer.x + backX * back + sideX * spread,
        y: racer.y + backY * back + sideY * spread,
        vx: backX * kick + sideX * (Math.random() - 0.5) * 14,
        vy: backY * kick + sideY * (Math.random() - 0.5) * 14,
        life,
        maxLife: life,
        size: 3 + Math.random() * 2.6,
        color: Math.random() < 0.35 ? "255,255,255" : "83,224,255",
    });
    if (boostParticles.length > 220) {
        boostParticles.splice(0, boostParticles.length - 220);
    }
}

function updateBoostParticles(dt) {
    for (let index = boostParticles.length - 1; index >= 0; index -= 1) {
        const particle = boostParticles[index];
        particle.life -= dt;
        if (particle.life <= 0) {
            boostParticles.splice(index, 1);
            continue;
        }
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vx *= 1 - 2.2 * dt;
        particle.vy *= 1 - 2.2 * dt;
    }
}

function spawnDriftSpark(racer, color) {
    if (Math.random() > 0.55) return; // sparse sparks
    const back = 12 + Math.random() * 5;
    const backX = -Math.cos(racer.angle);
    const backY = -Math.sin(racer.angle);
    const sideX = -Math.sin(racer.angle);
    const sideY = Math.cos(racer.angle);
    const side = (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 4);
    const life = 0.22 + Math.random() * 0.16;
    const rgb = color === "#ff9f43" ? "255,159,67" : "83,224,255";
    boostParticles.push({
        x: racer.x + backX * back + sideX * side,
        y: racer.y + backY * back + sideY * side,
        vx: backX * 26 + sideX * side * 3,
        vy: backY * 26 + sideY * side * 3,
        life,
        maxLife: life,
        size: 2.4 + Math.random() * 2,
        color: rgb,
    });
}

// --- items: rockets, oil slicks, coins ---
let projectiles = [];
let trackHazards = [];
let trackCoins = [];

// status messages during a race are normally overwritten every frame by the
// place/leader line; raceNotice keeps one visible for a couple of seconds
let raceNoticeText = "";
let raceNoticeTimer = 0;

function raceNotice(text, seconds = 2) {
    raceNoticeText = text;
    raceNoticeTimer = seconds;
    statusText.textContent = text;
}

function buildTrackCoins() {
    const result = [];
    if (!centerlinePath.length) return result;
    const step = Math.max(2, Math.floor(centerlinePath.length / 24));
    for (let i = 4; i < centerlinePath.length; i += step) {
        const point = centerlinePath[i];
        const direction = getCenterlineDirection(i);
        const normal = { x: -direction.y, y: direction.x };
        const lane = ((i / step) % 3 - 1) * roadHalfWidth * 0.42;
        result.push({
            x: point.x + normal.x * lane,
            y: point.y + normal.y * lane,
            active: true,
            respawnTimer: 0,
        });
    }
    return result;
}

// Trackside scenery for World maps: purely-visual billboards (trees, rocks,
// crystals, glowing stars...) scattered just beyond the shoulder, so the huge
// open maps feel like places instead of a road floating in empty ground.
// Placement is procedural along the centerline, with a deterministic
// pseudo-random offset per slot (a hash, not Math.random()) so the scenery is
// stable between frames and identical every time you race the map.
let trackDecorations = [];
// ramps: { x, y, progress, glide, dirX, dirY } in world space
let trackRamps = [];
// wall zones: { from, to, side } as fractions of the lap (side: -1 left, 1 right)
let trackWallZones = [];
// boost pads and loop rings share the ramp shape: { x, y, progress, dirX, dirY }
let trackBoostPads = [];
let trackLoops = [];
// moving hazards: patrol back and forth across the road from a fixed base
// point; { x, y, dirX, dirY, amplitude, period, phase, radius } + a live
// { liveX, liveY } updated every tick from raceElapsed (see updateTrackMovers)
let trackMovers = [];

function moverLivePosition(mover, elapsed) {
    const across = { x: -mover.dirY, y: mover.dirX };
    const offset = Math.sin((elapsed / mover.period) * Math.PI * 2 + mover.phase) * mover.amplitude;
    return { x: mover.x + across.x * offset, y: mover.y + across.y * offset };
}

// shared resolver: config entries { t: fractionOfLap } -> world-space features
function buildTrackFeatures(entries, extras = () => ({})) {
    if (!entries || !centerlinePath.length) return [];
    return entries.map((entry) => {
        const progress = entry.t * centerlinePath.length;
        const center = getCenterlinePoint(progress);
        const direction = getCenterlineDirection(progress);
        return {
            x: center.x,
            y: center.y,
            progress,
            dirX: direction.x,
            dirY: direction.y,
            ...extras(entry),
        };
    });
}

function buildTrackRamps(map) {
    return buildTrackFeatures(map.ramps, (entry) => ({ glide: Boolean(entry.glide) }));
}

function buildTrackDecorations(map) {
    const config = map.decor;
    if (!config || !centerlinePath.length) return [];
    const result = [];
    const every = Math.max(2, config.every ?? 4);
    for (let i = 0; i < centerlinePath.length; i += every) {
        const point = centerlinePath[i];
        const direction = getCenterlineDirection(i);
        const normal = { x: -direction.y, y: direction.x };
        const hash = Math.abs(Math.sin(i * 12.9898 + 78.233) * 43758.5453) % 1;
        const side = i % (every * 2) === 0 ? -1 : 1;
        const offset = shoulderHalfWidth + 60 + hash * 150;
        result.push({
            x: point.x + normal.x * side * offset,
            y: point.y + normal.y * side * offset,
            type: config.types[i % config.types.length],
            size: 0.8 + hash * 0.7,
        });
    }
    return result;
}

function spinOut(racer, cause) {
    // God Mode: immune to rockets/oil/hazards/lightning specifically —
    // deliberately narrower than Fly (which also skips falling and
    // physical collisions), so the two toggles do genuinely different
    // things: this one keeps you driving normally on the track, just
    // unbothered by anything that would spin you out.
    if (racer.isPlayer && devGodModeEnabled && isDevProfileActive()) return;
    if (racer.isFalling || racer.finished || racer.invulnTimer > 0) return;
    if (racer.shieldTimer > 0) {
        racer.shieldTimer = 0;
        racer.invulnTimer = Math.max(racer.invulnTimer, 0.8);
        if (racer.isPlayer) {
            raceNotice("Shield blocked it!");
            playPickupSound();
        }
        return;
    }
    racer.spinTimer = SPIN_OUT_DURATION;
    racer.spinBaseAngle = racer.angle;
    racer.speed = Math.min(racer.speed, 16);
    racer.driftCharge = 0;
    racer.drifting = false;
    racer.coins = Math.max(0, racer.coins - 1);
    if (racer.isPlayer) {
        raceNotice(cause === "rocket" ? "Hit by a rocket!" : cause === "mover" ? "Clobbered by a hazard!" : "Spun out on oil!");
        playErrorSound();
    }
}

function fireRocket(shooter) {
    // lock on to the nearest racer ahead of the shooter
    let target = null;
    let bestDistance = Infinity;
    const shooterScore = getRaceScore(shooter);
    racers.forEach((other) => {
        if (other === shooter || other.finished || other.isFalling) return;
        const otherScore = getRaceScore(other);
        if (otherScore <= shooterScore) return;
        const distance = dist(shooter, other);
        if (distance < bestDistance && distance < 520) {
            bestDistance = distance;
            target = other;
        }
    });
    projectiles.push({
        x: shooter.x + Math.cos(shooter.angle) * 24,
        y: shooter.y + Math.sin(shooter.angle) * 24,
        angle: shooter.angle,
        speed: 250,
        life: 3.2,
        target,
        shooter,
    });
    if (shooter.isPlayer) {
        raceNotice(target ? `Rocket locked on ${target.name}!` : "Rocket away!");
    }
    playBoostSound();
}

function dropOil(dropper) {
    trackHazards.push({
        x: dropper.x - Math.cos(dropper.angle) * 26,
        y: dropper.y - Math.sin(dropper.angle) * 26,
        life: 18,
        dropper,
        armTimer: 0.7, // don't spin out the dropper as they pull away
    });
    if (dropper.isPlayer) {
        raceNotice("Oil slick dropped behind you.");
    }
}

function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i -= 1) {
        const rocket = projectiles[i];
        rocket.life -= dt;
        if (rocket.life <= 0) {
            projectiles.splice(i, 1);
            continue;
        }
        if (rocket.target && !rocket.target.finished && !rocket.target.isFalling) {
            const targetAngle = Math.atan2(rocket.target.y - rocket.y, rocket.target.x - rocket.x);
            rocket.angle = lerpAngle(rocket.angle, targetAngle, 6 * dt);
        }
        rocket.x += Math.cos(rocket.angle) * rocket.speed * dt;
        rocket.y += Math.sin(rocket.angle) * rocket.speed * dt;
        for (const racer of racers) {
            if (racer === rocket.shooter || racer.finished || racer.isFalling) continue;
            if (dist(rocket, racer) < 20) {
                spinOut(racer, "rocket");
                projectiles.splice(i, 1);
                break;
            }
        }
    }
}

function updateTrackHazards(dt) {
    for (let i = trackHazards.length - 1; i >= 0; i -= 1) {
        const hazard = trackHazards[i];
        hazard.life -= dt;
        hazard.armTimer = Math.max(0, hazard.armTimer - dt);
        if (hazard.life <= 0) {
            trackHazards.splice(i, 1);
            continue;
        }
        for (const racer of racers) {
            if (racer.finished || racer.isFalling || racer.spinTimer > 0) continue;
            if (hazard.armTimer > 0 && racer === hazard.dropper) continue;
            if (dist(hazard, racer) < 18) {
                spinOut(racer, "oil");
                trackHazards.splice(i, 1);
                break;
            }
        }
    }
}

// moving hazards: sweep back and forth across the road on their own clock
// (not tied to any racer), so everyone has to time their approach — unlike
// oil slicks they never expire, so spinTimer (a racer freshly spun out is
// briefly invulnerable via the same guard oil hazards use) is what stops a
// racer getting re-hit every frame while still overlapping one.
function updateTrackMovers(dt) {
    if (!trackMovers.length) return;
    trackMovers.forEach((mover) => {
        const live = moverLivePosition(mover, raceElapsed);
        mover.liveX = live.x;
        mover.liveY = live.y;
    });
    for (const racer of racers) {
        if (racer.finished || racer.isFalling || racer.spinTimer > 0) continue;
        for (const mover of trackMovers) {
            if (dist(racer, { x: mover.liveX, y: mover.liveY }) < mover.radius + 14) {
                spinOut(racer, "mover");
                break;
            }
        }
    }
}

function updateTrackCoins(dt) {
    trackCoins.forEach((coin) => {
        if (!coin.active) {
            coin.respawnTimer -= dt;
            if (coin.respawnTimer <= 0) coin.active = true;
            return;
        }
        for (const racer of racers) {
            if (racer.finished || racer.isFalling || racer.coins >= COIN_MAX) continue;
            if (dist(coin, racer) < 18) {
                coin.active = false;
                coin.respawnTimer = 6;
                racer.coins = Math.min(COIN_MAX, racer.coins + 1);
                if (racer.isPlayer) playPickupSound();
                break;
            }
        }
    });
}

function useItem(racer) {
    if (!racer.item) return;
    const item = racer.item;
    racer.item = null;
    // Refills immediately — the item-box pickup flow (line ~4870ish) still
    // refuses to hand out a new one while racer.item is set, so this has to
    // restore it here, right after the normal consumption, not rely on
    // that pickup path. "same" repeats whatever was just used; otherwise
    // the panel's Item choice pins it to one specific item regardless of
    // what actually gets used.
    if (racer.isPlayer && devInfiniteItemsEnabled && isDevProfileActive()) {
        racer.item = devInfiniteItemsChoice === "same" ? item : devInfiniteItemsChoice;
    }
    if (item === "boost") {
        racer.boostTimer = Math.max(racer.boostTimer, racer.isPlayer ? getDifficultySetting().boostTime : 0.6);
        racer.speed = Math.max(racer.speed, MAX_SPEED + BOOST_KICK);
        racer.invulnTimer = Math.max(racer.invulnTimer, 0.4);
        if (racer.isPlayer) playBoostSound();
    } else if (item === "rocket") {
        fireRocket(racer);
    } else if (item === "shield") {
        racer.shieldTimer = 12;
        if (racer.isPlayer) {
            raceNotice("Shield up!");
            playPickupSound();
        }
    } else if (item === "oil") {
        dropOil(racer);
    } else if (item === "star") {
        // invincibility star: can't be hit, big speed, for a few seconds
        racer.invulnTimer = Math.max(racer.invulnTimer, 3.2);
        racer.shieldTimer = Math.max(racer.shieldTimer, 3.2);
        racer.boostTimer = Math.max(racer.boostTimer, 3.2);
        racer.speed = Math.max(racer.speed, MAX_SPEED + BOOST_KICK);
        if (racer.isPlayer) {
            raceNotice("⭐ STAR POWER!", 1.6);
            playGoSound();
        }
    } else if (item === "lightning") {
        // zap every other racer: spin-out + speed cut, like the classic
        racers.forEach((other) => {
            if (other === racer || other.finished) return;
            spinOut(other, "lightning");
            other.speed *= 0.4;
        });
        if (racer.isPlayer) {
            raceNotice("⚡ Lightning strike!", 1.6);
            playErrorSound();
        }
    } else if (item === "coinbag") {
        racer.coins = Math.min(10, racer.coins + 3);
        if (racer.isPlayer) {
            raceNotice("💰 +3 coins!", 1.2);
            playPickupSound();
        }
    } else if (item === "boo") {
        // steals coins from the nearest racer ahead — same "nearest racer
        // ahead" targeting fireRocket uses, but a pure coin transfer instead
        // of a hit, so it's safe to use even mid-pack with no one in range.
        let target = null;
        let bestDistance = Infinity;
        const racerScore = getRaceScore(racer);
        racers.forEach((other) => {
            if (other === racer || other.finished || other.isFalling) return;
            const otherScore = getRaceScore(other);
            if (otherScore <= racerScore) return;
            const distance = dist(racer, other);
            if (distance < bestDistance) {
                bestDistance = distance;
                target = other;
            }
        });
        if (target && target.coins > 0) {
            const stolen = Math.min(target.coins, 3);
            target.coins -= stolen;
            racer.coins = Math.min(COIN_MAX, racer.coins + stolen);
            if (racer.isPlayer) {
                raceNotice(`👻 Boo! Stole ${stolen} coin${stolen === 1 ? "" : "s"} from ${target.name}.`, 1.4);
                playPickupSound();
            } else if (target.isPlayer) {
                raceNotice(`👻 ${racer.name} booed you for ${stolen} coin${stolen === 1 ? "" : "s"}!`, 1.4);
            }
        } else if (racer.isPlayer) {
            raceNotice("👻 Boo! No coins to steal nearby.", 1.2);
        }
    }
}


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
        angleTrackOffset: 0.3,
        playerInfluenceBase: 0.4,
        playerInfluenceSpeed: 0.3,
        playerInfluenceMin: 0.55,
        angleLerpBase: 0.2,
        angleLerpSpeed: 0.07,
        followDistanceBase: 64,
        followDistanceSpeed: 24,
        lookAheadBase: 3.2,
        lookAheadSpeed: 1.1,
        focusBlend: 0.3,
        positionLerp: 0.18,
        heightBase: 118,
        heightSpeed: 10,
        horizonBase: 0.33,
        horizonSpeed: 0.02,
        projectionBase: 690,
        projectionSpeed: 80,
        nearPlane: 10,
        offsetRightBase: 5,
        offsetRightSpeed: 2,
        showCockpit: true,
    },
];

/* Retuned toward big kart racers' daylight look. The old day palette was a
   dusk one wearing a blue sky: a near-black horizon, hills painted almost
   black, grass darker than the road. MKW's world is the opposite of all
   three — sunlit, high-key, and governed by aerial perspective, where
   distance washes things *toward* the pale sky rather than toward black.
   That single idea drives most of the numbers below:
     - skyBottom is now paler than skyMid, not darker, so the horizon glows
     - mountains are a translucent haze blue, dissolving into that horizon
     - grassTop (at the horizon) is lighter than grassBottom (underfoot)
     - the road is warm light asphalt, clearly brighter than the verge
   Per-map biomes (see maps[].biome) still override any of these wholesale,
   so the stylised tracks — Rainbow Skyway, Volcano Rim — keep their own
   identity; this is the base every unstyled map inherits. */
const themePalettes = {
    day: {
        skyTop: "#2e9bec",
        skyMid: "#7fd2ff",
        skyBottom: "#dff2fb",
        sunColor: "rgba(255, 249, 214, 0.95)",
        mountainColor: "rgba(122, 172, 210, 0.62)",
        grassTop: "#7cc95a",
        grassBottom: "#3d9c37",
        hazeTop: "rgba(226, 245, 255, 0.42)",
        hazeBottom: "rgba(255,255,255,0)",
        shoulderA: "#63b544",
        shoulderB: "#54a33a",
        roadA: "#828593",
        roadB: "#717484",
        curbA: "#ff4b4b",
        curbB: "#fff8e8",
        lane: "rgba(255,255,255,0.9)",
        farFog: "rgba(222, 242, 255, __ALPHA__)",
        finish: "rgba(255, 252, 236, 0.96)",
        mapBgTop: "#2b5f8f",
        mapBgBottom: "#17395c",
        mapGrass: "#3d8f43",
    },
    night: {
        // Night keeps its mood but stops being unlit: MKW's evening tracks
        // still have a bright horizon and readable ground, they're just
        // cooler and lower-contrast than the day ones.
        skyTop: "#111f45",
        skyMid: "#254a86",
        skyBottom: "#5b86b8",
        sunColor: "rgba(255, 240, 196, 0.92)",
        mountainColor: "rgba(38, 64, 108, 0.78)",
        grassTop: "#3f8a4c",
        grassBottom: "#1f5330",
        hazeTop: "rgba(158, 196, 255, 0.3)",
        hazeBottom: "rgba(255,255,255,0)",
        cloudTop: "rgba(196, 214, 246, 0.8)",
        cloudShade: "rgba(96, 124, 172, 0.72)",
        shoulderA: "#367a52",
        shoulderB: "#2a6041",
        roadA: "#525a70",
        roadB: "#454c60",
        curbA: "#f06868",
        curbB: "#e6ecff",
        lane: "rgba(238, 244, 255, 0.82)",
        farFog: "rgba(196, 218, 255, __ALPHA__)",
        finish: "rgba(255, 246, 210, 0.96)",
        mapBgTop: "#1f3560",
        mapBgBottom: "#0e1c33",
        mapGrass: "#215a35",
    },
};

function getThemePalette() {
    const base = themePalettes[dayNightMode] ?? themePalettes.night;
    // each map carries its own biome (sky/ground/road tint + horizon silhouette
    // style) so tracks read as distinct places rather than reskins of one map
    const biome = maps[currentMapKey]?.biome;
    return biome ? { ...base, ...biome } : base;
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
        overlayDescription.textContent = `${cup.label}: race ${cup.maps.length} tracks in order and build the most points across the cup.`;
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

// Walks backward from a progress value by a real-world distance along the
// track, one centerline sample at a time — needed because a fixed step in
// sample-index units (the old approach) doesn't mean the same thing on two
// different maps: Neon Loop's whole loop is only 60 samples, so a handful
// of index-units per grid row could already be a big fraction of the track,
// while a bigger/more-subdivided map barely moves. Real distance keeps the
// starting grid roughly the same physical size everywhere.
function stepProgressBackward(startProgress, worldDistance) {
    const total = centerlinePath.length;
    let index = Math.floor(((startProgress % total) + total) % total);
    let amount = startProgress - Math.floor(startProgress);
    let remaining = worldDistance;
    while (remaining > 0) {
        const a = centerlinePath[index];
        const b = centerlinePath[(index + 1) % total];
        const segLen = dist(a, b) || 1;
        const distIntoSeg = amount * segLen;
        if (distIntoSeg >= remaining) {
            amount -= remaining / segLen;
            remaining = 0;
        } else {
            remaining -= distIntoSeg;
            index = (index - 1 + total) % total;
            amount = 1;
        }
    }
    return index + amount;
}

// A real kart-racer grid is two karts wide, staggered rows extending back
// from the start line — not what this used to build: a handful of
// hand-placed points per map (however many that map's author happened to
// add), topped up by a single-file zigzag for whatever racers were left
// over. Generated the same way on every map now, so every map gets a
// proper grid regardless of how much spawn data it originally shipped with
// — and in real world distance (see stepProgressBackward), not a fixed
// step in centerline sample count, which is what let back-row racers land
// far enough from the start line to read as instantly "off track" on
// tightly-subdivided maps like Neon Loop (confirmed live: bots and the
// player both flagged off-road from the green light).
function buildRaceSpawnPoints(layout, racerCount) {
    const baseProgress = getNearestTrackProgress(layout.startSide);
    const rowSpacing = 44;
    const laneOffset = Math.min(roadHalfWidth * 0.42, 30);
    const points = [];
    for (let index = 0; index < racerCount; index += 1) {
        const row = Math.floor(index / 2);
        const col = index % 2; // 0 = left, 1 = right, alternating each row
        const progress = row === 0 ? baseProgress : stepProgressBackward(baseProgress, row * rowSpacing);
        const center = getCenterlinePoint(progress);
        const direction = getCenterlineDirection(progress);
        const normal = { x: -direction.y, y: direction.x };
        const side = col === 0 ? -1 : 1;
        points.push({
            x: center.x + normal.x * side * laneOffset,
            y: center.y + normal.y * side * laneOffset,
        });
    }
    return points;
}

function applyMap(mapKey) {
    const map = maps[mapKey] ?? maps.neon;
    currentMapKey = maps[mapKey] ? mapKey : "neon";
    // world-scale maps are 3D-only — too big for the 2D tactical map to frame
    if (map.threeDOnly && renderMode !== "3d") {
        renderMode = "3d";
    }
    syncModeButton();
    // roster size is per-map (24-racer grids on World maps), so rebuild it here
    racerBlueprints = buildRacerBlueprints();
    const layout = buildScaledMapLayout(map);

    checkpoints = layout.checkpoints;
    trackPath = layout.trackPath;
    itemBoxes = layout.itemBoxes.map((box) => ({ ...box, active: true, respawnTimer: 0 }));
    finishLine = layout.finishLine;
    startSide = layout.startSide;
    roadHalfWidth = map.roadHalfWidth ?? 72;
    shoulderHalfWidth = map.shoulderHalfWidth ?? 104;
    centerlinePath = buildCenterlinePath(checkpoints, 10);
    // widen the finish gate to span the whole road: the hand-authored lanes were
    // narrower than the road itself, so mid-road crossings missed the gate and
    // laps silently failed to count
    const startCenter = getCenterlinePoint(getNearestTrackProgress(startSide));
    const gateHalfSpan = shoulderHalfWidth + 8;
    finishLine = {
        x1: finishLine.x1,
        x2: finishLine.x2,
        y1: startCenter.y - gateHalfSpan,
        y2: startCenter.y + gateHalfSpan,
    };
    // Fit the map views to the actual road (checkpoints/centerlinePath) with a
    // margin, not the separate trackPath array — trackPath is a differently
    // shaped, unrelated point set (see drawTrack2D's grass outline) and using
    // it here made the 2D map and mini-map fit/scale around the wrong shape.
    worldBounds = computeWorldBounds(
        centerlinePath.map((point) => scalePoint(point, centerOfPoints(checkpoints), 1.35)),
    );
    trackCoins = buildTrackCoins();
    trackDecorations = buildTrackDecorations(map);
    trackRamps = buildTrackRamps(map);
    trackBoostPads = buildTrackFeatures(map.boostPads);
    trackLoops = buildTrackFeatures(map.loops);
    trackMovers = buildTrackFeatures(map.movers, (entry) => ({
        amplitude: entry.amplitude ?? 70,
        period: entry.period ?? 2.6,
        phase: entry.phase ?? Math.random() * Math.PI * 2,
        radius: entry.radius ?? 26,
    })).map((mover) => ({ ...mover, liveX: mover.x, liveY: mover.y }));
    trackWallZones = (map.wallZones ?? []).map((zone) => ({ ...zone }));
    projectiles = [];
    trackHazards = [];
    const raceSpawnPoints = buildRaceSpawnPoints(layout, racerBlueprints.length);

    racerLoadout = racerBlueprints.map((racer, index) => ({
        ...racer,
        ...raceSpawnPoints[index],
    }));
    racers = racerLoadout.map((entry) =>
        createRacer(entry.name, entry.color, entry.x, entry.y, entry.isPlayer, entry.controls),
    );
    racers.forEach(alignRacerToTrack);
    racers.forEach((racer) => {
        racer.cameraState.x = racer.x;
        racer.cameraState.y = racer.y;
        racer.cameraState.angle = racer.angle;
    });
    syncMapUI();
    syncCupUI();
    build3DScene();
}

let running = false;
let loopActive = false;
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
let hdrEnabled = true;
let currentCameraMode = "chase";
let lastCameraHorizon = HEIGHT * 0.35; // updated by createCamera(); used to keep bloom off the sky

// HDR post-processing: quarter-res buffer for the bloom pass
const bloomCanvas = document.createElement("canvas");
bloomCanvas.width = Math.round(WIDTH / 4);
bloomCanvas.height = Math.round(HEIGHT / 4);
const bloomCtx = bloomCanvas.getContext("2d");
let dayNightMode = "day";
let autoSteerEnabled = false;
let miniMapEnabled = true;
let devModeEnabled = false;
// Test-hacking tools for the player's own kart — gated on isDevProfileActive()
// (a real, server-verified dev profile, see DEV_SIGNUP_PASSWORD_HASH in
// server.js), not devModeEnabled above, which is a plain unlocked "boost the
// bots" toggle anyone can flip and isn't meant to gate anything sensitive.
let devFlyEnabled = false;
let devGodModeEnabled = false;
let devInfiniteItemsEnabled = false;
let devSpeedOverride = null;
// "all" (every bot plus your own kart — networked peers aren't offered,
// see refreshDevSpeedTargetOptions) or a racers[] index (as a string,
// since <select> option values are strings) picked from the dropdown the
// panel populates at each race reset.
let devSpeedTargetValue = "all";
// Which item Infinite Items keeps you holding — "same" re-grants whatever
// you just used (the original behavior), or a specific ITEM_LABELS key to
// always hold that one instead.
let devInfiniteItemsChoice = "same";
let paused = false;
let audioEnabled = true;

// session preferences persisted across visits (and picked up by the hub's
// profile backup feature, which just reads/writes this same localStorage key)
const KART_SETTINGS_KEY = "mimiKartSettings";
function loadKartSettings() {
    try {
        return JSON.parse(localStorage.getItem(KART_SETTINGS_KEY) || "{}");
    } catch (e) {
        return {};
    }
}
function saveKartSettings() {
    try {
        localStorage.setItem(KART_SETTINGS_KEY, JSON.stringify({
            renderMode, hdrEnabled, currentCameraMode, dayNightMode,
            autoSteerEnabled, miniMapEnabled, audioEnabled, currentDifficulty,
            selectedCharacterKey, selectedKartKey, selectedKartColor,
        }));
    } catch (e) { /* private mode */ }
}
const savedKartSettings = loadKartSettings();
if (savedKartSettings.selectedCharacterKey) selectedCharacterKey = savedKartSettings.selectedCharacterKey;
if (savedKartSettings.selectedKartKey) selectedKartKey = savedKartSettings.selectedKartKey;
if (savedKartSettings.renderMode) renderMode = savedKartSettings.renderMode;
if (typeof savedKartSettings.hdrEnabled === "boolean") hdrEnabled = savedKartSettings.hdrEnabled;
if (savedKartSettings.currentCameraMode) currentCameraMode = savedKartSettings.currentCameraMode;
if (savedKartSettings.dayNightMode) dayNightMode = savedKartSettings.dayNightMode;
if (typeof savedKartSettings.autoSteerEnabled === "boolean") autoSteerEnabled = savedKartSettings.autoSteerEnabled;
if (typeof savedKartSettings.miniMapEnabled === "boolean") miniMapEnabled = savedKartSettings.miniMapEnabled;
if (typeof savedKartSettings.audioEnabled === "boolean") audioEnabled = savedKartSettings.audioEnabled;
if (savedKartSettings.currentDifficulty) currentDifficulty = savedKartSettings.currentDifficulty;
if (savedKartSettings.selectedKartColor) selectedKartColor = savedKartSettings.selectedKartColor;
// The signed-in profile's own choice wins over whatever's saved locally on
// this device — same "profile settings beat local" convention used
// everywhere else a profile-backed value can also be set locally.
if (activeProfileSession()?.kartColor) selectedKartColor = activeProfileSession().kartColor;

function getCameraModeConfig() {
    return cameraModes.find((mode) => mode.key === currentCameraMode) ?? cameraModes[0];
}

function resetRace() {
    racerLoadout.forEach((entry, index) => {
        racers[index] = createRacer(entry.name, entry.color, entry.x, entry.y, entry.isPlayer, entry.controls);
    });
    racers.forEach(alignRacerToTrack);
    mpAssignPeersToRacers();
    refreshDevSpeedTargetOptions();
    raceOver = false;
    finishedCount = 0;
    boostParticles.length = 0;
    projectiles = [];
    trackHazards = [];
    leaveEffects.length = 0;
    trackCoins.forEach((coin) => {
        coin.active = true;
        coin.respawnTimer = 0;
    });
    itemBoxes.forEach((box) => {
        box.active = true;
        box.respawnTimer = 0;
    });
    racers.forEach((racer) => {
        racer.cameraState.x = racer.x;
        racer.cameraState.y = racer.y;
        racer.cameraState.angle = racer.angle;
    });
    raceCountdown = 0;
    raceCountdownDisplay = 0;
    raceGoTimer = 0;
    raceElapsed = 0;
    raceNoticeTimer = 0;
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

function startRace(viaNetwork = false) {
    // Every entry point — the flat Start Race button, VR's thumbstick click,
    // gamepad/touch — funnels through here with no host check, so a
    // non-host connected to a room could start their own race locally,
    // out of sync with everyone else (confirmed by reading the code: the
    // flat button was never disabled for a joiner, and this function had no
    // guard of its own). The host's real start already reaches every joiner
    // through mpApplyRaceStart's own startRace(true) call below — a
    // joiner's local click should just wait for that instead of racing
    // ahead of it.
    if (mpConnected && !mpIsHost && !viaNetwork) {
        statusText.textContent = "Only the host can start the race — waiting...";
        return;
    }
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
    if (mpConnected && mpIsHost && mpSocket && mpSocket.readyState === WebSocket.OPEN) {
        mpSocket.send(JSON.stringify({
            type: "raceStart",
            mapKey: currentMapKey,
            difficulty: currentDifficulty,
            cupKey: currentCupKey,
            currentCupRaceIndex,
        }));
    }
    resetRace();
    running = true;
    raceStartedAt = performance.now();
    lastTimestamp = raceStartedAt;
    raceCountdown = START_COUNTDOWN_SECONDS;
    raceCountdownDisplay = START_COUNTDOWN_SECONDS + 1;
    raceGoTimer = 0;
    raceElapsed = 0;
    raceNoticeTimer = 0;
    startBoostPrimed = false;
    paused = false;
    syncPauseButton();
    statusText.textContent = `Race starts in ${START_COUNTDOWN_SECONDS}...`;
    if (!loopActive) {
        loopActive = true;
        // renderer3D owns the frame driver whenever it exists — it
        // transparently switches between plain requestAnimationFrame and the
        // XR session's own frame loop internally, which is what lets VR mode
        // (entered later, mid-session) hand off cleanly with no extra code
        // here beyond starting it through the renderer once, up front.
        if (renderer3D) renderer3D.setAnimationLoop(loop);
        else requestAnimationFrame(loop);
    }
}

function finishRace(message) {
    raceOver = true;
    paused = false;
    syncPauseButton();
    statusText.textContent = message;
    playFinishSound(message.startsWith("You win"));
    // (arcade) tell the frame around us how the race ended (no effect on its own)
    if (window.parent && window.parent !== window) {
        window.parent.postMessage({ source: "kart-circuit", type: "race-finished", won: message.startsWith("You win"), seconds: raceElapsed }, "*");
    }
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
    saveKartSettings();
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
    if (maps[currentMapKey]?.threeDOnly) {
        modeButton.textContent = "Mode: 3D only";
        modeButton.title = "This world is too big for the 2D tactical map.";
        return;
    }
    modeButton.title = "";
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

function syncHdrButton() {
    if (!hdrButton) return;
    hdrButton.textContent = `HDR: ${hdrEnabled ? "On" : "Off"}`;
}

function toggleHDR() {
    hdrEnabled = !hdrEnabled;
    syncHdrButton();
    statusText.textContent = `HDR ${hdrEnabled ? "enabled" : "disabled"}.`;
    saveKartSettings();
    draw();
}

function syncPauseButton() {
    if (!pauseButton) return;
    pauseButton.textContent = `Pause: ${paused ? "On" : "Off"}`;
}

function syncAudioButton() {
    if (!audioButton) return;
    audioButton.textContent = `Audio: ${audioEnabled ? "On" : "Off"}`;
}

// A gamepad can never trigger fullscreen (browsers require real mouse/touch/
// keyboard input for that gesture), so when a gamepad-driven attempt is
// refused, point at the real control with an actual mouse-pointer icon —
// since the physical mouse may not have moved recently and the player is
// navigating by gamepad, they may not know where their real cursor is.
let mouseHintEl = null;
let mouseHintTimer = null;
function showMouseHint(target) {
    if (!target) return;
    if (mouseHintTimer) clearTimeout(mouseHintTimer);
    if (!mouseHintEl) {
        mouseHintEl = document.createElement("div");
        mouseHintEl.className = "mouse-hint";
        mouseHintEl.textContent = "🖱️ Click here with a real mouse";
        (document.querySelector(".shell") || document.body).appendChild(mouseHintEl);
    }
    const rect = target.getBoundingClientRect();
    mouseHintEl.style.left = `${rect.left + rect.width / 2}px`;
    mouseHintEl.style.top = `${rect.top}px`;
    mouseHintEl.classList.add("visible");
    target.classList.add("attention-flash");
    mouseHintTimer = setTimeout(() => {
        mouseHintEl.classList.remove("visible");
        target.classList.remove("attention-flash");
    }, 2600);
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
    // Browsers require a real mouse click, tap, or physical key press to grant
    // fullscreen — the Gamepad API is deliberately excluded (otherwise any site
    // could force fullscreen from a background tab just by polling a held-down
    // button). So a gamepad can never trigger this, no matter how it's read.
    fullScreenButton.title = "Fullscreen needs a real mouse click or a keyboard press (F) — browsers block gamepad-triggered fullscreen entirely.";
}

async function toggleFullScreen(source) {
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
        statusText.textContent = source === "gamepad"
            ? "Browsers block fullscreen from a gamepad — press F on a keyboard or click Full with a mouse/touch instead."
            : "Fullscreen request was blocked.";
        if (source === "gamepad") showMouseHint(fullScreenButton);
    }

    syncFullScreenButton();
}

function toggleRenderMode() {
    // covers every entry point (button, M key, gamepad − binding) in one place
    if (maps[currentMapKey]?.threeDOnly) {
        renderMode = "3d";
        syncModeButton();
        statusText.textContent = "This world is too big for the 2D tactical map — 3D only.";
        return;
    }
    renderMode = renderMode === "3d" ? "2d" : "3d";
    syncModeButton();
    syncVRButton();
    saveKartSettings();
    draw();
}

function seatDriveActive(racer) {
    const pad = gamepadSeatInputs[racer.controls.seat ?? 0];
    return racer.controls.up.some(hasInput) || Boolean(pad?.accelerate);
}

function isDriveInputActive() {
    return racers.some((racer) => racer.isPlayer && seatDriveActive(racer)) || mouseButtons.left;
}

function applyStartBoost() {
    const difficulty = getDifficultySetting();
    let boosted = false;
    racers.forEach((racer) => {
        if (!racer.isPlayer || !(seatDriveActive(racer) || (racer.controls.mouse && mouseButtons.left))) return;
        racer.boostTimer = Math.max(racer.boostTimer, difficulty.boostTime * 0.9);
        racer.speed = Math.max(racer.speed, MAX_SPEED + BOOST_KICK + 10);
        racer.invulnTimer = Math.max(racer.invulnTimer, 0.35);
        boosted = true;
    });
    if (!boosted) return;
    raceNotice("Rocket Start!");
    playBoostSound();
}

function toggleCameraMode() {
    if (renderMode !== "3d") {
        statusText.textContent = "Switch to 3D mode to change camera.";
        return;
    }
    if (renderer3D?.xr?.isPresenting) {
        statusText.textContent = "Camera is locked to Hood while in VR.";
        return;
    }

    const currentIndex = cameraModes.findIndex((mode) => mode.key === currentCameraMode);
    const nextIndex = (currentIndex + 1) % cameraModes.length;
    currentCameraMode = cameraModes[nextIndex].key;
    syncCamButton();
    statusText.textContent = `Camera: ${cameraModes[nextIndex].label}`;
    saveKartSettings();
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
    saveKartSettings();
}

function toggleDayNightMode() {
    dayNightMode = dayNightMode === "night" ? "day" : "night";
    syncThemeButton();
    saveKartSettings();
    draw();
}

function toggleAutoSteer() {
    autoSteerEnabled = !autoSteerEnabled;
    syncAutoSteerButton();
    statusText.textContent = `Auto steer ${autoSteerEnabled ? "enabled" : "disabled"}.`;
    saveKartSettings();
}

function toggleMiniMap() {
    miniMapEnabled = !miniMapEnabled;
    syncMiniMapButton();
    statusText.textContent = `Mini map ${miniMapEnabled ? "enabled" : "disabled"}.`;
    saveKartSettings();
    draw();
}

function toggleDevMode() {
    devModeEnabled = !devModeEnabled;
    syncDevModeButton();
    statusText.textContent = `Dev mode ${devModeEnabled ? "enabled" : "disabled"}.`;
    draw();
}


function updatePlayer(racer, dt) {
    const difficulty = getDifficultySetting();
    const controls = racer.controls;
    const useMouse = controls.mouse;
    const pad = gamepadSeatInputs[controls.seat ?? 0];
    // racers[0] is guaranteed to be the sole local player whenever VR is
    // active — enterVR()/setLocalPlayerCount() both enforce localPlayerCount
    // === 1 before a session can start or stay active
    const xrPad = (renderer3D?.xr?.isPresenting && racer === racers[0]) ? xrInputState : null;
    const accelerate = controls.up.some(hasInput) || (useMouse && mouseButtons.left) || Boolean(pad?.accelerate) || Boolean(xrPad?.accelerate);
    const brake = controls.down.some(hasInput) || (useMouse && mouseButtons.right) || Boolean(pad?.brake) || Boolean(xrPad?.brake);
    const left = controls.left.some(hasInput);
    const right = controls.right.some(hasInput);
    const boosting = controls.boost.some(hasInput) || Boolean(pad?.item) || Boolean(xrPad?.boost);

    const manualSteer = (left ? -1 : 0) + (right ? 1 : 0);
    const mouseSteer = useMouse && mouseState.active && (mouseButtons.left || mouseButtons.right) ? mouseState.steer : 0;
    const padSteer = pad ? pad.steer : 0;
    let steer = clamp(manualSteer + mouseSteer * 0.92 + padSteer + (xrPad?.steer ?? 0), -1, 1);
    if (autoSteerEnabled) {
        // Aim a short distance ahead on the smooth centerline (same approach
        // AI racers already use via aiLookAhead), not the raw next checkpoint
        // gate. Checkpoints are sparse (as few as 6 for a whole loop like
        // Neon Loop) and only advance on crossing, so aiming straight at one
        // could point well off the actual curve right after a gate — on a
        // tight track that swung the assisted steer hard enough to spin the
        // kart out, dragging the camera/road view wildly off-angle with it.
        const targetProgress = getNearestTrackProgress(racer) + 5;
        const target = getCenterlinePoint(targetProgress);
        const targetAngle = Math.atan2(target.y - racer.y, target.x - racer.x);
        const angleDiff = wrapAngle(targetAngle - racer.angle);
        const assistedSteer = clamp(angleDiff / 0.8, -1, 1);
        const assistBlend = manualSteer === 0 ? 0.9 : 0.45;
        steer = clamp(manualSteer + assistedSteer * assistBlend, -1, 1);
    }

    // drift: hold the drift key while steering at speed to charge a mini-turbo,
    // release to fire it (blue at stage 1, orange at stage 2)
    const driftHeld = (controls.drift || []).some(hasInput) || Boolean(pad?.drift) || Boolean(xrPad?.drift);
    const canDrift = driftHeld && Math.abs(steer) > 0.25 && racer.speed > 42;
    if (canDrift) {
        if (!racer.drifting) {
            // the hop that kicks off a power-slide, like a real kart-racer drift —
            // purely a visual/feel beat, doesn't alter the physics itself
            racer.hopTimer = HOP_DURATION;
            if (racer.isPlayer) playHopSound();
        }
        racer.drifting = true;
        racer.driftCharge += dt;
        if (racer.driftCharge > DRIFT_STAGE1) {
            spawnDriftSpark(racer, racer.driftCharge > DRIFT_STAGE2 ? "#ff9f43" : "#53e0ff");
        }
    } else if (racer.drifting && !driftHeld) {
        if (racer.driftCharge >= DRIFT_STAGE2) {
            racer.boostTimer = Math.max(racer.boostTimer, 0.85);
            racer.speed = Math.max(racer.speed, MAX_SPEED + BOOST_KICK);
            raceNotice("Orange turbo!");
            playBoostSound();
        } else if (racer.driftCharge >= DRIFT_STAGE1) {
            racer.boostTimer = Math.max(racer.boostTimer, 0.4);
            racer.speed = Math.max(racer.speed, MAX_SPEED + BOOST_KICK * 0.6);
            raceNotice("Mini-turbo!");
            playBoostSound();
        }
        racer.drifting = false;
        racer.driftCharge = 0;
    } else if (!driftHeld) {
        racer.drifting = false;
        racer.driftCharge = 0;
    }

    const driftSteerBonus = racer.drifting ? 1.45 : 1;
    const speedFactor = clamp(Math.abs(racer.speed) / 8, 0.35, 1.2);
    racer.angle += steer * 2.7 * racer.steerGrip * driftSteerBonus * dt * speedFactor;

    if (accelerate) racer.speed += 200 * difficulty.playerAccel * racer.accelMultiplier * dt;
    if (brake && !racer.drifting) racer.speed -= racer.brakePower * difficulty.playerBrake * dt;

    racer.speed *= 1 - racer.coastDrag * (racer.drifting ? 0.82 : 1) * dt;
    const coinBonus = racer.coins * COIN_SPEED_BONUS;
    const playerTopSpeed = racer.boostTimer > 0
        ? MAX_SPEED + BOOST_SPEED_BONUS + racer.topSpeedBonus + coinBonus
        : MAX_SPEED + racer.topSpeedBonus + coinBonus;
    racer.speed = clamp(racer.speed, -60, playerTopSpeed);

    if (boosting) useItem(racer);
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
    // The starting grid packs every racer within this 84-unit avoidance
    // radius of several neighbors at once (by design — see
    // buildRaceSpawnPoints), so at full strength their avoidance vectors
    // fight each other in every direction simultaneously and the whole pack
    // barely moves for the first several seconds instead of pulling away
    // from the line (confirmed live: bots still sitting almost exactly on
    // the grid, tightly clustered, while the player had already covered
    // most of a lap). resolveRacerCollisions already keeps them from
    // actually overlapping via direct position separation, so avoidance
    // steering isn't needed to prevent stacking here — just eased off long
    // enough for the pack to pull apart under forward progress, then back
    // to normal open-track dodging.
    const startPackAvoidance = raceElapsed < 5 ? clamp(raceElapsed / 5, 0.12, 1) : 1;
    racers.forEach((other) => {
        if (other === racer || other.finished) return;
        const offsetX = other.x - racer.x;
        const offsetY = other.y - racer.y;
        const distance = Math.hypot(offsetX, offsetY);
        if (distance <= 0.001 || distance > 84) return;

        const separation = 84 - distance;
        const weight = separation / 84;
        const toOther = { x: offsetX / distance, y: offsetY / distance };
        const avoidanceStrength = 24 * (difficulty.aiAvoidanceStrength ?? 1) * startPackAvoidance;
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
    // Easing steering avoidance alone (see startPackAvoidance above) wasn't
    // enough: every racer in the starting grid also reads everyone packed
    // in front of them as "traffic" and throttles down for it, which keeps
    // the whole pack crawling together rather than pulling apart — a
    // self-reinforcing jam, confirmed live (bots still nearly on top of the
    // starting grid 15+ seconds in, having covered almost no distance while
    // the player was most of a lap ahead). Same grace window, same reasoning.
    const trafficPenalty = frontTraffic * (difficulty.aiTrafficPenalty ?? 17) * startPackAvoidance;
    const racerScore = getRaceScore(racer);
    const leaderScore = racers.reduce((best, other) => {
        if (other.finished) return best;
        const score = getRaceScore(other);
        return Math.max(best, score);
    }, racerScore);
    const scoreGap = Math.max(0, leaderScore - racerScore);
    const gapScale = Math.max(centerlinePath.length * 0.16, 26);
    const gapCatchUp = clamp(scoreGap / gapScale, 0, 1.35) * (difficulty.aiCatchUpBoost ?? 18);
    const placeCatchUp = Math.max(0, racer.place - 3) * (difficulty.aiPlaceCatchUp ?? 0.8);
    const playerScore = getRaceScore(racers[0]);
    const aheadOfPlayer = Math.max(0, racerScore - playerScore);
    const leaderPenalty = clamp(aheadOfPlayer / gapScale, 0, 1.4) * (difficulty.aiLeaderPenalty ?? 4);
    const desiredSpeed = MAX_SPEED - 18 + racer.aiPace * 24 + racer.coins * COIN_SPEED_BONUS * 0.6 + difficulty.aiSpeedBonus + devPaceBoost + gapCatchUp + placeCatchUp - leaderPenalty - cornerPenalty - trafficPenalty;
    racer.speed = lerp(racer.speed, desiredSpeed, dt * 0.9);

    // AI item usage: shields go up right away, rockets fire when someone's ahead
    // in range, turbo/oil wait for a straightaway
    if (racer.item) {
        racer.aiItemDelay -= dt;
        if (racer.aiItemDelay <= 0) {
            if (racer.item === "shield") {
                useItem(racer);
            } else if (racer.item === "rocket") {
                const anyAhead = racers.some((other) => other !== racer && !other.finished && other.place < racer.place && dist(racer, other) < 420);
                if (anyAhead) useItem(racer);
            } else if (Math.abs(diff) < 0.5) {
                useItem(racer);
            }
        }
    }
}

function resolveRacerCollisions(dt) {
    const difficulty = getDifficultySetting();
    const startPackBoost = raceElapsed < 4 ? 1.18 : 1;
    const minDistance = 22 * startPackBoost * (difficulty.collisionSpacing ?? 1);

    for (let i = 0; i < racers.length; i += 1) {
        for (let j = i + 1; j < racers.length; j += 1) {
            const a = racers[i];
            const b = racers[j];
            if (a.finished || b.finished || a.isFalling || b.isFalling) continue;
            // A flying dev passes straight through the pack — no-clip, not
            // just "can't fall off."
            const aFlying = a.isPlayer && devFlyEnabled && isDevProfileActive();
            const bFlying = b.isPlayer && devFlyEnabled && isDevProfileActive();
            if (aFlying || bFlying) continue;

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
            if (a.invulnTimer <= 0) a.speed *= damping;
            if (b.invulnTimer <= 0) b.speed *= damping;
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

    if (racer.isNetworked) {
        mpApplyLatestState(racer);
        return;
    }

    if (racer.isFalling) {
        racer.fallTimer = Math.max(0, racer.fallTimer - dt);
        if (racer.fallTimer <= 0) {
            racer.isFalling = false;
            respawnRacerAtLastCheckpoint(racer);
        }
        return;
    }

    if (racer.spinTimer > 0) {
        racer.spinTimer = Math.max(0, racer.spinTimer - dt);
        const spinProgress = 1 - racer.spinTimer / SPIN_OUT_DURATION;
        racer.angle = racer.spinBaseAngle + spinProgress * Math.PI * 4; // two full spins, ends facing forward
        racer.speed *= 1 - 2.6 * dt;
        racer.prevX = racer.x;
        racer.prevY = racer.y;
        if (racer.spinTimer <= 0) {
            racer.angle = racer.spinBaseAngle;
            racer.invulnTimer = Math.max(racer.invulnTimer, 0.5);
        }
        return;
    }

    if (racer.shieldTimer > 0) {
        racer.shieldTimer = Math.max(0, racer.shieldTimer - dt);
    }

    if (racer.hopTimer > 0) {
        racer.hopTimer = Math.max(0, racer.hopTimer - dt);
    }

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
        if (!racer.isPlayer) {
            spawnBoostParticle(racer);
        }
    }

    const progressNow = getNearestTrackProgress(racer);
    const nearestCenter = getCenterlinePoint(progressNow);

    // --- ramps: hit one on the road at speed and you launch. Small ramps are
    // a quick trick jump (boost on landing); glide ramps start a long flight.
    racer.rampLock = Math.max(0, racer.rampLock - dt);
    if (racer.airTimer <= 0 && racer.rampLock <= 0 && racer.speed > 55) {
        const total = centerlinePath.length;
        for (const ramp of trackRamps) {
            let delta = progressNow - ramp.progress;
            while (delta > total / 2) delta -= total;
            while (delta < -total / 2) delta += total;
            if (Math.abs(delta) < 1.1 && dist(racer, ramp) < roadHalfWidth * 1.05) {
                racer.airTimer = ramp.glide ? GLIDE_DURATION : JUMP_DURATION;
                racer.airTotal = racer.airTimer;
                racer.gliding = ramp.glide;
                racer.rampLock = ramp.glide ? 3.4 : 1.4;
                racer.drifting = false;
                racer.driftCharge = 0;
                if (ramp.glide) racer.speed = Math.max(racer.speed, MAX_SPEED * 0.9);
                if (racer.isPlayer) {
                    if (ramp.glide) {
                        raceNotice("Take flight!", 1.4);
                        playGlideSound();
                    } else {
                        playJumpSound();
                    }
                }
                break;
            }
        }
    }
    // --- boost pads: instant speed kick when driven over
    racer.padLock = Math.max(0, racer.padLock - dt);
    if (racer.padLock <= 0 && racer.airTimer <= 0) {
        const total = centerlinePath.length;
        for (const pad of trackBoostPads) {
            let delta = progressNow - pad.progress;
            while (delta > total / 2) delta -= total;
            while (delta < -total / 2) delta += total;
            if (Math.abs(delta) < 1.1 && dist(racer, pad) < roadHalfWidth) {
                racer.padLock = 1;
                racer.boostTimer = Math.max(racer.boostTimer, 0.55);
                racer.speed = Math.max(racer.speed, MAX_SPEED + BOOST_KICK);
                if (racer.isPlayer) playBoostSound();
                break;
            }
        }
    }

    const flying = racer.isPlayer && devFlyEnabled && isDevProfileActive();

    // --- loops: drive through the ring at speed for a scripted 360° roll —
    // airborne through the loop, boost on the way out
    if (racer.loopTimer <= 0 && racer.airTimer <= 0 && racer.rampLock <= 0 && racer.speed > 55) {
        const total = centerlinePath.length;
        for (const loop of trackLoops) {
            let delta = progressNow - loop.progress;
            while (delta > total / 2) delta -= total;
            while (delta < -total / 2) delta += total;
            if (Math.abs(delta) < 1.1 && dist(racer, loop) < roadHalfWidth * 1.05) {
                racer.loopTimer = LOOP_DURATION;
                racer.loopTotal = LOOP_DURATION;
                racer.rampLock = 1.8;
                racer.drifting = false;
                racer.driftCharge = 0;
                racer.speed = Math.max(racer.speed, MAX_SPEED * 0.95);
                if (racer.isPlayer) {
                    raceNotice("LOOP!", 1.1);
                    playGlideSound();
                }
                break;
            }
        }
    }
    if (racer.loopTimer > 0) {
        racer.loopTimer = Math.max(0, racer.loopTimer - dt);
        const loopArc = 1 - racer.loopTimer / racer.loopTotal;
        racer.airHeight = Math.sin(Math.PI * clamp(loopArc, 0, 1)) * LOOP_AIR_HEIGHT;
        racer.speed = Math.max(racer.speed, MAX_SPEED * 0.95); // the loop carries you through
        if (racer.loopTimer <= 0) {
            racer.airHeight = 0;
            racer.boostTimer = Math.max(racer.boostTimer, 0.6);
            if (racer.isPlayer) playBoostSound();
        }
    }

    const airborne = racer.airTimer > 0 || racer.loopTimer > 0 || flying;
    if (racer.airTimer > 0) {
        racer.airTimer = Math.max(0, racer.airTimer - dt);
        const arc = 1 - racer.airTimer / racer.airTotal;
        racer.airHeight = Math.sin(Math.PI * clamp(arc, 0, 1)) * (racer.gliding ? GLIDE_AIR_HEIGHT : JUMP_AIR_HEIGHT);
        if (racer.airTimer <= 0) {
            // trick landing: a burst of boost, bigger off a full glide
            racer.airHeight = 0;
            racer.boostTimer = Math.max(racer.boostTimer, racer.gliding ? 0.75 : 0.45);
            racer.gliding = false;
            if (racer.isPlayer) playBoostSound();
        }
    } else if (racer.loopTimer <= 0) {
        // "Fly" used to just disable falling/collisions and boost speed —
        // the kart never actually left the ground, so it didn't look or
        // feel like flying at all (confirmed: still glued to the road,
        // just fast and invincible). Smoothly lifts to/from a real hover
        // height instead of snapping, so takeoff/landing reads as a real
        // liftoff rather than a teleport.
        if (flying) {
            racer.airHeight = lerp(racer.airHeight || 0, FLY_HOVER_HEIGHT, clamp(dt * 2.2, 0, 1));
        } else if (racer.airHeight > 0.5) {
            racer.airHeight = lerp(racer.airHeight, 0, clamp(dt * 3, 0, 1));
        } else {
            racer.airHeight = 0;
        }
    }

    // --- wall riding: inside a wall zone, the area past the road edge is a
    // rideable wall instead of slow grass. Hold it to charge, and the charge
    // pays out as a boost when you drop back onto the road.
    const progressFrac = progressNow / Math.max(1, centerlinePath.length);
    let wallZone = null;
    for (const zone of trackWallZones) {
        const inRange = zone.from <= zone.to
            ? progressFrac >= zone.from && progressFrac <= zone.to
            : progressFrac >= zone.from || progressFrac <= zone.to;
        if (inRange) {
            wallZone = zone;
            break;
        }
    }
    const wallDirection = getCenterlineDirection(progressNow);
    const wallNormal = { x: -wallDirection.y, y: wallDirection.x };
    const lateral = (racer.x - nearestCenter.x) * wallNormal.x + (racer.y - nearestCenter.y) * wallNormal.y;
    const wallRiding = Boolean(wallZone) && !airborne && racer.speed > 60
        && Math.sign(lateral) === wallZone.side
        && Math.abs(lateral) > roadHalfWidth * 0.85
        && Math.abs(lateral) < shoulderHalfWidth + 60;
    if (wallRiding) {
        racer.wallCharge = Math.min(racer.wallCharge + dt, 1.6);
        racer.wallSide = wallZone.side;
        racer.offRoadTimer = 0;
    } else if (racer.wallCharge > 0) {
        racer.boostTimer = Math.max(racer.boostTimer, 0.3 + racer.wallCharge * 0.5);
        if (racer.isPlayer) {
            raceNotice("Wall ride boost!", 1);
            playBoostSound();
        }
        racer.wallCharge = 0;
        racer.wallSide = 0;
    }

    // grass is off track everywhere — including the infield, which the old
    // polygon test wrongly counted as road. Anywhere past the shoulder counts.
    // Airborne karts fly over it; wall riders are on the wall, not the grass;
    // a flying dev never falls, that's the whole point.
    const offRoad = !flying && !airborne && !wallRiding && dist(racer, nearestCenter) > shoulderHalfWidth + 4;
    if (offRoad) {
        racer.offRoadTimer += dt;
        if (racer.offRoadTimer >= OFF_ROAD_FALL_DELAY) {
            racer.isFalling = true;
            racer.fallTimer = FALL_DURATION;
            racer.speed = 0;
            racer.offRoadTimer = 0;
            racer.coins = Math.max(0, racer.coins - COINS_LOST_ON_FALL);
            racer.driftCharge = 0;
            racer.drifting = false;
            if (racer.isPlayer) {
                raceNotice("You fell off the track!", 1.2);
            }
            playFallSound();
            return;
        }
        racer.speed *= 1 - 0.4 * dt;
        racer.speed = Math.min(racer.speed, 135);
    } else {
        racer.offRoadTimer = 0;
    }

    const friction = offRoad ? 0.35 : 0.7;
    racer.speed *= 1 - friction * dt;
    const maxAllowedSpeed = flying ? MAX_SPEED * 3 : boostActive ? MAX_SPEED + BOOST_SPEED_BONUS : MAX_SPEED;
    racer.speed = clamp(racer.speed, flying ? -maxAllowedSpeed : -60, maxAllowedSpeed);
    // Used to only ever touch the player's own kart — extended to target
    // any racer (or all of them at once) via the Speed dropdown, so bots
    // can be sped up/slowed down for testing too, not just yourself.
    // Networked human peers aren't reachable here: their position comes
    // from mpApplyLatestState (see the isNetworked early-return above this
    // function), driven by what THEIR client sends, not local physics —
    // there's nothing for a local speed override to act on.
    if (devSpeedOverride !== null && isDevProfileActive()) {
        const targetsThisRacer = devSpeedTargetValue === "all" || racers[Number(devSpeedTargetValue)] === racer;
        if (targetsThisRacer) racer.speed = devSpeedOverride;
    }

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
            if (racer.checkpointIndex === 0) {
                racer.lapArmed = true;
            }
            if (racer.isPlayer) {
                raceNotice(`Checkpoint ${racer.checkpointIndex + 1} reached.`, 1.2);
                playCheckpointSound();
            }
        }
    }

    const finishCross = getVerticalGateCross(
        { x: racer.prevX, y: racer.prevY },
        { x: racer.x, y: racer.y },
        startSide.x,
    );

    // lapArmed is only set after visiting every checkpoint, so it alone gates the
    // lap. (Requiring checkpointIndex === 0 here too was a bug: the finish gate
    // sits after checkpoint 0, so the index was already 1 at every real crossing.)
    //
    // This used to also require the crossing to land within finishLine.y1/y2 —
    // the decorative banner's span, which every map draws noticeably narrower
    // than the actual road (e.g. Neon Loop: a 95-unit lane on a 184-unit-wide
    // road). A normal racing line along either edge of the track — wide entry,
    // tight apex, drafting past a bot — crosses the gate's x outside that
    // narrow strip and was silently rejected, leaving lapArmed still true
    // until some later lap happened to cross through the center. That's
    // exactly the "one lap doesn't count, but it's not lost — it catches up a
    // lap later" bug reported live. lapArmed + the forward-direction check
    // already fully gate a real lap (the checkpoint loop can't be faked, and
    // this is the one gate crossing that state permits), so the extra lane
    // restriction wasn't protecting anything — just rejecting legitimate
    // crossings near the shoulders. Dropped.
    if (
        racer.lapArmed &&
        finishCross?.direction === 1 &&
        racer.gateLockTimer <= 0
    ) {
        racer.lap += 1;
        racer.lapArmed = false;
        racer.gateLockTimer = 0.28;
        // (arcade) tell the frame around us — it keeps a running total of laps as this game's score (no effect on its own)
        if (racer === racers[0] && window.parent && window.parent !== window) {
            window.parent.postMessage({ source: "kart-circuit", type: "lap-complete", lap: racer.lap, of: getLapsToWin() }, "*");
        }
        if (racer.isPlayer) {
            raceInfo.textContent = `Lap ${Math.min(racer.lap + 1, getLapsToWin())} / ${getLapsToWin()}`;
            raceNotice(`Lap ${racer.lap} complete.`);
            playLapSound();
        }
        if (racer.lap >= getLapsToWin()) {
            racer.finished = true;
            finishedCount += 1;
            if (racer.isPlayer) {
                finishRace(localPlayerCount > 1 ? `${racer.name} wins the circuit!` : "You win the circuit");
            } else if (!raceOver) {
                finishRace(`${racer.name} won the circuit`);
            }
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
            // A racer already holding an unused item drives straight through
            // without touching the box — it stays active for someone who can
            // actually use it. Without this check, simply not having pressed
            // Space yet meant your held item got silently swapped for a new
            // random one (and the box wasted) the instant you passed another.
            if (racer.item) return;
            box.active = false;
            box.respawnTimer = 5;
            racer.item = ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)];
            racer.aiItemDelay = 0.8 + Math.random() * 2.2;
            if (racer.isPlayer) {
                raceNotice(`${ITEM_LABELS[racer.item]}! Press Space to use it.`);
                playPickupSound();
            }
        }
    });

    if (racer.invulnTimer > 0) {
        racer.invulnTimer -= dt;
    }
}

function updatePlacements() {
    updateTrackScores();
    const ranking = racers
        .map((racer) => ({
            racer,
            score: getRaceScore(racer),
        }))
        .sort((a, b) => b.score - a.score);

    ranking.forEach((entry, index) => {
        entry.racer.place = index + 1;
    });
}

// horizon silhouette shapes per biome — a plain zigzag reads as "hills" for
// anywhere; the other profiles give each track's world its own skyline so
// Neon Loop, Foundry Drift, Summit Spiral etc. don't all look like the same
// green range with a different tint
const MOUNTAIN_PROFILES = {
    hills: [[0, 32], [100, -16], [240, 12], [380, -52], [540, 4], [720, -34], [860, 22], [960, -10]],
    skyline: [
        [0, 40], [0, -10], [60, -10], [60, -60], [100, -60], [100, -20], [160, -20], [160, -90],
        [210, -90], [210, -30], [280, -30], [280, -70], [330, -70], [330, -10], [400, -10], [400, -50],
        [460, -50], [460, 10], [520, 10], [520, -40], [590, -40], [590, -100], [640, -100], [640, -20],
        [710, -20], [710, -60], [760, -60], [760, 0], [820, 0], [820, -45], [880, -45], [880, -15], [960, -15],
    ],
    dunes: [
        [0, 10], [80, -30], [160, -55], [240, -35], [320, -10], [400, -45], [480, -70],
        [560, -40], [640, -15], [720, -50], [800, -30], [880, -5], [960, -25],
    ],
    towers: [
        [0, 20], [40, 20], [40, -20], [60, -20], [60, -90], [75, -96], [90, -90], [90, -20], [110, -20],
        [110, 10], [300, 10], [300, -15], [320, -15], [320, -70], [335, -78], [350, -70], [350, -15],
        [370, -15], [370, 15], [600, 15], [600, -10], [615, -10], [615, -60], [628, -68], [640, -60],
        [640, -10], [660, -10], [660, 25], [960, 25],
    ],
    // offsets here need to clear the horizon (anything less negative than -34
    // sits at/below camera.horizon and gets painted over by the ground fill
    // drawn afterward, so a shallow-amplitude band would simply vanish)
    waves: [
        [0, -40], [60, -58], [120, -38], [180, -60], [240, -40], [300, -58], [360, -42], [420, -60],
        [480, -38], [540, -58], [600, -44], [660, -60], [720, -40], [780, -56], [840, -42], [900, -58], [960, -40],
    ],
    peaks: [
        [0, 50], [70, -30], [130, -100], [190, -40], [250, 10], [310, -70], [370, -130], [430, -50],
        [490, 20], [550, -90], [610, -150], [670, -60], [730, 0], [790, -80], [850, -120], [910, -30], [960, 30],
    ],
};

/* Big soft cumulus is the most recognisable thing about a big kart racers
   sky, and the cheapest way to stop this one reading as an empty gradient.
   A fixed bank rather than anything random: the same clouds have to be in
   the same places every frame or they'd swim as the camera turns. Each entry
   is (x as a fraction of one full 360 degree pan, height above the horizon,
   scale), and `puffs` are circle centres in units of the cloud's own radius. */
const CLOUD_BANK = [
    { x: 0.04, y: 86, scale: 1.15, puffs: [[-1.5, .25, .62], [-.65, -.2, .85], [.25, -.42, 1], [1.15, -.05, .72], [1.85, .3, .5]] },
    { x: 0.19, y: 30, scale: 0.72, puffs: [[-1.1, .2, .55], [-.3, -.25, .8], [.6, .05, .62]] },
    { x: 0.31, y: 112, scale: 1.4, puffs: [[-1.8, .3, .58], [-.9, -.28, .9], [0, -.5, 1.05], [.95, -.18, .8], [1.75, .26, .55]] },
    { x: 0.47, y: 46, scale: 0.9, puffs: [[-1.2, .22, .6], [-.35, -.3, .88], [.55, -.02, .68], [1.25, .28, .45]] },
    { x: 0.58, y: 124, scale: 1.05, puffs: [[-1.35, .28, .6], [-.5, -.24, .86], [.4, -.35, .92], [1.25, .1, .62]] },
    { x: 0.71, y: 34, scale: 0.66, puffs: [[-.85, .18, .55], [-.05, -.28, .78], [.7, .1, .55]] },
    { x: 0.84, y: 96, scale: 1.25, puffs: [[-1.6, .3, .6], [-.75, -.22, .88], [.15, -.46, 1], [1.05, -.08, .75], [1.8, .28, .5]] },
    { x: 0.93, y: 58, scale: 0.85, puffs: [[-1.05, .24, .58], [-.2, -.3, .84], [.7, .05, .64]] },
];

// Cloud colour, for any palette that doesn't state one. The base day/night
// palettes do (plain white cumulus, and a dimmed blue-grey at night), but the
// fourteen per-map biomes only override sky/ground/road — so pasting daylight
// white onto Rainbow Skyway's deep-space purple or Volcano Rim's ember red
// would put the wrong clouds on two-thirds of the tracks. Lightening that
// map's own sky instead gives every biome clouds that belong to it, with no
// extra per-map data to keep in sync.
function lightenHex(hex, amount) {
    const value = parseInt(hex.slice(1), 16);
    const mix = (channel) => Math.round(channel + (255 - channel) * amount);
    return `rgb(${mix((value >> 16) & 255)}, ${mix((value >> 8) & 255)}, ${mix(value & 255)})`;
}

function getCloudColors(palette) {
    return {
        top: palette.cloudTop ?? lightenHex(palette.skyTop, 0.8),
        shade: palette.cloudShade ?? lightenHex(palette.skyMid, 0.42),
    };
}

function drawClouds(camera, palette, panOffset) {
    // Clouds sit further out than the hills, so they slide past more slowly --
    // the parallax split is what sells the sky as having depth at all. On top
    // of that they drift on their own slow clock, which keeps the sky alive
    // while you're sitting on the grid with the camera still.
    const drift = (performance.now() / 1000) * 5.2;
    const cloudColors = getCloudColors(palette);
    ctx.save();
    // Nothing below the horizon: a cloud's lower puffs can dip past it on a
    // steep camera pitch, and a cloud lying on the grass reads as a bug.
    ctx.beginPath();
    ctx.rect(0, 0, WIDTH, Math.max(0, camera.horizon + 6));
    ctx.clip();

    CLOUD_BANK.forEach((cloud) => {
        const baseX = (cloud.x * WIDTH + panOffset * 0.62 + drift) % WIDTH;
        const y = camera.horizon - cloud.y;
        const radius = 42 * cloud.scale;
        // Drawn three times, one tile either side, so a cloud straddling the
        // screen edge comes back in on the other side instead of popping.
        [-1, 0, 1].forEach((tile) => {
            const cx = baseX + tile * WIDTH;
            if (cx < -260 || cx > WIDTH + 260) return;
            const gradient = ctx.createLinearGradient(0, y - radius * 1.1, 0, y + radius * 0.9);
            gradient.addColorStop(0, cloudColors.top);
            gradient.addColorStop(1, cloudColors.shade);
            ctx.fillStyle = gradient;
            ctx.beginPath();
            cloud.puffs.forEach(([px, py, pr]) => {
                ctx.moveTo(cx + px * radius + pr * radius, y + py * radius);
                ctx.arc(cx + px * radius, y + py * radius, pr * radius, 0, Math.PI * 2);
            });
            ctx.fill();
        });
    });
    ctx.restore();
}

function drawSilhouettePath(profile, mountainBase, ox) {
    ctx.moveTo(ox + profile[0][0], mountainBase + profile[0][1]);
    for (let i = 1; i < profile.length; i += 1) {
        ctx.lineTo(ox + profile[i][0], mountainBase + profile[i][1]);
    }
    ctx.lineTo(ox + WIDTH, HEIGHT);
    ctx.lineTo(ox + 0, HEIGHT);
    ctx.closePath();
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
    const cameraAngle = Math.atan2(camera.forward.y, camera.forward.x);
    const panScale = WIDTH / (Math.PI * 2);
    const panOffset = (((-cameraAngle * panScale) % WIDTH) + WIDTH) % WIDTH;
    drawClouds(camera, palette, panOffset);

    const mountainProfile = MOUNTAIN_PROFILES[palette.mountainStyle] ?? MOUNTAIN_PROFILES.hills;
    ctx.fillStyle = palette.mountainColor;
    [-1, 0, 1].forEach((tile) => {
        const ox = panOffset - WIDTH + tile * WIDTH;
        ctx.beginPath();
        drawSilhouettePath(mountainProfile, mountainBase, ox);
        ctx.fill();
    });
    if (palette.mountainStyle === "peaks") {
        // snow caps: clip to a band near the tallest tips and redraw the same
        // silhouette in white — only the peaks poking into that band show through
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, mountainBase - 168, WIDTH, 96);
        ctx.clip();
        ctx.fillStyle = "rgba(255,255,255,0.88)";
        [-1, 0, 1].forEach((tile) => {
            const ox = panOffset - WIDTH + tile * WIDTH;
            ctx.beginPath();
            drawSilhouettePath(mountainProfile, mountainBase, ox);
            ctx.fill();
        });
        ctx.restore();
    }

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
    const sampleCount = 120;
    const drawDistance = 17; // road reaches toward the horizon instead of dying mid-screen
    const startProgress = getNearestTrackProgress(player) + 0.12;
    const samples = [];

    for (let index = 0; index <= sampleCount; index += 1) {
        const progress = startProgress + (index / sampleCount) * drawDistance;
        const center = getCenterlinePoint(progress);
        const direction = getCenterlineDirection(progress);
        const normal = { x: -direction.y, y: direction.x };
        // projectGroundPoint (not the strict projectWorldPoint) — on a tight,
        // few-checkpoint loop (Neon Loop) a sharp bend can curve the road
        // edge points back far enough that the camera's single fixed forward
        // vector for the frame puts them at/behind its near plane, even for
        // the very first sample right under the player. projectWorldPoint
        // rejected those outright, which used to leave the ENTIRE road
        // undrawn right where the player is (floating over blank grass,
        // reachable live: drive Neon Loop with auto-steer and watch the road
        // vanish mid-corner) — worse than the phantom-fork bug the old
        // skip-null approach was guarding against. projectGroundPoint clamps
        // instead of rejecting, so every sample now gets a usable screen
        // position; genuinely-behind-camera stretches are culled explicitly
        // below with the same combined check used for ramps/pads/loops.
        //
        // All 4 lateral points at this sample (both shoulders, both road
        // edges) share ONE scale computed from the sample's own centerline
        // point, instead of each projecting independently — projecting them
        // independently let the near/far edges of a close, tight-turn
        // segment diverge sharply in size from each other (a handful of
        // world units of lateral offset was enough), fanning the road out
        // into a warped, shredded-looking strip right around the player,
        // which is exactly the same corner-scale-divergence bug fixed for
        // boost pads/ramps/loop decals — just never applied here too.
        const anchor = projectGroundPoint(center.x, center.y, 0, camera);
        const leftShoulder = projectGroundPointAtScale(
            center.x - normal.x * shoulderHalfWidth,
            center.y - normal.y * shoulderHalfWidth,
            0,
            camera,
            anchor.scale,
        );
        const leftRoad = projectGroundPointAtScale(
            center.x - normal.x * roadHalfWidth,
            center.y - normal.y * roadHalfWidth,
            0,
            camera,
            anchor.scale,
        );
        const rightRoad = projectGroundPointAtScale(
            center.x + normal.x * roadHalfWidth,
            center.y + normal.y * roadHalfWidth,
            0,
            camera,
            anchor.scale,
        );
        const rightShoulder = projectGroundPointAtScale(
            center.x + normal.x * shoulderHalfWidth,
            center.y + normal.y * shoulderHalfWidth,
            0,
            camera,
            anchor.scale,
        );

        // Only cull a sample once it's BOTH facing away from the camera and
        // far enough that it can't just be near-plane drift on a turn — same
        // formula used for behind-camera culling elsewhere in this file.
        // Skipping just this one sample (not the whole loop) keeps the rest
        // of the road drawing normally on either side of a culled stretch.
        const behindCamera = anchor.forward <= -28 && anchor.depth > 100;
        if (!behindCamera) {
            samples.push({
                sourceIndex: index,
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
        // On a tight loop (few checkpoints, e.g. Neon Loop) the far end of a
        // fixed draw distance can curve more than 90° from the camera's
        // forward direction, failing the check above and creating a gap in
        // the samples the loop keeps curving, so a later sample can swing
        // back into view further around the bend. Bridging that gap by
        // connecting the samples on either side of it with a quad stitched a
        // stray strip straight across the track — a phantom fork that didn't
        // match the real road. Only connect samples that were genuinely
        // adjacent in the original scan; skip drawing across any gap instead.
        if (far.sourceIndex - near.sourceIndex !== 1) continue;
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

// Trick ramps drawn as raised glowing wedges on the road: back edge flat on
// the asphalt, front edge lifted — gold for jump ramps, cyan for glide ramps.
function drawRamps3D(camera) {
    trackRamps.forEach((ramp) => {
        const across = { x: -ramp.dirY, y: ramp.dirX };
        const halfW = roadHalfWidth * 0.55;
        const backX = ramp.x - ramp.dirX * 30;
        const backY = ramp.y - ramp.dirY * 30;
        const frontX = ramp.x + ramp.dirX * 12;
        const frontY = ramp.y + ramp.dirY * 12;
        // One shared scale for the whole ramp (from its own anchor point),
        // reused for every corner — see projectGroundPointAtScale's comment.
        const anchor = projectGroundPoint(ramp.x, ramp.y, 0, camera);
        // projectGroundPoint never rejects a point (that's the whole point of
        // it — see the comment above its definition), so a ramp well BEHIND
        // the player still gets a depth/screen position instead of vanishing,
        // and could render somewhere wrong on screen no matter which way the
        // camera turned. Requiring BOTH a negative forward AND depth > 100
        // (not just forward alone) matters: a decal you're still approaching
        // on a sharp curve can ALSO show a strongly negative forward purely
        // from camera-angle lag while genuinely being very close (small
        // depth) — that's the exact case projectGroundPoint exists to keep
        // visible, so forward alone would silently re-break it.
        if ((anchor.forward <= -28 && anchor.depth > 100) || anchor.depth > 960) return;
        const backLeft = projectGroundPointAtScale(backX - across.x * halfW, backY - across.y * halfW, 0, camera, anchor.scale);
        const backRight = projectGroundPointAtScale(backX + across.x * halfW, backY + across.y * halfW, 0, camera, anchor.scale);
        const frontLeft = projectGroundPointAtScale(frontX - across.x * halfW * 0.86, frontY - across.y * halfW * 0.86, 16, camera, anchor.scale);
        const frontRight = projectGroundPointAtScale(frontX + across.x * halfW * 0.86, frontY + across.y * halfW * 0.86, 16, camera, anchor.scale);
        const color = ramp.glide ? "#53e0ff" : "#ffd166";
        ctx.save();
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.moveTo(backLeft.x, backLeft.y);
        ctx.lineTo(backRight.x, backRight.y);
        ctx.lineTo(frontRight.x, frontRight.y);
        ctx.lineTo(frontLeft.x, frontLeft.y);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        // Scale is capped by projectGroundPoint for close-up decals, but a
        // capped scale still multiplies into a huge stroke here — clamp the
        // final pixel width too, or a ramp taken close-up paints a giant
        // solid-white bar across the screen instead of a thin edge highlight.
        ctx.lineWidth = clamp(4 * frontLeft.scale * 8, 1.5, 26);
        ctx.beginPath();
        ctx.moveTo(frontLeft.x, frontLeft.y);
        ctx.lineTo(frontRight.x, frontRight.y);
        ctx.stroke();
        ctx.restore();
    });
}

// Boost pads: a flat glowing chevron decal painted on the road, pulsing and
// pointing the direction of travel — no height, so it never fights the road
// draw order the way a raised ramp would.
function drawBoostPads3D(camera) {
    const pulse = 0.65 + Math.sin(raceElapsed * 4) * 0.35;
    trackBoostPads.forEach((pad) => {
        const across = { x: -pad.dirY, y: pad.dirX };
        const halfW = roadHalfWidth * 0.6;
        // One shared scale for the whole pad (both chevron segments), from
        // its own anchor point — see projectGroundPointAtScale's comment.
        const anchor = projectGroundPoint(pad.x, pad.y, 0.5, camera);
        if ((anchor.forward <= -28 && anchor.depth > 100) || anchor.depth > 960) return;
        for (let i = 0; i < 2; i += 1) {
            const backD = -34 + i * 22;
            const frontD = backD + 16;
            const backX = pad.x + pad.dirX * backD;
            const backY = pad.y + pad.dirY * backD;
            const frontX = pad.x + pad.dirX * frontD;
            const frontY = pad.y + pad.dirY * frontD;
            const tipX = pad.x + pad.dirX * (frontD + 10);
            const tipY = pad.y + pad.dirY * (frontD + 10);
            const backLeft = projectGroundPointAtScale(backX - across.x * halfW, backY - across.y * halfW, 0.5, camera, anchor.scale);
            const backRight = projectGroundPointAtScale(backX + across.x * halfW, backY + across.y * halfW, 0.5, camera, anchor.scale);
            const frontLeft = projectGroundPointAtScale(frontX - across.x * halfW * 0.5, frontY - across.y * halfW * 0.5, 0.5, camera, anchor.scale);
            const frontRight = projectGroundPointAtScale(frontX + across.x * halfW * 0.5, frontY + across.y * halfW * 0.5, 0.5, camera, anchor.scale);
            const tip = projectGroundPointAtScale(tipX, tipY, 0.5, camera, anchor.scale);
            ctx.save();
            ctx.globalAlpha = pulse;
            ctx.fillStyle = "#53e0ff";
            ctx.shadowColor = "#53e0ff";
            ctx.shadowBlur = 16;
            ctx.beginPath();
            ctx.moveTo(backLeft.x, backLeft.y);
            ctx.lineTo(frontLeft.x, frontLeft.y);
            ctx.lineTo(tip.x, tip.y);
            ctx.lineTo(frontRight.x, frontRight.y);
            ctx.lineTo(backRight.x, backRight.y);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
    });
}

// Loops: a big glowing ring standing on the road — drive through it to
// trigger the scripted roll. Drawn as a billboard ellipse plus a bright
// entry arc on the asphalt so it reads clearly even from a distance.
function drawLoops3D(camera) {
    trackLoops.forEach((loop) => {
        const ringHeight = 120;
        const center = projectGroundPoint(loop.x, loop.y, ringHeight * 0.5, camera);
        const top = projectGroundPoint(loop.x, loop.y, ringHeight, camera);
        const ground = projectGroundPoint(loop.x, loop.y, 0, camera);
        if ((center.forward <= -28 && center.depth > 100) || center.depth > 1200) return;
        const radiusY = Math.abs(ground.y - top.y) / 2;
        const radiusX = Math.max(radiusY * 0.62, roadHalfWidth * 0.5 * center.scale);
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = "#ff2fd6";
        ctx.shadowColor = "#ff2fd6";
        ctx.shadowBlur = 20;
        ctx.lineWidth = clamp(10 * center.scale * 8, 2, 40);
        ctx.beginPath();
        ctx.ellipse(center.x, center.y, radiusX, radiusY, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = "#ffe9a8";
        ctx.lineWidth = clamp(4 * center.scale * 8, 1, 26);
        ctx.beginPath();
        ctx.ellipse(center.x, center.y, radiusX * 0.82, radiusY * 0.82, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // entry decal — shares the ring's own scale (see
        // projectGroundPointAtScale's comment) so the two ends of this line
        // don't balloon unevenly up close.
        const across = { x: -loop.dirY, y: loop.dirX };
        const decalHalf = roadHalfWidth * 0.7;
        const dLeft = projectGroundPointAtScale(loop.x - across.x * decalHalf, loop.y - across.y * decalHalf, 0.5, camera, ground.scale);
        const dRight = projectGroundPointAtScale(loop.x + across.x * decalHalf, loop.y + across.y * decalHalf, 0.5, camera, ground.scale);
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = "#ff2fd6";
        ctx.lineWidth = clamp(8 * ground.scale * 8, 2, 34);
        ctx.beginPath();
        ctx.moveTo(dLeft.x, dLeft.y);
        ctx.lineTo(dRight.x, dRight.y);
        ctx.stroke();
        ctx.restore();
    });
}

// Rideable walls along wall-zone shoulders: a translucent vertical face with
// a bright top rail in the track's curb color, sampled finely along the zone.
function drawWalls3D(camera) {
    if (!trackWallZones.length) return;
    const palette = getThemePalette();
    const total = centerlinePath.length;
    trackWallZones.forEach((zone) => {
        const span = zone.to >= zone.from ? zone.to - zone.from : 1 - zone.from + zone.to;
        const steps = Math.max(12, Math.round(span * total * 1.4));
        let prevBase = null;
        let prevTop = null;
        for (let i = 0; i <= steps; i += 1) {
            const frac = (zone.from + (span * i) / steps) % 1;
            const progress = frac * total;
            const center = getCenterlinePoint(progress);
            const direction = getCenterlineDirection(progress);
            const normal = { x: -direction.y, y: direction.x };
            const edge = shoulderHalfWidth + 6;
            const wallX = center.x + normal.x * zone.side * edge;
            const wallY = center.y + normal.y * zone.side * edge;
            const base = projectWorldPoint(wallX, wallY, 0, camera);
            const top = projectWorldPoint(wallX, wallY, 46, camera);
            if (base && top && prevBase && prevTop && base.depth < 960) {
                ctx.save();
                ctx.globalAlpha = 0.3;
                ctx.fillStyle = palette.curbA;
                ctx.beginPath();
                ctx.moveTo(prevBase.x, prevBase.y);
                ctx.lineTo(base.x, base.y);
                ctx.lineTo(top.x, top.y);
                ctx.lineTo(prevTop.x, prevTop.y);
                ctx.closePath();
                ctx.fill();
                ctx.globalAlpha = 0.9;
                ctx.strokeStyle = palette.curbA;
                ctx.lineWidth = Math.max(1.5, 3 * top.scale * 8);
                ctx.beginPath();
                ctx.moveTo(prevTop.x, prevTop.y);
                ctx.lineTo(top.x, top.y);
                ctx.stroke();
                ctx.restore();
            }
            // reset across projection gaps so the wall never bridges them
            prevBase = base && top ? base : null;
            prevTop = base && top ? top : null;
        }
    });
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
    const maxBotDrawDepth = 960; // match the longer road draw distance
    const cameraAngle = Math.atan2(camera.forward.y, camera.forward.x);

    racers.forEach((racer) => {
        if (racer === player) return;
        const projection = projectBotSprite(racer, camera);
        if (!projection) return;
        const { base, top, depth, rearBias } = projection;
        if (depth > maxBotDrawDepth) return;
        if (base.x < -220 || base.x > WIDTH + 220 || base.y < -180 || base.y > HEIGHT + 220) return;
        const farFade = clamp(inverseLerp(340, maxBotDrawDepth, depth), 0, 1);
        const height = Math.max(16, (base.y - top.y) * 1.18);
        const width = height * 0.78;
        const fallProgress = racer.isFalling ? 1 - racer.fallTimer / FALL_DURATION : 0;
        sprites.push({
            depth,
            x: base.x,
            y: top.y,
            alpha: (1 - farFade * 0.58) * (1 - rearBias * 0.38) * (racer.isFalling ? Math.max(0, 1 - fallProgress) : 1),
            shadowWidth: width * 0.38,
            shadowHeight: height * 0.1,
            draw: () => {
                if (racer.isFalling) {
                    ctx.rotate(fallProgress * Math.PI * 2.4);
                    ctx.scale(Math.max(0.05, 1 - fallProgress * 0.92), Math.max(0.05, 1 - fallProgress * 0.92));
                }
                // Orient the sprite from the kart's heading relative to the camera:
                // rear view driving away, front view oncoming, side profile crossing.
                const rel = wrapAngle(racer.angle - cameraAngle);
                const sideness = Math.abs(Math.sin(rel));
                const flip = Math.sin(rel) >= 0 ? 1 : -1;
                const facingAway = Math.cos(rel) >= 0;
                ctx.scale(flip, 1);

                const bodyW = width * (0.56 + 0.52 * sideness);
                const bodyH = height * 0.3;
                const cy = height * 0.3;

                // wheels
                ctx.fillStyle = "#07101a";
                const wheelW = width * (0.15 + 0.07 * sideness);
                const wheelH = height * 0.32;
                fillRoundedRect(-bodyW * 0.5 - wheelW * 0.35, cy - wheelH * 0.2, wheelW, wheelH, 4);
                fillRoundedRect(bodyW * 0.5 - wheelW * 0.65, cy - wheelH * 0.2, wheelW, wheelH, 4);

                // chassis
                ctx.fillStyle = racer.color;
                ctx.strokeStyle = "rgba(8,10,18,0.6)";
                ctx.lineWidth = Math.max(1, bodyH * 0.09);
                outlinedRoundedRect(-bodyW * 0.5, cy - bodyH * 0.5, bodyW, bodyH, 7);
                ctx.fillStyle = "rgba(255,255,255,0.24)";
                fillRoundedRect(-bodyW * 0.34, cy - bodyH * 0.44, bodyW * 0.68, bodyH * 0.28, 4);

                // driver helmet
                ctx.fillStyle = "#0c1220";
                ctx.beginPath();
                ctx.arc(sideness * bodyW * -0.08, cy - bodyH * 0.72, width * 0.15, 0, Math.PI * 2);
                ctx.fill();

                if (sideness < 0.55 && facingAway) {
                    // rear view: spoiler, tail lights, exhaust flame
                    ctx.fillStyle = "#0c1220";
                    fillRoundedRect(-bodyW * 0.42, cy - bodyH * 1.06, bodyW * 0.84, bodyH * 0.24, 3);
                    ctx.fillStyle = dayNightMode === "night" ? "rgba(255, 90, 90, 0.95)" : "rgba(180, 40, 40, 0.85)";
                    fillRoundedRect(-bodyW * 0.4, cy - bodyH * 0.12, bodyW * 0.14, bodyH * 0.24, 2);
                    fillRoundedRect(bodyW * 0.26, cy - bodyH * 0.12, bodyW * 0.14, bodyH * 0.24, 2);
                    if (racer.boostTimer > 0) {
                        ctx.fillStyle = "rgba(83, 224, 255, 0.55)";
                        ctx.beginPath();
                        ctx.ellipse(0, cy + bodyH * 0.62, bodyW * 0.2, bodyH * 0.42, 0, 0, Math.PI * 2);
                        ctx.fill();
                    }
                } else if (sideness < 0.55 && !facingAway) {
                    // front view: nose stripe + headlights
                    ctx.fillStyle = "rgba(255,255,255,0.85)";
                    ctx.fillRect(-bodyW * 0.04, cy - bodyH * 0.5, bodyW * 0.08, bodyH);
                    ctx.fillStyle = dayNightMode === "night" ? "rgba(255, 236, 168, 0.95)" : "rgba(255, 245, 214, 0.8)";
                    fillRoundedRect(-bodyW * 0.4, cy - bodyH * 0.14, bodyW * 0.16, bodyH * 0.28, 2);
                    fillRoundedRect(bodyW * 0.24, cy - bodyH * 0.14, bodyW * 0.16, bodyH * 0.28, 2);
                    if (dayNightMode === "night") {
                        ctx.fillStyle = "rgba(255, 236, 168, 0.2)";
                        ctx.beginPath();
                        ctx.ellipse(0, cy + bodyH * 0.6, bodyW * 0.7, bodyH * 0.5, 0, 0, Math.PI * 2);
                        ctx.fill();
                    }
                } else {
                    // side profile: nose cone forward, flame + lights trailing
                    ctx.fillStyle = racer.color;
                    ctx.strokeStyle = "rgba(8,10,18,0.6)";
                    ctx.lineWidth = Math.max(1, bodyH * 0.09);
                    ctx.beginPath();
                    ctx.moveTo(bodyW * 0.5, cy - bodyH * 0.4);
                    ctx.lineTo(bodyW * 0.68, cy + bodyH * 0.1);
                    ctx.lineTo(bodyW * 0.5, cy + bodyH * 0.5);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                    if (dayNightMode === "night") {
                        ctx.fillStyle = "rgba(255, 236, 168, 0.95)";
                        fillRoundedRect(bodyW * 0.52, cy - bodyH * 0.1, bodyW * 0.1, bodyH * 0.2, 2);
                        ctx.fillStyle = "rgba(255, 236, 168, 0.22)";
                        ctx.beginPath();
                        ctx.ellipse(bodyW * 0.85, cy, bodyW * 0.3, bodyH * 0.5, 0, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    if (racer.boostTimer > 0) {
                        ctx.fillStyle = "rgba(83, 224, 255, 0.55)";
                        ctx.beginPath();
                        ctx.ellipse(-bodyW * 0.62, cy, bodyW * 0.18, bodyH * 0.32, 0, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
                if (racer.shieldTimer > 0) {
                    ctx.strokeStyle = "rgba(83, 224, 255, 0.85)";
                    ctx.lineWidth = Math.max(1.5, width * 0.05);
                    ctx.beginPath();
                    ctx.ellipse(0, cy - bodyH * 0.25, bodyW * 0.78, bodyH * 1.5, 0, 0, Math.PI * 2);
                    ctx.stroke();
                }
            },
        });
    });

    itemBoxes.forEach((box) => {
        if (!box.active) return;
        const base = projectGroundPoint(box.x, box.y, 0, camera);
        const top = projectGroundPoint(box.x, box.y, 22, camera);
        // projectGroundPoint deliberately never returns null (that's what
        // keeps close-up decals from vanishing on a turn — see the comment
        // on its definition), so anything genuinely behind the camera still
        // gets a screen position instead of being excluded, and a decently
        // negative lateral/height combination can land that position right
        // back inside the visible canvas — a ghost icon appearing to sit on
        // the road ahead when the real one is actually behind the player.
        // Same "well behind AND not just close" guard the ground-decal
        // renderers (boost pads/ramps/loops) already use.
        if (base.forward <= -28 && base.depth > 100) return;
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

    trackCoins.forEach((coin) => {
        if (!coin.active) return;
        const base = projectGroundPoint(coin.x, coin.y, 0, camera);
        const top = projectGroundPoint(coin.x, coin.y, 12, camera);
        if (base.depth > maxBotDrawDepth) return;
        if (base.forward <= -28 && base.depth > 100) return;
        const size = Math.max(4, (base.y - top.y) * 0.8);
        const spin = Math.abs(Math.sin(raceElapsed * 3.2 + coin.x * 0.05));
        sprites.push({
            depth: base.depth,
            x: base.x,
            y: top.y,
            shadowWidth: size * 0.4,
            shadowHeight: size * 0.12,
            alpha: 0.98,
            draw: () => {
                ctx.fillStyle = "#ffd166";
                ctx.strokeStyle = "#b8860b";
                ctx.lineWidth = Math.max(1, size * 0.12);
                ctx.beginPath();
                ctx.ellipse(0, size * 0.4, Math.max(1.5, size * 0.5 * (0.25 + spin * 0.75)), size * 0.5, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            },
        });
    });

    trackHazards.forEach((hazard) => {
        const base = projectGroundPoint(hazard.x, hazard.y, 0, camera);
        if (base.depth > maxBotDrawDepth) return;
        if (base.forward <= -28 && base.depth > 100) return;
        const size = Math.max(6, 30 * base.scale * 8);
        sprites.push({
            depth: base.depth,
            x: base.x,
            y: base.y,
            alpha: clamp(hazard.life / 4, 0.35, 0.85),
            draw: () => {
                ctx.fillStyle = "rgba(12, 14, 20, 0.9)";
                ctx.beginPath();
                ctx.ellipse(0, 0, size * 0.6, size * 0.2, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "rgba(70, 60, 120, 0.35)";
                ctx.beginPath();
                ctx.ellipse(-size * 0.1, -size * 0.03, size * 0.3, size * 0.09, 0, 0, Math.PI * 2);
                ctx.fill();
            },
        });
    });

    projectiles.forEach((rocket) => {
        const base = projectWorldPoint(rocket.x, rocket.y, 8, camera);
        if (!base) return;
        const size = Math.max(3, 9 * base.scale * 8);
        sprites.push({
            depth: base.depth,
            x: base.x,
            y: base.y,
            alpha: 1,
            draw: () => {
                ctx.fillStyle = "rgba(255, 120, 80, 0.45)";
                ctx.beginPath();
                ctx.ellipse(0, 0, size * 1.6, size * 0.7, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "#ff5d3a";
                ctx.beginPath();
                ctx.arc(0, 0, size * 0.55, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "#ffe9a8";
                ctx.beginPath();
                ctx.arc(0, 0, size * 0.26, 0, Math.PI * 2);
                ctx.fill();
            },
        });
    });

    trackDecorations.forEach((deco) => {
        const heights = { tree: 52, rock: 18, star: 46, crystal: 44, lava: 20, arch: 60, cloud: 38 };
        const height = (heights[deco.type] ?? 30) * deco.size;
        const base = projectWorldPoint(deco.x, deco.y, 0, camera);
        const top = projectWorldPoint(deco.x, deco.y, height, camera);
        if (!base || !top) return;
        if (base.depth > maxBotDrawDepth) return;
        if (base.x < -240 || base.x > WIDTH + 240 || base.y < -160 || base.y > HEIGHT + 200) return;
        const h = Math.max(6, base.y - top.y);
        const w = h * 0.8;
        const farFade = clamp(inverseLerp(380, maxBotDrawDepth, base.depth), 0, 1);
        sprites.push({
            depth: base.depth,
            x: base.x,
            y: top.y,
            alpha: 1 - farFade * 0.5,
            shadowWidth: deco.type === "star" ? 0 : w * 0.34,
            shadowHeight: h * 0.06,
            draw: () => {
                if (deco.type === "tree") {
                    // savanna acacia: slim trunk, wide flat canopy
                    ctx.fillStyle = "#5a3a1e";
                    ctx.fillRect(-w * 0.05, h * 0.35, w * 0.1, h * 0.65);
                    ctx.fillStyle = "#6f8f3a";
                    ctx.beginPath();
                    ctx.ellipse(0, h * 0.28, w * 0.52, h * 0.22, 0, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = "rgba(255,255,255,0.12)";
                    ctx.beginPath();
                    ctx.ellipse(-w * 0.14, h * 0.22, w * 0.26, h * 0.1, 0, 0, Math.PI * 2);
                    ctx.fill();
                } else if (deco.type === "rock") {
                    ctx.fillStyle = "#6c6f78";
                    ctx.beginPath();
                    ctx.ellipse(0, h * 0.6, w * 0.5, h * 0.42, 0, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = "rgba(255,255,255,0.16)";
                    ctx.beginPath();
                    ctx.ellipse(-w * 0.14, h * 0.46, w * 0.2, h * 0.14, 0, 0, Math.PI * 2);
                    ctx.fill();
                } else if (deco.type === "star") {
                    // floating glow star for the skyway
                    const r = h * 0.4;
                    ctx.fillStyle = "#ffe9a8";
                    ctx.shadowColor = "#ffd166";
                    ctx.shadowBlur = 18;
                    ctx.beginPath();
                    ctx.moveTo(0, -r);
                    ctx.lineTo(r * 0.3, -r * 0.3);
                    ctx.lineTo(r, 0);
                    ctx.lineTo(r * 0.3, r * 0.3);
                    ctx.lineTo(0, r);
                    ctx.lineTo(-r * 0.3, r * 0.3);
                    ctx.lineTo(-r, 0);
                    ctx.lineTo(-r * 0.3, -r * 0.3);
                    ctx.closePath();
                    ctx.fill();
                    ctx.shadowBlur = 0;
                } else if (deco.type === "crystal") {
                    ctx.fillStyle = "rgba(160, 225, 255, 0.9)";
                    ctx.strokeStyle = "rgba(255,255,255,0.8)";
                    ctx.lineWidth = Math.max(1, w * 0.04);
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    ctx.lineTo(w * 0.26, h * 0.7);
                    ctx.lineTo(-w * 0.26, h * 0.7);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(w * 0.3, h * 0.2);
                    ctx.lineTo(w * 0.5, h * 0.72);
                    ctx.lineTo(w * 0.12, h * 0.72);
                    ctx.closePath();
                    ctx.fill();
                } else if (deco.type === "lava") {
                    ctx.fillStyle = "#2c1c16";
                    ctx.beginPath();
                    ctx.ellipse(0, h * 0.6, w * 0.5, h * 0.42, 0, 0, Math.PI * 2);
                    ctx.fill();
                    const pulse = 0.6 + Math.abs(Math.sin(raceElapsed * 2.4 + deco.x * 0.03)) * 0.4;
                    ctx.fillStyle = `rgba(255, 120, 40, ${pulse})`;
                    ctx.shadowColor = "#ff5d3a";
                    ctx.shadowBlur = 12;
                    ctx.beginPath();
                    ctx.ellipse(-w * 0.08, h * 0.52, w * 0.18, h * 0.1, 0, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.beginPath();
                    ctx.ellipse(w * 0.16, h * 0.66, w * 0.1, h * 0.07, 0, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.shadowBlur = 0;
                } else if (deco.type === "arch") {
                    // rainbow arch pylon for the skyway
                    ctx.lineWidth = Math.max(2, w * 0.1);
                    ["#ff2fd6", "#ffd166", "#53e0ff"].forEach((color, ring) => {
                        ctx.strokeStyle = color;
                        ctx.beginPath();
                        ctx.arc(0, h, h * (0.9 - ring * 0.14), Math.PI, 0);
                        ctx.stroke();
                    });
                } else if (deco.type === "cloud") {
                    ctx.fillStyle = "rgba(255,255,255,0.85)";
                    [[0, h * 0.4, w * 0.42], [-w * 0.34, h * 0.5, w * 0.28], [w * 0.34, h * 0.5, w * 0.3]].forEach(([cx2, cy2, r]) => {
                        ctx.beginPath();
                        ctx.arc(cx2, cy2, r, 0, Math.PI * 2);
                        ctx.fill();
                    });
                }
            },
        });
    });

    boostParticles.forEach((particle) => {
        const projection = projectWorldPoint(particle.x, particle.y, 3, camera);
        if (!projection) return;
        const fade = clamp(particle.life / particle.maxLife, 0, 1);
        const size = Math.max(1, particle.size * projection.scale * (0.6 + fade * 0.4));
        sprites.push({
            depth: projection.depth,
            x: projection.x,
            y: projection.y,
            alpha: fade,
            draw: () => {
                ctx.fillStyle = `rgba(${particle.color},${0.75 * fade})`;
                ctx.beginPath();
                ctx.arc(0, 0, size, 0, Math.PI * 2);
                ctx.fill();
            },
        });
    });

    trackMovers.forEach((mover) => {
        const hoverHeight = 30 + Math.sin(raceElapsed * 3 + mover.phase) * 6;
        // ground-clamped like ramps/pads: a mover that vanishes right as you
        // need to dodge it defeats the point of it being visible at all
        const base = projectGroundPoint(mover.liveX, mover.liveY, 0, camera);
        const top = projectGroundPoint(mover.liveX, mover.liveY, hoverHeight, camera);
        if ((base.forward <= -28 && base.depth > 100) || base.depth > maxBotDrawDepth) return;
        if (base.x < -220 || base.x > WIDTH + 220 || base.y < -180 || base.y > HEIGHT + 220) return;
        const size = Math.max(10, mover.radius * top.scale * 2.1);
        const spin = raceElapsed * 3.4;
        sprites.push({
            depth: base.depth,
            x: top.x,
            y: top.y,
            alpha: 1,
            shadowWidth: size * 0.5,
            shadowHeight: size * 0.14,
            draw: () => {
                ctx.save();
                ctx.rotate(Math.sin(spin) * 0.15);
                ctx.fillStyle = "rgba(255, 90, 40, 0.35)";
                ctx.beginPath();
                ctx.arc(0, 0, size * 0.72, 0, Math.PI * 2);
                ctx.fill();
                ctx.save();
                ctx.beginPath();
                ctx.arc(0, 0, size * 0.5, 0, Math.PI * 2);
                ctx.clip();
                const stripeCount = 8;
                for (let i = 0; i < stripeCount; i += 1) {
                    ctx.fillStyle = i % 2 === 0 ? "#ffd166" : "#1a1420";
                    ctx.save();
                    ctx.rotate(spin + (i / stripeCount) * Math.PI * 2);
                    ctx.fillRect(-size * 0.5, -size * 0.14, size, size * 0.14);
                    ctx.restore();
                }
                ctx.restore();
                ctx.strokeStyle = "#ff5a28";
                ctx.lineWidth = Math.max(1.5, size * 0.08);
                ctx.beginPath();
                ctx.arc(0, 0, size * 0.5, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            },
        });
    });

    sprites
        .sort((a, b) => b.depth - a.depth)
        .forEach(drawBillboard);
}

// A brief on-track marker where a networked racer's kart was the moment
// they disconnected — the kart itself doesn't vanish (it smoothly hands off
// to AI control in updateRacer, so the race keeps going), but a departure
// should still be visible in the world, not just as a chat line.
const leaveEffects = []; // {x, y, elapsed, duration, name}

function triggerLeaveEffect(racer, name) {
    leaveEffects.push({ x: racer.x, y: racer.y, elapsed: 0, duration: 1.7, name });
}

function updateLeaveEffects(dt) {
    for (let i = leaveEffects.length - 1; i >= 0; i -= 1) {
        leaveEffects[i].elapsed += dt;
        if (leaveEffects[i].elapsed >= leaveEffects[i].duration) leaveEffects.splice(i, 1);
    }
}

function drawLeaveEffects(camera) {
    if (!leaveEffects.length) return;
    leaveEffects.forEach((fx) => {
        const t = clamp(fx.elapsed / fx.duration, 0, 1);
        const rise = 40 + t * 60;
        const point = projectGroundPoint(fx.x, fx.y, rise, camera);
        if (point.depth > 960) return;
        const alpha = 1 - t;
        const px = point.scale * 8;
        ctx.save();
        ctx.globalAlpha = clamp(alpha, 0, 1);
        // a little poof of particles scattering outward
        for (let i = 0; i < 6; i += 1) {
            const ang = (i / 6) * Math.PI * 2;
            const spread = t * 22 * px;
            ctx.beginPath();
            ctx.arc(point.x + Math.cos(ang) * spread, point.y + 12 + Math.sin(ang) * spread * 0.4, Math.max(1, 3 * (1 - t) * px), 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255,255,255,0.8)";
            ctx.fill();
        }
        ctx.font = `bold ${clamp(15 * px, 11, 22)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillStyle = "#ff6b6b";
        ctx.shadowColor = "#ff6b6b";
        ctx.shadowBlur = 10;
        ctx.fillText(`👋 ${fx.name} left`, point.x, point.y);
        ctx.shadowBlur = 0;
        ctx.restore();
    });
}

// rear view of the player's own kart, drawn at the bottom of chase/wide/outside cams
function drawCockpit(player) {
    ctx.save();
    const speedFactor = clamp(Math.abs(player.speed) / MAX_SPEED, 0, 1);
    const bounce = Math.sin(raceElapsed * 13) * speedFactor * 2;
    // the drift hop: a quick sine arc up and back down, peaking at mid-air —
    // plus ramp/glide airtime, which lifts much higher for much longer
    const hopProgress = player.hopTimer > 0 ? 1 - player.hopTimer / HOP_DURATION : 0;
    const hopLift = Math.sin(hopProgress * Math.PI) * HOP_HEIGHT + (player.airHeight || 0) * 1.5;
    ctx.translate(CENTER.x, HEIGHT - 46 + bounce - hopLift);

    if (player.isFalling) {
        const fallProgress = 1 - player.fallTimer / FALL_DURATION;
        ctx.globalAlpha = Math.max(0, 1 - fallProgress);
        const shrink = Math.max(0.05, 1 - fallProgress * 0.9);
        ctx.scale(shrink, shrink);
        ctx.rotate(fallProgress * Math.PI * 2.4);
    } else if (player.spinTimer > 0) {
        ctx.rotate((1 - player.spinTimer / SPIN_OUT_DURATION) * Math.PI * 4);
    } else if (player.wallCharge > 0) {
        // riding the wall: bank the kart toward it
        ctx.rotate(player.wallSide * 0.3);
    }

    const w = 176;

    // hang glider while soaring off a glide ramp
    if (player.gliding && player.airTimer > 0) {
        ctx.fillStyle = "#ff6b6b";
        ctx.beginPath();
        ctx.moveTo(-w * 0.62, -46);
        ctx.lineTo(0, -86);
        ctx.lineTo(w * 0.62, -46);
        ctx.lineTo(0, -56);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#ffd166";
        ctx.beginPath();
        ctx.moveTo(-w * 0.3, -51);
        ctx.lineTo(0, -78);
        ctx.lineTo(w * 0.3, -51);
        ctx.lineTo(0, -58);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(20, 24, 40, 0.8)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-w * 0.2, -8);
        ctx.lineTo(-w * 0.1, -54);
        ctx.moveTo(w * 0.2, -8);
        ctx.lineTo(w * 0.1, -54);
        ctx.stroke();
    }

    // ground-contact shadow shrinks as the hop/flight lifts the kart off the road
    const liftMax = HOP_HEIGHT + GLIDE_AIR_HEIGHT * 1.5;
    const shadowShrink = 1 - 0.45 * clamp(hopLift / liftMax, 0, 1) - 0.25 * clamp(hopLift / liftMax, 0, 1);
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.beginPath();
    ctx.ellipse(0, 34 + hopLift, w * 0.55 * Math.max(0.2, shadowShrink), 15 * Math.max(0.2, shadowShrink), 0, 0, Math.PI * 2);
    ctx.fill();

    if (player.boostTimer > 0) {
        ctx.fillStyle = "rgba(83, 224, 255, 0.6)";
        [-w * 0.17, w * 0.17].forEach((x) => {
            ctx.beginPath();
            ctx.ellipse(x, 34 + Math.random() * 5, 13, 24 + Math.random() * 9, 0, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    // rear wheels
    ctx.fillStyle = "#07101a";
    fillRoundedRect(-w * 0.52, -4, w * 0.17, 44, 9);
    fillRoundedRect(w * 0.35, -4, w * 0.17, 44, 9);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    fillRoundedRect(-w * 0.49, 2, w * 0.11, 8, 4);
    fillRoundedRect(w * 0.38, 2, w * 0.11, 8, 4);

    // chassis
    ctx.fillStyle = player.color;
    fillRoundedRect(-w * 0.37, -14, w * 0.74, 44, 14);
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    fillRoundedRect(-w * 0.27, -10, w * 0.54, 11, 7);

    // spoiler
    ctx.fillStyle = "#0c1220";
    fillRoundedRect(-w * 0.07, -28, w * 0.14, 14, 4);
    fillRoundedRect(-w * 0.32, -38, w * 0.64, 12, 5);

    // tail lights
    ctx.fillStyle = dayNightMode === "night" ? "rgba(255, 90, 90, 0.95)" : "rgba(190, 45, 45, 0.9)";
    fillRoundedRect(-w * 0.33, 4, w * 0.1, 10, 3);
    fillRoundedRect(w * 0.23, 4, w * 0.1, 10, 3);
    if (dayNightMode === "night") {
        ctx.fillStyle = "rgba(255, 90, 90, 0.25)";
        ctx.beginPath();
        ctx.ellipse(-w * 0.28, 9, 16, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(w * 0.28, 9, 16, 8, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // driver helmet
    ctx.fillStyle = "#0c1220";
    ctx.beginPath();
    ctx.arc(0, -40, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.arc(-5, -44, 5, 0, Math.PI * 2);
    ctx.fill();

    // drift sparks off the rear wheels
    if (player.drifting && player.driftCharge > DRIFT_STAGE1) {
        ctx.fillStyle = player.driftCharge > DRIFT_STAGE2 ? "rgba(255, 159, 67, 0.92)" : "rgba(83, 224, 255, 0.92)";
        for (let i = 0; i < 6; i += 1) {
            const side = Math.random() < 0.5 ? -1 : 1;
            ctx.beginPath();
            ctx.arc(side * (w * 0.44 + Math.random() * 16), 26 + Math.random() * 14, 2 + Math.random() * 2.6, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // your character riding the kart — Dino variants share one emoji glyph,
    // recolored per-variant via a canvas filter (see the CHARACTERS list)
    if (player.characterEmoji) {
        ctx.font = "38px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.filter = player.characterFilter || "none";
        ctx.fillText(player.characterEmoji, 0, -18);
        ctx.filter = "none";
    }

    // shield bubble
    if (player.shieldTimer > 0) {
        ctx.strokeStyle = "rgba(83, 224, 255, 0.8)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(0, -8, w * 0.62, 62, 0, 0, Math.PI * 2);
        ctx.stroke();
    }

    ctx.restore();
}

function drawTrack2D(viewRacer = racers[0]) {
    const transform = getMapTransform();
    const palette = getThemePalette();
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    const backgroundGradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    backgroundGradient.addColorStop(0, palette.mapBgTop);
    backgroundGradient.addColorStop(1, palette.mapBgBottom);
    ctx.fillStyle = backgroundGradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // The grass background used to trace the map's separate trackPath array —
    // a differently-shaped, unrelated set of points from the checkpoints that
    // actually define the road (see centerlinePath) — so the grass boundary
    // and the road drawn on top of it didn't line up: tight against the road
    // on one side of the loop, oddly far from it on another. Trace an outward
    // scaled copy of the real road shape instead, so the grass margin is
    // always centered on and proportional to the actual track.
    const grassPivot = centerOfPoints(checkpoints);
    const grassOutline = (centerlinePath.length ? centerlinePath : checkpoints)
        .map((point) => scalePoint(point, grassPivot, 1.35));
    ctx.fillStyle = palette.mapGrass;
    ctx.beginPath();
    grassOutline.forEach((point, index) => {
        const mapped = projectToMap(point, transform);
        if (index === 0) {
            ctx.moveTo(mapped.x, mapped.y);
        } else {
            ctx.lineTo(mapped.x, mapped.y);
        }
    });
    ctx.closePath();
    ctx.fill();

    // Trace the road from centerlinePath — the actual smoothed curve the karts
    // drive and the 3D view renders — NOT straight lines between the raw
    // checkpoint corners. The smooth curve bows well outside those straight
    // chords, so the polygon version put karts and coins visibly off the drawn
    // road and gave this map a different shape from the mini-map and 3D view.
    // Width is the road's true scaled width for the same reason: an
    // artistically-thinned ribbon leaves edge-riding karts floating off it.
    const roadOutline = centerlinePath.length ? centerlinePath : checkpoints;
    ctx.save();
    ctx.strokeStyle = "#2c334b";
    ctx.lineWidth = shoulderHalfWidth * 2 * transform.scale;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    roadOutline.forEach((point, index) => {
        const mapped = projectToMap(point, transform);
        if (index === 0) {
            ctx.moveTo(mapped.x, mapped.y);
        } else {
            ctx.lineTo(mapped.x, mapped.y);
        }
    });
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = "#39456a";
    ctx.lineWidth = roadHalfWidth * 2 * transform.scale;
    ctx.beginPath();
    roadOutline.forEach((point, index) => {
        const mapped = projectToMap(point, transform);
        if (index === 0) {
            ctx.moveTo(mapped.x, mapped.y);
        } else {
            ctx.lineTo(mapped.x, mapped.y);
        }
    });
    ctx.closePath();
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 8 * transform.scale;
    ctx.setLineDash([18 * transform.scale, 18 * transform.scale]);
    ctx.beginPath();
    roadOutline.forEach((point, index) => {
        const mapped = projectToMap(point, transform);
        if (index === 0) {
            ctx.moveTo(mapped.x, mapped.y);
        } else {
            ctx.lineTo(mapped.x, mapped.y);
        }
    });
    ctx.closePath();
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

    trackCoins.forEach((coin) => {
        if (!coin.active) return;
        const mapped = projectToMap(coin, transform);
        const spin = Math.abs(Math.sin(raceElapsed * 3.2 + coin.x * 0.05));
        ctx.fillStyle = "#ffd166";
        ctx.strokeStyle = "#b8860b";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(mapped.x, mapped.y, Math.max(1.5, 6 * (0.3 + spin * 0.7)), 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    });

    trackHazards.forEach((hazard) => {
        const mapped = projectToMap(hazard, transform);
        ctx.fillStyle = `rgba(12, 14, 20, ${clamp(hazard.life / 4, 0.35, 0.85)})`;
        ctx.beginPath();
        ctx.ellipse(mapped.x, mapped.y, 12, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(70, 60, 120, 0.3)";
        ctx.beginPath();
        ctx.ellipse(mapped.x - 3, mapped.y - 2, 5, 3, 0, 0, Math.PI * 2);
        ctx.fill();
    });

    trackMovers.forEach((mover) => {
        const mapped = projectToMap({ x: mover.liveX, y: mover.liveY }, transform);
        ctx.fillStyle = "#ff5a28";
        ctx.strokeStyle = "#ffd166";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(mapped.x, mapped.y, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    });

    const activeCheckpoint = checkpoints[viewRacer.checkpointIndex % checkpoints.length];
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
        const fallProgress = racer.isFalling ? 1 - racer.fallTimer / FALL_DURATION : 0;
        ctx.save();
        ctx.translate(mapped.x, mapped.y);
        if (racer.isFalling) {
            ctx.globalAlpha = Math.max(0, 1 - fallProgress);
            const shrink = Math.max(0.05, 1 - fallProgress * 0.92);
            ctx.scale(shrink, shrink);
            ctx.rotate(fallProgress * Math.PI * 2.4);
        }
        ctx.rotate(racer.angle);
        ctx.fillStyle = racer.color;
        ctx.strokeStyle = "rgba(8,10,18,0.6)";
        ctx.lineWidth = 1.6;
        outlinedRoundedRect(-17, -9, 34, 18, 7);
        ctx.fillStyle = "rgba(255,255,255,0.2)";
        fillRoundedRect(-6, -8, 12, 5, 3);
        ctx.fillStyle = "#09101c";
        fillRoundedRect(-4, -11, 8, 22, 4);
        fillRoundedRect(-10, -4, 20, 8, 4);
        ctx.fillStyle = racer.isPlayer ? "#ffd166" : "rgba(255,255,255,0.78)";
        ctx.fillRect(-2, -8, 4, 16);
        if (racer.boostTimer > 0) {
            ctx.fillStyle = "rgba(83, 224, 255, 0.55)";
            ctx.beginPath();
            ctx.ellipse(-22, 0, 7, 4, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.rotate(-racer.angle);
        if (racer.shieldTimer > 0) {
            ctx.strokeStyle = "rgba(83, 224, 255, 0.85)";
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(0, 0, 24, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    });

    projectiles.forEach((rocket) => {
        const mapped = projectToMap(rocket, transform);
        ctx.save();
        ctx.translate(mapped.x, mapped.y);
        ctx.rotate(rocket.angle);
        ctx.fillStyle = "rgba(255, 120, 80, 0.4)";
        ctx.beginPath();
        ctx.ellipse(-6, 0, 10, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ff5d3a";
        fillRoundedRect(-5, -3, 12, 6, 3);
        ctx.fillStyle = "#ffe9a8";
        ctx.beginPath();
        ctx.arc(6, 0, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    });

    boostParticles.forEach((particle) => {
        const mapped = projectToMap(particle, transform);
        const fade = clamp(particle.life / particle.maxLife, 0, 1);
        ctx.fillStyle = `rgba(${particle.color},${0.7 * fade})`;
        ctx.beginPath();
        ctx.arc(mapped.x, mapped.y, Math.max(1, particle.size * 0.8 * fade + 1), 0, Math.PI * 2);
        ctx.fill();
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

function traceMiniMapPath(points, transform) {
    ctx.beginPath();
    points.forEach((point, index) => {
        const mapped = projectToMap(point, transform);
        if (index === 0) {
            ctx.moveTo(mapped.x, mapped.y);
        } else {
            ctx.lineTo(mapped.x, mapped.y);
        }
    });
    ctx.closePath();
}

function drawMiniMap3D(viewRacer = racers[0], camera = null) {
    const panelWidth = 192;
    const panelHeight = 144;
    const panelX = WIDTH - panelWidth - 14;
    const panelY = 96; // below the speed bar and pad label, which used to overlap
    const player = viewRacer;
    const centerX = panelX + panelWidth / 2;
    const centerY = panelY + panelHeight / 2;

    ctx.save();
    ctx.fillStyle = "rgba(5, 10, 20, 0.68)";
    ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.strokeRect(panelX + 0.5, panelY + 0.5, panelWidth - 1, panelHeight - 1);
    ctx.beginPath();
    ctx.rect(panelX + 2, panelY + 2, panelWidth - 4, panelHeight - 4);
    ctx.clip();

    // Player-up rotating view: the map turns with the camera so "up" on the
    // panel is always the direction you're driving. A fixed north-up map made
    // the 3D view and the mini-map "not match" moment to moment — the road on
    // screen would bend right while the track at your dot ran left/down on the
    // panel. With the map rotated to your heading, the road ahead of the
    // center marker bends the same way the 3D road does, always. Using the
    // camera's smoothed forward (not raw kart angle) keeps it from twitching.
    const forward = camera ? camera.forward : { x: Math.cos(player.angle), y: Math.sin(player.angle) };
    const heading = Math.atan2(forward.y, forward.x);
    const fitScale = getMiniMapTransform(panelX, panelY, panelWidth, panelHeight).scale;
    const scale = Math.min(fitScale * 2.2, 0.4); // zoomed in for readability, still shows a big stretch of track
    ctx.translate(centerX, centerY);
    ctx.rotate(-Math.PI / 2 - heading);
    ctx.scale(scale, scale);
    ctx.translate(-player.x, -player.y);

    const traceWorldPath = (points) => {
        ctx.beginPath();
        points.forEach((point, index) => {
            if (index === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
        });
        ctx.closePath();
    };

    // the real road shape: smooth centerline, shoulder underlay + asphalt on
    // top, at true-to-scale width so karts/coins on the road edges stay on it
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const roadPoints = centerlinePath.length ? centerlinePath : checkpoints;
    ctx.strokeStyle = "#222c47";
    ctx.lineWidth = shoulderHalfWidth * 2;
    traceWorldPath(roadPoints);
    ctx.stroke();
    ctx.strokeStyle = "#39456a";
    ctx.lineWidth = roadHalfWidth * 2;
    traceWorldPath(roadPoints);
    ctx.stroke();

    ctx.strokeStyle = "rgba(247, 243, 210, 0.95)";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(finishLine.x1, finishLine.y1);
    ctx.lineTo(finishLine.x2, finishLine.y2);
    ctx.stroke();

    // screen-constant sizes: divide desired pixel size by the map scale
    const px = (size) => size / scale;

    // wall-ride zones: a bright dashed line along the rideable shoulder, same
    // color as the in-3D wall rail, so you can see one coming on the map too
    trackWallZones.forEach((zone) => {
        const total = centerlinePath.length;
        if (!total) return;
        const span = zone.to >= zone.from ? zone.to - zone.from : 1 - zone.from + zone.to;
        const steps = Math.max(8, Math.round(span * total));
        ctx.save();
        ctx.strokeStyle = "#53e0ff";
        ctx.lineWidth = px(2.4);
        ctx.setLineDash([px(4), px(3)]);
        ctx.beginPath();
        for (let i = 0; i <= steps; i += 1) {
            const frac = (zone.from + (span * i) / steps) % 1;
            const progress = frac * total;
            const center = getCenterlinePoint(progress);
            const direction = getCenterlineDirection(progress);
            const normal = { x: -direction.y, y: direction.x };
            const edge = shoulderHalfWidth + 6;
            const wx = center.x + normal.x * zone.side * edge;
            const wy = center.y + normal.y * zone.side * edge;
            if (i === 0) ctx.moveTo(wx, wy);
            else ctx.lineTo(wx, wy);
        }
        ctx.stroke();
        ctx.restore();
    });

    // ramps: gold jump, cyan glide — small triangle pointing the launch direction
    trackRamps.forEach((ramp) => {
        const size = px(6);
        ctx.save();
        ctx.translate(ramp.x, ramp.y);
        ctx.rotate(Math.atan2(ramp.dirY, ramp.dirX) + Math.PI / 2);
        ctx.fillStyle = ramp.glide ? "#53e0ff" : "#ffd166";
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.lineTo(size * 0.8, size * 0.7);
        ctx.lineTo(-size * 0.8, size * 0.7);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    });

    // boost pads: a small cyan chevron matching the on-road decal
    trackBoostPads.forEach((pad) => {
        const size = px(5);
        ctx.save();
        ctx.translate(pad.x, pad.y);
        ctx.rotate(Math.atan2(pad.dirY, pad.dirX) + Math.PI / 2);
        ctx.strokeStyle = "#53e0ff";
        ctx.lineWidth = px(1.8);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(-size * 0.6, size * 0.4);
        ctx.lineTo(0, -size * 0.5);
        ctx.lineTo(size * 0.6, size * 0.4);
        ctx.stroke();
        ctx.restore();
    });

    // loops: a magenta ring, same color as the in-3D loop marker
    trackLoops.forEach((loop) => {
        ctx.strokeStyle = "#ff2fd6";
        ctx.lineWidth = px(2.2);
        ctx.beginPath();
        ctx.arc(loop.x, loop.y, px(7), 0, Math.PI * 2);
        ctx.stroke();
    });

    trackCoins.forEach((coin) => {
        if (!coin.active) return;
        ctx.fillStyle = "#ffd166";
        ctx.beginPath();
        ctx.arc(coin.x, coin.y, px(1.8), 0, Math.PI * 2);
        ctx.fill();
    });

    trackHazards.forEach((hazard) => {
        ctx.fillStyle = "rgba(20, 22, 34, 0.95)";
        ctx.strokeStyle = "rgba(150, 130, 220, 0.6)";
        ctx.lineWidth = px(1);
        ctx.beginPath();
        ctx.arc(hazard.x, hazard.y, px(2.6), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    });

    // moving hazards: pulsing warning-orange dot at their live (not base) spot
    trackMovers.forEach((mover) => {
        ctx.fillStyle = "#ff5a28";
        ctx.strokeStyle = "#ffd166";
        ctx.lineWidth = px(1.4);
        ctx.beginPath();
        ctx.arc(mover.liveX, mover.liveY, px(4.5), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    });

    itemBoxes.forEach((box) => {
        if (!box.active) return;
        const size = px(5);
        ctx.save();
        ctx.translate(box.x, box.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = "#53e0ff";
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.restore();
    });

    projectiles.forEach((rocket) => {
        ctx.fillStyle = "#ff5d3a";
        ctx.beginPath();
        ctx.arc(rocket.x, rocket.y, px(2.4), 0, Math.PI * 2);
        ctx.fill();
    });

    racers.slice().sort((a, b) => b.place - a.place).forEach((racer) => {
        if (racer === player) return; // drawn as the fixed center arrow below
        const radius = px(racer.isPlayer ? 4.4 : 3.4);
        ctx.globalAlpha = racer.isFalling ? Math.max(0.15, racer.fallTimer / FALL_DURATION) : 1;
        ctx.fillStyle = racer.color;
        ctx.beginPath();
        ctx.arc(racer.x, racer.y, radius, 0, Math.PI * 2);
        ctx.fill();
        // a dot this small has almost no area for its fill color alone to
        // read against the mini-map's background — same "certain racer
        // colors go missing" risk as the 3D kart sprite, worse here since
        // there's no shape/detail to fall back on, just a colored speck.
        ctx.strokeStyle = "rgba(6,8,14,0.65)";
        ctx.lineWidth = Math.max(0.75, radius * 0.22);
        ctx.stroke();
        ctx.globalAlpha = 1;
    });

    const activeCheckpoint = checkpoints[player.checkpointIndex % checkpoints.length];
    ctx.strokeStyle = "rgba(255, 209, 102, 0.95)";
    ctx.lineWidth = px(2);
    ctx.beginPath();
    ctx.arc(activeCheckpoint.x, activeCheckpoint.y, px(7), 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();

    // you, pinned at the panel center, always pointing up — the direction of travel
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.fillStyle = player.color;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5.4, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5.4, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "rgba(242,245,255,0.92)";
    ctx.font = "700 12px Space Grotesk";
    ctx.fillText("Mini Map", panelX + 10, panelY + 16);
}

/* big kart racers' HUD, rather than the debug-readout panel this used to be.

   MKW puts each piece of information in the corner it belongs to and gives it
   a shape you can read without looking straight at it:
     top-left      the item slot, one big rounded square
     under it      coins, as a coin and a count
     top-right     the lap, as a pill
     bottom-right  your place, as an enormous outlined number
   Nothing sits in the middle of the screen, because that's where the race is.
   Speed and the pad name are the only things kept from the old panel; they're
   diagnostics, so they go small and low-contrast along the bottom edge instead
   of in a bordered box competing with the item slot.

   Everything is laid out in the canvas's own 960x640 space. Split-screen
   scales the whole viewport (see draw()), so these coordinates stay correct at
   any seat count without a second set of numbers. */

// The item slot shows a glyph, not a word — the label is only ever readable
// when you're already looking at it, and during a race you aren't.
const ITEM_GLYPHS = {
    boost: "\u{1F4A8}",
    rocket: "\u{1F680}",
    shield: "\u{1F6E1}\uFE0F",
    oil: "\u{1F6E2}\uFE0F",
    coinbag: "\u{1F4B0}",
    star: "\u2B50",
    lightning: "\u26A1",
    boo: "\u{1F47B}",
};

function placeSuffix(place) {
    // 11th/12th/13th are the exceptions every naive version of this gets wrong;
    // with 13 racers on track they're all reachable.
    if (place % 100 >= 11 && place % 100 <= 13) return "th";
    return { 1: "st", 2: "nd", 3: "rd" }[place % 10] ?? "th";
}

function drawItemSlot(player) {
    const x = 22;
    const y = 20;
    const size = 86;

    ctx.save();
    // Body, then a light top-half wash: the highlight is what makes the slot
    // read as a raised piece of hardware rather than a hole cut in the screen.
    ctx.fillStyle = "rgba(10, 20, 40, 0.52)";
    fillRoundedRect(x, y, size, size, 20);
    const sheen = ctx.createLinearGradient(0, y, 0, y + size);
    sheen.addColorStop(0, "rgba(255,255,255,0.22)");
    sheen.addColorStop(0.55, "rgba(255,255,255,0.04)");
    sheen.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sheen;
    fillRoundedRect(x, y, size, size, 20);

    ctx.lineWidth = 3;
    ctx.strokeStyle = player.item ? "rgba(255, 226, 138, 0.95)" : "rgba(255,255,255,0.42)";
    ctx.beginPath();
    addRoundedRectPath(x + 1.5, y + 1.5, size - 3, size - 3, 18.5);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (player.item) {
        ctx.font = "44px Space Grotesk";
        // fillStyle is still the sheen gradient from painting the slot body;
        // colour emoji ignore it, but the "?" fallback for an unmapped item
        // would otherwise come out as a near-invisible wash.
        ctx.fillStyle = "#ffffff";
        ctx.fillText(ITEM_GLYPHS[player.item] ?? "?", x + size / 2, y + size / 2 + 2);
    } else {
        ctx.font = "700 40px Oswald";
        ctx.fillStyle = "rgba(255,255,255,0.2)";
        ctx.fillText("?", x + size / 2, y + size / 2 + 2);
    }

    // An active shield is a state, not a held item, so it gets its own ring
    // around the slot rather than replacing whatever you're carrying.
    if (player.shieldTimer > 0) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(83, 224, 255, 0.9)";
        ctx.beginPath();
        addRoundedRectPath(x - 5, y - 5, size + 10, size + 10, 24);
        ctx.stroke();
    }
    ctx.restore();
}

function drawCoinCounter(player) {
    const cx = 38;
    const cy = 130;

    ctx.save();
    const coin = ctx.createLinearGradient(cx - 13, cy - 13, cx + 13, cy + 13);
    coin.addColorStop(0, "#ffe89a");
    coin.addColorStop(0.5, "#ffc93c");
    coin.addColorStop(1, "#d98f0d");
    ctx.fillStyle = coin;
    ctx.beginPath();
    ctx.arc(cx, cy, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(120, 74, 4, 0.8)";
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "700 24px Oswald";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(8, 14, 30, 0.8)";
    const label = `\u00D7${player.coins}`;
    ctx.strokeText(label, cx + 20, cy + 1);
    ctx.fillStyle = "#fff6dd";
    ctx.fillText(label, cx + 20, cy + 1);
    ctx.restore();
}

function drawLapPill(player) {
    ctx.save();
    const width = 128;
    const height = 40;
    const x = WIDTH - width - 22;
    const y = 20;
    ctx.fillStyle = "rgba(10, 20, 40, 0.55)";
    fillRoundedRect(x, y, width, height, 20);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.beginPath();
    addRoundedRectPath(x + 1.25, y + 1.25, width - 2.5, height - 2.5, 19);
    ctx.stroke();

    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.font = "700 13px Oswald";
    ctx.fillStyle = "rgba(255,255,255,0.62)";
    ctx.fillText("LAP", x + 16, y + height / 2 + 1);
    ctx.font = "700 26px Oswald";
    ctx.fillStyle = "#ffd166";
    ctx.fillText(`${Math.min(player.lap + 1, getLapsToWin())}/${getLapsToWin()}`, x + 55, y + height / 2 + 1);
    ctx.restore();
}

function drawPlaceBadge(player) {
    // The one number worth reading at a glance mid-corner, so it's drawn the
    // way MKW draws it: huge, in the corner, and outlined heavily enough to
    // stay legible over any track, sky or wall it happens to land on.
    ctx.save();
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    const baseX = WIDTH - 26;
    const baseY = HEIGHT - 26;
    const suffix = placeSuffix(player.place);

    ctx.font = "700 30px Oswald";
    const suffixWidth = ctx.measureText(suffix).width;
    ctx.lineWidth = 7;
    ctx.strokeStyle = "rgba(8, 14, 30, 0.85)";
    ctx.strokeText(suffix, baseX, baseY - 6);
    ctx.fillStyle = "#ffe9b0";
    ctx.fillText(suffix, baseX, baseY - 6);

    ctx.font = "700 78px Oswald";
    ctx.lineWidth = 11;
    ctx.strokeStyle = "rgba(8, 14, 30, 0.85)";
    ctx.strokeText(`${player.place}`, baseX - suffixWidth - 4, baseY);
    // Leading three get the podium colours; everyone else is plain white.
    ctx.fillStyle = player.place === 1 ? "#ffd24a" : player.place === 2 ? "#dfe6f5" : player.place === 3 ? "#e6a86a" : "#ffffff";
    ctx.fillText(`${player.place}`, baseX - suffixWidth - 4, baseY);
    ctx.restore();
}

function drawDriftCharge(player) {
    if (!player.drifting || player.driftCharge <= DRIFT_STAGE1) return;
    const ready = player.driftCharge > DRIFT_STAGE2;
    ctx.save();
    const width = 118;
    const x = 22;
    const y = 152;
    ctx.fillStyle = ready ? "rgba(255, 128, 32, 0.88)" : "rgba(40, 168, 224, 0.88)";
    fillRoundedRect(x, y, width, 26, 13);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 13px Oswald";
    ctx.fillStyle = "#0b1428";
    ctx.fillText(ready ? "MINI-TURBO READY" : "CHARGING\u2026", x + width / 2, y + 14);
    ctx.restore();
}

function drawHUD(viewRacer = racers[0]) {
    const player = viewRacer;
    if (!player) return;

    drawItemSlot(player);
    drawCoinCounter(player);
    drawDriftCharge(player);
    drawLapPill(player);
    drawPlaceBadge(player);

    // Speed and controller name are diagnostics, not race information — bottom
    // edge, low contrast, out of the way of everything above.
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const barX = 22;
    const barY = HEIGHT - 40;
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    fillRoundedRect(barX, barY, 168, 7, 4);
    ctx.fillStyle = "#53e0ff";
    fillRoundedRect(barX, barY, Math.max(4, 168 * Math.min(Math.abs(player.speed) / MAX_SPEED, 1)), 7, 4);
    ctx.font = "700 12px Space Grotesk";
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.fillText(`${Math.round(player.speed)} km/h`, barX, barY - 12);
    ctx.fillStyle = gamepadConnected ? "rgba(155,255,143,0.8)" : "rgba(255,255,255,0.4)";
    ctx.fillText(`Pad: ${gamepadLabel}`, barX, barY + 20);
    ctx.restore();

    if (backHoldStart) {
        const holdProgress = clamp((performance.now() - backHoldStart) / 1000 / BACK_HOLD_SECONDS, 0, 1);
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(4, 6, 12, 0.7)";
        fillRoundedRect(CENTER.x - 110, HEIGHT - 78, 220, 50, 16);
        ctx.fillStyle = "#f2f5ff";
        ctx.font = "600 13px Space Grotesk";
        ctx.fillText("Hold B to exit to hub\u2026", CENTER.x, HEIGHT - 60);
        ctx.fillStyle = "rgba(255,255,255,0.14)";
        fillRoundedRect(CENTER.x - 90, HEIGHT - 45, 180, 8, 4);
        ctx.fillStyle = "#ff6b6b";
        fillRoundedRect(CENTER.x - 90, HEIGHT - 45, 180 * holdProgress, 8, 4);
        ctx.restore();
    }

    if (devModeEnabled) {
        ctx.save();
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = "rgba(4, 6, 12, 0.7)";
        fillRoundedRect(22, 190, 190, 112, 14);
        ctx.strokeStyle = "rgba(83,224,255,0.22)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        addRoundedRectPath(22.5, 190.5, 189, 111, 14);
        ctx.stroke();
        ctx.fillStyle = "#f2f5ff";
        ctx.font = "700 13px Space Grotesk";
        ctx.fillText("DEV MODE", 36, 212);
        ctx.font = "500 12px Space Grotesk";
        ctx.fillText(`Map: ${maps[currentMapKey]?.label ?? currentMapKey}`, 36, 232);
        ctx.fillText(`Checkpoint: ${player.checkpointIndex + 1}/${checkpoints.length}`, 36, 250);
        ctx.fillText(`Lap: ${player.lap}/${getLapsToWin()}`, 36, 268);
        ctx.fillText(`Bots: ${racers.length - 1}`, 36, 286);
        ctx.fillText(`Pos: ${Math.round(player.x)}, ${Math.round(player.y)}`, 36, 304);
        ctx.restore();
    }
}

function drawRaceStartCountdown() {
    if (raceCountdown <= 0 && raceGoTimer <= 0) return;
    // Pausing on the grid would otherwise leave the starting lights and the
    // countdown digit floating behind the pause panel, which is drawn after this.
    if (paused) return;

    const isGo = raceCountdown <= 0;
    const label = isGo ? "GO!" : `${Math.ceil(raceCountdown)}`;
    const alpha = isGo ? clamp(raceGoTimer / 0.62, 0, 1) : 1;
    const y = HEIGHT * 0.34;

    // Each number gets its own pop: MKW punches the digit in oversized and
    // settles it, rather than cutting between three static frames. `fraction`
    // is how far through the current second we are, so the scale is driven by
    // the countdown itself and needs no extra timer.
    const fraction = isGo ? 1 - alpha : 1 - (raceCountdown % 1);
    const pop = 1 + 0.28 * Math.pow(1 - clamp(fraction / 0.35, 0, 1), 2);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(CENTER.x, y);
    ctx.scale(pop, pop);

    // Three starting lights above the number, filling in as the count runs
    // down — the actual thing you watch on a kart-racer grid.
    const lit = isGo ? 3 : 3 - Math.ceil(raceCountdown);
    for (let i = 0; i < 3; i += 1) {
        const lx = (i - 1) * 46;
        const on = i < lit || isGo;
        ctx.beginPath();
        ctx.arc(lx, -118, 15, 0, Math.PI * 2);
        ctx.fillStyle = on ? (isGo ? "#5cff8a" : "#ff4b4b") : "rgba(255,255,255,0.14)";
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(8, 14, 30, 0.75)";
        ctx.stroke();
        if (on) {
            ctx.beginPath();
            ctx.arc(lx, -118, 26, 0, Math.PI * 2);
            ctx.fillStyle = isGo ? "rgba(92, 255, 138, 0.2)" : "rgba(255, 75, 75, 0.2)";
            ctx.fill();
        }
    }

    const glowRadius = isGo ? 190 : 140;
    const glow = ctx.createRadialGradient(0, 0, 20, 0, 0, glowRadius);
    glow.addColorStop(0, isGo ? "rgba(92, 255, 138, 0.36)" : "rgba(255, 209, 102, 0.32)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = `700 ${isGo ? 146 : 132}px Oswald`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Two passes of outline, wide then narrow, gives the thick cream-over-dark
    // edge the classic countdown type has without needing a real font stroke.
    ctx.lineJoin = "round";
    ctx.lineWidth = 18;
    ctx.strokeStyle = "rgba(8, 14, 30, 0.8)";
    ctx.strokeText(label, 0, 0);
    ctx.lineWidth = 9;
    ctx.strokeStyle = "#fff6dd";
    ctx.strokeText(label, 0, 0);
    const fill = ctx.createLinearGradient(0, -70, 0, 70);
    if (isGo) {
        fill.addColorStop(0, "#b7ffd0");
        fill.addColorStop(1, "#22c55e");
    } else {
        fill.addColorStop(0, "#ffe89a");
        fill.addColorStop(1, "#f0a319");
    }
    ctx.fillStyle = fill;
    ctx.fillText(label, 0, 0);
    ctx.restore();
}

function drawFallOverlay(viewRacer = racers[0]) {
    const player = viewRacer;
    if (!player || !player.isFalling) return;

    const progress = 1 - player.fallTimer / FALL_DURATION;
    const alpha = progress < 0.2 ? progress / 0.2 : progress > 0.8 ? (1 - progress) / 0.2 : 1;

    ctx.save();
    const vignette = ctx.createRadialGradient(CENTER.x, CENTER.y, HEIGHT * 0.2, CENTER.x, CENTER.y, HEIGHT * 0.75);
    vignette.addColorStop(0, "rgba(120, 10, 10, 0)");
    vignette.addColorStop(1, `rgba(120, 10, 10, ${0.55 * alpha})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.globalAlpha = alpha;
    ctx.font = "700 64px Oswald";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 8;
    ctx.strokeStyle = "rgba(6, 10, 24, 0.8)";
    ctx.strokeText("OFF TRACK!", CENTER.x, CENTER.y);
    ctx.fillStyle = "#ff6b6b";
    ctx.fillText("OFF TRACK!", CENTER.x, CENTER.y);
    ctx.restore();
}

/* Pausing is the only moment in a race where you have time to read, so it's
 * where the controls belong. The old overlay said "PAUSED" and how to unpause,
 * which is the one thing you already knew — everything you might actually have
 * paused to look up was buried in the pre-race menu behind a fresh page load.
 *
 * What's listed adapts to how you're actually playing: the keyboard scheme for
 * your own seat (each split-screen seat has a different one), your real gamepad
 * bindings if a pad is connected (including any you've remapped), and the touch
 * buttons only when a touchscreen is what's driving. */
function pauseControlSections() {
    const sections = [];

    const seatCount = Math.max(1, localPlayerCount);
    for (let seat = 0; seat < seatCount; seat += 1) {
        const scheme = seatCount > 1 ? LOCAL_CONTROL_SCHEMES[seat] : DEFAULT_CONTROLS;
        if (!scheme) continue;
        const rows = [
            ["Steer / accelerate", keyComboLabel(scheme.up, scheme.left, scheme.down, scheme.right)],
            ["Use item", keyListLabel(scheme.boost)],
            ["Drift", `Hold ${keyListLabel(scheme.drift)}`],
        ];
        if (scheme.mouse) rows.push(["Mouse steering", "Move to steer, click to use an item"]);
        sections.push({ title: seatCount > 1 ? `Player ${seat + 1} \u00b7 keyboard` : "Keyboard", rows });
    }

    if (gamepadConnected) {
        // GAMEPAD_REMAPPABLE is the list of actions the remap UI offers, which
        // leaves out steering (bound to the stick and the D-pad, not rebindable)
        // — but steering is the first thing anyone picking up a pad wants to
        // know, so it's listed here even though it isn't remappable.
        sections.push({
            title: `Gamepad \u00b7 ${gamepadLabel}`,
            rows: [
                ["Steer", `Left stick, or ${padBindingLabel("steerLeft")} / ${padBindingLabel("steerRight")}`],
                ...GAMEPAD_REMAPPABLE.map(({ key, label }) => [label, padBindingLabel(key)]),
            ],
        });
    }

    sections.push({
        title: "Anywhere",
        rows: [
            ["Pause / resume", gamepadConnected ? "P, or + on the pad" : "P"],
            ["Back to the hub", gamepadConnected ? "Esc, or hold B" : "Esc"],
            ["Fullscreen", "F"],
        ],
    });

    return sections;
}

// "ArrowUp" / "KeyW" / "Numpad8" are how the browser names a key; nobody calls
// them that out loud, so they're printed the way they're written on the key.
function prettyKeyName(code) {
    if (!code) return "";
    if (code.startsWith("Arrow")) return { ArrowUp: "\u2191", ArrowDown: "\u2193", ArrowLeft: "\u2190", ArrowRight: "\u2192" }[code] ?? code;
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    if (code === "Space") return "Space";
    if (code === "ShiftLeft") return "L-Shift";
    if (code === "ShiftRight") return "R-Shift";
    if (code === "NumpadAdd") return "Numpad +";
    if (code.startsWith("Numpad")) return `Numpad ${code.slice(6)}`;
    return code;
}

function keyListLabel(codes) {
    if (!codes || !codes.length) return "\u2014";
    return codes.map(prettyKeyName).join(" or ");
}

function keyComboLabel(up, left, down, right) {
    return `${prettyKeyName(up?.[0])} ${prettyKeyName(left?.[0])} ${prettyKeyName(down?.[0])} ${prettyKeyName(right?.[0])}`;
}

function padBindingLabel(actionKey) {
    const bound = gamepadMapping?.[actionKey];
    if (bound === undefined || bound === null) return "\u2014";
    const indexes = Array.isArray(bound) ? bound : [bound];
    return indexes.map((index) => gamepadButtonName(index)).join(" / ") || "\u2014";
}

function drawPausedOverlay() {
    if (!paused) return;

    const sections = pauseControlSections();
    const rowHeight = 21;
    const headerHeight = 30;
    const sectionGap = 16;
    const heights = sections.map((section) => headerHeight + section.rows.length * rowHeight + sectionGap);

    // Two columns, balanced by height rather than by count: the gamepad section
    // alone is eleven rows against the keyboard's four, so splitting down the
    // middle of the *list* would leave one column twice the length of the other.
    const total = heights.reduce((sum, h) => sum + h, 0);
    const columns = [[], []];
    const columnHeights = [0, 0];
    sections.forEach((section, i) => {
        const target = columnHeights[0] > 0 && columnHeights[0] + heights[i] > total / 2 + headerHeight ? 1 : 0;
        columns[target].push(section);
        columnHeights[target] += heights[i];
    });
    const twoColumns = columns[1].length > 0;

    const padding = 26;
    const columnWidth = 336;
    const panelWidth = padding * 2 + columnWidth * (twoColumns ? 2 : 1) + (twoColumns ? 24 : 0);
    const panelHeight = padding * 2 + Math.max(columnHeights[0], columnHeights[1]) - sectionGap + 34;
    const panelX = CENTER.x - panelWidth / 2;
    const panelY = Math.max(88, CENTER.y - panelHeight / 2 + 16);

    ctx.save();
    ctx.fillStyle = "rgba(6, 9, 18, 0.74)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 56px Oswald";
    ctx.lineJoin = "round";
    ctx.lineWidth = 12;
    ctx.strokeStyle = "rgba(7, 10, 20, 0.9)";
    ctx.strokeText("PAUSED", CENTER.x, panelY - 34);
    ctx.fillStyle = "#fff6dd";
    ctx.fillText("PAUSED", CENTER.x, panelY - 34);

    // Cream-bordered navy slab, the same panel the pre-race menu uses — the
    // pause screen is part of the same menu system, so it looks like it.
    ctx.fillStyle = "rgba(9, 24, 56, 0.94)";
    fillRoundedRect(panelX, panelY, panelWidth, panelHeight, 24);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#fff6dd";
    ctx.beginPath();
    addRoundedRectPath(panelX + 2, panelY + 2, panelWidth - 4, panelHeight - 4, 22);
    ctx.stroke();

    ctx.textBaseline = "alphabetic";
    columns.forEach((column, columnIndex) => {
        let y = panelY + padding + 12;
        const x = panelX + padding + columnIndex * (columnWidth + 24);
        column.forEach((section) => {
            ctx.textAlign = "left";
            ctx.font = "700 13px Oswald";
            ctx.fillStyle = "#ffd166";
            ctx.fillText(section.title.toUpperCase(), x, y);
            ctx.fillStyle = "rgba(255, 209, 102, 0.35)";
            ctx.fillRect(x, y + 7, columnWidth, 2);
            y += headerHeight;

            section.rows.forEach(([label, value]) => {
                ctx.textAlign = "left";
                ctx.font = "500 13px Space Grotesk";
                ctx.fillStyle = "rgba(206, 224, 255, 0.78)";
                ctx.fillText(label, x, y);
                ctx.textAlign = "right";
                ctx.font = "700 13px Space Grotesk";
                ctx.fillStyle = "#ffffff";
                ctx.fillText(value, x + columnWidth, y);
                y += rowHeight;
            });
            y += sectionGap;
        });
    });

    ctx.textAlign = "center";
    ctx.font = "600 14px Space Grotesk";
    ctx.fillStyle = "rgba(242,245,255,0.85)";
    ctx.fillText(gamepadConnected ? "Press P or + to resume" : "Press P or the Pause button to resume", CENTER.x, panelY + panelHeight - 18);
    ctx.restore();
}

function applyHDRPostProcess() {
    if (!hdrEnabled) return;
    const bw = bloomCanvas.width;
    const bh = bloomCanvas.height;

    // bloom: downscale, crush the mids so only bright pixels survive, blur, add back.
    // the sky is deliberately excluded from the bloom source — this cartoon art
    // style's pastel sky gradients read almost as bright as genuine highlights
    // (sun, drift sparks, headlights) once contrast-crushed, so without this the
    // whole sky bloomed itself into a washed-out white sheet; clipping the source
    // to the ground/road area below the horizon keeps the glow on real highlights
    const skyCutoff = renderMode === "3d" ? clamp(lastCameraHorizon, 0, HEIGHT) : 0;
    const sourceHeight = HEIGHT - skyCutoff;
    const destY = skyCutoff / 4;
    const destHeight = bh - destY;

    bloomCtx.clearRect(0, 0, bw, bh);
    bloomCtx.filter = "contrast(2.4) brightness(0.6) saturate(1.6) blur(3px)";
    if (sourceHeight > 0) {
        bloomCtx.drawImage(canvas, 0, skyCutoff, WIDTH, sourceHeight, 0, destY, bw, destHeight);
    }
    bloomCtx.filter = "none";

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.5;
    ctx.drawImage(bloomCanvas, 0, 0, WIDTH, HEIGHT);

    // gentle tone-map vignette: keeps the center bright, cools the corners
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 1;
    const vignette = ctx.createRadialGradient(CENTER.x, CENTER.y, HEIGHT * 0.45, CENTER.x, CENTER.y, HEIGHT * 0.98);
    vignette.addColorStop(0, "#ffffff");
    vignette.addColorStop(1, "#c3c9dd");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.restore();
}

function drawOffRoadWarning(player) {
    if (!player || player.isFalling || player.offRoadTimer <= 0.08) return;
    const urgency = clamp(player.offRoadTimer / OFF_ROAD_FALL_DELAY, 0, 1);
    const y = HEIGHT * 0.2;
    ctx.save();
    ctx.globalAlpha = 0.55 + 0.45 * urgency;
    ctx.font = "700 44px Oswald";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(6, 10, 24, 0.75)";
    ctx.strokeText("OFF TRACK!", CENTER.x, y);
    ctx.fillStyle = urgency > 0.6 ? "#ff5d5d" : "#ffd166";
    ctx.fillText("OFF TRACK!", CENTER.x, y);
    // meter counting down to the fall
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.fillRect(CENTER.x - 90, y + 36, 180, 8);
    ctx.fillStyle = "#ff5d5d";
    ctx.fillRect(CENTER.x - 90, y + 36, 180 * urgency, 8);
    ctx.restore();
}

// ======================= Real 3D rendering (Three.js / WebGL) =======================
// Replaces the hand-rolled manual-projection pseudo-3D pipeline above with an actual
// WebGL scene. Architecture: a single off-DOM canvas holds a THREE.WebGLRenderer;
// each 3D-mode frame renders into it, then that canvas is blitted onto the real
// #game 2D canvas via ctx.drawImage BEFORE any HUD/menu drawing — this keeps every
// other system in this file (fullscreen, touch hit-testing, split-screen clip/scale,
// the HDR bloom readback below, pad-cursor.js's DOM reach into this iframe) working
// completely unmodified, since they only ever assumed one #game 2D canvas element,
// and that's still true. The drawImage MUST happen synchronously, in the same call
// stack as render() — WebGL's drawing buffer can be implicitly cleared once the
// event loop yields (preserveDrawingBuffer defaults to false).
let three3DAvailable = false;
let renderer3D = null;
let offscreen3D = null;
let scene3D = null;
let sceneCamera3D = null;
let mapGroup3D = null; // static per-map geometry, rebuilt by build3DScene() every applyMap()
let kartRig3D = new Map(); // racer -> mesh rig, resynced every applyMap() since racers[] is rebuilt then

// --- WebXR (VR) state ---
// sceneCamera3D lives inside this rig rather than being positioned directly:
// Three's WebXRManager composes the headset's tracked pose on top of the
// CAMERA'S PARENT transform while presenting, so moving the camera itself
// (as the flat-screen path still does) would fight the headset's own
// tracking. Moving this rig instead is the standard/documented pattern.
let xrRig = null;
let xrHudMesh = null;
let xrHudCanvas = null;
let xrHudCtx = null;
let xrHudTexture = null;
let xrHudLastLap = null;
let xrHudLastPlace = null;
let xrHudLastWaiting = null;
let xrHudLastPaused = null;
let xrHudLastNotice = null;
let xrHudLastMpKey = null;
let xrHudLastCountdown = null;
let xrMenuButtonWasPressed = false;
let xrWheelMesh = null;
let xrSupported = false;
let preVRCameraMode = null;
// one merged virtual "pad" from both hands — same shape as one slot of
// gamepadSeatInputs, fed into updatePlayer()'s existing multi-source merge
let xrInputState = { steer: 0, accelerate: false, brake: false, boost: false, drift: false };

function initThree3D() {
    if (typeof THREE === "undefined") return;
    offscreen3D = document.createElement("canvas");
    offscreen3D.width = WIDTH;
    offscreen3D.height = HEIGHT;
    let gl = offscreen3D.getContext("webgl2", { antialias: true, alpha: false });
    if (!gl) gl = offscreen3D.getContext("webgl", { antialias: true, alpha: false });
    if (!gl) {
        three3DAvailable = false;
        return;
    }
    try {
        renderer3D = new THREE.WebGLRenderer({ canvas: offscreen3D, context: gl, antialias: true });
    } catch (e) {
        three3DAvailable = false;
        return;
    }
    renderer3D.setSize(WIDTH, HEIGHT, false);
    // Was pinned to 1 for the weakest machine; now follows the hub's graphics
    // setting so a capable GPU renders at its real resolution.
    renderer3D.setPixelRatio(window.MimiGfx ? window.MimiGfx.pixelRatio() : 1);
    scene3D = new THREE.Scene();
    sceneCamera3D = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 4, 3600);
    mapGroup3D = new THREE.Group();
    mapGroup3D.userData = {};
    scene3D.add(mapGroup3D);

    xrRig = new THREE.Group();
    xrRig.add(sceneCamera3D);
    scene3D.add(xrRig);
    initXRHud();

    renderer3D.xr.enabled = true;
    // "local" (head-relative origin), not "local-floor" — this is a seated
    // driver's-eye view whose height is already fully computed every frame
    // from the kart/camera math below; additionally baking in the headset's
    // own real-world floor-height guess on top would just add an
    // unpredictable, player-height-dependent vertical offset.
    renderer3D.xr.setReferenceSpaceType("local");

    three3DAvailable = true;

    // WebGL (unlike 2D canvas) can lose its context outright — backgrounded mobile
    // tab, driver reset, GPU process crash. Pause cleanly instead of leaving a
    // permanently-black 3D layer under a still-working HUD (a uniquely confusing
    // failure mode with no equivalent in the old renderer). render3DScene() falls
    // back to the original pseudo-3D pipeline below whenever this flag is false,
    // so the game keeps playing either way.
    offscreen3D.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        three3DAvailable = false;
        syncVRButton();
    });
    offscreen3D.addEventListener("webglcontextrestored", () => {
        three3DAvailable = true;
        build3DScene();
        syncVRButton();
    });

    initXRSupport();
}

// A small canvas-texture plane showing lap/place only, parented to the RIG
// (not the headset) so it behaves like a fixed dashboard gauge rather than a
// UI element pinned to the center of vision as the player turns their head.
// Same baked-texture technique buildSkyTexture3D() already uses elsewhere in
// this file — redrawn only when the value actually changes, not per frame.
function initXRHud() {
    xrHudCanvas = document.createElement("canvas");
    xrHudCanvas.width = 512;
    xrHudCanvas.height = 128;
    xrHudCtx = xrHudCanvas.getContext("2d");
    xrHudTexture = new THREE.CanvasTexture(xrHudCanvas);
    const geometry = new THREE.PlaneGeometry(1.1, 0.28);
    const material = new THREE.MeshBasicMaterial({ map: xrHudTexture, transparent: true, depthTest: false });
    xrHudMesh = new THREE.Mesh(geometry, material);
    // Higher and further out than the wheel below — a dashboard readout
    // above the wheel rim, not competing with it for the same view space
    // (the wheel sits much closer/lower, see initXRWheel) — local to the
    // rig, so it moves with the kart.
    xrHudMesh.position.set(0, -0.08, -1.3);
    xrHudMesh.rotation.x = -0.2;
    xrHudMesh.visible = false;
    xrHudMesh.renderOrder = 999;
    xrRig.add(xrHudMesh);
    initXRWheel();
}

// A simple procedural wheel (no external model needed) so VR reads as
// sitting inside the kart rather than hovering a camera above it — same
// "parented to the rig, not the headset" trick as the HUD panel above, so it
// stays put in front of the driver like a real wheel rather than tracking
// head turns. Visible only in VR; the flat 2D/3D-non-XR views are untouched.
function initXRWheel() {
    xrWheelMesh = new THREE.Group();
    const rimMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.55, metalness: 0.2 });
    const spokeMaterial = new THREE.MeshStandardMaterial({ color: 0x2c313c, roughness: 0.5, metalness: 0.35 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 12, 28), rimMaterial);
    xrWheelMesh.add(rim);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.05, 16), spokeMaterial);
    hub.rotation.x = Math.PI / 2;
    xrWheelMesh.add(hub);
    for (let i = 0; i < 3; i += 1) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.018, 0.018), spokeMaterial);
        spoke.position.set(Math.cos((i / 3) * Math.PI * 2) * 0.1, Math.sin((i / 3) * Math.PI * 2) * 0.1, 0);
        spoke.rotation.z = (i / 3) * Math.PI * 2;
        xrWheelMesh.add(spoke);
    }
    // tilted back like a real wheel column, positioned where hands would
    // naturally rest — closer and lower than the dashboard HUD panel above it
    xrWheelMesh.position.set(0, -0.42, -0.55);
    xrWheelMesh.rotation.x = -0.55;
    xrWheelMesh.visible = false;
    xrWheelMesh.renderOrder = 998;
    xrRig.add(xrWheelMesh);
}

// Rotates around the wheel's own forward axis (its local Z, after the
// column's backward tilt above) so it reads as spinning like a real
// steering wheel rather than tipping forward/back.
function updateXRWheel() {
    if (!xrWheelMesh) return;
    xrWheelMesh.rotation.z = -xrInputState.steer * 2.2;
}

function updateXRHud(player) {
    // The real "Start Race"/"Race Again" button and the pause/status screen
    // all live in the flat DOM overlay (see `overlay`/`startButton` above) —
    // invisible and unreachable once a headset owns the display (confirmed
    // live: entering VR before the race started just showed nothing, no way
    // to begin; pausing left no indication it had even happened). Mirror
    // each of those states into the same in-world HUD panel already used
    // for lap/place — the actual button handling for all of them lives in
    // updateXRInput.
    const waiting = !overlay.classList.contains("hidden");
    const pausedNow = Boolean(paused);
    // Item pickups/usage (star power, lightning, a Boo steal, ...) only ever
    // called raceNotice(), which just sets the flat statusText element — also
    // invisible to a headset, so those were silently lost in VR too
    // (confirmed live: using a Boo or getting struck by lightning gave no
    // indication anything happened at all while presenting).
    const notice = !waiting && !pausedNow && raceNoticeTimer > 0 ? raceNoticeText : null;
    // Wireless multiplayer's own room/host status (see the flat mpStatus
    // text this mirrors) — also invisible in VR otherwise, and directly
    // relevant to the thumbstick-click handled in updateXRInput: a joiner's
    // click no longer starts their own race (see startRace's mpConnected
    // guard), so the HUD needs to say why nothing happened.
    const mpKey = waiting && !raceOver ? `${mpConnected}|${mpIsHost}|${mpRoomCodeValue}` : null;
    // The "3, 2, 1, GO!" countdown (drawRaceStartCountdown, the flat 2D-canvas
    // version) never reaches the headset either, for the same reason as the
    // states above — it's drawn onto `ctx`, which VR never blits from. Unlike
    // those, it wasn't covered when this HUD was first added, so entering VR
    // and starting a race jumped straight from "waiting" to a bare lap/place
    // readout with no countdown at all (confirmed live). Same mirror pattern:
    // reuse raceCountdown/raceGoTimer, the exact state drawRaceStartCountdown
    // already gates on.
    const countdownLabel = !waiting && !pausedNow && (raceCountdown > 0 || raceGoTimer > 0) ? (raceCountdown > 0 ? Math.ceil(raceCountdown) : "GO") : null;
    if (waiting === xrHudLastWaiting && pausedNow === xrHudLastPaused && player.lap === xrHudLastLap && player.place === xrHudLastPlace && notice === xrHudLastNotice && mpKey === xrHudLastMpKey && countdownLabel === xrHudLastCountdown) return;
    xrHudLastWaiting = waiting;
    xrHudLastPaused = pausedNow;
    xrHudLastLap = player.lap;
    xrHudLastPlace = player.place;
    xrHudLastNotice = notice;
    xrHudLastMpKey = mpKey;
    xrHudLastCountdown = countdownLabel;
    xrHudCtx.clearRect(0, 0, xrHudCanvas.width, xrHudCanvas.height);
    xrHudCtx.fillStyle = "rgba(10, 15, 26, 0.55)";
    xrHudCtx.fillRect(0, 0, xrHudCanvas.width, xrHudCanvas.height);
    xrHudCtx.fillStyle = "#fff";
    xrHudCtx.textBaseline = "middle";
    xrHudCtx.textAlign = "center";
    // Font size sized to the canvas at 48px was tuned for the short
    // lap/place text below — the longer waiting/paused messages overflowed
    // clean off both edges of the 512px-wide canvas at that size and
    // (confirmed live) rendered as nothing visible at all. Shrink to fit
    // instead of guessing a fixed smaller size.
    function fitText(text, maxSize, y = xrHudCanvas.height / 2, weight = 700) {
        let size = maxSize;
        while (size > 14) {
            xrHudCtx.font = `${weight} ${size}px Space Grotesk, sans-serif`;
            if (xrHudCtx.measureText(text).width <= xrHudCanvas.width - 24) break;
            size -= 2;
        }
        xrHudCtx.fillText(text, xrHudCanvas.width / 2, y);
    }
    if (waiting) {
        if (raceOver) {
            // The actual result ("You win!", a place, or a cup-complete
            // summary) lives in the flat overlay's own <h2> — which a
            // headset can't see at all (confirmed live: finishing a race in
            // VR silently dropped straight to the generic "click to start"
            // prompt with no indication of how the race went). Mirror that
            // same text into the HUD instead of a second, VR-only copy of
            // the result logic.
            const resultText = overlay.querySelector("h2")?.textContent?.trim() || "Race complete";
            fitText(resultText, 40, xrHudCanvas.height / 2 - 22);
            fitText("Click the thumbstick to continue", 22, xrHudCanvas.height / 2 + 26, 600);
        } else if (mpConnected) {
            if (mpIsHost) {
                fitText(`Room ${mpRoomCodeValue}`, 36, xrHudCanvas.height / 2 - 22);
                fitText("Click the thumbstick to start", 22, xrHudCanvas.height / 2 + 26, 600);
            } else {
                fitText("Connected — waiting for host to start", 32);
            }
        } else {
            fitText("Click the thumbstick to start", 48);
        }
    } else if (pausedNow) {
        fitText("PAUSED — click thumbstick to resume", 48);
    } else if (countdownLabel !== null) {
        const isGo = countdownLabel === "GO";
        xrHudCtx.fillStyle = isGo ? "#53e0ff" : "#ffd166";
        xrHudCtx.font = `700 ${isGo ? 72 : 64}px Space Grotesk, sans-serif`;
        xrHudCtx.fillText(isGo ? "GO!" : String(countdownLabel), xrHudCanvas.width / 2, xrHudCanvas.height / 2);
    } else if (notice) {
        fitText(notice, 44);
    } else {
        xrHudCtx.font = "700 48px Space Grotesk, sans-serif";
        const lapText = `Lap ${Math.min(player.lap + 1, getLapsToWin())}/${getLapsToWin()}`;
        const placeText = `P${player.place}/${racers.length}`;
        xrHudCtx.fillText(`${lapText}   ${placeText}`, xrHudCanvas.width / 2, xrHudCanvas.height / 2);
    }
    xrHudTexture.needsUpdate = true;
}

// Feature-detection only — iOS Safari (and any browser with no navigator.xr
// at all) resolves this to false immediately with no other effect on the
// game; the button below simply never appears there.
async function initXRSupport() {
    try {
        xrSupported = Boolean(navigator.xr) && await navigator.xr.isSessionSupported("immersive-vr");
    } catch (e) {
        xrSupported = false;
    }
    syncVRButton();
}

function syncVRButton() {
    if (!vrButton) return;
    const presenting = Boolean(renderer3D?.xr?.isPresenting);
    const eligible = xrSupported && three3DAvailable && renderMode === "3d" && localPlayerCount <= 1;
    vrButton.hidden = !eligible && !presenting;
    vrButton.textContent = presenting ? "Exit VR" : "Enter VR";
}

async function enterVR() {
    if (renderMode !== "3d") {
        statusText.textContent = "Switch to 3D mode to use VR.";
        return;
    }
    if (localPlayerCount > 1) {
        statusText.textContent = "Exit split-screen (1 local player) to use VR.";
        return;
    }
    if (!xrSupported || !renderer3D) {
        statusText.textContent = "VR isn't supported in this browser/device.";
        return;
    }
    let session;
    try {
        session = await navigator.xr.requestSession("immersive-vr");
    } catch (e) {
        statusText.textContent = "Couldn't start VR — headset may have declined or disconnected.";
        return;
    }
    try {
        await renderer3D.xr.setSession(session);
    } catch (e) {
        statusText.textContent = "Couldn't start VR: " + e.message;
        return;
    }
    session.addEventListener("end", onXRSessionEnd);
    preVRCameraMode = currentCameraMode;
    currentCameraMode = "hood";
    syncCamButton();
    if (!loopActive) {
        loopActive = true;
        renderer3D.setAnimationLoop(loop);
    }
    syncVRButton();
}

function exitVR() {
    const session = renderer3D?.xr?.getSession();
    if (session) session.end();
}

function onXRSessionEnd() {
    if (preVRCameraMode) {
        currentCameraMode = preVRCameraMode;
        preVRCameraMode = null;
        syncCamButton();
    }
    if (xrHudMesh) xrHudMesh.visible = false;
    if (xrWheelMesh) xrWheelMesh.visible = false;
    // Three's own internal sessionend handling already reverts the frame
    // driver to plain requestAnimationFrame — no manual setAnimationLoop
    // call needed here.
    syncVRButton();
}

// XR controllers are session-scoped (session.inputSources), not part of the
// regular Gamepad API surfaced by navigator.getGamepads() — a separate
// per-frame read is required, unlike keyboard/mouse/regular-gamepad which
// share existing global state. Standard xr-standard gamepad mapping.
function updateXRInput() {
    const session = renderer3D?.xr?.isPresenting ? renderer3D.xr.getSession() : null;
    if (!session) {
        xrInputState = { steer: 0, accelerate: false, brake: false, boost: false, drift: false };
        return;
    }
    let steer = 0;
    let accelerate = false;
    let brake = false;
    let boost = false;
    let drift = false;
    let menuButton = false;
    session.inputSources.forEach((source) => {
        const pad = source.gamepad;
        if (!pad) return;
        const axisX = pad.axes[2] ?? pad.axes[0] ?? 0;
        if (Math.abs(axisX) > 0.12) steer = clamp(steer + axisX, -1, 1);
        if (pad.buttons[0]?.pressed) accelerate = true;
        if (pad.buttons[1]?.pressed) brake = true;
        if (pad.buttons[4]?.pressed) boost = true;
        if (pad.buttons[5]?.pressed) drift = true;
        // thumbstick click — the one xr-standard button nothing else here
        // claims. Deliberately NOT the trigger: that's also "accelerate"
        // (button 0), and edge-triggering start/pause off the same button
        // meant every press-to-drive would immediately pause the race too
        // (confirmed live before this was split out).
        if (pad.buttons[3]?.pressed) menuButton = true;
    });
    xrInputState = { steer, accelerate, brake, boost, drift };

    // Start/pause the same way the regular-gamepad mapping's own "start"
    // button already does (see the triggerGamepadAction("start", ...) call
    // above) — one button, meaning depends on state — since the flat DOM
    // Start Race button and pause control are both invisible and
    // unreachable once a headset owns the display (see updateXRHud).
    // Edge-triggered so holding it down doesn't repeatedly fire.
    if (menuButton && !xrMenuButtonWasPressed) {
        if (!running || raceOver) startRace();
        else togglePause();
    }
    xrMenuButtonWasPressed = menuButton;
}

// world (x, y ground-plane + elevation) -> Three.js (Y-up)
function toThreeX(worldX) { return worldX; }
function toThreeZ(worldY) { return worldY; }
// A hand-derived angle->quaternion sign is exactly how 2D-to-3D ports end up
// mirrored/backwards (steer left, camera goes right). Verified algebraically:
// rotation.y = θ rotates local -Z (this rig's "forward") to world (-sinθ, -cosθ)
// in (x,z); solving -sinθ=cos(a), -cosθ=sin(a) for the world math-convention
// angle `a` (atan2 CCW from +X, this file's convention throughout) gives
// θ = -a - π/2. Used for every static/rig yaw; the camera itself never uses
// this at all — it's aimed with lookAt() instead (see render3DScene), which
// sidesteps the sign question entirely.
function worldAngleToThreeYaw(angle) { return -angle - Math.PI / 2; }
// Derived exactly from the same pinhole-camera math projectWorldPoint used
// (scale = projection/depth) so every camera mode's existing zoom feel
// (tuned into cameraModes all session) carries over exactly, not approximated.
function fovYFromProjection(projection) {
    return 2 * Math.atan((HEIGHT / 2) / projection) * (180 / Math.PI);
}

function disposeObject3D(obj) {
    obj.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) {
            (Array.isArray(node.material) ? node.material : [node.material]).forEach((m) => m.dispose());
        }
    });
}

function buildKartRig3D(color) {
    const group = new THREE.Group();

    const body = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 32), new THREE.MeshToonMaterial({ color: new THREE.Color(color) }));
    body.position.set(0, 10, 0);
    group.add(body);

    // inverted-hull outline (a slightly larger, backface-only dark duplicate) —
    // reads as a clean silhouette; EdgesGeometry would draw every internal
    // box seam too and look busy on a shape this simple.
    const outline = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 32), new THREE.MeshBasicMaterial({ color: 0x0a0f1a, side: THREE.BackSide }));
    outline.position.copy(body.position);
    outline.scale.set(1.2, 1.24, 1.1);
    group.add(outline);

    const wheelGeo = new THREE.CylinderGeometry(5, 5, 6, 10);
    const wheelMat = new THREE.MeshToonMaterial({ color: 0x07101a });
    // z<0 = front (nose), z>0 = rear (spoiler side) — matches worldAngleToThreeYaw's
    // -Z-is-forward convention derived above
    const wheels = [[-12, 5, -11], [12, 5, -11], [-12, 5, 11], [12, 5, 11]].map(([x, y, z]) => {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, y, z);
        group.add(wheel);
        return wheel;
    });

    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(19, 4, 3), new THREE.MeshToonMaterial({ color: 0x0c1220 }));
    spoiler.position.set(0, 17, 15);
    group.add(spoiler);

    const helmet = new THREE.Mesh(new THREE.SphereGeometry(5.5, 10, 8), new THREE.MeshToonMaterial({ color: 0x0c1220 }));
    helmet.position.set(0, 18, -4);
    group.add(helmet);

    [-6, 6].forEach((x) => {
        const light = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 1), new THREE.MeshBasicMaterial({ color: 0xbe2d2d }));
        light.position.set(x, 11, 16.4);
        group.add(light);
    });

    // ground shadow — reuses the same flat radial-blob visual language as the
    // old renderer's ctx.ellipse shadows, rather than real shadow-mapping
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(17, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.4;
    group.add(shadow);

    const shield = new THREE.Mesh(new THREE.TorusGeometry(22, 1.6, 8, 24), new THREE.MeshBasicMaterial({ color: 0x53e0ff, transparent: true, opacity: 0.82 }));
    shield.rotation.x = Math.PI / 2;
    shield.visible = false;
    group.add(shield);

    const boostGlow = [-6, 6].map((x) => {
        const glow = new THREE.Mesh(new THREE.SphereGeometry(4.5, 6, 6), new THREE.MeshBasicMaterial({ color: 0x53e0ff, transparent: true, opacity: 0.55 }));
        glow.position.set(x, 9, 18);
        glow.visible = false;
        group.add(glow);
        return glow;
    });

    return { group, body, outline, wheels, spoiler, helmet, shadow, shield, boostGlow };
}

function updateKartRig3D(racer, rig) {
    const speedFactor = clamp(Math.abs(racer.speed) / MAX_SPEED, 0, 1);
    const bounce = Math.sin(raceElapsed * 13) * speedFactor * 0.7;
    const hopProgress = racer.hopTimer > 0 ? 1 - racer.hopTimer / HOP_DURATION : 0;
    const hopLift = Math.sin(hopProgress * Math.PI) * (HOP_HEIGHT * 0.32) + (racer.airHeight || 0);

    rig.group.position.set(toThreeX(racer.x), Math.max(0, hopLift + bounce), toThreeZ(racer.y));
    rig.group.rotation.set(0, worldAngleToThreeYaw(racer.angle), 0);
    rig.group.scale.setScalar(1);

    if (racer.isFalling) {
        const fallProgress = 1 - racer.fallTimer / FALL_DURATION;
        rig.group.scale.setScalar(Math.max(0.05, 1 - fallProgress * 0.9));
        rig.group.rotation.y += fallProgress * Math.PI * 2.4;
        rig.group.rotation.x = fallProgress * Math.PI * 1.6;
    } else if (racer.spinTimer > 0) {
        rig.group.rotation.y += (1 - racer.spinTimer / SPIN_OUT_DURATION) * Math.PI * 4;
    } else if (racer.wallCharge > 0) {
        rig.group.rotation.z = -racer.wallSide * 0.3;
    }

    rig.shield.visible = racer.shieldTimer > 0;
    rig.shield.rotation.y += 0.08;
    rig.boostGlow.forEach((glow) => { glow.visible = racer.boostTimer > 0; });
    const liftMax = HOP_HEIGHT + GLIDE_AIR_HEIGHT * 1.5;
    rig.shadow.scale.setScalar(clamp(1 - clamp(hopLift / liftMax, 0, 1), 0.15, 1));
}

function syncKartRigs3D() {
    if (!three3DAvailable) return;
    kartRig3D.forEach((rig, racer) => {
        if (!racers.includes(racer)) {
            scene3D.remove(rig.group);
            disposeObject3D(rig.group);
            kartRig3D.delete(racer);
        }
    });
    racers.forEach((racer) => {
        if (!kartRig3D.has(racer)) {
            const rig = buildKartRig3D(racer.color);
            scene3D.add(rig.group);
            kartRig3D.set(racer, rig);
        }
    });
}

function buildRoadMesh3D(palette) {
    const n = centerlinePath.length;
    const group = new THREE.Group();
    if (!n) return group;
    const positions = [];
    const normals = [];
    const colors = [];
    const roadA = new THREE.Color(palette.roadA).toArray();
    const roadB = new THREE.Color(palette.roadB).toArray();
    const shoulderA = new THREE.Color(palette.shoulderA).toArray();
    const shoulderB = new THREE.Color(palette.shoulderB).toArray();
    const curbA = new THREE.Color(palette.curbA).toArray();
    const curbB = new THREE.Color(palette.curbB).toArray();

    function pushQuad(a, b, c, d, color) {
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        positions.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
        for (let i = 0; i < 6; i += 1) {
            normals.push(0, 1, 0);
            colors.push(color[0], color[1], color[2]);
        }
    }
    const toV = (p) => ({ x: toThreeX(p.x), y: 0, z: toThreeZ(p.y) });
    // shoulderHalfWidth is always wider than roadHalfWidth, so the full-width
    // shoulder quad below spans underneath the narrower road/curb quads for
    // their entire width, not just past their outer edges. At the same y as
    // those overlay quads, that's exactly-coplanar geometry — the GPU has no
    // consistent way to decide which layer's pixel is "in front" at equal
    // depth, so it flickers between them frame to frame as the camera moves
    // (confirmed live: "the track is flickering" in 3D). Sinking the
    // shoulder band a hair below y=0 gives it real depth separation from the
    // road/curb layered on top, with no visible step at this scale.
    const toVShoulder = (p) => ({ x: toThreeX(p.x), y: -0.08, z: toThreeZ(p.y) });

    for (let i = 0; i < n; i += 1) {
        const centerNear = centerlinePath[i];
        const centerFar = centerlinePath[(i + 1) % n];
        const dirNear = getCenterlineDirection(i);
        const dirFar = getCenterlineDirection(i + 1);
        const normalNear = { x: -dirNear.y, y: dirNear.x };
        const normalFar = { x: -dirFar.y, y: dirFar.x };
        const near = {
            leftShoulder: toVShoulder({ x: centerNear.x - normalNear.x * shoulderHalfWidth, y: centerNear.y - normalNear.y * shoulderHalfWidth }),
            leftRoad: toV({ x: centerNear.x - normalNear.x * roadHalfWidth, y: centerNear.y - normalNear.y * roadHalfWidth }),
            rightRoad: toV({ x: centerNear.x + normalNear.x * roadHalfWidth, y: centerNear.y + normalNear.y * roadHalfWidth }),
            rightShoulder: toVShoulder({ x: centerNear.x + normalNear.x * shoulderHalfWidth, y: centerNear.y + normalNear.y * shoulderHalfWidth }),
        };
        const far = {
            leftShoulder: toVShoulder({ x: centerFar.x - normalFar.x * shoulderHalfWidth, y: centerFar.y - normalFar.y * shoulderHalfWidth }),
            leftRoad: toV({ x: centerFar.x - normalFar.x * roadHalfWidth, y: centerFar.y - normalFar.y * roadHalfWidth }),
            rightRoad: toV({ x: centerFar.x + normalFar.x * roadHalfWidth, y: centerFar.y + normalFar.y * roadHalfWidth }),
            rightShoulder: toVShoulder({ x: centerFar.x + normalFar.x * shoulderHalfWidth, y: centerFar.y + normalFar.y * shoulderHalfWidth }),
        };
        const stripe = i % 2 === 0;
        pushQuad(near.leftShoulder, near.rightShoulder, far.rightShoulder, far.leftShoulder, stripe ? shoulderA : shoulderB);
        pushQuad(near.leftRoad, near.rightRoad, far.rightRoad, far.leftRoad, stripe ? roadA : roadB);
        pushQuad(near.leftShoulder, near.leftRoad, far.leftRoad, far.leftShoulder, stripe ? curbA : curbB);
        pushQuad(near.rightRoad, near.rightShoulder, far.rightShoulder, far.rightRoad, stripe ? curbB : curbA);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.MeshToonMaterial({ vertexColors: true, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(geometry, material));

    if (finishLine) {
        const gateGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(toThreeX(finishLine.x1), 1, toThreeZ(finishLine.y1)),
            new THREE.Vector3(toThreeX(finishLine.x2), 1, toThreeZ(finishLine.y2)),
        ]);
        group.add(new THREE.Line(gateGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(palette.finish) })));
    }
    return group;
}

function buildDecorMesh3D(type, size = 1) {
    const s = size;
    switch (type) {
        case "tree": {
            const g = new THREE.Group();
            const trunk = new THREE.Mesh(new THREE.CylinderGeometry(3 * s, 4 * s, 22 * s, 6), new THREE.MeshToonMaterial({ color: 0x5b3a22 }));
            trunk.position.y = 11 * s;
            const leaves = new THREE.Mesh(new THREE.ConeGeometry(16 * s, 34 * s, 8), new THREE.MeshToonMaterial({ color: 0x2e7c45 }));
            leaves.position.y = 34 * s;
            g.add(trunk, leaves);
            return g;
        }
        case "rock": {
            const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(12 * s, 0), new THREE.MeshToonMaterial({ color: 0x707886 }));
            rock.position.y = 10 * s;
            return rock;
        }
        case "crystal": {
            const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(13 * s), new THREE.MeshToonMaterial({ color: 0xc792ff, emissive: 0x3a1a4a }));
            crystal.position.y = 16 * s;
            return crystal;
        }
        case "star": {
            const star = new THREE.Mesh(new THREE.OctahedronGeometry(9 * s), new THREE.MeshBasicMaterial({ color: 0xffd166 }));
            star.position.y = 26 * s;
            return star;
        }
        case "lava": {
            const lava = new THREE.Mesh(new THREE.CircleGeometry(20 * s, 12), new THREE.MeshBasicMaterial({ color: 0xff6b3d }));
            lava.rotation.x = -Math.PI / 2;
            lava.position.y = 0.5;
            return lava;
        }
        case "arch": {
            const arch = new THREE.Mesh(new THREE.TorusGeometry(24 * s, 5 * s, 8, 16, Math.PI), new THREE.MeshToonMaterial({ color: 0x8899bb }));
            arch.position.y = 24 * s;
            arch.rotation.z = Math.PI;
            return arch;
        }
        case "cloud": {
            const cloud = new THREE.Mesh(new THREE.SphereGeometry(16 * s, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
            cloud.position.y = 90 * s;
            return cloud;
        }
        default:
            return null;
    }
}

function buildFeatureGroup3D(map) {
    const group = new THREE.Group();

    trackRamps.forEach((ramp) => {
        const yaw = worldAngleToThreeYaw(Math.atan2(ramp.dirY, ramp.dirX));
        const halfW = roadHalfWidth * 0.75;
        const len = 60;
        const height = 16;
        const geo = new THREE.BufferGeometry();
        // simple sloped wedge: flat back edge at y=0, front edge lifted — local
        // -Z is forward (matches worldAngleToThreeYaw), so the lift is at -Z
        const verts = new Float32Array([
            -halfW, 0, len / 2, halfW, 0, len / 2, halfW, height, -len / 2,
            -halfW, 0, len / 2, halfW, height, -len / 2, -halfW, height, -len / 2,
        ]);
        geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, new THREE.MeshToonMaterial({
            color: ramp.glide ? 0x53e0ff : 0xffd166,
            emissive: ramp.glide ? 0x0e3a44 : 0x443008,
            side: THREE.DoubleSide,
        }));
        mesh.position.set(toThreeX(ramp.x), 0, toThreeZ(ramp.y));
        mesh.rotation.y = yaw;
        group.add(mesh);
    });

    const boostPadMeshes = [];
    trackBoostPads.forEach((pad) => {
        const yaw = worldAngleToThreeYaw(Math.atan2(pad.dirY, pad.dirX));
        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(roadHalfWidth * 1.1, 46),
            new THREE.MeshBasicMaterial({ color: 0x53e0ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.rotation.z = yaw;
        mesh.position.set(toThreeX(pad.x), 0.6, toThreeZ(pad.y));
        group.add(mesh);
        boostPadMeshes.push(mesh);
    });

    trackLoops.forEach((loop) => {
        const yaw = worldAngleToThreeYaw(Math.atan2(loop.dirY, loop.dirX));
        const mesh = new THREE.Mesh(
            new THREE.TorusGeometry(58, 6, 10, 24),
            new THREE.MeshToonMaterial({ color: 0xc792ff, emissive: 0x3a1a4a }),
        );
        mesh.position.set(toThreeX(loop.x), 60, toThreeZ(loop.y));
        mesh.rotation.y = yaw;
        group.add(mesh);
    });

    const n = centerlinePath.length;
    (trackWallZones || []).forEach((zone) => {
        if (!n) return;
        const fromIdx = zone.from * n;
        const toIdx = zone.to * n;
        const steps = Math.max(1, Math.round(Math.abs(toIdx - fromIdx)));
        for (let s = 0; s < steps; s += 1) {
            const t0 = lerp(fromIdx, toIdx, s / steps);
            const t1 = lerp(fromIdx, toIdx, (s + 1) / steps);
            const p0 = getCenterlinePoint(t0);
            const p1 = getCenterlinePoint(t1);
            const dir = getCenterlineDirection(t0);
            const normal = { x: -dir.y, y: dir.x };
            const offset = (roadHalfWidth + 6) * zone.side;
            const mx = (p0.x + p1.x) / 2 + normal.x * offset;
            const my = (p0.y + p1.y) / 2 + normal.y * offset;
            const segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y) + 4;
            const yaw = worldAngleToThreeYaw(Math.atan2(dir.y, dir.x));
            const mesh = new THREE.Mesh(
                new THREE.BoxGeometry(6, 46, segLen),
                new THREE.MeshToonMaterial({ color: 0x8fb4ff, transparent: true, opacity: 0.5 }),
            );
            mesh.position.set(toThreeX(mx), 23, toThreeZ(my));
            mesh.rotation.y = yaw;
            group.add(mesh);
        }
    });

    (trackDecorations || []).forEach((decor) => {
        const mesh = buildDecorMesh3D(decor.type, decor.size);
        if (!mesh) return;
        mesh.position.set(toThreeX(decor.x), 0, toThreeZ(decor.y));
        group.add(mesh);
    });

    const coinMeshes = [];
    trackCoins.forEach((coin) => {
        const mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(9, 9, 2.5, 14),
            new THREE.MeshToonMaterial({ color: 0xffd166, emissive: 0x554008 }),
        );
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(toThreeX(coin.x), 16, toThreeZ(coin.y));
        mesh.userData.coinRef = coin;
        group.add(mesh);
        coinMeshes.push(mesh);
    });

    const itemBoxMeshes = [];
    itemBoxes.forEach((box) => {
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(18, 18, 18),
            new THREE.MeshToonMaterial({ color: 0xffffff, emissive: 0x333333 }),
        );
        mesh.position.set(toThreeX(box.x), 14, toThreeZ(box.y));
        mesh.userData.boxRef = box;
        group.add(mesh);
        itemBoxMeshes.push(mesh);
    });

    const checkpointMarker = new THREE.Mesh(
        new THREE.OctahedronGeometry(10),
        new THREE.MeshBasicMaterial({ color: 0x53e0ff, transparent: true, opacity: 0.85 }),
    );
    group.add(checkpointMarker);

    return { group, boostPadMeshes, coinMeshes, itemBoxMeshes, checkpointMarker };
}

function applyTheme3D(palette) {
    const night = dayNightMode === "night";
    // Aerial perspective is what gives big kart racers its sense of scale, so
    // the falloff starts earlier and finishes later — a long soft gradient
    // rather than a wall of haze at one distance. Still keyed to skyMid rather
    // than the horizon colour: several biomes (Rainbow Skyway, Neon Loop) put
    // their *darkest* tone at skyBottom, and fogging toward that would sink
    // distant track into black — the exact opposite of what this is for.
    scene3D.fog = new THREE.Fog(new THREE.Color(palette.skyMid), 700, 2600);
    renderer3D.setClearColor(new THREE.Color(palette.skyMid), 1);
    scene3D.children.filter((child) => child.isLight).forEach((light) => scene3D.remove(light));
    const sun = new THREE.DirectionalLight(new THREE.Color(palette.sunColor), night ? 0.55 : 1.15);
    sun.position.set(-300, 400, -200);
    scene3D.add(sun);
    // Sky-to-ground bounce and flat fill both come up in daylight — the look
    // is high-key, so nothing should fall to near-black just for facing away
    // from the sun.
    scene3D.add(new THREE.HemisphereLight(new THREE.Color(palette.skyTop), new THREE.Color(palette.grassBottom), night ? 0.45 : 1.0));
    scene3D.add(new THREE.AmbientLight(0xffffff, night ? 0.25 : 0.52));
}

// Bakes the same sky-gradient + mountain-silhouette art drawSky() always
// used, onto an offscreen 2D canvas — not a fresh reimplementation. The
// mountain profiles (MOUNTAIN_PROFILES) are already exactly WIDTH=960px
// wide and drawSky's old pan trick tiled 3 copies of it to always have
// coverage, which only works because a single tile IS already a seamless
// 360-degree loop — so painting one tile straight across (no per-frame pan)
// gives a texture that wraps a real cylinder with no visible seam, and
// real camera yaw (rather than manually recomputed panOffset math) reveals
// it for free. Baked once per map/theme change, not per frame.
function buildSkyTexture3D(palette) {
    const w = WIDTH;
    const h = 480;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const c2d = canvas.getContext("2d");

    const skyGradient = c2d.createLinearGradient(0, 0, 0, h);
    skyGradient.addColorStop(0, palette.skyTop);
    skyGradient.addColorStop(0.42, palette.skyMid);
    skyGradient.addColorStop(1, palette.skyBottom);
    c2d.fillStyle = skyGradient;
    c2d.fillRect(0, 0, w, h);

    c2d.fillStyle = palette.sunColor;
    c2d.beginPath();
    c2d.arc(w * 0.74, h * 0.42, 34, 0, Math.PI * 2);
    c2d.fill();

    const mountainBase = h * 0.72;

    // The same CLOUD_BANK drawSky() paints, baked in above the mountain line.
    // Static here, unlike the 2D path's slow drift: this is a texture on a
    // cylinder the camera turns inside, so yaw already pans it, and a drifting
    // version would mean re-uploading the texture every frame. Tiled one copy
    // either side so a cloud sitting on the texture's wrap seam is whole.
    const skyCloudColors = getCloudColors(palette);
    CLOUD_BANK.forEach((cloud) => {
        const y = mountainBase - cloud.y;
        const radius = 42 * cloud.scale;
        [-1, 0, 1].forEach((tile) => {
            const cx = cloud.x * w + tile * w;
            const gradient = c2d.createLinearGradient(0, y - radius * 1.1, 0, y + radius * 0.9);
            gradient.addColorStop(0, skyCloudColors.top);
            gradient.addColorStop(1, skyCloudColors.shade);
            c2d.fillStyle = gradient;
            c2d.beginPath();
            cloud.puffs.forEach(([px, py, pr]) => {
                c2d.moveTo(cx + px * radius + pr * radius, y + py * radius);
                c2d.arc(cx + px * radius, y + py * radius, pr * radius, 0, Math.PI * 2);
            });
            c2d.fill();
        });
    });

    const profile = MOUNTAIN_PROFILES[palette.mountainStyle] ?? MOUNTAIN_PROFILES.hills;
    c2d.fillStyle = palette.mountainColor;
    c2d.beginPath();
    c2d.moveTo(profile[0][0], mountainBase + profile[0][1]);
    for (let i = 1; i < profile.length; i += 1) {
        c2d.lineTo(profile[i][0], mountainBase + profile[i][1]);
    }
    c2d.lineTo(w, h);
    c2d.lineTo(0, h);
    c2d.closePath();
    c2d.fill();

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

function buildSkyboxMesh3D(palette, radius) {
    const texture = buildSkyTexture3D(palette);
    const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, radius * 1.1, 48, 1, true),
        new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, fog: false }),
    );
    return mesh;
}

function build3DScene() {
    if (!three3DAvailable) return;
    while (mapGroup3D.children.length) {
        disposeObject3D(mapGroup3D.children.pop());
    }
    const palette = getThemePalette();
    // Ground plane, added first: without it, anywhere the camera looks that
    // isn't the road ribbon itself shows nothing but the flat sky clear
    // color (no infinite ground, no horizon falloff) — a large flat grass
    // quad well below the road surface (avoids z-fighting) fixes that.
    // Sized/centered off worldBounds with a big margin so it covers the
    // camera's view from anywhere on the track, any map size.
    const groundSize = Math.max(worldBounds.maxX - worldBounds.minX, worldBounds.maxY - worldBounds.minY) * 2.2 + 800;
    const groundCenterX = (worldBounds.minX + worldBounds.maxX) / 2;
    const groundCenterZ = (worldBounds.minY + worldBounds.maxY) / 2;
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(groundSize, groundSize),
        new THREE.MeshToonMaterial({ color: new THREE.Color(palette.grassTop) }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(groundCenterX, -0.6, groundCenterZ);
    mapGroup3D.add(ground);

    // Skybox: sized to sit safely beyond the ground plane's edge, so the
    // ground meets it at the horizon instead of either clipping through or
    // leaving a gap. See buildSkyboxMesh3D/buildSkyTexture3D for how the
    // texture itself is derived from the original drawSky() art.
    const skyRadius = groundSize * 0.62;
    const skybox = buildSkyboxMesh3D(palette, skyRadius);
    // the baked mountain band sits at v≈0.72 down the texture (see
    // buildSkyTexture3D's mountainBase); this places that band close to
    // ground level rather than floating in open sky or sinking underground
    skybox.position.set(groundCenterX, skyRadius * 0.24 + 40, groundCenterZ);
    mapGroup3D.add(skybox);

    mapGroup3D.add(buildRoadMesh3D(palette));
    const features = buildFeatureGroup3D(maps[currentMapKey]);
    mapGroup3D.add(features.group);
    mapGroup3D.userData.features = features;
    applyTheme3D(palette);
    mapGroup3D.userData.themeKey = currentMapKey + "|" + dayNightMode;
    syncKartRigs3D();
}

// Called from render3DScene() every frame: cheap per-frame theme resync in
// case day/night is toggled mid-race without a map reload (toggleDayNightMode
// doesn't call applyMap()).
function ensureTheme3DCurrent() {
    const key = currentMapKey + "|" + dayNightMode;
    if (mapGroup3D.userData.themeKey !== key) {
        applyTheme3D(getThemePalette());
        mapGroup3D.userData.themeKey = key;
    }
}

function render3DScene(player, camera) {
    if (!three3DAvailable || !scene3D) return false;
    ensureTheme3DCurrent();
    syncKartRigs3D();

    sceneCamera3D.fov = fovYFromProjection(camera.projection);
    sceneCamera3D.updateProjectionMatrix();
    // camera.x/y (the smoothed 2D follow position) sat only ~42-96 world
    // units behind the kart — fine for the old fake projection, where a
    // separately-tunable `projection` constant could fake any zoom level
    // regardless of true distance, but far too close for a REAL perspective
    // camera: at that range the near shoulder/curb geometry (roadHalfWidth
    // 92, shoulderHalfWidth 132 — wider than the follow distance itself)
    // fills almost the entire frame instead of receding naturally. Push the
    // real camera further back along the same already-smoothed `forward`
    // direction (so all the lateral/turn-tracking smoothing is untouched)
    // and use a physically sane height instead of camera.height's literal
    // value (see below) — both real-3D-specific consumption of the same
    // output, not a change to createCamera()'s own math.
    const extraBack = 95;
    const camX = toThreeX(camera.x) - camera.forward.x * extraBack;
    const camZ = toThreeZ(camera.y) - camera.forward.y * extraBack;
    // Neither this nor the lookAt() target below used to account for the
    // player's airHeight at all — harmless for a ~0.7s jump or even a 2.8s
    // glide (peaks at 95), easy to not notice the camera not tilting for
    // something that brief, but the Fly cheat hovers at a sustained 150 and
    // made the actual bug obvious: confirmed live, flying lifted the kart
    // exactly as intended, but the fixed-height, fixed-look-target camera
    // just kept staring at empty road while the kart climbed up and out of
    // frame. First attempt matched only the lookAt target 1:1 and this by a
    // fraction, on the theory that a full 1:1 camera follow would put the
    // camera in the kart's face — instead confirmed live it made the pitch
    // angle grow with altitude, so at hover height the view was almost all
    // sky. Matching both by the same 1:1 amount keeps the vertical gap
    // between camera and target constant, which keeps the original chase
    // angle constant too — the whole rig translates upward together
    // instead of the camera lagging behind and having to tilt further and
    // further to compensate.
    const playerAirHeight = player.airHeight || 0;
    const cameraHeight = camera.height * 0.34 + 14 + playerAirHeight;
    const presenting = Boolean(renderer3D.xr.isPresenting);
    if (presenting) {
        // While a headset owns the camera pose, position/orient the RIG
        // instead of the camera itself (see the note on xrRig above
        // initThree3D) — sceneCamera3D.position.set()/.lookAt() below must
        // not run in this branch, or they'd fight the tracked head pose.
        xrRig.position.set(camX, cameraHeight, camZ);
        xrRig.rotation.set(0, worldAngleToThreeYaw(Math.atan2(camera.forward.y, camera.forward.x)), 0);
        updateXRHud(player);
        xrHudMesh.visible = true;
        updateXRWheel();
        if (xrWheelMesh) xrWheelMesh.visible = true;
    } else {
        // sceneCamera3D is a child of xrRig (required for the presenting
        // branch above), so its position/lookAt below are LOCAL to the rig,
        // not world space, the moment the rig is anything but identity —
        // which it would be after any prior VR session, since the branch
        // above writes to xrRig's transform and nothing else ever resets it.
        // Pin the rig back to identity every non-presenting frame so the
        // existing world-space math below keeps meaning exactly what it says.
        xrRig.position.set(0, 0, 0);
        xrRig.rotation.set(0, 0, 0);
        sceneCamera3D.position.set(camX, cameraHeight, camZ);
        // Aimed with lookAt() from the camera's own already-validated forward
        // vector, not a hand-derived angle->rotation formula — see the note on
        // worldAngleToThreeYaw for why that matters here specifically. The target
        // is anchored on the PLAYER'S OWN KART position (with a modest look-ahead
        // bias along `forward`) rather than a fixed-pitch guess: the old renderer
        // faked "looking down at the road" purely in screen space (an independent
        // `horizon` constant), which has no direct physical meaning once the
        // camera is a real object positioned well above a short kart — a fixed
        // pitch guess left the kart entirely below the bottom of the frustum.
        // Aiming at the kart itself is what any real chase cam does, and it's
        // exact, not tuned.
        const lookAheadBias = 70;
        sceneCamera3D.lookAt(
            toThreeX(player.x) + camera.forward.x * lookAheadBias,
            16 + playerAirHeight,
            toThreeZ(player.y) + camera.forward.y * lookAheadBias,
        );
        if (xrHudMesh) xrHudMesh.visible = false;
        if (xrWheelMesh) xrWheelMesh.visible = false;
    }

    racers.forEach((racer) => {
        const rig = kartRig3D.get(racer);
        if (!rig) return;
        updateKartRig3D(racer, rig);
        // hood mode is the one mode meant to look FROM the kart, not AT it —
        // matches cameraModes[].showCockpit, which hid the old cockpit draw
        // the same way
        if (racer === player) rig.group.visible = camera.showCockpit;
    });

    const features = mapGroup3D.userData.features;
    if (features) {
        const t = raceElapsed;
        features.coinMeshes.forEach((mesh) => {
            mesh.visible = mesh.userData.coinRef.active;
            mesh.rotation.z = t * 3;
        });
        features.itemBoxMeshes.forEach((mesh) => {
            mesh.visible = mesh.userData.boxRef.active;
            mesh.rotation.y = t * 1.4;
            mesh.position.y = 14 + Math.sin(t * 2 + mesh.position.x * 0.05) * 3;
        });
        features.boostPadMeshes.forEach((mesh) => {
            mesh.material.opacity = 0.55 + Math.sin(t * 8) * 0.2;
        });
        const cp = checkpoints[player.checkpointIndex];
        if (cp && features.checkpointMarker) {
            features.checkpointMarker.visible = true;
            features.checkpointMarker.position.set(toThreeX(cp.x), 40 + Math.sin(t * 3) * 6, toThreeZ(cp.y));
            features.checkpointMarker.rotation.y = t * 2;
        }
    }

    if (!presenting) {
        // Meaningless while presenting — the headset's own per-eye
        // framebuffer size has nothing to do with the flat 960x640 canvas,
        // and Three.js manages that swap internally once presenting.
        renderer3D.setViewport(0, 0, WIDTH, HEIGHT);
        renderer3D.setScissor(0, 0, WIDTH, HEIGHT);
    }
    renderer3D.render(scene3D, sceneCamera3D);
    if (presenting) return true; // Three's WebXR manager already intercepted
    // that render() call and presented to the headset — no 2D-canvas
    // equivalent of the blit below applies to an XR frame.
    ctx.drawImage(offscreen3D, 0, 0);
    return true;
}

function drawViewport(player) {
    if (renderMode === "2d") {
        drawTrack2D(player);
    } else {
        const camera = createCamera(player);

        // mid-loop: roll the whole scene a full 360° around screen center,
        // eased in/out so it doesn't snap at the start/end of the loop. The
        // HUD and mini-map are drawn after restore(), so they stay upright.
        const looping = player.loopTimer > 0;
        if (looping) {
            const loopArc = clamp(1 - player.loopTimer / player.loopTotal, 0, 1);
            const eased = 0.5 - 0.5 * Math.cos(Math.PI * loopArc);
            ctx.save();
            ctx.translate(CENTER.x, CENTER.y);
            ctx.rotate(eased * Math.PI * 2);
            ctx.translate(-CENTER.x, -CENTER.y);
        }

        // Real Three.js/WebGL scene. Falls back to the original manual-projection
        // pipeline (still present below, unmodified) if WebGL is unavailable or
        // its context was lost — a real, working fallback rather than a blank
        // screen, not a "temporary until we finish the rewrite" leftover.
        const rendered3D = render3DScene(player, camera);
        if (!rendered3D) {
            drawSky(camera, player);
            drawRoad(player, camera);
            drawWalls3D(camera);
            drawRamps3D(camera);
            drawBoostPads3D(camera);
            drawLoops3D(camera);
            drawCheckpointMarker(player, camera);
            drawPlayerHeadlights(camera);
            drawWorldObjects(player, camera);
            drawLeaveEffects(camera);
            if (camera.showCockpit) {
                drawCockpit(player);
            }
        }

        if (looping) {
            ctx.restore();
        }

        if (miniMapEnabled && !paused) {
            drawMiniMap3D(player, camera);
        }
    }
    drawRaceStartCountdown();
    drawOffRoadWarning(player);
    drawFallOverlay(player);
    drawPausedOverlay();
    // The pause screen is a full-screen menu — the HUD and mini-map are drawn
    // after everything else, so left on they'd sit on top of the controls list
    // rather than behind it.
    if (!paused) drawHUD(player);
}

function getSplitScreenLayout(count) {
    const halfW = WIDTH / 2;
    const halfH = HEIGHT / 2;
    if (count === 2) {
        return [
            { x: 0, y: 0, w: WIDTH, h: halfH },
            { x: 0, y: halfH, w: WIDTH, h: halfH },
        ];
    }
    if (count === 3) {
        return [
            { x: 0, y: 0, w: halfW, h: halfH },
            { x: halfW, y: 0, w: halfW, h: halfH },
            { x: 0, y: halfH, w: WIDTH, h: halfH },
        ];
    }
    return [
        { x: 0, y: 0, w: halfW, h: halfH },
        { x: halfW, y: 0, w: halfW, h: halfH },
        { x: 0, y: halfH, w: halfW, h: halfH },
        { x: halfW, y: halfH, w: halfW, h: halfH },
    ];
}

function draw() {
    if (renderer3D?.xr?.isPresenting) {
        // Skip HDR bloom/split-screen/2D HUD entirely — none of it has an
        // XR equivalent (see render3DScene's presenting branch and the
        // in-scene HUD mesh, which carries lap/place instead).
        render3DScene(racers[0], createCamera(racers[0]));
        return;
    }
    const localPlayers = racers.filter((racer) => racer.isPlayer);
    if (localPlayers.length <= 1) {
        drawViewport(racers[0]);
        applyHDRPostProcess();
        return;
    }

    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    const layout = getSplitScreenLayout(localPlayers.length);
    localPlayers.forEach((viewRacer, index) => {
        const rect = layout[index];
        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.w, rect.h);
        ctx.clip();
        ctx.translate(rect.x, rect.y);
        ctx.scale(rect.w / WIDTH, rect.h / HEIGHT);
        drawViewport(viewRacer);
        ctx.restore();
    });

    applyHDRPostProcess();

    ctx.save();
    ctx.strokeStyle = "rgba(4, 6, 12, 0.9)";
    ctx.lineWidth = 4;
    layout.forEach((rect) => {
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    });
    ctx.restore();
}

function update(dt) {
    updateGamepadInput();
    updateXRInput();
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
    updateBoostParticles(dt);
    updateProjectiles(dt);
    updateTrackHazards(dt);
    updateTrackMovers(dt);
    updateTrackCoins(dt);
    updatePlacements();
    updateLeaveEffects(dt);
    mpBroadcastState();

    const player = racers[0];
    if (!raceOver) {
        if (raceNoticeTimer > 0) {
            raceNoticeTimer -= dt;
            statusText.textContent = raceNoticeText;
        } else {
            const leader = racers.reduce((best, racer) => (racer.place < best.place ? racer : best), racers[0]);
            statusText.textContent = `P${player.place} | Leader: ${leader.name}`;
        }
    }
}

const kartFrameGate = window.MimiGfx ? window.MimiGfx.makeLimiter() : () => true;

function loop(timestamp) {
    // Racing or not, a live headset still needs a live camera/HUD/wheel and
    // still needs its trigger polled for "start the race" — the flat DOM
    // Start Race button this otherwise waits on is invisible and
    // unreachable once a headset owns the display (confirmed live: with the
    // old unconditional `if (!running) return` here, NOTHING ever updated or
    // rendered pre-race in VR — not the camera, not the "pull trigger to
    // start" HUD text, not the wheel — because this whole function, HUD and
    // wheel code included, never ran at all until a race was already
    // running, which is exactly the state it needed to handle).
    const presenting = Boolean(renderer3D?.xr?.isPresenting);
    if (!running && !presenting) return;
    // Settings' frame-rate cap (js/graphics.js). Never applied in VR: a headset
    // owns its own frame timing and dropping frames there is nauseating, not
    // economical. lastTimestamp only advances on a drawn frame, so a skipped
    // one folds its time into the next delta.
    if (!presenting && !kartFrameGate(timestamp)) {
      if (!renderer3D) requestAnimationFrame(loop);
      return;
    }
    const delta = Math.min((timestamp - lastTimestamp) / 1000, 0.033);
    lastTimestamp = timestamp;
    update(delta);
    if (running) syncEngineAudio();
    draw();
    // Once renderer3D.setAnimationLoop(loop) is driving (see startRace),
    // Three's own internal driver re-invokes this every frame on its own —
    // in both plain-rAF and XR-session-rAF modes. Calling
    // requestAnimationFrame(loop) here too would spawn a second, independent
    // frame chain racing the renderer's own.
    if (!renderer3D) requestAnimationFrame(loop);
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

function isTypingInField() {
    const tag = document.activeElement?.tagName;
    return tag === "INPUT" || tag === "TEXTAREA";
}

window.addEventListener("keydown", (event) => {
    if (isTypingInField()) return;
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
    if (event.code === "KeyG") {
        toggleHDR();
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
    if (isTypingInField()) return;
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

// --- Wireless multiplayer (LAN relay via WebSocket) ---
let mpSocket = null;
let mpSelfId = null;
let mpIsHost = false;
let mpRoomCodeValue = null;
let mpConnected = false;
let mpStatusNotice = null;
const mpPeers = new Map(); // peerId -> { name, color, avatar }
// the signed-in profile's picture, if any — same localStorage the hub itself
// reads (see activeProfileSession below), sent along when hosting/joining so
// other racers can show it in their camera strip even if this player never
// turns on live video chat
function mpLocalAvatar() {
    return activeProfileSession()?.avatar || null;
}

// The actual local racer's own color, once one exists (racers[0] for a solo
// player), falling back to the picker selection or the plain seat-0 default
// before a race has ever been set up. Previously the host/join sends and the
// camera-strip self-tile all hardcoded racerPalette[0] instead of this —
// harmless-looking for the common case (a fresh solo racer IS seat 0), but
// meant a chosen kart color never actually reached other players.
function mpLocalRacerColor() {
    return racers[0]?.color || selectedKartColor || racerPalette[0];
}
const mpPeerRacerIndex = new Map(); // peerId -> racers[] index
const mpLatestState = new Map(); // peerId -> last received state message
let mpLastBroadcast = 0;

function mpPlayerName() {
    return (mpNameInput.value || "").trim().slice(0, 14) || "Player";
}

function mpRenderPlayerList() {
    const names = ["You", ...Array.from(mpPeers.values()).map((p) => p.name)];
    mpPlayerListEl.textContent = `Racers connected: ${names.join(", ")}`;
}

function mpUpdateUI() {
    if (!mpConnected) {
        mpRoomInfo.classList.add("hidden");
        mpChat.classList.add("hidden");
        mpControls.classList.remove("hidden");
        mpStatus.textContent = mpStatusNotice || "Race solo, or connect with friends on your network.";
        mpStatusNotice = null;
        mpMatchScope = null;
        mpMatchStatus = null;
        mpSyncCameraStrip();
        mpSyncOnlineLobby();
        return;
    }
    mpRoomInfo.classList.remove("hidden");
    mpChat.classList.remove("hidden");
    mpControls.classList.add("hidden");
    mpRoomCodeEl.textContent = mpRoomCodeValue;
    mpStatus.textContent = mpIsHost
        ? "Hosting — share the room code. Start Race when everyone's in."
        : "Connected — wait for the host to start the race.";
    mpRenderPlayerList();
    mpSyncCameraStrip();
    mpSyncOnlineLobby();
}

// the hub's profile system (js/profiles.js) and this page share the same
// origin's localStorage, so we can read who's signed in without loading any
// extra script — used to badge dev profiles in chat and to prefill the
// multiplayer name field with whoever's signed in
function activeProfileSession() {
    try {
        return JSON.parse(localStorage.getItem("mimiActiveSession") || "null");
    } catch (e) {
        return null;
    }
}

function isDevProfileActive() {
    return Boolean(activeProfileSession()?.dev);
}

// Only a real, server-verified dev profile (see DEV_SIGNUP_PASSWORD_HASH in
// server.js) ever sees this panel — signing in/out elsewhere in the hub
// updates localStorage, not this page, so it's re-checked on an interval
// rather than once at load.
function syncDevCheatPanel() {
    if (!devCheatPanel) return;
    const active = isDevProfileActive();
    devCheatPanel.classList.toggle("hidden", !active);
    if (!active && (devFlyEnabled || devGodModeEnabled || devInfiniteItemsEnabled || devSpeedOverride !== null)) {
        devFlyEnabled = false;
        devGodModeEnabled = false;
        devInfiniteItemsEnabled = false;
        devSpeedOverride = null;
    }
    if (devFlyButton) devFlyButton.textContent = `Fly: ${devFlyEnabled ? "On" : "Off"}`;
    if (devGodModeButton) devGodModeButton.textContent = `God Mode: ${devGodModeEnabled ? "On" : "Off"}`;
    if (devInfiniteItemsButton) devInfiniteItemsButton.textContent = `Infinite Items: ${devInfiniteItemsEnabled ? "On" : "Off"}`;
}
setInterval(syncDevCheatPanel, 1500);
syncDevCheatPanel();
refreshDevItemChoiceOptions();

// Rebuilds the Speed target list from whatever's actually in `racers` right
// now — called after resetRace() reassigns that array, so the names/order
// always match this race's real roster (bot names and count vary by
// map/cup, and change again after every restart). Selecting by index into
// the live `racers` array rather than holding a racer object reference
// directly, since resetRace() replaces every racer object wholesale, which
// would otherwise leave a stale reference pointing at a discarded racer.
function refreshDevSpeedTargetOptions() {
    if (!devSpeedTarget) return;
    const previous = devSpeedTarget.value || "all";
    devSpeedTarget.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "All Racers";
    devSpeedTarget.appendChild(allOpt);
    racers.forEach((racer, index) => {
        // A networked peer's speed comes from their own client over the
        // network (mpApplyLatestState), not local physics — offering them
        // here would look like a real option that silently does nothing.
        if (racer.isNetworked) return;
        const opt = document.createElement("option");
        opt.value = String(index);
        opt.textContent = racer.isPlayer ? `${racer.name} (you)` : racer.name;
        devSpeedTarget.appendChild(opt);
    });
    const stillValid = Array.from(devSpeedTarget.options).some((o) => o.value === previous);
    devSpeedTarget.value = stillValid ? previous : "all";
    devSpeedTargetValue = devSpeedTarget.value;
}

function refreshDevItemChoiceOptions() {
    if (!devItemChoice) return;
    if (devItemChoice.options.length) return; // static list, only needs building once
    const sameOpt = document.createElement("option");
    sameOpt.value = "same";
    sameOpt.textContent = "Same as Used";
    devItemChoice.appendChild(sameOpt);
    Object.keys(ITEM_LABELS).forEach((key) => {
        const opt = document.createElement("option");
        opt.value = key;
        opt.textContent = ITEM_LABELS[key];
        devItemChoice.appendChild(opt);
    });
    devItemChoice.value = devInfiniteItemsChoice;
}

devFlyButton?.addEventListener("click", () => {
    if (!isDevProfileActive()) return;
    devFlyEnabled = !devFlyEnabled;
    syncDevCheatPanel();
});
devGodModeButton?.addEventListener("click", () => {
    if (!isDevProfileActive()) return;
    devGodModeEnabled = !devGodModeEnabled;
    syncDevCheatPanel();
});
devInfiniteItemsButton?.addEventListener("click", () => {
    if (!isDevProfileActive()) return;
    devInfiniteItemsEnabled = !devInfiniteItemsEnabled;
    syncDevCheatPanel();
    // Otherwise turning this on while empty-handed does nothing until the
    // next real item-box pickup — grant the chosen item (or a Turbo, if
    // "Same as Used" has nothing to repeat yet) right away instead.
    const player = racers[0];
    if (devInfiniteItemsEnabled && player && !player.item) {
        player.item = devInfiniteItemsChoice === "same" ? "boost" : devInfiniteItemsChoice;
    }
});
devItemChoice?.addEventListener("change", () => {
    devInfiniteItemsChoice = devItemChoice.value || "same";
});
devSpeedTarget?.addEventListener("change", () => {
    devSpeedTargetValue = devSpeedTarget.value || "all";
});
devSpeedSetButton?.addEventListener("click", () => {
    if (!isDevProfileActive()) return;
    const value = Number(devSpeedInput?.value);
    if (Number.isFinite(value)) devSpeedOverride = value;
});
devSpeedClearButton?.addEventListener("click", () => {
    devSpeedOverride = null;
    if (devSpeedInput) devSpeedInput.value = "";
});

// This iframe has no access to the parent hub's window.MimiProfiles (a
// different document entirely) — same-origin, so it makes its own direct
// fetch call instead, exactly like js/profiles.js's own apiCall wrapper,
// just inlined here since this is the only network call this file needs
// outside its own /mp WebSocket.
async function unlockPartyStartedAchievement() {
    const s = activeProfileSession();
    if (!s?.key || !s?.passwordHash) return;
    try {
        await fetch(`${accountServerBase()}/api/profiles/unlock-achievement`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: s.key, passwordHash: s.passwordHash, achievementId: "party-started" }),
        });
    } catch (e) { /* offline/LAN hiccup — not worth surfacing for a background achievement unlock */ }
}

// ---------- local player roster ----------
// Signing players in/up lives entirely in the hub's own 👤 Profile panel
// (js/profiles.js → "Local players") — this file just reads the roster it
// saves to localStorage["mimiLocalRoster"], same-origin, no API calls of
// its own. Split-screen seats P1-P4 use roster slots 0-3 in order (see
// buildRacerBlueprints above); the "Playing as" selector below is the one
// piece that's genuinely specific to this game (which signed-in player, if
// any, is the one racing solo) rather than something Profile could know.
function readSharedRoster() {
    try {
        const list = JSON.parse(localStorage.getItem("mimiLocalRoster") || "[null,null,null,null]");
        const arr = Array.isArray(list) ? list.slice(0, 4) : [null, null, null, null];
        while (arr.length < 4) arr.push(null);
        return arr;
    } catch (e) {
        return [null, null, null, null];
    }
}

function rebuildAfterRosterChange() {
    localRoster = readSharedRoster();
    // a sign-out on the hub side that removes the currently-selected solo
    // driver needs soloDriverSlot reset — syncSoloSelect does that as a
    // side effect of rebuilding the <select>, so run it before blueprints
    syncSoloSelect();
    racerBlueprints = buildRacerBlueprints();
    applyMap(currentMapKey);
    resetRace();
    draw();
}

function syncSoloSelect() {
    if (!localSoloSelect || !localRosterSoloRow) return;
    localRosterSoloRow.classList.toggle("hidden", localPlayerCount > 1);
    const prev = localSoloSelect.value;
    localSoloSelect.innerHTML = "";
    const guestOpt = document.createElement("option");
    guestOpt.value = "-1";
    guestOpt.textContent = `Guest (${getSelectedCharacter().name})`;
    localSoloSelect.appendChild(guestOpt);
    localRoster.forEach((entry, i) => {
        if (!entry) return;
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = entry.name + (entry.dev ? " 🛠️" : "");
        localSoloSelect.appendChild(opt);
    });
    const stillValid = Array.from(localSoloSelect.options).some((o) => o.value === prev);
    localSoloSelect.value = stillValid ? prev : "-1";
    soloDriverSlot = Number(localSoloSelect.value);
}
localSoloSelect?.addEventListener("change", () => {
    soloDriverSlot = Number(localSoloSelect.value);
    rebuildAfterRosterChange();
});

// localStorage writes from the PARENT document (the hub's Profile panel)
// fire real native "storage" events in this iframe's own window — no
// polling needed to pick up a sign-in/out made while this game's already open
window.addEventListener("storage", (e) => {
    if (e.key === "mimiLocalRoster") rebuildAfterRosterChange();
});

localRoster = readSharedRoster();
syncSoloSelect();

function mpAddChatLine(name, text, isSystem, isDev) {
    const line = document.createElement("div");
    line.className = "mp-chat-line" + (isSystem ? " mp-chat-system" : "");
    if (isSystem) {
        line.textContent = text;
    } else {
        const nameEl = document.createElement("span");
        nameEl.className = "mp-chat-name";
        nameEl.style.color = "var(--accent-2)";
        nameEl.textContent = (isDev ? "🛠️ " : "") + name + ":";
        line.appendChild(nameEl);
        line.appendChild(document.createTextNode(" " + text));
    }
    mpChatLog.appendChild(line);
    while (mpChatLog.children.length > 40) {
        mpChatLog.removeChild(mpChatLog.firstChild);
    }
    mpChatLog.scrollTop = mpChatLog.scrollHeight;
}

function mpSendChat(text) {
    const trimmed = text.trim();
    if (!trimmed || !mpConnected) return;
    const name = mpPlayerName();
    const dev = isDevProfileActive();
    mpAddChatLine(name, trimmed, false, dev);
    mpSocket.send(JSON.stringify({ type: "chat", text: trimmed, name, dev }));
}

function mpBusy() {
    return mpConnected
        || (mpSocket && (mpSocket.readyState === WebSocket.OPEN || mpSocket.readyState === WebSocket.CONNECTING));
}

// Same override the hub's Settings panel writes (js/settings-panel.js,
// js/engine.js's getServerWsBase) — read directly rather than via
// window.parent.MimiGames since this page also runs standalone (the vrsim
// harness, direct navigation), not only inside the hub's iframe.
// (arcade) the account server is a different site from the page this game is shown
// in, so profile calls go to the base the arcade stored (same value the /mp relay uses)
function accountServerBase() {
    try {
        return (localStorage.getItem("mimiServerOverride") || "").trim().replace(/\/+$/, "");
    } catch (e) {
        return "";
    }
}

function serverWsBaseOverride() {
    try {
        const base = (localStorage.getItem("mimiServerOverride") || "").trim().replace(/\/+$/, "");
        return base ? base.replace(/^http/, "ws") : "";
    } catch (e) {
        return "";
    }
}

function mpConnect(onOpen) {
    const wsBase = serverWsBaseOverride();
    const wsUrl = wsBase ? `${wsBase}/mp` : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/mp`;
    mpSocket = new WebSocket(wsUrl);
    mpSocket.addEventListener("open", () => onOpen(), { once: true });
    mpSocket.addEventListener("message", (event) => {
        try {
            mpHandleMessage(JSON.parse(event.data));
        } catch (e) {
            /* ignore malformed message */
        }
    });
    mpSocket.addEventListener("close", () => {
        mpConnected = false;
        mpSocket = null;
        mpPeers.clear();
        mpPeerRacerIndex.clear();
        mpLatestState.clear();
        mpStopAllMedia();
        stopMediaTest();
        racers.forEach((racer) => {
            racer.isNetworked = false;
            racer.networkPeerId = null;
        });
        mpUpdateUI();
    });
    mpSocket.addEventListener("error", () => {
        mpStatus.textContent = "Connection error. Is the server reachable?";
    });
}

function mpHost() {
    if (mpBusy()) {
        mpStatus.textContent = "You're already in a room — leave it first.";
        return;
    }
    if (localPlayerCount > 1) {
        mpStatus.textContent = "Switch to 1 Player before hosting wireless multiplayer.";
        return;
    }
    mpConnect(() => {
        mpSocket.send(JSON.stringify({ type: "host", name: mpPlayerName(), color: mpLocalRacerColor(), avatar: mpLocalAvatar() }));
    });
}

function mpJoin(code) {
    if (mpBusy()) {
        mpStatus.textContent = "You're already in a room — leave it first.";
        return;
    }
    if (localPlayerCount > 1) {
        mpStatus.textContent = "Switch to 1 Player before joining wireless multiplayer.";
        return;
    }
    if (!code) {
        mpStatus.textContent = "Enter a room code to join.";
        return;
    }
    mpConnect(() => {
        mpSocket.send(JSON.stringify({ type: "join", room: code, name: mpPlayerName(), color: mpLocalRacerColor(), avatar: mpLocalAvatar() }));
    });
}

/* --- Play Online: public matchmaking -------------------------------------
 *
 * The server does all the room-picking (see `matchmake` in server.js) and
 * replies with the ordinary `joined` message, so everything downstream of
 * being in a room — peer racers, chat, voice, the raceStart relay — is the
 * same code that has always run for a room shared by code. What's added here
 * is only the lobby: which pool you're searching, how many racers are in it,
 * and the shared countdown the server broadcasts.
 */
let mpMatchScope = null;      // "regional" | "global" while searching/lobbied
let mpMatchStatus = null;     // latest matchStatus payload from the server

// Regional matchmaking needs a region, and the one locality every browser will
// tell us without a permission prompt is its time zone. The continent half of
// an IANA zone ("Australia/Sydney" -> "Australia") is coarse, but it's honest,
// free, and enough to keep a regional race regional.
function localMatchRegion() {
    try {
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
        const region = zone.split("/")[0];
        return region || "Global";
    } catch (e) {
        return "Global";
    }
}

function mpMatchmake(scope) {
    if (mpBusy()) {
        mpStatus.textContent = "You're already in a room — leave it first.";
        return;
    }
    if (localPlayerCount > 1) {
        mpStatus.textContent = "Switch to 1 Player before racing online.";
        return;
    }
    mpMatchScope = scope;
    mpMatchStatus = null;
    mpSyncOnlineLobby("Searching for racers\u2026");
    mpConnect(() => {
        mpSocket.send(JSON.stringify({
            type: "matchmake",
            scope,
            region: localMatchRegion(),
            name: mpPlayerName(),
            color: mpLocalRacerColor(),
            avatar: mpLocalAvatar(),
        }));
    });
}

function mpSyncOnlineLobby(overrideText) {
    const statusEl = document.getElementById("onlineStatus");
    const listEl = document.getElementById("onlineRacerList");
    if (!statusEl) return;
    if (overrideText) {
        statusEl.textContent = overrideText;
        if (listEl) listEl.textContent = "";
        return;
    }
    if (!mpConnected || !mpMatchScope) {
        statusEl.textContent = "Pick a pool to start searching.";
        if (listEl) listEl.textContent = "";
        return;
    }
    const info = mpMatchStatus;
    const where = mpMatchScope === "regional" ? `Regional \u00b7 ${info?.region || localMatchRegion()}` : "Global";
    const count = info?.players ?? 1;
    const max = info?.max ?? 12;
    if (info && info.startsIn) {
        statusEl.textContent = `${where} \u2014 ${count}/${max} racers \u00b7 starting in ${info.startsIn}s`;
    } else if (count < (info?.min ?? 2)) {
        statusEl.textContent = `${where} \u2014 waiting for another racer\u2026 (${count}/${max})`;
    } else {
        statusEl.textContent = `${where} \u2014 ${count}/${max} racers`;
    }
    if (listEl) {
        const names = [mpPlayerName(), ...Array.from(mpPeers.values()).map((p) => p.name)];
        listEl.textContent = names.join(" \u00b7 ");
    }
}

// When the server's shared countdown reaches zero it only *signals* — the host
// client still chooses the track and sends the real raceStart, exactly as it
// does for a room shared by code. Online races randomise the track so a pool of
// strangers doesn't race whatever the first person in happened to have picked.
function mpHandleMatchGo() {
    if (!mpIsHost) {
        mpSyncOnlineLobby("Race starting\u2026");
        return;
    }
    resetCupSelection();
    const keys = Object.keys(maps);
    setMap(keys[Math.floor(Math.random() * keys.length)]);
    mpSyncOnlineLobby("Race starting\u2026");
    startRace();
}

function mpLeave() {
    if (!mpSocket) return;
    mpStatusNotice = "You left the room.";
    mpSocket.close();
}

function mpHandleMessage(msg) {
    if (msg.type === "joined") {
        mpSelfId = msg.id;
        mpIsHost = msg.isHost;
        mpRoomCodeValue = msg.room;
        mpConnected = true;
        mpPeers.clear();
        mpChatLog.innerHTML = "";
        msg.players.forEach((p) => {
            if (p.id !== mpSelfId) mpPeers.set(p.id, { name: p.name, color: p.color, avatar: p.avatar || null });
        });
        mpUpdateUI();
        unlockPartyStartedAchievement();
        mpAddChatLine(null, mpIsHost ? `Room ${mpRoomCodeValue} created. You're the host.` : `Joined room ${mpRoomCodeValue}.`, true);
        stopMediaTest();
        // connect to everyone right away (recv-only if our mic/cam are off) so
        // their voice/video reaches us without us having to opt in first
        mpPeers.forEach((peer, peerId) => mpStartPeerConnection(peerId, true));
    } else if (msg.type === "joinError") {
        mpStatusNotice = msg.reason || "Could not join room.";
        if (mpSocket) mpSocket.close();
    } else if (msg.type === "playerJoined") {
        mpPeers.set(msg.id, { name: msg.name, color: msg.color, avatar: msg.avatar || null });
        mpUpdateUI();
        mpAddChatLine(null, `${msg.name} joined the race.`, true);
    } else if (msg.type === "playerLeft") {
        const leftName = mpPeers.get(msg.id)?.name || "A racer";
        // Detach whichever camera-strip tile currently represents them (live
        // video or their photo) right away and let it animate out on its own
        // — mpSyncCameraStrip() below rebuilds the rest of the strip without
        // this peer, and won't touch a tile it can no longer find in these
        // maps, so the animation plays out undisturbed instead of the tile
        // just vanishing along with everything else that updates on a leave.
        mpAnimateTileRemoval(mpRemoteVideoEls.get(msg.id) || mpAvatarTiles.get(msg.id));
        mpRemoteVideoEls.delete(msg.id);
        mpAvatarTiles.delete(msg.id);
        mpPeers.delete(msg.id);
        mpLatestState.delete(msg.id);
        const racerIndex = mpPeerRacerIndex.get(msg.id);
        if (racerIndex !== undefined && racers[racerIndex]) {
            racers[racerIndex].isNetworked = false;
            triggerLeaveEffect(racers[racerIndex], leftName);
        }
        mpPeerRacerIndex.delete(msg.id);
        mpStopPeerConnection(msg.id);
        mpUpdateUI();
        mpAddChatLine(null, `${leftName} left the race.`, true);
    } else if (msg.type === "state") {
        mpLatestState.set(msg.id, msg);
    } else if (msg.type === "matchStatus") {
        mpMatchStatus = msg;
        mpSyncOnlineLobby();
    } else if (msg.type === "matchGo") {
        mpHandleMatchGo();
    } else if (msg.type === "hostPromoted") {
        // the racer who opened this matchmade room left; we own the track
        // choice and the raceStart now
        mpIsHost = true;
        mpUpdateUI();
        mpAddChatLine(null, "You're the host now.", true);
    } else if (msg.type === "raceStart") {
        mpApplyRaceStart(msg);
    } else if (msg.type === "chat") {
        mpAddChatLine(msg.name || "Racer", msg.text || "", false, Boolean(msg.dev));
    } else if (msg.type === "rtc-offer") {
        mpHandleRtcOffer(msg);
    } else if (msg.type === "rtc-answer") {
        mpHandleRtcAnswer(msg);
    } else if (msg.type === "rtc-ice") {
        mpHandleRtcIce(msg);
    }
}

function mpAssignPeersToRacers() {
    mpPeerRacerIndex.clear();
    if (!mpConnected || mpPeers.size === 0) return;
    // sort peer IDs so every client assigns the same peer to the same racer slot,
    // regardless of the order join/leave events happened to arrive in locally
    const sortedPeerIds = Array.from(mpPeers.keys()).sort();
    let slot = 1; // slot 0 is always the local player
    sortedPeerIds.forEach((peerId) => {
        if (slot >= racers.length) return;
        const peer = mpPeers.get(peerId);
        const racer = racers[slot];
        racer.name = peer.name;
        racer.color = peer.color;
        racer.isNetworked = true;
        racer.networkPeerId = peerId;
        mpPeerRacerIndex.set(peerId, slot);
        slot += 1;
    });
}

function mpApplyLatestState(racer) {
    const state = mpLatestState.get(racer.networkPeerId);
    if (!state) return;
    racer.prevX = racer.x;
    racer.prevY = racer.y;
    racer.x = lerp(racer.x, state.x, 0.45);
    racer.y = lerp(racer.y, state.y, 0.45);
    racer.angle = state.angle;
    racer.speed = state.speed;
    racer.lap = state.lap;
    racer.checkpointIndex = state.checkpointIndex;
    racer.boostTimer = state.boostTimer || 0;
    const wasFinished = racer.finished;
    racer.finished = !!state.finished;
    if (racer.finished && !wasFinished) {
        finishedCount += 1;
        if (!raceOver) {
            finishRace(`${racer.name} won the circuit`);
        }
    }
}

function mpBroadcastState() {
    if (!mpConnected || !mpSocket || mpSocket.readyState !== WebSocket.OPEN) return;
    const now = performance.now();
    if (now - mpLastBroadcast < 66) return;
    mpLastBroadcast = now;
    const player = racers[0];
    if (!player) return;
    mpSocket.send(JSON.stringify({
        type: "state",
        x: player.x,
        y: player.y,
        angle: player.angle,
        speed: player.speed,
        lap: player.lap,
        checkpointIndex: player.checkpointIndex,
        boostTimer: player.boostTimer,
        finished: player.finished,
    }));
}

function mpApplyRaceStart(msg) {
    if (mpIsHost) return; // the host already started their own race locally
    if (msg.mapKey) currentMapKey = msg.mapKey;
    if (msg.difficulty) currentDifficulty = msg.difficulty;
    currentCupKey = msg.cupKey || null;
    if (msg.currentCupRaceIndex !== undefined) currentCupRaceIndex = msg.currentCupRaceIndex;
    startRace(true);
}

// --- Voice chat (WebRTC mesh, signaled over the same room relay) ---
const RTC_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
let mpVoiceEnabled = false;
let mpVideoEnabled = false;
let mpAudioStream = null;
let mpVideoStream = null;
const mpPeerConnections = new Map(); // peerId -> RTCPeerConnection
const mpRemoteAudioEls = new Map(); // peerId -> HTMLAudioElement
const mpRemoteVideoEls = new Map(); // peerId -> tile wrapper element
let mpLocalVideoTile = null;
const mpAvatarTiles = new Map(); // "self" or peerId -> photo/placeholder tile wrapper element

const VIDEO_CONSTRAINTS = { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15 } };

function mpSyncMediaButtons() {
    mpVoiceButton.textContent = `🎤 Voice Chat: ${mpVoiceEnabled ? "On" : "Off"}`;
    mpVideoButton.textContent = `📷 Video Chat: ${mpVideoEnabled ? "On" : "Off"}`;
}

function mpSyncVideosVisibility() {
    mpVideosEl.classList.toggle("hidden", mpVideosEl.children.length === 0);
}

function mpMakeVideoTile(label, stream, isLocal) {
    const wrap = document.createElement("div");
    wrap.className = "mp-video-tile" + (isLocal ? " local" : "");
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true; // tiles are visual; audio plays through the voice-chat elements
    video.srcObject = stream;
    const tag = document.createElement("span");
    tag.textContent = label;
    wrap.appendChild(video);
    wrap.appendChild(tag);
    return wrap;
}

function mpShowLocalVideo(label = "You") {
    mpRemoveLocalVideo();
    if (!mpVideoStream) return;
    mpLocalVideoTile = mpMakeVideoTile(label, mpVideoStream, true);
    mpVideosEl.prepend(mpLocalVideoTile);
    mpSyncCameraStrip();
}

function mpRemoveLocalVideo() {
    if (mpLocalVideoTile) {
        mpLocalVideoTile.remove();
        mpLocalVideoTile = null;
    }
    mpSyncCameraStrip();
}

function mpEnsureRemoteVideoTile(peerId, stream) {
    let wrap = mpRemoteVideoEls.get(peerId);
    if (!wrap) {
        wrap = mpMakeVideoTile(mpPeers.get(peerId)?.name || "Racer", stream, false);
        mpVideosEl.appendChild(wrap);
        mpRemoteVideoEls.set(peerId, wrap);
    } else {
        wrap.querySelector("video").srcObject = stream;
    }
    mpSyncCameraStrip();
}

// A racer's photo, shown "as a camera" — same tile styling as a live video
// feed — for anyone who hasn't turned on live video chat (or doesn't have a
// camera at all). Falls back to a plain colored initial when they have no
// profile picture either, so the strip still shows who's connected.
function mpMakeAvatarTile(name, color, avatar, isLocal) {
    const wrap = document.createElement("div");
    wrap.className = "mp-video-tile mp-avatar-tile" + (isLocal ? " local" : "");
    if (avatar) {
        const img = document.createElement("img");
        img.src = avatar;
        img.alt = name;
        wrap.appendChild(img);
    } else {
        const placeholder = document.createElement("div");
        placeholder.className = "mp-avatar-placeholder";
        placeholder.style.background = color || "#53e0ff";
        placeholder.textContent = (name || "?").trim().slice(0, 1).toUpperCase();
        wrap.appendChild(placeholder);
    }
    const tag = document.createElement("span");
    tag.textContent = name;
    wrap.appendChild(tag);
    return wrap;
}

function mpAnimateTileRemoval(tile) {
    if (!tile || !tile.isConnected) return;
    tile.classList.add("leaving");
    setTimeout(() => tile.remove(), 450);
}

// Keeps the camera strip showing exactly one tile per connected racer
// (self included): their live video if it's on, otherwise their profile
// picture "as a camera", otherwise a plain colored initial. Cheap to call
// liberally — it diffs against what's already there rather than rebuilding.
function mpSyncCameraStrip() {
    if (!mpConnected) {
        mpAvatarTiles.forEach((tile) => tile.remove());
        mpAvatarTiles.clear();
        mpSyncVideosVisibility();
        return;
    }
    const wanted = new Map();
    wanted.set("self", { name: "You", color: mpLocalRacerColor(), avatar: mpLocalAvatar(), isLocal: true });
    mpPeers.forEach((peer, peerId) => {
        wanted.set(peerId, { name: peer.name, color: peer.color, avatar: peer.avatar, isLocal: false });
    });

    mpAvatarTiles.forEach((tile, key) => {
        const hasLiveVideo = key === "self" ? Boolean(mpLocalVideoTile) : mpRemoteVideoEls.has(key);
        if (!wanted.has(key) || hasLiveVideo) {
            tile.remove();
            mpAvatarTiles.delete(key);
        }
    });

    wanted.forEach((info, key) => {
        const hasLiveVideo = key === "self" ? Boolean(mpLocalVideoTile) : mpRemoteVideoEls.has(key);
        if (hasLiveVideo || mpAvatarTiles.has(key)) return;
        const tile = mpMakeAvatarTile(info.name, info.color, info.avatar, info.isLocal);
        mpAvatarTiles.set(key, tile);
        if (info.isLocal) mpVideosEl.prepend(tile);
        else mpVideosEl.appendChild(tile);
    });

    mpSyncVideosVisibility();
}

function mpCreatePeerConnection(peerId) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    mpPeerConnections.set(peerId, pc);

    if (mpAudioStream) {
        mpAudioStream.getTracks().forEach((track) => pc.addTrack(track, mpAudioStream));
    }
    if (mpVideoStream) {
        mpVideoStream.getTracks().forEach((track) => pc.addTrack(track, mpVideoStream));
    }

    pc.onicecandidate = (event) => {
        if (event.candidate && mpSocket && mpSocket.readyState === WebSocket.OPEN) {
            mpSocket.send(JSON.stringify({ type: "rtc-ice", to: peerId, candidate: event.candidate }));
        }
    };

    pc.ontrack = (event) => {
        if (event.track.kind === "video") {
            mpEnsureRemoteVideoTile(peerId, event.streams[0]);
            return;
        }
        let audioEl = mpRemoteAudioEls.get(peerId);
        if (!audioEl) {
            audioEl = document.createElement("audio");
            audioEl.autoplay = true;
            audioEl.dataset.peerId = peerId;
            document.body.appendChild(audioEl);
            mpRemoteAudioEls.set(peerId, audioEl);
        }
        audioEl.srcObject = event.streams[0];
    };

    return pc;
}

async function mpStartPeerConnection(peerId, isInitiator) {
    if (mpPeerConnections.has(peerId)) return;
    const pc = mpCreatePeerConnection(peerId);
    if (isInitiator) {
        // make sure both media sections exist even with no local mic/cam, so we
        // can still RECEIVE the other side's audio and video
        if (!mpAudioStream) pc.addTransceiver("audio", { direction: "recvonly" });
        if (!mpVideoStream) pc.addTransceiver("video", { direction: "recvonly" });
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        mpSocket.send(JSON.stringify({ type: "rtc-offer", to: peerId, sdp: pc.localDescription }));
    }
}

function mpStopPeerConnection(peerId) {
    const pc = mpPeerConnections.get(peerId);
    if (pc) {
        pc.close();
        mpPeerConnections.delete(peerId);
    }
    const audioEl = mpRemoteAudioEls.get(peerId);
    if (audioEl) {
        audioEl.remove();
        mpRemoteAudioEls.delete(peerId);
    }
    const videoTile = mpRemoteVideoEls.get(peerId);
    if (videoTile) {
        videoTile.remove();
        mpRemoteVideoEls.delete(peerId);
    }
    mpSyncCameraStrip();
}

// tear down and re-offer to everyone — used when local media changes (mic/cam toggled)
function mpRestartMedia() {
    Array.from(mpPeerConnections.keys()).forEach(mpStopPeerConnection);
    if (!mpConnected) return;
    mpPeers.forEach((peer, peerId) => mpStartPeerConnection(peerId, true));
}

async function mpHandleRtcOffer(msg) {
    // a fresh offer replaces any existing connection with that peer (renegotiation)
    mpStopPeerConnection(msg.from);
    const pc = mpCreatePeerConnection(msg.from);
    await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    mpSocket.send(JSON.stringify({ type: "rtc-answer", to: msg.from, sdp: pc.localDescription }));
}

async function mpHandleRtcAnswer(msg) {
    const pc = mpPeerConnections.get(msg.from);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
}

async function mpHandleRtcIce(msg) {
    const pc = mpPeerConnections.get(msg.from);
    if (!pc || !msg.candidate) return;
    try {
        await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
    } catch (e) {
        /* ignore stray candidates arriving before the remote description is set */
    }
}

async function mpToggleVoice() {
    if (!mpVoiceEnabled) {
        try {
            mpAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
            mpAddChatLine(null, "Microphone access denied or unavailable.", true);
            return;
        }
        mpVoiceEnabled = true;
        mpAddChatLine(null, "Voice chat enabled.", true);
    } else {
        mpVoiceEnabled = false;
        if (mpAudioStream) {
            mpAudioStream.getTracks().forEach((track) => track.stop());
            mpAudioStream = null;
        }
        mpAddChatLine(null, "Voice chat disabled.", true);
    }
    mpSyncMediaButtons();
    mpRestartMedia();
}

async function mpToggleVideo() {
    if (!mpVideoEnabled) {
        try {
            mpVideoStream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
        } catch (e) {
            mpAddChatLine(null, "Camera access denied or unavailable.", true);
            return;
        }
        mpVideoEnabled = true;
        mpShowLocalVideo();
        mpAddChatLine(null, "Video chat enabled.", true);
    } else {
        mpVideoEnabled = false;
        if (mpVideoStream) {
            mpVideoStream.getTracks().forEach((track) => track.stop());
            mpVideoStream = null;
        }
        mpRemoveLocalVideo();
        mpAddChatLine(null, "Video chat disabled.", true);
    }
    mpSyncMediaButtons();
    mpRestartMedia();
}

function mpStopAllMedia() {
    mpVoiceEnabled = false;
    mpVideoEnabled = false;
    [mpAudioStream, mpVideoStream].forEach((stream) => stream?.getTracks().forEach((track) => track.stop()));
    mpAudioStream = null;
    mpVideoStream = null;
    mpRemoveLocalVideo();
    Array.from(mpPeerConnections.keys()).forEach(mpStopPeerConnection);
    mpSyncMediaButtons();
}

// --- solo cam & mic test: preview your camera and watch the mic level meter,
// no room needed ---
let mediaTestStream = null;
let mediaTestTile = null;
let mediaTestMeterTimer = null;
let mediaTestAudioSource = null;

async function toggleMediaTest() {
    if (mediaTestStream) {
        stopMediaTest();
        return;
    }
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS, audio: true });
    } catch (e) {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
        } catch (e2) {
            mpStatus.textContent = "Camera/mic access denied or unavailable.";
            return;
        }
    }
    mediaTestStream = stream;
    mediaTestTile = mpMakeVideoTile("You (test)", stream, true);

    // mic level meter
    const meter = document.createElement("div");
    meter.className = "mp-mic-meter";
    const meterFill = document.createElement("div");
    meter.appendChild(meterFill);
    mediaTestTile.appendChild(meter);
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
        try {
            const audioCtx = ensureAudioContext();
            if (audioCtx.state === "suspended") audioCtx.resume();
            mediaTestAudioSource = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 512;
            mediaTestAudioSource.connect(analyser);
            const buffer = new Uint8Array(analyser.frequencyBinCount);
            mediaTestMeterTimer = setInterval(() => {
                analyser.getByteTimeDomainData(buffer);
                let sum = 0;
                for (let i = 0; i < buffer.length; i += 1) {
                    const v = (buffer[i] - 128) / 128;
                    sum += v * v;
                }
                const rms = Math.sqrt(sum / buffer.length);
                meterFill.style.width = `${clamp(rms * 300, 2, 100)}%`;
            }, 80);
        } catch (e) {
            meter.remove();
        }
    } else {
        meter.remove();
    }

    mpVideosEl.prepend(mediaTestTile);
    mpSyncVideosVisibility();
    mpMediaTestButton.textContent = "🧪 Stop Test";
    mpStatus.textContent = "Testing camera & mic — you should see yourself and the green bar should move when you talk.";
}

function stopMediaTest() {
    if (mediaTestMeterTimer) {
        clearInterval(mediaTestMeterTimer);
        mediaTestMeterTimer = null;
    }
    if (mediaTestAudioSource) {
        try { mediaTestAudioSource.disconnect(); } catch (e) { /* already gone */ }
        mediaTestAudioSource = null;
    }
    if (mediaTestStream) {
        mediaTestStream.getTracks().forEach((track) => track.stop());
        mediaTestStream = null;
    }
    if (mediaTestTile) {
        mediaTestTile.remove();
        mediaTestTile = null;
    }
    mpSyncVideosVisibility();
    mpMediaTestButton.textContent = "🧪 Test Cam & Mic";
}

mpHostButton.addEventListener("click", mpHost);
mpJoinButton.addEventListener("click", () => mpJoin(mpJoinCodeInput.value.trim().toUpperCase()));
mpVoiceButton.addEventListener("click", mpToggleVoice);
mpVideoButton.addEventListener("click", mpToggleVideo);
mpMediaTestButton.addEventListener("click", toggleMediaTest);
mpLeaveButton.addEventListener("click", mpLeave);
mpChatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    mpSendChat(mpChatInput.value);
    mpChatInput.value = "";
});

localPlayerButtons.forEach((button) => {
    button.addEventListener("click", () => setLocalPlayerCount(Number(button.dataset.localPlayers)));
});

gamepadResetButton?.addEventListener("click", () => {
    gamepadMapping = { ...GAMEPAD_DEFAULT_MAPPING };
    saveGamepadMapping();
    gamepadRemapAction = null;
    renderGamepadMapList();
});
renderGamepadMapList();
renderCursorPrefButtons();
syncGamepadPanel();
window.addEventListener("gamepadconnected", syncGamepadPanel);
window.addEventListener("gamepaddisconnected", syncGamepadPanel);
// poll pads on the setup screen too, so remapping, the pad cursor, and
// "press + to start" work before a race (33ms keeps the cursor smooth)
setInterval(() => {
    if (!loopActive) {
        updateGamepadInput();
        // redraw so the "hold B to exit" progress bar animates even though
        // the setup screen doesn't otherwise loop-render every frame
        if (backHoldStart) draw();
    }
}, 33);

touchButtons.forEach(bindTouchButton);
difficultyButtons.forEach(bindDifficultyButton);
cupButtons.forEach(bindCupButton);
mapButtons.forEach(bindMapButton);

// --- character & kart pickers on the setup screen ---
function renderDriverPanel() {
    const characterPicker = document.getElementById("characterPicker");
    const kartPicker = document.getElementById("kartPicker");
    const driverHint = document.getElementById("driverHint");
    if (!characterPicker || !kartPicker) return;

    characterPicker.innerHTML = "";
    CHARACTERS.forEach((character) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "map-button";
        button.classList.toggle("is-selected", character.key === selectedCharacterKey);
        // Dino variants all share one glyph (see CHARACTERS) — tint the
        // picker's icon the same way the kart draws it, so the swatches
        // actually look distinct instead of nine identical dinosaurs.
        const icon = document.createElement("span");
        icon.textContent = character.emoji;
        icon.style.filter = character.filter || "none";
        button.appendChild(icon);
        button.appendChild(document.createTextNode(` ${character.name}`));
        button.addEventListener("click", () => {
            selectedCharacterKey = character.key;
            applyDriverSelection();
        });
        characterPicker.appendChild(button);
    });

    kartPicker.innerHTML = "";
    KARTS.forEach((kart) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "map-button";
        button.classList.toggle("is-selected", kart.key === selectedKartKey);
        button.textContent = `${kart.emoji} ${kart.name}`;
        button.title = kart.desc;
        button.addEventListener("click", () => {
            selectedKartKey = kart.key;
            applyDriverSelection();
        });
        kartPicker.appendChild(button);
    });

    if (driverHint) {
        const kart = getSelectedKart();
        driverHint.textContent = `${getSelectedCharacter().emoji} ${getSelectedCharacter().name} in the ${kart.emoji} ${kart.name} — ${kart.desc}.`;
    }

    renderKartColorPicker();
}

function applyDriverSelection() {
    saveKartSettings();
    renderDriverPanel();
    // refresh the grid so the new name/stats are live for the next race —
    // but never mid-race, where rebuilding the roster would reset everything
    if (!running) {
        racerBlueprints = buildRacerBlueprints();
        applyMap(currentMapKey);
        resetRace();
    }
}

// Body color only for v1, chosen from the same racerPalette swatches every
// seat already picks from by index — not skins/decals (buildKartRig3D only
// colors the body mesh; wheels/spoiler/helmet stay their hardcoded dark
// colors). Locks in before the race starts, same as map/character/kart —
// syncKartRigs3D() builds each racer's 3D rig once and never revisits it,
// so there's no live in-race repaint for v1.
function renderKartColorPicker() {
    const picker = document.getElementById("kartColorPicker");
    if (!picker) return;
    picker.innerHTML = "";

    const defaultBtn = document.createElement("button");
    defaultBtn.type = "button";
    defaultBtn.className = "kart-color-swatch kart-color-swatch-default";
    defaultBtn.title = "Default (by seat)";
    defaultBtn.classList.toggle("is-selected", !selectedKartColor);
    defaultBtn.addEventListener("click", () => applyKartColorSelection(null));
    picker.appendChild(defaultBtn);

    racerPalette.forEach((hex) => {
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.className = "kart-color-swatch";
        swatch.style.background = hex;
        swatch.title = hex;
        swatch.classList.toggle("is-selected", selectedKartColor === hex);
        swatch.addEventListener("click", () => applyKartColorSelection(hex));
        picker.appendChild(swatch);
    });
}

function applyKartColorSelection(hexOrNull) {
    selectedKartColor = hexOrNull;
    saveKartSettings();
    saveKartColorToProfile(hexOrNull);
    renderKartColorPicker();
    if (!running) {
        racerBlueprints = buildRacerBlueprints();
        applyMap(currentMapKey);
        resetRace();
    }
}

// Fire-and-forget: syncs the choice to the signed-in profile so it follows
// across devices, same pattern as unlockPartyStartedAchievement above (this
// iframe has no access to the parent hub's window.MimiProfiles, so it makes
// its own direct call using the session's already-stored passwordHash — see
// activeProfileSession's own comment for why that's readable here at all).
// No-ops for passkey-only sessions (no stored password) — the choice still
// applies locally via mimiKartSettings in that case.
async function saveKartColorToProfile(hexOrNull) {
    const s = activeProfileSession();
    if (!s?.key || !s?.passwordHash) return;
    try {
        await fetch(`${accountServerBase()}/api/profiles/set-kart-color`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: s.key, passwordHash: s.passwordHash, kartColor: hexOrNull || "" }),
        });
    } catch (e) { /* offline/LAN hiccup — local selection still applies */ }
}

renderDriverPanel();
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
hdrButton?.addEventListener("click", toggleHDR);
audioButton?.addEventListener("click", toggleAudio);
fullScreenButton?.addEventListener("click", toggleFullScreen);
vrButton?.addEventListener("click", () => (renderer3D?.xr?.isPresenting ? exitVR() : enterVR()));
pauseButton?.addEventListener("click", togglePause);

document.addEventListener("fullscreenchange", syncFullScreenButton);
document.addEventListener("webkitfullscreenchange", syncFullScreenButton);

initThree3D();
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
syncHdrButton();
syncCupUI();
syncAudioButton();
syncFullScreenButton();
syncPauseButton();
syncLocalPlayerUI();
draw();
