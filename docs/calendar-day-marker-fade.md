# Tagesmarkierung und Tageskachel gemeinsam ausblenden

## Task-Vertrag

Ziel: Kreis und Tageszahl des geöffneten Tages laufen beim Schließen mit exakt derselben Opazität wie die Tageskachel.
Nicht-Ziele: Kalendergeometrie, Markergröße, Freigabeformat, Widget-Integration und native Konfiguration ändern.
Plattform: iPhone / TestFlight Build 5, kompatible iOS Production-OTA.
Scope: Popup-Motion-Hook, Popup, Kalender-Screen, gemeinsame Monatsansicht und Datumsrenderer; zugehörige Komponenten-Tests und dieses Dokument (9 Dateien).
Abnahme: gleicher Zwischenwert während des Fades; keine Markierung nach Dismiss; Heute bleibt markiert; nächstes Popup startet ohne alte Restopazität; reduzierte Bewegung bleibt unterstützt.
Freigaben: Bestehende vollständige Freigabe für Umsetzung, Git-Delivery und OTA im Kalender-Sharing-Flow; kein nativer Build.

## Umsetzung

Eine abgeleitete Opazität aus der bestehenden Popup-Animation steuert das Popup. Eine UI-Thread-Reaktion übergibt denselben Wert an den Datumsrenderer. Der Kreis blendet aus; die Tageszahl geht zum normalen Wochentags- oder Wochenendfarbton zurück. Kein separater Timer und keine zweite Fade-Animation. Heute bleibt von der Popup-Opazität unabhängig.

## Prüfung

Gezielte Tests prüfen unterbrochenes Öffnen, Fade-Zwischenwerte, Dismiss und erneutes Öffnen sowie die gemeinsame Weitergabe des Animationswerts. verify:fast, CI und iOS-Export vor Veröffentlichung erforderlich. Die sichtbare Abnahme dieser Animation auf dem iPhone erfolgt nach OTA-Verteilung; der vorherige Marker-/Icon-Fix wurde vom Nutzer als funktionierend bestätigt.
