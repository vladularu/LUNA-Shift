# iPhone-Kalenderwidgets

## Auftrag und Arbeitspakete

Ziel: zwei Home-Bildschirm-Varianten ab heute: mittel mit 6 Tagen, groß mit
14 Tagen in zwei Reihen à 7 Tagen. Datum, Kalenderkürzel, Dienstzeiten,
Kalenderfarben und Heute-Markierung; jeder Tag öffnet seine Tagesdetails.

Plattform: iPhone / Expo SDK 57. Referenz:
https://docs.expo.dev/versions/v57.0.0/sdk/widgets/

1. Daten: unabhängiger lokaler Kalenderausschnitt, tägliche Timeline,
   Zeitzone/Sommerzeit, Ablaufzustand, fokussierte Fachtests.
2. Darstellung: Expo-UI-Widget, mittel/groß, helle/dunkle/eingefärbte Ansicht.
3. Integration: Expo-Config-Plugin, plattformspezifische Brücke und
   Synchronisierung beim Start, Datenänderungen, Tageswechsel und Rückkehr.

Dateiscope: `src/features/widgets/`, Runtime-Provider, App-Konfiguration,
Paketdateien und diese Dokumentation. Ein eigener validierter Widget-Link
lädt den richtigen Kalenderbereich auch bei geöffnetem anderem Jahr.

Nicht-Ziele: Android-Widgets, Sperrbildschirm, Live Activities, Gehalt,
Termine, Notizen, Änderungen über das Widget, Cloud oder neue Berechnungsregeln.
Keine Datenbank oder Schlüssel werden mit der Erweiterung geteilt.

## Abnahmekriterien

- Mittel genau 6 Tage; groß genau 14 Tage in zwei Reihen.
- Datum/Zeiten/Kürzel/Farben stimmen mit dem lokalen Kalender überein.
- Kein Eintrag wird nicht als ausdrücklich frei gebucht ausgegeben.
- Alle Dienste eines Tages bleiben über die Tagesdetails erreichbar.
- Nachtschichten behalten ihr Startdatum und zeigen den Folgetag-Hinweis.
- Änderungen, Löschung, Wiederherstellung, Profilwechsel und leerer Zustand
  aktualisieren den Snapshot; verspätete Abfragen überschreiben ihn nicht.
- Timeline beginnt an der lokalen Tagesgrenze, einschließlich Sommerzeit.
- Nach Ablauf des vorberechneten Bereichs fordert das Widget zum Öffnen auf.
- Android/Web laden die iOS-Widget-Erweiterung nicht.
- `npm.cmd run verify:fast`, Widgettests und Plattform-Exporte bestehen.

## Geräteabnahme und Freigaben

Benötigt: neuer nativer iOS-Preview-Build mit Widget-Erweiterung/App Group,
Installation auf dem iPhone und Screenshots beider Größen (hell/dunkel/
eingefärbt). Nachtschicht, mehrere Dienste, Jahreswechsel, Offline-Nutzung,
Änderung/Löschung und Antippen jedes Tages prüfen. iOS bestimmt die
Aktualisierungszeit; eine Timeline ist keine Zusage sekundengenauer Updates.

Commit, Push, EAS Build, OTA und Store-Veröffentlichung sind nicht freigegeben.
Diese Änderungen werden für einen späteren gemeinsamen Build aufbewahrt.
Lokale Exporte/Prebuild ersetzen keine native Kompilierung oder Geräteabnahme.

## Technische Prüfungen

`npm.cmd run test:widget-runtime` kompiliert den offiziellen isolierten
Expo-Widget-JavaScript-Runtime und wertet die von Babel serialisierte
Widgetfunktion darin aus. Geprüft werden 6/14 Tageslinks, 1/2 Tagesreihen,
hell/dunkel/eingefärbt, Nachtschicht, Mehrfachdienste und leere/abgelaufene Daten.
Die Daten- und Synchronisierungstests laufen zusätzlich in `verify:fast`.
Der Runtime-Check prüft außerdem alle drei App-Varianten auf getrennte App Groups,
passende Erweiterungs-IDs und fehlende APNs-Berechtigung. Das Widget-Plugin steht
in der Pluginliste nach dem lokalen Benachrichtigungs-Plugin, damit dessen
Entitlement-Modifikation die vom Widget-Paket gesetzte APNs-Berechtigung entfernt.

