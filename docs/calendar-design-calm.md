# Kalender gestalten: ruhige Scrollseite

## Task-Vertrag, 29. Oktober 2026

Ziel: Die zuletzt gezeigte Variante 1 als durchgehende Scrollseite umsetzen. Alle Einstellungen bleiben direkt erreichbar. Das vorhandene Designsystem hat Vorrang vor den generierten Farben und Maßen: Palette, Typografie, Auswahlsegmente, Karten, Schalter, Abstände und Navigation werden weiterverwendet.

Plattform: iPhone, vorhandene Expo-SDK-57-App (`expo ~57.0.31`), versionierte Dokumentation unter https://docs.expo.dev/versions/v57.0.0/ geprüft. Basis `origin/master` / `eea62a2`, isolierter Branch `codex/calendar-design-calm`.

Nicht-Ziele: globale Gestaltung, native Pakete/Berechtigungen, Dienstplan- oder Tarifberechnungen, neue Unterseiten und Widgets umbauen. Commit, Push, PR, Merge, Build, OTA und Store-Veröffentlichung waren im ursprünglichen Implementierungsauftrag nicht freigegeben.

Am 29. Oktober 2026 hat der Nutzer anschließend ausdrücklich die iOS-Preview-OTA zum iPhone-Test freigegeben. Diese Freigabe umfasst ausschließlich Preview; Git- und andere Veröffentlichungsschritte bleiben separate Gates.

## Arbeitspakete und Dateiscope

1. Seite: `calendar-design-screen.tsx`, `calendar-background-control.tsx`, `calendar-display-controls.tsx`, neuer `calendar-image-opacity-control.tsx`. Gruppen heißen Aussehen, Hintergrund, Kalenderinhalt und Dienstanzeige. In der ersten Preview scrollte die Vorschau mit; die nachfolgende iPhone-Korrektur stellt die feste Vorschau wieder her (siehe unten). Die vorhandene Navigation und deren unterer Inhaltsabstand bleiben erhalten.
2. Deckkraft: `theme/calendar-image.ts`, Kalenderhintergrund-Context/Provider/Storage und `calendar/calendar-background.tsx`. Ganze Prozentwerte von 0 bis 100 werden unter dem vorhandenen Schlüssel gespeichert. Die bisherigen Werte subtle/medium/strong bleiben gültig und entsprechen weiterhin 10/25/40 Prozent. Kein Schemawechsel und kein Schreibvorgang beim Laden. Der bisherige Standard bleibt medium (25 Prozent).
3. Nachweise: bestehende Appearance-, Foto-Provider-, Foto-Storage- und Theme-Tests, diese Dokumentation und `design-qa.md`.
4. Abgetrennte Kompatibilität: `domain/private-cloud.ts`, `features/private-cloud/cloud-media.ts`, `infrastructure/private-cloud/cloud-document.ts` und der bestehende Repository-Test. Das optionale, validierte Feld `calendarImageOpacity` bewahrt den exakten Prozentwert bei Cloud-Wiederherstellung. Das bisherige `calendarImageStrength`-Feld bleibt eine gültige, nächstliegende alte Stufe; alte Dokumente ohne Zusatzfeld funktionieren weiter. Datenbank- und Cloud-Formatversion bleiben unverändert.
5. Bestehende Preview erhalten: Beim OTA-Abgleich wurde die inzwischen veröffentlichte und auf dem iPhone bestätigte Popup-Gruppe `3d3634ac-4a89-493a-bb46-06e89d741970` festgestellt. `quick-entry-popup.tsx` und dessen bestehender Komponententest wurden anhand ihrer akzeptierten SHA-256-Werte unverändert übernommen. Es wird keine neue Popup-Gestaltung eingeführt; der bereits ausgelieferte Stand ohne zusätzliches Datum/X bleibt erhalten. Quelle: Commit `f1225ec`, Basis ebenfalls `eea62a2`; Nachweis `artifacts/calendar-design-calm/preserved-preview-source.json`.

## Abnahmekriterien

