# Tageszahl ohne Schriftsprung am Fade-Ende

## Task-Vertrag

Ziel: Kein abrupter Wechsel von fett zur normalen Tageszahl beim Schließen der Tageskachel.
Nicht-Ziele: Markergröße, Popup-Dauer, Kalendergeometrie, Freigaben, Datenmodell oder native Konfiguration ändern.
Plattform: iPhone / TestFlight Build 5, kompatible iOS Production-OTA.
Scope: Datumsrenderer, zugehörige Komponenten-Tests und dieses Dokument (3 Dateien).
Freigaben: Bestehende vollständige Freigabe für Umsetzung, Git-Delivery und OTA im Kalender-Sharing-Flow; kein nativer Build.
Abnahme: Normale Tageszahl behält Textinstanz, Schriftstärke, Farbe und Position vor, während und nach dem Fade. Die fette Zahl und der Kreis darüber verwenden den bestehenden gemeinsamen Popup-Fade. Bei Opazität 0 ist die fette Ebene unsichtbar, bevor sie entfernt wird. Heute bleibt dauerhaft fett und markiert.

## Evidenz und Umsetzung

Die gelieferte Aufnahme ist 3,56 Sekunden lang. In den letzten Frames wird die markierte 16 nach dem Fade sichtbar von fett auf normal umgeschaltet. Der bisherige Renderer entfernt dabei die animierte Zahl mit Schriftstärke 700 und ersetzt sie durch die normale Zahl mit Schriftstärke 500.

Die normale Tageszahl bleibt nun dauerhaft montiert. Nur die aktive Auswahl erhält eine absolute Ebene mit Kreis und fetter Zahl; diese Ebene blendet gemeinsam aus. Die bestehende Popup-Opazität bleibt der einzige Taktgeber. Alle anderen Tageszahlen behalten ihren statischen Renderpfad.

## Prüfung

Tests decken gemeinsame Zwischenwerte, die unveränderte normale Textinstanz, das Entfernen der bereits unsichtbaren Ebene und die dauerhafte Heute-Markierung ab. verify:fast, CI und iOS-Export sind vor Veröffentlichung erforderlich. Die sichtbare Abnahme der neuen Version erfolgt nach OTA-Verteilung auf dem iPhone.
