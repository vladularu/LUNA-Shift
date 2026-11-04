# TestFlight-Abgleich: Widgets

## Auftrag und Abnahme

Ziel: Die zuvor im master fehlenden, auf dem iPhone abgenommenen Widget-Funktionen dauerhaft integrieren. Referenz ist die wiederhergestellte TestFlight-Build-9-OTA `ac656e8a-0c56-4e5b-8229-ab34cfe1cdc3`, deren Bundle und 34 Assets exakt der bereits geprüften Gruppe `45dcdf3b-f802-4625-82e9-f380ce86455e` entsprechen.

Gerätenachweis am 04.11.2026: „Auf iPhone passt das, erledige die restliche Aufgaben wie beschrieben.“

Plattform: iOS/TestFlight Build 9; Widget-Datenaufbereitung plattformunabhängig.

Nicht-Ziele: Keine Änderung der Tarif-/Regelkatalog-Auswahl, Datenbank, Netto-Berechnung oder Einladungslogik. Keine neue OTA und kein neuer nativer Build im Rahmen dieser Git-Integration.

## Getrennte Arbeitspakete

1. Widget-Daten, Synchronisierung, Renderer und Regressionstests; vorhandener nativer Build-9-Widget-Renderer.
2. Bereits abgenommene Oberfläche und vorhandene Build-9-Nativebasis; getrennte Teilpakete für Bedienelemente, Navigation und Nativebasis.
3. Automatischer Vergleich mit dem abgenommenen TestFlight-Quellstand, Regressionstests und Veröffentlichung über einen geprüften Einstiegspunkt.

Commit, Push, PR und Merge nach grüner CI sind durch den Folgeauftrag für diese Pakete freigegeben. EAS-Veröffentlichungen sind hier nicht erforderlich; die abgenommene OTA bleibt bestehen.

## Dateiscope Paket 1

- `src/features/widgets/calendar-widget-data.ts`
- `src/features/widgets/calendar-widget-data.test.ts`
- `src/features/widgets/calendar-widget-sync.tsx`
- `src/features/widgets/calendar-widget-sync.component.test.tsx`
- `src/features/widgets/calendar-widget.ios.tsx`
- `src/features/widgets/shared-widget-data.test.ts`
- `src/features/widgets/widget-calendar-highlights.ts`
- `src/features/widgets/widget-calendar-highlights.test.ts`
- `plugins/luna-calendar-widget/LUNAShiftCalendar.swift`
- `scripts/verify-calendar-widget-runtime.mjs`
- dieses Dokument.

Die zehn Implementierungs-/Testdateien stammen bytegleich aus dem eingefrorenen, abgenommenen TestFlight-Quellstand. Der vorhandene Swift-Renderer ist bereits Bestandteil von Build 9; es wird keine neue native Implementierung eingeführt.

## Abnahmekriterien

- Eigene und geteilte Dienste übernehmen Pastellfarben.
- Eigene/geteilte Termine werden getrennt von Diensten übergeben; ausgeblendete Termine fehlen.
- Feiertage, Sondertage, Tagesfarben und passende Sprachausgabe bleiben erhalten.
- Änderungen der zugehörigen Einstellungen aktualisieren die Widget-Timeline.
- Hintergrund, Darstellung, Nachtdienste und Datumsraster funktionieren weiterhin.
- Der aktuelle master-Regelkatalog sowie Netto- und Einladungs-Korrektur bleiben unverändert.
- Fokussierte Tests, Widget-Runtime-Prüfung, `verify:fast` und sämtliche PR-CI-Gates bestehen.