- Alle bisherigen Optionen sind auf einer Scrollseite direkt bedienbar; keine Untermenüs oder aufklappbaren Bereiche.
- Systemdesign und Hell/Dunkel/System bleiben erhalten; kein neuer Farbsatz.
- Der Regler zeigt echte Prozentwerte. Eine laufende Ziehbewegung verändert nur die lokale Fotovorschau; Speichern und Widget-Synchronisation beginnen erst beim Loslassen. Abbruch stellt die gespeicherte Darstellung wieder her.
- Neustart, alte Fotostufen, Ersetzen/Entfernen/Rückgängig, Reset und Speicherfehler bleiben korrekt. Daten und Dateiverweise werden beim Ändern der Deckkraft nicht verändert.
- Kalenderdaten und Dienstchips werden nicht mit dem Hintergrund ausgeblendet.
- Slider-Touchfläche mindestens 44 pt, VoiceOver-Anpassung um ein Prozent, große Schrift und kleine Displays berücksichtigt.

## Prüfstand

`npm.cmd run verify:fast` ist vollständig bestanden: Regelverträge, TypeScript, Lint ohne Warnungen, Formatierung, 511 Vitest-Dateien/9.895 Tests, 164 Jest-Suites/1.531 Tests und sämtliche nachfolgenden Script-, Sicherheits-, Runtime-, Worklet- und Widget-Prüfungen sowie `git diff --check`. Protokoll: `artifacts/calendar-design-calm/verify-fast.log`.

Der finale Durchlauf verwendete `VITEST_MAX_WORKERS=2`. Im vorherigen stark parallelen Lauf überschritt ein unveränderter Test in `entry-edit-motion-serialization.test.ts` sein 5-Sekunden-Limit. Er bestand anschließend isoliert und im vollständigen finalen Gate. Tests und Testkonfiguration wurden dafür nicht geändert.

Die fokussierten Komponententests bestehen zusätzlich mit 4 Suites/77 Tests; die Deckkraft-, Storage-, Widget- und Cloud-Prüfungen mit 5 Dateien/96 Tests. Die Systemprüfungen für Tokens, Kontrast und Schriftvergrößerung wurden ebenfalls erfolgreich ausgeführt. Paket-/Lockdateien, native Konfiguration, globale Palette, Typografie und gemeinsame UI-Bausteine sind unverändert. Der Graft-Graph wurde für den finalen Quellstand aktualisiert.

Die visuelle und native Abnahme auf dem iPhone bleibt separat offen; ein Browser oder automatisierte Tests ersetzen sie nicht. Der lokale Browserzugriff lief in Zeitüberschreitungen; deshalb steht `design-qa.md` auf `final result: blocked`. Die anschließend ausdrücklich freigegebene Preview-Veröffentlichung ist unten dokumentiert.

## iOS-Preview-OTA veröffentlicht, 29. Oktober 2026

Veröffentlicht wurde ausschließlich die interne iOS-Variante auf Branch/Kanal `preview`, Environment `preview`, mit `APP_VARIANT=internal`. Build 44 (`812ea1a9-a4c0-48f3-b01a-72011cdad43e`) und beide Fingerprint-Prüfungen – Build-Profil sowie tatsächliches Veröffentlichungs-Environment – stimmen auf Runtime `b99c3cf0dd56e6b1bb126d195f21c665de57760b` überein.

- [Update-Gruppe 793d5d8f-1844-4059-9a79-e178c45108f0](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/793d5d8f-1844-4059-9a79-e178c45108f0)
- iOS-Update-ID: `01a185ab-4f5d-73f6-b31d-f70c31ea48bc`, erstellt am 29. Oktober 2026.
- Gemeinsamer Stand nochmals vollständig geprüft: 511 Vitest-Dateien/9.895 Tests, 164 Jest-Suites/1.531 Tests und alle nachfolgenden Script-Gates bestanden. Protokoll: `artifacts/calendar-design-calm/verify-fast-preview.log`.
- 1.867 versionierte/neue Dateien außerhalb der Dokumentation vor dem Export eingefroren und nach Veröffentlichung unverändert geprüft. Alle 55 Exportdateien unverändert; der geprüfte Export wurde mit `--skip-bundler` veröffentlicht.
- Neuester kompatibler Preview-Stand laut EAS und tatsächlich ausgeliefertes Manifest stimmen auf die neue Update-ID überein. Manifest und CDN antworteten mit HTTP 200. Die nach Protokoll mitgelieferten Asset-Request-Headers wurden beim Download verwendet; ihre Werte wurden nicht ausgegeben.
- App-Bundle: 12.223.805 Bytes; lokaler, Manifest- und CDN-SHA-256 identisch: `3c8f8742ea6384963448049f731fde2c354166486ec57e0b163d2468f6492c58`.
- Nachweise: `preview-ota-delivery-proof.json`, `ota-candidate-source-hashes.json`, `ota-candidate-package-hashes.json`, `published-update.json`, `preview-updates-after.json` und `served-manifest.json` unter `artifacts/calendar-design-calm/`.

