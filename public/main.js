import { chart } from "./chart.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// Size the canvas to the window, sharp on high-DPI screens.
function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels from here on
}
window.addEventListener("resize", resize);
resize();

const settings = {
  scrollSpeed: 300, // px per second
  gravity: 3000, // px per second^2
  jumpHeight: 100, // px, peak height of a jump
  audioOffset: 0, // ms, + if obstacles feel early, - if they feel late
  volume: 0.8, // 0..1
};
const DEFAULTS = { ...settings };
const SAVED_KEYS = ["scrollSpeed", "jumpHeight", "audioOffset", "volume"];

// Remember slider values between visits (skipped quietly if storage is blocked).
try {
  const saved = JSON.parse(localStorage.getItem("dualdash-settings") || "{}");
  for (const k of SAVED_KEYS) if (typeof saved[k] === "number") settings[k] = saved[k];
} catch {}
function saveSettings() {
  try {
    const out = {};
    for (const k of SAVED_KEYS) out[k] = settings[k];
    localStorage.setItem("dualdash-settings", JSON.stringify(out));
  } catch {}
}

// Measured from the track: 130 BPM, first beat lands 0.160 s into the file.
const SONG = {
  url: "song.mp3",
  bpm: 130,
  firstBeat: 0.160, // seconds
};
const SEC_PER_BEAT = 60 / SONG.bpm;

// Graph: AudioBufferSourceNode -> GainNode (volume) -> speakers
const audio = {
  ctx: null,
  buffer: null,
  gain: null,
  source: null,
  startAt: 0, // audio.ctx.currentTime when the song started
};

let state = "loading";

async function loadSong() {
  // The context can be created before a click; it just starts "suspended".
  audio.ctx = new AudioContext();
  audio.gain = audio.ctx.createGain();
  audio.gain.gain.value = settings.volume;
  audio.gain.connect(audio.ctx.destination);

  const res = await fetch(SONG.url);
  const bytes = await res.arrayBuffer();
  audio.buffer = await audio.ctx.decodeAudioData(bytes);
  state = "ready";
  playBtn.disabled = false;
  playBtn.textContent = "Play";
}
loadSong().catch((err) => {
  console.error(err);
  state = "error";
});

const params = new URLSearchParams(location.search);
// Charting helper: open the page with ?t=60 to start 60 s into the song.
// Only applies to the FIRST run; restarts always begin from 0.
let skipOnce = Number(params.get("t")) || 0;
// Demo/testing helper: ?auto makes both cubes jump by themselves.
const AUTOPLAY = params.has("auto");

let starting = false; // guards against a key + click both starting the song
let canRestartAt = 0; // performance.now() after which a key may restart
let bestProgress = 0; // best % reached this session
let lastProgress = 0; // % reached on the last run
let graceUntil = 0; // song time before which collisions are ignored (after a ?t= skip)

async function startSong() {
  if (starting) return;
  if (state !== "ready" && state !== "ended" && state !== "dead") return;
  if (performance.now() < canRestartAt) return; // don't restart from a panic-mash
  starting = true;
  await audio.ctx.resume(); // browsers only allow audio after a user gesture

  // A buffer source can only be played once, so make a new one each run.
  const src = audio.ctx.createBufferSource();
  src.buffer = audio.buffer;
  src.connect(audio.gain);
  src.onended = () => {
    // Ignore the old source finishing after we've already restarted.
    if (audio.source === src && state === "playing") {
      finishRun(true);
    }
  };
  audio.source = src;

  // Schedule slightly in the future so the start is sample-accurate.
  const skip = skipOnce;
  skipOnce = 0;
  // Starting mid-song could drop you right onto a spike; give a second to react.
  graceUntil = skip > 0 ? skip + 1 : 0;
  const when = audio.ctx.currentTime + 0.1;
  src.start(when, skip);
  audio.startAt = when - skip; // so songTime() still reads true song position

  for (const lane of lanes) {
    Object.assign(lane.cube, { y: 0, vy: 0, onGround: true, angle: 0, held: false, dead: false });
  }
  particles.length = 0;
  state = "playing";
  starting = false;
}

// Called on death (cleared = false) or when the song ends (cleared = true).
function finishRun(cleared) {
  lastProgress = cleared ? 100 : progressAt(songTime());
  bestProgress = Math.max(bestProgress, lastProgress);
  state = cleared ? "ended" : "dead";
  canRestartAt = performance.now() + 500;
}

