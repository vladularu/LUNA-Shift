# Menüs und manuelle Wiederherstellung entfernen

Freigabe am 18.10.2026: Der Nutzer verlangt die vollständige Entfernung der gezeigten Seiten und Bedienfunktionen. Die Verlagerung in Menüs war keine akzeptierte Umsetzung. Anschließend erteilte er alle für die Korrektur bis einschließlich Preview-OTA notwendigen Freigaben.

Ziel: keine Konto- oder Freigabeaktionen-Menüs, keine kalenderweite Beendigung oder Verlassen-Aktion, keine Sicherungshistorie und keine manuelle Wiederherstellung früherer Cloud- oder Gerätestände. Die entfernten Funktionen erhalten keinen anderen Einstieg. Automatischer Sync und automatische Sicherungen bleiben erhalten.

Nicht-Ziele: Datenlöschung, Änderung der Aufbewahrung, Backend-Änderungen, neue native Konfiguration oder Abhängigkeiten. Individuelle Zugriffsrechte, Einladungslinks, Ausblenden und Farben geteilter Kalender sowie die Datenwahl bei tatsächlichen Sync-Konflikten bleiben erhalten. Die akzeptierte Mehr-Seite und Cloud-Kachel bleiben erhalten. Git-Auslieferung und neuer nativer Build sind für diese OTA nicht erforderlich.

Plattform: Expo SDK 57, interner iOS-Preview-Build 41. Branch `codex/menues-und-wiederherstellung-entfernen`, Checkout `.worktrees/unified-cloud-account`. Ausgangsstand ist das zuletzt veröffentlichte Preview-OTA `52b699ef-afd3-4391-b810-63db4f8f2727`. Hash-Manifest der 1.963 Ausgangsdateien: `.expo/funktionen-entfernen/baseline.json`.

Arbeitspaket 1: Konto-Kopfmenü und Freigabe-Auswahlmenü vollständig ausbauen; Freigabeaktionen-Komponente löschen; betroffene Interaktionstests anpassen. Erlaubter Scope: AccountScreen, CalendarSharingScreen und deren Tests, SharingCalendarActions.

Arbeitspaket 2: manuelle Sicherungsansicht und Wiederherstellung entfernen; PrivateCloudScreen dient ausschließlich tatsächlicher Datenwahl. Historienabfrage und Rückkehr zur vorherigen Gerätesicherung aus dem Cloud-Runtime entfernen; automatischen Abgleich und Konfliktschutz erhalten. Erlaubter Scope: PrivateCloudScreen und dessen Tests, private-cloud-runtime und dessen Tests, dieses Dokument.

Abnahme: keine der gezeigten Menüs oder Wiederherstellungsaktionen auf irgendeinem normalen Einstieg; direkte Navigation zur Cloud-Route zeigt außerhalb einer erforderlichen Datenwahl keine Sicherungsansicht. Einladung, individuelle Zugriffsänderung, Sichtbarkeit und Farben funktionieren weiter. Automatischer Sync, Konto-Wechsel-Schutz und Konfliktauswahl bestehen ihre Tests. Vollständiges `verify:fast`, iOS-Export beziehungsweise EAS-Bündelung, Runtime-Abgleich mit Build 41, Preview-Kanal und ausgeliefertes Paket werden geprüft. Visuelle Abnahme der Korrektur auf dem iPhone bleibt separat.

SDK-Referenz: [Expo Router für SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/router/).

Umgesetzt: Beide Kopfmenüs sind entfernt. Die Komponente `sharing-calendar-actions.tsx` ist gelöscht; empfangene Kalender öffnen kein Aktionsmenü mehr. Einladungen, individuelle Berechtigungen, Farben und Sichtbarkeit bleiben direkt bedienbar. Die Sicherungsliste, Datumszeilen und Aktion für den vorherigen Gerätestand sind vollständig entfernt. Im Cloud-Runtime gibt es weder Historienabfrage noch manuelle Wiederherstellung oder einen Parameter für alte Revisionen mehr. Die Cloud-Route enthält ausschließlich die notwendige Datenwahl bei Kontowechsel beziehungsweise Konflikt und kehrt außerhalb dieser Zustände zum Konto zurück. Sie bietet keine historischen Stände an.