Die auf dem iPhone bestätigte Popup-Korrektur aus der vorherigen Preview bleibt bytegleich enthalten. Es wurde kein nativer Build gestartet und keine Git-Lieferung oder Veröffentlichung dieser Einstellungsseite für Production/TestFlight ausgeführt.

Geräteabnahme dieser Einstellungsseite bleibt offen: Preview-App vollständig schließen, öffnen und etwa 15 Sekunden warten, erneut schließen und öffnen. Danach unter „Kalender gestalten“ Gruppierung, Systemdesign, Scrollen sowie Foto-Deckkraft und Neustart prüfen. Veröffentlichung und Hashgleichheit ersetzen diese Abnahme nicht.

## iPhone-Rückmeldung: Regler und feste Vorschau

Der Nutzer sieht die erste Preview auf seinem iPhone, meldet jedoch zwei Probleme: Beim Ziehen nach rechts greift die bildschirmweite Zurückgeste; außerdem fehlt die zuvor feste Kalenderansicht mit dem weichen Übergang zur scrollenden Liste. Damit ist die Übernahme belegt, die Bedienung jedoch noch nicht abgenommen.

Ziel dieses abgegrenzten Korrekturpakets: Die Vorschau bleibt oberhalb der vier scrollenden Gruppen stehen. Der ursprüngliche, nicht interaktive SVG-Verlauf am oberen Rand des Scrollbereichs wird wiederverwendet. Ausschließlich auf `calendar-design` wird die native Zurückgeste auf den linken Bildschirmrand begrenzt; Reglerbewegungen innerhalb der Seite lösen keine bildschirmweite Zurücknavigation aus. Alle anderen Unterseiten behalten ihre bisherigen Gesten.

Der Nutzer hat die zwischenzeitlich erwogene Begrenzung auf 50 Prozent ausdrücklich verworfen: Es bleiben echte 0–100 Prozent Deckkraft ohne versteckte Kappung, auch in Vorschau, Kalender und Widget. Alte Werte und Cloud-Dokumente bleiben gültig. Die beiden Reglergrenzen, kontinuierliche Vorschau, Abbruch, VoiceOver und unverändertes Laden werden geprüft.

Zusätzlicher Dateiscope gegenüber der ersten Preview: `src/navigation/horizontal-back-gesture.ts` und dessen bestehender Test. Kein neues natives Paket und keine SDK-/Build-Konfiguration. Expo `~57.0.31` und passende SDK-57-Stack-Dokumentation vor der Korrektur geprüft. Der vorhandene Branch und die Preview-Freigabe für diesen iPhone-Test werden weiterverwendet; Git-, Production-/TestFlight- und native Build-Schritte sind nicht Teil dieses Pakets.

Abnahme auf dem iPhone: Regler langsam und schnell in beide Richtungen ziehen, ohne die Seite zu verlassen; 0 und 100 Prozent erreichen und nach Neustart erhalten; lange Liste unter der festen Live-Vorschau scrollen; weichen Übergang und Zurücknavigation per Randgeste beziehungsweise Schaltfläche prüfen. Automatische Prüfungen und OTA-Nachweise werden nach dem Korrekturlauf ergänzt.

### Automatische Prüfung der Korrektur

Die fokussierten Prüfungen bestehen mit 5 Vitest-Dateien/114 Tests und 4 Jest-Suites/81 Tests. Der vollständige finale Lauf `npm.cmd run verify:fast` besteht mit 511 Vitest-Dateien/9.897 Tests, 164 Jest-Suites/1.535 Tests und sämtlichen nachfolgenden Script-Gates, TypeScript, Lint, Formatierung und `git diff --check`. Protokoll: `artifacts/calendar-design-calm/slider-fix/verify-fast-final.log`.

