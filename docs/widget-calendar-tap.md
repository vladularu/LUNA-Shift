# Widget-Tipp öffnet den Kalender

Ziel: Jeder Tipp auf ein iPhone-Widget öffnet die Kalender-Startseite. Gespeicherte ältere Links dürfen weder Tagesdetails öffnen noch den Monat des angetippten Tages aktivieren.

Nicht-Ziele: Native Widget-Darstellung, Kalenderfoto, Schicht-/Personenfarben, geteilte Inhalte und deren Datenschutz, Gehaltslogik. Die ruhigere Anordnung von Abständen, Überlaufanzeigen und Legende braucht eine geänderte Swift-Erweiterung und bleibt wegen der Vorgabe ohne neuen Build zurückgestellt. Das Kalenderfoto soll laut Nutzer auch im Widget bleiben.

Plattform: iOS, vorhandener TestFlight-Build 6, Expo SDK 57.

Dateiscope: `src/features/widgets/widget-day-screen.tsx`, `widget-day-screen.component.test.tsx`, `calendar-widget-data.ts`, `calendar-widget-data.test.ts`, `shared-widget-data.test.ts` sowie diese Aufgabenbeschreibung.

Abnahmekriterien:

- Alle Tage der kleinen, Wochen- und Monatsansicht verwenden das globale Kalenderziel des jeweiligen Timeline-Eintrags, auch über Monats- und Jahreswechsel hinweg.
- Bereits gespeicherte `/widget-day?date=...`-Links werden direkt zum Kalender umgeleitet. Gültige, fehlende und fehlerhafte Datumswerte öffnen keine Tagesdetails und verändern keinen aktiven Monat anhand des Tages.
- Kalenderfoto, Widget-Darstellung und Schicht-/Freigabedaten bleiben erhalten.
- Fokussierte Tests, `verify:fast` und der isolierte Widget-Runtime-Check bestehen. Die iOS-Produktions-Fingerprint muss weiter zum installierten Build 6 passen.
- Auf dem iPhone anschließend alte und frisch aktualisierte Widgets bei geschlossener und bereits geöffneter App antippen; keine Tagesdetailseite oder blockierte Navigation. Dieser Gerätenachweis steht bis zur Verteilung und Rückmeldung aus.

Commit, Push, PR, Merge, OTA und neuer nativer Build sind für diese Folgeänderung nicht freigegeben.

Vor einer später freigegebenen Produktions-OTA muss der bereits separat veröffentlichte Netto-Jahreseinrichtungs-Fix aus dem aktuellen Produktionsstand erhalten bleiben; dieser Branch ändert dessen unabhängigen Worktree nicht.
