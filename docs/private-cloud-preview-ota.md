# Privates Cloud-Konto im iOS-Preview

Stand: 18.10.2026 (Europe/Berlin). Das ausdrücklich freigegebene Preview-OTA ist veröffentlicht und seine Auslieferung ist überprüft. E-Mail-Konten, SMTP und Domain bleiben pausiert; die Anmeldung erfolgt über Apple und Google.

## Veröffentlichungskandidat

- Isolierter Branch `codex/private-cloud-preview-ota`, Basis `5e7b111f8103d09c6b84e44d5a957c1f68a3d125`.
- Der geprüfte Cloud-Patch aus `codex/private-cloud-account` wurde mit dem bereits veröffentlichten Preview-Quellstand aus `luna-copy-preview-ota` zusammengeführt. Die bisherige Preview-Oberfläche, Texte und das interaktive Onboarding bleiben erhalten.
- Der vorhandene Export der vorherigen Gruppe `36dbae5c-783b-4b6d-91f7-8d1fed4ccfbc` stimmt mit dem EAS-Launch-Asset überein: SHA256 `1313D5B56268FA000B45812224342D26D9F771864EB5CF3AAF5D0739FE098AE7`. Die betreffenden Preview-Quelldateien sind seit dieser Veröffentlichung unverändert.
- Drei Zusammenführungskonflikte wurden gezielt gelöst: Provider-Einbettung in der bestehenden Navigation, Cloud-Anmeldung im ersten aktuellen Onboarding-Schritt und Datenschutzhinweise mit weiterhin ausdrücklich ausgewählten Sharing-Notizen.

## Native Kompatibilität

Ziel ist der interne iOS-Build 41 (`a8a35a6d-9d92-46cf-8b24-1afe0d28d245`), Kanal und Branch `preview`, EAS-Umgebung `preview`, `APP_VARIANT=internal`.

Die native Runtime des Kandidaten wurde mit der Preview-Konfiguration berechnet und entspricht exakt `43b795d13a44499e37cc461aa80ce8c239783788`. Es wurde keine Runtime manuell erzwungen. Die ursprüngliche Abweichung betraf ausschließlich `.gitignore` und `packageJson:scripts`; alle nativen Fingerprint-Quellen stimmten bereits überein. Diese beiden Metadaten werden nur in der Veröffentlichungskopie auf dem vorhandenen Preview-Stand gehalten. Die zusätzliche Cloud-Sicherheitsprüfung und die neuere Decoder-Härtung werden deshalb ausdrücklich ausgeführt.

Der ursprüngliche Cloud-Arbeitszweig und der bisherige Preview-Arbeitszweig bleiben erhalten. Commit, Push, PR, Merge, nativer Build und Production-/Store-Auslieferung sind nicht Teil der Freigabe.

## Abnahme

Vor Veröffentlichung: kombinierte Komponentenprüfungen, `verify:fast`, zusätzliche private PostgreSQL- und Decoder-Tests, Release-Prüfung und iOS-Bündelung. Danach: veröffentlichte Gruppe, Kanalzuordnung, Runtime und auslieferbares Manifest prüfen. Testprotokolle liegen lokal unter `.expo/private-cloud/`.

Die sichtbare Übernahme auf dem iPhone und der echte Zwei-iPhone-Test für Cloud-Backup, Wiederherstellung, Offline-Änderungen und Kontowechsel bleiben separat nachzuweisen. Die Veröffentlichung selbst überträgt keine persönlichen App-Daten; eine erste Cloud-Sicherung benötigt die ausdrückliche Auswahl in der App.

## Ergebnis

- Kombinierter Quellstand: `verify:fast` bestanden, 456 Unit-Dateien mit 8.885 Tests und 140 Komponenten-Suites mit 1.198 Tests. Zusätzlich bestanden die 51 gezielten Komponentenprüfungen und alle 14 privaten PostgreSQL-/Decoder-Prüfungen. Produktions-Audit, Release-Konfiguration und vollständiger Diff sind geprüft. Der Quellstand blieb während Prüfung und Veröffentlichung unverändert.
- EAS-Umgebung: `preview`, tatsächlicher App-Variant `internal`, öffentlicher Cloud-Host `flpwvfqywvnvhfkjbcnf.supabase.co`; Client-Konfiguration vorhanden, Schlüsselwerte nicht protokolliert.
- Update-Gruppe: `35df2e43-d232-4dcf-9786-e030994856b9`, iOS-Update `01a14beb-3c39-71e5-b910-cb7353883412`, veröffentlicht am 18.10.2026 um 00:11 Uhr (Europe/Berlin; EAS-Zeitstempel `2026-10-17T22:11:10.009Z`).
- Aktiver Kanal `preview` zeigt auf Branch `preview` und liefert diese Gruppe für Runtime `43b795d13a44499e37cc461aa80ce8c239783788` aus.
- Der echte Update-Endpunkt antwortet mit HTTP 200. Das ausgelieferte Manifest und das tatsächlich vom CDN heruntergeladene Hermes-Bundle entsprechen dem lokalen Export: 9.515.072 Bytes, SHA256 `C73497CCD65E4833D936DBD7F31E0940C23E21928B001EEDCA794F4C32C92A88`.
- Nachweise liegen unter `.expo/private-cloud/`, insbesondere `publish-output.json`, `updates-after.json`, `channel-after.json`, `served-proof.json` und `verify-preview.log`.

Auf dem iPhone: LUNA Shift Internal vollständig schließen, öffnen und etwa 15 Sekunden warten, erneut schließen und öffnen. Danach unter Mehr → Cloud-Konto mit demselben Apple- oder Google-Konto anmelden. EAS-Nachweise ersetzen die Geräteabnahme nicht.
