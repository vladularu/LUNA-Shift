# Kalenderlayout: Tageszahlen und Monatstitel

Stand: 30.10.2026. Ausgangspunkt: `2c5e947`.

## Auftrag und Scope

Ziel: Die gemeldete optische Überlagerung zwischen Tageszahlen und Dienstzeilen
verhindern und den Monatstitel lesbar halten.

Zielplattform: iOS, zunächst Preview-Build 44 und anschließend TestFlight-Build 8.
Preview-OTA, TestFlight-OTA und Git-Auslieferung wurden jeweils separat freigegeben.

Scope: Kalender-Canvas, Monatstitel, dessen Einbettung in die Kalenderszene,
optionale Mindestskalierung im gemeinsamen Header und gezielte Regressionstests.
Gespeicherte Einträge, Berechnung, Synchronisierung und native Konfiguration
gehören nicht zum Auftrag.

## Befund und Korrektur

Im Testerfoto laufen die Tageszahlen gegenüber den Dienstzeilen auseinander.
Die Tageszahlen beziehen ihre gesamte Position aus einer animierten Transformation;
die Eintragszellen verwenden dagegen reguläre Layoutkoordinaten. Die Korrektur
verankert die Tageszahlen direkt an den Monatskoordinaten desselben Layouts.
Die Transformation beschreibt nur noch die Abweichung während des Übergangs zur
Jahresansicht. Im fertigen Monat beträgt diese Abweichung immer null.

Der Monatstitel verwendet automatische Schriftanpassung. Er wird erst nach einer
positiv gemessenen Seitenbreite eingeblendet. Eine zunächst gesetzte Untergrenze
von 75 Prozent genügte auf dem Testergerät nicht: Der iOS-Fabric-Renderer von
React Native 0.86.3 nutzt beim Einpassen `minimumFontSize` mit einem Standardwert
von 4 Punkt, nicht die übergebene prozentuale Grenze `minimumFontScale`.

Die exakte Abfolge, die den nativen Fehler im Testergerät ausgelöst hat, wurde
lokal nicht reproduziert. Ein Regressionstest hält absichtlich den ersten
Animationsframe fest und verändert danach Breite, Höhe und Headerabstand. Er
prüft für jeden Oktobertag die Ausrichtung an seiner tatsächlichen Eintragszelle.
Weitere Prüfungen sichern die bisherige Bewegung zwischen Jahr und Monat,
die verzögerte Titelmontage und die Titelhöhe ab.

## Fortsetzung: kleine iPhone-Textgröße

Der Tester bestätigt am iPhone 15 mit iOS 26.6.2 und Anzeigezoom Standard, dass
eine Änderung seiner unterhalb der Mitte gewählten Textgröße die Darstellung
verbessert. Im letzten Kalenderfoto sind Datum und Dienst wieder ausgerichtet;
der Monatstitel bleibt extrem klein. Die aktuelle Production-OTA ist zu diesem
Zeitpunkt `5ad494f2-63c6-4fd8-8d09-622f5f4315aa`; deren tatsächliche Nutzung auf
dem Testergerät ist nicht separat nachgewiesen.

Ziel: Lesbarer, einzeiliger Monatstitel auch bei kleiner Systemschrift auf dem
bestehenden TestFlight-Build 8. Die bereits erteilte TestFlight-OTA-Freigabe gilt
für diese Fortsetzung. Commit, Push, PR und Merge wurden nach der Geräteabnahme
am 30.10.2026 separat freigegeben. Kein neuer Build oder Store-Schritt.

Zusätzlicher Dateiscope: `calendar-month-title.tsx`, dessen Komponententest,
`src/ui/screen-layout.tsx`, `calendar-stable-pager.component.test.tsx` und diese
Dokumentation. Keine Daten-, Rechen-,
Synchronisierungs-, Design-Token- oder Native-Änderungen.

Die bisher feste Titelhöhe folgt dem allgemeinen `fontScale`, die native
Zeilenhöhe dagegen dem gesonderten Dynamic-Type-Verlauf `largeTitle`. Gerade bei
kleinen Textgrößen können beide voneinander abweichen. Die native Einpassung
verkleinert ausschließlich die Schrift, nicht die gesetzte Absatz-Zeilenhöhe;
eine zu niedrige Box kann deshalb bis zur kleinsten Schrift führen.

