# Dino-Easter-Egg als OTA für TestFlight Build 5

Auftrag: Das auf dem iPhone bestätigte Dino-Spiel mit transparenter Darstellung,
zunehmendem Tempo, Kakteengruppen, Vögeln und einem lokalen Rekord als OTA für die
TestFlight-App bereitstellen. Der Nutzer hat die Veröffentlichung ausdrücklich
mit „brind das als OTA für die testfligh build“ freigegeben.

Read-only geprüft: TestFlight 0.1.0 (5), EAS-Build
`1ec474a0-bda0-45eb-89f8-780c94db5632`, App `com.lunashift.app`,
Kanal `production`, Runtime `4a9747e5fdc6a52760d6955a95584cdd1e85607e`.
Apple meldet den Build als `VALID`, intern und extern `IN_BETA_TESTING`,
nicht abgelaufen.

Basis ist der aktuell ausgelieferte Production-Stand `95f949e`, zuletzt als
Update-Gruppe `9843ddbf-76af-4408-904d-5deb898e0077` veröffentlicht. Damit bleiben
die vorhandenen Sharing-, QR-, Kalender- und Icon-Anpassungen erhalten.
Isolierter Branch: `codex/dino-testflight-ota`.

Scope: acht unveränderte Runner-Dateien aus dem akzeptierten Preview-Stand,
die vorhandene Einbindung in `compliance-day-list.tsx` und deren Integrationstest,
diese Dokumentation und lokale Auslieferungsnachweise. Die beiden Integrations-
Basisdateien sind zwischen der Preview-Basis `8e5c486` und Production-Basis
`95f949e` identisch. Keine Änderung an nativen Quellen, Paketen, Fachprüfung,
Datenbankschema oder App-Konfiguration.

Expo laut isoliertem `package.json`: `~57.0.22`; versionierte Referenz:
https://docs.expo.dev/versions/v57.0.0/sdk/updates/.

Abnahme: identischer Spielcode zum bestätigten Preview-Stand; vollständiges
`verify:fast`, fokussierte Spieltests, Production-Konfiguration und iOS-Export;
exakte Runtime-Kompatibilität; echtes Client-Manifest und ausgeliefertes Bundle
auf iOS/production. Die tatsächliche Übernahme in der TestFlight-App bestätigt
abschließend der Nutzer. Die vorherige Preview-Abnahme ersetzt diese nicht.

Freigabe ausschließlich für das iOS-OTA auf Production. Kein neuer nativer Build,
keine neue Apple-Einreichung, keine Store-Veröffentlichung und kein Git-Commit,
Push oder Merge.

## Vorbereitung

- Alle zehn übernommenen Spiel-/Integrationsdateien entsprechen bytegenau dem
  bestätigten Preview-Stand (Update-Gruppe `c2181fe8-9387-4811-b424-1ee3fca45dd0`).
- 17 Engine-/Speichertests und 22 Komponententests sind auf der Production-Basis
  bestanden. Release-Konfiguration und iOS-Hermes-Export sind ebenfalls bestanden.
- Native Runtime und sämtliche 145 Fingerprint-Quellen passen zu TestFlight Build 5.
  Die Ignore-Datei wurde wegen der Fingerprint-Relevanz ihrer Zeilenenden bytegenau
  aus dem bisherigen Production-Checkout übernommen; ihre Regeln sind unverändert.
- Die bestehenden Production-Abhängigkeiten wurden lokal kopiert. Verknüpfungen
  werden für den Fingerprint-Vergleich vermieden. Vorhandene Production-Sharing-
  Umgebungsvariablen wurden über EAS geladen; keine neue Cloud-Konfiguration.
- Zehn produktive Quellen wurden im tatsächlichen Export-Source-Map mit den
  lokalen Dateien abgeglichen: die sechs Spiel-/Integrationsquellen sowie die
  aktuellen Navigation-, QR-, Shared-Calendar- und Shared-Shift-Symbol-Quellen.
- Lokale Nachweise liegen unter `.expo/dino-testflight-ota/`.

## Veröffentlichung am 15.10.2026

- Vollständiges `verify:fast` bestanden (Exit 0): 8.739 Unit-Tests in 452 Dateien,
  1.128 Komponententests in 137 Suites sowie alle weiteren Repository-Gates.
- Unmittelbar vor der Veröffentlichung zeigte der Production-Kanal weiterhin auf
  die erwartete Vorgängerversion; keine fremde zwischenzeitliche Änderung wurde
  ersetzt. Das geprüfte iOS-Bundle wurde mit `--skip-bundler` veröffentlicht.
- Veröffentlicht um 22:39:48 Uhr (Europe/Berlin), ausschließlich iOS/production.
  Update-Gruppe: `5ccced7e-471c-4e32-a24b-8b0b5af480c5`.
  iOS-Update: `01a1414a-de4e-79a3-a7f5-4c7589ca589b`.
- Das tatsächliche iOS-Client-Manifest für Production und Build-5-Runtime liefert
  dieses neue Update. Das ausgelieferte Bundle entspricht bytegenau dem geprüften
  Export: 9.411.340 Bytes, SHA-256
  `6a895fb8cbd6067291e72d6aac3a75b1c827b89e3db1f79b7b704c38f1ac94e6`.
- Technische Auslieferung bestätigt. Die tatsächliche Übernahme und Bedienung in
  der TestFlight-App sind noch durch den Nutzer zu bestätigen. Die Spielabnahme
  in LUNA Shift Internal ist bereits dokumentiert.

Zum Laden LUNA Shift aus TestFlight 0.1.0 (5) vollständig schließen, öffnen und
etwa 15 Sekunden warten. Anschließend erneut vollständig schließen und öffnen.
Auswertung → Prüfung → Check doppelt antippen.

TestFlight und Internal sind separate App-Installationen mit jeweils lokalem
Highscore; dieses OTA überträgt keine Daten zwischen beiden Installationen.

[OTA im EAS-Dashboard](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/5ccced7e-471c-4e32-a24b-8b0b5af480c5)
