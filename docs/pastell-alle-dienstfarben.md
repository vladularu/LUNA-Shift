# Pastellmodus für alle Dienstfarben

## Vertrag und Umfang

Ziel: Alle Dienstfarben einschließlich individueller Farben werden im bestehenden Pastellmodus hell und lesbar angezeigt. Aktuelle und historische Standard-Pastellpaare bleiben exakt erhalten. Originaldaten werden nicht geändert; Ausschalten stellt ihre Darstellung wieder her. Spätere Farbänderungen greifen sofort. Die bestätigte Auswahlansicht bleibt erhalten.

Zielplattform: iPhone, Expo SDK 57 (~57.0.31). Die passende versionierte SDK-57-Dokumentation wurde geprüft. Keine neue native Abhängigkeit, kein Build, keine Änderung an Berechnung, Termin-/Feiertagsfarben oder Widgets.

Die Arbeit erfolgte in getrennten Paketen: Preference, Persistenz und Auswahl; Farbabbildung und Kalenderdarstellung; anschließend die Erweiterung auf individuelle Farben. Der Lieferbranch codex/pastellfarben-release integriert diese Pakete auf aktuellem master. Die 27 freigegebenen Dateien betreffen die Kalender-Preference samt Backup-Validierung, lokale Farb-/Auswahlkomponenten, Weitergabe an die Kalenderansichten, zugehörige Regressionstests und zwei Dokumente. Unabhängige Preview- und Arbeitsverzeichnisänderungen sind kein Teil der PR.

## Farbregel

Die 14 aktuellen und sechs historischen Vorgabefarben behalten ihre bekannten Pastellpaare. Andere gültige drei- oder sechsstellige Hex-Farben werden in Richtung Weiß auf mindestens 90 Prozent HSL-Helligkeit gebracht, ohne ihren Grundfarbton zu ändern. Bereits ausreichend helle Farben und bekannte Pastelltöne bleiben stabil. Integer-basierte Rundung verhindert ein weiteres Aufhellen beim wiederholten Rendern. Transparente oder ungültige Werte werden nicht in deckende Farben umgedeutet.

Die Anzeige wirkt auf Monatskalender, Gestaltungsvorschau, Jahres-/Überlaufmarkierungen und geteilte Dienste. Titel, Symbole und Detailzeilen bleiben kontrastreich. Die Originalfarben in Einträgen und Vorlagen bleiben unverändert.

## Nachweise und Freigabe

58 fokussierte Farb-/Kontrasttests prüfen alle 188 angebotenen individuellen Farbfelder und zusätzliche Hex-Grenzfälle. 86 fokussierte Komponententests decken Dienstchips, Vorschau, nachträgliche Farbwechsel, Jahres-/Überlaufmarkierungen, geteilte Dienste und den echten Monatsrenderer ab. Eine lokale Sichtprüfung der Originalkomponenten in Hell/Dunkel bestätigte die Darstellung ohne Überlauf.

Beim früheren vollständigen Preview-Prüflauf bestanden 10065 Unit-Tests. Ein bestehender Pager-Test überschritt im gesamten Komponentenlauf das unveränderte lokale 5-Sekunden-Limit; dieselbe unveränderte Pager-Suite bestand danach mit 17/17 Tests. Alle übrigen Projekt-Gates wurden separat bestanden. Das war kein einzelner vollständig grüner verify:fast-Lauf. Die Prüfungen des sauberen Lieferbranches werden erneut ausgeführt und im PR dokumentiert.

Die iPhone-Preview d3adc4f8-d306-43bd-8590-dd868ddc46ac wurde am 30.10.2026 mit „ja passt, super“ abgenommen. Der Nutzer autorisierte anschließend Commit, Push, PR, Merge nach erfolgreicher CI und TestFlight-OTA. Für die TestFlight-OTA müssen die vollständigen aktuellen Production-Quellen erhalten bleiben und die Runtime zum bestehenden Build passen. Technische Liefernachweise ersetzen die spätere TestFlight-Abnahme am iPhone nicht.
