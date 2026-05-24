// WaidBlick — Schweiß-Erkennung im Live-Kamerabild
// Zwei Modi: HSV (klassischer Farbfilter mit Größenfilter) und ML (trainiertes YOLOv8-Modell)

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
const settingsSensitivitySlider = document.getElementById("settings-sensitivity");
const settingsSensitivityDisplay = document.getElementById("settings-sensitivity-display");
const colorToggle = document.getElementById("color-toggle");
const modeToggle = document.getElementById("mode-toggle");
const statusEl = document.getElementById("status");
const fpsEl = document.getElementById("fps");

const STORAGE_KEY = "waidblick.settings.v2";

const DEFAULT_SETTINGS = Object.freeze({
  sensitivity: 50,
  dropSize: 50,
  color: "cyan",
  mode: "hsv",
});

const HIGHLIGHT_COLORS = {
  cyan: [0, 255, 255],
  yellow: [255, 255, 0],
};

const MODEL_URL = "models/best.onnx";
const ML_INPUT_SIZE = 640;
const ML_CONF_THRESH = 0.25;
const ML_IOU_THRESH = 0.45;

let stream = null;
let running = false;
let frozen = false;
let lastFrameTs = 0;
let fpsSmoothed = 0;
let highlightColor = DEFAULT_SETTINGS.color;
let detectionMode = DEFAULT_SETTINGS.mode;
let savedSettings = { ...DEFAULT_SETTINGS };

// HSV-Buffer für Connected-Component-Analyse
let maskBuf = null;
let labelBuf = null;
let parentBuf = null;
let areaBuf = null;

// ML-State
let mlSession = null;
let mlLoaded = false;
let mlLoading = false;
let mlLoadError = null;
let latestMLBoxes = [];
let mlInferenceInFlight = false;
let preprocessCanvas = null;
let preprocessCtx = null;

// ---------- Persistenz ----------

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (typeof s.sensitivity === "number") savedSettings.sensitivity = clamp(s.sensitivity, 0, 100);
      if (typeof s.dropSize === "number") savedSettings.dropSize = clamp(s.dropSize, 0, 100);
      if (s.color && HIGHLIGHT_COLORS[s.color]) savedSettings.color = s.color;
      if (s.mode === "hsv" || s.mode === "ml") savedSettings.mode = s.mode;
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
  applySensitivityToUI(s.sensitivity);
  dropSizeSlider.value = s.dropSize;
  dropSizeValue.textContent = s.dropSize;
  setHighlightColor(s.color);
  setMode(s.mode);
}

function applySensitivityToUI(value) {
  slider.value = value;
  settingsSensitivitySlider.value = value;
  sliderValue.textContent = value;
  settingsSensitivityDisplay.textContent = value;
}

function getCurrentSettings() {
  return {
    sensitivity: parseInt(slider.value, 10),
    dropSize: parseInt(dropSizeSlider.value, 10),
    color: highlightColor,
    mode: detectionMode,
  };
}

function settingsEqual(a, b) {
  return a.sensitivity === b.sensitivity &&
         a.dropSize === b.dropSize &&
         a.color === b.color &&
         a.mode === b.mode;
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

function setMode(name) {
  if (name !== "hsv" && name !== "ml") return;
  detectionMode = name;
  modeToggle.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === name);
  });
  if (name === "ml" && !mlLoaded && !mlLoading) {
    loadMLModel();
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ---------- ML-Modell laden + Inferenz ----------

async function loadMLModel() {
  if (mlLoaded || mlLoading) return;
  mlLoading = true;
  mlLoadError = null;
  updateMLStatus();

  try {
    if (typeof ort === "undefined") {
      throw new Error("ONNX Runtime nicht geladen — fehlt lib/ort/ort.min.js?");
    }
    // Absolute URL nötig: ORT 1.20 löst wasmPaths relativ zu ort.min.js auf, nicht zur Seite
    ort.env.wasm.wasmPaths = new URL("./lib/ort/", document.baseURI).href;
    // Single-Threaded erzwingen: SharedArrayBuffer braucht COOP/COEP-Header,
    // die Cloudflare-Tunnel + python http.server nicht setzen. Ohne den Hint
    // hängt InferenceSession.create() bei der Thread-Initialisierung.
    ort.env.wasm.numThreads = 1;
    mlSession = await ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ["wasm"],
    });
    console.log("ML-Modell geladen.", {
      inputs: mlSession.inputNames,
      outputs: mlSession.outputNames,
    });
    mlLoaded = true;
  } catch (err) {
    console.error("ML-Modell-Ladefehler:", err);
    mlLoadError = err.message || String(err);
  } finally {
    mlLoading = false;
    updateMLStatus();
  }
}

