# D1 – Datierte Sollzeitprofile

## Task-Vertrag

Ziel: Arbeitszeitmodell, Arbeitsort/Feiertagsregion, unabhängige Tarifgeltung und explizite Tagesvoraussetzungen dauerhaft und datiert speichern. A/B bleibt die einzige Sollzeit-Engine.

Nicht-Ziele: automatische Aktivierung der Berechnung, neue Tarifregeln, Änderung von Gehalt/Zuschlägen, Auswertungen oder Exportdarstellung, Merge und Verteilung.

Plattform: bestehende offlinefähige Expo-SDK-57-App, insbesondere iOS. Keine neue native Konfiguration oder Bibliothek. Referenz: [Expo SQLite SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/).

Branch: `codex/tarif-sollzeit-profile`, auf `fd4e093` aus PR #309 (noch ungemergte A/B-Abhängigkeit; `origin/master` beim Start: `ab259916`). Hauptcheckout und PR-Branch bleiben unverändert. Die anschließende Nutzerfreigabe „Oke mach das“ umfasst Commit, Push, einen eigenen abhängigen PR und die kompatible iOS-Preview-OTA für die Geräteabnahme. Merge, ein neuer nativer Build, TestFlight und Produktion sind nicht freigegeben.

D1 wird vor Änderungen in zwei prüfbare Schritte geteilt:

1. **D1a Speicherung:** versionierter Kontextvertrag, transaktionale Speicherung mit Konflikterkennung, historische Zeiträume, planbezogene Bestätigungen, additive Migration sowie vollständiger Backup-/Restore-Rundlauf. Scope: Domainvertrag/Validierung, Repository/Migration, vorhandene Backup-Pfade und unmittelbar betroffene Tests.
2. **D1b Eingabe:** eigener kleiner Editor im vorhandenen Arbeitsprofil, vorhandene Formular-/Kartenbausteine, historisches Gültigkeitsdatum, wenige explizite Bestätigungen. Scope: Settings-Screen/Formular/Hook und Navigation samt Komponenten-/Formulartests. Visuelle iPhone-Abnahme bleibt separat erforderlich.

Abnahme: keine impliziten Ansprüche bei fehlenden Daten; keine Rückdatierung aus aktuellem Profil; keine Überschreibung bestehender Zeiträume beim Anlegen neuer Angaben; ungültige/fremde Versionen und Schreibkonflikte sichtbar ablehnen; Bestandsbackup ohne Sollzeitdaten bleibt lesbar; Backup mit Sollzeitdaten restauriert Daten atomar; geänderte Dienstplaneinträge machen betroffene Bestätigungen vorläufig; Dezember 2026 bleibt nach Speicherung und Restore unter expliziten Voraussetzungen 8.778 Minuten. `verify:fast`, fokussierte Regressionen und iOS-Export prüfen.

## Entscheidungen

- Vergütungswahl und 24/7-Prüfprofil belegen weder BT-K-Geltung noch die individuelle Arbeitszeitverteilung. Sie aktivieren keine Regel.
- Bereits vorhandene Wochenstunden/Arbeitsort können als sichtbare Eingabehilfe verwendet werden. Erst ausdrücklich datiert gespeicherte Angaben sind historische Sollzeitdaten. Datierte Vergütung bleibt eigenständig; D2 muss widersprüchliche Wochenstunden sichtbar machen, statt einen Wert still zu bevorzugen.
- Das Fehlen gespeicherter Sollzeitdaten bedeutet Legacy-Verhalten. Vor einem bestätigten Zeitraum entsteht keine künstliche Historie.
- Sondertage bleiben von gesetzlichen Feiertagen getrennt. Tagesbestätigungen sind keine geleisteten Arbeitsstunden.

## Prüfprotokoll