## Prüfergebnis vom 12.10.2026

- Branch: `codex/iphone-calendar-widgets-implementation`; Basis `22cdd3d`.
- `VITEST_MAX_WORKERS=1 npm.cmd run verify:fast`: bestanden, 428 Unit-Testdateien /
  8.434 Tests und 125 Komponentensuiten / 996 Tests; außerdem alle nachgelagerten
  Regel-, Build-Abhängigkeits- und Runtime-Prüfungen.
- 22 gezielte Widget-Daten-/Komponententests: bestanden.
- `npm.cmd run test:widget-runtime`: bestanden, einschließlich aller App-Varianten.
- Lokale iOS-, Android- und Web-Exporte: bestanden. Android/Web mit einem Worker;
  iOS als interne Variante.
- Kontextgraph aktualisiert; keine Commits, Pushes, Builds oder OTA ausgeführt.

Der erste parallele Gesamtlauf hatte Zeitlimits in bestehenden Gehaltstests.
Der abschließende serielle Lauf bestand ohne Änderung fachlicher Regeln oder
Testzeitlimits. Die iOS-Projektgenerierung mit `expo prebuild` wird auf Windows
übersprungen; Swift-Kompilierung und echte Widget-Screenshots auf dem iPhone
sind noch offen.

## Eingrenzung des leeren Widgets in Build 37

Die ursprüngliche Build-Freigabe oben wurde durch den späteren Nutzerauftrag zum gemeinsamen Sharing-Build erteilt. Build 37 ist nativ erfolgreich kompiliert; die Widget-Geräteabnahme ist wegen leerer mittelgroßer und großer Widgets nicht bestanden.

Prüfung des tatsächlich verteilten IPA: Erweiterung, eingebettete JavaScript-Laufzeit, Modul/Widgetname und Layout sind vorhanden. Info.plists, eingebettete Profile und tatsächliche Mach-O-Code-Signatur-Entitlements gewähren App und Erweiterung dieselbe interne App Group. Die archivierte Laufzeit startet ohne React-Native-Globals; die archivierte Layoutfunktion liefert für beide Größen einen nichtleeren View-Baum. Diese Prüfungen bestätigen keine SwiftUI-Darstellung auf dem iPhone.

Die Bibliothek zeigt Renderfehler im Release-Build als leere Fläche, während unsere Synchronisierung fehlgeschlagene Aufrufe protokolliert. Eine leere Diagnoseliste unterscheidet deshalb bisher nicht zwischen fehlendem Modul, vorhandener Timeline und Renderfehler. Eine manuell gestartete Widget-Prüfung im vorhandenen internen Testlabor liest diese drei Zustände getrennt aus. Sie ist eine Diagnosehilfe, noch kein bestätigter Fehlerfix.

Scope der Diagnose: Widget-Brücke, Diagnose-Datentyp/-Karte und Tests, Einbindung im Testlabor, isolierter Runtime-Check und Dokumentation. Keine Änderungen an Diensten, Berechnungen, Sharing, nativer Konfiguration oder dem Widgetlayout. Die Ursachenentscheidung folgt auf die native Timeline-Rückmeldung.

Prüfungen der Diagnose-Erweiterung: `verify:fast` bestanden (447 Unit-Dateien / 8.669 Tests, 131 Komponentensuiten / 1.053 Tests sowie nachgelagerte Prüfungen). Der isolierte Runtime-Check ohne React-Native-Globals mit aktiviertem React-Compiler und der interne iOS-Export bestehen. Der native Fingerprint ist unverändert `34cf952530d3b51c4033c4808b7ec433ce910484` und entspricht Build 37. Die Diagnose benötigt daher keinen neuen nativen Build. Die Diagnose-OTA wurde mit ausdrücklicher Nutzerfreigabe auf Preview/iOS veröffentlicht. Geräteprüfung und Ursache bleiben offen.

## Diagnose-OTA für Build 37