let frozenTime = 0; // where the world stops when you die
function songTime() {
  if (!audio.ctx) return 0;
  if (state === "dead") return frozenTime;
  if (state !== "playing") return 0;
  return audio.ctx.currentTime - audio.startAt - settings.audioOffset / 1000;
}

// 0..100: how far through the charted part of the song a time is.
function progressAt(t) {
  const end = chartEndTime();
  return Math.max(0, Math.min(100, (t / end) * 100));
}
function chartEndTime() {
  // Last spike plus one bar, so passing the last spike doesn't read 100% yet.
  const last = Math.max(...lanes.map((l) => l.spikes.at(-1)?.time ?? 0));
  return last + 4 * SEC_PER_BEAT;
}

// Song time -> beat number (beat 0 = first beat of the song).
function beatAt(t) {
  return (t - SONG.firstBeat) / SEC_PER_BEAT;
}

// Launch speed needed to reach jumpHeight under gravity: v = sqrt(2 g h)
function jumpVelocity() {
  return Math.sqrt(2 * settings.gravity * settings.jumpHeight);
}

const CUBE_SIZE = 40;

// Each lane has a ground line, a cube x position, and a scroll direction.
// dir = +1: cube runs right (world scrolls left, obstacles come from the right)
// dir = -1: cube runs left  (world scrolls right, obstacles come from the left)
// Cubes sit back to back so each one faces the side its obstacles come from.
const lanes = [
  { 
    name: "top",    
    key: "KeyF", 
    dir: +1, 
    color: "#4de1ff", 
    groundFrac: 0.45, 
    cubeXFrac: 0.35 
  },
  { name: "bottom", 
    key: "KeyJ", 
    dir: -1, 
    color: "#ff5ca8", 
    groundFrac: 0.85, 
    cubeXFrac: 0.65 
  },
];

// Per-cube physics state. y is height ABOVE the ground (0 = standing).
for (const lane of lanes) {
  lane.cube = { 
    y: 0, 
    vy: 0, 
    onGround: true, 
    angle: 0, 
    held: false 
  };
}

// ---------- Obstacles ----------
// Turn the beat chart into spike times per lane. "TB" puts a spike in both lanes.
const SPIKE_W = 40;
const SPIKE_H = 40;
const laneByLetter = { T: lanes[0], B: lanes[1] };
for (const lane of lanes) lane.spikes = [];
for (const [beat, letters] of chart) {
  const time = SONG.firstBeat + beat * SEC_PER_BEAT;
  for (const letter of letters) laneByLetter[letter].spikes.push({ beat, time });
}
for (const lane of lanes) lane.spikes.sort((a, b) => a.time - b.time);

function laneGeometry(lane) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return { groundY: h * lane.groundFrac, cubeX: w * lane.cubeXFrac };
}

// ---------- UI: how-to-play overlay + settings sliders ----------
const helpEl = document.getElementById("help");
const playBtn = document.getElementById("play");

function beginFromHelp() {
  if (state === "loading" || state === "error") return;
  helpEl.hidden = true;
  startSong();
}
playBtn.addEventListener("click", beginFromHelp);

document.getElementById("showHelp").addEventListener("click", (e) => {
  e.currentTarget.blur();
  // Opening the help mid-run stops the run.
  if (state === "playing") {
    state = "ready";
    audio.source.stop();
  }
  helpEl.hidden = false;
});

// Each slider: which setting it drives and how to display the value.
const sliders = [
  { 
    id: "speed",  
    key: "scrollSpeed", 
    fmt: (v) => `${v} px/s` 
  },
  { 
    id: "jump", 
    key: "jumpHeight",  
    fmt: (v) => `${v} px` 
  },
  { 
    id: "offset", 
    key: "audioOffset", 
    fmt: (v) => `${v > 0 ? "+" : ""}${v} ms` 
  },
  { id: "volume", 
    key: "volume",      
    fmt: (v) => `${Math.round(v * 100)}%` 
  },
];

function applySetting(key) {
  if (key === "volume" && audio.gain) {
    // Smooth the change so dragging the slider doesn't click.
    audio.gain.gain.setTargetAtTime(settings.volume, audio.ctx.currentTime, 0.02);
  }
}

