# Kalender: mehrere Dienste und Termine

## Auftrag und Grenzen

- Freigegeben am 29.10.2026: drei getrennte Arbeitspakete in der Reihenfolge unten.
- Basis: aktueller `origin/master`, `111283263230a22f94df2c5e4252c176755186e6`.
- Branch: `codex/calendar-multi-entry` in einem eigenen Worktree.
- Zielplattform: iPhone; kleinere Bildschirme, große Schrift und Hell-/Dunkelmodus berücksichtigen.
- Referenzen: die sechs vom Nutzer bereitgestellten Fotos; Supershift in Foto 1–3 und 6, LUNA in Foto 4–5.
- Keine Änderungen an Arbeitszeit-/Tarifberechnung, Datenbankschema, Synchronisierung, nativen Abhängigkeiten oder Branding.
- Vorhandene Änderungen im ursprünglichen Checkout bleiben unberührt.
- Die Umsetzung erfolgte zunächst ohne Veröffentlichung. Anschließend wurde am 29.10.2026 ausschließlich eine iOS-Preview-OTA freigegeben. Commit, Push, nativer Build und TestFlight bleiben ohne Freigabe.

## 1. Unbeabsichtigte neue Termine verhindern

Schließen, Herunterziehen und Zurücknavigation verwenden dieselbe Entscheidung: Ein unveränderter Termin wird ohne Schreibvorgang geschlossen. Das gilt auch nach dem Öffnen und Schließen eines Unterdialogs sowie nach vollständig zurückgenommenen Änderungen. Eine tatsächlich geänderte Uhrzeit oder Einstellung reicht weiterhin zum Speichern. Bestehende unveränderte Termine behalten ihre Revision. Speicherfehler und Mehrfachauslösung bleiben abgesichert.

Scope: Termin-Entwurf und Schließlogik unter `src/features/day-editor/` sowie gezielte Tests.

Umgesetzt: Der bestehende Entwurfsvergleich gilt jetzt auch für neue Termine. Ein neuer Dienst behält sein bisheriges Verhalten. Regressionstests prüfen unverändertes Schließen, Optionsdialoge ohne Auswahl, zurückgenommene Änderungen, bewusst geänderte Einstellungen und beide Schließwege mit echtem Expo Router.

## 2. Kompaktes Monatsraster

Ein Dienst mit Name und Zeit benötigt ungefähr dieselbe Höhe wie zwei Terminzeilen. Zwei sichtbare Dienstblöcke erhalten einen dezenten Abstand; Name und Zeit innerhalb einer Kachel bleiben zusammen. Zusätzliche verdeckte Einträge erscheinen als begrenzte Reihe kleiner Farbpunkte unter dem Datum. Die Punkte belegen keine zusätzliche Eintragszeile. Lange Termintitel nutzen die verfügbare Breite; der vollständige Titel bleibt gespeichert und zugänglich. Feiertage, sechs Kalenderwochen, geteilte Einträge und die bestehenden Anzeigeoptionen werden berücksichtigt.

Scope: aktive Kalender-Renderer, Vorschau-/Platzberechnung und entsprechende Tests. Keine Umgestaltung anderer Kalenderbereiche.

Umgesetzt: Dienste stehen vor den kompakten Terminzeilen. Zwei Terminzeilen belegen eine Diensthöhe; der reguläre Abstand zwischen Dienstblöcken beträgt vier logische Punkte und wird in besonders kurzen Zellen reduziert. Die Punktreihe zeigt bis zu fünf verdeckte Einträge und danach einen dezenten Sammelhinweis. Eigene und geteilte Termine verwenden dieselbe kompakte Beschriftung; geteilte Einträge behalten ihren Kalenderstreifen. Die Schriftregel registriert ausschließlich diese begrenzte Kalenderbeschriftung als zusätzlichen kompakten Kontext.

## 3. Scrollbares Tagespopup

