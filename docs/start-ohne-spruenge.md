# Ruhiger App-Start · 03.11.2026

Ziel: Die zwei auf dem iPhone beobachteten Startprobleme eingrenzen und beheben:
kurzer Dunkel-zu-Hell-Wechsel sowie nachträgliches Aufziehen des Monatskalenders.
Die zwei Screenrecordings zeigen jeweils etwa drei Sekunden App-Start; der separate
Screenshot zeigt den neuen Onboarding-Einstieg.

Nicht-Ziele: Änderungen an Logo-Geometrie, Onboarding, endgültigem Kalenderlayout,
Monatsgesten, Fachlogik, Katalogen oder Widgets.

Basis: 2.400 hashgeprüfte Quelldateien des fertiggestellten Preview-Builds 49,
Runtime `402e757d98ca799660ce5dd15a24bd999cf690eb`. Separater Branch
`codex/start-ohne-spruenge`; der Build-49-Stand bleibt unverändert nachvollziehbar.
Zielplattform: echtes iPhone; Expo SDK `~57.0.31`, Dokumentation SDK 57.

## Paket 1 · Kalender vor dem Sichtbarwerden fertig messen

Beobachtung: Kopfbereich bleibt beim Start stehen, die Wochenzeilen wachsen anschließend
noch. Der Plus-Button kann vor dem Kalender über dem Startlogo erscheinen.

Codeabgleich: Die Startfreigabe prüft bislang Daten und Pager-Position, aber nicht die
endgültige Geometrie nach gemessenem Kopfbereich. Die Kalenderfläche wird über einen
negativen Kopfüberlappungsabstand vergrößert; der Kalenderinhalt hat eine weitere eigene
Größenmessung. Die Bedienelemente liegen auf iOS in einem FullWindowOverlay oberhalb
des nativen Splash-Screens.

Dateiscope: Kalender-Screen, Start-/Viewport-Hook, Header-Messung, gemeinsame Kalenderfläche, Overlay und
zugehörige Tests; gemeinsame Konstante für den bereits bestehenden Splash-Fade samt
Import im Root-Layout. Keine Änderung der endgültigen Abstände oder Paging-Physik.

Abnahme: Erst nach übereinstimmender äußerer Höhe, Kopfbereich, Kalenderfläche und
bestätigter Pager-Position freigeben; Plus während der Vorbereitung unsichtbar und ohne
Touch-/VoiceOver-Zugriff, danach mit dem bestehenden Splash-Fade sichtbar. Warme
Navigation darf keinen erneuten Startvorhang erhalten. Fehler-/Onboarding-Pfade bleiben
erreichbar. Gezielte Regressionen und `verify:fast` müssen bestehen; iPhone-Abnahme offen.

## Paket 2 · Hell-/Dunkel-Start

Beobachtung: Im zweiten Video erscheint erst die dunkle, anschließend die helle Logo-
Variante. Im Code wird der gespeicherte LUNA-Modus erst nach dem asynchronen Laden der
Darstellung an die native Appearance-API übergeben. Der Nutzer hat bestätigt: In LUNA
wurde explizit „Hell“ gewählt. Das native Fenster erhält diesen Override bisher,
während das dynamische Launch-Storyboard noch sichtbar ist; dadurch wechselt dessen
Logo ebenfalls von Dunkel auf Hell.

Korrektur: Die Palette des App-Inhalts verwendet die gespeicherte Auswahl sofort.
Der native Appearance-Override wartet dagegen bis nach dem bereits vorhandenen
300-ms-Splash-Fade plus einem Frame. `hideAsync` bestätigt im installierten SDK nur
den Hide-Aufruf, nicht das Ende der UIKit-Animation. Startfreigabe und Ende des Fades
sind deshalb getrennte Ereignisse. Spätere Moduswechsel werden weiterhin sofort
angewendet; abgemeldete Provider können keinen veralteten Modus setzen.

Dateiscope: Start-Barriere samt Tests, Root-Layout und Darstellungs-Provider samt
Tests. Keine native Integration oder Asset-Änderung erforderlich.

Abnahme: Das Startlogo bleibt in einer Variante, anschließend erscheint der fertige
Kalender direkt im gewählten LUNA-Modus. Der allererste iOS-Launchscreen folgt weiter
dem Systemmodus des iPhones; diese Korrektur gleicht ihn nicht an eine manuelle
App-Auswahl an. Hell/Dunkel jeweils mit gleichem und abweichendem iPhone-Modus sowie
Systemmodus auf dem iPhone prüfen. Kein Logo-Wechsel während der Anzeige, keine
zusätzliche Wartezeit vor Kalenderfreigabe. Diese Geräteabnahme ist noch offen.

Kein neuer Build, OTA, Commit oder Git-Delivery-Schritt ist durch die Video-Rückmeldung
freigegeben. Die Veröffentlichung einer Korrektur ist ein eigener Schritt.