Lokale Prüfung am 18.10.2026 erfolgreich:

- 64 gezielte Oberflächentests in vier Suites, einschließlich der Abwesenheit beider Menüs und der Wiederherstellungsaktionen, individueller Zugriffsänderung bei mehreren Kalendern sowie direkter Navigation zur Cloud-Route.
- 74 gezielte Runtime-/Zusammenführungstests in drei Dateien.
- Vollständiges `npm.cmd run verify:fast`: Regelprüfung, Typprüfung, Lint, Formatierung, 457 Unit-Dateien mit 8.905 Tests, 142 Komponenten-Suites mit 1.216 Tests, 199 Skripttests und `git diff --check`.
- Graft-Graph aktualisiert; ursprüngliche `.gitignore`-Bytes erhalten. Der Hash-Abgleich mit 1.963 Ausgangsdateien begrenzt die Änderung auf die acht oben genannten bestehenden Quell-/Testdateien, die gelöschte Menükomponente und dieses neue Dokument. Andere Arbeitsstände sind unverändert.

## Veröffentlichtes iOS-Preview-OTA

Mit der ausdrücklichen Freigabe bis zur OTA am 18.10.2026 um 04:40 Uhr (Europe/Berlin) veröffentlicht: Kanal und Branch `preview`, Plattform `ios`, EAS-Umgebung `preview`, `APP_VARIANT=internal`.

- Gruppe: `631a40a5-d222-4614-8258-c4c9694a5114`.
- iOS-Update: `01a14ce1-c086-7f26-a359-5a81ec617e86`, erstellt `2026-10-18T02:40:25.734Z`.
- Runtime: `43b795d13a44499e37cc461aa80ce8c239783788`. Der neu berechnete Fingerprint aus 145 Bestandteilen passt exakt zum internen Preview-Build 41 (`a8a35a6d-9d92-46cf-8b24-1afe0d28d245`). Es wurde keine Runtime erzwungen.
- Preview ist aktiv, führt ausschließlich zum Branch `preview` und liefert die neue Gruppe aus. Vorgänger ist `52b699ef-afd3-4391-b810-63db4f8f2727`, dessen verlegte Menüs der Nutzer beanstandet hatte.
- EAS hat mit der geprüften Preview-Cloud-Konfiguration einen neuen iOS-Export erstellt. Schlüsselwerte wurden nicht ausgegeben.
- Der tatsächliche Update-Endpunkt antwortet mit HTTP 200 und der neuen Update-ID. Lokaler Export, Manifest und heruntergeladenes CDN-Paket stimmen überein: SHA-256 `64ABFD935BE68A41771863C01E40E7DE80110264E7CC5D2353760360E101B852`.
- Hermes-Bundle `entry-9f7582090e452e049afb083921557dc2.hbc`, 9.518.852 Bytes und 52 begleitende Assets.
- Alle 1.963 erfassten Quelldateien blieben vom vollständigen erfolgreichen Testlauf bis einschließlich Veröffentlichung und Auslieferungsprüfung unverändert. Erst anschließend wurde dieses Dokument um die Ergebnisse ergänzt.
- Belege: `.expo/funktionen-entfernen/test-proof.json`, `verify-fast.log` sowie `ota/final-proof.json`, `ota/served-proof.json`, `ota/source-proof-after.json`, `ota/updates-after.json` und `ota/channel-after.json`.

Auslieferung und native Kompatibilität sind bestätigt. Es wurde kein neuer nativer Build und keine Git-Auslieferung durchgeführt. Automatische Sicherungen und die bestehende Aufbewahrung wurden nicht verändert.

## Bestätigte iPhone-Abnahme

Der Nutzer bestätigte am 18.10.2026: „Die OTA ist angekommen, beide Menüs sind jetzt weg. So passt es.“ Damit sind die sichtbare Übernahme dieser Preview-OTA und die Entfernung beider Menüs auf seinem iPhone abgenommen. Diese Bestätigung ist kein zusätzlicher Nachweis für Zwei-Geräte-Sync, alle Schriftgrößen, Datenkonflikte oder eine echte Kontolöschung.