Update-Gruppe: `8933ea4a-403c-40bf-9efc-58f0452b33b1`, Update-ID: `01a13204-ea0f-70a2-a3e3-ebbb36164698`. Kanal/Branch/Umgebung: `preview`, ausschließlich iOS. Runtime unverändert `34cf952530d3b51c4033c4808b7ec433ce910484`.

Das vorab geprüfte Exportbundle wurde unverändert mit `--skip-bundler` veröffentlicht. Die beiden öffentlichen Sharing-Variablen im EAS-Preview entsprechen denen des geprüften Bundles. `update:list`, aktive Kanalzuordnung und Live-Manifest bestätigen die neue Update-ID und kompatible Runtime. Der CDN-Download mit den Asset-Request-Headern des Manifests besteht; SHA256 `be01092fea071f8120709857798ad56f609875fba060e6616632249d9e61f8c2`, 9.295.736 Bytes, identisch mit dem freigegebenen lokalen Export. `update:view` lieferte einen allgemeinen CLI-Fehler; die unabhängigen Kanal-/Manifest-/CDN-Nachweise bestätigen die Verteilung.

Gerätenachweis weiterhin offen: App mit Internet öffnen, etwa 15 Sekunden warten, schließen und erneut öffnen. Dann im bestehenden Testlabor `Widgets prüfen` antippen und Modul, gemeinsamen Speicher, Anzahl der Timeline-Einträge und aktuellen Zustand melden. Bei angebotener Aktion `Widgets neu laden` antippen und beide Home-Bildschirm-Größen prüfen. Die Diagnose ist noch kein bestätigter Ursachenfix. Kein neuer Build, Commit, Push oder Merge ausgeführt.

## Native Darstellungskorrektur nach Diagnose-OTA

Der Nutzer meldet: natives Modul vorhanden, gemeinsamer Speicher erreichbar, 15 Timeline-Einträge, aktueller Zustand bereit. Nach manuellem Neuladen bleiben beide Home-Bildschirm-Widgets vollständig leer. Damit sind die App-seitige Veröffentlichung und ihr nativer Readback bestätigt; die genaue interne Ursache im Widget-Prozess ist noch nicht nachgewiesen.

Ziel: die beiden Kalenderwidgets mit direktem SwiftUI/WidgetKit zeichnen. Der bestehende, private lokale Dienstplan und die bereits geprüfte 14-Tage-Timeline bleiben die Datenquelle. Nicht-Ziele: weitere Widgets, andere Berechnungen, Auth-/Sharing-Änderungen, neue Datenfreigaben oder Android-Darstellung. Plattform: internes iPhone, Folge-Build zu Build 37.

Scope: ein Swift-Renderer mit typisiertem, rein lesendem Timeline-Provider; ein SDK-57-Config-Plugin, das nur die bereits erzeugte Kalenderwidget-Datei im bestehenden Target ersetzt; Plugin-/Generierungstests; App-Konfiguration, explizite native Fingerprint-Quellen, Testskript und Dokumentation. Keine Datenbankänderung. Unter 15 Dateien; Rendering/Generierung und Geräteabnahme sind getrennte Prüfschritte.

Abnahme: mittel sechs Tage, groß vierzehn Tage in zwei Reihen, Systemfarben/Heute/Zeiten/Nachtdienst/Mehrfachdienste, alle Tageslinks, leerer/Ablaufzustand, Aktualisierung aus der App. Der Provider liefert bei fehlenden oder ungültigen Daten eine sichtbare Öffnen-Aktion statt einer leeren Timeline. EAS muss den Swift-Code kompilieren; lokale JavaScript-/Plugin-Tests ersetzen den iPhone-Nachweis nicht. Der bisherige Auftrag erteilt Freigaben bis zum internen Build; kein Commit, Push, Merge oder Store-Schritt.