function syncSliders() {
  for (const s of sliders) {
    const input = document.getElementById(s.id);
    input.value = settings[s.key];
    document.getElementById(s.id + "Val").textContent = s.fmt(settings[s.key]);
  }
}

for (const s of sliders) {
  const input = document.getElementById(s.id);
  input.addEventListener("input", () => {
    settings[s.key] = Number(input.value);
    document.getElementById(s.id + "Val").textContent = s.fmt(settings[s.key]);
    applySetting(s.key);
    saveSettings();
  });
  // Hand keyboard focus back to the game after a drag, so F / J work right away.
  input.addEventListener("change", () => input.blur());
}

document.getElementById("reset").addEventListener("click", (e) => {
  e.currentTarget.blur();
  for (const s of sliders) settings[s.key] = DEFAULTS[s.key];
  syncSliders();
  applySetting("volume");
  saveSettings();
});

// Keep the panel out of the way on small screens.
if (window.innerWidth < 700) document.getElementById("settings").open = false;
syncSliders();

// Holding the button keeps jumping as soon as the cube lands, like Geometry Dash.
function press(lane) {
  lane.cube.held = true;
  tryJump(lane);
}
function release(lane) {
  lane.cube.held = false;
}

function tryJump(lane) {
  const c = lane.cube;
  if (!c.onGround) return;
  c.vy = jumpVelocity();
  c.onGround = false;
}

window.addEventListener("keydown", (e) => {
  if (e.repeat) return; // ignore OS key-repeat; holding is handled by `held`
  // Let arrow keys adjust a focused slider instead of controlling the game.
  if (e.target instanceof HTMLInputElement && e.key.startsWith("Arrow")) return;
  if (e.code === "Space") e.preventDefault(); // don't "click" a focused button

  if (!helpEl.hidden) {
    // On the how-to-play screen only Space / Enter start the game.
    if (e.code === "Space" || e.code === "Enter") beginFromHelp();
    return;
  }
  if (state !== "playing") {
    // Any key starts (or restarts) the song. The first press doesn't jump.
    startSong();
    return;
  }
  const lane = lanes.find((l) => l.key === e.code);
  if (lane) press(lane);
});
window.addEventListener("keyup", (e) => {
  const lane = lanes.find((l) => l.key === e.code);
  if (lane) release(lane);
});

// Pointer Events cover mouse, touch and pen with one API.
// Tapping the top half jumps the top cube; bottom half jumps the bottom cube.
// Track which pointer is holding which lane so two thumbs work at once.
const pointerLane = new Map();
canvas.addEventListener("pointerdown", (e) => {
  if (!helpEl.hidden) return;
  if (state !== "playing") {
    startSong();
    return;
  }
  const lane = e.clientY < window.innerHeight * 0.6 ? lanes[0] : lanes[1];
  pointerLane.set(e.pointerId, lane);
  press(lane);
});
function endPointer(e) {
  const lane = pointerLane.get(e.pointerId);
  if (lane) release(lane);
  pointerLane.delete(e.pointerId);
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

function updateCube(lane, dt) {
  const c = lane.cube;

  if (!c.onGround) {
    c.vy -= settings.gravity * dt;
    c.y += c.vy * dt;

    // Spin in the direction of travel: half a turn over one full jump.
    const airTime = (2 * jumpVelocity()) / settings.gravity;
    c.angle += lane.dir * (Math.PI / airTime) * dt;

    if (c.y <= 0) {
      // Land: snap to the ground and to the nearest flat face.
      c.y = 0;
      c.vy = 0;
      c.onGround = true;
      c.angle = Math.round(c.angle / (Math.PI / 2)) * (Math.PI / 2);
    }
  }

  if (c.onGround && c.held) tryJump(lane);
}

// Forgiving hitboxes, like Geometry Dash: the cube's box is shrunk a little and
// only the solid middle of each spike counts, so grazing a tip doesn't kill you.
const CUBE_INSET = 5; // px shaved off each side of the cube
const SPIKE_HIT_HALF_W = 10; // px either side of the spike's center
const SPIKE_HIT_H = SPIKE_H * 0.75; // the top 25% of the tip is harmless

function checkCollision(lane, t) {
  const { cubeX } = laneGeometry(lane);
  const c = lane.cube;
  const cubeHalf = CUBE_SIZE / 2 - CUBE_INSET;
  const cubeBottom = c.y + CUBE_INSET; // height above ground

  for (const s of lane.spikes) {
    const dx = Math.abs(xForTime(lane, s.time, t) - cubeX);
    if (dx < cubeHalf + SPIKE_HIT_HALF_W && cubeBottom < SPIKE_HIT_H) return true;
  }
  return false;
}

// Jumps so the cube is at the top of its arc right as each spike arrives.
// Handy for testing a chart, and it proves the chart is beatable.
function autoJump(lane, t) {
  const c = lane.cube;
  if (!c.onGround) return;
  const halfAir = jumpVelocity() / settings.gravity; // time to reach the peak
  const next = lane.spikes.find((s) => s.time > t - 0.05);
  if (next && next.time - t <= halfAir) tryJump(lane);
}

const particles = [];
let flash = 0; // 1 right after death, fades to 0

function die(lane, t) {
  frozenTime = t;
  finishRun(false);
  audio.source.stop();
  playCrash();
  flash = 1;

  // Burst the cube into little squares.
  const { groundY, cubeX } = laneGeometry(lane);
  const cy = groundY - CUBE_SIZE / 2 - lane.cube.y;
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 150 + Math.random() * 350;
    particles.push({
      x: cubeX, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 200,
      size: 6 + Math.random() * 8, life: 1, color: lane.color,
    });
  }
  lane.cube.dead = true;
}

