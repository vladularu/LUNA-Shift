# TestFlight: bestätigter Stand von Internal Build 41

Ziel: den vom Nutzer abgenommenen Code von Internal Build 41 für die bestehende TestFlight-App LUNA Shift (`com.lunashift.app`, App Store Connect `6811463563`) signieren, hochladen und in TestFlight verfügbar machen. Der interne Ad-hoc-Build selbst ist kein App-Store-Archiv.

Arbeitspakete: (1) Variante, Cloud-Konfiguration und Anmeldung für die TestFlight-Beta sowie benötigte Signierung vorbereiten; (2) zusätzliche vollständige Release-Gates, Store-Build und Prüfung des tatsächlichen IPA; (3) Apple-Upload, Verarbeitung und TestFlight-Verfügbarkeit getrennt nachweisen.

Scope: vorhandener bestätigter Code im gemeinsamen `codex/calendar-sharing-mvp`-Arbeitsstand; lokale Release-Belege unter `artifacts/testflight-build-41/`, diese Dokumentation und die Preview-Betriebsdokumentation. Änderungen an Auth-Konfiguration betreffen ausschließlich das bestehende separate Projekt `flpwvfqywvnvhfkjbcnf`: bestehende Rücksprungziele und Provider bleiben erhalten, die Kennung und Rücksprungziele der normalen LUNA-App werden für den TestFlight-Test ergänzt. Die beiden öffentlichen Sharing-Umgebungsvariablen werden für das vorhandene EAS-Production-Profil eingerichtet. Keine weiteren Cloud-Projekte, keine Datenbankmigration, kein neues Provider-Secret, keine Git-Weitergabe und keine App-Store-Veröffentlichung.

Freigabe: „oke jetzt dieses build für testflight updaten“ am 13.10.2026 autorisiert den dazu notwendigen Store-Build und TestFlight-Upload des bestätigten Stands. Akzeptanz: Store-signiertes korrektes App-/Widget-Paket, passender Production-Fingerprint, funktionierende öffentliche Auth-Konfiguration, bestätigter Apple-Eingang und tatsächlicher TestFlight-Status. Zwei-iPhone-Sharing und Geräteabnahme der normalen LUNA-Installation bleiben eigenständige Prüfungen.

## Native Store-Signierung und Cloud-Konfiguration

Der bestehende Apple-/TestFlight-Zugriff wurde live geprüft; bislang ist 0.1.0 (4) in internen und externen Betatests verfügbar. Apple lehnte die ursprüngliche Widget-Gruppe `group.com.lunashift.app` als nicht verfügbar ab. Die Production-Variante verwendet deshalb die neue, im passenden Team registrierte Gruppe `group.com.lunashift.app.widgets.72c9t74sn2`. Internal und Design verwenden weiter ihre bisherigen Gruppen. Der tatsächliche SDK-Konfigurationscheck bestätigt dieselbe Gruppe in App, Erweiterung und Info.plist ohne APNs-Entitlement.

Sign In with Apple und die neue App Group sind für `com.lunashift.app` eingerichtet. Neue App-Store-Provisioning-Profile für App und `com.lunashift.app.ExpoWidgetsTarget` sind aktiv und verwenden das vorhandene Distribution-Zertifikat. Der EAS-Credential-Setup bestätigt beide Ziele als bereit. Kein neues Apple-Passwort oder Provider-Secret war erforderlich.

Im separaten Sharing-Projekt sind die bisherigen internen Auth-Ziele erhalten geblieben; `lunashift://auth/callback` und `lunashift://auth/callback?luna_state=*` sowie Apple-Client `com.lunashift.app` sind ergänzt und zurückgelesen. Provider-Secrets und übrige Provider-Einstellungen sind unverändert, anonyme Anmeldung bleibt deaktiviert. Die öffentlichen Sharing-Variablen sind im vorhandenen EAS-Production-Environment angelegt und ihre Namen geprüft. Der öffentliche Google-Anmeldestart für die Production-Rücksprungadresse liefert HTTP 302 zum erwarteten Google-Client mit `email profile`; ein echter TestFlight-Anmeldetest folgt nach Installation.

## TestFlight 0.1.0 (5) am 13.10.2026 verfügbar

