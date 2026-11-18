# Sport- und Balance-Tagebuch

Statische Web-App ohne Build-Schritt und ohne externe Abhängigkeiten. Läuft direkt auf GitHub Pages oder lokal im Browser.

## Funktionen

- **Sport pro Tag:** Freitext für jeden Kalendertag (Sportart, Dauer, Distanz usw.).
- **Work-Life-Balance-Raute:** vier Bereiche (Körper, Leistung/Arbeit, Kontakt, Sinn) mit Ist- und Soll-Wert auf einer Skala von 0 bis 10. Eingabe per Klick oder Ziehen in der Raute oder über Regler. Optional eine Notiz pro Tag.
- **Eigene Namen für die vier Spitzen:** unter "Namen der Spitzen anpassen". Leere Felder nutzen die Standardnamen (Körper, Leistung/Arbeit, Kontakt, Sinn). Die Werte hängen an der Position (oben, rechts, unten, links), Umbenennen ändert also keine gespeicherten Werte. Bei einer umbenannten Spitze werden die Unterbegriffe aus der Vorlage ausgeblendet. Lange Namen (bis 30 Zeichen) werden in der Raute auf zwei Zeilen umbrochen bzw. verkleinert. Die Namen werden mit den Daten gespeichert und sind damit auch in Datei und Export enthalten.
- **Übersichtstabelle:** ein Eintrag pro Tag mit Sport, Ist/Soll je Bereich, Abstand und Mini-Raute. Filter nach Monat und Freitextsuche. Klick auf eine Zeile öffnet den Tag zum Bearbeiten.
- **Vorbelegung:** Ein neuer Tag übernimmt die Raute des letzten erfassten Tages als Startwert. Gespeichert wird erst mit "Speichern".
- **Export:** JSON (vollständige Sicherung) und CSV (Semikolon, UTF-8 mit BOM, öffnet direkt in Excel mit deutschen Einstellungen).

"Abstand" ist die Summe der Beträge |Ist minus Soll| über alle vier Bereiche (0 bis 40). 0 bedeutet: Ist entspricht in allen Bereichen dem Soll.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Seitenstruktur |
| `style.css` | Layout, helles und dunkles Farbschema |
| `app.js` | Logik, Raute (SVG), Persistenz |
| `favicon.svg` | Icon im Browser-Tab |
| `manifest.webmanifest` | Name, Farben und Icons für die Home-Bildschirm-App |
| `icon-180.png`, `icon-192.png`, `icon-512.png` | App-Icons (iPhone, Android) |
| `.nojekyll` | verhindert die Jekyll-Verarbeitung auf GitHub Pages |
| `.gitignore` | hält exportierte Daten aus dem Repository fern |

## Lokal starten

Einfach `index.html` im Browser öffnen. Für die Funktion "Datei verbinden" ist ein sicherer Kontext nötig; am zuverlässigsten über einen lokalen Server:

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

## Auf GitHub Pages veröffentlichen

1. Neues Repository auf GitHub anlegen. Mit GitHub Free muss das Repository öffentlich sein; Pages aus privaten Repositories setzt GitHub Pro, Team oder Enterprise voraus.
2. Dateien hochladen:

   ```bash
   git init
   git add .
   git commit -m "Sport- und Balance-Tagebuch"
   git branch -M main
   git remote add origin git@github.com:<benutzer>/<repo>.git
   git push -u origin main
   ```

3. Im Repository unter **Settings > Pages** bei "Build and deployment" die Quelle **Deploy from a branch** wählen, Branch `main`, Ordner `/ (root)`, speichern.
4. Nach ein bis zwei Minuten ist die App unter `https://<benutzer>.github.io/<repo>/` erreichbar.

Die Seite selbst ist öffentlich erreichbar, die eingegebenen Daten aber nicht: Sie verlassen den Browser nie.

## Datenspeicherung

GitHub Pages liefert nur statische Dateien aus und kann nichts speichern. Die Daten liegen deshalb ausschließlich auf dem Gerät:

1. **Browser-Speicher (immer aktiv):** `localStorage`, Schlüssel `sport-balance-tagebuch.v1`. Jede Speicherung landet sofort dort.
2. **Lokale JSON-Datei (optional, nur Chrome, Edge, Opera am Desktop):** Über "Neue Datei anlegen" oder "Datei öffnen" wird eine Datei verbunden. Ab dann wird jede Änderung zusätzlich direkt in diese Datei geschrieben. Die App merkt sich die Datei; nach einem Browser-Neustart reicht ein Klick auf "wieder verbinden", weil der Browser die Schreiberlaubnis aus Sicherheitsgründen erneut abfragt.
3. **Export/Import JSON (alle Browser):** manuelle Sicherung bzw. Übertragung auf ein anderes Gerät.

