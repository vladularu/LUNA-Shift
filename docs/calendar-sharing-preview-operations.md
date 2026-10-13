# LUNA Sharing Preview: Betriebsstand

Stand: 12.10.2026. Nur die interne iPhone-Variante; keine Store-Veröffentlichung.

## Ziel und Trennung

- Supabase-Projekt: `flpwvfqywvnvhfkjbcnf` (LUNA Sharing Preview), Organisation LUNA Cloud, Frankfurt `eu-central-1`.
- Google-Projekt: `luna-sharing-preview-2026`, externer Testmodus.
- Die bestehenden Regelkatalog-Projekte bleiben unverändert. App-Konfiguration enthält ausschließlich die separate HTTPS-URL und den öffentlichen Publishable Key.
- Neue Provider-Secrets und Kontozugangsdaten wurden ausschließlich vom Nutzer direkt in die Anbieteroberflächen übernommen.

## Datenbank

Die Migration `202610120001_calendar_sharing.sql` wurde mit ausdrücklicher Freigabe angewendet. 41 Live-pgTAP-Prüfungen bestanden; die Testkonten wurden zurückgerollt. Sechs Sharing-Tabellen besitzen RLS, keine direkten Client-Tabellengrants und keine anonymen RPC-Rechte. Der öffentliche anonyme RPC-Aufruf wird abgewiesen.

Die bereits angewendete Migration ist in `supabase_migrations.schema_migrations` vermerkt. Auch diese Metadatentabelle hat RLS und keine Grants für `anon` oder `authenticated`. Der aktive `pg_cron`-Job `luna-sharing-retention` führt täglich um 03:23 UTC `select luna_sharing.prune_history(null);` als `postgres` aus. Er entfernt ausschließlich seit mindestens 90 Tagen abgelaufene/widerrufene Einladungen und alte Mutationsbelege. Aktive Kalender und Einträge bleiben erhalten. Belege: `artifacts/calendar-sharing/preview-operations.sql` und Live-SQL-Ergebnis vom 12.10.2026.

## Anmeldung

Apple und Google sind aktiviert; anonyme Anmeldung bleibt aus. Apple verwendet ausschließlich die native Bundle-ID `com.pflegeshift.app.internal`. Google fordert nur `email profile` an, keine Google-Kalender-Berechtigungen. Der Nutzer bestätigte die zum Google-Client gehörende Secret-Konfiguration.

Google-Web-Client: `687422287974-lc7fkm5c67if7jeb91lb4u3birn3ji64.apps.googleusercontent.com`; HTTPS-Callback: `https://flpwvfqywvnvhfkjbcnf.supabase.co/auth/v1/callback`. Die AI-Agent-Option ist aus. Zwei Testkonten sind bestätigt: `lunashiftapp@outlook.com` und das von Google als `vladularu@gmail.com` geführte Besitzerkonto.

Supabase-Standardziel: `lunashift-internal://auth/callback`. Erlaubte Rücksprungziele sind genau dieses Ziel und `lunashift-internal://auth/callback?luna_state=*`. Zusätzliche Variante-/Production-Ziele werden vor deren Auslieferung separat eingerichtet. Der App-Fluss verwendet PKCE und seine zusätzliche State-Korrelation; der öffentliche Startaufruf lieferte HTTP 302 zu `accounts.google.com`.

Es besteht keine eigene Einladungsdomain. Interne Tests verwenden Links für bereits installierte Apps. Eine öffentliche HTTPS-Einladungsseite und Universal Links bleiben ein späteres Paket.

## Kontolöschfunktion

`sharing-delete-account` ist in dieser Preview als ACTIVE, Version 1 und mit `verify_jwt=true` veröffentlicht. Function-ID: `c1b03493-ba35-4149-a992-0273244309d2`. ESZip-Hash laut Management-API: `bdc1c7bf46cc2c3978300f599eafbb587c9bc8c2c8d07151695fda4c90f21267`.

Der reguläre Source-Bootstrap verwendet den gepinnten ESM-Import von Supabase JS 2.117.3. Da der direkte Management-API-Bundler weiterhin HTTP 500 lieferte, wurde das vollständige funktionale Bundle inklusive SDK, Handler und Apple-Widerruf verwendet. Es enthält keine entfernten HTTP-/npm-Imports und wurde mit frischem Cache in Deno 2.1.4 ohne Remote-/npm-Auflösung und ohne reale Netz-/Env-Zugriffe ausgeführt. Echte SDK-Methoden liefen gegen lokale Mock-Requests; beide Session-Prüfungen und die Actor-Bindung vor Admin-Löschung bestanden. Kein Stub-Endpunkt wurde veröffentlicht.

Geprüftes Deployment-Artefakt: `artifacts/calendar-sharing/full-function-deploy/supabase/functions/sharing-delete-account/index.ts`, 812.965 Bytes, SHA256 `D2681C81D547F131F12946C61BC3DFDBBE9ABE90265B0525B4E9369C03E133AB`. Source-/Bundle-Hashes und Laufnachweise liegen unter `artifacts/calendar-sharing-backend/deploy-diagnosis/`. Die CLI 2.120.0 wurde mit `functions deploy sharing-delete-account --project-ref flpwvfqywvnvhfkjbcnf --use-api --workdir artifacts/calendar-sharing/full-function-deploy` ausgeführt; JWT-Prüfung bleibt im dortigen Config aktiviert.