Build 38 ist `FINISHED`; Xcode meldet `ARCHIVE SUCCEEDED`. Der heruntergeladene IPA enthält die kompilierten nativen Klassen `LUNACalendarProvider`, `LUNACalendarContent`, `LUNAModernCalendarView` und `LUNAWidgetData`. Die eingebettete Runtime-Datei `EXUpdates.bundle/fingerprint` enthält `3b55ed994e4127d9f93271141c37cbab684adb2c`; `Expo.plist` verweist unter SDK 57 mit `file:fingerprint` darauf. Kanal `preview` sowie die tatsächlichen Signatur-Entitlements beider Binärdateien sind bestätigt. Beide verwenden weiterhin `group.com.pflegeshift.app.internal`.

Installation: https://expo.dev/accounts/vladularu/projects/pflegeshift/builds/1d45eb88-f8f6-4c41-8bd0-9828df5986f2 über der bestehenden LUNA Shift Internal. Geräteabnahme bleibt offen: App/Kalender öffnen, beide Widgetgrößen mit sechs/vierzehn Tagen, Nachtzeiten/Folgetag und Tageslinks prüfen. Danach die Sichtbarkeit mit Screenshots bzw. Nutzerbestätigung belegen. Kein Commit, Push, Merge oder Store-Schritt ausgeführt. Nachweise: `eas-build-38-receipt.json`, `build-38-ipa-proof.json`, `native-widget-verify-fast.log` im lokalen Artefaktverzeichnis.

## Geräteabnahme Build 38 am 13.10.2026

Der Nutzer bestätigt nach Installation über LUNA Shift Internal: „Ja, beide Widgets funktionieren“. Die vorausgehende Prüffrage umfasste beide Größen mit sechs bzw. vierzehn Tagen, Nachtzeiten/Folgetag und Tageslinks. Die Widget-Geräteabnahme für Build 38 ist damit durch Nutzerbestätigung bestanden; der Leerflächenfehler ist auf dem getesteten iPhone behoben.

Der Zweigeräte-Test des gemeinsamen Kalenders bleibt offen. Diese Rückmeldung gibt keinen Commit, Push, Merge oder Store-Schritt frei.

## Widget-Gestaltung wie im App-Kalender

Ziel: beide bestätigten iPhone-Widgets übernehmen den gewählten Kalenderhintergrund, die Bildsichtbarkeit, Hell/Dunkel/System und die flachen Dienstbalken mit Kalendernamen beziehungsweise Symbolen und Zeit-/Dauerzeile. Nicht-Ziele: neue Kalenderdaten, Sharing-, Gehalts- oder Berechnungsänderungen, Android-Widgets.

Arbeitspakete: (1) bestehende Kalenderdarstellung in den lokalen Snapshot übernehmen; (2) ausschließlich das ausgewählte lokale Kalenderfoto begrenzt in den vorhandenen App-Group-Speicher kopieren und veraltete eigene Kopien nach Veröffentlichung entfernen; (3) direkte SwiftUI-Anzeige anpassen; (4) Tests, verify:fast, native Kompilierung und erneute iPhone-Screenshot-Abnahme. Dateiscope: Widget-Daten/Synchronisierung und ihre Tests, eine plattformspezifische Fotobrücke, Swift-Renderer, SDK-Generierungstest, notwendige Provider-Reihenfolge und diese Dokumentation. Die bestehende Sharing-Branch enthält den freigegebenen gemeinsamen Build; unabhängige Änderungen bleiben unberührt.

Abnahme: sechs/vierzehn Tage, Foto/Standardhintergrund mit gleicher Überlagerung wie in der App, flache zweifarbige Dienste, vollständige Namen beziehungsweise Kalender-Labelmodus, Mehrfachdienste, Heute, Tageslinks, Foto ändern/entfernen, Hell/Dunkel und eingefärbte Systemdarstellung. Native Änderungen benötigen einen weiteren internen Build innerhalb des bisherigen Auftrags; kein Commit, Push, Merge oder Store-Schritt.

Prüfstand der Gestaltung: `verify:fast` bestanden (447 Unit-Dateien / 8.673 Tests; 132 Komponentensuiten / 1.063 Tests sowie nachgelagerte Prüfungen), sieben SDK-Generierungstests, isolierter Widget-Runtime-Check, Release-Check und interner iOS-Export bestanden. Ein zunächst fehlgeschlagener Starttest ohne Widget-Modul wurde durch die äußere Verfügbarkeitsprüfung korrigiert; die erneute vollständige Prüfung besteht. Die App-Provider-Reihenfolge versorgt verfügbare Widgets mit den tatsächlichen Kalender-Einstellungen.

