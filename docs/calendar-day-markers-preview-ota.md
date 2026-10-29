# Kalender-Markierungen als iOS-Preview-OTA

Freigabe vom 29. Oktober 2026: Kalenderänderungen für Preview veröffentlichen;
die neuen Widget-Markierungen bleiben pausiert. Git-Lieferung, nativer Build und
Production/TestFlight sind nicht freigegeben.

Ziel: Transparente warme Markierungen für Feiertage und Tarif-Sondertage,
dezente neutrale Wochenendspalten einschließlich Kopfzeile. Namenszeilen im
Monatsraster entfallen; vollständige Namen im Tagesmenü und für VoiceOver bleiben.

Zielplattform: iOS/internal, Preview Build 44, Branch/Kanal/Environment preview,
APP_VARIANT=internal, LUNA_DESIGN_SANDBOX=0. Erwartete unveränderte Runtime:
b99c3cf0dd56e6b1bb126d195f21c665de57760b.

## Bestehenden Preview-Stand erhalten

Die zuletzt veröffentlichte Gruppe
5bb237e3-30b7-4560-8ede-f33bec41e109 bildet die Grundlage. Dazu wurden alle
1.867 erfassten Quell-/Konfigurationsdateien gegen deren eingefrorene SHA-256-Werte
geprüft und unverändert übernommen. Die vorhandenen Popup-, Regler-, Deckkraft-
und Vorschau-Korrekturen bleiben damit enthalten.

Das Kalender-Paket ergänzt ausschließlich:

- calendar-prototype-canvas.tsx und month-card.tsx;
- theme/calendar-day-tints.ts;
- deren Kalender-Komponententests sowie die Schriftgrößen-Richtlinienprüfung.

Insgesamt neun Dateien unterscheiden sich dadurch vom bisherigen Preview.
29 Widget-/Plugin-/Native-/Paketdateien wurden zusätzlich bytegleich gegen die
Baseline geprüft. Die separat gespeicherten neuen Widget-Markierungen bleiben
im ursprünglichen Worktree calendar-day-markers vollständig erhalten.

Nicht-Ziele: Daten, Berechnungen, Tarifregeln, Schichtfarben und native
Konfiguration ändern. Die übernommenen Einstellungs-/Cloud-Dateien sind bereits
Teil der veröffentlichten Preview und kein zusätzlicher Änderungsscope.

## Prüf- und Veröffentlichungsnachweise

Nachweise werden unter artifacts/calendar-day-markers-preview/ gespeichert:
Baseline-Hashes, Kalender-Overlay, Widget-/Native-Parität, Tests, beide
Fingerprint-Vergleiche, iOS-Export, EAS-Metadaten sowie Manifest-/CDN-Bundle-Abgleich.

Vor Veröffentlichung wird der Preview-Kanal erneut geprüft, damit kein
zwischenzeitlich veröffentlichtes Update verdrängt wird. Nach Veröffentlichung
stehen Build-/Update-ID, Runtime und lokaler/Manifest-/CDN-Hash fest.

Geräteabnahme bleibt separat: Preview-App vollständig schließen, öffnen und
etwa 15 Sekunden warten, erneut schließen und öffnen. Feiertage/Sondertage,
Wochenenden, Dienste, Auswahl und das Tagesmenü in hell/dunkel sowie mit Foto
auf dem iPhone prüfen. Veröffentlichung und technische Nachweise ersetzen
diese Sichtprüfung nicht.

## Veröffentlicht und technisch geprüft

Am 29. Oktober 2026 wurde ausschließlich die freigegebene iOS-Preview-OTA
veröffentlicht:

- [Update-Gruppe 835cb9f3-b354-4203-9649-c0a9e8612d16](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/835cb9f3-b354-4203-9649-c0a9e8612d16).
- iOS-Update-ID: 01a185eb-d18c-7347-ab66-869a6a2cb6c1.
- Vollständiges verify:fast erfolgreich: 511 Unit-Testdateien/9.897 Tests,
  164 Komponentensuiten/1.535 Tests und alle nachfolgenden Script-Gates.
  Fokussiert zusätzlich 28 Unit- und 41 Komponententests bestanden.
