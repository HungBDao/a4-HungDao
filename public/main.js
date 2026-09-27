import { chart } from './chart.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Resize the canvas to fill the window and account for device pixel ratio
function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const settings = {
    scrollSpeed: 300, // px per second
    gravity: 3000, // px per second squared
    jumpHeight: 100, // px, peak height of the jump
    audioOffset: 0, //ms, + if the obstacle feels early, - if it feels late
    volume: 0.8, // 0.0 to 1.0
}

const SONG = {
    url: "song.mp3",
    bpm: 130,
    firstBeat: 0.160, //seconds, time of the first beat in the song
}
const SECONDS_PER_BEAT = 60 / SONG.bpm;

const audio = {
    ctx: null,
    buffer: null,
    gain: null,
    source: null,
    startAt: 0, //audio.ctx.currentTime when the song started
};

let state = "loading"; // "loading", "ready" (waiting for click), "playing", "ended"

async function loadSong() {
    audio.ctx = new AudioContext();
    audio.gain = audio.ctx.createGain();
    audio.gain.gain.value = settings.volume;
    audio.gain.connect(audio.ctx.destination);

    const response = await fetch(SONG.url);
    const arrayBuffer = await response.arrayBuffer();
    audio.buffer = await audio.ctx.decodeAudioData(arrayBuffer);
    state = "ready";
}
loadSong().catch((err) => {
    console.error("Error loading song:", err);
    state = "error";
});

async function startSong() {
    if (state !== "ready" && state !== "ended") return;
    await audio.ctx.resume(); // Resume the audio context if it was suspended

    // A buffer source node can only be started once, so we need to create a new one each time we start the song
    audio.source = audio.ctx.createBufferSource();
    audio.source.buffer = audio.buffer;
    audio.source.connect(audio.gain);
    audio.source.onended = () => {
        if (state === "playing") {
            state = "ended";
        }
    };

    const skip = Number(new URLSearchParams(location.search).get("t") || 0);
    const when = audio.ctx.currentTime + 0.1; // Start after a short delay
    audio.source.start(when, skip);
    audio.startAt = when - skip; // Record the time when the song started, adjusted for any skip

    for (const lane of lanes) {
        Object.assign(lane.cube, { y: 0, vy: 0, angle: 0, onGround: true, held: false });
    }
    state = "playing";
}

function songTime() {
    if (!audio.ctx || state !== "playing") return 0;
    return audio.ctx.currentTime - audio.startAt - settings.audioOffset / 1000;
}

function beatAt(t) {
    return (t - SONG.firstBeat) / SECONDS_PER_BEAT;
}

function calculateJumpVelocity() {
    return Math.sqrt(2 * settings.gravity * settings.jumpHeight);
}

const CUBE_SIZE = 40;

// Define the lanes with their properties
// dir = +1: cube runs right
// dir = -1: cube runs left
const lanes = [
    {
        name: "top",
        key: "KeyF",
        dir: +1,
        color: "#4de1ff",
        groundFraction: 0.45,
        cubeXFraction: 0.35,
    },
    {
        name: "bottom",
        key: "KeyJ",
        dir: -1,
        color: "#ff4d4d",
        groundFraction: 0.85,
        cubeXFraction: 0.65,
    }
]

for (const lane of lanes) {
    lane.cube = {
        y: 0,
        vy: 0,
        angle: 0,
        onGround: true,
        held: false,
    }
}

const SPIKE_W = 40;
const SPIKE_H = 40;
const laneByLetter = { T: lanes[0], B: lanes[1] };
for (const lane of lanes) {
    lane.spikes = [];
}
for(const [beat, letters] of chart) {
    const time = SONG.firstBeat + beat * SECONDS_PER_BEAT;
    for (const letter of letters) {
        laneByLetter[letter].spikes.push({ beat, time });
    }
}
for (const lane of lanes) {
    lane.spikes.sort((a, b) => a.time - b.time);
}

// Calculate the geometry for a given lane
function laneGeometry(lane) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const groundY = h * lane.groundFraction;
    const cubeX = w * lane.cubeXFraction;
    return { groundY, cubeX };
}

function press(lane) {
    lane.cube.held = true;
    tryJump(lane);
}

function release(lane) {
    lane.cube.held = false;
}

function tryJump(lane) {
    const c = lane.cube;
    if (!c.onGround) return; // Can't jump if not on the ground
    c.vy = calculateJumpVelocity();
    c.onGround = false;
}

window.addEventListener('keydown', (e) => {
    if (e.repeat) return; // Ignore repeated keydown events
    if (state !== "playing") {
        startSong();
        return;
    }
    const lane = lanes.find((l) => l.key === e.code);
    if (lane) {
        press(lane);
    }
});

window.addEventListener('keyup', (e) => {
    const lane = lanes.find((l) => l.key === e.code);
    if (lane) {
        release(lane);
    }
});

const pointerLine = new Map();
canvas.addEventListener('pointerdown', (e) => {
    if (state !== "playing") {
        startSong();
        return;
    }
    const lane = e.clientY < window.innerHeight * 0.6 ? lanes[0] : lanes[1];
    pointerLine.set(e.pointerId, lane);
    press(lane);
});

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

function endPointer(e) {
    const lane = pointerLine.get(e.pointerId);
    if (lane) {
        release(lane);
    }
    pointerLine.delete(e.pointerId);
}

