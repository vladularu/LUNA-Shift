# Ruhige Typografie und bestehende LUNA-Karten

## Ziel und Umfang

Die App verwendet eine ruhigere gemeinsame Typografie und konsistente Abstände. Bestehende Karten im LUNA-Design übernehmen dieselben Regeln, einschließlich der Karten in Untermenüs. Einstellungen und Formulare behalten ihren Aufbau.

- Systemschrift für Text, Eingaben, native Navigation und animierte Überschriften; Schriftgewicht, Kursivschrift, eigene Symbolschriften und Dynamic Type bleiben erhalten.
- Kleine, gleich große Schichtsymbole, kompaktere Anzeigezeilen und gezielter Freiraum nach dem Kartenkopf.
- Vorhandene Mehr-Aktionen bleiben oben rechts.
- Vorhandener Infotext bleibt unter der letzten Linie. Eine gemeinsame Infozone reserviert mit und ohne einzeiligen Text dieselbe Mindesthöhe; sie berücksichtigt die System-Schriftvergrößerung. Längere Hinweise dürfen umbrechen.
- Gemeinsame Kartenrahmen und zurückhaltende Beschriftungen auch in Gehaltsdetails, Vorlagen und Auswahlseiten.
- Gemeinsamer Seitenabstand von 20 pt; die Kalenderaktionen behalten ihren tatsächlichen Abstand von 6 pt zum rechten Rand.

Die vorhandenen lesbaren Textfarben und fachlichen Statusfarben bleiben erhalten. Berechnungen, Tarifkatalog, gespeicherte Daten, native Konfiguration und Abhängigkeiten werden durch dieses Gestaltungspaket nicht verändert.

## Arbeitspakete

1. Gemeinsame Schrift-, Karten-, Abstands- und Headerbausteine.
2. Bestehende Karten und ihre Verbraucher in Übersicht und Untermenüs.
3. Regressionstests, Quellenabgleich und Git-Lieferung über PR und CI.

## Bestätigte Preview-Referenz

Die [iOS-Preview-OTA 6470ef83](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/6470ef83-d311-415f-b000-3e191d11cef4) wurde am 01.11.2026 veröffentlicht und anschließend vom Nutzer mit „Super das passt“ bestätigt. Die Bestätigung betrifft die besprochenen Karten-, Schrift-, Abstands- und Infozonen-Anpassungen. Gerätemodell, iOS-Version und jede einzelne Darstellungsvariante wurden nicht gesondert benannt.

Die Preview verwendet Build 44 / Runtime `b99c3cf0dd56e6b1bb126d195f21c665de57760b`. Der ausgelieferte iOS-Bundle wurde gegen den geprüften Export verifiziert: SHA-256 `7b73529dbaee08db0b87bb473d5cb44242256020efcebdb0bf4c1519e204d764`.

## Integration in den aktuellen Hauptstand

Die Git-Lieferung beginnt bei `08b4eacae3e431a8bd26be08a7ff3a01fec4fcdc` und übernimmt die vollständige zusammengehörige Gestaltung aus dem gesicherten, bestätigten Preview-Snapshot. Der Scope umfasst 43 Quell- und Testdateien sowie dieses Dokument. Die Laufzeitdateien sind bytegleich mit dem bestätigten Snapshot. Ein Test verwendet einen neutralen Platzhalter anstelle eines Betrags aus der Referenz. 2.324 vorhandene Dateien außerhalb des Scopes bleiben bytegleich mit dem Hauptstand.

Die aktuelle Tarif- und Kataloglogik des Hauptstands bleibt erhalten. Die im Preview-Checkout vorhandenen älteren Fachquellen und dort fehlenden neueren Katalogdateien sind nicht Bestandteil dieser Lieferung. Die Integration erfolgt in einem separaten Worktree auf `codex/ruhige-karten-git`; bestehende Arbeitsstände bleiben erhalten.

## Prüfung und Lieferung

Am 02.11.2026 wurden die gezielten UI-Prüfungen und `npm.cmd run verify:fast` auf dem integrierten Hauptstand erfolgreich abgeschlossen: 85 fokussierte Tests, zusätzlich drei Prüfungen der neutralen Infozonen-Testdaten, 544 Vitest-Dateien mit 10.375 Tests, 192 Jest-Suiten mit 1.813 Tests und sämtliche nachgelagerten Projektchecks. Die Formatierung des Dokuments und des neutralen Testbeispiels wurde separat geprüft.

Die PR wird erst nach erfolgreicher vollständiger CI gemergt. Vor dem Merge werden Head, Base und Dateiscope erneut abgeglichen; danach werden Baum- und Blob-Parität zum geprüften Stand nachgewiesen.

Die Git-Lieferung ist separat freigegeben. Eine weitere Preview-, Production- oder TestFlight-OTA ist nicht Teil dieses Git-Auftrags.

Lokale Prüfnachweise liegen unter `artifacts/kartenreferenz-git/`. Die native und visuelle Preview-Bestätigung ist getrennt von lokalen Tests, CI und Git-Integration zu behandeln.
