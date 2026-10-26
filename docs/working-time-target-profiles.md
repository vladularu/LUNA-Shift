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
| Komponententests                              | 1.395 Tests in 153 Suites bestanden                                                       |
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
- Der sichtbare Einstieg liegt unter Mehr > Arbeit > Sollzeitangaben. Der ältere Arbeitsprofil-Einstieg bleibt kompatibel erhalten. Bestehende Karten, Auswahlseiten, Eingabefelder und der Schutz ungespeicherter Änderungen werden verwendet. Wochenzeit/Arbeitsort sind sichtbare Eingabehilfen; Geltungsbeginn, Modell und Anspruchsbestätigungen werden nicht aus aktuellen Daten abgeleitet.

## Navigationskorrektur nach Geräte-Rückmeldung

Die erste D1-OTA enthielt den Zugang nur im älteren `WorkProfileScreen`. Der aktuelle Mehr-Tab rendert `SettingsScreen` und verlinkt diesen älteren Bildschirm nicht mehr. Die Nutzer-Rückmeldung, den Punkt trotz wiederholtem Öffnen der Internal-App nicht zu finden, wurde durch zwei gezielt rote Navigationstests bestätigt; das veröffentlichte Preview-Manifest lieferte bereits das erwartete D1-Update.

Korrekturscope: `settings-screen.tsx`, dessen bestehender Komponententest, `working-time-profile-screen.tsx`, dessen bestehender Komponententest und dieses Protokoll. Der neue RowButton liegt direkt unter Arbeitszeit & Ort in der vorhandenen Arbeit-Karte und bleibt unabhängig von der Gehaltswahl sichtbar. Ein Herkunftsparameter erhält die passende Zurück-Beschriftung: Mehr beim neuen Zugang, Arbeitsprofil beim älteren Zugang. Drei Regressionen prüfen sichtbaren Einstieg, Zielroute und beide Rückwege. Keine Rechen-, Speicher- oder native Änderung. Vollständiges `verify:fast`, PR-CI und passende Preview-OTA werden erneut geprüft; die visuelle iPhone-Abnahme bleibt offen.

## Verbleibende Abnahme und D2

Änderungen eines Arbeitgeberdienstplans außerhalb der App werden nicht automatisch erkannt. Die Bindung prüft den lokal bekannten Plan; sie ersetzt keine Arbeitgeberbestätigung oder ATOSS-Anbindung.

D1 ist eine Vorbereitung der Integration. Die bestehenden Auswertungen erhalten den gespeicherten Kontext hier noch nicht. Der Editor weist darauf hin. Das rechnerische Abnahmebeispiel bleibt 23 x 462 - 4 x 462 = 8.778 Minuten = 146:18 Stunden; das ist kein Nachweis einer bereits aktiven Anzeige oder eines Arbeitgeberanspruchs ohne die dokumentierten Voraussetzungen.

**Integrationsvertrag:** Berechnungen verwenden ausschließlich `snapshot.context` aus `loadWorkingTimeTargetSettings()`. `snapshot.saved.settings.context` enthält Originalnachweise, auch wenn sie inzwischen veraltet sind, und darf nicht direkt in die Berechnung gelangen.

D2 muss den nutzbaren Snapshot-Kontext einschließlich veralteter Tagesfakten durch alle Berechnungs- und Cachepfade reichen, Status/Hinweise und Abzugszeilen anzeigen und Widersprüche zu datierten Vergütungsstunden offenlegen. Bestehende globale Arbeitsort-/Wochenzeit-Editoren aktivieren keine historischen Sonderregeln. Weitere Tarife sind unverändert nicht durch diesen Adapter bestätigt.

Offen: Screenshot-/iPhone-Abnahme im passenden Preview-Build nach eigener Verteilungsfreigabe, insbesondere Auswahlseiten, Tastatur, lange Texte, Hell-/Dunkelmodus, Speichern/Zurück und Bearbeitung einer historischen Änderung. Der lokale Export ersetzt diese Abnahme nicht. Der ursprüngliche D1-Stand wurde separat per PR und Preview-OTA bereitgestellt. Die unten dokumentierte Renderkorrektur ist zunächst lokal; weitere Git- und Release-Schritte benötigen ihre eigene Freigabe.

## Dateiscope gegen A/B

50 Dateien: 18 Produktdateien, 31 Tests/Testhilfen einschließlich Jest-Konfiguration und diese Dokumentation. Der bestehende Sharing-Testlauf bindet die isolierten Cloud-Vertragstests ein; `package.json` bleibt gegenüber A/B unverändert. Die Vielzahl der bestehenden Testdateien folgt aus der expliziten Abwärtskompatibilität der Backup-Versionen. A/B-Dateien außer dem Validierungs-Reexport bleiben unverändert.

- `jest.config.js`
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
- `src/features/settings/settings-screen.tsx`
- `src/features/settings/settings-screen.component.test.tsx`
- `src/features/settings/work-profile-screen.component.test.tsx`
- `src/features/settings/work-profile-screen.tsx`
- `src/features/settings/working-time-profile-navigation.component.test.tsx`
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

## Renderfehler beim Öffnen des Editors (24.10.2026)

Die iPhone-Rückmeldung nach dem Tippen auf „Sollzeitangaben“ zeigte `APP_RENDER_FAILED`. Der globale Fehlerbildschirm speichert keine konkrete Fehlermeldung. Ein normaler Jest-Test mit echtem Expo Router und echtem Schutz ungespeicherter Änderungen blieb zunächst grün. Daraus durfte keine Gerätefreigabe abgeleitet werden.

