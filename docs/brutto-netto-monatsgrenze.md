# Netto-Prognose bei Diensten über die Monatsgrenze

## Auftrag und Scope

- Ziel: Ein Nachtdienst über die Monatsgrenze darf die automatische Netto-Prognose nicht sperren. Brutto und Zuschläge folgen derselben Monatszuordnung wie die Gehaltsauswertung.
- Nicht-Ziele: Änderung der Gehaltsauswertung, tatsächliche Arbeitgeber-Abrechnung, zusätzliche Eingaben, Steuer-/SV-Sätze, native Änderungen oder neue Veröffentlichung.
- Plattform: iOS Preview, bestehender Build 33; reine TypeScript-Fachlogik.
- Branch: `codex/brutto-netto-prototype`, bestehender Feature-Checkout.
- Dateiscope: `src/domain/net-pay-sfn.ts`, `src/engine/net-pay-sfn.ts`, beide Dienstplan-Prognosen `net-pay-automatic-forecast.ts` und `net-pay-tvoed-forecast.ts`, ihre beiden Tests, neuer SFN-Monatszuordnungstest, `src/features/salary/net-pay-sfn-forecast.component.test.tsx` und dieses Dokument. Der vorhandene Oberflächentest der bisherigen Sperre wird auf das neue Ergebnis umgestellt. Nach zwei vollständigen Testläufen wird zusätzlich die zeitabhängige Rückruf-Prüfung in `src/features/calendar/quick-entry-popup.component.test.tsx` stabilisiert; der Kalender-App-Code bleibt unverändert.
- Abnahme: Oktober-31-/November-1-Dienste sowie weitere Monatsgrenzen sind für alle acht derzeit unterstützten Gehaltsmodelle verfügbar; Zuschlagsbrutto stimmt centgenau mit der Gehaltsauswertung überein. Steuer-/SV-freie Anteile folgen den wirklichen Arbeitsminuten einschließlich Feiertagen und Sonntagen im Folgemonat. Ein Dienst wird nicht zusätzlich dem Folgemonat zugerechnet. Unvollständige Regeln, ungültige Zeiten und abweichendes Brutto bleiben gesperrt. Fokussierte Tests und `verify:fast` bestehen.
- Gerätenachweis: Neuer Screenshot vom Nutzer bestätigt die aktuelle vereinfachte Oberfläche und den noch bestehenden Fehler. Nach der Korrektur ist ein neuer Screenshot mit sichtbarer Prognose erforderlich.
- Commit, Push, Build: Nicht freigegeben. OTA: Nach separater Nutzerfreigabe am 10.10.2026 veröffentlicht; Nachweis unten.

## Befund vor Änderung

`selectMonthlyAnalysisEntries` ordnet einen Dienst über dessen Startdatum dem Monat zu (`src/features/analysis/analysis-data.ts:20`). Beide Netto-Prognosen übernehmen dieses Monatsbrutto, lehnen anschließend aber einen Dienst mit Arbeitszeit im Folgemonat ausdrücklich ab. Der gemeinsame SFN-Klassifizierer verlangt standardmäßig, dass bezahlte Zuschlagsminuten im Abrechnungsmonat liegen.

Für Dienstplan-Prognosen wird deshalb ausdrücklich eine Zuordnung nach Dienstbeginn eingeführt. Der vollständige Dienst bleibt in dem Monat, der auch sein Brutto enthält. Die Minuten für Nacht-, Sonntags- und Feiertagsprüfung bleiben unverändert auf ihren wirklichen Daten. Die bisherige explizite Zuordnung nach Zuschlagsminuten bleibt Standard für andere Rechner-Aufrufe. Die neue Zuordnung ist ausschließlich für geplante Arbeit erlaubt und lehnt Dienste mit Beginn in einem anderen Monat ab.