Beim Verbinden einer Datei und beim Import werden die Stände **zusammengeführt**, nicht überschrieben: pro Tag und pro Bereich (Sport, Balance) gewinnt der neuere Zeitstempel. Gelöschte Einträge bleiben als Löschmarker erhalten, damit sie durch einen älteren Import nicht wieder auftauchen. Eine Datei, die kein gültiges Format dieser App hat, wird nicht verändert.

### Datenformat

```json
{
  "app": "sport-balance-tagebuch",
  "version": 1,
  "savedAt": "2026-11-18T20:41:00.000Z",
  "settings": {
    "labels": { "koerper": "Gesundheit & Schlaf", "sinn": "Werte" },
    "updatedAt": 1795035512112
  },
  "entries": {
    "2026-11-17": {
      "sport": { "text": "Laufen 8 km, 45 min", "updatedAt": 1795034880020 },
      "mood": {
        "ist":  { "koerper": 8, "leistung": 3, "kontakt": 6, "sinn": 5 },
        "soll": { "koerper": 5, "leistung": 5, "kontakt": 5, "sinn": 9 },
        "notiz": "Stressige Woche",
        "updatedAt": 1795034880269
      }
    },
    "2026-11-10": {
      "sport": { "deleted": true, "updatedAt": 1795030000000 }
    }
  }
}
```

`updatedAt` ist ein Unix-Zeitstempel in Millisekunden. Das Datum ist der lokale Kalendertag des Geräts.

Die Schlüssel `koerper`, `leistung`, `kontakt`, `sinn` sind interne Positionskennungen (oben, rechts, unten, links) und bleiben auch bei eigenen Namen gleich. `settings` ist optional; fehlt es oder fehlt ein Name, gilt der Standardname. Beim Zusammenführen gewinnt der neuere `settings`-Stand als Ganzes.

## iPhone und iPad

1. Die Seite in Safari öffnen, unten auf "Teilen" tippen, "Zum Home-Bildschirm" wählen.
2. Die App ab dann nur noch über das Symbol auf dem Home-Bildschirm starten.

Warum: In einem normalen Safari-Tab löscht iOS den Speicher einer Website, wenn sie an sieben Tagen der Safari-Nutzung nicht besucht wurde. Apps auf dem Home-Bildschirm haben einen eigenen Zähler, der durch die Nutzung der App selbst zurückgesetzt wird. Die Home-Bildschirm-App hat einen eigenen Speicher; Daten aus einem Safari-Tab vorher exportieren und in der App importieren.

Sicherung: "Export JSON" öffnet auf iPhone/iPad das Teilen-Menü, dort "In Dateien sichern" (z. B. iCloud Drive). "Import JSON" liest die Datei wieder ein. Die Statuszeile zeigt das Datum der letzten Sicherung und wird nach 14 Tagen ohne Sicherung farbig markiert.

## Einschränkungen

- **Direktes Schreiben in eine Datei** funktioniert nur in Chromium-Browsern am Desktop. Firefox und Safari unterstützen die File System Access API nicht; dort bleiben Browser-Speicher plus Export/Import.
- **Browser-Speicher ist an Browser, Profil und Origin gebunden.** Alle Projektseiten unter `https://<benutzer>.github.io/` teilen sich denselben Origin; der Schlüssel ist deshalb eindeutig benannt. Werden Browserdaten gelöscht, sind auch die Einträge weg. Eine verbundene Datei oder ein regelmäßiger Export dient als Sicherung.
- **Zusammenführen nach Zeitstempel** setzt voraus, dass die Uhren der beteiligten Geräte ungefähr stimmen. Wird derselbe Tag auf zwei Geräten mit stark abweichender Uhr bearbeitet, kann der fachlich ältere Stand gewinnen.
- **Keine Synchronisation** zwischen Geräten. Wer die JSON-Datei in einen Cloud-Ordner legt, kann sie auf einem zweiten Rechner mit "Datei öffnen" verbinden; gleichzeitiges Bearbeiten auf zwei Geräten ist nicht abgesichert.
- **Exportierte Daten nicht in ein öffentliches Repository committen.** Die `.gitignore` schließt die Standard-Dateinamen aus.
