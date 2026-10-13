# Interne Geräteabnahme: Kalender teilen und Widgets

## Installation

Den fertigen gemeinsamen iOS-Preview-Build über der bestehenden LUNA Shift Internal installieren. Lokale Daten müssen erhalten bleiben. EAS-Buildstatus und Exporte bestätigen noch keine Geräteabnahme.

## Kurze erste Prüfung

1. Appstart mit bisherigen Diensten, Gehalt/Netto und PDF/CSV; neues Startlogo ohne alte Grafik.
2. Apple und Google: Anmeldung, Abbruch, App schließen/öffnen, Abmeldung; private lokale Daten bleiben erhalten. Google-Preview-Testkonten sind lunashiftapp@outlook.com und vladularu@gmail.com.
3. Widgets hinzufügen: mittlere Variante mit sechs Tagen, große Variante mit vierzehn Tagen; Nachtdienst, leerer Tag, Datumwechsel, Appänderung und Widget-Tap testen.
4. Teilen auf zwei registrierten iPhones: Eigentümer veröffentlicht bewusst einen sicheren Plan, versendet einen Einladungslink, Empfänger nimmt an, Eigentümer bestätigt. Empfänger sieht den Plan schreibgeschützt; seine Auswertung bleibt unverändert.

## Weitere Sharing-Prüfung

- Eigene Notizen, Orte, Gehalt, Steuerdaten, Erinnerungen und nicht ausgewählte Termine erscheinen nicht im geteilten Plan. Krankheit/Urlaub bleiben neutrale Verfügbarkeit.
- Eigene Änderungen und Löschungen kommen nach Wiederverbindung an; ein abgelehnter/veralteter Upload verwirft keine neueren lokalen Änderungen.
- Widerruf, Empfänger-Austritt, Offline-Entzug und Kontowechsel schließen fremde Ansichten und löschen deren lokalen Cache beim erneuten Rechtecheck. Schon gesehene Daten können bis zur nächsten Rechteprüfung bzw. begrenzten Cache-Laufzeit verfügbar sein.
- Ein Backup-Import pausiert vorhandene Freigaben. Neue Veröffentlichung verlangt eine frische Vorschau und Bestätigung.
- Monats-/Scrollposition, größere Schrift und Dark Mode bleiben stabil.
- Authentifizierte Kontolöschung ausschließlich mit einem dafür angelegten Testkonto prüfen. Die private lokale Planung bleibt erhalten; Cloud-Mitgliedschaften und veröffentlichte eigene Kalender werden entfernt. Apple-Widerruf ist separat zu bestätigen; für automatischen Widerruf fehlen noch serverseitige Apple-Credentials.

Interne Links setzen eine installierte App voraus. Öffentliche HTTPS-Einladungsseite, Universal Links, Production-Provider und Store-Freigabe sind spätere Pakete. Kein Merge vor Geräteabnahme und erfolgreicher PR-CI.

## Build 37: bisherige Geräterückmeldung

Build: `9990ee38-455d-4822-9946-7b81a145d80e`, iOS Internal / Preview.
Der Nutzer bestätigt Appstart mit bestehenden Daten, Netto, PDF/CSV, Apple-/Google-Anmeldung und das neue Startlogo. Die beiden Widgets bleiben auf dem Home-Bildschirm vollständig leer. App und Kalender wurden vorher geöffnet; das Testlabor zeigt keine technischen Fehler in dieser Sitzung.

Widget-Abnahme ist nicht bestanden; Zweigeräte-Sharing bleibt ebenfalls offen. Kein Merge oder Store-Schritt.

Die nächste interne Prüfung liest ausschließlich Modulverfügbarkeit, Erreichbarkeit des gemeinsamen Speichers, Anzahl der nativen Timeline-Einträge und den aktuellen Zustand aus. Keine Dienstnamen, Termine, Notizen, Speicherpfade oder Fehlermeldungsinhalte werden angezeigt. Das Laden der vorhandenen Widget-Instanz registriert ihre aktuelle Layoutdefinition, ersetzt aber keine Timeline. Das explizite Neuladen fordert WidgetKit zum Aktualisieren auf; die Datenbank und Einstellungen bleiben unberührt.

