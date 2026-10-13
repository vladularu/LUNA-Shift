# Kalender teilen: bestätigter Umsetzungsauftrag

Datum: 12.10.2026. Nutzer: „Oke machen wir so. Setze das um. Du hast alle Freigaben bis zur Build“.

Ziel: optionale Apple-/Google-Konten, gezielte Lesefreigabe des eigenen Kalenders, Einladungen/Bestätigung/Widerruf, getrennte Darstellung fremder Kalender und robuste Offline-Veröffentlichung gemäß bestätigtem Plan.
Nicht-Ziele: Store-Veröffentlichung, öffentliche Kalender, externe Google-Kalender-Berechtigungen, gemeinsame Bearbeitung, vollständige private Cloud-Backups, neue Premium-Regeln oder Änderungen an Tarif-/Netto-/Zuschlagsberechnungen.
Plattform: iPhone / Expo SDK 57. Die zuletzt bestätigte UI, aktuelle LS-Startgrafik und vorbereitete 6-/14-Tage-Widgets werden in diesem isolierten codex/calendar-sharing-mvp-Checkout zusammengeführt. Ursprungscheckouts bleiben erhalten.

Scope/WP: (0) Zusammenführung und Task-Vertrag; (1) supabase/ Migrationen/RPCs/echte PostgreSQL-Sicherheitstests; (2) src/infrastructure/auth und Konten; (3) zusätzliche DB-Tabellen/Port/Outbox/Cache/Sharing-Projection; (4) src/features/sharing und Routen plus bestehende Navigation/Kalender nur als Darstellung; (5) Reviews, verify:fast/full, konfigurierte Preview-Cloud, Provider und gemeinsamer interner iOS-Build. Über 15 Dateien: getrennte Pakete, Eigentümerbereiche und lokale Checks.

Freigaben: Implementierung und notwendige Schritte bis einschließlich internem Build durch den Nutzer freigegeben. Kein Store-Schritt. Keine zusätzlichen laufenden Abokosten ohne konkreten Betrag/Entscheidung. Kein Merge ohne CI und erforderliche Geräteabnahme. Plan-Gate des orch-add-feature-Skills ist durch die direkte Nutzerbestätigung erfüllt; Freigaben werden nicht erneut pauschal abgefragt.

Abnahme: Anmeldung/Abbruch/Abmeldung, kein stiller lokaler Datenverlust; nur freigegebene sichere DTO-Felder im Server; unberechtigte/ausgeloggte/revozierte Nutzer und lesende Teilnehmer können nicht schreiben; Links einmalig/befristet und benötigen explizite Annahme plus Eigentümerbestätigung; Offline-Änderungen/Löschungen kommen nach Wiederverbindung an; fremde Einträge verändern keine Auswertung; Monats-/Scrollzustand und Dark/Dynamic Type passen; vorhandene Exporte, Widgets und Daten bleiben funktionsfähig. Echte Zwei-iPhone-Abnahme bleibt vor finaler Release-/Merge-Aussage erforderlich.

Cloud-Befund: Die separat freigegebene Pro-Organisation LUNA Cloud und das Projekt LUNA Sharing Preview in Frankfurt sind eingerichtet. Die bestehenden Regelprojekte bleiben unverändert. Migration, Eigentümer-/Leserechte, Provider, Rücksprungziele und tägliche Bereinigung wurden separat eingerichtet und geprüft; Details stehen in `calendar-sharing-preview-operations.md`. Zugangsdaten hat der Nutzer direkt übernommen. Bei der Einrichtung wurden keine privaten Dienstplandaten hochgeladen.

## GitHub-Übergabe des abgenommenen Beta-Stands am 13.10.2026

Der Nutzer hat „commit pr push und merge auf github“ ausdrücklich freigegeben. Ziel ist die GitHub-Übergabe des gemeinsamen, auf dem iPhone bestätigten TestFlight-Stands 0.1.0 (5) auf `codex/calendar-sharing-mvp`. Die Arbeitspakete umfassen die bereits zusammengeführten Gehalts-/Auswertungs-/Exportkorrekturen, optionale Konten und Kalenderfreigabe mit getrenntem Backend sowie native Widgets und die Startgrafik. Keine erneute Build-, OTA- oder Store-Veröffentlichung ist Teil dieser Übergabe.

Der Dateiscope ist der geprüfte lokale Integrationsdiff gegenüber `origin/master`: App-/Abhängigkeitskonfiguration, betroffene UI-/Theme-Dateien, Sharing-Domain/Runtime/Auth/DB/Cloud, Widget-Integration, Supabase-Quellen samt Tests und zugehörige Dokumentation. Lokale Zugangsdaten, signierte Pakete, Diagnoselogs und generierte Artefakte bleiben ausgeschlossen. Unabhängige Ursprungscheckouts bleiben unverändert.

Abnahmekriterien: unveränderter abgenommener App-Code, geprüfter exakter Staging-Scope ohne Zugangsdaten, `verify:fast` und aufgabenspezifische Prüfungen erfolgreich, PR-CI auf dem finalen Commit vollständig grün und anschließender Merge ausschließlich über die PR nach `master`. Die vorhandene Gerätebestätigung für TestFlight umfasst Daten/Appstart, vier Widget-Ansichten und Apple-/Google-Anmeldung; sie steht in `testflight-build-41.md` und `calendar-sharing-device-acceptance.md`.

Die ausdrückliche aktuelle Merge-Freigabe gilt für diesen Beta-Integrationsstand. Der eigenständige Zwei-iPhone-Sharing-Test, authentifizierte Kontolöschung und automatischer Apple-Widerruf bleiben dokumentierte Folgeprüfungen; diese Übergabe behauptet dafür keine Geräteabnahme. Google bleibt auf die eingerichteten Testkonten beschränkt, öffentliche HTTPS-Einladungslinks sind ein Folgepaket.
