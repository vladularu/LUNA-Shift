# Profil-Icons im Kalender

## Auftrag und Scope

Die Namens-Chips unter dem Monatstitel werden durch runde Profil-Icons ersetzt.
Zielplattform ist das iPhone. Der eigene Kalender verwendet das vorhandene
kontogebundene Profilbild; ohne Bild erscheinen Initialen. Geteilte Kalender
liefern derzeit Namen und Farbe, aber keine Profilbilder und zeigen daher
Initialen. Es werden keine privaten Fotos anderer Konten abgerufen.

Dateiscope: `shared-calendar-filters.tsx`, die zugehörigen Komponententests und
dieses Dokument. Teilen, Cloud-Abgleich, Datenmodell, native Konfiguration,
Kalenderlayout und Dienstfarben werden nicht geändert. Implementierung auf
`codex/calendar-person-avatars`, Basis `cafe5bb` vom 30.10.2026.
Am 30.10.2026 wurde die Visualisierung bestätigt und die iOS-Preview-OTA
ausdrücklich freigegeben. Kanal/Branch und Environment: `preview`,
`APP_VARIANT=internal`. Die Preview-OTA erhält den tatsächlich veröffentlichten
Preview-Stand. Im Anschluss wurden Commit, Push, PR, Merge nach erfolgreicher CI
und die TestFlight-OTA ausdrücklich beauftragt. Ein nativer Build oder neuer
Store-Upload ist nicht beauftragt.

## Abnahmekriterien

- Die horizontale Auswahl behält ihre bisherige Höhe und scrollt bei vielen
  Personen. Jedes Icon bietet mindestens 44 × 44 pt Touchfläche.
- Der eigene Avatar zeigt nur das Foto eines bereiten, angemeldeten Kontos.
  Abmelden und Kontowechsel entfernen das bisherige Bild. Bei Ladefehlern
  erscheinen Initialen; ein neues Bild kann erneut geladen werden.
- Aktive Kalender erhalten einen Ring in ihrer bisherigen Farbe und einen
  Haken. Inaktive Kalender werden dezenter dargestellt. Antippen schaltet die
  eigenen beziehungsweise geteilten Dienste weiterhin unabhängig ein und aus,
  auch offline und während Cloud-Arbeit.
- VoiceOver erhält den vollständigen bisherigen Namen, Auswahlzustand und
  Bedienhinweis. Die dekorativen Initialen skalieren nicht über den Kreis hinaus.
- Offline- und Fehlermeldungen bleiben erhalten.

## Prüfung

Erste lokale Prüfung am 30.10.2026, vor der Preview-Freigabe:

- Kalenderfilter: 13/13 Komponententests bestanden, einschließlich Initialen,
  Profilbild, Kontowechsel, Bildfehler und weiterhin bedienbarer Auswahl.
- Typprüfung, Lint, Formatprüfung und `git diff --check` bestanden.
- `verify:fast` zweimal ausgeführt, insgesamt weiterhin rot: Im ersten Lauf
  bestanden 10.063/10.065 Fachtests; zwei unveränderte Tests überschritten
  5 Sekunden. Im zweiten Lauf bestanden 10.058/10.065; sieben unveränderte
  Caritas-/Editor-Tests überschritten dasselbe Zeitlimit. Die beiden Fälle aus
  dem ersten Lauf bestanden anschließend einzeln mit `--maxWorkers=1`
  (36/36 Tests, unverändertes Zeitlimit).
- Der zusätzlich geprüfte unveränderte Kalender-Pager überschritt ebenfalls
  das 5-Sekunden-Limit: zuerst 16/17 Tests bestanden, beim Einzellauf 12/17.
  Dieser Test verwendet die geänderte Profil-Auswahl nicht. Ein grüner
  vollständiger Standardlauf ist damit noch nicht nachgewiesen; die nach dem
  Fachtestschritt verketteten Prüfungen wurden nicht erreicht.
- Testkonfiguration und Zeitlimits wurden nicht verändert. Bei diesen ersten
  lokalen Läufen wurde noch keine Git- oder EAS-Auslieferung durchgeführt.

## Bestätigte Darstellung und veröffentlichte Preview

Der Nutzer bestätigte die Visualisierung mit rundem Beispielfoto, Initialen,
Auswahlring und Haken. Die App verwendet das vorhandene eigene Kontofoto;
das Beispielfoto der Visualisierung wird nicht mitgeliefert.

Die OTA erhielt zuerst die veröffentlichte Sonderdienst-Preview `f4b95619`
und anschließend die zwischenzeitlich veröffentlichte Speichern-Korrektur
`9b447e74`. Der erste kombinierte Prüflauf wurde dafür beendet und die
Gesamtprüfung auf dem aktualisierten Snapshot neu gestartet. Außer den beiden
Avatar-Quelldateien bleiben 2.272 veröffentlichte Dateien bytegleich erhalten.
Der vollständige Snapshot umfasst einschließlich dieser Dokumentation
2.275 Dateien.

