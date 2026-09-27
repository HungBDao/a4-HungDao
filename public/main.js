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

const CUBE_SIZE = 40;

// Define the lanes with their properties
// dir = +1: cube runs right
// dir = -1: cube runs left
const lanes = [
    {
        name: "top",
        dir: +1,
        color: "#4de1ff",
        groundFraction: 0.45,
        cubeXFraction: 0.35,
    },
    {
        name: "bottom",
        dir: -1,
        color: "#ff4d4d",
        groundFraction: 0.85,
        cubeXFraction: 0.65,
    }
]

// Calculate the geometry for a given lane
function laneGeometry(lane) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const groundY = h * lane.groundFraction;
    const cubeX = w * lane.cubeXFraction;
    return { groundY, cubeX };
}

const SCROLL_SPEED = 300; // px per second
const startTime = performance.now();

function drawLine(lane, t) {
    const w = window.innerWidth;
    const {groundY, cubeX} = laneGeometry(lane);

    // Ground line
    ctx.strokeStyle = lane.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, groundY); // Start at the left edge of the canvas
    ctx.lineTo(w, groundY); // Draw to the right edge of the canvas
    ctx.stroke();

    // Tick marks under the ground line that scroll
    const spacing = 80;
    const offset = ((t * SCROLL_SPEED * lane.dir) % spacing + spacing) % spacing; // Ensure offset is positive
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
    ctx.fillStyle = lane.color;
    ctx.fillRect(cubeX - CUBE_SIZE / 2, groundY - CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
    ctx.strokeStyle = "#0d0f1a";
    ctx.lineWidth = 3;
    ctx.strokeRect(cubeX - CUBE_SIZE / 2 + 6, groundY - CUBE_SIZE + 6, CUBE_SIZE - 12, CUBE_SIZE - 12);
}

function frame(now) {
    const t = (now - startTime) / 1000; // Convert to seconds

    ctx.fillStyle = "#0d0f1a";
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    
    // Draw each lane
    for (const lane of lanes) {
        drawLine(lane, t);
    }

    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