Die lokale Reproduktion mit dem installierten Expo-SDK-57-Preset, iOS-/Hermes-Ziel und aktivem React Compiler scheiterte anschließend beim ersten Öffnen mit `ReferenceError: save is not defined`. Auch die dauerhaft ergänzte Jest-Konfiguration bestätigte den Fehler vor der Produktkorrektur. Im erzeugten JavaScript wurde die lokale Funktionsdeklaration in eine zwischengespeicherte `_save`-Deklaration verschoben, während die JSX-Callbacks und deren Cacheprüfung weiterhin auf `save` zugriffen. Der Referenzfehler entsteht damit schon beim Rendern, bevor gespeichert wird.

Die Produktkorrektur verwendet für genau diesen lokalen Callback eine gebundene asynchrone Pfeilfunktion. Fehlerbehandlung und Speicheroperation bleiben gleich. Der React Compiler bleibt aktiv; Abhängigkeiten, native Konfiguration, Berechnungen, Profile und gespeicherte Daten werden nicht verändert.

Dateiscope dieser Korrektur: `working-time-profile-screen.tsx`, `working-time-profile-navigation.component.test.tsx`, `jest.config.js` und dieses Protokoll. Die Jest-Konfiguration übersetzt ausschließlich die beiden Sollzeit-Editor-Module mit den genannten Produktionsoptionen. Damit laufen deren vorhandene Komponententests sowie der neue Navigationstest bei jedem `verify:fast` durch denselben Compilerpfad. Der Navigationstest prüft das Öffnen und Schließen eines leeren Hessen-Profils, das Speichern eines datierten Zeitraums sowie den echten Verwerfenschutz. Datenbankzugriffe bleiben dort gezielt gemockt; die Speicherung besitzt eigene Integrationstests.

Prüfstand dieser lokalen Korrektur:

| Prüfung                                               | Ergebnis                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Produktionskompilierter Regressionstest vor Korrektur | Rot: `ReferenceError: save is not defined`                                                 |
| Gezielte Editor-/Navigationstests nach Korrektur      | 15 Tests in 3 Suites grün                                                                  |
| `npm.cmd run verify:fast`                             | Exit 0, `VITEST_MAX_WORKERS=1`                                                             |
| Typecheck / ESLint / Formatierung / Diff              | Grün; ESLint mit 0 Warnungen                                                               |
| Unit-/Integrationstests                               | 9.195 Tests in 478 Dateien grün                                                            |
| Komponententests                                      | 1.398 Tests in 154 Suites grün                                                             |
| Node-Skriptprüfungen                                  | 208 Prüfungen grün, zusätzlich isolierter Cloud-Vertragstestlauf grün                      |
| `APP_VARIANT=internal npm.cmd run export:ios`         | Exit 0, aktiver React Compiler, echtes Hermes-Bytecode-Bundle                              |
| iOS-Fingerprint                                       | `d0daa823a2a0b0965e5a1c7462b2885570aab578`, passend zur bekannten Preview-Build-43-Runtime |
| Integrität des D1-Quellstands                         | 49 Quell-/Test-/Gate-Dateien vor und nach dem vollständigen Gate unverändert               |
| iPhone-Abnahme der Korrektur                          | Öffnen nach der Preview-OTA bestätigt; Bedienung vom Nutzer abgelehnt                      |

Das exportierte Hermes-Bundle `entry-6bcd8f8f0fe110b1bceeb281be2ecd1d.hbc` hat SHA-256 `0d68648cae86ca77069c8a7d2db17c42335dcf7fd9f515f4bbe50f602abec4fd`. Lokale Nachweise unter `C:/Users/veron/AppData/Local/Temp/`: `luna-sollzeit-d1-compiler-red.log`, `luna-sollzeit-d1-compiler-green.log`, `luna-sollzeit-render-fix-verify-fast.log`, `luna-sollzeit-render-fix-export-ios.log`, `luna-sollzeit-render-fix-fingerprint.json` und `luna-sollzeit-render-fix-acceptance.json`.

