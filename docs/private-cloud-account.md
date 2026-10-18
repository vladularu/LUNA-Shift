# Persönliches LUNA-Cloud-Konto

Stand: 18.10.2026. Status: Umsetzung im isolierten Branch `codex/private-cloud-account`; privater Serverbereich und täglicher Aufbewahrungsjob in `LUNA Sharing Preview` aktiv. Ein kompatibles iOS-Preview-OTA ist über die separate Veröffentlichungskopie `codex/private-cloud-preview-ota` ausgeliefert; die sichtbare Übernahme und Zwei-iPhone-Geräteabnahme stehen aus. Anmeldung vorerst ausschließlich über Apple und Google; E-Mail-Konten sind auf ausdrücklichen Nutzerwunsch pausiert.

## Bestätigtes Ziel

Ein persönliches Konto sichert die eigenen Daten und synchronisiert sie zwischen Geräten. Nach der letzten Nutzerentscheidung erfolgt die Anmeldung vorerst nur über Apple und Google. Auf allen Geräten muss dieselbe Anbieteridentität verwendet werden; die Kontowiederherstellung erfolgt über Apple beziehungsweise Google. Die ursprünglich gewünschte zusätzliche E-Mail-/Passwort-Anmeldung ist vorbereitet, bleibt aber ausgeblendet, bis Mailversand und Wiederherstellung geprüft sind. Eine eigene Domain oder ein SMTP-Konto sind für die aktuelle Apple-/Google-Fassung nicht erforderlich.

Der Nutzer hat Anbieter-Verschlüsselung mit Kontowiederherstellung ohne separaten Wiederherstellungsschlüssel gewählt. Das ist keine Ende-zu-Ende-Verschlüsselung.