Das Tagespopup enthält alle Einträge und wächst bis zur verfügbaren Höhe. Danach scrollt nur die Liste. Hinzufügen bleibt im festen Fußbereich erreichbar. Im Popup erscheinen weder ein zusätzliches Datum noch ein X-Schließenknopf; geschlossen wird über einen Tipp außerhalb oder die bestehenden Bedienungshilfen. Die bisherige Begrenzung auf zwei Einträge mit erzwungener Detailnavigation entfällt. Bearbeiten, bestätigtes Löschen und der Schreibschutz geteilter Einträge bleiben erhalten.

Scope: Tagespopup, erforderliche Anbindung und passende Tests.

Umgesetzt: Die bisherigen Grenzen von zwei eigenen beziehungsweise 25 gemischten Einträgen sind entfernt. Hinzufügen beziehungsweise die Löschbestätigung bleiben im festen Fußbereich. Die Liste berücksichtigt auch gemessene Zeilenhöhen für längere Texte. Beim vertikalen Scrollen schließt eine zuvor aufgeschobene Löschzeile. Die nicht mehr benötigte Detailnavigation wurde aus der Kalenderanbindung entfernt. Die beim Umbau versehentlich ergänzte Kopfzeile wird mit der unten beschriebenen Korrektur wieder entfernt.

## Lokale Prüfung am 29.10.2026

- `npm.cmd run verify:fast`: vollständig bestanden.
- Unit-Tests: 510 Dateien, 9.859 Tests bestanden.
- Komponententests: 164 Dateien, 1.528 Tests bestanden.
- Die weiteren im Gate enthaltenen Regel-, Release-, Abhängigkeits-, Kalender-Worklet-, Freigabe-, Widget- und Decoderprüfungen sind bestanden.
- Gezielte Regressionen: unter anderem sechs Dienste ohne Seitenwechsel, 30 eigene/geteilte Einträge, doppelte Schriftgröße, gemessene höhere Inhalte, bestätigtes Löschen einer späteren Zeile und Schreibschutz geteilter Einträge.
- Keine Änderungen an Paketversionen, nativer Konfiguration oder bestehenden Daten. Alle Änderungen sind uncommittet.
- Die folgenden Geräteprüfungen sind noch offen. Die separat freigegebene Preview-OTA ist unten dokumentiert; es wurde kein nativer Build gestartet.

## iOS-Preview-OTA am 29.10.2026

- Ziel: Kanal/Branch `preview`, Plattform `ios`, Environment `preview`, `APP_VARIANT=internal`.
- Bestehender Preview Build 44: `812ea1a9-a4c0-48f3-b01a-72011cdad43e`, App `com.pflegeshift.app.internal`.
- Runtime von Build, Veröffentlichungs-Environment und OTA identisch: `b99c3cf0dd56e6b1bb126d195f21c665de57760b`.
- [OTA-Gruppe 28cf2960-d89c-41a6-b71f-fb3d04305d96](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/28cf2960-d89c-41a6-b71f-fb3d04305d96), iOS-Update `01a1853f-dc5d-751e-936a-bf5d078387ad`.
- Der Preview-Kanal liefert diese Update-ID aus; Manifest und CDN-Bündel antworten mit HTTP 200.
- Lokales und ausgeliefertes Bündel haben dieselbe SHA-256: `cf1b4dbbd772ff0c19de9365006a0e3559d16a6201f5bfd95688179dbaf8e98b`.
- Die zuvor veröffentlichten Verbesserungen der Jahresauswertung sind in der Basis enthalten. Alle freigegebenen Quelldateien sind gegenüber dem geprüften Stand unverändert.
- Kein Commit, Push, nativer Build oder Production-/TestFlight-Update. Alle Änderungen bleiben uncommittet.
- Technische Auslieferung bestätigt; Geräteabnahme weiterhin offen.

Zum Laden auf dem iPhone: Preview-App vollständig schließen, öffnen und mindestens 15 Sekunden warten, erneut vollständig schließen und öffnen. Danach die folgenden Fälle prüfen.

## Visuelle Nachjustierung anhand der neuen iPhone-Fotos