Der Store-Build `1ec474a0-bda0-45eb-89f8-780c94db5632` ist FINISHED. Der tatsächliche Xcode-Nachweis bestätigt ARCHIVE SUCCEEDED und beide nativen Widget-Quellen. Das 33.217.889-Byte-IPA ist geprüft: `com.lunashift.app`, richtige URL-Schemata, Apple-Anmeldung, Signierteam, App-/Widget-Speichergruppe `group.com.lunashift.app.widgets.72c9t74sn2`, keine APNs-Entitlements, Runtime `4a9747e5fdc6a52760d6955a95584cdd1e85607e` und Kanal production. Die nativen Widget-Quellen entsprechen unverändert dem abgenommenen Internal Build 41. `verify:fast` (8.680 Unit-Tests, 1.067 Komponententests), Coverage, Produktions-Audit und alle drei Production-Exporte sind bestanden.

Der erste Uploadversuch mit EAS-Testnotizen wurde wegen eines Enterprise-Tariflimits vor der Planung abgewiesen; es wurde kein Tarif geändert. Der Upload ohne diesen Zusatz ist erfolgreich abgeschlossen: Submission `5c3e1f62-49b0-4f1e-881b-7d8e491fc8c9`, Apple-Build `3b3a4fb9-2874-4723-8bf0-e840d208f9c5`. Deutsche Testhinweise wurden direkt über Apples API gespeichert und zurückgelesen. Apples Beta-Prüfung ist APPROVED. Die bestehenden Gruppen „Team (Expo)“ und „LUNA Shift Beta“ enthalten den neuen Build; die finale unabhängige EAS-/Apple-Abfrage bestätigt Verarbeitung VALID und intern sowie extern IN_BETA_TESTING, nicht abgelaufen.

Bestehender öffentlicher Beta-Link: https://testflight.apple.com/join/nMdTZCK5. Version und Build: 0.1.0 (5). Es gab keine App-Store-Veröffentlichung und keine Git-Weitergabe. Google bleibt im bereits eingerichteten Testmodus mit den freigegebenen Testkonten; Apple-Anmeldung ist für die neue Bundle-ID vorbereitet. Zwei-iPhone-Sharing und die tatsächliche Installation von TestFlight 0.1.0 (5) bleiben Geräteprüfungen. Die zuvor bestätigte Widget-Abnahme gilt weiterhin für Internal Build 41; die Production-Speichergruppe braucht ihren eigenen Gerätenachweis.

Belege: `artifacts/testflight-build-41/build-readiness.json`, `build-receipt.json`, `ipa-proof.json`, `submission.json`, `apple-final-status.json`, `beta-delivery.json`, `auth-readiness.json` und die Release-Prüflogs. EAS-Buildseite: https://expo.dev/accounts/vladularu/projects/pflegeshift/builds/1ec474a0-bda0-45eb-89f8-780c94db5632.

## TestFlight-Geräteabnahme 0.1.0 (5) am 13.10.2026

Der Nutzer bestätigt auf seinem iPhone: „Ja, alles funktioniert“. Die vorausgehende Prüffrage bezog sich ausdrücklich auf die Installation von LUNA Shift 0.1.0 (5) über TestFlight, Appstart mit bisherigen Daten, alle vier Widget-Ansichten mit Kalenderfoto, Hell/Dunkel und ausschließlicher Kalenderöffnung sowie Apple- und Google-Anmeldung mit einem eingerichteten Google-Testkonto.

Damit ist dieser visuelle und funktionale Umfang für den Store-Build `1ec474a0-bda0-45eb-89f8-780c94db5632` (`com.lunashift.app`, Runtime `4a9747e5fdc6a52760d6955a95584cdd1e85607e`) durch Nutzerbestätigung abgenommen. Das umfasst erstmals auch den Gerätenachweis für die Production-Speichergruppe `group.com.lunashift.app.widgets.72c9t74sn2`. Die zuvor offenen Installations- und Anmeldeprüfungen dieses Builds sind damit abgeschlossen; frühere Statusangaben bleiben als historische Nachweise erhalten.

Zwei-iPhone-Sharing und Kontolöschung wurden in dieser Rückmeldung nicht separat geprüft und bleiben eigenständige Abnahmepunkte. Beleg: `artifacts/testflight-build-41/device-acceptance.json`. Es wurden ausschließlich Abnahmeunterlagen ergänzt; kein weiterer Build, OTA oder Git-Delivery wurde ausgeführt.
