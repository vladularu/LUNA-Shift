# Brutto-Netto: konkrete Eingabehinweise

Auslöser: iPhone-Screenshot vom 10. Oktober 2026. Beim Sichern der automatischen Netto-Angaben wird die Meldung „Die monatlichen Steuer- oder Versicherungsangaben sind ungültig oder unvollständig.“ angezeigt. Die Eingaben darüber fehlen im Bild; der tatsächliche Auslöser dieses konkreten Versuchs ist deshalb noch nicht festgestellt.

## Task-Vertrag

- Ziel: Bei ungültigen Formularwerten das betreffende Feld und eine konkrete Korrektur nennen; korrigierte Werte anschließend normal speichern.
- Nicht-Ziele: persönliche Werte annehmen oder automatisch ändern, Berechnungsregeln lockern, Tariflogik oder native Integration ändern, Git-Delivery oder weitere OTA-Veröffentlichung.
- Plattform: iPhone, installierte Expo-Version `~57.0.22`. Die [versionierte SDK-57-Dokumentation](https://docs.expo.dev/versions/v57.0.0/) wurde vor der Änderung geprüft.
- Dateiscope: `src/features/salary/net-pay-form-values.ts`, dessen Unit-Tests, neuer gemeinsamer Formular-Komponententest und dieses Protokoll. Umsetzung auf `codex/brutto-netto-prototype`; bestehende Rechnerarbeit und unabhängige Änderungen bleiben erhalten.
- Abnahme: Fälle, die bisher nur die Sammelmeldung ergeben, nennen das Feld; ungültige Eingaben erreichen den Speicher nicht; Korrektur löscht die Meldung und ermöglicht Speichern. Automatisches und manuelles Formular werden geprüft. Das vollständige schnelle Gate muss bestehen.

## Änderung

Die Formularumwandlung zeigt gezielte Hinweise für Kinderfreibetrag mit Steuerklasse V/VI, Kinderzahl ohne Elterneigenschaft, Faktor außerhalb des unterstützten Bereichs, überschrittene Profilgrenzen, ein Geburtsdatum außerhalb des bisherigen zulässigen Zeitraums und einen optionalen SFN-Grundlohn von 0. Fehlende Auswahlen nennen ebenfalls ihre konkrete Angabe. Die bisherigen Grenzen und die abschließende Domain-Validierung bleiben erhalten; es werden keine Werte ersetzt.

Die bestehende Fehleranzeige im Formular zeigt diese Hinweise beim Sichern. Der Hinweis verschwindet beim Bearbeiten einer Angabe. Die Fehler lassen sich sowohl bei der fortlaufenden automatischen Einrichtung als auch im monatlichen manuellen Rechner korrigieren.

## Nachweise

- Eingabe- und Domain-Profiltests: 88 bestanden.
- Formular-, Automatik- und manuelle Bildschirmtests: 32 bestanden. Die neuen zwei Formularfälle prüfen ausdrücklich abgewiesenes Speichern, sichtbaren Kinderfreibetrag-Hinweis, Korrektur und anschließendes Speichern mit unverändertem Profilformat in beiden Modi.
- `npm.cmd run verify:fast` vollständig bestanden, Exitcode 0: Regelverträge, Typprüfung, Lint, Format, 8.082 Unit-/Integrationstests in 414 Dateien, 870 Komponententests in 114 Suiten und alle zusätzlichen Publisher-/Delivery-/Policy-/Runtime-/Build-Abhängigkeitsprüfungen. Protokoll: `artifacts/net-pay-input-errors-verify-fast.log`.
- Die zuerst gestarteten Unit-Tests wurden durch Sandbox-Temp-Dateirechte blockiert, bevor Tests ausgeführt wurden. Der Lauf mit den erforderlichen Dateirechten bestand ohne Änderung der Testanforderungen.

## Preview-OTA

Separate Freigabe: „OTA“, 10. Oktober 2026. Die Korrektur wurde um 02:16:45 Uhr MESZ als iOS-Preview-OTA veröffentlicht: Gruppe `ffa28253-ed80-4c18-a254-65c765d517c2`, Update `01a1232b-5761-7e00-a89d-db022391386a`. [Update im EAS-Dashboard](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/ffa28253-ed80-4c18-a254-65c765d517c2).

Der vollständige native Fingerprint mit 95 Quellen entspricht Preview-Build 33: `03d174d668f0ea5f757958dccf853632762c554d`. Kanal, Branch und Umgebung sind `preview`; die App-Kennung lautet `com.pflegeshift.app.internal`. Der unpausierte Kanal liefert die neue OTA-ID aus. Das tatsächlich heruntergeladene Hermes-Bundle stimmt mit dem lokalen Export unter der EAS-Preview-Umgebung und dem Manifest-Hash überein, SHA-256 `72e4842ce69a1553ee349b3973175f866f8b4b244ea92cf3e78f1986631703e4`, 8.134.195 Bytes.

Nachweise: `artifacts/net-pay-input-errors-fingerprint-summary.json`, `artifacts/net-pay-input-errors-release-check.log`, `artifacts/net-pay-input-errors-export-eas.log`, `artifacts/net-pay-input-errors-channel-summary.json` und `artifacts/net-pay-input-errors-publication-verification.json`.

Zum Testen LUNA Shift Internal vollständig schließen, mit Internetverbindung öffnen und etwa 15 Sekunden warten; erneut vollständig schließen und öffnen. Dann die Netto-Angaben nochmals sichern und den konkreten Feldhinweis prüfen. Die Prüfung des ursprünglichen Eingabefalls, die Übernahme dieses Updates auf dem iPhone und ein Gerätenachweis stehen noch aus. Die bisherigen Steuer- und Versicherungsgrenzen wurden nicht gelockert.