function updateCube(lane, dt) {
    const c = lane.cube;

    if (!c.onGround) {
        c.vy -= settings.gravity * dt;
        c.y += c.vy * dt;

        const airTime = (2 * calculateJumpVelocity()) / settings.gravity; // Total time in the air
        c.angle += lane.dir * (Math.PI / airTime) * dt; // Rotate 180 degrees over the air time

        if (c.y <= 0) {
            c.y = 0;
            c.vy = 0;
            c.onGround = true;
            c.angle = Math.round(c.angle / (Math.PI / 2)) * (Math.PI / 2); // Snap angle to nearest full rotation
        }
    }

    if (c.held && c.onGround) {
        tryJump(lane);
    }
}

const startTime = performance.now();

function xForTime(lane, eventTime, now) {
    const {cubeX} = laneGeometry(lane);
    return cubeX + lane.dir * (eventTime - now) * settings.scrollSpeed;
}

function drawLane(lane, t) {
    const w = window.innerWidth;
    const {groundY, cubeX: cubeX0} = laneGeometry(lane);
    const c = lane.cube;

    // Ground line
    const beat = beatAt(t);
    const pulse = state === "playing" && beat >= 0 ? 1 - (beat - Math.floor(beat)) : 0; // Pulse between 0 and 1
    ctx.strokeStyle = lane.color;
    ctx.lineWidth = 3 + 3 * pulse * pulse; // Pulse the line width
    ctx.beginPath();
    ctx.moveTo(0, groundY); // Start at the left edge of the canvas
    ctx.lineTo(w, groundY); // Draw to the right edge of the canvas
    ctx.stroke();

    // Tick marks under the ground line that scroll
    const visibleBeats = w / (settings.scrollSpeed * SECONDS_PER_BEAT) + 2; // +2 to ensure we cover the whole width
    const first = Math.floor(beat - visibleBeats);
    const last = Math.ceil(beat + visibleBeats);
    ctx.lineWidth = 2;
    for (let b = first; b <= last; b++) {
        if (b < 0) continue; // Don't draw ticks for negative beats
        const x = xForTime(lane, SONG.firstBeat + b * SECONDS_PER_BEAT, t);
        const bar = b % 4 === 0;
        ctx.globalAlpha = bar ? 0.6 : 0.3; // Make bar lines more opaque
        ctx.beginPath();
        ctx.moveTo(x, groundY + 8);
        ctx.lineTo(x - 12 * lane.dir, groundY + (bar ? 30 : 20));
        ctx.stroke();
    }
    ctx.globalAlpha = 1.0; // Reset transparency for subsequent drawings

    // Spikes
    ctx.fillStyle = lane.color;
    ctx.strokeStyle = "#e8ecff";
    ctx.lineWidth = 2;
    for (const spike of lane.spikes) {
        const x = xForTime(lane, spike.time, t);
        if (x < -SPIKE_W || x > w + SPIKE_W) continue; // Skip spikes that are off-screen
        ctx.globalAlpha = (x - cubeX0) * lane.dir < -SPIKE_W ? 0.35 : 1.0; // Example calculation for transparency based on position
        ctx.beginPath();
        ctx.moveTo(x - SPIKE_W / 2, groundY);
        ctx.lineTo(x, groundY - SPIKE_H);
        ctx.lineTo(x + SPIKE_W / 2, groundY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }
    ctx.globalAlpha = 1.0; // Reset transparency for subsequent drawings

    // Cube
    const {cubeX} = laneGeometry(lane);
    const cy = groundY - CUBE_SIZE / 2 - c.y;
    ctx.save();
    ctx.translate(cubeX, cy);
    ctx.rotate(c.angle);
    ctx.fillStyle = lane.color;
    ctx.fillRect(-CUBE_SIZE / 2, -CUBE_SIZE / 2, CUBE_SIZE, CUBE_SIZE);
    ctx.strokeStyle = "#0d0f1a";
    ctx.lineWidth = 3;
    ctx.strokeRect(-CUBE_SIZE / 2 + 6, -CUBE_SIZE / 2 + 6, CUBE_SIZE - 12, CUBE_SIZE - 12);
    ctx.restore();

    // Key hint
    ctx.fillStyle = lane.color;
    ctx.globalAlpha = 0.6;
    ctx.font = "14px system-ui, sans-serif";
    ctx.textAlign = lane.dir > 0 ? "left" : "right";
    ctx.fillText(lane.key.replace("Key", ""), lane.dir > 0 ? 12 : w - 12, groundY + 44);
    ctx.globalAlpha = 1.0;
}

function drawHud(t) {
    const w = window.innerWidth;
    ctx.fillStyle = "#e8ecff";
    ctx.textAlign = "center";
    ctx.font = "20px system-ui, sans-serif";
    const msg = {
        loading: "Loading song...",
        ready: "Click or press any key to start",
        ended: "Song ended. Click or press any key to restart",
        error: "Error loading song. Check console for details.",
    }[state];
    if (msg) {
        ctx.fillText(msg, w / 2, 60);
    }

    if (state === "playing") {
        ctx.textAlign = "right";
        ctx.font = "14px ui-monospace, monospace";
        ctx.globalAlpha = 0.6;
        const beat = Math.max(0, Math.floor(beatAt(t)));
        ctx.fillText(`${t.toFixed(2)}s | Beat ${beat} | Bar ${Math.floor(beat / 4) + 1}`, w - 12, 24);
        ctx.globalAlpha = 1.0;
    }
}

let lastNow = performance.now();

function frame(now) {
    const t = (now - startTime) / 1000; // Convert to seconds
    const dt = Math.min((now - lastNow) / 1000, 1 / 20); // Limit dt to avoid large jumps
    lastNow = now;

    for (const lane of lanes) {
        updateCube(lane, dt);
    }

    ctx.fillStyle = "#0d0f1a";
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    
    // Draw each lane
    for (const lane of lanes) {
        drawLane(lane, t);
    }

    drawHud(t);

    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