- Build-Profil und Preview-Environment ergeben beide die unveränderte Runtime
  b99c3cf0dd56e6b1bb126d195f21c665de57760b für Preview Build 44.
- Der geprüfte iOS-Export wurde mit --skip-bundler veröffentlicht. Alle
  1.868 Quellen und 55 Exportdateien sind anschließend unverändert; die 29
  Widget-/Native-/Paketdateien bleiben bytegleich zur vorherigen Preview.
- Unmittelbar vor Veröffentlichung war weiterhin die bewahrte Gruppe
  5bb237e3-30b7-4560-8ede-f33bec41e109 aktuell. EAS zeigt anschließend die neue
  Gruppe als neueste kompatible Preview.
- Tatsächlich ausgeliefertes Manifest und CDN antworten mit HTTP 200.
  Lokal-, Manifest- und CDN-Bundle sind identisch: 12.222.589 Bytes,
  SHA-256 3d2b681fdd6a7225cf3d7c8df95c0c8dacd23922c36d9328fbfe401152504e25.
- Asset-Request-Headers wurden gemäß Manifest verwendet; ihre Werte wurden
  nicht ausgegeben.

Die neuen Widget-Markierungen bleiben pausiert und sind nicht Teil dieser OTA.
Es gab keinen nativen Build, keine Git-Lieferung und keine Veröffentlichung
nach Production/TestFlight. Die iPhone-Sichtprüfung bleibt offen.

## Nachbesserung: Farbe und feste Deckkraft (29.10.2026)

Ziel: Feiertage und tarifliche Sondertage sowie Wochenenden sind in Hell/Dunkel mit und ohne Kalenderfoto besser zu erkennen. Drei Farbpunkte (Rot, Blau, Orange) in „Kalender gestalten“, ohne zusätzlichen Deckkraftregler. Orange bleibt Vorgabe. Die feste Deckkraft beträgt 64/255 (rund 25 %), die neutrale Wochenendtönung 20/255 (rund 8 %). Feiertagsflächen ersetzen die Wochenendtönung, damit sich die Deckkraft nicht addiert.

Plattform: iOS Preview Build 44, passende Runtime b99c3cf0dd56e6b1bb126d195f21c665de57760b. Weiterarbeit im vorhandenen isolierten Branch codex/calendar-day-markers-preview-ota. Ausgangspunkt ist der vollständig erhaltene Quellstand der OTA-Gruppe 835cb9f3-b354-4203-9649-c0a9e8612d16, nicht der ältere Git-Basisstand.

Arbeitspakete: (1) Auswahlelemente, lokale Speicherung, Rücksetzen und Sicherungsvalidierung; (2) Kalenderrenderer, sofortige Vorschau und gezielte Regressionstests. Betroffen sind Kalendertypen/-provider, Datenbankpräferenzen/-validierung, zwei Monatsrenderer und deren Display-Weitergabe, Einstellungssteuerung/-Beispieldaten sowie zugehörige Tests. Keine Tarifberechnung oder Feiertagszuordnung wird geändert. Widget-Erweiterungen bleiben pausiert; native Dateien, Pakete und Buildkonfiguration bleiben identisch.

Abnahme: Farbe wirkt auf gesetzliche Feiertage und bereits aufgelöste Tarifsondertage; Namen bleiben im Tagesmenü und für VoiceOver. Auswahl überlebt Neustart, ist bei ausgeblendeten Feiertagen deaktiviert und wird beim Zurücksetzen Orange. Die feste Beispielvorschau enthält einen ausdrücklich als Beispiel benannten Tag. Kalenderfoto-Regler und Wischkorrektur bleiben erhalten. Erforderlicher iPhone-Vergleich: Hell/Dunkel jeweils ohne Foto und mit Foto bei 50 %, Wochenende und Feiertag nebeneinander. Technische Checks ersetzen diese Sichtabnahme nicht.