Die interne Widget-Prüfung ist per OTA-Gruppe `8933ea4a-403c-40bf-9efc-58f0452b33b1` auf `preview` für iOS/Build 37 veröffentlicht. Kompatibilität, Live-Manifest und identisches CDN-Bundle sind bestätigt. Als nächste Rückmeldung benötigt werden: Modulverfügbarkeit, gemeinsame Speichererreichbarkeit, Timeline-Eintragszahl und aktueller Zustand sowie die Sichtbarkeit beider Widgets nach einem angebotenen manuellen Neuladen. Ursachenfix und Widget-Geräteabnahme bleiben offen.

## Korrektur-Build 38: native Widget-Anzeige

Die Diagnose-OTA wurde auf dem iPhone geprüft: Modul vorhanden, gemeinsamer Speicher erreichbar, 15 Einträge, Zustand bereit. Beide Widgets bleiben nach Neuladen leer. Die Korrektur umgeht die JavaScript-/Expo-UI-Darstellung im Widget-Prozess und zeichnet den vorhandenen Snapshot mit direktem SwiftUI/WidgetKit.

Build 38 wurde nach bestandenem `verify:fast`, sieben Generierungstests, Runtime-/Konfigurationscheck, Release-Check und iOS-Export gestartet: `1d45eb88-f8f6-4c41-8bd0-9828df5986f2`, internes iOS-Preview. Erwartete Runtime: `3b55ed994e4127d9f93271141c37cbab684adb2c`. Native Kompilierung und iPhone-Darstellung bleiben bis zu ihren Nachweisen offen. Diese Korrektur benötigt eine Neuinstallation über der bestehenden internen App; ein OTA für Build 37 kann den Swift-Renderer nicht hinzufügen.

Build 38 ist `FINISHED`; Xcode meldet `ARCHIVE SUCCEEDED`. Der heruntergeladene IPA enthält die kompilierten nativen Klassen `LUNACalendarProvider`, `LUNACalendarContent`, `LUNAModernCalendarView` und `LUNAWidgetData`. Die eingebettete Runtime-Datei `EXUpdates.bundle/fingerprint` enthält `3b55ed994e4127d9f93271141c37cbab684adb2c`; `Expo.plist` verweist unter SDK 57 mit `file:fingerprint` darauf. Kanal `preview` sowie die tatsächlichen Signatur-Entitlements beider Binärdateien sind bestätigt. Beide verwenden weiterhin `group.com.pflegeshift.app.internal`.

Installation: https://expo.dev/accounts/vladularu/projects/pflegeshift/builds/1d45eb88-f8f6-4c41-8bd0-9828df5986f2 über der bestehenden LUNA Shift Internal. Geräteabnahme bleibt offen: App/Kalender öffnen, beide Widgetgrößen mit sechs/vierzehn Tagen, Nachtzeiten/Folgetag und Tageslinks prüfen. Danach die Sichtbarkeit mit Screenshots bzw. Nutzerbestätigung belegen. Kein Commit, Push, Merge oder Store-Schritt ausgeführt. Nachweise: `eas-build-38-receipt.json`, `build-38-ipa-proof.json`, `native-widget-verify-fast.log` im lokalen Artefaktverzeichnis.

## Geräteabnahme Build 38 am 13.10.2026

Der Nutzer bestätigt nach Installation über LUNA Shift Internal: „Ja, beide Widgets funktionieren“. Die vorausgehende Prüffrage umfasste beide Größen mit sechs bzw. vierzehn Tagen, Nachtzeiten/Folgetag und Tageslinks. Die Widget-Geräteabnahme für Build 38 ist damit durch Nutzerbestätigung bestanden; der Leerflächenfehler ist auf dem getesteten iPhone behoben.

Der Zweigeräte-Test des gemeinsamen Kalenders bleibt offen. Diese Rückmeldung gibt keinen Commit, Push, Merge oder Store-Schritt frei.

## Widget-Gestaltung: Build 39 zur Geräteabnahme

Build 39 (`bcecc5b7-1d78-484b-947a-7851f5428370`) ist FINISHED; Xcode bestätigt ARCHIVE SUCCEEDED. Das tatsächliche IPA enthält die neue native Foto-Anzeige und die Dienstbalken-Typen. Die eingebettete Laufzeit ist `350007b5875324b9f02b16ca3c3a938d9850c6f4`, der Kanal preview. Die tatsächlichen Signatur-Entitlements von App und Erweiterung bestätigen weiterhin `group.com.pflegeshift.app.internal`. Die native Quelle ist seit dem Upload unverändert.