Live-Anfragen ohne Sitzung, mit absichtlich ungültigem Token und mit einem öffentlichen Publishable Key als vermeintlichem Benutzer-Bearer wurden jeweils mit HTTP 401 abgewiesen. Ein GET mit öffentlichem API-Key erreichte den echten Handler und lieferte dessen HTTP 405 / `SHARE_INVALID_ARGUMENT`; die fehlende Sitzung lieferte `SHARE_UNAUTHENTICATED`. Die aktuelle [Supabase-Headerdokumentation](https://supabase.com/docs/guides/functions/auth-headers) bestätigt, dass die Plattformprüfung alte und neue asymmetrische Signaturen unterstützt; sie bleibt zusätzlich zur eigenen GoTrue- und Live-Session-Prüfung aktiviert. Die öffentlich sichtbaren Projekt-JWKS enthalten ES256, ersetzen jedoch keinen echten angemeldeten Gerätetest. Metadaten liegen in `artifacts/calendar-sharing/live-functions.json`, Prüfungen in `live-function-public-check.json`. Ein anschließender Bundle-Download über die Management-API scheiterte mit HTTP 500; deshalb liegt kein unabhängiger heruntergeladener Byte-Abgleich vor. Metadaten/Gateway-Prüfungen ersetzen keinen authentifizierten Geräte-Löschtest.

Serverseitige Apple-P8-Widerrufscredentials sind noch nicht konfiguriert. Die App enthält den separat bestätigten manuellen Apple-Widerrufsweg; eine bestätigte Cloud-Kontolöschung und bestätigter Apple-Widerruf sind verschiedene Ergebnisse. Automatischer Apple-Widerruf und Produktionsfreigabe bleiben eigene Gates.

## Prüfung und Übergabe

`verify:fast` bestand im vollständigen Lauf. Bei der nachfolgenden Unit-Coverage liefen neun unveränderte ältere Jahrestests unter Parallelbelastung in 5-Sekunden-Zeitlimits. Dieselbe Suite wurde mit `npm.cmd run test:coverage:unit -- --maxWorkers=1` ohne Fachlogik-/Timeoutänderungen erneut geprüft und bestand. Auch Komponenten-Coverage, Production-Audit, Release-Konfiguration sowie Web-, Android- und iOS-Export bestanden (Exit 0 in `verify-full-serial-completion.exit`). Nachweis und Zusammenfassung: `local-build-readiness.json`.

Vor einer Geräte-/Release-Aussage bleiben: reale Apple-/Google-Anmeldung, Auth-Abbruch/Neustart/Logout, zwei iPhones mit Einladung und Eigentümerbestätigung, Offline-/Widerrufs-/Konto-Wechsel, authentifizierte Kontolöschung, Widget-Darstellung und aktuelles Startlogo auf dem Zielgeraet. Bestehende Netto-/Tarifberechnungen, Exporte und lokale Daten müssen auf dem Zielgerät weiterhin funktionieren. Kein Merge ohne Geräteabnahme und erfolgreiche PR-CI.

## Gemeinsamer interner Build

Die Apple-Signierprofile fuer App und ExpoWidgetsTarget sind eingerichtet. Der interne iOS-Preview-Build 37 wurde am 12.10.2026 erfolgreich hochgeladen: https://expo.dev/accounts/vladularu/projects/pflegeshift/builds/9990ee38-455d-4822-9946-7b81a145d80e. Finaler Status: FINISHED, internes iOS-Installationsartefakt vorhanden. Xcode meldet ARCHIVE SUCCEEDED; die native App und Widget-Erweiterung sind kompiliert. Runtime: 34cf952530d3b51c4033c4808b7ec433ce910484, Kanal preview. Geraeteabnahme bleibt offen. Nachweis: artifacts/calendar-sharing/eas-build-37-receipt.json. Der interaktive Push-Key-Dialog wurde nicht fuer den Upload benoetigt; nicht interaktive EAS-Builds ueberspringen ihn. Die App verwendet lokale Erinnerungen und besitzt kein aps-environment-Entitlement.

## TestFlight- und GitHub-Stand am 13.10.2026

Die spätere Konfiguration und Auslieferung der normalen LUNA-App ist in `testflight-build-41.md` dokumentiert. Die interne Apple-Client-ID und Rücksprungziele sind erhalten; zusätzlich sind `com.lunashift.app`, `lunashift://auth/callback` und `lunashift://auth/callback?luna_state=*` eingerichtet. Die TestFlight-Geräteabnahme 0.1.0 (5) bestätigt Appstart mit bestehenden Daten, vier Widgets mit Foto/Hell-Dunkel/Kalenderöffnung sowie Apple-/Google-Anmeldung. Diese Ergebnisse ersetzen die früher offenen Prüfungen desselben Umfangs; die historischen Betriebsstände bleiben erhalten.

Zwei-iPhone-Sharing, authentifizierte Kontolöschung und automatischer Apple-Widerruf bleiben eigene Folgeprüfungen. Google verwendet weiterhin ausschließlich die eingerichteten Testkonten. Die GitHub-Übergabe des abgenommenen Beta-Stands ist separat ausdrücklich freigegeben und in `calendar-sharing-implementation.md` eingegrenzt.