Eine echte iPhone-Abnahme bleibt erforderlich. Die lokale Reproduktion erklärt einen konkreten Fehler im veröffentlichten Quellstand; sie ersetzt keinen Geräte-Stacktrace und beweist nicht, dass auf dem Gerät keine weitere Ursache vorliegt. Die anschließende, separat freigegebene Preview-OTA ist im folgenden Abschnitt dokumentiert; eine Git-Auslieferung erfolgte dabei nicht. Das Vorgehen nutzt die [Expo-SDK-57-Dokumentation](https://docs.expo.dev/versions/v57.0.0/).

## Freigegebene Preview-Auslieferung der Renderkorrektur

Nach ausdrücklicher Freigabe wurde am 24.10.2026 um 17:49 Uhr (Europe/Berlin) ausschließlich das iOS-Preview-Update veröffentlicht:

- Kanal und Branch: `preview`; EAS-Environment: `preview`; App-Variante: `internal`.
- Ziel: Preview Build 43, Build-ID `12759847-a4c6-43fe-a3d9-790416eba2ee`. Der Build-Fingerprint wurde vor dem Upload erneut bei EAS geprüft.
- Update-Gruppe: `d78133a1-aa7f-45ec-8ab6-3d20ebac805e`.
- iOS-Update: `01a16e9a-0e5f-7c45-83cd-01b9d168090c`.
- Runtime: `d0daa823a2a0b0965e5a1c7462b2885570aab578`.
- [EAS-Update](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/d78133a1-aa7f-45ec-8ab6-3d20ebac805e).

Vor der Veröffentlichung wurde derselbe geprüfte Quellstand mit den bestehenden EAS-Preview-Variablen erneut exportiert. Die öffentliche Cloud-Konfiguration wurde dabei ausschließlich im Exportprozess bereitgestellt. Der anschließende Upload verwendete genau dieses vorhandene iOS-Bundle mit `--skip-bundler`. Die 49 Quell-/Test-/Gate-Dateien blieben unverändert. Die native Runtime blieb passend zu Build 43.

Das tatsächlich ausgelieferte Hermes-Bundle hat SHA-256 `6712c9df1a3aa6ff9e67cc7f7aa901336c029177cf1843662cce5ab44b06ae22` (Base64url: `ZxLJ3xo6pv-eZ8x_eqkBM2wCkXfPGENmLM5atEsGriI`). Das Preview-Manifest antwortete mit HTTP 200 und exakt der neuen Update-ID. Das Bundle und alle 52 Assets wurden aus dem CDN geladen und ihre SHA-256-Werte gegen Manifest und lokalen Export geprüft: 53 von 53 Dateien stimmen überein. EAS listet die neue Gruppe als neuestes iOS-Preview-Update mit passender Runtime.

Zusätzliche lokale Belege unter `C:/Users/veron/AppData/Local/Temp/`: `luna-sollzeit-render-fix-preview-acceptance.json`, `luna-sollzeit-render-fix-preview-fingerprint.json`, `luna-sollzeit-render-fix-preview-published-updates.json`, `luna-sollzeit-render-fix-preview-update-list.json` und `luna-sollzeit-render-fix-preview-cdn-verification.json`.

Die Korrektur bleibt ein lokaler, uncommitteter Stand auf `codex/tarif-sollzeit-profile`; Git-HEAD ist weiterhin `906497e1d706dc173b9dcd4d296dd25411513174`. Commit, Push, Merge, Native-Build und TestFlight-/Production-Auslieferung wurden nicht vorgenommen.

Am 24.10.2026 bestätigte der Nutzer mit Rückmeldung und iPhone-Foto, dass sich die Seite nach dieser OTA öffnen lässt. Ihre Bedienung wurde jedoch als zu kompliziert abgelehnt. Die daraus folgende Bedienkorrektur ist im nächsten Abschnitt dokumentiert und noch nicht auf dem iPhone abgenommen.

## Vereinfachte Bedienung nach iPhone-Rückmeldung (24.10.2026)

**Auftrag:** Der Nutzer bestätigt, dass sich die Sollzeitseite öffnet, lehnt ihre Bedienung jedoch als zu kompliziert ab. Das übermittelte iPhone-Bild zeigt einen gespeicherten Zeitraum und direkt darunter ein leeres neues Formular. Sichtbar sind technische Datums-/Zeitformate, zusätzliche Datumsfelder sowie eine Zurück-Leiste über dem unteren Formularbereich. Die Rückmeldung bestätigt das Öffnen, nicht die Gebrauchstauglichkeit oder fachliche Aktivierung der Berechnung.

**Scope:** iOS, vorhandener Preview Build 43; ausschließlich die beiden Sollzeit-Editor-Module, ihre drei Komponententests, `working-time-target-form-model.ts` samt Unit-Test und dieses Protokoll (acht Dateien dieser Bedienkorrektur). Die vorangegangene Renderkorrektur einschließlich ihrer Jest-Konfiguration bleibt erhalten. Keine Migration, neue Bibliothek, native Konfiguration oder Änderung der tariflichen Berechnungsregeln. Git-Auslieferung und eine weitere OTA sind eigene Freigabeschritte.

### Befund und neuer Ablauf

1. **Öffnen:** durch aktuelle Nutzer-Rückmeldung und Foto bestätigt. Die vollständige Bedienfolge und VoiceOver-/Tastaturbedienung wurden auf dem iPhone noch nicht unabhängig erfasst.
2. **Übersicht:** bisher steht unter einem gespeicherten Zeitraum sofort ein neues leeres Formular. Neu erscheint ausschließlich die Übersicht mit Wochenstunden, Arbeitszeitmodell, Arbeitsort und Gültigkeit. Erst ein Antippen öffnet die gespeicherten Angaben; neue Änderungen beginnen über eine eindeutige Hauptaktion.
3. **Einrichtung:** bisher erscheinen Basisdaten, Arbeitszeitmodell, Tarif, Eintritt/Austritt und Sonderfälle gemeinsam. Neu folgen drei Schritte: Arbeitszeit → Dienstplan → Tarif. Rückwärtsgehen erhält alle Eingaben; eine Speicherung erfolgt erst am Ende.
4. **Zusatzangaben:** Enddatum und Beschäftigungsgrenzen sind bei Bedarf einblendbar. Vorhandene Grenzen werden beim Bearbeiten vorausgefüllt und erhalten, auch wenn der Bereich danach geschlossen wird. Einzelne Feiertage/Sondertage sind von der Einrichtung getrennt und erst auf Anforderung sichtbar. Bei veralteten Tagesbestätigungen bleibt der Hinweis sichtbar.
5. **Speichern und Abbrechen:** nach erfolgreicher Speicherung erscheint wieder die Übersicht. Ein unberührtes Formular kann direkt geschlossen werden. Bei geänderten Eingaben schützt ein Verwerfendialog; die echte native Zurücknavigation wird weiterhin vom bestehenden Schutz behandelt.

Die Originalaufnahme liegt unverändert als lokaler, nicht versionierter Beleg unter `C:/Users/veron/.codex/visualizations/2026/10/23/01a1695b-99c8-7a50-91f0-e2e6590f02d7/sollzeit-ux/01-sollzeit-bestand.jpg`. Die Beurteilung der Ausgangsansicht beruht auf dieser bereitgestellten Aufnahme und der aktuellen Ablaufimplementierung. Sie ist keine vollständige Geräte- oder Barrierefreiheitsabnahme.

### Daten- und Anspruchsschutz

- Bekannte Wochenstunden und Arbeitsort sind weiterhin Eingabehilfen aus dem Arbeitsprofil. Das historische Anfangsdatum wird nicht geraten.
- Wochenstunden können als `38,5` oder `38.5` angegeben werden; bisherige `38:30`-Eingaben bleiben lesbar. Dezimalstunden werden auf die nächste ganze Minute gerundet. Die Anzeige mit zwei Dezimalstellen erhält beim erneuten Speichern jeden bisherigen ganzzahligen Wochenminutenwert von 1 bis 10.080.
- Datumsangaben sind als `01.01.2026` beziehungsweise `1.1.2026` möglich; bisherige ISO-Eingaben bleiben kompatibel. Speicherung und Validierung verwenden unverändert ISO-Daten ohne Zeitzonenumrechnung.
- Modell, Arbeitgeber-Monatsbasis, Sieben-Tage-Schichtplan und Tarifgeltung bleiben getrennte Angaben. Ein unbekannter Wert erzeugt keine bestätigte Voraussetzung. „Modell später klären“ ist eine ausdrückliche Nutzeraktion, die ein offenes Modell speichert.
- Vorhandene Tarifversionen, explizites Nein und unbekannte Geltung bleiben erhalten. Eine ungeprüfte Version erhält keinen Geprüft-Hinweis.
- Stundenverteilung auf feste Tage wird nur nach ausdrücklicher Auswahl befüllt. Fehlende ausgefallene Stunden eines Feiertags werden weiterhin nicht erfunden; null und null Minuten bleiben verschieden.
- Vorherige und zukünftige Zeiträume sowie Originalnachweise einzelner Tage bleiben durch die unveränderte Speicher- und Historienlogik geschützt.
- Die Eingabeseite aktiviert weiterhin keine neue Sollzeitberechnung in der Monatsauswertung. Dieser Vorbereitungsstatus steht auf der Übersicht.

### Prüfung und Abnahme

Die Regression für die bisherige Startansicht wurde vor der Umsetzung rot nachgewiesen. Danach sind 27 gezielte Komponententests mit Produktionskompilierung und 28 Eingabe-/Historientests grün, einschließlich echter Expo-Router-Navigation, erneutem Bearbeiten nach Abbruch sowie erhaltenem Schutz späterer Zurücknavigation.

Der erste vollständige Lauf stoppte an einem ungenutzten Import im angepassten Navigationstest. Dieser Import wurde entfernt. Der abschließende vollständige Lauf ist erfolgreich:

| Prüfung                                        | Ergebnis                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| Gezielte Übersicht-/Formular-/Navigationstests | 27 Tests in 3 Suites grün, mit Produktionskompilierung                         |
| Eingabe- und Historientests                    | 28 Tests grün                                                                  |
| `npm.cmd run verify:fast`                      | Exit 0, `VITEST_MAX_WORKERS=1`                                                 |
| Typecheck / ESLint / Formatierung / Diff       | Grün, 0 ESLint-Warnungen                                                       |
| Unit-/Integrationstests                        | 9.218 Tests in 478 Dateien grün                                                |
| Komponententests                               | 1.410 Tests in 154 Suites grün                                                 |
| Node-Skriptprüfungen                           | 208 Prüfungen und zusätzlicher isolierter Cloud-Vertragstestlauf grün          |
| iOS-Hermes-Export mit Preview-Environment      | Exit 0, React Compiler aktiv                                                   |
| Runtime-Fingerprint                            | Unverändert `d0daa823a2a0b0965e5a1c7462b2885570aab578`, passend zu Build 43    |
| Quellintegrität                                | 49 D1-Quell-/Test-/Gate-Dateien bei Export und abschließendem Gate unverändert |
| Neue iPhone-Sicht- und Funktionsprüfung        | Offen                                                                          |
| Weitere OTA / Git-Auslieferung                 | iOS-Preview-OTA nach Freigabe veröffentlicht; Git-Auslieferung nicht erfolgt   |

Finales lokales Bundle: `entry-1fc494ef44798d0c63e33e8cfd09ef40.hbc`, SHA-256 `5554650d8c83b76ce8c056187d674b6882b283de682ee35d0cc7457e063025eb`. Die vorhandene EAS-Preview-Konfiguration wurde für den lokalen Export und die anschließend freigegebene Preview-Auslieferung verwendet. Keine Variablenwerte wurden in die Dokumentation übernommen.

Zusätzliche lokale Nachweise unter `C:/Users/veron/AppData/Local/Temp/`: `luna-sollzeit-ux-red.log`, `luna-sollzeit-ux-components.log`, `luna-sollzeit-ux-input-tests.log`, `luna-sollzeit-ux-verify-fast-final.log`, `luna-sollzeit-ux-preview-export-final.log`, `luna-sollzeit-ux-preview-fingerprint.json` und `luna-sollzeit-ux-preview-acceptance.json`.

Die visuelle und funktionale Abnahme des vereinfachten Ablaufs auf dem iPhone steht aus, insbesondere Übersicht, Schritte vor/zurück, Tastatur, Abbrechen, Bearbeiten vorhandener Angaben sowie Auswahlseiten in Hell-/Dunkelmodus und mit großer Schrift. Tests und Export ersetzen diese Prüfung nicht. Die anschließend freigegebene Preview-OTA ist im folgenden Abschnitt dokumentiert.

## Freigegebene Preview-Auslieferung der vereinfachten Bedienung

Nach ausdrücklicher Freigabe wurde am 24.10.2026 um 18:58 Uhr (Europe/Berlin) ausschließlich die neue iOS-Preview-OTA für Build 43 veröffentlicht:

- Kanal, Branch und EAS-Environment: `preview`; App-Variante: `internal`.
- Ziel: Preview Build 43, Build-ID `12759847-a4c6-43fe-a3d9-790416eba2ee`; Kanalzuordnung und Build-Fingerprint wurden vor der Veröffentlichung erneut bei EAS geprüft.
- Update-Gruppe: `5ecce922-49d2-4f06-9dd8-40faa32685ae`.
- iOS-Update: `01a16ed9-5fc9-7f44-a5d1-c4ff042120cc`.
- Runtime: `d0daa823a2a0b0965e5a1c7462b2885570aab578`, unverändert und passend zu Build 43.
- [EAS-Update](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/5ecce922-49d2-4f06-9dd8-40faa32685ae).

Der Upload verwendete den zuvor geprüften Preview-Export mit `--skip-bundler`. Das ausgelieferte Hermes-Bundle besitzt SHA-256 `5554650d8c83b76ce8c056187d674b6882b283de682ee35d0cc7457e063025eb` (Base64url: `VVRlDYyDt2zowFYYfWdLaIKyg95oLuNdDMdFfgYwJes`). Das Preview-Manifest antwortete mit HTTP 200 und exakt der neuen Update-ID. Bundle und alle 52 Assets wurden aus dem CDN geladen und gegen Manifest und lokalen Export geprüft: 53 von 53 Dateien stimmen überein. EAS listet diese Gruppe als neuestes iOS-Preview-Update.

Zusätzliche lokale Belege unter `C:/Users/veron/AppData/Local/Temp/`: `luna-sollzeit-ux-preview-channel.json`, `luna-sollzeit-ux-preview-build43.json`, `luna-sollzeit-ux-preview-publish.json`, `luna-sollzeit-ux-preview-update-list.json` und `luna-sollzeit-ux-preview-cdn-verification.json`. Der bereits dokumentierte vollständige Prüflauf bleibt gültig; die 49 Quell-/Test-/Gate-Dateien wurden vor der Auslieferung unverändert bestätigt.

Die neue Bedienung ist noch nicht auf dem iPhone abgenommen. Zur Übernahme der OTA: Internal-App vollständig schließen, öffnen und etwa 15 Sekunden warten; danach erneut schließen und öffnen. Anschließend unter Mehr → Arbeit → Sollzeitangaben die Übersicht und die dreistufige Einrichtung prüfen. Die Angaben bleiben Vorbereitung für die spätere Berechnungsintegration. Git-HEAD bleibt `906497e1d706dc173b9dcd4d296dd25411513174`; Commit, Push, Merge, Native-Build und TestFlight-/Production-Auslieferung erfolgten nicht.

## Beschäftigung aus der Auswertung und Wiederverwendung vorhandener Daten (24.10.2026)

Auftrag: Die Arbeitszeitkarte in der Auswertung öffnet die Beschäftigungsangaben. Wochenstunden und Arbeitsort werden sichtbar aus dem vorhandenen Profil übernommen und nicht erneut abgefragt. Die Seite erklärt den Einfluss auf Sollzeit, Feiertage und tarifliche Sondertage. Nur nicht belegte Voraussetzungen benötigen eine gezielte Ergänzung.

Paket U: iOS/Preview, bestehender Feature-Branch codex/tarif-sollzeit-profile. Scope: month-overview.tsx samt Analyse-Regression, working-time-profile-screen.tsx samt Komponenten-/Navigationstest, working-time-target-editor.tsx samt Komponententest, working-time-target-form-model.ts samt Unit-Test und dieses Protokoll (zehn Dateien dieses Pakets). Vorhandene historische Angaben bleiben erhalten. Die erfasste Dienstfolge bestätigt weder einen vollständigen Arbeitgeberdienstplan noch allein einen Tarifanspruch. Keine native Integration, Datenmigration oder neue Tarifregel.

Paket D2 bleibt eine getrennte Integration der nutzbaren Snapshot-Daten in Monats-/Jahresauswertung, Kalender und Export. Dieses Paket U aktiviert die Berechnung nicht stillschweigend. Die Abnahme unterscheidet den Zugang und die Datenerfassung von der späteren Berechnungsintegration.

Abnahme U: Arbeitszeitkarte öffnet die Seite mit dem ausgewählten Monat und passendem Rückweg; bekannte Wochenstunden/Arbeitsort bleiben im Hauptfluss ohne Eingabefelder; Änderungen führen zum vorhandenen Arbeitsprofil-Editor; neue historische Geltung bleibt ausdrücklich; Tarifvorschläge bestätigen keinen Anspruch; bestehende Zeiträume und Tagesnachweise bleiben erhalten; Produktionskompilierung, Navigation, gezielte Regressionen und verify:fast prüfen. Die anschließende iOS-Preview-OTA wurde separat freigegeben und ist unten dokumentiert. Git- und Build-Auslieferung sind nicht freigegeben.

Die Beschäftigungsseite ermittelt offene Feiertagstage für den ausgewählten Monat aus der bestehenden zentralen Engine und dem nutzbaren Snapshot-Kontext. Ein Antippen übernimmt Datum und vorhandene Dienstplaneinträge als vorläufigen Vorschlag; Nachtüberträge benutzen die vorhandene zeitbezogene Dienstaufteilung. Leere Tage, Urlaub/Krankheit und widersprüchliche Frei-/Diensteinträge bleiben ungeklärt. Ausgefallene Stunden, eine endgültige Arbeitgeberplanung und die Verpflichtung zu Arbeit an anderen Tagen werden nicht geraten. Bestätigte oder veraltete Tagesdaten werden durch Kalender-Vorschläge nicht überschrieben.

### Ergebnis des Pakets U

- Die Arbeitszeitkarte der Monatsauswertung öffnet Beschäftigung mit dem gewählten Monat. Der Rückweg bleibt bei der Auswertung; der vorherige Mehr- und Arbeitsprofilzugang bleibt kompatibel.
- Wochenstunden, Bundesland und hinterlegte Vergütungswahl werden sichtbar übernommen. Änderungen an aktuellen Basisdaten führen zum bestehenden Editor. Für ausdrücklich abweichende historische Zeiträume bleibt eine Zusatzfunktion erhalten.
- Die normale Ergänzung ist eine Seite mit den noch offenen Angaben. Bestehende Geltungsdaten, bestätigte Arbeitszeitmodelle und positive oder negative Tarifbestätigungen werden nicht erneut abgefragt. Ein Tarifvorschlag bleibt von der Bestätigung seiner Arbeitszeitregel getrennt.
- Für einen ausdrücklich als frei eingetragenen Kalendertag wird ein vorläufiger Frei-Vorschlag erstellt. Ein Kalendertag ohne Eintrag bleibt ungeklärt. Widersprüche und Abwesenheiten ergeben keine automatisch bestätigte Dienstplanlage.
- Gezielte Fach-/Eingabe-/Historientests: 66 Tests in zwei Dateien grün. Der neue Fragen-/Navigationsfall ist in der Produktionskompilierung geprüft; die gezielte Bildschirm-Suite umfasst 13 grüne Tests. Der vollständige Lauf ist separat protokolliert.
- Eine Vorprüfung stoppte wegen zweier doppelter Typimporte; sie wurden zusammengeführt. Ein zusätzliches Test-Suchmuster war zu stark maskiert und wurde korrigiert. ESLint prüft danach ohne Warnungen.
- Lokaler Preview-iOS-Export mit vorhandenem EAS-Environment: Exit 0, React Compiler aktiv und Hermes-Bytecode geprüft. Runtime d0daa823a2a0b0965e5a1c7462b2885570aab578 bleibt kompatibel zur bereits verifizierten Build-43-Runtime.
- Exportiertes Bundle: entry-f5bf22c3218406be4915015e033968d2.hbc, SHA-256 2801f788a794faa10b166221853492ce33d590d0b7826073864a5e2294c933f2; 52 Assets. Das Prüfmanifest umfasst 51 D1- und Auswertungs-Quell-/Test-/Gate-Dateien.
- Lokale Belege unter C:/Users/veron/AppData/Local/Temp/: luna-employment-ux-red.log, luna-employment-ux-components-final.log, luna-employment-ux-pending-day.log, luna-employment-ux-unit.log, luna-employment-ux-verify-fast-final.log, luna-employment-ux-export-ios.log, luna-employment-ux-fingerprint.json und luna-employment-ux-acceptance.json.
- Noch offen: neue iPhone-Abnahme sowie Paket D2 einschließlich historischer Vergütungsstunden, Konfliktanzeige und identischem Ergebnis in Monats-/Jahresauswertung, Kalender und Export. Die aktuelle iPhone-Aufnahme bestätigt den vorherigen Drei-Schritt-Stand; sie nimmt diesen neuen Beschäftigungsfluss nicht ab.
- Dieser Stand wurde nicht committet oder gepusht. Die nachfolgend dokumentierte Preview-OTA wurde nach eigener Freigabe veröffentlicht und ersetzt im Preview-Kanal die vorherige Version 5ecce922-49d2-4f06-9dd8-40faa32685ae.

### Abschließendes Qualitätsgate für U

Der abschließende vollständige Lauf von verify:fast ist mit Exit 0 beendet: Typecheck, ESLint mit null Warnungen, Formatprüfung, 9.224 Unit-/Integrationstests in 478 Dateien, 1.417 Komponententests in 154 Suites und sämtliche Node-Skriptprüfungen grün. Alle 51 erfassten Quell-/Test-/Gate-Dateien stimmen nach Testlauf und Export mit dem Prüfmanifest überein. Die übrigen D1-Dateien einschließlich Jest-Konfiguration wurden gegenüber der vorherigen UX-OTA nicht verändert. Das lokale Hermes-Bundle bleibt unverändert; Paket U wurde anschließend für die Preview-Geräteprüfung freigegeben und verteilt. Die Berechnungsintegration D2 bleibt offen.

## Freigegebene Preview-Auslieferung der Beschäftigungsseite

Nach ausdrücklicher Nutzerfreigabe wurde am 24.10.2026 um 19:54 Uhr (Europe/Berlin) ausschließlich die iOS-Preview-OTA für Build 43 veröffentlicht:

- Kanal, Branch und EAS-Environment: preview; App-Variante: internal.
- Ziel: Preview Build 43, Build-ID 12759847-a4c6-43fe-a3d9-790416eba2ee. Die Kanalzuordnung und der Build-Fingerprint wurden unmittelbar vor dem Upload erneut bei EAS geprüft.
- Update-Gruppe: 3d87ea05-296d-4d70-a2d6-d860d0be8f95.
- iOS-Update: 01a16f0c-af25-7103-a0cd-eac8c563a3dc.
- Runtime: d0daa823a2a0b0965e5a1c7462b2885570aab578, passend zu Build 43.
- [EAS-Update](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/3d87ea05-296d-4d70-a2d6-d860d0be8f95).

Der Upload nutzte genau den getesteten Preview-Export mit --skip-bundler. Die 51 erfassten Quell-/Test-/Gate-Dateien und das lokale Bundle blieben unverändert. Das ausgelieferte Hermes-Bundle besitzt SHA-256 2801f788a794faa10b166221853492ce33d590d0b7826073864a5e2294c933f2 (Base64url: KAH3iKeU-qELFmIhhTSSzjPVkNC3gmBzhkpeIpTJM_I). Das Preview-Manifest antwortete mit HTTP 200 und exakt der neuen Update-ID. Bundle und alle 52 Assets wurden aus dem CDN geladen und gegen lokalen Export und Manifest geprüft: 53 von 53 Dateien stimmen überein. EAS listet diese Gruppe als neuestes iOS-Preview-Update.

Lokale Auslieferungsbelege unter C:/Users/veron/AppData/Local/Temp/: luna-employment-ux-preview-channel.json, luna-employment-ux-preview-build43.json, luna-employment-ux-preview-publish.json, luna-employment-ux-preview-update-list.json und luna-employment-ux-preview-cdn-verification.json. Das vorhandene Akzeptanzprotokoll luna-employment-ux-acceptance.json wurde um die Verteilungsnachweise ergänzt.

Die neue Sicht- und Funktionsprüfung auf dem iPhone bleibt offen. Zur Übernahme: Internal-App vollständig schließen, öffnen und etwa 15 Sekunden warten, erneut schließen und öffnen; anschließend Auswertung → Arbeitszeit → Beschäftigung prüfen. Wochenstunden und Arbeitsort sollen bereits sichtbar sein und zu ihrem bestehenden Editor führen. Die Berechnungsintegration D2 bleibt offen; diese OTA ändert die angezeigte Monatssollzeit noch nicht. Git-HEAD bleibt 906497e1d706dc173b9dcd4d296dd25411513174. Commit, Push, Merge, Native-Build und TestFlight-/Production-Auslieferung wurden nicht vorgenommen.

## Geräte-Rückmeldung: Paket U nicht abgenommen – Automatik vor Abfrageseite

Am 24.10.2026 nach der Preview-OTA 3d87ea05-296d-4d70-a2d6-d860d0be8f95 wurde die Beschäftigungsseite auf dem iPhone angezeigt, vom Nutzer jedoch wegen Informationsmenge, wiederholter Angaben und Tagesabfragen ausdrücklich abgelehnt. Dies ist keine Bedienabnahme. Die beiden bereitgestellten Fotos zeigen die langen Basis-/Historien-/Feiertagslisten sowie eine rote Prüfungsmeldung für den 03.10.2026.

### Geprüfte Ursache

Die bestehende App fragt bereits Wochenstunden, Arbeitsort/Feiertagsregion und Tarifwahl ab. Für das Schichtmodell werden außerdem „Wird dein Arbeitsbereich rund um die Uhr betrieben?“ (mit Erläuterung 24/7) und „Gehört das Schichtmodell dauerhaft zu deiner Stelle?“ gespeichert. Diese Angaben werden in der neuen Sollzeitseite nicht gemeinsam zur Einordnung verwendet. Die Monatsauswertung erhält den nutzbaren Sollzeitkontext weiterhin nicht. Die bisherige Oberflächenarbeit hat die eigentliche Integrationslücke nicht geschlossen.

Die weitere Frage „Ist Sonn- und Feiertagsarbeit für deine Tätigkeit erlaubt?“ beschreibt eine rechtliche Zulässigkeit, nicht den vollständigen individuellen Dienstplan. Sie darf nicht allein in einen sicheren §-49-Anspruch umgedeutet werden. Auch Arbeitsplatz-24/7 allein bestätigt nicht jede persönliche Arbeitszeitverteilung.

Die rote Meldung berücksichtigt aktuell jede veränderte Tagesbindung, einschließlich bereits vorläufiger Tagesangaben. Ein solcher Vorbereitungszustand darf im normalen Nutzerfluss nicht als dringender Fehler dargestellt werden. Eine erneute Bestätigung gehört nur zu tatsächlich betroffenen, zuvor belastbaren Angaben und muss den konkreten Berechnungseffekt erklären.

### Neuer Produkt- und Integrationsrahmen

- Normalfall: Die Auswertung zeigt Soll, Ist und Saldo. Die vorhandenen Profil-, Tarif-, Schichtmodell- und Dienstplandaten werden zentral zusammengeführt; keine zusätzliche Grunddatenerfassung.
- Ein Antippen der Sollzeit öffnet eine kurze, aufklappbare Erklärung der Rechnung mit einem unaufdringlichen Änderungszugang. Keine technische Profilhistorie, Versionsverwaltung oder pauschale Tagesprüfliste im normalen Ablauf.
- Bereits beantwortete 24/7-/Dauerhaftigkeitsfragen werden für alle passenden Berechnungen wiederverwendet. Eine bloße Rückfragekopie macht vorhandene Angaben nicht belastbarer.
- Nur wenn eine tatsächlich benötigte Information fehlt, folgt eine kurze Alltagfrage am passenden Ort. Die bestehende Einrichtung soll die persönliche Arbeitszeitverteilung eindeutig erfassen; bestätigte Antworten werden wiederverwendet.
- Die Engine wendet verifizierte Tarifregeln automatisch an. Unbekannte individuelle Tatsachen werden nicht erfunden. Bei Unsicherheit bleibt die Rechnung erkennbar vorläufig; nur entscheidende Ausnahmen benötigen eine Ergänzung.
- Historische Daten und bisher gespeicherte Nachweise bleiben erhalten. Änderungen des heutigen Profils dürfen frühere Monate nicht stillschweigend umschreiben.
- Nächste technische Pakete: D2a gemeinsamer Adapter vorhandener Daten und gezielte Konfliktauflösung; D2b identische Anbindung an Monats-/Jahresauswertung, Kalender und Export; anschließend Ablösung der abgelehnten Abfrageseite durch die kurze Rechnungserklärung. Abnahme umfasst den TVöD-K-Referenzfall und sinnvolle Bestandsdatenfälle.

### Fachliche Grenze der Automatik

Erneut gelesen wurden BT-K § 49 Abs. 2 (Fassung 01.01.2026), TVöD-AT § 6 Abs. 3 (Fassung 01.01.2026) und BAG 6 AZR 143/16, insbesondere Rn. 27/28. Die Feiertagsregel verlangt den persönlichen regelmäßigen Schicht-/Wechselschichtplan über sieben Tage und die betreffende Arbeitspflicht oder planmäßige Freizeit mit anderweitiger Erfüllung der Arbeitszeit. Bei 24./31. Dezember sind die individuell dienstplanmäßig ausgefallenen Stunden maßgeblich. Deshalb kann die Automatik vorhandene Tatsachen wiederverwenden; sie kann fehlende ausgefallene Stunden nicht allein aus der Berufsbezeichnung oder einem 24/7-Arbeitsplatz beweisen.

Diese Prüfung hat den Quellcode und die veröffentlichte OTA nicht verändert. Eine weitere Veröffentlichungsfreigabe ist nicht erteilt. Die nächste Änderung soll zuerst die automatische Berechnungsgrundlage herstellen und die genannten Abnahmekriterien erfüllen.

## D2 – Automatische Datenversorgung und Auswertungsintegration (24.10.2026)

Ziel: vorhandene datierte Arbeitszeitangaben und Vergütungsprofile in der zentralen Sollzeit-Engine verwenden; Monats-, Jahres-, Kalender- und Exportberechnungen erhalten dieselbe Berechnungsgrundlage. iOS / Expo SDK 57, keine native Änderung.

Arbeitspakete: (1) separater, ausschließlich flüchtiger Berechnungsprofil-Adapter und Datenversorgung, (2) sämtliche Auswertungs-Einstiege und Fehlerbehandlung anbinden, (3) normale Beschäftigungsseite auf Ergebnis, kurze Erklärung und bedarfsgerechte Bearbeitung reduzieren. Die vorhandenen Detailformulare bleiben für Korrekturen erhalten.

Nicht-Ziele: weitere Tariffamilien freischalten, Zuschlags-/Gehaltsregeln ändern, destruktive Migration, Git-/OTA-/Store-Auslieferung. Bestehende A/B- und D1-Arbeit im Feature-Checkout bleibt erhalten. Dateiscope: zentrale Sollzeit-/Profil-Datentypen, Adapter/Provider/Port, Auswertungs-Einstiege, Beschäftigungsseite, zugehörige Tests und diese Dokumentation. Mehr als 15 Dateien werden in diesen getrennten Paketen bearbeitet.

Abnahme: bestätigter TVöD-K-Referenzfall Dezember 2026 = 8778 Minuten / 146:18; offene Voraussetzungen bleiben vorläufig; fehlende oder widersprüchliche Historie ist sichtbar und erzeugt keinen Renderabsturz. Keine zusätzlichen Iststunden oder veränderten Gehaltszuschläge. Cache und Dienstplanänderungen berücksichtigen die Sollzeitgrundlagen. Keine erneute Wochenstunden-/Bundeslandabfrage im normalen Einstieg. Geräteabnahme und Veröffentlichung bleiben separate Schritte.