Die visuelle Geräteabnahme ist offen: als Update über LUNA Shift Internal installieren, App/Kalender öffnen und beide Größen mit sechs/vierzehn Tagen prüfen. Gewähltes Kalenderfoto und Bildsichtbarkeit, flache Dienstbalken/Namen/Zeitzeile, Hell/Dunkel sowie Tageslinks mit vollständigen Nachtzeiten/Folgetag prüfen. Foto ändern/entfernen und alternative Kalender-Labelmodi bleiben zusätzliche Gerätefälle. Die Funktion von Build 38 wurde bereits bestätigt; diese neue Gestaltung benötigt eine eigene Rückmeldung. Der Zweigeräte-Sharing-Test bleibt offen.

Installation: https://expo.dev/accounts/vladularu/projects/pflegeshift/builds/bcecc5b7-1d78-484b-947a-7851f5428370. Paket- und Prüfbelege: `eas-build-39-receipt.json`, `build-39-ipa-proof.json`, `widget-app-design-build-readiness.json` und `widget-app-design-verify-fast.log` im lokalen Artefaktverzeichnis. Kein OTA, Commit, Push, Merge oder Store-Schritt.

## Geräteabnahme Widget-Gestaltung Build 39 am 13.10.2026

Der Nutzer bestätigt nach Installation über LUNA Shift Internal: „Ja, Design und Funktionen passen“. Die vorausgehende Prüffrage umfasste beide Widgetgrößen mit sechs beziehungsweise vierzehn Tagen, Kalenderfoto, Dienstbalken mit Namen und Zeitzeile, Hell/Dunkel sowie die Tageslinks zu den richtigen Details. Die visuelle und funktionale Abnahme dieses Umfangs ist für Build 39 auf dem getesteten iPhone damit durch Nutzerbestätigung bestanden.

Foto ändern/entfernen, alternative Kalender-Labelmodi und die eingefärbte Systemdarstellung wurden mit dieser Rückmeldung nicht separat bestätigt. Der Zweigeräte-Test des gemeinsamen Kalenders bleibt offen. Die Rückmeldung ist keine Freigabe für Commit, Push, Merge oder Store-Veröffentlichung.

## Kalenderwidgets: Build 40 gestartet

Der geprüfte Stand ist als interner iOS-Preview-Build 40 hochgeladen: https://expo.dev/accounts/vladularu/projects/pflegeshift/builds/34e1aa3a-acbf-469f-8ac1-6516da42275c. Die Runtime d2e52d4af01945c52cfb0bc505d7502987dd2b7d entspricht dem lokal erzeugten Fingerprint. verify:fast ist bestanden (447 Unit-Dateien / 8.677 Tests; 132 Komponentensuiten / 1.063 Tests und nachgelagerte Prüfungen), ebenso acht SDK-Generierungstests, isolierte Widget-Laufzeit, Release-Check und interner iOS-Export. Die erste Gesamtprüfung erkannte neue Farbliterale; nach Verwendung der bestehenden App-Farben besteht der vollständige erneute Lauf.

Native Kompilierung, Paketprüfung und iPhone-Abnahme bleiben bis zu ihren jeweiligen Nachweisen offen. Abnahme für Build 39 bleibt historisch dokumentiert. Nach Installation App/Kalender öffnen und alle vier Ansichten, Kalenderfoto/Bildstärke, Hell/Dunkel/System und Tipp auf Datum/Dienst/leere Fläche prüfen. Auch alte Widget-Tageslinks dürfen nur den Kalender öffnen. Der Zweigeräte-Sharing-Test bleibt offen.

## Kalenderwidgets: Build 40 zur Geräteabnahme

Build 40 (`34e1aa3a-acbf-469f-8ac1-6516da42275c`) ist FINISHED. Xcode bestätigt ARCHIVE SUCCEEDED und die Kompilierung beider Swift-Dateien. Das heruntergeladene IPA enthält LUNAShiftCalendar, LUNAShiftMonth und den nativen Hintergrund-/Kalender-Renderer. Die eingebettete Runtime ist `d2e52d4af01945c52cfb0bc505d7502987dd2b7d`, Kanal preview. App und Erweiterung besitzen die tatsächlichen Signatur-Entitlements für `group.com.pflegeshift.app.internal`. Die geprüften nativen Quellen sind seit dem Upload unverändert.

