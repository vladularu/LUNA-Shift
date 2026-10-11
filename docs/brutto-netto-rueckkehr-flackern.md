# Stabile Gehaltsansicht beim Zurückkehren

## Auftrag und Scope

Ziel: Beim Zurückkehren aus Zeitzuschlägen, Schichtzulage / Muster & Angaben und anderen Detailseiten bleibt die bereits geladene Netto-Prognose sichtbar.

Nicht-Ziele: Änderungen an Berechnung, Tarifregeln, Layout, Navigation oder nativer Konfiguration.

Zielplattform: iPhone, bestehender iOS-Preview-Build 33. Der Ablauf wird in der gemeinsamen Datenlogik korrigiert; eine iPhone-Abnahme bleibt erforderlich.

Dateiscope:

- `src/features/salary/use-net-pay-profile.ts`
- `src/features/salary/use-net-pay-profile.component.test.tsx`
- dieses Dokument

Arbeitsverzeichnis: bestehender Feature-Checkout `.worktrees/brutto-netto-prototype`, Branch `codex/brutto-netto-prototype`. Unabhängige Änderungen bleiben erhalten.

Commit, Push, Build, OTA und Store-Veröffentlichung sind für diese Korrektur nicht freigegeben.

## Ursache und Änderung

Bei jedem Navigationsfokus setzt der Profil-Hook bisher die gespeicherten Netto-Angaben auf `null` und den Zustand auf `loading`. Die Gehaltsansicht ersetzt dadurch kurz die Netto-Prognose durch den Ladezustand, bevor dieselben Angaben erneut aus SQLite geladen werden.

Eine erfolgreiche Ansicht desselben Monats bleibt nun während der erneuten Abfrage erhalten. Die Daten werden weiterhin bei jeder Rückkehr abgefragt. Erfolgreich geladene Änderungen ersetzen den bisherigen Stand. Beim ersten Laden, beim Monatswechsel oder nach einem Ladefehler wird weiterhin geladen. Scheitert die Hintergrundabfrage, werden die bisherigen Angaben verworfen und der vorhandene Fehlerzustand angezeigt.

Die bestehenden Generationsprüfungen bleiben erhalten: Späte Antworten nach einem Monatswechsel oder erneuten Verlassen der Seite dürfen keine neueren Angaben überschreiben. Beim Speichern wird die Generation zusätzlich erhöht, damit eine vorher begonnene Hintergrundabfrage das gespeicherte Ergebnis nicht überschreiben kann. Speichervorgänge prüfen weiterhin die erwartete vollständige Gültigkeitszeitleiste.

## Abnahmekriterien

- Bei Rückkehr aus einer Detailseite bleibt die Prognose während einer verzögerten Abfrage durchgehend verfügbar.
- Geänderte beziehungsweise wiederhergestellte Angaben werden nach der Abfrage übernommen.
- Der vorherige Monat wird beim Monatswechsel nicht angezeigt.
- Fehler und veraltete asynchrone Antworten werden weiterhin korrekt behandelt.
- Fokussierte Komponententests und `npm.cmd run verify:fast` bestehen.
- Auf dem iPhone: Zeitzuschläge, Schichtzulage / Muster & Angaben, TVöD-Zulage und Pflegezulage öffnen und per Zurück beziehungsweise Zurück-Geste zur Gehaltsansicht wechseln; kein kurzes Ausblenden, keine Scrollpositionsänderung. Danach eine Zulagenangabe ändern und prüfen, dass die Prognose aktualisiert wird.

## Nachweise

Vor der Korrektur scheiterten drei gezielte Prüfungen am zwischenzeitlichen Ladezustand; die sechs übrigen Lebenszyklusprüfungen bestanden. Ein zusätzlicher Regressionstest bestätigt, dass eine verspätete Hintergrundantwort ein erfolgreich gespeichertes Ergebnis überschreiben konnte. Nach der Korrektur dieses Falls bestehen die zehn Profilprüfungen sowie die angrenzenden Gehaltsansicht- und Einrichtungstests: insgesamt 52 Tests in drei Suiten.

Prüflogs, der SHA-256-Abgleich zum zuletzt veröffentlichten Darmstadt-Stand und das Ergebnis von `verify:fast` werden unter `artifacts/net-pay-return-refresh-*` festgehalten. Der Scope enthält genau die drei oben genannten Dateien und keine Löschungen.

Die native Sichtprüfung steht noch aus. Ein erfolgreicher Komponententest oder Export ersetzt diesen Gerätenachweis nicht.
