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

function drawLine(lane, t) {
    const w = window.innerWidth;
    const {groundY, cubeX} = laneGeometry(lane);
    const c = lane.cube;

    // Ground line
    ctx.strokeStyle = lane.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, groundY); // Start at the left edge of the canvas
    ctx.lineTo(w, groundY); // Draw to the right edge of the canvas
    ctx.stroke();

    // Tick marks under the ground line that scroll
    const spacing = 80;
    const offset = ((t * settings.scrollSpeed * lane.dir) % spacing + spacing) % spacing; // Ensure offset is positive
    ctx.globalAlpha = 0.35; // Set transparency for the dashed line
    ctx.lineWidth = 2;
    for(let x = -offset; x < w + spacing; x += spacing) {
        ctx.beginPath();
        ctx.moveTo(x, groundY + 8);
        ctx.lineTo(x - 20 * lane.dir, groundY + 24);
        ctx.stroke();
    }
    ctx.globalAlpha = 1.0; // Reset transparency for subsequent drawings

    // Cube
    const cx = cubeX;
    const cy = groundY - CUBE_SIZE / 2 - c.y;
    ctx.save();
    ctx.translate(cx, cy);
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
        drawLine(lane, t);
    }

    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