Installation: https://expo.dev/accounts/vladularu/projects/pflegeshift/builds/34e1aa3a-acbf-469f-8ac1-6516da42275c. Als Update über LUNA Shift Internal installieren und App/Kalender öffnen. In der Widget-Auswahl bietet „Kalender“ klein sechs Tage (3×2), mittel zwei Wochen (7×2) und groß vier Wochen (7×4); „Dieser Monat“ bietet das kleine Monatsraster mit Dienstpunkten. Die Wochenansichten beginnen montags, die Sechstageansicht am heutigen Tag. Kalenderfoto/Bildstärke, Dienstbalken/Namen/Zeiten und Hell/Dunkel/System stammen aus der App. Datum, Dienst und freie Widgetfläche öffnen ausschließlich den Kalender. Die bisherige Widget-Tagesroute ist eine unsichtbare Kalenderweiterleitung; die Dienstansicht dort ist entfernt.

Geräteabnahme bleibt offen: vier Varianten, Foto ändern/entfernen, Hell/Dunkel/System und Tippflächen bei Appstart sowie bereits geöffneter App prüfen. Die iOS-Einfärbung verwendet die systemgerechte Darstellung. Der getrennte Zweigeräte-Sharing-Test bleibt offen. Paket-/Prüfbelege: `eas-build-40-receipt.json`, `widget-grid-ipa-proof.json`, `widget-grid-build-readiness.json` und `widget-grid-verify-fast.log` im lokalen Artefaktverzeichnis.

## Widget-Speicherkorrektur per Build-40-OTA

Die Geräteabnahme der Widget-Gestaltung in Build 40 ist wegen der bestätigten Sync-Fehler nicht bestanden. Der vorhandene native Renderer zeigte weiter die alte Timeline ohne Raster-/Darstellungsmetadaten. Die SDK-57-Speicherübergabe wurde auf Property-List-Werte begrenzt: optionale null/undefined-Felder werden rekursiv weggelassen; Texte, Farben, Fotoverweis, false/0 und Fachwerte bleiben erhalten. Der Regressionstest reproduzierte zunächst den Fehler und besteht nach der Korrektur. Keine native Quelle wurde verändert. Die interne Prüfung zeigt jetzt aktuelles/altes Datenformat, Rastergrößen, Darstellung und Fotoübernahme ohne Namen, Datumswerte, Pfade oder Fotos zu protokollieren.

verify:fast ist bestanden (447 Unit-Dateien / 8.679 Tests; 132 Komponentensuiten / 1.067 Tests und nachgelagerte Prüfungen), ebenso die gezielten Speicher-/Diagnoseprüfungen und der interne iOS-Export. Fingerprint unverändert `d2e52d4af01945c52cfb0bc505d7502987dd2b7d`, kompatibel mit dem tatsächlichen Build-40-IPA.

Mit bestehender vollständiger Nutzerfreigabe wurde ausschließlich Preview/iOS/Umgebung preview veröffentlicht: Update-Gruppe `6fa3a8a1-8804-4578-9596-84423c37efd5`, Update-ID `01a132c5-5bf8-78d4-837b-729ad76f5b37`. update:view, aktive Preview-Zuordnung und Live-Manifest bestätigen die Auslieferung. CDN-Bundle mit Manifest-Asset-Request-Headern: SHA256 `e970c9df976b88d2f86a1a410d319e070545b3dbfc1cfffa231f2cdd3e2e2b7a`, 11467061 Bytes, exakt identisch mit dem geprüften Export. Es wurde kein weiterer nativer Build erstellt.

Erneute Geräteprüfung offen: App mit Internet öffnen, etwa 15 Sekunden warten, vollständig schließen und neu öffnen; Kalender öffnen. Widgets prüfen: feste Montag-bis-Sonntag-Wochen (2/4 Reihen), Monatsraster, App-Kalenderfoto und dessen Bildstärke, App-Hell/Dunkel/System, zweifarbige Dienstbalken und Kalenderöffnung. Im Testlabor muss Datenformat „aktuelles Kalenderdesign“ erscheinen, mit 28 Tagen im Wochenraster und aktuellem Monatsraster; bei gewähltem Foto muss dessen Übernahme angezeigt werden. Keine neuen CALENDAR_WIDGET_SYNC_FAILED-Ereignisse.

## Geräteabnahme Build 40 mit Korrektur-OTA am 13.10.2026

