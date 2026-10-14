# Tagesmarkierung und geteilte Icons

Ziel: Die sichtbare Tagesmarkierung ist kleiner (24 statt 30 pt). Der Tag der geöffneten Tageskachel verwendet dieselbe Farbe und Schrift wie Heute. Nach Schließen oder Fokusverlust verschwindet seine temporäre Markierung. Der echte heutige Tag bleibt markiert. Freigabe-Symbolnamen wie sunrise werden als vorhandene LUNA-Icons gerendert.

Plattform: iPhone, Expo SDK 57, TestFlight Build 5. Scope: Kalender-Popup-Zustand, Datumsglyphen, gemeinsamer Renderer für Freigabe-Symbole und betroffene Popup-/Kalender-/Editor-Ansichten samt Regressionstests. Zwei Pakete: Markierung/Lebensdauer und Freigabe-Iconübersetzung.

Nicht-Ziele: keine Änderung der Kalendergeometrie, Datumspositionen oder Bedienflächen; keine Veränderung eigener Textsymbole; keine Server- oder native API-Änderung.

Abnahme: Heute und geöffneter Tag sehen gleich aus; Markierung wird beim Dismiss entfernt; Öffnen/Schließen und Editor-Rückkehr erzeugen keine Layoutverschiebung; sunrise/clock/calendar/unavailable zeigen Icons in Tageskachel, Symbolansicht und schreibgeschütztem Editor. Die iPhone-Sichtprüfung folgt nach der freigegebenen OTA.
