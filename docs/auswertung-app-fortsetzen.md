# Auswertung und Öffnen aus dem Hintergrund

Ziel: Die abgenommene iPhone-Auswertung zeigt Anzahl und Stunden gleichzeitig, gruppiert nach gespeichertem Namen, Farbe und Symbol. Der Bereitschafts-Link entfällt; Auszahlung, Zeitgutschrift und offene Angaben stehen am Dienst. Widget und App-Icon behalten beim warmen Öffnen die bestehende Navigation und stellen nach einem beendeten Prozess die letzte sichere Ansicht samt Zeitraum wieder her. Die Auswertung merkt sich auch ihre Scrollposition.

Nicht-Ziele: Änderungen an Tarifregeln, Auszahlungsbeträgen, nativen Widgets, SDK, Abhängigkeiten oder ungespeicherten Formularentwürfen.

Plattform: iOS, bestehender Preview-/TestFlight-Build mit passender Runtime. Web/Android bleiben kompatibel.

Pakete und Dateiscope:

1. Auswertung: `src/engine/daily-summary.ts`, Auswertungsmetriken, Schichtkarte/-tabelle, Monats-/Jahresübersicht, Bereitschafts-Zeitdarstellung, bestehende Stundenroute sowie fokussierte Fach- und Komponententests. Bestehende Summen nach technischem Typ bleiben für andere Verbraucher erhalten; die Zuordnung zu Namen nutzt dieselbe Überlappungs- und Abwesenheitsberechnung.
2. Sollzeit-Text: Monats-/Stunden- und Jahresübersicht nennen die Berechnungsgrundlage statt eines pauschalen Vorläufig-Hinweises. Echte fehlende Angaben bleiben konkret sichtbar; der Rechenkern und sämtliche Werte bleiben unverändert.
3. Öffnen: `app/+native-intent.tsx`, Navigationshelfer, sichere lokale Speicherung über das bereits installierte SecureStore, Root-Checkpoint und Tests. Nur bekannte eigene Öffnungs-/Widget-Links werden beim warmen Öffnen ignoriert; Konto-, Einladungs- und andere gezielte Links bleiben erhalten. Bei Kaltstart wird nur eine erlaubte Ansicht mit validierten Anzeigeparametern wiederhergestellt. Editor-, Auth- und Einladungsdaten werden nicht gespeichert.

Abnahme: beide Metriken ohne Toggle; originale Symbole/Farben; benannte eigene Dienste; geteilte Dienste einmal zählen; identische Zeitgesamtsummen einschließlich Pausen/Überlappungen/Abwesenheiten; keine hervorgehobene Nullgutschrift bei Auszahlung; offene Angaben bleiben erkennbar; keine aufklappbaren Schichtzeilen; große Schrift bleibt lesbar; bestehende Ansicht/Zeitraum/Scrollposition über App-Icon und alte/neue Widget-Links erhalten.

Freigaben: Nutzer hat Umsetzung und OTA sowie alle zugehörigen Freigaben ausdrücklich erteilt. Keine nativen Änderungen erforderlich. Preview zuerst gemäß WORKFLOW.md; technische Veröffentlichung und iPhone-Abnahme getrennt dokumentieren. Git-Übernahme nur nach erfolgreicher PR-CI.
