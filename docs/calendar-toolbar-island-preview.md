# Obere Kalender-Insel: Preview-Abnahme

Stand: 30.10.2026. Basis: `origin/master` bei `65f1ef0` (PR #338).
Arbeitsbranch: `codex/calendar-toolbar-island`.

## Task-Vertrag

- Ziel: Die Kalender-Insel wird etwas flacher und auf die vertikale Mitte des Monatstitels ausgerichtet. Der schmale rechte Rand, die Breite, die größeren Icons und die drei Funktionen bleiben erhalten.
- Nicht-Ziele: Kalenderdaten, Berechnungen, Monatswechsel, Hintergrundbilder, untere Navigation, neue native Abhängigkeiten oder App-Konfiguration.
- Zielplattform und Zielgerät: iOS, iPhone. Android und Web behalten eine zum App-Modus passende Ersatzfläche.
- Dateiscope: `src/features/calendar/calendar-header.tsx`, zugehöriger Komponententest und dieses Abnahmeprotokoll.
- Abnahmekriterien: Rahmenhöhe 48 Punkte statt rund 53; vertikale Mittellinie auf Höhe des Monatstitels; drei getrennte Tippflächen mit 48 × 44 Punkten. 24-Punkt-Symbole, sechs Punkte rechter Rand, Breite und enge Trennerabstände bleiben erhalten. Weiterhin dieselben Aktionen für Kalenderfreigabe, Jahresansicht und Kalendergestaltung. App-Hell-/Dunkelmodus und „Transparenz reduzieren“ werden berücksichtigt. Die Insel blendet bei der Schnellplanung korrekt aus und danach wieder ein.
- Benötigte Gerätenachweise: iPhone-Screenshots in Hell und Dunkel, jeweils mit und ohne Kalenderfoto; Funktionsprüfung der drei Aktionen und Rückkehr aus der Schnellplanung. Gerät, iOS-Version und Preview-Build-/Update-ID dazuschreiben.
- Die Preview-Schritte wurden jeweils ausdrücklich freigegeben. Nach der finalen Preview bestätigte der Nutzer am 30.10.2026: „ja das passt, commit push pr merge und testflight ota“. Damit sind die finale Inselansicht auf dem iPhone sowie Commit, Push, PR, Merge nach grüner CI und die iOS-TestFlight-OTA freigegeben. Ein neuer nativer Build oder Store-Upload ist nicht beauftragt.

## Umsetzung

Die aktuelle Fassung verwendet einen 48 Punkte hohen Rahmen und 48 × 44 Punkte große Tasten. Horizontaler Innenrand und Gesamtbreite bleiben erhalten; der vertikale Innenrand berücksichtigt die Haarlinie, sodass die Gesamthöhe exakt 48 Punkte beträgt. Die Icons bleiben 24 Punkte groß, der rechte Rand bei sechs Punkten. Die lokale Kopfzeile wird bei normaler Schriftgröße um 3,5 Punkte nach unten versetzt, damit die 48-Punkt-Insel und die 41-Punkt-Titelzeile dieselbe Mittellinie erhalten. Die Korrektur folgt der Schriftgröße; beim gestapelten Layout für große Schrift bleibt der bestehende Ablauf erhalten. Monatstitel, Filter, gemessene Headerhöhe und gemeinsame Layoutbausteine werden nicht geändert. Die sichtbaren Tasten bleiben innerhalb aller übergeordneten Trefferbereiche; die zusätzliche Hülle lässt Berührungen außerhalb der Bedienelemente durch.

Der bereits im Projekt verwendete `expo-glass-effect` stellt die native Glasfläche bereit, wenn beide Verfügbarkeitsprüfungen erfolgreich sind. `colorScheme` folgt ausdrücklich der App-Palette. Bis die iOS-Einstellung zur Transparenz bekannt ist sowie bei reduzierter Transparenz oder fehlender Unterstützung bleibt die Fläche deckend und kontrastreich. Änderungen der Transparenzeinstellung werden während der Laufzeit übernommen.

Die Glasfläche empfängt keine Berührungen; die drei bestehenden Aktionen bleiben einzelne zugängliche Tasten. Beim Ausblenden der Schnellplanung wird der native Glaseffekt mit der bestehenden Animation auf `none` gesetzt und danach wieder aktiviert. Das berücksichtigt die dokumentierte Einschränkung bei Vorfahren mit null Deckkraft.

Expo-Version vor der Änderung geprüft: `~57.0.31`. Verwendete Referenz: [Expo SDK 57: GlassEffect](https://docs.expo.dev/versions/v57.0.0/sdk/glass-effect/).

## Prüfergebnisse der ersten Fassung

- Fokussierte Komponententests: Kalender-Insel 17/17 bestanden; Kalender-Screen und gemeinsamer Header-Layouttest zusammen 50/50 bestanden.
- Regelvalidierung, Typprüfung, Lint ohne Warnungen, Formatprüfung und `git diff --check` bestanden.
- Unit-Tests mit `VITEST_MAX_WORKERS=1`: 512/512 Dateien, 9.922/9.922 Tests bestanden.
- Vollständiger Komponentenlauf: 168/169 Suiten und 1.604/1.606 Tests bestanden. Zwei Tests in der unveränderten `calendar-stable-pager.component.test.tsx` überschritten im Gesamtlauf ihre Fünf-Sekunden-Grenze. Der anschließende Einzellauf dieser Suite bestand 17/17 Tests bei unveränderten Zeitgrenzen, darunter beide zuvor betroffenen Tests (3,93 und 3,22 Sekunden).
- Alle weiteren 14 Script-Gates aus `test:all` separat mit Exitcode 0 bestanden: Rules Publisher, Delivery, Production Preflight, Provisioning, Trust, Operator, Tarifinventar, Audit Policy, Runtime Policy, Build Dependencies, Calendar Worklets, Sharing Security, Native Widget und Decoder Hardening.
- `npm.cmd run verify:fast` wurde ausgeführt. Es gibt keinen vollständig grünen einzelnen Gesamtlauf: Die parallelen Unit-Läufe hatten einen Zeitfehler in der unveränderten `entry-edit-motion-serialization.test.ts`; diese Datei bestand im Einzellauf 2/2 Tests. Der serielle Gesamtlauf bestand sämtliche Unit-Tests und stoppte anschließend an den oben genannten Komponenten-Zeitfehlern. Die fehlgeschlagenen Suiten und danach nicht mehr gestarteten Script-Gates wurden separat erfolgreich geprüft. Testgrenzen, Pager, Diensteditor und Testkonfiguration wurden nicht verändert.
- iPhone-Sicht- und Bedienabnahme: offen. Die technische Preview-Auslieferung ist unten dokumentiert; eine Übernahme und Sichtprüfung auf dem Gerät ist noch nicht bestätigt.
- Nächster Geräteschritt: Preview-App vollständig schließen, öffnen und etwa 15 Sekunden warten, nochmals schließen und öffnen. Anschließend die oben genannten Screenshots und Bedienprüfungen durchführen.

## Veröffentlichte iOS-Preview vom 30.10.2026

Veröffentlicht um **02:32 Uhr (Europe/Berlin)**:
[Update-Gruppe b886be54-f0d5-465a-b8e8-f9b246a615f3](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/b886be54-f0d5-465a-b8e8-f9b246a615f3),
iOS-Update `01a18a70-069d-7951-88e6-4c34dddc2641`.

- Ziel: nur iOS, Kanal/Branch und Environment `preview`, `APP_VARIANT=internal`, bestehender Preview Build 44 (`812ea1a9-a4c0-48f3-b01a-72011cdad43e`). Frische Build-Metadaten, lokal aufgelöste Runtime, Export und Veröffentlichung stimmen überein: `b99c3cf0dd56e6b1bb126d195f21c665de57760b`. Die Runtime wurde nicht überschrieben.
- Während der Vorbereitung waren weitere Kalender-, Netto- und Sonderdienste-Änderungen veröffentlicht worden. Grundlage des Exports ist deshalb die frisch verifizierte Preview-Gruppe `fd9c16ce-0fe1-48a7-a163-2b6fb7cf560c`. Von 2.259 eingefrorenen Quelldateien bleiben 2.257 bytegleich; nur Kalender-Insel und zugehöriger Test werden ersetzt. Die vorhandenen Funktionen bleiben dadurch enthalten.
- Der isolierte kombinierte Stand besteht Typprüfung, Lint und Formatprüfung sowie **71/71 Tests in vier Kalender-/Layout-Suiten**. Ein erster Zusatzlauf konnte wegen fehlender Schreibrechte im Standard-Testcache keine Tests ausführen; die Wiederholung mit eigenem Cache besteht vollständig. Dafür wurden keine Tests oder Zeitgrenzen verändert. Die zuvor dokumentierten Ergebnisse von `verify:fast` bleiben getrennt erhalten; ein neuer vollständiger Gesamtlauf der vereinigten Quelle wird nicht behauptet.
- Der Export wurde mit den vorhandenen EAS-Preview-Variablen erstellt und anschließend mit `--skip-bundler` unverändert hochgeladen. Die öffentliche Sharing-Konfiguration sowie die enthaltenen Netto- und Sonderdienste-Funktionen wurden beim Export geprüft, ohne Konfigurationswerte zu protokollieren.
- Manifest und Bundle-CDN antworten mit HTTP 200. Lokaler Export, Manifest-Hash und heruntergeladenes Bundle stimmen überein: **12.379.787 Bytes**, SHA-256 `75f359928bd4b8be4ae746ac6e22fb83d25d77f447bd9e0a33ac8762d914201a`. Alle **52 Assets** wurden ebenfalls heruntergeladen und gegen Manifest und lokalen Export geprüft.
- Das frische EAS-Listing führt die neue Gruppe direkt vor der erhaltenen Vorgängergruppe. Alle 2.259 eingefrorenen Quelldateien sowie die zwei freigegebenen Originaldateien wurden nach der Veröffentlichung erneut per SHA-256 geprüft.
- Prüfzusammenfassung: `artifacts/calendar-toolbar-island-release-proof.json`. Eingefrorener Auslieferungsstand: `artifacts/calendar-toolbar-island-preview/`. Ausführliche Prüflogs, Quellmanifest und Export-/Auslieferungsbelege liegen im lokalen Aufgabenordner `calendar-toolbar-island-ota` der Visualisierungsablage.
- Geräteabnahme bleibt offen: Insel in Hell und Dunkel, mit und ohne Kalenderfoto, drei Aktionen sowie Rückkehr aus Schnellplanung und Jahresansicht prüfen. Dieser Auftrag hat keinen Commit, Push, PR, Merge, nativen Build oder eine TestFlight-/Store-Veröffentlichung ausgeführt.

## Kompakte Korrektur nach iPhone-Foto vom 30.10.2026

Die erste Preview-Gruppe `b886be54-f0d5-465a-b8e8-f9b246a615f3` wurde auf dem iPhone angezeigt und vom Nutzer ausdrücklich als „Eindeutig zu groß und zu weit auseinander“ zurückgewiesen. Der Screenshot ist der Nachweis dieser ersten Fassung; eine visuelle Abnahme ist damit nicht erfolgt.

Die Korrektur betrifft ausschließlich die lokalen Größen und Abstände der Insel sowie die vorhandenen Größenprüfungen. Glasfläche, Hell-/Dunkelmodus, Transparenzeinstellung, Aktionen und Animation bleiben erhalten. Dateiscope: `calendar-header.tsx`, zugehöriger Komponententest und dieses Protokoll. Der ursprüngliche veröffentlichte Auslieferungsstand unter `artifacts/calendar-toolbar-island-preview/` bleibt unverändert als Nachweis erhalten.

- Fokussierte Prüfung der kompakten Fassung: **17/17 Inseltests bestanden**, einschließlich Hell-/Dunkelmodus, Transparenzeinstellung, drei Aktionen und Schnellplanung.
- `VITEST_MAX_WORKERS=2 npm.cmd run verify:fast` für die Korrektur: **Exit 0 im vollständigen Gesamtlauf**. Regelvalidierung, Typprüfung, Lint ohne Warnungen, Formatierung, 512 Unit-Testdateien mit 9.922 Tests, 169 Komponentensuiten mit 1.606 Tests, alle weiteren 14 Script-Gates und `git diff --check` bestanden. Testgrenzen und Testkonfiguration wurden nicht verändert.
- Lokale Prüfbelege: `calendar-toolbar-island-compact/components.json`, `components.log`, `verify-fast.log` und `verification.json` im Aufgabenordner der Visualisierungsablage.
- Neue Preview-Veröffentlichung: erfolgt, Nachweis unten. Erneute iPhone-Sichtabnahme der kompakten Fassung: offen.

## Veröffentlichte kompakte iOS-Preview

Mit der ausdrücklichen Freigabe „ja ota“ veröffentlicht am **30.10.26, 03:32:36 (Europe/Berlin)**: [Gruppe 8a813a55-5a15-4fac-9e68-8b613c5895a3](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/8a813a55-5a15-4fac-9e68-8b613c5895a3), iOS-Update `01a18aa6-e8f1-7d7f-823c-c893c0d88d54`.

- Ziel: ausschließlich iOS, Kanal/Branch und Environment `preview`, `APP_VARIANT=internal`, bestehender Preview Build 44. Frische Build-Metadaten, lokal aufgelöster Fingerprint, Export und veröffentlichte Runtime stimmen überein: `b99c3cf0dd56e6b1bb126d195f21c665de57760b`. Keine Runtime wurde überschrieben.
- Die Insel verwendet jetzt 48 statt 56 Punkte große Tasten, 22 statt 26 Punkte große Symbole, zwei statt vier Punkte Innenrand und keine zusätzlichen Abstände an den Trennern. Glasoptik, Theme-Anbindung und Aktionen bleiben erhalten. Die erste, zurückgewiesene Fassung bleibt separat dokumentiert und eingefroren.
- Grundlage ist die tatsächlich ausgelieferte Preview `8bec50f9-24de-4446-9ea3-2f8d55c913ae`. Von 2260 eingefrorenen Quelldateien bleiben 2258 bytegleich; nur Insel und zugehöriger Test werden ersetzt. Pastellfarben, aktuelle Gehaltsdarstellung, Netto-Einstellungen und die übrigen Kalender-/Sonderdienste-Änderungen bleiben enthalten.
- Die lokale kompakte Fassung bestand `verify:fast` vollständig mit Exit 0. Der isolierte kombinierte Exportstand bestand zusätzlich Typprüfung, Lint, Formatierung und 71 Tests in 4 Kalender-/Layout-Suiten. Ein vollständiger `verify:fast`-Gesamtlauf der vereinigten Quelle wird nicht behauptet.
- Der Export wurde mit der EAS-Preview-Umgebung erzeugt und mit `--skip-bundler` unverändert veröffentlicht. Manifest und Bundle-CDN liefern HTTP 200. Lokaler Export, Manifest und heruntergeladenes Bundle stimmen überein: **12.385.190 Bytes**, SHA-256 `b5c688225e1d52c2082e5e17816d2775735352191281a58314fc735c80f6ae94`. Alle 52 Assets wurden ebenfalls heruntergeladen und mit dem lokalen Export abgeglichen.
- Das frische EAS-Listing zeigt die neue Gruppe direkt vor der erhaltenen Vorgängergruppe. Alle 2260 eingefrorenen Quellen und beide freigegebenen Originaldateien blieben bis zur Auslieferungsprüfung unverändert.
- Auslieferungsstand: `artifacts/calendar-toolbar-island-compact-preview/`. Zusammenfassung: `artifacts/calendar-toolbar-island-compact-release-proof.json`. Weitere Prüflogs und Quellmanifest: lokaler Aufgabenordner `calendar-toolbar-island-compact-ota` in der Visualisierungsablage.
- Geräteabnahme bleibt offen: Preview vollständig schließen, öffnen und etwa 15 Sekunden warten, nochmals schließen und öffnen. Größe, Abstände, alle drei Tasten und Hell-/Dunkelmodus auf dem iPhone prüfen. Kein Commit, Push, PR, Merge, nativer Build oder TestFlight-/Store-Upload wurde in diesem Auftrag ausgeführt.

## Rechter Rand und größere Icons nach Supershift-Referenz

Die Nutzerfotos zeigen die kompakte Fassung im September 2027 sowie Supershift als Positionsreferenz. Der neue Auftrag lautet, die Insel leicht weiter nach rechts zu bewegen und die Icons leicht zu vergrößern, ohne den Rahmen zu vergrößern. Die 48-Punkt-Tasten, Glasfläche, engen Abstände und Theme-Anbindung bleiben deshalb erhalten.

- Dateiscope: ausschließlich `calendar-header.tsx`, dessen bestehender Komponententest und dieses Protokoll, auf dem vorhandenen Branch `codex/calendar-toolbar-island`.
- Umsetzung: 18 Punkte nach rechts, Zielrand sechs Punkte; Icons 24 statt 22 Punkte. Keine Änderung des gemeinsamen Headerbausteins oder globaler Layout-Tokens.
- Die zusätzliche lokale Hülle verwendet `pointerEvents="box-none"`. Die gesamte Kopfzeile erhält den zusätzlichen Layoutplatz; die Tasten werden nicht mit einer Transformation über die Grenzen ihrer übergeordneten Trefferbereiche geschoben. Der Monatstitel und die Rahmenhöhe bleiben an ihren bisherigen Ankern.
- Fokussierte Tests: **24/24 in zwei Suiten bestanden** (Kalender-Kopfzeile und gemeinsames Headerlayout), einschließlich Hell-/Dunkelmodus, Transparenzeinstellung, drei Aktionen und Schnellplanung.
- `VITEST_MAX_WORKERS=2 npm.cmd run verify:fast`: **Exit 0 im vollständigen Gesamtlauf**. Regelvalidierung, Typprüfung, Lint ohne Warnungen, Formatierung, 512 Unit-Testdateien mit 9.922 Tests, 169 Komponentensuiten mit 1.606 Tests und alle weiteren 14 Script-Gates bestanden. Testgrenzen und Testkonfiguration bleiben unverändert. `git diff --check` ist ebenfalls erfolgreich.
- Prüfbelege: `calendar-toolbar-island-position/components.json`, `components.log`, `verify-fast.log` und `verification.json` im Aufgabenordner der Visualisierungsablage. Der zuletzt veröffentlichte kompakte Auslieferungsstand bleibt unverändert eingefroren.
- Die neue iOS-Preview-OTA für die Positions-/Iconkorrektur wurde mit „ja ota“ ausdrücklich freigegeben und veröffentlicht; Nachweis unten. Die erneute Sicht- und Bedienprüfung am iPhone bleibt offen, insbesondere die rechte Taste und „September 2027“ in Hell und Dunkel.

## Veröffentlichte iOS-Preview: Position und Icons

Mit „ja ota“ veröffentlicht am **30.10.26, 04:28:36 (Europe/Berlin)**: [Gruppe e174e2f3-4f8f-4d49-a8d7-47341b876918](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/e174e2f3-4f8f-4d49-a8d7-47341b876918), iOS-Update `01a18ada-2cea-76cd-b715-a2aaca9460f6`.

- Ziel: iOS, Kanal/Branch und Environment `preview`, `APP_VARIANT=internal`, bestehender Preview Build 44. Frische Build-Metadaten, lokal aufgelöster Fingerprint, Export und Update stimmen mit Runtime `b99c3cf0dd56e6b1bb126d195f21c665de57760b` überein.
- Insel 18 Punkte weiter rechts (sechs Punkte rechter Rand), Icons 24 statt 22 Punkte. 48-Punkt-Tasten, kompakter Rahmen, Abstände, Glasfläche und App-Hell-/Dunkelmodus bleiben erhalten.
- Grundlage ist die frisch geprüfte Preview `059416c8-d98d-48d2-866d-7fb09949cbd8` mit den zuletzt veröffentlichten Pastellfarben-Korrekturen. Von 2261 eingefrorenen Quelldateien bleiben 2259 bytegleich; nur Kalender-Kopfzeile und zugehöriger Test werden ersetzt.
- Die lokale Korrektur bestand `verify:fast` vollständig mit Exit 0 (9.922 Unit-Tests, 1.606 Komponententests und alle Script-Gates). Der isolierte kombinierte Exportstand bestand zusätzlich Typprüfung, Lint, Formatierung und 71 Tests in 4 Kalender-/Layout-Suiten. Ein vollständiger Gesamtlauf der vereinigten Quelle wird nicht behauptet.
- Export mit EAS-Preview-Umgebung und unveränderte Veröffentlichung über `--skip-bundler`. Manifest und Bundle-CDN liefern HTTP 200; lokaler Export, Manifest und Download stimmen überein: 12.387.398 Bytes, SHA-256 `2c93d6df0b807501c4040be9120f3ada0ac97c916dcd0db9b0c0b2a706daaa6e`. Alle 52 Assets sind mit dem lokalen Export abgeglichen.
- Das frische EAS-Listing führt die neue Gruppe direkt vor der erhaltenen Vorgängergruppe. Alle eingefrorenen Quellen und beide freigegebenen Originaldateien blieben bis zur Auslieferungsprüfung unverändert.
- Nachweise: `artifacts/calendar-toolbar-island-position-release-proof.json`, eingefrorener Auslieferungsstand `artifacts/calendar-toolbar-island-position-preview/`; weitere Prüflogs und Quellmanifest im Aufgabenordner `calendar-toolbar-island-position-ota` der Visualisierungsablage.
- iPhone-Abnahme offen: Preview schließen, öffnen, etwa 15 Sekunden warten, nochmals schließen und öffnen; rechten Rand, größere Icons im gleichen Rahmen und alle drei Tasten in Hell und Dunkel prüfen. Kein Commit, Push, PR, Merge, nativer Build oder Production-/TestFlight-Upload wurde in diesem Auftrag ausgeführt.

## Flacherer Rahmen und Ausrichtung am Monatstitel

Das neue iPhone-Foto zeigt die veröffentlichte Positions-/Iconkorrektur. Der Nutzer beanstandet jetzt die Rahmenhöhe und die zu hohe vertikale Mittellinie. Der vorherige Stand ist damit auf dem Gerät sichtbar, aber noch nicht visuell abgenommen.

- Zielplattform: iPhone/iOS; Dateiscope weiterhin nur Kalender-Kopfzeile, bestehender Komponententest und dieses Protokoll auf `codex/calendar-toolbar-island`.
- Ursache: Der gemeinsame Header richtet Titel und Zubehör an der Unterkante aus. Ein rund 53 Punkte hoher Rahmen steht dadurch oberhalb der Mitte der 41-Punkt-Titelzeile.
- Korrektur: 48 Punkte Rahmenhöhe und 44 Punkte hohe, weiterhin 48 Punkte breite Tippflächen. Die 24-Punkt-Icons, Breite, rechter Rand, Glasfläche und Theme-Anbindung bleiben erhalten.
- Die gesamte gepolsterte feste Kopfzeile wird im Monatsmodus um die halbe Differenz zwischen Rahmen- und skalierter Titelhöhe versetzt (normal 3,5 Punkte nach unten). Dadurch bleiben die Tasten innerhalb der Trefferbereiche ihrer Vorfahren. Der scrollende Monatstitel, die Filter und die gemessene Layout-Höhe bleiben unverändert. Kein Zusatzversatz in der Jahresansicht oder im gestapelten Layout ab Schriftfaktor 1,6.
- Fokussierte Tests: **29/29 in drei Suiten bestanden** (Kalender-Kopfzeile, Monatstitel und gemeinsames Headerlayout). Der erste Lauf hatte 28/29 bestanden, weil die Ausrichtungsprüfung keine normale Schriftgröße festlegte; der bestehende Test setzt diese iPhone-Fixture jetzt ausdrücklich auf Schriftfaktor 1. Die Wiederholung ist vollständig grün.
- `VITEST_MAX_WORKERS=2 npm.cmd run verify:fast`: **Exit 0 im vollständigen Gesamtlauf**. Regelvalidierung, Typprüfung, Lint ohne Warnungen, Formatprüfung, 512 Unit-Testdateien mit 9.922 Tests, 169 Komponentensuiten mit 1.606 Tests und alle weiteren 14 Script-Gates bestanden. Testgrenzen und Testkonfiguration bleiben unverändert. `git diff --check` ist ebenfalls erfolgreich.
- Prüflogs, fokussierte Testergebnisse und Quellhashes: Aufgabenordner `calendar-toolbar-island-height-alignment` in der Visualisierungsablage. Die vorherigen Auslieferungsstände bleiben unverändert erhalten.
- Mit „ota“ ausdrücklich freigegeben und veröffentlicht: die iOS-Preview-OTA für diese Höhen-/Ausrichtungskorrektur. Erneute iPhone-Prüfung in Hell und Dunkel bleibt offen; Nachweis unten.

## Veröffentlichte iOS-Preview: Höhe und Titelausrichtung

Mit „ota“ veröffentlicht am **30.10.26, 05:29:38 (Europe/Berlin)**: [Gruppe 972dfb88-e233-43c3-a28c-ebdeeadd1b8d](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/972dfb88-e233-43c3-a28c-ebdeeadd1b8d), iOS-Update `01a18b12-0f34-7a2b-bf69-e3953a1f58ef`.

- Ziel: ausschließlich iOS, Kanal/Branch und Environment `preview`, `APP_VARIANT=internal`, bestehender Preview Build 44. Frische Build-Metadaten, lokal aufgelöste Runtime, Export und Veröffentlichung stimmen mit `b99c3cf0dd56e6b1bb126d195f21c665de57760b` überein.
- Rahmenhöhe 48 statt rund 53 Punkte; bei normaler Schriftgröße 3,5 Punkte nach unten zur Mitte des Monatstitels versetzt. Icons 24 Punkte, Breite und sechs Punkte rechter Rand bleiben erhalten. Tippflächen 48 × 44 Punkte; Glasfläche, Hell-/Dunkelmodus und Transparenzeinstellung bleiben angebunden.
- Grundlage: frisch geprüfte Preview `a6b4f4d5-1471-4a5a-a9d1-2cfa33df9e4f` einschließlich Pastellfarben für individuelle Dienste und der aktuellen Sonderdienste-Korrekturen. Von 2272 eingefrorenen Quelldateien bleiben 2270 bytegleich; nur Kalender-Kopfzeile und zugehöriger Test werden ersetzt.
- Die lokale Korrektur bestand `verify:fast` vollständig mit Exit 0 (9.922 Unit-Tests, 1.606 Komponententests und alle weiteren 14 Script-Gates). Der kombinierte Exportstand bestand zusätzlich Typprüfung, Lint, Formatierung und 76 Tests in 5 Kalender-/Layout-Suiten einschließlich des Monatstitels. Ein vollständiger Gesamtlauf der vereinigten Quelle wird nicht behauptet.
- Export mit bestehender EAS-Preview-Umgebung, anschließend unverändert über `--skip-bundler` veröffentlicht. Manifest und Bundle-CDN HTTP 200; lokaler Export, Manifest und Download stimmen überein: 12.413.270 Bytes, SHA-256 `ee33b1ba198c41d35894d8ce5a52d7d5b11caabcad1c23bbfb08ae032e279932`. Alle 52 Assets sind mit dem lokalen Export abgeglichen.
- Das frische EAS-Listing zeigt die neue Gruppe direkt vor der erhaltenen Vorgängergruppe. Alle eingefrorenen Quellen und beide freigegebenen Originaldateien blieben bis zur Auslieferungsprüfung unverändert.
- Nachweise: `artifacts/calendar-toolbar-island-height-alignment-release-proof.json`, eingefrorener Stand `artifacts/calendar-toolbar-island-height-alignment-preview/`; weitere Prüflogs und Quellmanifest im Aufgabenordner `calendar-toolbar-island-height-alignment-ota` der Visualisierungsablage.
- Geräteabnahme offen: Internal-App schließen, öffnen und etwa 15 Sekunden warten, nochmals schließen und öffnen. Rahmenhöhe und Zentrierung am Monatstitel, alle drei Tasten sowie Hell-/Dunkelmodus prüfen. Kein Commit, Push, PR, Merge, nativer Build oder Production-/TestFlight-Upload in diesem Auftrag.

Der Uploadschutz erkannte vor der Veröffentlichung eine neue Sonderdienste-Preview und stoppte den ersten Versuch, bevor eine OTA angelegt wurde. Die unveränderte Kalenderkorrektur wurde anschließend mit diesem neueren Stand zusammengeführt, erneut geprüft und exportiert. Die vorherigen Export- und Prüfbelege bleiben unter `before-special-duty-refresh/` im OTA-Aufgabenordner erhalten.

## Finale iPhone-Abnahme und Git-/TestFlight-Lieferung

Am 30.10.2026 bestätigte der Nutzer die zuletzt veröffentlichte Insel mit „ja das passt“ und gab Commit, Push, PR, Merge und TestFlight-OTA ausdrücklich frei. Referenz ist die iOS-Preview-Gruppe `972dfb88-e233-43c3-a28c-ebdeeadd1b8d` für Preview Build 44: 48 Punkte Rahmenhöhe, 24-Punkt-Icons, sechs Punkte rechter Rand und mittige Ausrichtung zum Monatstitel. Diese Ansicht ist für weitere Änderungen der Vergleichsstand. iPhone-Modell und iOS-Version wurden nicht genannt.

- Git-Scope: ausschließlich `calendar-header.tsx`, `calendar-header.component.test.tsx` und dieses Protokoll. Beide Quelldateien müssen bytegleich zum abgenommenen Preview-Stand bleiben.
- Vor Merge: frischen `master` einbeziehen, lokale Prüfungen und sämtliche PR-CI-Gates bestätigen; danach Merge-Tree und drei freigegebene Blobs mit dem geprüften PR-Stand abgleichen.
- TestFlight-Ziel: bestehender iOS-Build 8, `production`, `APP_VARIANT=production`; aktuelle Runtime und bereits veröffentlichte Beta-Quelle werden unmittelbar vor dem Export geprüft. Es wird ausschließlich die Kalender-Insel übernommen; unabhängige Preview-Erweiterungen sind kein Teil dieser Beta-Freigabe.
- Die Preview-Abnahme ist erfolgt. Die technische TestFlight-Auslieferung sowie ihre erneute Geräteabnahme bleiben eigene Nachweise. Weitere Git-/CI-/Auslieferungsbelege werden im lokalen Aufgabenordner `calendar-toolbar-island-git-testflight` dokumentiert.
