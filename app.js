// WaidBlick — HSV-basierte Schweiß-Erkennung im Live-Kamerabild.
// Markiert rot/braun-rote Pixel mit Cyan (gut sichtbar bei Rot-Grün-Schwäche).

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const slider = document.getElementById("sensitivity");
const sliderValue = document.getElementById("sensitivity-value");
const startBtn = document.getElementById("start-btn");
const freezeBtn = document.getElementById("freeze-btn");
const statusEl = document.getElementById("status");
const fpsEl = document.getElementById("fps");

const HIGHLIGHT_R = 0;
const HIGHLIGHT_G = 255;
const HIGHLIGHT_B = 255;

let stream = null;
let running = false;
let frozen = false;
let lastFrameTs = 0;
let fpsSmoothed = 0;

slider.addEventListener("input", () => {
  sliderValue.textContent = slider.value;
});

startBtn.addEventListener("click", async () => {
  if (running) {
    stopCamera();
    startBtn.textContent = "Start";
    freezeBtn.disabled = true;
    statusEl.textContent = "Gestoppt.";
    return;
  }
  await startCamera();
});

freezeBtn.addEventListener("click", () => {
  frozen = !frozen;
  freezeBtn.textContent = frozen ? "Weiter" : "Standbild";
});

async function startCamera() {
  statusEl.textContent = "Kamera wird gestartet ...";
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    running = true;
    frozen = false;
    startBtn.textContent = "Stopp";
    freezeBtn.disabled = false;
    freezeBtn.textContent = "Standbild";
    statusEl.textContent = `Live (${video.videoWidth}×${video.videoHeight})`;
    requestAnimationFrame(processFrame);
  } catch (err) {
    statusEl.textContent = "Kamerazugriff fehlgeschlagen: " + (err.message || err.name);
    running = false;
  }
}

function stopCamera() {
  running = false;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  video.srcObject = null;
}

function processFrame(ts) {
  if (!running) return;

  if (!frozen && video.readyState >= 2) {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applyBloodFilter(imageData.data, parseInt(slider.value, 10));
    ctx.putImageData(imageData, 0, 0);

    if (lastFrameTs) {
      const dt = ts - lastFrameTs;
      const fps = 1000 / dt;
      fpsSmoothed = fpsSmoothed ? fpsSmoothed * 0.9 + fps * 0.1 : fps;
      fpsEl.textContent = fpsSmoothed.toFixed(0) + " fps";
    }
    lastFrameTs = ts;
  }

  requestAnimationFrame(processFrame);
}

// Inline-HSV-Prüfung ohne Funktionsaufruf pro Pixel — Performance-kritisch.
function applyBloodFilter(data, sensitivity) {
  // sensitivity 0..100 → Hue-Breite 5°..30°, Sättigungs-Untergrenze 0.35..0.15
  const hueWidth = 5 + (sensitivity / 100) * 25;
  const minSat = 0.35 - (sensitivity / 100) * 0.20;
  const minVal = 0.15;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
    if (max < minVal * 255) continue;

    const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
    const d = max - min;
    if (d / max < minSat) continue;

    // Hue: Rot ist Maximum-Kanal R, und R-Kanal größer als G und B
    if (max !== r) continue;

    // Hue in Grad (vereinfacht für Rot-Bereich): h = 60 * ((g - b) / d) mod 360
    let h = 60 * ((g - b) / d);
    if (h < 0) h += 360;

    // Rot wickelt sich um 0/360 — beide Seiten prüfen
    const isRed = h <= hueWidth || h >= 360 - hueWidth;
    if (!isRed) continue;

    data[i] = HIGHLIGHT_R;
    data[i + 1] = HIGHLIGHT_G;
    data[i + 2] = HIGHLIGHT_B;
  }
}