- Abschließendes `verify:fast`: Exit 0, 10.124 Fachtests sowie 1.665
  Oberflächentests in 175 Suiten, einschließlich aller 17 Kalender-Pager-Fälle.
  Auch alle weiteren verketteten Prüfskripte und `git diff --check` bestanden.
  `VITEST_MAX_WORKERS=2` begrenzt nur die Parallelität; Testkonfiguration und
  Zeitlimits bleiben unverändert.
- iOS-Export mit dem bestehenden EAS-Environment `preview` und
  `APP_VARIANT=internal`. Der berechnete Fingerprint entspricht Preview Build 44
  (`812ea1a9-a4c0-48f3-b01a-72011cdad43e`):
  `b99c3cf0dd56e6b1bb126d195f21c665de57760b`.
- [Veröffentlichte Preview-OTA](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/22c819bd-4552-42ab-b5cb-c21122b9223c),
  iOS-Update `01a18b6c-3653-72c7-a34d-b69190c03da4`, veröffentlicht am
  30.10.2026 um 07:08 Uhr, Europe/Berlin. Kanal/Branch und Environment:
  `preview`; das geprüfte Paket wurde mit `--skip-bundler` veröffentlicht.
- Das aktive Live-Manifest liefert genau diese Update-ID und Runtime.
  Manifest und Bundle antworten mit HTTP 200. Export, Manifest und CDN-Bundle
  stimmen überein: SHA-256
  `4533aa5c77ba76b130040ab93f0a6655a58ec155c9bbe78f5bda8016ca566d90`.
  Alle 52 Assets wurden geprüft und sind gegenüber der vorherigen Preview
  unverändert. Alle 2.275 eingefrorenen Quelldateien blieben während Prüfung,
  Export und Veröffentlichung unverändert.
- Nachweise und ein eigener eingefrorener Quellsnapshot liegen unter
  `artifacts/calendar-person-avatars-preview/22c819bd-4552-42ab-b5cb-c21122b9223c/`.
  Der Einstieg ist `artifacts/calendar-person-avatars-preview/release-proof.json`.
  SHA-256 des Quellmanifests:
  `97dac5b75e8639503dbd7add77cad86a002a4ce9694a69053d4bd662c49d3cf8`.
  Diese Artefakte bleiben außerhalb des Git-Lieferumfangs.
- Während der Preview-Auslieferung wurden keine Commits, Pushes, nativen Builds
  oder Production-/TestFlight-Updates ausgeführt.

## Freigegebene Git- und TestFlight-Lieferung

Der Anschlussauftrag vom 30.10.2026 umfasst ausschließlich diese drei Dateien:
Kalenderfilter, zugehörige Komponententests und Dokumentation. Die Git-Basis ist
der aktuelle `origin/master` (`cb27392`, einschließlich der Speichern-Korrektur);
die beiden Avatar-Dateien stimmen mit
dem vollständig geprüften Preview-Snapshot überein. Artefakte und unabhängige
Sonderdienst-, Editor- oder Designänderungen bleiben außerhalb des PR-Scopes.

Merge erst nach allen sieben erfolgreichen PR-Prüfungen einschließlich
`quality-gates`; davor werden PR-Head, Basis und vollständige Dateiliste,
danach Merge-Tree und Datei-Blobs geprüft. TestFlight erhält die Avatar-Dateien
zusätzlich zum tatsächlich veröffentlichten Beta-Snapshot. Ziel sind der
bestehende Build 8, `production` und `APP_VARIANT=production`, mit separat
geprüftem Fingerprint. Die Preview wird dabei nicht erneut veröffentlicht.
Konkrete Commit-, PR-, CI-, Merge- und OTA-Belege werden im lokalen Ordner
`artifacts/calendar-person-avatars-testflight/` gesichert.

Die Übernahme wurde ausdrücklich beauftragt. Ein zusätzlicher Screenshot- oder
Gerätenachweis nach der Preview-OTA wurde in diesem Auftrag nicht protokolliert;
die erneute TestFlight-Sichtprüfung bleibt ein eigener Abnahmeschritt.

Die visuelle iPhone-Abnahme bleibt offen: Screenshot mit eigenem Foto und
mindestens zwei geteilten Personen, jeweils ein- und ausgeblendet; außerdem
helles/dunkles Design, Kalenderfoto, große Schrift und VoiceOver prüfen.
Lokale Tests ersetzen diesen Gerätenachweis nicht.
In **LUNA Shift Internal (Preview)** vollständig schließen, öffnen und etwa
15 Sekunden warten, nochmals schließen und erneut öffnen. Anschließend die
Profil-Icons, Ein-/Ausblenden und den eigenen Foto-Fallback auf dem iPhone prüfen.
