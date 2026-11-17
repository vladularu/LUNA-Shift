# Auswertung: fester Kopf bei Zeitraumwechseln

## Auftrag und Referenz

Der Kopf bleibt beim horizontalen Monats- und Jahreswechsel an derselben Stelle. Nur die Berichtskarten gleiten darunter. Referenz ist die vom Nutzer gelieferte Supershift-Aufnahme vom 17.11.2026, 17:01:44 (5,92 Sekunden, 1290 × 2796 Pixel). In den Übergängen um 0,5 und 4 Sekunden bleiben Titel, Datumszeile und Kalenderaktion stehen, während die Karten seitlich wechseln.

Zielplattform ist die iOS-Preview mit Expo SDK 57. Ausgangspunkt ist die veröffentlichte Preview-Gruppe `feaee4a3-729f-4e0e-acfd-67162870d450` mit der bereits übernommenen Pager-Optimierung und den zuletzt korrigierten Pfeilabständen und Header-Abständen. Diese Gestaltung wird beibehalten.

## Umfang

- `ReportPeriodPager` erhält einen optionalen Kopf außerhalb des horizontalen ScrollView. Gemessen wird weiterhin nur die Kartenfläche. Die vorhandene native Navigation, Vorbereitung und Wiederverwendung der Seiten bleiben bestehen.
- Die Auswertungsübersicht rendert genau einen Monats- oder Jahreskopf. Vorbereitete Seiten und Platzhalter enthalten keinen zusätzlichen Kopf.
- Der aktive Monatsbericht meldet seinen tatsächlich sichtbaren Monat. Dadurch bleiben zurückgehaltene Werte und die Datumszeile bei noch nicht fertiger Vorbereitung zusammengehörig.
- Die Jahresansicht übernimmt die vorhandene Zahl der Monate mit Einträgen. Lade- und Fehlerzustände behalten ihre Navigation; eigenständig verwendete Jahresberichte behalten ihren bisherigen Kopf als Standard.
- Betroffen sind fünf UI-Dateien, die zugehörigen Navigationstests, dieses Dokument und die genauen Hash-Einträge im Quellschutz. Berechnungen, Datenhaltung, native Konfiguration und andere Seiten sind nicht Gegenstand der Änderung.

## Abnahme

1. Bei seitlichem Ziehen bleibt der ganze Kopf stehen und wird nie doppelt angezeigt.
2. Pfeile, schnelle Mehrfachtipps, reduzierte Bewegung und Monats-/Jahreswechsel wählen weiterhin den richtigen Zeitraum.
3. Nach Größenänderungen und dem Verschieben des Pager-Fensters bleibt die vorbereitete Seite erhalten.
4. Große Schrift, Ladezustände und explizite Fehler bleiben lesbar und bedienbar.
5. Datum und angezeigte Monatswerte bleiben während der Vorbereitung zusammengehörig; der Jahreszähler folgt dem aktiven Bericht.

Automatische Tests können die Anordnung und Navigation prüfen. Die Sichtprüfung auf dem iPhone mit zugeordneter Preview-Update-ID bleibt erforderlich. Dieser Implementierungsauftrag enthält keine neue OTA-, Build- oder Git-Veröffentlichungsfreigabe.