Die Fotobrücke verwendet ausschließlich das bereits importierte Kalender-JPEG, begrenzt die längste Bildkante auf 720 Pixel und übergibt nur einen relativen Dateinamen. Nach erfolgreicher Veröffentlichung entfernt sie veraltete eigene Widgetkopien; das App-Foto und fremde Widgetdateien bleiben unberührt. Der native Provider liest Bilder vor der View-Darstellung und teilt deren Daten zwischen Timeline-Einträgen. Beide Varianten zeigen dieselbe Zeit-/Dauerzeile wie die App; vollständige Beginn-/Endzeiten und der Folgetag bleiben im Accessibility-Text und in den Tagesdetails erhalten. Die sichtbare Anzahl der Dienstbalken passt sich der Widgethöhe an; weitere Dienste sind über Anzahl und Tageslink erreichbar. Der Header benennt den tatsächlichen Monat beziehungsweise Monats-/Jahreswechsel.

Build 39 gestartet: `bcecc5b7-1d78-484b-947a-7851f5428370`, internes iOS/Preview. Erwartete Runtime: `350007b5875324b9f02b16ca3c3a938d9850c6f4`; SHA256 der nativen Quelle: `980588a8dcc9c0bad2be00b14794bb1312d8c5bd6bfc0207e51b314c61b76093`. Native Kompilierung und die neue visuelle Geräteabnahme bleiben bis zu ihren jeweiligen Nachweisen offen. Der Funktionsnachweis für Build 38 bleibt dokumentiert. Keine Veröffentlichung per OTA, kein Commit, Push, Merge oder Store-Schritt.

## Widget-Gestaltung: Build 39 zur Geräteabnahme

Build 39 (`bcecc5b7-1d78-484b-947a-7851f5428370`) ist FINISHED; Xcode bestätigt ARCHIVE SUCCEEDED. Das tatsächliche IPA enthält die neue native Foto-Anzeige und die Dienstbalken-Typen. Die eingebettete Laufzeit ist `350007b5875324b9f02b16ca3c3a938d9850c6f4`, der Kanal preview. Die tatsächlichen Signatur-Entitlements von App und Erweiterung bestätigen weiterhin `group.com.pflegeshift.app.internal`. Die native Quelle ist seit dem Upload unverändert.

Die visuelle Geräteabnahme ist offen: als Update über LUNA Shift Internal installieren, App/Kalender öffnen und beide Größen mit sechs/vierzehn Tagen prüfen. Gewähltes Kalenderfoto und Bildsichtbarkeit, flache Dienstbalken/Namen/Zeitzeile, Hell/Dunkel sowie Tageslinks mit vollständigen Nachtzeiten/Folgetag prüfen. Foto ändern/entfernen und alternative Kalender-Labelmodi bleiben zusätzliche Gerätefälle. Die Funktion von Build 38 wurde bereits bestätigt; diese neue Gestaltung benötigt eine eigene Rückmeldung. Der Zweigeräte-Sharing-Test bleibt offen.

Installation: https://expo.dev/accounts/vladularu/projects/pflegeshift/builds/bcecc5b7-1d78-484b-947a-7851f5428370. Paket- und Prüfbelege: `eas-build-39-receipt.json`, `build-39-ipa-proof.json`, `widget-app-design-build-readiness.json` und `widget-app-design-verify-fast.log` im lokalen Artefaktverzeichnis. Kein OTA, Commit, Push, Merge oder Store-Schritt.

## Geräteabnahme Widget-Gestaltung Build 39 am 13.10.2026

Der Nutzer bestätigt nach Installation über LUNA Shift Internal: „Ja, Design und Funktionen passen“. Die vorausgehende Prüffrage umfasste beide Widgetgrößen mit sechs beziehungsweise vierzehn Tagen, Kalenderfoto, Dienstbalken mit Namen und Zeitzeile, Hell/Dunkel sowie die Tageslinks zu den richtigen Details. Die visuelle und funktionale Abnahme dieses Umfangs ist für Build 39 auf dem getesteten iPhone damit durch Nutzerbestätigung bestanden.

