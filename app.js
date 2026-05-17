// WaidBlick — HSV-basierte Schweiß-Erkennung im Live-Kamerabild
// mit Größenfilter pro zusammenhängender Pixelinsel.

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const slider = document.getElementById("sensitivity");
const sliderValue = document.getElementById("sensitivity-value");
const dropSizeSlider = document.getElementById("drop-size");
const dropSizeValue = document.getElementById("drop-size-value");
const startBtn = document.getElementById("start-btn");
const freezeBtn = document.getElementById("freeze-btn");
const resetBtn = document.getElementById("reset-btn");
const saveBtn = document.getElementById("save-btn");
const settingsBtn = document.getElementById("settings-btn");
const settingsClose = document.getElementById("settings-close");
const settingsModal = document.getElementById("settings-modal");
const settingsSensitivityDisplay = document.getElementById("settings-sensitivity-display");
const colorToggle = document.getElementById("color-toggle");
const statusEl = document.getElementById("status");
const fpsEl = document.getElementById("fps");

const STORAGE_KEY = "waidblick.settings.v2";

const DEFAULT_SETTINGS = Object.freeze({
  sensitivity: 50,
  dropSize: 50,
  color: "cyan",
});

const HIGHLIGHT_COLORS = {
  cyan: [0, 255, 255],
  yellow: [255, 255, 0],
};

let stream = null;
let running = false;
let frozen = false;
let lastFrameTs = 0;
let fpsSmoothed = 0;
let highlightColor = DEFAULT_SETTINGS.color;
let savedSettings = { ...DEFAULT_SETTINGS };

// Wiederverwendete Puffer für die Blob-Analyse
let maskBuf = null;
let labelBuf = null;
let parentBuf = null;
let areaBuf = null;

// ---------- Persistenz ----------

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (typeof s.sensitivity === "number") {
        savedSettings.sensitivity = clamp(s.sensitivity, 0, 100);
      }
      if (typeof s.dropSize === "number") {
        savedSettings.dropSize = clamp(s.dropSize, 0, 100);
      }
      if (s.color && HIGHLIGHT_COLORS[s.color]) {
        savedSettings.color = s.color;
      }
    }
  } catch (e) {
    console.warn("Konnte Einstellungen nicht laden:", e);
  }
  applySettingsToUI(savedSettings);
  updateDirtyIndicator();
}

function persistSettings(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (e) {
    console.warn("Konnte Einstellungen nicht speichern:", e);
  }
}

function applySettingsToUI(s) {
  slider.value = s.sensitivity;
  sliderValue.textContent = s.sensitivity;
  settingsSensitivityDisplay.textContent = s.sensitivity;
  dropSizeSlider.value = s.dropSize;
  dropSizeValue.textContent = s.dropSize;
  setHighlightColor(s.color);
}

function getCurrentSettings() {
  return {
    sensitivity: parseInt(slider.value, 10),
    dropSize: parseInt(dropSizeSlider.value, 10),
    color: highlightColor,
  };
}

function settingsEqual(a, b) {
  return a.sensitivity === b.sensitivity &&
         a.dropSize === b.dropSize &&
         a.color === b.color;
}

function updateDirtyIndicator() {
  const dirty = !settingsEqual(getCurrentSettings(), savedSettings);
  saveBtn.classList.toggle("has-changes", dirty);
}

function setHighlightColor(name) {
  if (!HIGHLIGHT_COLORS[name]) return;
  highlightColor = name;
  colorToggle.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("active", b.dataset.color === name);
  });
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ---------- Event-Bindings ----------

slider.addEventListener("input", () => {
  sliderValue.textContent = slider.value;
  settingsSensitivityDisplay.textContent = slider.value;
  updateDirtyIndicator();
});

dropSizeSlider.addEventListener("input", () => {
  dropSizeValue.textContent = dropSizeSlider.value;
  updateDirtyIndicator();
});

colorToggle.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-color]");
  if (!btn) return;
  setHighlightColor(btn.dataset.color);
  updateDirtyIndicator();
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
  applySettingsToUI(savedSettings);
  updateDirtyIndicator();
  if (frozen) {
    frozen = false;
    freezeBtn.textContent = "Standbild";
  }
});

saveBtn.addEventListener("click", () => {
  savedSettings = getCurrentSettings();
  persistSettings(savedSettings);
  updateDirtyIndicator();
});

