# Auswertung und Öffnen aus dem Hintergrund

Ziel: Die abgenommene iPhone-Auswertung zeigt Anzahl und Stunden gleichzeitig, gruppiert nach gespeichertem Namen, Farbe und Symbol. Der Bereitschafts-Link entfällt; Auszahlung, Zeitgutschrift und offene Angaben stehen am Dienst. Widget und App-Icon behalten beim warmen Öffnen die bestehende Navigation.

Nicht-Ziele: Änderungen an Tarifregeln, Auszahlungsbeträgen, nativen Widgets, SDK, Abhängigkeiten oder Wiederherstellung nach einem beendeten Prozess.

Plattform: iOS, bestehender Preview-/TestFlight-Build mit passender Runtime. Web/Android bleiben kompatibel.

Pakete und Dateiscope:

1. Auswertung: `src/engine/daily-summary.ts`, Auswertungsmetriken, Schichtkarte/-tabelle, Monats-/Jahresübersicht, Bereitschafts-Zeitdarstellung, bestehende Stundenroute sowie fokussierte Fach- und Komponententests. Bestehende Summen nach technischem Typ bleiben für andere Verbraucher erhalten; die Zuordnung zu Namen nutzt dieselbe Überlappungs- und Abwesenheitsberechnung.
2. Öffnen: `app/+native-intent.tsx`, kleiner Navigationshelfer und Tests. Nur bekannte eigene Öffnungs-/Widget-Links werden beim warmen Öffnen ignoriert; Konto-, Einladungs- und andere gezielte Links bleiben erhalten.

Abnahme: beide Metriken ohne Toggle; originale Symbole/Farben; benannte eigene Dienste; geteilte Dienste einmal zählen; identische Zeitgesamtsummen einschließlich Pausen/Überlappungen/Abwesenheiten; keine hervorgehobene Nullgutschrift bei Auszahlung; offene Angaben bleiben bearbeitbar; große Schrift bleibt lesbar; bestehende Ansicht/Zeitraum/Scrollposition über App-Icon und alte/neue Widget-Links erhalten.

Freigaben: Nutzer hat Umsetzung und OTA sowie alle zugehörigen Freigaben ausdrücklich erteilt. Keine nativen Änderungen erforderlich. Preview zuerst gemäß WORKFLOW.md; technische Veröffentlichung und iPhone-Abnahme getrennt dokumentieren. Git-Übernahme nur nach erfolgreicher PR-CI.