Supabase beschreibt die [Anbieter-Verschlüsselung](https://supabase.com/security#data-encryption) mit AES-256 für gespeicherte Daten und TLS für die Übertragung. Diese Anbieterangabe ersetzt keine unabhängige Prüfung des Betriebs oder der Wiederherstellbarkeit.

Bestätigte Sicherungshistorie: Der aktuelle Cloud-Stand bleibt immer erhalten. Zusätzlich höchstens eine ältere Sicherung je Kalendertag (Europe/Berlin) für 30 Kalendertage einschließlich heute. Wiederholungsbelege enthalten nur Revision, Zeitpunkt und Prüfsumme und bleiben für Offline-Wiederholungen bis zur Kontolöschung bestehen.

Die lokale SQLCipher-Datenbank bleibt offline nutzbar. Vorhandene Freigabekonten werden verwendet; für dieselbe Person wird kein zweites Cloud-Konto vorausgesetzt. Private Cloud-Daten sind ausschließlich dem angemeldeten Eigentümer zugänglich. Eine Kalenderfreigabe erhält dadurch keine zusätzlichen Inhalte.

## Scope und Arbeitspakete

Zielplattform: iPhone, Expo SDK 57 (`~57.0.22`). Die Cloud-Verträge werden plattformunabhängig gestaltet; eine Android-Auslieferung ist kein Bestandteil dieses Auftrags.

1. Datenvertrag und Synchronisationskern: vollständige versionierte persönliche Snapshots, eindeutige Revisionen, Wiederholungsschutz, Konfliktbehandlung und Tests.
2. Server: versionierte Supabase-Migration, Eigentümerzugriff, atomare Revisionsprüfung, Sicherungshistorie und lokale PostgreSQL-Sicherheitstests.
3. Lokale Anbindung: kontogebundener Ausgangsstand, Schutz vor konkurrierenden Schreibvorgängen, Offline-Wiederholung, sichere Wiederherstellung und Integrationstests.
4. Konto und Oberfläche: Apple-/Google-Anmeldung, Cloud-Status und ausdrückliche Auswahl bei Erstübernahme und Konflikten. E-Mail-Verifizierung und Passwort-Wiederherstellung bleiben als pausierte Erweiterung vorbereitet.
5. Gemeinsame Prüfung: aufgabenspezifische Tests, `verify:fast`, aktualisierter Kontextgraph und dokumentierte externe Abnahme.

Erlaubter Dateiscope: neue Cloud-Module in `src/domain/`, `src/infrastructure/`, `src/application/`, `src/features/private-cloud/`, zugehörige Routen, gezielte Konto-/Navigationsintegration, Supabase-Migrationen/-Tests und diese Dokumentation. Änderungen an Backup-/Wiederherstellungshelfern nur, soweit sie für atomare und vollständige Übernahme erforderlich sind. Keine Änderungen an Tarifberechnungen, Kalendergestaltung oder Widgets.

Implementierung, lokale Prüfungen und additive Einrichtung im identifizierten Testprojekt gehören zum aktuellen Funktionsauftrag. Git-Commit, Push, Build, OTA, Store-Schritt und bezahlte Dienste sind weiterhin separate Freigaben. Domainkauf und SMTP-Einrichtung sind auf Nutzerwunsch pausiert.

## Erforderliche Abnahmekriterien

- AC-001 Konto: Apple- und Google-Anmeldung verwenden die bestehende persönliche Identität. E-Mail-Felder, Registrierung und Passwort-Wiederherstellung werden in der aktuellen Oberfläche nicht angeboten. Nachweis: Auth-/Komponententests und spätere echte Anbieterprüfung auf zwei iPhones. E-Mail-Freigabe benötigt später zusätzlich reale Mail-/Recovery-Prüfungen.
- AC-002 Vollständigkeit: Ein vollständiger eigener Datenstand mit Diensten, Terminen, Notizen, Vorlagen, Arbeits-/Gehalts-/Steuerprofilen, gespeicherten persönlichen Tarifangaben, Einstellungen und Kalenderfoto lässt sich auf einer leeren Testinstallation wiederherstellen. Tokens, fremde Kalender-Caches, Testlabor und Geräteschlüssel werden nicht übertragen. Nachweis: synthetischer Roundtrip und iPhone-Abnahme.
- AC-003 Erste Zuordnung: Beim ersten Aktivieren oder Kontowechsel werden lokale Daten niemals ohne ausdrückliche Auswahl einem anderen Konto zugeordnet oder durch dessen Cloud-Stand ersetzt. Nachweis: Runtime- und Komponententests mit zwei Konten.
- AC-004 Offline: Nach offline gespeicherten Änderungen und einem Neustart erfolgt bei erneuter Verbindung ein Abgleich. Fehlgeschlagene oder doppelte Uploads verlieren keine Änderungen und erzeugen keinen zweiten logischen Schreibvorgang. Nachweis: Runtime-/Server-Tests.
- AC-005 Parallelität: Änderungen verschiedener Geräte werden auf Basis eines gemeinsamen Ausgangsstands abgeglichen. Widersprüchliche Änderungen werden sichtbar zur Auswahl gestellt; Geräte-Uhrzeiten entscheiden nicht über Datenverlust. Nachweis: Zwei-Geräte-Simulation sowie reale Zwei-iPhone-Prüfung.
- AC-006 Datenschutz: Fremde und abgemeldete Konten können weder persönliche Sicherungen lesen noch verändern. Kontowechsel beendet laufende Übernahmen. Nachweis: tatsächliche PostgreSQL-Tests und Runtime-Tests.
- AC-007 Wiederherstellung: Vor dem Ersetzen bleibt eine Rückkehr zum bisherigen Stand möglich; ein Fehler lässt bestehende Nutzerdaten erhalten. Ein offener Testlaborlauf verhindert den Austausch. Nachweis: SQLite-Integrationstests.
- AC-008 Integration: Bestehende Anmeldung, Kalenderfreigabe, lokale Sicherungen und die Offline-Nutzung bleiben funktionsfähig. Nachweis: fokussierte Regressionstests und `npm.cmd run verify:fast`.

## Externe Nachweise

Der private Serverbereich ist im bestehenden Testprojekt eingerichtet und anhand seiner Rechte und des aktiven Jobs überprüft. Das kompatible iOS-Preview-OTA ist veröffentlicht und seine Auslieferung bestätigt. Für eine abgenommene Beta folgen reale Tests mit zwei Geräten einschließlich Apple-/Google-Anmeldung. Speicherauslastung, Rate-Limits und Infrastrukturkosten bleiben vor öffentlicher Freigabe zu prüfen. Mailzustellung und SMTP sind für die pausierte E-Mail-Erweiterung offen und blockieren die Apple-/Google-Abnahme nicht.

## Umsetzung und Betriebsvertrag

- Der bestehende persönliche Supabase-Client und die bestehende Kontenidentität werden verwendet; die Regelkatalog-Projekte bleiben getrennt. Unterschiedliche Apple-/Google-/E-Mail-Identitäten werden nicht anhand eines Anzeigenamens zusammengeführt. Gleiche oder verknüpfte Identität ist anhand der serverseitigen Benutzer-ID zu prüfen.
- Die pausierte E-Mail-Erweiterung bleibt im Quellcode mit `EMAIL_ACCOUNT_ENABLED = false` ausgeschaltet. Neue Passwörter benötigen bei späterer Freigabe mindestens 12 Zeichen und müssen das [Supabase-Limit von 72 UTF-8-Bytes](https://github.com/supabase/auth/blob/master/internal/api/password.go) erfüllen. Bestehende kürzere Passwörter bleiben für die Anmeldung verwendbar. Passwörter werden weder getrimmt noch gekürzt.
- Persönliche Snapshots decken alle 25 Bereiche des Backup-Vertrags v20 ab, zusätzlich das aktive Kalenderfoto und dessen Darstellung. Fotos werden als Inhalt übertragen. Anmeldetokens, Schlüssel, Testlabor, fremde Freigabe-Caches und lokale Dateipfade werden nicht übertragen.
- Während die App auf einem sicheren Bildschirm im Vordergrund ist, erfolgt alle 30 Sekunden sowie bei der Rückkehr zur App ein Abgleich. In Editoren und bei offenen Testlabor-Daten wird nicht übernommen. iOS-Hintergrundausführung oder sofortige Push-Zustellung sind nicht zugesagt.
- Nach einer tatsächlichen Übernahme fremder Geräteänderungen wird die App neu geladen, damit alle bestehenden Profil- und Einstellungsanbieter denselben Stand verwenden. Verhalten und sichtbarer Übergang sind auf dem iPhone abzunehmen.
- Nicht widersprüchliche Änderungen werden anhand eines gemeinsamen Ausgangsstands zusammengeführt. Löschung gegen Bearbeitung sowie gleiche widersprüchliche Felder benötigen eine Auswahl. Wenn ein kombinierter Stand die vollständige Backup-Validierung nicht besteht, wird die Auswahl eines vollständigen Datenstands verlangt.
- Uploads erhalten eine dauerhaft gespeicherte Mutations-ID und eine erwartete Serverrevision. Veraltete Schreibversuche werden zurückgewiesen. Die Wiederholung einer bereits bestätigten Mutation bleibt auch nach der Bereinigung alter Sicherungsinhalte eindeutig.
- Vor einer Cloud-Übernahme bleibt der bisherige Gerätestand verschlüsselt in SQLCipher als Rückkehrsicherung erhalten. Eine zwischenzeitliche lokale Änderung verhindert das Ersetzen. Normale JSON-Imports heben die private Cloud-Zuordnung auf und verlangen eine neue ausdrückliche Auswahl.
- Serverseitig sind aktuelle Sitzung, Benutzerstatus, bestätigte E-Mail-Identität und erwartete Benutzer-ID vor jedem persönlichen Zugriff zu prüfen. Daten- und Wiederholungsbelege werden bei einer echten Kontolöschung über Fremdschlüssel entfernt.
- Technische Größenlimits: 16 MiB JSON-Text pro Cloud-Dokument, davon höchstens 8 MiB Base64 für das Foto. Die persönliche Datenstruktur muss zusätzlich die bestehenden lokalen Backup-Grenzen erfüllen. Die historische Sicherungsliste enthält höchstens 31 Stände. Mehrbyte-Zeichen werden am Server auch nach tatsächlicher Bytelänge begrenzt.

## Bereitstellung in der Testumgebung

1. Das persönliche Supabase-Projekt identifizieren und den tatsächlichen Migrationsstand mit den vorhandenen Sharing-Migrationen vergleichen. Nicht auf einem Regelkatalog-Projekt anwenden.
2. Die neue Migration `supabase/migrations/20261017211850_private_cloud.sql` ist in der bestätigten Testumgebung angewendet. Cloud-/Sharing-Rechte zusätzlich mit zwei echten Testkonten prüfen.
3. Aktuelle Fassung: Apple-/Google-Anmeldung auf zwei iPhones prüfen. Für eine spätere E-Mail-Freigabe sind die Vorlagen `supabase/email/private-cloud-confirm.html` (Betreff: „LUNA Shift: E-Mail bestätigen“) und `supabase/email/private-cloud-recovery.html` (Betreff: „LUNA Shift: Passwort zurücksetzen“) bereits im Dashboard gespeichert; die serverseitige Passwort-Mindestlänge ist auf 12 gesetzt. Die Vorlagen enthalten `{{ .Token }}`; die App nimmt keine beliebigen Mail-Links oder Tokens aus Router-Parametern an. Reale Zustellung, Ablauf, Wiederholung, Passwortwechsel und Zweitgerät bleiben ungeprüft. SMTP ist nicht eingerichtet. Der Nutzer besitzt noch keine Domain und hat die E-Mail-Erweiterung pausiert. Vor späterer Aktivierung sind geeigneter Versand, Auth-/RPC-Rate-Limits und der Passwortleckschutz zu prüfen.
4. Täglichen Aufbewahrungsjob aus `supabase/operations/private-cloud-retention.sql` gezielt einrichten und prüfen. Der Job verwendet den privilegierten Kontext; App-Nutzer können keine globale Bereinigung aufrufen. Schreibvorgänge bereinigen zusätzlich nur die eigenen älteren Sicherungen. Anbieter-Backups haben einen getrennten Lebenszyklus; die App-Historie ersetzt deren Betriebsprüfung nicht.
5. Vor einer App-Auslieferung den konkreten Kanal/Runtime-Wert prüfen. Git-Weitergabe, Build und OTA bleiben getrennte Freigaben.
6. Auf zwei iPhones Erstzuordnung, Verlust-/Neugeräte-Restore, Profil/Netto/Foto, parallele Offline-Änderungen, echte Konflikte, widerrufene Sitzung, Konto-Wechsel und Kontolöschung abnehmen. Erst danach den Status als nutzbare und abgenommene Cloud-Beta bezeichnen.

## Abgleich mit dem Testprojekt

Am 17.10.2026 über die verbundene Supabase-Anbindung bestätigt: `LUNA Sharing Preview` (`flpwvfqywvnvhfkjbcnf`) ist aktiv in Frankfurt (`eu-central-1`), PostgreSQL 17.11. Die drei vorhandenen Sharing-Migrationen `202610120001`, `202610130001` und `202610130002` waren bereits angewendet. Die additive private Migration wurde mit der tatsächlich vergebenen Version `20261017211850` angewendet; der lokale Dateiname entspricht dem Serververlauf. `pgcrypto` und `pg_cron` sind vorhanden. Der bestehende Sharing-Aufbewahrungsjob bleibt aktiv. Der neue private Job `luna-private-cloud-retention` ist aktiv mit `17 2 * * *`. Es wurden keine privaten Nutzerdaten gelesen oder hochgeladen.

Die Rechteprüfung liefert: drei private Tabellen mit RLS; kein anonymer RPC-Zugriff, kein direkter Schema-Zugriff für `anon` oder `authenticated`, kein globaler Bereinigungsaufruf für App-Nutzer. Die öffentlichen Cloud-RPCs prüfen Sitzung und Eigentümer. Die Informationsmeldungen über fehlende direkte RLS-Policies entsprechen dem beabsichtigten verweigerten Tabellenzugriff; die authentifizierten SECURITY-DEFINER-RPCs sind der kontrollierte Zugang.

Im angemeldeten Dashboard wurden die beiden deutschen Code-Mail-Vorlagen gespeichert und visuell geprüft sowie die Passwort-Mindestlänge auf 12 gesetzt. E-Mail-Bestätigung ist aktiv, die Code-Länge beträgt acht Ziffern bei einer Stunde Gültigkeit. Der eingebaute E-Mail-Versand bleibt eingeschränkt; eigenes SMTP wurde nicht aktiviert. Apple und Google sind als Anbieter aktiviert. Die E-Mail-Oberfläche ist nach der anschließenden Nutzerentscheidung ausgeschaltet; SMTP und Domain bleiben pausiert.

Die bestehenden Serverprüfungen kontrollieren Benutzerstatus, Sitzung und deren Ablauf. Die Sicherheitsprüfung meldet außerdem bereits vor dieser Änderung deaktivierten [Schutz gegen bekannte Passwortlecks](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) und [Ausführungsrechte auf die verwaltete Funktion](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) `public.rls_auto_enable()`. Bei Letzterer sind Rückgabetyp `event_trigger` und aktive Event-Trigger-Registrierung bestätigt; diese Bestandsmeldung ist gesondert einzuordnen. Die beabsichtigten authentifizierten Sharing-RPCs werden ebenfalls pauschal als privilegierte Funktionen gelistet. Der Passwortleckschutz ist laut Supabase ab Pro verfügbar; ein kostenpflichtiger Tarifwechsel ist nicht erfolgt.

`supabase/operations/private-cloud-verification.sql` wurde nach Aktivierung erfolgreich ausgeführt und liest ausschließlich Metadaten über die neuen Tabellen, Rechte und den täglichen Job. Die reale Konto- und Geräteprüfung bleibt zusätzlich erforderlich.

## Lokale Prüfungen

Der unveränderte Gesamtstand vor dem anschließenden Ausblenden der E-Mail-Oberfläche bestand TypeScript, ESLint, Prettier, Coverage, Produktions-Audit, Release-Prüfung und Expo-Exporte für Web, Android und iOS. Unit-Coverage: 455 Dateien, 8.774 Tests; Komponenten: 138 Suites, 1.134 Tests. Unit-Coverage: 92,02 % Statements, 89,63 % Branches, 96,18 % Funktionen, 93,54 % Zeilen. Der frühere vollständige `verify:fast`-Lauf und die PostgreSQL-Sicherheitstests waren ebenfalls erfolgreich.

Nach der Nutzerentscheidung zur E-Mail-Pause bestand auch der endgültige Stand einschließlich Anbieter-Auswahl und des mit dem Server abgeglichenen Migrationsdateinamens die gezielten Tests und `verify:fast`: 456 Unit-Dateien mit 8.775 Tests, 138 Komponenten-Suites mit 1.134 Tests und 213 zusätzliche Node-Tests. Alle zehn privaten PostgreSQL-Sicherheitstests sind enthalten. TypeScript, ESLint, Formatierung, Architektur-/Regelprüfungen und `git diff --check` sind erfolgreich. Anschließend waren auch der erneute iOS-Export und die Release-Konfigurationsprüfung erfolgreich. Die Quellcode-Prüfsummen blieben während dieses Laufs unverändert. Der Kontextgraph wurde aktualisiert.

Die Prüfprotokolle liegen lokal unter `.expo/private-cloud/verify-full-final.log` und `.expo/private-cloud/verify-oauth-only.log`. Vor der App-Auslieferung waren noch keine privaten Kontodatensätze oder Sicherungen angelegt. Die Veröffentlichung überträgt keine persönlichen App-Daten; Geräteabnahme und die ausdrückliche erste Cloud-Aktivierung bleiben erforderlich. Es wurde kein Commit, Push, PR, EAS-Build oder Store-Schritt ausgeführt.

Am 18.10.2026 um 00:11 Uhr (Europe/Berlin) wurde das anschließend ausdrücklich freigegebene OTA auf `preview/ios/preview` veröffentlicht: Gruppe `35df2e43-d232-4dcf-9786-e030994856b9`, Update `01a14beb-3c39-71e5-b910-cb7353883412`, Runtime `43b795d13a44499e37cc461aa80ce8c239783788` für den internen Build 41. Die getrennte Veröffentlichungskopie erhält die bisherige Preview-Oberfläche und das interaktive Onboarding. Ihr kombinierter `verify:fast` besteht mit 8.885 Unit- und 1.198 Komponententests. Kanal, Manifest (HTTP 200) und tatsächlich heruntergeladenes Bundle sind geprüft. Das 9.515.072 Byte große Bundle hat SHA256 `C73497CCD65E4833D936DBD7F31E0940C23E21928B001EEDCA794F4C32C92A88`. Die vollständige OTA-Dokumentation liegt in der Veröffentlichungskopie unter `docs/private-cloud-preview-ota.md`; die ursprünglichen Quellen bleiben erhalten.