settingsBtn.addEventListener("click", () => {
  settingsSensitivityDisplay.textContent = slider.value;
  updateDirtyIndicator();
  settingsModal.hidden = false;
});

settingsClose.addEventListener("click", () => {
  settingsModal.hidden = true;
});

// ---------- Kamera ----------

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

// ---------- Frame-Verarbeitung ----------

function processFrame(ts) {
  if (!running) return;

  if (!frozen && video.readyState >= 2) {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applyBloodFilter(
      imageData.data,
      canvas.width,
      canvas.height,
      parseInt(slider.value, 10),
      parseInt(dropSizeSlider.value, 10),
    );
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

function ensureBuffers(size) {
  if (!maskBuf || maskBuf.length !== size) {
    maskBuf = new Uint8Array(size);
    labelBuf = new Int32Array(size);
    parentBuf = new Int32Array(Math.max(1024, Math.floor(size / 4)));
    areaBuf = new Int32Array(parentBuf.length);
  } else {
    maskBuf.fill(0);
    labelBuf.fill(0);
  }
}

function applyBloodFilter(data, width, height, sensitivity, dropSize) {
  const size = width * height;
  ensureBuffers(size);

  // Phase 1: Binärmaske aus HSV-Farbprüfung
  const hueWidth = 5 + (sensitivity / 100) * 25;
  const minSat = 0.35 - (sensitivity / 100) * 0.20;
  const minVal = 0.15;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
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

    if (h <= hueWidth || h >= 360 - hueWidth) {
      maskBuf[p] = 1;
    }
  }

  // Phase 2: Connected Components (Union-Find, 4er-Nachbarschaft)
  let nextLabel = 1;
  if (parentBuf.length < size / 2) {
    parentBuf = new Int32Array(size);
    areaBuf = new Int32Array(size);
  }
  parentBuf[0] = 0;

  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    for (let x = 0; x < width; x++) {
      const idx = rowStart + x;
      if (!maskBuf[idx]) continue;

      const top = y > 0 ? labelBuf[idx - width] : 0;
      const left = x > 0 ? labelBuf[idx - 1] : 0;

      if (top && left) {
        const rTop = findRoot(top);
        const rLeft = findRoot(left);
        labelBuf[idx] = rTop;
        if (rTop !== rLeft) {
          parentBuf[rLeft] = rTop;
        }
      } else if (top) {
        labelBuf[idx] = top;
      } else if (left) {
        labelBuf[idx] = left;
      } else {
        if (nextLabel >= parentBuf.length) {
          // Defensive Vergrößerung — sollte selten passieren
          const newSize = parentBuf.length * 2;
          const newParent = new Int32Array(newSize);
          newParent.set(parentBuf);
          parentBuf = newParent;
          const newArea = new Int32Array(newSize);
          newArea.set(areaBuf);
          areaBuf = newArea;
        }
        parentBuf[nextLabel] = nextLabel;
        labelBuf[idx] = nextLabel;
        nextLabel++;
      }
    }
  }

  // Auflösen der Labels auf Wurzeln + Flächen zählen
  for (let i = 0; i < nextLabel; i++) areaBuf[i] = 0;
  for (let i = 0; i < size; i++) {
    const l = labelBuf[i];
    if (l) {
      const root = findRoot(l);
      labelBuf[i] = root;
      areaBuf[root]++;
    }
  }

  // Phase 3: Größenfilter + Highlight schreiben
  // Tropfengröße 0..100: schmaler bis breiter erlaubter Bereich
  // Annahme ~50 cm Smartphone-Höhe: 1 mm ≈ 3 px → typische Tropfenflächen ≈ 5..3000 px²
  const minArea = Math.max(4, Math.round(40 - (dropSize / 100) * 36));
  const maxArea = Math.round(800 + (dropSize / 100) * 9200);

  const [hlR, hlG, hlB] = HIGHLIGHT_COLORS[highlightColor];
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const root = labelBuf[p];
    if (!root) continue;
    const area = areaBuf[root];
    if (area < minArea || area > maxArea) continue;
    data[i] = hlR;
    data[i + 1] = hlG;
    data[i + 2] = hlB;
  }
}

function findRoot(label) {
  let r = label;
  while (parentBuf[r] !== r) r = parentBuf[r];
  // Pfadkompression
  let p = label;
  while (parentBuf[p] !== r) {
    const next = parentBuf[p];
    parentBuf[p] = r;
    p = next;
  }
  return r;
}

// ---------- Init ----------

loadSettings();
