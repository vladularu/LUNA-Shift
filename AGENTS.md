# LUNA Shift Arbeitsregeln

## Expo-Version

Vor jeder Codeänderung:

1. Die installierte Expo-Hauptversion aus `package.json` lesen.
2. Die exakt passende versionierte Expo-Dokumentation verwenden.
3. Dokumentation älterer SDK-Versionen nur für ausdrücklich beauftragte Migrationen heranziehen.

Aktueller Stand: Expo SDK 57. Referenz: https://docs.expo.dev/versions/v57.0.0/

## Verbindlicher Ablauf

1. Aufgabe zunächst read-only untersuchen.
2. Ziel, Nicht-Ziele, Plattform, Dateiscope und Abnahmekriterien festhalten.
3. Bei erwarteten Änderungen in mehr als 15 Dateien oder über UI, Fachlogik und native Integration hinweg die Aufgabe in getrennte Arbeitspakete teilen.
4. Änderungen auf einem kurzlebigen Branch `codex/<thema>` umsetzen.
5. `npm.cmd run verify:fast` und die aufgabenspezifischen Tests ausführen.
6. Native und visuelle Änderungen auf dem Zielgerät abnehmen. EAS-Metadaten, Exporte und Komponententests ersetzen keinen Screenshot- oder Gerätenachweis.
7. Erst nach erfolgreicher Pull-Request-CI nach `master` mergen.
8. Änderungen zuerst im bestehenden iOS-Preview-Kanal (`preview`, `APP_VARIANT=internal`) testen. Kleine Korrekturen werden zunächst dort geprüft und anschließend gesammelt nach separater Freigabe in die TestFlight-Beta übernommen; siehe `WORKFLOW.md`.
9. Den versionierten TestFlight-Quellvergleich mit `node scripts/verify-testflight-baseline.mjs` bestehen lassen. Ungeklärte Änderungen, fehlende Dateien oder entfernte Pflicht-Regressionstests blockieren die Auslieferung. Die Baseline darf nur nach zugeordneter iPhone-Abnahme aktualisiert werden.

Production-/TestFlight-OTAs werden nach bestehender Veröffentlichungsfreigabe ausschließlich über `node scripts/publish-testflight-ota.mjs --publish --message "..."` ausgeführt; vorher mit `--dry-run` prüfen. Der Einstieg prüft Quellstand, letzte abgenommene Live-OTA, Production-Umgebung, Pflichtfälle, tatsächliche Runtime und Export-Stabilität. Kein direkter `eas update`-Aufruf und keine manuelle Runtime-Überschreibung. Eine ausdrücklich beauftragte akute Wiederherstellung darf die exakt geprüfte, zuvor abgenommene Gruppe mit `eas update:republish` erneut ausliefern; dabei gelten Kanal-, Runtime-, Bundle- und Asset-Abgleich weiterhin.

Commit, Push, EAS Build, EAS Update und Store-Veröffentlichung benötigen jeweils eine ausdrückliche Freigabe. Unabhängige Änderungen im Arbeitsverzeichnis bleiben unberührt.

Einmal pro Checkout wird `npm.cmd run workflow:setup` ausgeführt. Der versionierte Pre-Push-Hook blockiert direkte lokale Pushes nach `master`.

Die ausführliche Arbeitsweise und Task-Vorlage stehen in `WORKFLOW.md`.