Die Kalenderseite verwendet nun den optionalen Header-Modus `titleHeightMode="content"`:
Die bisherige Höhe bleibt als Mindesthöhe erhalten; die native Textmessung darf
die tatsächlich benötigte Höhe bestimmen. Die Breitenanpassung bleibt erhalten.
Alle anderen Header behalten standardmäßig ihre bisherige feste Titelhöhe.

Der Regressionstest deckt die Schriftfaktoren 0.823, 0.882, 0.941, 1, 1.4 und 2
bei 393 x 852 Punkten ab und verhindert eine feste Höhenbegrenzung. Er schlug
vor der Korrektur in allen sechs Fällen fehl. Er führt keine UIKit-Textmessung
aus und ersetzt deshalb nicht den erneuten Vergleich auf dem Testergerät.

Im vollständigen Komponentenlauf überschreitet der Zehn-Wischwechsel-Test die
unveränderte Grenze von 5000 ms. Derselbe einzelne Test überschreitet diese
Grenze auch mit dem bytegenau verifizierten vorherigen Production-Titelcode;
die aktuelle Korrektur wurde danach wiederhergestellt. Der Test verwendet nun
die bereits vorhandene Überschrift weiter und sucht den aktiven Slot gezielt
im Pager. Alle zehn Wechsel und Umkehrungen, Monatsprüfungen, Scrollfreigaben
und die globale Grenze von höchstens fünf montierten Slots bleiben erhalten.
Die Testzeitgrenze wird nicht erhöht.

Abnahme: Mit der ursprünglichen kleinen Schriftgröße sowie Standard und großer
Schrift, nach Neustart und Monatswechsel, müssen Monatstitel, Datum und Dienste
lesbar und korrekt ausgerichtet sein. Kalenderfoto und VoiceOver bleiben erhalten.

## Abnahme

- Fokussierte Tests und `npm.cmd run verify:fast` müssen erfolgreich sein.
- Preview-OTA muss zur installierten internen iOS-Runtime passen.
- Auf dem iPhone Oktober/November mit und ohne Kalenderfoto prüfen.
- Kaltstart, Monatswechsel, Jahr/Monat, Personenauswahl und Rückkehr aus dem
  Hintergrund dürfen die Ausrichtung nicht verändern.
- Monatstitel und Tageszahlen müssen lesbar bleiben; Dienste müssen unter dem
  richtigen Datum erscheinen und beim Antippen zum richtigen Tag führen.

Tests, Export und OTA-Metadaten ersetzen diese iPhone-Abnahme nicht.

## Bestätigter Stand und Git-Auslieferung

Nach der TestFlight-OTA `987c717d-0fe9-41b9-86d3-5ff84cf05ad7` bestätigt der
Nutzer am 30.10.2026: „ja passt alles. commit push pr merge“.
Damit sind die Abnahme des gemeldeten Kalenderfehlers und die Git-Auslieferung
freigegeben. Die Rückmeldung ersetzt keine vollständige Geräteabnahme anderer
App-Bereiche.

Die OTA verwendet Update-ID `01a18a8d-700b-734e-8bf9-31e1ca9b1e31` und die zu
Build 8 passende Runtime `ab053760e06bdf85a83f64fc65cfee0aab41fe12`.
Manifest, CDN-Bundle, Assets und eingebettete Kalenderquellen wurden geprüft.

Lokale Prüfungen: 512 Unit-Testdateien mit 9924 Tests; im ersten vollständigen
Komponentenlauf 169 von 170 Suiten und 1607 von 1608 Tests erfolgreich.
Nach der oben beschriebenen Testabfrage-Optimierung besteht die Pager-Suite
alle 17 Tests bei unveränderten Prüfbedingungen und Zeitgrenzen. Die 14 weiteren
Skriptprüfungen sowie Typ-, Lint-, Format- und Diff-Prüfungen sind erfolgreich.
Vor dem Merge muss zusätzlich die PR-CI für den endgültigen Commit erfolgreich
sein.
