// WaidBlick — HSV-basierte Schweiß-Erkennung im Live-Kamerabild.
// Markiert rot/braun-rote Pixel mit der gewählten Highlight-Farbe.

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const slider = document.getElementById("sensitivity");
const sliderValue = document.getElementById("sensitivity-value");
const startBtn = document.getElementById("start-btn");
const freezeBtn = document.getElementById("freeze-btn");
const resetBtn = document.getElementById("reset-btn");
const settingsBtn = document.getElementById("settings-btn");
const settingsClose = document.getElementById("settings-close");
const settingsModal = document.getElementById("settings-modal");
const settingsSensitivityDisplay = document.getElementById("settings-sensitivity-display");
const colorToggle = document.getElementById("color-toggle");
const statusEl = document.getElementById("status");
const fpsEl = document.getElementById("fps");

const STORAGE_KEY = "waidblick.settings.v1";
const DEFAULT_SENSITIVITY = 50;
const DEFAULT_COLOR = "cyan";

const HIGHLIGHT_COLORS = {
  cyan: [0, 255, 255],
  yellow: [255, 255, 0],
};

let stream = null;
let running = false;
let frozen = false;
let lastFrameTs = 0;
let fpsSmoothed = 0;
let highlightColor = DEFAULT_COLOR;

// ---------- Persistenz ----------

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (typeof s.sensitivity === "number") {
      const v = Math.max(0, Math.min(100, s.sensitivity));
      slider.value = v;
      sliderValue.textContent = v;
      settingsSensitivityDisplay.textContent = v;
    }
    if (s.color && HIGHLIGHT_COLORS[s.color]) {
      setHighlightColor(s.color);
    }
  } catch (e) {
    console.warn("Konnte Einstellungen nicht laden:", e);
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      sensitivity: parseInt(slider.value, 10),
      color: highlightColor,
    }));
  } catch (e) {
    console.warn("Konnte Einstellungen nicht speichern:", e);
  }
}

function setHighlightColor(name) {
  if (!HIGHLIGHT_COLORS[name]) return;
  highlightColor = name;
  colorToggle.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("active", b.dataset.color === name);
  });
}

// ---------- Event-Bindings ----------

slider.addEventListener("input", () => {
  sliderValue.textContent = slider.value;
  settingsSensitivityDisplay.textContent = slider.value;
  saveSettings();
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

resetBtn.addEventListener("click", () => {
  slider.value = DEFAULT_SENSITIVITY;
  sliderValue.textContent = DEFAULT_SENSITIVITY;
  settingsSensitivityDisplay.textContent = DEFAULT_SENSITIVITY;
  setHighlightColor(DEFAULT_COLOR);
  localStorage.removeItem(STORAGE_KEY);
  if (frozen) {
    frozen = false;
    freezeBtn.textContent = "Standbild";
  }
});

settingsBtn.addEventListener("click", () => {
  settingsSensitivityDisplay.textContent = slider.value;
  settingsModal.hidden = false;
});

settingsClose.addEventListener("click", () => {
  settingsModal.hidden = true;
});

colorToggle.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-color]");
  if (!btn) return;
  setHighlightColor(btn.dataset.color);
  saveSettings();
});

// ---------- Kamera + Filter ----------

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

function applyBloodFilter(data, sensitivity) {
  const hueWidth = 5 + (sensitivity / 100) * 25;
  const minSat = 0.35 - (sensitivity / 100) * 0.20;
  const minVal = 0.15;

  const [hlR, hlG, hlB] = HIGHLIGHT_COLORS[highlightColor];

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
    if (max < minVal * 255) continue;

    const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
    const d = max - min;
    if (d / max < minSat) continue;

    if (max !== r) continue;

    let h = 60 * ((g - b) / d);
    if (h < 0) h += 360;

    const isRed = h <= hueWidth || h >= 360 - hueWidth;
    if (!isRed) continue;

    data[i] = hlR;
    data[i + 1] = hlG;
    data[i + 2] = hlB;
  }
}

// ---------- Init ----------

loadSettings();