function updateMLStatus() {
  if (detectionMode !== "ml") return;
  if (mlLoadError) {
    statusEl.textContent = "ML-Fehler: " + mlLoadError;
  } else if (mlLoading) {
    statusEl.textContent = "ML-Modell wird geladen …";
  } else if (mlLoaded && running) {
    statusEl.textContent = `Live (ML) — ${video.videoWidth}×${video.videoHeight}`;
  }
}

function preprocessFrame(sourceCanvas, targetSize = ML_INPUT_SIZE) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const scale = targetSize / Math.max(w, h);
  const newW = Math.round(w * scale);
  const newH = Math.round(h * scale);
  const padX = Math.floor((targetSize - newW) / 2);
  const padY = Math.floor((targetSize - newH) / 2);

  if (!preprocessCanvas) {
    preprocessCanvas = document.createElement("canvas");
    preprocessCanvas.width = targetSize;
    preprocessCanvas.height = targetSize;
    preprocessCtx = preprocessCanvas.getContext("2d", { willReadFrequently: true });
  }

  preprocessCtx.fillStyle = "rgb(114, 114, 114)";
  preprocessCtx.fillRect(0, 0, targetSize, targetSize);
  preprocessCtx.drawImage(sourceCanvas, 0, 0, w, h, padX, padY, newW, newH);

  const imgData = preprocessCtx.getImageData(0, 0, targetSize, targetSize);
  const data = imgData.data;
  const numPixels = targetSize * targetSize;

  // RGBA-HWC zu RGB-CHW, normalisiert auf 0..1
  const tensorData = new Float32Array(3 * numPixels);
  for (let i = 0; i < numPixels; i++) {
    tensorData[i] = data[i * 4] / 255;
    tensorData[numPixels + i] = data[i * 4 + 1] / 255;
    tensorData[2 * numPixels + i] = data[i * 4 + 2] / 255;
  }

  return { tensorData, scale, padX, padY };
}

async function runMLInference(sourceCanvas) {
  const { tensorData, scale, padX, padY } = preprocessFrame(sourceCanvas);

  const inputName = mlSession.inputNames[0];
  const outputName = mlSession.outputNames[0];

  const inputTensor = new ort.Tensor("float32", tensorData, [1, 3, ML_INPUT_SIZE, ML_INPUT_SIZE]);
  const feeds = { [inputName]: inputTensor };

  const results = await mlSession.run(feeds);
  const output = results[outputName];

  return parseYOLO(output, scale, padX, padY);
}

function parseYOLO(output, scale, padX, padY) {
  const data = output.data;
  const dims = output.dims;
  // YOLOv8: [1, 4+nc, num_anchors] für unsere 1 Klasse = [1, 5, 8400]
  const numFeatures = dims[1];
  const numAnchors = dims[2];
  const confIdx = numFeatures - 1;

  const boxes = [];
  for (let i = 0; i < numAnchors; i++) {
    const conf = data[confIdx * numAnchors + i];
    if (conf < ML_CONF_THRESH) continue;

    const cx = data[i];
    const cy = data[numAnchors + i];
    const bw = data[2 * numAnchors + i];
    const bh = data[3 * numAnchors + i];

    // 640x640-Pixel-Raum, Mittelpunkt+Größe -> Ecken
    let x1 = cx - bw / 2;
    let y1 = cy - bh / 2;
    let x2 = cx + bw / 2;
    let y2 = cy + bh / 2;

    // Letterbox-Padding herausrechnen, auf Original-Bildgröße zurückskalieren
    x1 = (x1 - padX) / scale;
    y1 = (y1 - padY) / scale;
    x2 = (x2 - padX) / scale;
    y2 = (y2 - padY) / scale;

    boxes.push({ x1, y1, x2, y2, conf });
  }

  boxes.sort((a, b) => b.conf - a.conf);

  // Greedy NMS
  const keep = [];
  for (const box of boxes) {
    let suppress = false;
    for (const kept of keep) {
      if (iou(box, kept) > ML_IOU_THRESH) {
        suppress = true;
        break;
      }
    }
    if (!suppress) keep.push(box);
  }
  return keep;
}

