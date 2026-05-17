# WaidBlick-Web

Web-App zur Schweiß-Erkennung im Live-Kamerabild — zugeschnitten auf das iPhone, läuft direkt im Safari.

Markiert rot/braun-rote Bereiche (potenzielles Blut auf Waldboden) mit **Cyan**, einer Farbe, die auch bei Rot-Grün-Schwäche maximal kontrastiert.

## Bedienung

1. App im Safari öffnen → **Start** tippen → Kamerazugriff erlauben
2. **Empfindlichkeit** mit dem Schieberegler anpassen:
   - links (0) = streng, nur kräftige Rot-Töne
   - rechts (100) = locker, auch dunklere/bräunlichere Töne (mehr Treffer, mehr Fehlalarme)
3. **Standbild** friert das Bild zur genaueren Betrachtung ein.

## Lokales Testen am Desktop

Reines HTML/JS — kein Build, keine Abhängigkeiten. Einfach in Chrome/Firefox/Safari öffnen.

Empfohlen: über einen lokalen HTTP-Server, weil `getUserMedia` auf `file://` blockiert wird:

```powershell
# Aus dem Projektordner heraus
cd c:\Projekte\WaidBlick-Web
python -m http.server 8000
# → http://localhost:8000 im Browser öffnen
```

`localhost` ist die einzige Origin, bei der Browser auch ohne HTTPS Kamerazugriff erlauben.

## Auf dem iPhone testen (Cloudflare-Tunnel)

Das iPhone braucht zwingend eine **HTTPS-URL**, sonst gibt Safari keinen Kamerazugriff frei. Schnellster Weg: lokalen Server starten und über Cloudflare-Tunnel als HTTPS herausgeben.

**Einmalig: Cloudflared installieren** (Windows, PowerShell):

```powershell
winget install --id Cloudflare.cloudflared
```

**Jede Test-Sitzung:**

```powershell
# Terminal 1 — lokaler Server
cd c:\Projekte\WaidBlick-Web
python -m http.server 8000

# Terminal 2 — Tunnel
cloudflared tunnel --url http://localhost:8000
```

Cloudflared zeigt im Terminal eine URL wie `https://xyz-abc-123.trycloudflare.com`. Diese URL aufs iPhone übertragen (AirDrop / iMessage / Notiz), in Safari öffnen → **Start** tippen → Kamerazugriff erlauben.

Die URL ist nur für die Laufzeit dieses Tunnels gültig — bei jedem Neustart bekommst du eine neue.

## Später: dauerhafte Verteilung

- **GitHub Pages** — kostenlos, stabile URL, Repo muss public sein (oder GitHub Pro)
- **Netlify Drop** — Ordner per Drag & Drop hochladen, fertige HTTPS-URL
- **PWA-Installation** — auf dem iPhone in Safari: Teilen-Menü → „Zum Home-Bildschirm" → App-Icon erscheint, läuft im Vollbild ohne Adressleiste

## Bekannte Grenzen (Stand v1)

- **Reiner HSV-Filter** — schlägt auch bei roten Blättern (Buche, Eberesche), Hagebutten und manchen Pilzen an. Mit dem Slider kompensieren oder später durch ML-Modell ergänzen.
- **Helligkeit/Schatten** — bei sehr dunkler Dämmerung (üblicher Nachsuche-Zeitraum) wird der Filter ungenau. Taschenlampen-Steuerung über die Web-API funktioniert auf iOS erst ab iOS 17.
- **Performance** — pro Frame wird jeder Pixel in JS analysiert. Auf älteren iPhones rechne mit 15–25 fps statt 60.
- **Akku** — Dauerbetrieb von Kamera + Filter zehrt am Akku. Für längere Nachsuchen Powerbank mitnehmen.
- **PWA-Icons** — `manifest.webmanifest` enthält noch keine Icons; das Home-Bildschirm-Icon ist deshalb ein Screenshot. Wird beim ersten Branding-Schritt nachgezogen.

## Projektstruktur

```
WaidBlick-Web/
├── index.html               # UI: Video, Canvas, Slider, Buttons
├── style.css                # Vollbild-Layout, iOS-Anpassungen
├── app.js                   # Kamera + HSV-Filter + Highlight
├── manifest.webmanifest     # PWA-Grundlage
└── README.md
```