// A short synthesized "crunch": a pitch-dropping square wave plus a noise burst,
// made on the fly with Web Audio instead of loading a sound file.
function playCrash() {
  const ac = audio.ctx;
  const now = ac.currentTime;

  const osc = ac.createOscillator();
  const og = ac.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(220, now);
  osc.frequency.exponentialRampToValueAtTime(40, now + 0.25);
  og.gain.setValueAtTime(0.25, now);
  og.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  osc.connect(og).connect(audio.gain);
  osc.start(now);
  osc.stop(now + 0.3);

  const len = Math.floor(ac.sampleRate * 0.2);
  const noise = ac.createBuffer(1, len, ac.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const ns = ac.createBufferSource();
  const ng = ac.createGain();
  ns.buffer = noise;
  ng.gain.value = 0.3;
  ns.connect(ng).connect(audio.gain);
  ns.start(now);
}

function updateParticles(dt) {
  for (const p of particles) {
    p.vy += 1200 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt * 1.2;
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    if (particles[i].life <= 0) particles.splice(i, 1);
  }
}

// Where something that happens at song time `eventTime` should be drawn in a lane.
// At eventTime == now it sits exactly on the cube; earlier/later it is off to the
// side the cube is running toward. Step 4 places spikes with this same function.
function xForTime(lane, eventTime, now) {
  const { cubeX } = laneGeometry(lane);
  return cubeX + lane.dir * (eventTime - now) * settings.scrollSpeed;
}

function drawLane(lane, t) {
  const w = window.innerWidth;
  const { groundY, cubeX: cubeX0 } = laneGeometry(lane);
  const c = lane.cube;

  // Ground line pulses on every beat: bright on the beat, fading until the next.
  const beat = beatAt(t);
  const pulse = state === "playing" && beat >= 0 ? 1 - (beat - Math.floor(beat)) : 0;
  ctx.strokeStyle = lane.color;
  ctx.lineWidth = 3 + 3 * pulse * pulse;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(w, groundY);
  ctx.stroke();

  // One tick per beat, scrolling. A tick crosses under the cube exactly on the
  // beat, so this doubles as a visual sync check. Longer tick = start of a bar.
  const visibleBeats = w / (settings.scrollSpeed * SEC_PER_BEAT) + 2;
  const first = Math.floor(beat - visibleBeats);
  const last = Math.ceil(beat + visibleBeats);
  ctx.lineWidth = 2;
  for (let b = first; b <= last; b++) {
    if (b < 0) continue;
    const x = xForTime(lane, SONG.firstBeat + b * SEC_PER_BEAT, t);
    if (x < -30 || x > w + 30) continue;
    const bar = b % 4 === 0;
    ctx.globalAlpha = bar ? 0.6 : 0.3;
    ctx.beginPath();
    ctx.moveTo(x, groundY + 8);
    ctx.lineTo(x - 12 * lane.dir, groundY + (bar ? 30 : 20));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Spikes: each one reaches the cube exactly at its beat time.
  ctx.fillStyle = lane.color;
  ctx.strokeStyle = "#e8ecff";
  ctx.lineWidth = 2;
  for (const s of lane.spikes) {
    const x = xForTime(lane, s.time, t);
    if (x < -SPIKE_W || x > w + SPIKE_W) continue;
    ctx.globalAlpha = (x - cubeX0) * lane.dir < -SPIKE_W ? 0.35 : 1; // dim once passed
    ctx.beginPath();
    ctx.moveTo(x - SPIKE_W / 2, groundY);
    ctx.lineTo(x, groundY - SPIKE_H);
    ctx.lineTo(x + SPIKE_W / 2, groundY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // The cube, rotated around its center (hidden once it has exploded)
  if (c.dead) return;
  const { cubeX } = laneGeometry(lane);
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

  // Key hint next to the ground
  ctx.fillStyle = lane.color;
  ctx.globalAlpha = 0.6;
  ctx.font = "14px system-ui, sans-serif";
  ctx.textAlign = lane.dir > 0 ? "left" : "right";
  ctx.fillText(lane.key.replace("Key", ""), lane.dir > 0 ? 12 : w - 12, groundY + 44);
  ctx.globalAlpha = 1;
}

// Temporary status text. Step 6 replaces the start message with a proper
// how-to-play overlay.
function drawHud(t) {
  const w = window.innerWidth;
  const h = window.innerHeight;

  // Progress bar along the top edge.
  if (state !== "loading" && state !== "error") {
    const p = state === "ended" ? 100 : progressAt(t);
    ctx.fillStyle = "rgba(232,236,255,0.12)";
    ctx.fillRect(0, 0, w, 6);
    ctx.fillStyle = "#e8ecff";
    ctx.fillRect(0, 0, (w * p) / 100, 6);
    if (bestProgress > 0 && bestProgress < 100) {
      ctx.fillStyle = "#ffd84d"; // best-run marker
      ctx.fillRect((w * bestProgress) / 100 - 1, 0, 3, 10);
    }
  }

  // Red flash on death.
  if (flash > 0) {
    ctx.fillStyle = `rgba(255, 60, 90, ${0.35 * flash})`;
    ctx.fillRect(0, 0, w, h);
  }

  ctx.fillStyle = "#e8ecff";
  ctx.textAlign = "center";
  ctx.font = "20px system-ui, sans-serif";
  const msg = {
    loading: "Loading song…",
    ready: helpEl.hidden ? "Click, tap or press any key to start" : "",
    ended: "Level complete! Press any key to play again",
    dead: `Crashed at ${Math.floor(lastProgress)}%  (best ${Math.floor(bestProgress)}%)  ·  press any key to retry`,
    error: "Couldn't load song.mp3 (check the console)",
  }[state];
  if (msg) ctx.fillText(msg, w / 2, 60);

  if (state === "playing") {
    ctx.textAlign = "right";
    ctx.font = "14px ui-monospace, monospace";
    ctx.globalAlpha = 0.6;
    const beat = Math.max(0, Math.floor(beatAt(t)));
    const tag = AUTOPLAY ? "AUTO  " : "";
    ctx.fillText(`${tag}${Math.floor(progressAt(t))}%  ${t.toFixed(2)}s  beat ${beat}  bar ${Math.floor(beat / 4) + 1}`, w - 12, 28);
    ctx.globalAlpha = 1;
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

let lastNow = performance.now();

function frame(now) {
  const dt = Math.min((now - lastNow) / 1000, 1 / 20);
  lastNow = now;
  const t = songTime();

  if (state === "playing") {
    for (const lane of lanes) {
      if (AUTOPLAY) autoJump(lane, t);
      updateCube(lane, dt);
    }
    for (const lane of lanes) {
      if (t > graceUntil && checkCollision(lane, t)) {
        die(lane, t);
        break;
      }
    }
  }
  updateParticles(dt);
  flash = Math.max(0, flash - dt * 2);

  ctx.fillStyle = "#0d0f1a";
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

  for (const lane of lanes) drawLane(lane, t);
  drawParticles();
  drawHud(t);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
