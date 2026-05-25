# Modelle

In diesem Ordner liegt das trainierte ML-Modell, das die App im Browser für die Schweiß-Erkennung nutzt.

**Erwartete Datei:** `best.onnx` (ca. 12 MB)

Die Datei selbst ist per `.gitignore` ausgeschlossen — sie wird im **WaidBlick-ML**-Projekt trainiert und exportiert.

## So bekommst du sie hierher

Nach einem Trainings-Lauf in [WaidBlick-ML](../../../WaidBlick-ML) liegt das Modell unter:
```
C:\Projekte\WaidBlick-ML\models\best.onnx
```

Einfach von dort hierher kopieren:
```powershell
Copy-Item C:\Projekte\WaidBlick-ML\models\best.onnx C:\Projekte\WaidBlick-Web\public\models\
```