Der Nutzer bestätigt auf seinem iPhone: „Ja, Darstellung und Kalenderöffnung passen“. Die vorausgehende Prüffrage umfasste feste Montag-bis-Sonntag-Wochen mit zwei beziehungsweise vier Reihen, den richtigen Monat, das eigene Kalenderfoto, Hell/Dunkel, zweifarbige Dienste sowie die Kalenderöffnung von allen Widget-Tippflächen. Die Testlabor-Prüfung des aktuellen Kalenderdatenformats und des 28-Tage-Wochenrasters war ebenfalls Teil dieser Prüffrage.

Die visuelle und funktionale Geräteabnahme dieses Umfangs ist damit für Build 40 zusammen mit dem Korrektur-OTA `01a132c5-5bf8-78d4-837b-729ad76f5b37` bestanden. Der ursprünglich gemeldete Sync-Fehler bleibt als historischer Befund dokumentiert. Foto ändern/entfernen und die iOS-Einfärbung wurden nicht separat bestätigt. Der getrennte Zweigeräte-Sharing-Test bleibt offen.

## Widget-Proportionen ohne KW am 13.10.2026

Ziel: die Kalenderwochen-Anzeige aus den Widgets entfernen und die frei werdende Breite gleichmäßig auf die sieben Tagesspalten verteilen. Der Nutzer-Screenshot zeigt den zusätzlichen linken KW-Streifen als Ursache der schmaleren, nach rechts verschobenen Dienstbalken. Plattform: iOS, LUNA Shift Internal. Scope: `plugins/luna-calendar-widget/LUNAShiftCalendar.swift`, diese Dokumentation und die Geräteabnahme-Dokumentation; lokale Prüf-/Buildbelege bleiben im Artefaktverzeichnis. Die bestehenden Widget-Daten bleiben kompatibel; eine eventuell gespeicherte Wochenzahl wird nicht mehr dargestellt.

Abnahme: mittel zwei und groß vier feste Montag-bis-Sonntag-Reihen, keine KW-Zahlen und keine reservierte KW-Spalte, sieben gleich breite Tagesspalten mit bündiger Wochentagskopfzeile in der großen Ansicht. Kleine Sechstage- und Monatsansicht, Kalenderfoto, Hell/Dunkel, zweifarbige Dienstbalken und Kalenderöffnung bleiben funktional erhalten. Keine Änderungen an Dienstplan-, Gehalts- oder Sharing-Fachlogik. Bestehender gemeinsamer Branch `codex/calendar-sharing-mvp` und Nutzerfreigabe für die Widget-Umsetzung samt internem Build werden weiterverwendet. Die native Layoutänderung benötigt einen neuen internen Build; die visuelle Abnahme bleibt bis zur iPhone-Rückmeldung offen.

## Widget-Proportionen: Build 41 gestartet

Die KW-Zahlen und der dazugehörige linke Platzhalter sind aus der nativen Kalenderdarstellung entfernt. Dadurch stehen in den Wochenansichten sieben gleich breite Tagesspalten über die gesamte nutzbare Breite zur Verfügung; die große Wochentagskopfzeile verwendet denselben Rasteranfang. Die Zeilenanzahl, Kalenderdaten, Fotos, Darstellungsmodi, Dienstfarben und Kalenderlinks wurden nicht geändert.

`verify:fast` ist bestanden (447 Unit-Dateien / 8.679 Tests; 132 Komponentensuiten / 1.067 Tests und nachgelagerte Prüfungen), ebenso acht native Generierungsprüfungen, isolierte Widget-Laufzeit, Release-Konfiguration und iOS-Export. Die native Änderung ergibt Runtime `43b795d13a44499e37cc461aa80ce8c239783788`; sie kann nicht durch ein OTA in Build 40 installiert werden.

Der interne iOS-Preview-Build 41 ist mit bestehender Nutzerfreigabe gestartet: https://expo.dev/accounts/vladularu/projects/pflegeshift/builds/a8a35a6d-9d92-46cf-8b24-1afe0d28d245. Native Kompilierung, Paketprüfung und erneute iPhone-Abnahme bleiben offen. Es gab keine Git- oder Store-Weitergabe.

## Widget-Proportionen: Build 41 zur Geräteabnahme

