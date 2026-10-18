# Eintragsart im Kalendereintrag und Auswahlhäkchen

Auftrag vom 18.10.2026: Auch die Eintragsart-Auswahl beim Bearbeiten eines
Kalendereintrags auf Dienst, Fortbildung, Urlaub, Krank und Frei vereinfachen.
Zusätzlich die im iPhone-Screenshot sichtbaren mehrfachen Häkchen korrigieren.
Die vorherige Freigabe umfasst Implementierung und kompatible iOS-OTAs für
Preview und TestFlight.

Plattform: Expo SDK 57, iPhone; Preview Build 41 und TestFlight Build 5.
Arbeitszweig: codex/eintragsart in der bestehenden isolierten Arbeitskopie.
Basis: Preview-Gruppe 10e9ff81-b49f-47f1-800a-0c4dd9b2df08 und
Production-Gruppe 1ed38bc5-cf74-4585-8ebb-66ff77f09bd6. Die bereits ausgelieferte
Vereinfachung der Dienstvorlagen bleibt enthalten.

Erlaubte Änderungen: day-editor-layout.ts, shift-edit-overlay.tsx und dessen
Komponententests, ui/icon.tsx, ergänzte Icon-Komponententests sowie dieses Dokument.
Nicht-Ziele: Datenmigration, Änderungen der Zeit-/Gehaltsberechnung, neue
native Konfiguration, neuer Build, Store-Submission oder fremde Git-Auslieferung.

Ursache der mehrfachen Häkchen: Die gemeinsame Icon-Komponente nahm style als
kompatiblen Eingabeparameter an, reichte ihn aber nicht an das tatsächliche
Lucide-SVG weiter. SelectionRow und SelectionChip konnten deshalb ihre
abgewählten Häkchen trotz opacity: 0 nicht ausblenden. Die Korrektur reicht den
vorhandenen Style unverändert weiter. Tests verwenden die tatsächliche
Icon-Komponente mit einem kontrollierten Glyphen-Backend und prüfen deren
weitergereichten Style; sie ersetzen keine native Geräteabnahme.

Abnahme: exakt fünf Optionen im Kalender; ein ausgewählter Eintrag; normale
Bestandstypen Früh/Spät/Nacht/Tag werden als Dienst eingeordnet. Das erneute
Auswählen von Dienst darf keine Preset-Übernahme auslösen und weder Titel noch
Zeiten, Farbe, Symbol oder internen Typ ersetzen. Wechsel zu Fortbildung und
Abwesenheiten behalten ihre bisherige Verarbeitung. Häkchen müssen bei
abgewählten Optionen tatsächlich unsichtbar sein. Gezielte Tests und
verify:fast ausführen, anschließend Runtime, aktive Kanäle, Manifest und
CDN-Bundle beider Veröffentlichungen prüfen. Die sichtbare iPhone-Abnahme
bleibt nach der Auslieferung separat zu bestätigen.

## Ergebnis am 18.10.2026

Die vollständige Prüfung verify:fast ist erfolgreich: 457 Unit-Dateien mit
8.905 Tests, 142 Komponenten-Suites mit 1.237 Tests sowie 203 Skripttests.
Die vorhandenen Icon-Tests zu Hell-/Dunkelmodus und gespeicherten Symbolen
bleiben enthalten. Drei zusätzliche Tests prüfen die Sichtbarkeit in Zeilen
und Chips sowie die Weitergabe von Style-Arrays. Zehn zusätzliche Fälle prüfen
die fünf Kalender-Eintragsarten und den Erhalt bestehender Dienste. Der
Sichtbarkeitsfehler ist vor der Korrektur als fehlender Style reproduziert.
Die abschließende Typprüfung ist ebenfalls erfolgreich.

Die neu berechneten Runtimes stimmen exakt mit Preview Build 41 und
TestFlight Build 5 überein. Wie bei der bisherigen OTA-Linie wurden nur für die
Veröffentlichung die passenden npm-Skript-Metadaten beibehalten und danach
die ursprüngliche package.json bytegleich zurückkopiert. Abhängigkeiten,
native Konfiguration und Runtime-Policy wurden nicht geändert; kein Override.
Die Decoder-Härtung wurde zusätzlich unmittelbar vor der Veröffentlichung
verifiziert. Es gab keinen neuen nativen Build und keine Store-Submission.

Ausgeliefert für iOS:

- Preview: Gruppe fa46ab60-857e-47af-8950-a4ccae2f4965, Update 01a14d34-bec8-7a38-9d07-5ece45ce882d.
- TestFlight: Gruppe 7f33cf2d-8573-4357-bd24-a87952fa7c77, Update 01a14d36-299d-7e05-8105-266763b8d3e3.

Beide aktiven Kanäle liefern die neue Gruppe für die passende Runtime aus.
Die echten Update-Endpunkte antworten mit HTTP 200, korrekter App-Variante
und Bundle-ID. Export, Manifest und tatsächlicher CDN-Download stimmen für
jeden Kanal überein. Bundle-Größe: 9519580 Bytes.
SHA-256 Preview: 07FCD3D67E97E9C9A2FB09FBD681BBC3EA55D8B9140C7792532A1C8EC842E58D.
SHA-256 TestFlight: 07FCD3D67E97E9C9A2FB09FBD681BBC3EA55D8B9140C7792532A1C8EC842E58D.
Bytegleiche Bundles auf beiden Kanälen: True.

Der Quellabgleich umfasst 1.963 vorhandene Dateien. Gegenüber der bisherigen
OTA sind nur die fünf freigegebenen Quell-/Testdateien geändert; hinzu kommt
dieses Dokument. Nach dem Testlauf blieb der App-Code unverändert. Die frühere
Vorlagen-Korrektur sowie andere gespeicherte Arbeiten bleiben erhalten.

Nachweise liegen unter .expo/eintragsart-calendar/: baseline-files.json,
tested-source.json, source-proof.json, icon-red.log, focused.log,
verify-fast.log, final-typecheck.log, Fingerprints und Veröffentlichungsergebnisse
sowie beide served-proof.json und final-proof.json.

Die sichtbare Übernahme auf dem iPhone ist nach dieser Veröffentlichung noch
offen. App vollständig schließen, öffnen, etwa 15 Sekunden warten, erneut
schließen und öffnen. Danach im Kalendereintrag die Eintragsart öffnen und
die fünf Optionen sowie genau ein sichtbares Häkchen prüfen.