| Prüfung                                       | Ergebnis                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Typecheck                                     | Grün (`tsc --noEmit`)                                                                     |
| ESLint                                        | Grün, 0 Warnungen                                                                         |
| Format / `git diff --check`                   | Grün                                                                                      |
| Finale `verify:fast`                          | Exit 0, seriell mit `VITEST_MAX_WORKERS=1`                                                |
| Unit-/Integrationstests                       | 9.195 Tests in 478 Dateien bestanden                                                      |
| Komponententests                              | 1.392 Tests in 153 Suites bestanden                                                       |
| Node-Skriptprüfungen                          | 219 einschließlich der elf isolierten Cloud-Vertragstests und ihres Gate-Aufrufs          |
| Dezember 2026 nach Speicherung und Restore    | 8.778 Minuten = 146:18, explizite BT-K-/7-Tage-/Tagesvoraussetzungen                      |
| iOS-JavaScript-/Hermes-Export                 | Exit 0, `APP_VARIANT=internal npm.cmd run export:ios`                                     |
| Quellprüfsummen                               | 45 Quell-/Test-/Gate-Dateien gegen finales SHA-256-Manifest unverändert                   |
| Graft-Kontextgraph                            | Aktualisiert, lokaler ignorierter Cache                                                   |
| iPhone / Screenshot / signierter Native-Build | Offen, nicht durch lokale Tests oder Export ersetzt                                       |
| Git-/Release-Auslieferung                     | Nach Nutzerfreigabe eigener abhängiger PR und kompatible iOS-Preview-OTA; Nachweise im PR |

Die gezielte Regression wurde zunächst rot (fehlendes Repository) und anschließend grün ausgeführt. Ein zusätzlicher Fall prüft, dass importierte ungeprüfte Tariffassungen auch im Editor keinen Geprüft-Hinweis erhalten. Auf diesem Stand wurde das gesamte Gate erneut erfolgreich ausgeführt. Der validierte Anwendungscode blieb bis nach dem Export unverändert; die neue lokale RPC-Regressionsprüfung ist über das vorhandene `test:sharing-security` dauerhaft im Gate eingebunden.

Die anschließende Preview-Vorprüfung fand genau eine Fingerprint-Abweichung: die ergänzte Test-Skriptzeile in `package.json`. Die Zeile wurde wiederhergestellt; der bestehende Sharing-Testlauf startet die elf Cloud-Vertragstests stattdessen in einem isolierten Node-Prozess und schlägt bei deren Fehlschlag fehl. Testabdeckung und native Fingerprint-Prüfung bleiben erhalten. Der gesamte schnelle Testlauf wird für diese Gate-Anbindung erneut geprüft. Keine Runtime wird manuell überschrieben.

Lokale Belege unter `$env:TEMP`: `luna-sollzeit-d1-verify-fast-final.log`, `luna-sollzeit-d1-export-ios.log`, `luna-sollzeit-d1-cloud-contract.log`, `luna-sollzeit-d1-source-final.json`. Geprüft wurde der lokale SQL-/Dokumentvertrag; keine Live-Supabase-Abnahme und keine iPhone-Abnahme.

## Umgesetzte Speicherung und Eingabe