Build 41 (`a8a35a6d-9d92-46cf-8b24-1afe0d28d245`) ist FINISHED. Der tatsächliche Xcode-Protokollnachweis bestätigt ARCHIVE SUCCEEDED und SwiftCompile für die Kalender- und Monatsdateien. Das heruntergeladene installierbare IPA (23.350.583 Bytes) enthält beide Widget-Arten und den nativen Kalender-Renderer. App-ID `com.pflegeshift.app.internal`, Runtime `43b795d13a44499e37cc461aa80ce8c239783788`, Kanal preview und die tatsächlichen Signaturrechte für `group.com.pflegeshift.app.internal` in App und Erweiterung sind geprüft. Die geprüften nativen Quellen sind seit dem Upload unverändert.

Installation: https://expo.dev/accounts/vladularu/projects/pflegeshift/builds/a8a35a6d-9d92-46cf-8b24-1afe0d28d245. Als Update über LUNA Shift Internal installieren und Kalender öffnen. Geräteprüfung noch offen: keine KW-Zahlen oder KW-Randspalte; passende Proportionen der sieben Tagesspalten und Dienstbalken in den mittleren und großen Wochenwidgets, einschließlich bündiger Kopfzeile im großen Widget. Kalenderfoto, Hell/Dunkel, zweifarbige Dienste und Kalenderöffnung weiter prüfen. Kleine Sechstage-/Monatswidgets bleiben Teil der bestehenden nativen Erweiterung.

Lokale Belege liegen unter `artifacts/calendar-sharing/widget-proportions/`: `verify-fast.log`, `layout-proof.json`, `build-readiness.json`, `build-receipt.json`, `ipa-proof.json` und die tatsächlichen Build-Protokolle. Kein weiteres OTA und keine Git-/Store-Weitergabe wurden vorgenommen. Die bestätigte Abnahme von Build 40 mit Speicherkorrektur bleibt historisch erhalten; die neuen Proportionen benötigen eine eigene iPhone-Rückmeldung.

## Geräteabnahme Build 41 am 13.10.2026

Der Nutzer bestätigt auf seinem iPhone: „Ja, Proportionen und Funktionen passen“. Die vorausgehende Prüffrage umfasste die entfernten KW-Zahlen, passende Proportionen der mittleren und großen Wochenwidgets sowie Kalenderfoto, Hell/Dunkel, zweifarbige Dienste und die weiterhin ausschließliche Kalenderöffnung.

Die visuelle und funktionale Geräteabnahme dieses Umfangs ist damit für den internen iOS-Build 41 (`a8a35a6d-9d92-46cf-8b24-1afe0d28d245`, Runtime `43b795d13a44499e37cc461aa80ce8c239783788`) durch Nutzerbestätigung bestanden. Die früheren Prüf- und Abnahmestände bleiben historisch dokumentiert. Die Bestätigung betrifft die Widget-Korrektur; sie erweitert keine Git- oder Store-Freigaben.

## TestFlight-Geräteabnahme 0.1.0 (5) am 13.10.2026

Der Nutzer bestätigt auf seinem iPhone: „Ja, alles funktioniert“. Die vorausgehende Prüffrage bezog sich ausdrücklich auf die Installation von LUNA Shift 0.1.0 (5) über TestFlight, Appstart mit bisherigen Daten, alle vier Widget-Ansichten mit Kalenderfoto, Hell/Dunkel und ausschließlicher Kalenderöffnung sowie Apple- und Google-Anmeldung mit einem eingerichteten Google-Testkonto.

Damit ist dieser visuelle und funktionale Umfang für den Store-Build `1ec474a0-bda0-45eb-89f8-780c94db5632` (`com.lunashift.app`, Runtime `4a9747e5fdc6a52760d6955a95584cdd1e85607e`) durch Nutzerbestätigung abgenommen. Das umfasst erstmals auch den Gerätenachweis für die Production-Speichergruppe `group.com.lunashift.app.widgets.72c9t74sn2`. Die zuvor offenen Installations- und Anmeldeprüfungen dieses Builds sind damit abgeschlossen; frühere Statusangaben bleiben als historische Nachweise erhalten.

Zwei-iPhone-Sharing und Kontolöschung wurden in dieser Rückmeldung nicht separat geprüft und bleiben eigenständige Abnahmepunkte. Beleg: `artifacts/testflight-build-41/device-acceptance.json`. Es wurden ausschließlich Abnahmeunterlagen ergänzt; kein weiterer Build, OTA oder Git-Delivery wurde ausgeführt.
