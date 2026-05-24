# ONNX Runtime Web (lokal)

Damit die App auch ohne Internet funktioniert (Wald-Einsatz), liegt die Inferenz-Runtime hier lokal — statt von einem CDN nachgeladen zu werden.

**Erwartete Dateien:**
- `ort.min.js` (~440 KB) — JavaScript-Entry
- `ort-wasm-simd-threaded.mjs` (~25 KB) — Wasm-Loader-Modul (zur Laufzeit dynamisch von ort.min.js geladen)
- `ort-wasm-simd-threaded.wasm` (~11 MB) — Wasm-Backend mit SIMD

Alle drei sind per `.gitignore` ausgeschlossen.

## So lädst du sie herunter

```powershell
cd C:\Projekte\WaidBlick-Web\public\lib\ort

curl -O https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/ort.min.js
curl -O https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/ort-wasm-simd-threaded.mjs
curl -O https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/ort-wasm-simd-threaded.wasm
```

Bei Versions-Updates die `@1.20.0` entsprechend anpassen. Wichtig: `ort.min.js` und `.wasm` müssen aus **derselben Version** stammen.