- Eine leere additive Migration 34 legt `working_time_target_settings` an. Keine Bestandsdaten werden aus Arbeits- oder Gehaltsprofilen kopiert. Der Kontextvertrag hat eine eigene Version 1.
- Die unveränderte fachliche Eingabevalidierung liegt gemeinsam in der Domain; der bisherige Engine-Import bleibt als Reexport kompatibel. Speicherung und Berechnung benutzen dieselbe Validierung.
- Ein Kontext enthält datierte Zeiträume mit Wochenminuten, Arbeitsort/Feiertagsregion, Modell und unabhängiger Tarifgeltung. Optional sind explizite Beschäftigungsgrenzen vorhanden. Lücken bleiben unbekannt.
- Einfügen eines Zeitraums erhält frühere und bereits gespeicherte zukünftige Angaben. Zeitlich begrenzte Änderungen erhalten auch den anschließenden bisherigen Zeitraum. Korrekturen benutzen das vorhandene Anfangsdatum und einen optimistischen Snapshot-Vergleich.
- Tagesfakten speichern Dienstplanstatus, Arbeitspflicht/dienstplanfrei/Freistellung, bestätigten Arbeitsausfall und die unabhängige Bedingung, regelmäßige Arbeitszeit an anderen Tagen erbringen zu müssen. Null und null Minuten sind verschieden.
- Endgültige Tagesfakten benötigen eine explizite tagesbezogene Speicheraktion. Ihre Bindung umfasst die anwendbaren Arbeitszeitangaben, Beschäftigungsstatus, Zeitzone sowie revisionsgebundene aktive Dienste des Tages und Vortages (Nachtübertrag). Änderungen machen den aktiven Kontext vorläufig. Unveränderte Originalnachweise bleiben gespeichert; eine andere Profilkorrektur bestätigt sie nicht erneut.
- Transaktionen verhindern Teilwrites. Konkurrenzprüfung vergleicht Revision, Zeitstempel und vollständigen Inhalt. Eine Dienstplanänderung während der Bearbeitung verlangt Neuladen. Offene Testlaborläufe blockieren das Speichern.
- Backup 21 umfasst die neue Sammlung und prüft Schema, Elternprofil, Version, Singleton, Zeitfolge, JSON-Inhalt und Prüfsumme. Restore ist atomar. Backups 1 bis 20 erzeugen keine Sollzeitangaben. Ältere App-Versionen können neue Backups sicher ablehnen.
- Der bestehende private Cloud-Dokumentvertrag umfasst dieselbe Sammlung. Version-20-Cloudstände bleiben lesbar; unbekannte Felder und künftige Versionen werden abgelehnt. Die Sammlung wird als zusammenhängender Datensatz behandelt: konkurrierende Änderungen werden als Konflikt sichtbar, nicht nach Gerätezeit entschieden. Der unveränderte versionierte RPC-Vertrag (Migration `20261017211850_private_cloud.sql`, Zeilen 117-135) akzeptiert die neue Backup-Metadatenversion; elf lokale PGlite-Vertragstests mit Auth-/Sitzungs-/Kontogrenzen sind grün. Der Live-Server wurde nicht abgefragt. Keine Servermigration oder Änderung von Zugriffsrechten wurde vorgenommen.
- Der Einstieg liegt im Arbeitsprofil unter Sollzeitangaben. Bestehende Karten, Auswahlseiten, Eingabefelder und der Schutz ungespeicherter Änderungen werden verwendet. Wochenzeit/Arbeitsort sind sichtbare Eingabehilfen; Geltungsbeginn, Modell und Anspruchsbestätigungen werden nicht aus aktuellen Daten abgeleitet.

## Verbleibende Abnahme und D2

Änderungen eines Arbeitgeberdienstplans außerhalb der App werden nicht automatisch erkannt. Die Bindung prüft den lokal bekannten Plan; sie ersetzt keine Arbeitgeberbestätigung oder ATOSS-Anbindung.

D1 ist eine Vorbereitung der Integration. Die bestehenden Auswertungen erhalten den gespeicherten Kontext hier noch nicht. Der Editor weist darauf hin. Das rechnerische Abnahmebeispiel bleibt 23 x 462 - 4 x 462 = 8.778 Minuten = 146:18 Stunden; das ist kein Nachweis einer bereits aktiven Anzeige oder eines Arbeitgeberanspruchs ohne die dokumentierten Voraussetzungen.

**Integrationsvertrag:** Berechnungen verwenden ausschließlich `snapshot.context` aus `loadWorkingTimeTargetSettings()`. `snapshot.saved.settings.context` enthält Originalnachweise, auch wenn sie inzwischen veraltet sind, und darf nicht direkt in die Berechnung gelangen.

D2 muss den nutzbaren Snapshot-Kontext einschließlich veralteter Tagesfakten durch alle Berechnungs- und Cachepfade reichen, Status/Hinweise und Abzugszeilen anzeigen und Widersprüche zu datierten Vergütungsstunden offenlegen. Bestehende globale Arbeitsort-/Wochenzeit-Editoren aktivieren keine historischen Sonderregeln. Weitere Tarife sind unverändert nicht durch diesen Adapter bestätigt.

