# Footer-Icons und Jahresansicht

## Task-Vertrag

- Ziel: Tageszahlen 1–31 im Footer-Kalender sichtbar zentrieren, durchgehend Kontur-Icons im nativen Footer verwenden und das Jahresansicht-Icon der Auswertung an den Kalenderkopf angleichen.
- Nicht-Ziele: Kalenderlayout, Freigaberechte, Tageskachel-Animationen, neue native Module, Widget-Build oder Serveränderungen.
- Plattform: iOS, bestehendes TestFlight Build 5; JavaScript-Fallback erhält ebenfalls die korrigierten Tagesbilder.
- Scope: Generator und seine eine JSON-Bildsammlung, nativer Tab-Footer, vorhandene Footer-Komponententests und Auswertungsheader.
- Abnahme: Alle 31 Zahlen innerhalb des Kalenders mittig; keine gefüllten Balken im Footer; derselbe CalendarDays-Kontur-Iconname und dieselbe Größe in beiden Jahresansicht-Schaltern; Tageswechsel und VoiceOver bleiben funktionsfähig.
- Freigaben: Implementierung, Commit, Push, PR, Merge nach vollständiger CI und kompatible Production-iOS-OTA wurden vom Nutzer ausdrücklich freigegeben. Kein nativer Build.
- Geräteabnahme: Nach OTA auf dem iPhone prüfen; lokale Pixelprüfung, Tests und Exporte ersetzen diesen Nachweis nicht.

## Umsetzung

Der Generator zentriert die sichtbare Pixelkontur der Zahl im Bereich zwischen Kopftrennlinie und unterem Kalenderrahmen. Schriftmetriken einschließlich leerer Vor- und Nachbreiten bestimmen die Position nicht mehr.

Der native Footer verwendet für Auswertung, Schichten und Mehr ausdrücklich die Konturvarianten derselben Ionicons-Familie als getönte Bildquelle. SF-Symbole überschreiben diese Bildquellen auf iOS nicht mehr. Die Auswertung nutzt bar-chart-outline statt des Symbols mit gefüllten Balken.

Der Jahresansicht-Schalter der Auswertung verwendet wie der Kalenderkopf calendar-number-outline (CalendarDays im LUNA-Iconadapter), Größe 22.

Expo-Abgleich: installiertes SDK ~57.0.22; Referenz https://docs.expo.dev/versions/v57.0.0/sdk/router/native-tabs/. Keine Änderung an Abhängigkeiten oder nativer Konfiguration.

## Geräteprüfung

1. Footer mit ein- und zweistelliger Tageszahl prüfen, besonders 1, 8, 11, 14 und 31.
2. Zwischen allen vier Tabs wechseln: Konturstil bleibt auch beim ausgewählten Tab erhalten.
3. Jahresansicht im Kalender und in der Auswertung öffnen und die identischen Icons vergleichen.
4. Tageswechsel nach Hintergrund/Resume und VoiceOver-Bezeichnung prüfen.