Beide erneut erzeugten Fingerprints (Build-Profil und Preview-Environment) stimmen mit Preview Build 44 auf `b99c3cf0dd56e6b1bb126d195f21c665de57760b` überein. Die 1.867 Quell-/Konfigurationsdateien außerhalb Markdown sind vor und nach dem Export unverändert; alle 55 Dateien des iOS-Exports sind eingefroren. Bundle: 12.222.948 Bytes, SHA-256 `5c0fcf6aad3ab8536316c929605a1d7e32119e70fed441ba9a6410ed67b37906`. Die bisher akzeptierte Popup-Korrektur ist weiterhin bytegleich enthalten.

### Korrigierte iOS-Preview veröffentlicht

Die Korrektur ist am 29. Oktober 2026 ausschließlich für iOS/internal im Environment und Branch/Kanal `preview` veröffentlicht:

- [Update-Gruppe 5bb237e3-30b7-4560-8ede-f33bec41e109](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/5bb237e3-30b7-4560-8ede-f33bec41e109)
- iOS-Update-ID `01a185d7-2b80-73a7-b8b3-86f7cda0f28c`, erstellt `2026-10-29T04:07:13.536Z`.
- Runtime wie Preview Build 44; unmittelbar vor Veröffentlichung war weiterhin die eigene vorherige Gruppe `793d5d8f-1844-4059-9a79-e178c45108f0` aktuell. Es wurde kein zwischenzeitlich veröffentlichter Stand überschrieben.
- Mit `--skip-bundler` wurde der eingefrorene Export veröffentlicht. Nach dem Upload stimmen alle 1.867 Quelldateien und 55 Exportdateien weiterhin überein.
- EAS-Metadaten und tatsächlich über den Preview-Kanal ausgeliefertes Manifest zeigen die neue Gruppe beziehungsweise Update-ID. Manifest und CDN liefern HTTP 200; lokaler, Manifest- und CDN-Hash sind identisch zum oben dokumentierten Bundle-Hash.
- Nachweise liegen unter `artifacts/calendar-design-calm/slider-fix/`, insbesondere `preview-ota-delivery-proof.json`, `published-update.json`, `preview-updates-after.json`, beide Fingerprint-Dateien und die beiden Kandidaten-Hashlisten. Die vorherigen Veröffentlichungsnachweise bleiben erhalten.

Kein nativer Build, keine Git-Lieferung und keine Production-/TestFlight-Veröffentlichung wurden ausgeführt. Geräteabnahme der Korrektur bleibt offen: Preview-App vollständig schließen, öffnen und etwa 15 Sekunden warten, nochmals schließen und öffnen; anschließend Regler, feste Vorschau, Fade und Zurücknavigation auf dem iPhone prüfen.

## Git-Lieferung und TestFlight-OTA beauftragt

Der Nutzer hat anschließend ausdrücklich „Comit push pr merge und TestFlight ota“ beauftragt. Ziel ist die Lieferung genau dieser geprüften Kalendergestaltung über einen kurzlebigen Branch und eine PR nach vollständig erfolgreicher CI; anschließend folgt eine kompatible iOS-Production-OTA für den vorhandenen TestFlight-Build. Die Freigabe umfasst keinen nativen Build und keine Änderungen an Apple-Gruppen, Beta-Detailtext oder öffentlichem TestFlight-Link.

Die auf dem Preview-iPhone gemeldeten Probleme und deren Korrektur sind oben dokumentiert. Eine ausdrückliche Gerätebestätigung der korrigierten Preview liegt noch nicht vor; die anschließende Lieferungs- und TestFlight-Freigabe wird nicht als nachträglicher Screenshot-/Gerätenachweis ausgegeben.

Vor der Lieferung wird die bereits auf `master` enthaltene Popup-Korrektur (PR #330) als Basis übernommen. Die Quellen dieses Popups bleiben bytegleich. Die PR enthält ausschließlich diese Dokumentation und die Kalendergestaltung mit Deckkraft-, Cloud-Kompatibilitäts- und Navigationstests. Globale Tokens, native Dateien, Paketdateien, Berechnungen und unabhängige Arbeitsverzeichnisse bleiben außerhalb des Auftrags. Geprüft werden vollständiger PR-Dateiscope, Head/Base, alle sieben CI-Gates und nach Merge Tree-/Blob-Gleichheit zum geprüften Kandidaten. OTA-Metadaten, Runtime und die über den Production-Kanal gelieferten App-Bytes werden separat nachgewiesen; die TestFlight-Geräteabnahme bleibt ein eigener Schritt.