Offen: Screenshot-/iPhone-Abnahme im passenden Preview-Build nach eigener Verteilungsfreigabe, insbesondere Auswahlseiten, Tastatur, lange Texte, Hell-/Dunkelmodus, Speichern/Zurück und Bearbeitung einer historischen Änderung. Der lokale Export ersetzt diese Abnahme nicht. Commit, Push, neuer PR, Merge und Verteilung sind noch nicht erfolgt.

## Dateiscope gegen A/B

46 Dateien: 17 Produktdateien, 28 Tests/Testhilfen und diese Dokumentation. Der bestehende Sharing-Testlauf bindet die isolierten Cloud-Vertragstests ein; `package.json` bleibt gegenüber A/B unverändert. Die Vielzahl der bestehenden Testdateien folgt aus der expliziten Abwärtskompatibilität der Backup-Versionen. A/B-Dateien außer dem Validierungs-Reexport bleiben unverändert.

- `app/working-time-profile.tsx`
- `docs/working-time-target-profiles.md`
- `supabase/tests/sharing-security.test.mjs`
- `src/domain/private-cloud.ts`
- `src/domain/saved-working-time-target.test.ts`
- `src/domain/saved-working-time-target.ts`
- `src/domain/working-time-target-test-fixtures.ts`
- `src/domain/working-time-target-validation.ts`
- `src/engine/working-time-target-input.ts`
- `src/features/settings/use-working-time-target-settings.component.test.tsx`
- `src/features/settings/use-working-time-target-settings.ts`
- `src/features/settings/work-profile-screen.component.test.tsx`
- `src/features/settings/work-profile-screen.tsx`
- `src/features/settings/working-time-profile-screen.component.test.tsx`
- `src/features/settings/working-time-profile-screen.tsx`
- `src/features/settings/working-time-target-editor.component.test.tsx`
- `src/features/settings/working-time-target-editor.tsx`
- `src/features/settings/working-time-target-form-model.test.ts`
- `src/features/settings/working-time-target-form-model.ts`
- `src/infrastructure/database/allowance-decision-repository.test.ts`
- `src/infrastructure/database/annual-payment-repository.test.ts`
- `src/infrastructure/database/caritas-annual-backup.test.ts`
- `src/infrastructure/database/local-backup-restore.test.ts`
- `src/infrastructure/database/local-backup-restore.ts`
- `src/infrastructure/database/local-backup-validation.ts`
- `src/infrastructure/database/local-backup.test.ts`
- `src/infrastructure/database/local-backup.ts`
- `src/infrastructure/database/migration-34-working-time-target.ts`
- `src/infrastructure/database/migrations.ts`
- `src/infrastructure/database/net-pay-profile-backup.test.ts`
- `src/infrastructure/database/overtime-allocation-repository.test.ts`
- `src/infrastructure/database/paid-absence-backup.test.ts`
- `src/infrastructure/database/private-cloud-repository.test.ts`
- `src/infrastructure/database/remuneration-migration-test-fixture.ts`
- `src/infrastructure/database/remuneration-profile-repository.test.ts`
- `src/infrastructure/database/remuneration-storage-integration.test.ts`
- `src/infrastructure/database/simple-app-profile.test.ts`
- `src/infrastructure/database/tariff-annual-backup.test.ts`
- `src/infrastructure/database/training-repository.test.ts`
- `src/infrastructure/database/tvl-shift-work-test-fixtures.ts`
- `src/infrastructure/database/working-time-target-backup.test.ts`
- `src/infrastructure/database/working-time-target-repository.test.ts`
- `src/infrastructure/database/working-time-target-repository.ts`
- `src/infrastructure/database/youth-protection-preference.test.ts`
- `src/infrastructure/private-cloud/cloud-document.ts`
- `supabase/tests/private-cloud-security.test.mjs`