Ziel: Die Terminbeschriftung und Datumsmarkierung im iPhone-Kalender näher an die neue Supershift-Referenz bringen. Datumszahlen werden von 17 auf 16 Punkte verkleinert. Heute und der geöffnete Tag erhalten dieselbe flache, abgerundete Kapsel mit 30 × 18 Punkten; ihre Position und die bestehenden Berührungsflächen bleiben erhalten. Termintexte verwenden bis zu 12 statt 11 Punkte und die mittlere Schriftstärke. Die grauen Terminpunkte sowie die farbigen beziehungsweise grauen Hinweise unter dem Datum wachsen einheitlich von drei auf fünf Punkte. Die Höhe der Punktreihe bleibt im vorhandenen Datumskopf reserviert.

Scope: `src/theme/tokens.ts`, `calendar-appointment-label.tsx`, `calendar-overflow-dots.tsx`, `calendar-prototype-canvas.tsx`, zwei vorhandene Komponententests und diese Dokumentation. Keine Änderungen an Daten, Fachlogik, nativer Integration oder Popup-Verhalten. Die kompakte Kalendergeometrie einschließlich Übergang zur Jahresansicht verwendet weiterhin gemeinsame Metriken.

Abnahme: stärkere Termintexte, größere Punkte, kleinere Datumszahlen und flache Markierung ohne Überschneidung mit der Punktreihe oder der ersten Dienstkachel; Datum und Markierung bleiben beim Öffnen/Schließen an derselben Position. Bestehende Tests wurden angepasst. Die Sichtprüfung auf dem iPhone wurde anschließend vom Nutzer bestätigt; siehe den verbindlichen Referenzstand unten.

Lokale Prüfung am 29.10.2026: 90 gezielte Kalender-/Popup-Komponententests und anschließend `npm.cmd run verify:fast` vollständig bestanden, einschließlich 9.859 Unit-Tests, 1.528 Komponententests sowie sämtlicher nachgelagerter Projektprüfungen. Der Hashvergleich gegen den vorherigen Arbeitsstand bestätigt ausschließlich die sieben oben genannten Dateien als Scope dieser Nachjustierung; die übrigen bisherigen Änderungen sind erhalten und nichts ist gestagt.

Nach separater ausdrücklicher Freigabe wurde diese Nachjustierung am 29.10.2026 ausschließlich als iOS-Preview-OTA veröffentlicht. Sie enthält weiterhin die drei zuvor bereitgestellten Arbeitspakete. Es wurde kein Commit, Push, nativer Build oder TestFlight-Update ausgeführt.

### iOS-Preview-OTA der visuellen Nachjustierung

- Ziel: Branch/Kanal `preview`, Plattform `ios`, Environment `preview`, `APP_VARIANT=internal`.
- [OTA-Gruppe ae3bf5c8-29cd-4b03-a54e-f51e179fd6c8](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/ae3bf5c8-29cd-4b03-a54e-f51e179fd6c8), iOS-Update `01a1855c-d8ca-7ee6-857b-2945d0ce9db8`.
- Runtime `b99c3cf0dd56e6b1bb126d195f21c665de57760b`: frisch gegen Preview Build 44 sowie mit dem Veröffentlichungs-Environment geprüft und identisch.
- Preview-Kanal und ausgeliefertes Manifest zeigen die neue Update-ID. Manifest und CDN-Paket antworten mit HTTP 200.
- Lokaler Export, Manifest und heruntergeladenes CDN-Paket haben dieselbe SHA-256: `367fd3de5c5b5b67a86b02d97f04251e205689d92cee436241f8137a69fc4e13`.
- Der Quellstand war vor und während der Paketierung gegenüber dem vollständig geprüften Stand unverändert. Nur diese Dokumentation wurde danach um den Auslieferungsnachweis ergänzt. Alle Änderungen bleiben uncommittet und ungestagt.
- Technische Auslieferung und anschließende Sichtprüfung auf dem iPhone bestätigt. Zum erneuten Laden gilt die oben beschriebene Schließen-/Öffnen-Sequenz.

## Verbindlicher Referenzstand und Lieferfreigabe am 29.10.2026

Der Nutzer bestätigte nach der iPhone-Prüfung der visuellen Preview-Nachjustierung: „Die Anpassungen sehen auf dem iPhone jetzt gut aus. Bitte diesen Stand beibehalten.“ Dieser Stand ist die verbindliche Kalenderreferenz für spätere Änderungen. Gerätetyp und iOS-Version wurden nicht genannt.

