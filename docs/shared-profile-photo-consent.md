# Freiwillige Profilbild-Freigabe

## Task-Vertrag

- Ziel: „Profilbild teilen“ beim Einladen und je Person unter „Kalenderzugriff“. Nur das eigene Kontofoto wird nach ausdrücklicher Freigabe für diese Person sichtbar.
- Nicht-Ziele: Chat, fremde Kontofotos bearbeiten, öffentliche Foto-URLs, neue native Module oder Änderungen an Kalenderfiltern und Dienstfarben.
- Zielplattform: iOS, bestehender Preview-Build; anschließend Abnahme mit zwei Konten auf echten Geräten.
- Arbeitspaket A: zusätzliche, standardmäßig ausgeschaltete Einladungs-/Mitgliedsberechtigung, versionierte RPCs, strikte Decoder und SQL-Zugriffstests.
- Arbeitspaket B: zwei Schalter, kontogebundenes Laden der freigegebenen Fotos und Initialen als Rückfall; Runtime- und Komponententests.
- Dateiscope: Sharing-Domain/Ports/Controller, Sharing-Client/Runtime, Einladungs-/Zugriffsansicht, Kalenderavatare, zugehörige Tests, eine additive Supabase-Migration und diese Dokumentation.
- Abnahme: bestehende Freigaben bleiben aus; Empfänger dürfen die Berechtigung nicht selbst erteilen; nur aktive Mitglieder mit Freigabe erhalten das Foto. Ausschalten, Entzug, Austritt und Kontowechsel verwerfen es. Alte RPC-Antworten bleiben unverändert.
- Gerätesichtprüfung: neue Einladung aus/an, bestehender Kalenderzugriff aus/an, Foto bei SM nach deren Freigabe, Entzug und Offline-Fallback.
- Commit/Push/Live-Migration/OTA/Build: für diesen neuen Funktionsumfang noch nicht freigegeben.

## Datenweg

Das Profilbild stammt aus dem aktuellen privaten LUNA-Cloud-Stand des Kalenderbesitzers. Der Server liest ausschließlich `presentation.accountPhoto`, nach Prüfung der aktiven Sitzung und der Berechtigung für den angefragten Kalender. Andere Cloud-Inhalte bleiben privat. Ein lokales Foto wird erst nach erfolgreicher LUNA-Cloud-Synchronisierung verfügbar.

Fotos werden separat von Kalenderinhalten und nur für den sichtbaren Abschnitt der Avatarleiste geladen. Sie bleiben im Arbeitsspeicher der aktuellen Sitzung; keine neuen Foto-Backups oder öffentlichen URLs. Regelmäßige Aktualisierungen prüfen die Freigabe erneut. Bereits auf einem Empfängergerät angezeigte Inhalte lassen sich durch einen späteren Entzug nicht rückwirkend zurückholen.

Pro Ansicht werden höchstens acht Avatare angefragt, insgesamt höchstens sechzehn Fotos im Sitzungscache gehalten und zwei Fotoanfragen gleichzeitig ausgeführt. Kalender und Auswertung melden ihre Fenster unabhängig an und beim Schließen wieder ab. Ein Foto-Ladefehler verändert keine Kalenderrechte oder Filter.

## Rollout

Zuerst die additive Migration `20261030071015_shared_profile_photo_consent.sql` in das bestehende Sharing-Backend übernehmen, danach die passende iOS-Preview-OTA. Ohne die neue Backend-Fähigkeit bleibt der Schalter deaktiviert. Bestehende RPC-Antworten und alte Apps bleiben kompatibel. Vor der TestFlight-Übernahme müssen beide Testkonten die neue Preview haben: SM erlaubt das Foto in ihrer Freigabe an den Empfänger, dieser prüft Anzeige sowie Rückkehr zu Initialen nach dem Ausschalten.

Für einen Rückzug genügt zunächst das Zurücknehmen der neuen App-Version. Falls der Fotoabruf serverseitig sofort beendet werden muss, kann gezielt das Ausführungsrecht für `public.sharing_get_profile_photo(uuid,text)` entzogen werden. Kalenderinhalte und bisherige RPCs bleiben davon unabhängig.

## Lokale Prüfung am 30.10.2026

- `npm.cmd run verify:fast`: bestanden, einschließlich Typprüfung, Lint, Formatierung und sämtlicher nachgelagerter Release-/Sicherheitsprüfungen.
- Vitest: 522 Dateien, 10.075 Tests bestanden. Komponenten: 173 Suiten, 1.661 Tests bestanden.
- Datenbank-Zugriffsregeln: 57 Sicherheitstests mit der neuen Migration bestanden; zusätzlich zehn pgTAP-Prüfungen auf isoliertem PostgreSQL 15.8 bestanden.
- Der erste Gesamtlauf traf das bestehende Fünf-Sekunden-Limit eines Kalender-Wischtests. Dieser bestand unverändert sowohl isoliert als auch im vollständigen Wiederholungslauf. Es wurden keine Testlimits gelockert.
- Das vorhandene Sharing-Backend wurde ausschließlich über Schema-/Migrationsmetadaten, Status und Advisor-Baseline gelesen. Die fünf bestehenden Migrationen stimmen mit dem lokalen Ausgangsstand überein. Keine privaten Kontodokumente oder fremden Profilbilder wurden abgerufen, keine Live-Daten verändert.
- Nachweise: `artifacts/shared-profile-photo-consent/verify-fast.log`, `postgres-pgtap.log` und `validation-proof.json`.

Offen bleiben Preview-Veröffentlichung, Zwei-Konten-Geräteabnahme, PR/CI/Merge und TestFlight. Es gab für diesen neuen Funktionsumfang noch keinen Commit, Push oder OTA-Upload.