Foto ändern/entfernen, alternative Kalender-Labelmodi und die eingefärbte Systemdarstellung wurden mit dieser Rückmeldung nicht separat bestätigt. Der Zweigeräte-Test des gemeinsamen Kalenders bleibt offen. Die Rückmeldung ist keine Freigabe für Commit, Push, Merge oder Store-Veröffentlichung.

## Supershift-Anordnung mit LUNA-Darstellung

Ziel: kleine Sechstageansicht (3×2), mittleres Zweiwochenraster (7×2), großes Vierwochenraster (7×4) und kleine Monatsübersicht mit Dienstpunkten. Alle Varianten verwenden die echten Kalenderdienste und den gewählten Hintergrund einschließlich Bildstärke und Hell/Dunkel/System. Jeder Tipp öffnet den Kalender; bisherige Widget-Tageslinks werden ohne Dienstansicht dorthin weitergeleitet.

Nicht-Ziele: Gehaltsberechnungen, Sharing, neue öffentliche Daten oder Push-Funktionen. Zielplattform: internes iPhone. Arbeitspakete: (1) datierte Kalender-/Monatsraster und native Anzeige; (2) einheitlicher Kalenderlink und unsichtbare Weiterleitung alter Links; (3) gezielte Tests, verify:fast, interner Build und Geräteabnahme. Scope: Widget-Daten/Sync/Brücke und Tests, Swift-Renderer/Monatsquelle, SDK-Plugin/Generierungs- und Runtime-Test, app.json/Fingerprint, bisherige Widget-Route/Redirect-Test und Dokumentation. Der bestehende gemeinsame codex/calendar-sharing-mvp-Arbeitsstand wird weiterverwendet; andere Änderungen bleiben erhalten.

Abnahme: Montag/Sonntag und ISO-Kalenderwochen, Monats-/Jahreswechsel, Februar/Schaltjahr und sechszeilige Monate, echte Farben/Namen/Zeiten und mehrere Dienste, Foto ändern/entfernen, Hell/Dunkel/System, alle Tippflächen zum Kalender sowie leere/abgelaufene Zustände. Nutzerfreigabe am 13.10.2026 umfasst Umsetzung und internen Build. Git-/Store-Weitergabe gehört nicht zum vereinbarten Widget-Ergebnis. Native Kompilierung und Geräteabnahme bleiben eigenständige Nachweise.

## Kalenderwidgets: Build 40 gestartet

Der geprüfte Stand ist als interner iOS-Preview-Build 40 hochgeladen: https://expo.dev/accounts/vladularu/projects/pflegeshift/builds/34e1aa3a-acbf-469f-8ac1-6516da42275c. Die Runtime d2e52d4af01945c52cfb0bc505d7502987dd2b7d entspricht dem lokal erzeugten Fingerprint. verify:fast ist bestanden (447 Unit-Dateien / 8.677 Tests; 132 Komponentensuiten / 1.063 Tests und nachgelagerte Prüfungen), ebenso acht SDK-Generierungstests, isolierte Widget-Laufzeit, Release-Check und interner iOS-Export. Die erste Gesamtprüfung erkannte neue Farbliterale; nach Verwendung der bestehenden App-Farben besteht der vollständige erneute Lauf.

Native Kompilierung, Paketprüfung und iPhone-Abnahme bleiben bis zu ihren jeweiligen Nachweisen offen. Abnahme für Build 39 bleibt historisch dokumentiert. Nach Installation App/Kalender öffnen und alle vier Ansichten, Kalenderfoto/Bildstärke, Hell/Dunkel/System und Tipp auf Datum/Dienst/leere Fläche prüfen. Auch alte Widget-Tageslinks dürfen nur den Kalender öffnen. Der Zweigeräte-Sharing-Test bleibt offen.

## Kalenderwidgets: Build 40 zur Geräteabnahme