Referenz ist die Preview-OTA-Gruppe `ae3bf5c8-29cd-4b03-a54e-f51e179fd6c8` beziehungsweise Update-ID `01a1855c-d8ca-7ee6-857b-2945d0ce9db8` für Preview Build 44 mit der oben dokumentierten Bundle-SHA-256. Beizubehalten sind die kompakte Dienst-/Terminanordnung, die Abstände, die Punktdarstellung, die mittlere Termin-Schriftstärke, die Datumszahlen mit 16 Punkten und die flache Kapsel mit 30 × 18 Punkten. Spätere visuelle Änderungen sind gegen diese Referenz zu prüfen und erneut auf dem iPhone abzunehmen.

Separat freigegeben wurden jetzt Commit, Push, Pull Request, Merge nach vollständiger erfolgreicher CI und anschließend das TestFlight-Update. Geliefert werden ausschließlich die drei beschriebenen Arbeitspakete einschließlich der abgenommenen visuellen Nachjustierung, ihrer Tests und dieser Dokumentation: insgesamt 22 Dateien. Es sind keine weiteren Produktänderungen und kein nativer Build vorgesehen. Die iOS-TestFlight-OTA verwendet die gesondert geprüfte Production-Laufzeit; ihre Geräteabnahme ist ein eigener Schritt.

## Korrektur der erneut eingeblendeten Popup-Kopfzeile am 29.10.2026

Der Nutzer meldete nach der TestFlight-Abnahme, dass Datum und X im Tagespopup erneut erscheinen, obwohl diese bereits entfernt sein sollten. Ursache ist die in PR #329 beim Umbau auf die scrollbare Liste ergänzte Datumskopfzeile. Die neue Rückmeldung präzisiert die verbindliche Referenz ausschließlich für diese Kopfzeile.

Ziel und Scope: Auf dem iPhone Datum, X und den reservierten Kopfbereich entfernen. Betroffen sind ausschließlich `quick-entry-popup.tsx`, die vorhandenen Popup-Komponententests und diese Dokumentation. Kalenderkacheln, Schrift, Punkte, Datumsmarkierung im Monatsraster, Daten und native Integration bleiben beim abgenommenen Stand. Ein Feiertagshinweis wird weiterhin bei Bedarf angezeigt.

Abnahme: Weder bei einem leeren Tag noch mit Einträgen gibt es eine sichtbare Datumskopfzeile, einen X-Knopf oder einen leeren Ersatzbereich. Alle Einträge bleiben im selben begrenzten Popup scrollbar; Hinzufügen und bestätigtes Löschen bleiben nutzbar. Der Bedienungshilfen-Fokus liegt wieder auf dem ersten Eintrag beziehungsweise bei einem leeren Tag auf der ersten Hinzufügen-Aktion. Datumskontext für Bedienungshilfen, Schließen per Tipp außerhalb und die vorhandene Escape-/Schließen-Aktion bleiben erhalten.

Lokale Prüfung: 49 gezielte Popup-/Kalender-Komponententests und anschließend `npm.cmd run verify:fast` vollständig bestanden, einschließlich 9.859 Unit-Tests, 1.528 Komponententests und aller nachgelagerten Projektprüfungen. Die übrigen 19 Dateien des zuvor gelieferten Kalenderpakets sind anhand ihrer SHA-256 unverändert.

Diese gezielte Korrektur ist auf `codex/calendar-popup-header` umgesetzt und geprüft. Nach der separaten Freigabe „OTA“ wurde sie zunächst ausschließlich als iOS-Preview-OTA veröffentlicht. Die anschließende Sichtprüfung auf dem iPhone wurde vom Nutzer bestätigt; danach folgte die separate Freigabe für Git-Auslieferung und TestFlight-OTA.

### Preview-OTA der Kopfzeilenkorrektur