function iou(a, b) {
  const xx1 = Math.max(a.x1, b.x1);
  const yy1 = Math.max(a.y1, b.y1);
  const xx2 = Math.min(a.x2, b.x2);
  const yy2 = Math.min(a.y2, b.y2);
  const w = Math.max(0, xx2 - xx1);
  const h = Math.max(0, yy2 - yy1);
  const inter = w * h;
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  return inter / (areaA + areaB - inter);
}

function drawMLBoxes(targetCtx, boxes) {
  if (!boxes.length) return;
  const [r, g, b] = HIGHLIGHT_COLORS[highlightColor];
  const color = `rgb(${r}, ${g}, ${b})`;

  targetCtx.strokeStyle = color;
  targetCtx.lineWidth = Math.max(3, Math.round(canvas.width / 250));
  const fontSize = Math.max(16, Math.round(canvas.width / 60));
  targetCtx.font = `bold ${fontSize}px sans-serif`;
  targetCtx.textBaseline = "alphabetic";

  for (const box of boxes) {
    const w = box.x2 - box.x1;
    const h = box.y2 - box.y1;
    targetCtx.strokeRect(box.x1, box.y1, w, h);

    const label = `${(box.conf * 100).toFixed(0)}%`;
    const textW = targetCtx.measureText(label).width;
    targetCtx.fillStyle = color;
    targetCtx.fillRect(box.x1, box.y1 - fontSize - 6, textW + 10, fontSize + 6);
    targetCtx.fillStyle = "black";
    targetCtx.fillText(label, box.x1 + 5, box.y1 - 6);
  }
}

// ---------- Event-Bindings ----------

slider.addEventListener("input", () => {
  applySensitivityToUI(slider.value);
  updateDirtyIndicator();
});

settingsSensitivitySlider.addEventListener("input", () => {
  applySensitivityToUI(settingsSensitivitySlider.value);
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

modeToggle.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-mode]");
  if (!btn) return;
  setMode(btn.dataset.mode);
  updateDirtyIndicator();
  updateMLStatus();
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
  applySensitivityToUI(slider.value);
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
    if (detectionMode === "ml") {
      updateMLStatus();
    } else {
      statusEl.textContent = `Live (HSV) — ${video.videoWidth}×${video.videoHeight}`;
    }
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

    if (detectionMode === "hsv") {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      applyBloodFilter(
        imageData.data,
        canvas.width,
        canvas.height,
        parseInt(slider.value, 10),
        parseInt(dropSizeSlider.value, 10),
      );
      ctx.putImageData(imageData, 0, 0);
    } else if (detectionMode === "ml") {
      // Zeichne die letzte (möglicherweise leicht veraltete) Box-Liste auf das frische Frame
      drawMLBoxes(ctx, latestMLBoxes);
      // Neue Inferenz im Hintergrund (sofern nicht eine schon läuft)
      if (mlLoaded && !mlInferenceInFlight) {
        mlInferenceInFlight = true;
        runMLInference(canvas)
          .then((boxes) => { latestMLBoxes = boxes; })
          .catch((err) => { console.error("ML-Inferenz-Fehler:", err); })
          .finally(() => { mlInferenceInFlight = false; });
      }
    }

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

// ---------- HSV-Filter (unverändert von vorher) ----------

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

  for (let i = 0; i < nextLabel; i++) areaBuf[i] = 0;
  for (let i = 0; i < size; i++) {
    const l = labelBuf[i];
    if (l) {
      const root = findRoot(l);
      labelBuf[i] = root;
      areaBuf[root]++;
    }
  }

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
  let p = label;
  while (parentBuf[p] !== r) {
    const next = parentBuf[p];
    parentBuf[p] = r;
    p = next;
  }
  return r;
}

// ---------- Service Worker für Offline-Nutzung ----------

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js")
      .then((reg) => console.log("Service Worker registriert:", reg.scope))
      .catch((err) => console.warn("Service Worker konnte nicht registriert werden:", err));
  });
}

// ---------- Init ----------

loadSettings();