Build 40 (`34e1aa3a-acbf-469f-8ac1-6516da42275c`) ist FINISHED. Xcode bestätigt ARCHIVE SUCCEEDED und die Kompilierung beider Swift-Dateien. Das heruntergeladene IPA enthält LUNAShiftCalendar, LUNAShiftMonth und den nativen Hintergrund-/Kalender-Renderer. Die eingebettete Runtime ist `d2e52d4af01945c52cfb0bc505d7502987dd2b7d`, Kanal preview. App und Erweiterung besitzen die tatsächlichen Signatur-Entitlements für `group.com.pflegeshift.app.internal`. Die geprüften nativen Quellen sind seit dem Upload unverändert.

Installation: https://expo.dev/accounts/vladularu/projects/pflegeshift/builds/34e1aa3a-acbf-469f-8ac1-6516da42275c. Als Update über LUNA Shift Internal installieren und App/Kalender öffnen. In der Widget-Auswahl bietet „Kalender“ klein sechs Tage (3×2), mittel zwei Wochen (7×2) und groß vier Wochen (7×4); „Dieser Monat“ bietet das kleine Monatsraster mit Dienstpunkten. Die Wochenansichten beginnen montags, die Sechstageansicht am heutigen Tag. Kalenderfoto/Bildstärke, Dienstbalken/Namen/Zeiten und Hell/Dunkel/System stammen aus der App. Datum, Dienst und freie Widgetfläche öffnen ausschließlich den Kalender. Die bisherige Widget-Tagesroute ist eine unsichtbare Kalenderweiterleitung; die Dienstansicht dort ist entfernt.

Geräteabnahme bleibt offen: vier Varianten, Foto ändern/entfernen, Hell/Dunkel/System und Tippflächen bei Appstart sowie bereits geöffneter App prüfen. Die iOS-Einfärbung verwendet die systemgerechte Darstellung. Der getrennte Zweigeräte-Sharing-Test bleibt offen. Paket-/Prüfbelege: `eas-build-40-receipt.json`, `widget-grid-ipa-proof.json`, `widget-grid-build-readiness.json` und `widget-grid-verify-fast.log` im lokalen Artefaktverzeichnis.

## Gerätefehler nach Build 40: alte Widget-Daten bleiben stehen

Am 13.10.2026 zeigen die Nutzer-Screenshots eine rollierende Zweiwochenansicht ohne Bild-/Theme- und Chip-Metadaten, obwohl Build 40 die neue native Darstellung enthält. Das Testlabor bestätigt CALENDAR_WIDGET_SYNC_FAILED (Error), bei vorhandenem Modul, erreichbarer App Group und 15 alten Timeline-Einträgen. Kein aktuelles Preview-OTA hat die neue Build-40-Runtime. Die tatsächliche IPA-App enthält die neuen Raster-/Darstellungsfelder.

Ziel: den fehlgeschlagenen Snapshot-Upload beheben, sodass Montag-bis-Sonntag-Raster, Monatsraster, App-Foto, Hell/Dunkel und zweifarbige Dienstbalken auf dem vorhandenen Build 40 ankommen. Scope: Widget-Speicherübergabe und gezielter Regressionstest, interne Metadaten-Diagnose und Tests, Dokumentation. Keine Fachlogik-/Native-/Sharing-/Datenbankänderungen. Der SDK-57-Speicher legt Props direkt in UserDefaults ab; dessen Property-List-Format erlaubt keine null-Werte in verschachtelten Arrays/Dictionaries. Die neuen optionalen Foto-/Symbol-/Detailfelder enthalten solche Werte. Die Swift-Decoder akzeptieren das Weglassen optionaler Felder bereits.

Abnahme: konkrete vollständige Widget-Props sind als Property List speicherbar und bleiben fachlich unverändert; interne Diagnose unterscheidet alte Daten vom neuen Kalenderdesign ohne Dienstnamen/Pfade; alle lokalen Gates und Build-40-Fingerprint bestehen; Preview/iOS-OTA nur für diese Runtime, anschließend erneute iPhone-Prüfung. Die bisherigen vollständigen Nutzerfreigaben gelten. Ein weiterer nativer Build ist für die reine Datenübergabe nicht notwendig.

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