- Ziel: Branch/Kanal `preview`, Plattform `ios`, Environment `preview`, `APP_VARIANT=internal`; passend zum vorhandenen Preview Build 44.
- [OTA-Gruppe 3d3634ac-4a89-493a-bb46-06e89d741970](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/3d3634ac-4a89-493a-bb46-06e89d741970), iOS-Update `01a1858c-8a7c-72ce-a377-400be0b139fc`.
- Build, Veröffentlichungs-Environment und OTA haben die Runtime `b99c3cf0dd56e6b1bb126d195f21c665de57760b`.
- Preview-Kanal und ausgeliefertes Manifest zeigen die neue Update-ID. Manifest und CDN-Paket antworten mit HTTP 200.
- Lokaler Export, Manifest und heruntergeladenes Paket haben dieselbe SHA-256: `c8eb4434fc6ab1390171f506eaf5b8ffd4d57dfaae4ada6b14996b6c66512537`.
- Die zuvor auf TestFlight abgenommene OTA-Gruppe `c14149d8-c747-445d-a67b-f08e57c90696` bleibt unverändert.
- Der Anwendungs- und Testcode war vor und während der Paketierung gegenüber dem vollständig geprüften Stand unverändert. Anschließend wurde ausschließlich diese Dokumentation um den Auslieferungsnachweis ergänzt.
- Zum Laden: Preview-App vollständig schließen, öffnen und mindestens 15 Sekunden warten, wieder schließen und öffnen. Danach einen leeren und einen belegten Tag öffnen und die fehlende Datum-/X-Kopfzeile sowie Scrollen und Hinzufügen prüfen.

### Verbindliche iPhone-Referenz der Kopfzeilenkorrektur

Am 29.10.2026 bestätigte der Nutzer: „Hab es auf dem iPhone getestet, Datum und X sind jetzt weg.“ Zusätzlich verlangte er, diesen Stand beizubehalten, die Korrektur zu committen, zu pushen, eine PR zu erstellen, nach grüner CI zu mergen und als TestFlight-OTA bereitzustellen.

Verbindliche Referenz ist damit die oben dokumentierte Preview-OTA-Gruppe `3d3634ac-4a89-493a-bb46-06e89d741970` für Build 44 mit der Bundle-SHA-256 `c8eb4434fc6ab1390171f506eaf5b8ffd4d57dfaae4ada6b14996b6c66512537`. Das Tagespopup bleibt ohne zusätzliches Datum, X und reservierten Ersatzbereich. Die bereits abgenommene übrige Kalenderdarstellung bleibt erhalten. Spätere visuelle Änderungen sind gegen diese Referenz zu prüfen und erneut auf dem iPhone abzunehmen; Gerätetyp und iOS-Version wurden nicht genannt.

Die Git-Auslieferung umfasst ausschließlich die drei beschriebenen Dateien. Nach vollständiger erfolgreicher PR-CI und Merge folgt die separat freigegebene iOS-TestFlight-OTA für die passende Production-Laufzeit. Es ist kein neuer nativer Build vorgesehen. Die anschließende TestFlight-Geräteprüfung dieser Korrektur bleibt ein eigener Schritt.

## Abnahme

- Neuer Termin: öffnen und ohne Änderung per Taste, Geste oder Zurück schließen; kein neuer Eintrag, auch nach App-Neustart.
- Unterdialog nur öffnen/schließen oder Änderung zurücknehmen: kein neuer Eintrag.
- Nur eine Einstellung ändern: genau ein gespeicherter Termin; vorhandene Termine behalten ihre Identität.
- Ein Dienst + zwei Termine; zwei Dienste; sechs Dienste; zwei Dienste + viele Termine.
- Kein Überlappen benachbarter Wochen; Farbpunkte passen zu den verdeckten Einträgen.
- Alle Einträge im selben Popup erreichbar; Hinzufügen und bestätigtes Löschen weiterhin nutzbar.
- Kleinere iPhones, sechs Wochen, Feiertage, große Schrift, Hell-/Dunkelmodus und geteilte Einträge.
- Gezielte Tests und `npm.cmd run verify:fast`.
- Preview-Sichtprüfung: vom Nutzer für den oben dokumentierten Referenzstand auf dem iPhone bestätigt. Die anschließende TestFlight-Geräteprüfung bleibt separat.
