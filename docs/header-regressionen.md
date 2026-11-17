# Header-Regressionskorrektur vom 17.11.2026

Referenz: Foto 1 und Video 19:18:58 aus der Rückmeldung zur Preview-OTA `01a1eab4-a5e7-765c-a95c-6788d8e95490`. Die aktuelle Quelle wurde vor der Änderung unter `C:/Users/veron/.codex/tmp/header-regressionen/before/` eingefroren. Expo SDK 57, Router 57.0.30, Screens 4.26.2. Branch: `codex/header-regressionen`.

Zielplattform: iPhone, bestehende Preview Build 54. Ziel: vollständig enthaltene Header-Buttons, Zurückwischen am Kalenderrand bei weiterhin bedienbarem Fotoregler und stabil sichtbare Info-Inhalte nach der Sheet-Öffnung. Natives Glas, Titel, rechte Aktionen und der gemeinsame Seitenübergang bleiben erhalten. Nicht-Ziele: Rechenregeln, Daten, Abhängigkeiten, native Module, Branding und TestFlight.

## Arbeitspakete

1. Kopfzeile: Die generische Headerberechnung korrigiert die Statusleiste bei Dynamic-Island-Geräten innerhalb ihrer alten 44-Punkt-Geometrie. Die neue Kopfzeile reserviert die echte Safe Area und eine vollständige Zeile für 44-Punkt-Buttons samt Abstand. Große Schrift erhöht die Zeilenhöhe.
2. Kalendergeste: Der native Content-Pop-Recognizer bleibt aktiv, seine Startfläche ist auf die ersten 32 Punkte am linken Rand begrenzt. So bleibt die Geste bei ausgeblendeter nativer Leiste verfügbar und der Fotoregler außerhalb dieses Bereichs eigenständig bedienbar.
3. Info-Sheets: Die Scrollfläche wird ohne zusätzliche native View-Hülle direkt im Screen gerendert. Screens 4.26.2 kann dann den vorgesehenen FormSheet-Größenabgleich verwenden, statt auf die ältere Frame-Zuweisung für verschachtelte Scrollflächen zurückzufallen. Bestehende gewöhnliche BackFooterLayout-Aufrufer behalten ihre Hülle.

Dateiscope: `page-stack-header`, `horizontal-back-gesture`, opt-in `BackFooterLayout`, `settings-info-details-screen`, deren Regressionstests, dieses Dokument und exakte Quellvergleichseinträge. Die zuvor veröffentlichte Quelle für Widgets, Auswertung und Diagnose bleibt erhalten.

## Abnahme

- Arbeit & Gehalt: Header vollständig hinter Zurück und Speichern, auch beim Scrollen und bei großer Schrift; kein Herausragen und kein abgeschnittener Inhalt.
- Kalender gestalten: langsames Zurückwischen vom Rand, Abbruch und vollständiges Zurück; Fotoregler in beide Richtungen verändern.
- Mehr: Über LUNA Shift, Berechnungshinweise und Lokale Datenspeicherung mehrmals öffnen und schließen. Inhalt muss nach Abschluss der Sheet-Animation sichtbar und scrollbar bleiben. Native Kopfzeile, Glas und unterer Zurückbutton prüfen.
- Helles/dunkles Erscheinungsbild und reduzierte Transparenz prüfen.

Lokale Tests und Export ersetzen diese iPhone-Abnahme nicht. Für diese neue Korrektur wurde noch keine weitere OTA freigegeben oder veröffentlicht; kein Commit, Push oder nativer Build.

## Lokale Prüfung

- `npm.cmd run verify:fast`: erfolgreich, einschließlich 11141 Logiktests und 2170 Komponententests in 225 Suites sowie der weiteren Projektprüfungen.
- Die gezielten Header-, Glasbutton-, Info-Sheet- und Gestenprüfungen sind bestanden.
- iOS-Export erfolgreich; Runtime unverändert `642bfaefe006b4d4d3114c76973debf29b16036d`. Keine Abhängigkeit oder native Integration geändert.
- Geschützter Quellvergleich erfolgreich. Der native Glas-Button und 35 weitere bereits vorhandene Änderungsdateien stimmen mit der eingefrorenen Quelle überein. Neue Korrektur: vier App-Dateien, drei Testdateien, dieses Dokument und die Quellvergleichseinträge.
- Protokolle, Export, Runtime- und Quellnachweise: `C:/Users/veron/.codex/tmp/header-regressionen/`.

Die Abnahme am iPhone und die Freigabe für eine weitere Preview-OTA stehen aus.
