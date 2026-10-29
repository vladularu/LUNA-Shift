# Kurzer Ruecklauf zu Heute

## Auftrag

Bei einem Abstand von einem oder zwei Kalendermonaten soll „Heute“ die
Monatsseiten sichtbar zuruecklaufen lassen. Die abschliessende Nutzerregel
„Ab 3 Monate Instant zurueck“ definiert die Grenze: genau drei und mehr Monate
springen direkt. Dies gilt in beide Richtungen, auch ueber Dezember/Januar.

Ziel: iPhone-Kalender unter Expo SDK 57 (`~57.0.31`). Branch:
`codex/kalender-heute-ruecklauf`, Ausgangsbasis PR #336 / `5727449`.
Scope: Today-Steuerung, nativer Pager, Kalender-Screen, Monatsabstandsregel und
die zugehoerigen Tests. Neun Dateien einschliesslich dieser Dokumentation.
Keine Aenderung an Kalendergestaltung, Fachlogik, Daten oder nativer Konfiguration.
Die bisherige Git-/TestFlight-Lieferung betraf den bereits abgeschlossenen
Monatswechsel. Mit „Ja ota“ wurde fuer diese neue Verhaltensaenderung die
iPhone-Preview-OTA freigegeben. Git-/TestFlight-Lieferung bleiben eigene Schritte.

## Verhalten und Abnahme

- 1–2 Monate: derselbe native ScrollView bewegt Monatsname und Tage gemeinsam.
  Start, Zwischenmonat und Ziel sind vor dem Animationsstart vorbereitet.
- 0 oder mindestens 3 Monate: direkter Sprung. Jahresansicht, fehlende
  Pager-Bereitschaft und „Bewegung reduzieren“ verwenden ebenfalls den Sprung.
- Die angeforderte Pager-Revision kennzeichnet nur diesen Today-Vorgang.
  Andere Navigation bleibt direkt. Abbruch, erneutes Tippen und neue
  Fenstergroesse koennen keine alte Bewegung uebernehmen.
  Ein danach neu gewaehlter Monat hat Vorrang vor dem alten Today-Ziel.
- Abschluss beim nativen Positionsereignis am Ziel; Zwischenpositionen und
  alte Momentum-Ereignisse bestaetigen Today nicht. Keine zweite Animationsuhr.
- Der native Fallback greift erst nach 1,5 Sekunden ein; der bisherige
  200-ms-Layout-Retry unterbricht die beabsichtigte Bewegung nicht.
- Beim Tabwechsel wird eine noch laufende Bewegung direkt positioniert. Die
  Today-Anfrage wird nach Rueckkehr bestaetigt; fremde Tabs bleiben unabhaengig.

Fokussierte Pruefung: beide Richtungen, Abstaende 0/1/2/3 und grosse Spruenge,
Jahresgrenze, wiederholtes Today, Jahresansicht, Reduce Motion, alte Ereignisse,
verlorene Animation, Groessenaenderung und neue Navigation waehrend des Ruecklaufs.

## Pruefergebnis vom 29.10.2026

- Fokussierte Unit- und Komponentenpruefungen bestanden, einschliesslich der
  sechs Screen-Integrationsfaelle fuer ein, zwei und drei Monate in beide Richtungen.
- `VITEST_MAX_WORKERS=1 npm.cmd run verify:fast`: Exit 0. Typpruefung, Lint und
  Formatpruefung gruen; 511 Vitest-Dateien mit 9.911 Tests, 166 Jest-Suites mit
  1.581 Tests sowie alle zusaetzlichen Skriptpruefungen bestanden.
- Vollstaendiges lokales Protokoll:
  `artifacts/calendar-today-return/verify-fast-complete.log`.
- `git diff --check` bestanden; nur die neun beauftragten Dateien geaendert.
- Reale iPhone-Sichtpruefung bleibt offen. Neuer Commit und Push sind fuer
  diese Aenderung noch nicht erfolgt.

## Freigegebene iPhone-Preview-OTA

Veroeffentlicht am 29.10.2026 um 20:45 Uhr (Berlin):

- Kanal/Branch und Environment `preview`, `APP_VARIANT=internal`, nur iOS.
- Update-Gruppe `9a37a2ac-ea18-4d8a-bb34-03487680853e`, Update-ID
  `01a18932-0362-7174-904d-7bdab2b60792`.
- Runtime `b99c3cf0dd56e6b1bb126d195f21c665de57760b`, passend zu Preview
  Build 44 (`812ea1a9-a4c0-48f3-b01a-72011cdad43e`).
- Grundlage war die zuletzt veroeffentlichte Preview-Gruppe
  `8479558c-deda-4817-9612-5e171d7d5690`. Alle 2.227 Dateien ausserhalb der
  acht geaenderten Kalenderdateien bleiben identisch; die Dokumentation ist neu.
  Profilbild und Rufbereitschaft bleiben dadurch im Preview-Bundle enthalten.
- Der isolierte Exportstand besteht die Typpruefung und alle 74 Tests der drei
  betroffenen Kalender-Komponentensuites. Die native Runtime wurde vor Export
  und Veroeffentlichung abgeglichen.
- Manifest und Bundle liefern HTTP 200. Lokales Export-Bundle und CDN-Bundle
  sind identisch: 12.325.028 Bytes, SHA-256
  `04890b039c2a73a93eba0b8dc85358d4f106f923b2197c93a8bfb7a0ecbf03b3`.
  Alle 52 Manifest-Assets passen ebenfalls zum Export; 2.236 Quelldateien
  blieben zwischen Export und Auslieferungspruefung unveraendert.
- Nachweise: `artifacts/calendar-today-return/preview-preservation.json`,
  `preview-published.json`, `preview-delivery-verification.json`,
  `preview-export.log` und `preview-components.log`.

Geraeteabnahme: Preview-App vollstaendig schliessen, oeffnen und 15 Sekunden
warten, erneut schliessen und oeffnen. Danach Today aus einem und zwei Monaten
Abstand sichtbar zuruecklaufen lassen; bei genau drei Monaten den direkten
Sprung pruefen. Reale iPhone-Bestaetigung steht aus.

SDK-Referenz: [Expo SDK 57 Reanimated](https://docs.expo.dev/versions/v57.0.0/sdk/reanimated/).

## Spaetere Abnahme und Lieferfreigabe

Der kurze Heute-Ruecklauf wurde in der Preview bestaetigt und blieb Teil der
spaeteren Monatswechsel-Verfeinerungen. Am 30.10.2026 hat der Nutzer die aktuelle
Kalender-Preview `e012595e-980a-4fb7-a73b-e414447ebd97` bestaetigt und Commit,
Push, PR, Merge und TestFlight-OTA fuer den gemeinsamen Kalenderstand freigegeben.
Der aktuelle Lieferauftrag und dessen Abgrenzung sind in
`docs/calendar-scroll-smooth.md` dokumentiert; die obigen offenen Liefergates
beschreiben den historischen Stand dieser ersten Heute-Preview.