Expo wurde vor Änderung aus `package.json` geprüft: `~57.0.22`. Die passende [SDK-57-Dokumentation](https://docs.expo.dev/versions/v57.0.0/sdk/updates/) wurde gelesen.

## Separater Testfehler im vollständigen Gate

Der unveränderte Kalender-Test `releases the touch overlay immediately while its exit finishes` besteht separat, schlägt aber in beiden vollständigen Läufen fehl. Er setzt voraus, dass `onClose` beim Drücken bereits synchron ausgeführt ist. `useQuickEntryPopupMotion` setzt dagegen sofort `closing` und führt `onClose` erst über den Animationsabschluss und `runOnJS` aus (`src/features/calendar/use-quick-entry-popup-motion.ts:54`). Die sofortige Prüfung von `pointerEvents="none"` und der ausgeblendeten Accessibility-Fläche bleibt erhalten. Nur die Prüfung des Rückrufs wartet mit `waitFor` auf dessen tatsächliche Ausführung; keine Sleeps, gelockerten Erwartungen oder Kalender-App-Änderungen.

## Umsetzung und Prüfung am 10.10.2026

- Beide Dienstplan-Prognosen verwenden nun ausdrücklich `monthAttribution: "SHIFT_START"`; die zuvor pauschale Monatsgrenzen-Sperre entfällt. Der SFN-Klassifizierer behält `WORK_MINUTES` als Standard und erlaubt die neue Zuordnung nur für `PLANNED` und einen Dienstbeginn im Prognosemonat. Die Grenze von 26 Stunden, eindeutige IDs, Überschneidungsprüfung, Pausenausschluss, Zeitspuren und Brutto-Abgleich bleiben wirksam.
- 225 gezielte Fachtests bestehen, einschließlich fünf Monats-/Jahresgrenzen für alle acht unterstützten Gehaltsmodelle und Prüfung gegen doppelte Zuordnung in aufeinanderfolgenden Monaten. Die unabhängigen SFN-Erwartungen prüfen Nachtfortsetzung, verschiedene Steuer-/SV-Grenzen, reale Sonntage/Feiertage im Folgemonat und fehlende Feiertagsabdeckung am Jahreswechsel. Log: `artifacts/net-pay-month-boundary-focused.log`.
- 28 gezielte Oberflächentests bestehen; darunter die echte Netto-Berechnung am Monatsende und die Tests des verzögerten Animationsabschlusses. Log: `artifacts/net-pay-month-boundary-components-final.log`.
- `npm.cmd run verify:fast` besteht vollständig mit Exit 0: 8.173 Fachtests in 416 Dateien, 876 Oberflächentests in 115 Suiten sowie alle Regel-, Operator-, Audit-, Runtime- und Build-Abhängigkeitsprüfungen. Log: `artifacts/net-pay-month-boundary-verify-fast-complete.log`.
- Die neun Code-/Testdateien sind über SHA-256 festgehalten und nach dem Prüflauf unverändert: `artifacts/net-pay-month-boundary-source-hashes.json`. Der Vergleich mit dem vorherigen Vier-Schritte-Snapshot zeigt ausschließlich Änderungen in automatischer Prognose und zugehörigem Fachtest; alle elf weiteren dort erfassten Dateien bleiben identisch (`artifacts/net-pay-month-boundary-ui-preservation.json`). Graft ist aktualisiert.
- Vor der OTA-Freigabe war die Korrektur lokal vorbereitet; bis dahin wurde kein Commit, Push, Build oder neues EAS Update durchgeführt. Die zuvor veröffentlichte OTA-Gruppe `9a9dd838-ef67-4ec3-a59f-0fa5fa53a171` enthält diese Korrektur nicht. Die anschließend freigegebene Veröffentlichung ist unten dokumentiert.

## Freigegebene Preview-OTA

Der Nutzer hat am 10.10.2026 mit „ota“ die Veröffentlichung dieser geprüften Korrektur freigegeben. Ziel ist iOS Preview für den vorhandenen Build 33, mit `APP_VARIANT=internal`, Branch/Kanal `preview` und Umgebung `preview`. Der Scope ist der geprüfte Feature-Stand dieses Checkouts mit der Monatsgrenzen-Korrektur; es werden keine weiteren App-Änderungen umgesetzt. Für die Freigabe werden die noch unveränderten Prüfquellen, der vollständige Runtime-Fingerprint des Builds, der lokale Fingerprint sowie nach Veröffentlichung Kanal, Update-ID, Runtime, App-Kennung und die Identität des ausgelieferten Bundles geprüft. Git- und Store-Veröffentlichung sind nicht Bestandteil dieser Freigabe. Der Nachweis auf dem iPhone folgt nach Auslieferung.

### Veröffentlichung und Auslieferungsnachweis

- Veröffentlicht am **10.10.2026 um 03:44:16 MESZ** mit der Nachricht `Brutto-Netto: Monatsgrenzen automatisch zuordnen`.
- OTA-Gruppe: `26fc06d9-c356-4821-a55b-fd0518629475`; iOS-Update: `01a1237b-793a-7b25-9dd7-697a68faff69`. [EAS-Update](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/26fc06d9-c356-4821-a55b-fd0518629475).
- Plattform/Branch/Kanal/Umgebung: `ios` / `preview` / `preview` / `preview`; Kanal nicht pausiert. Der aktive Kanal und das unmittelbar abgerufene Manifest liefern exakt diese Update-ID.
- Preview-Build 33 `8deae8f8-679b-4284-978a-a07f74fa6719` ist live als `FINISHED`, Build-Profil `preview`, SDK `57.0.0`, App-Kennung `com.pflegeshift.app.internal` bestätigt. Runtime und Fingerprint von Build, lokalem Export und veröffentlichter OTA stimmen überein: `03d174d668f0ea5f757958dccf853632762c554d`.
- Alle 95 nativen Fingerprint-Quellen sind identisch mit dem bereits gesicherten Fingerprint des unveränderlichen Builds 33. Dessen Hash wurde erneut gegen die aktuellen EAS-Build-Metadaten geprüft; `build:view` liefert aktuell nur ID/Hash, keinen Download-Link für die Fingerprint-Quelldatei. Nachweis: `artifacts/net-pay-month-boundary-ota-fingerprint-summary.json`.
- Release-Konfiguration bestanden. Alle 1.332 erfassten App-, Regel-, Asset- und Konfigurationsdateien bleiben während Export und Veröffentlichung unverändert. Nachweise: `artifacts/net-pay-month-boundary-ota-release-check.log`, `artifacts/net-pay-month-boundary-ota-source-verification.json`.
- Das ausgelieferte Bundle ist bytegenau identisch mit dem EAS-Preview-Export und stimmt mit dem Manifest-Hash überein: **6.750.796 Bytes**, SHA-256 `3678508642f65a9b628194999c90dcd0267a95e32ec41e49b960d0ae3427f39b`. Nachweis: `artifacts/net-pay-month-boundary-ota-publication-verification.json`.
- Veröffentlichung mit `APP_VARIANT=internal` und `npx.cmd eas-cli@latest update --branch preview --platform ios --environment preview --input-dir artifacts/net-pay-month-boundary-ota-export --message "Brutto-Netto: Monatsgrenzen automatisch zuordnen" --json --non-interactive`. Metadaten: `artifacts/net-pay-month-boundary-ota-publish.json`, `artifacts/net-pay-month-boundary-ota-channel-summary.json`, `artifacts/net-pay-month-boundary-ota-updates-after.json`.
- Kein Commit, Push, neuer Build oder Store-Schritt. **iPhone-Abnahme noch offen:** App vollständig schließen, öffnen und etwa 15 Sekunden warten, erneut schließen und öffnen; dann die Oktober-Netto-Prognose mit dem monatsübergreifenden Dienst aufrufen und das sichtbare Ergebnis bestätigen.