Nachweise dieser Nachbesserung: artifacts/calendar-day-colors-preview/. Bestehende Nachweise der ersten Veröffentlichung bleiben erhalten. Die bestehende Preview-OTA-Freigabe gilt für diesen Kalenderfluss; keine Commit-/Push-/Build-/TestFlight-Freigabe.

### Veröffentlichung der Nachbesserung

- `npm.cmd run verify:fast`: Exit 0; 511 Vitest-Dateien / 9.899 Tests, 164 Jest-Suiten / 1.541 Tests und sämtliche nachgelagerten Projektprüfungen erfolgreich. Die vorangegangenen Fehlläufe (Design-Token-Regeln, alte VoiceOver-Erwartungen der Vorschau) wurden korrigiert und separat dokumentiert.
- Preview-OTA-Gruppe: `36b8b9db-0683-486c-96d4-476eb886a707`, iOS-Update: `01a18772-8970-710f-b34e-2e574479ce4c`, veröffentlicht am 29.10.2026 um 11:36:32 UTC. [EAS-Update](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/36b8b9db-0683-486c-96d4-476eb886a707).
- Branch/Kanal/Environment: `preview`, Plattform `ios`, Variante `internal`. Build-Profil- und Environment-Fingerprint passen zu Preview Build 44: `b99c3cf0dd56e6b1bb126d195f21c665de57760b`.
- 1.868 Quelldateien gegen die vorherige Veröffentlichung geprüft; 20 Änderungen im definierten UI-/Präferenz-/Testscope. 55 Exportdateien eingefroren; 29 Widget-/Native-/Konfigurationsdateien bytegleich. Kein Commit, Push, nativer Build oder TestFlight-/Production-Update.
- Auslieferung bestätigt: Manifest und CDN HTTP 200, 12.225.680 Bundle-Bytes. Lokale, Manifest- und CDN-SHA-256 identisch: `33ea6bd0683ef1ff2198a9111e35d0be9f52f31d9f32735eee763e4eebce328e`.
- iPhone-Sichtabnahme bleibt offen: Preview vollständig schließen, öffnen und ca. 15 Sekunden warten, nochmals schließen und öffnen. Hell/Dunkel ohne Foto sowie mit Foto bei 50 % prüfen; drei Farben, Feiertags-/Sondertagsflächen und Wochenenden vergleichen. Widget-Erweiterungen bleiben pausiert.

## Freigegebene Git- und TestFlight-Lieferung

Der Nutzer hat diesen Kalenderstand mit „Ja perfekt“ bestätigt und Commit, Push, PR, Merge sowie TestFlight-OTA ausdrücklich beauftragt. Dies bestätigt die Kalenderdarstellung im besprochenen Umfang; ein konkretes iPhone-Modell und eine iOS-Version wurden nicht genannt. Widget-Erweiterungen bleiben pausiert.

Die Lieferbranch `codex/calendar-day-colors-release` beginnt beim aktuellen `master` `adb51cfb21cb14d488ebccab574ece8a604780fb` (PR #331). Die bereits gemergte Kalendergestaltung und Popup-Korrektur bleiben erhalten. Genau 24 Dateien gehören zur Lieferung: 23 Kalender-/Präferenz-/Testdateien und dieses Dokument. Sämtliche 1.868 Quell- und Konfigurationsdateien außerhalb Markdown sind bytegleich mit der bestätigten Preview `36b8b9db-0683-486c-96d4-476eb886a707` und dem vollständig erfolgreichen `verify:fast` (511 Vitest-Dateien / 9.899 Tests, 164 Jest-Suiten / 1.541 Tests sowie alle Script-Gates). Bestehende Dokumente aus `master` bleiben erhalten. Der genaue Vergleich liegt in `artifacts/calendar-day-colors-release/delivery-source-proof.json`.

Die PR wird erst nach erfolgreicher CI gemergt. Die anschließende iOS-OTA verwendet das Production-Environment und die gesondert geprüfte Runtime des TestFlight-Builds 8. Metadaten und Bundle-Auslieferung werden überprüft; die TestFlight-Geräteabnahme bleibt ein eigener Schritt. Es wird kein neuer nativer Build erstellt und keine Apple-Beta-Konfiguration geändert.
