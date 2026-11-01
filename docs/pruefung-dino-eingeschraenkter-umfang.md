# Dino bei eingeschränktem Prüfumfang

## Task-Vertrag

- Ziel: Das bestehende Dino-Spiel bleibt in der leeren Monatsprüfung auch dann erreichbar, wenn ausschließlich neutrale Hinweise zum Prüfumfang vorliegen.
- Ursache: Die neue Leeransicht für `scopeNotes` ersetzte bisher die gesamte Dino-Komponente durch einen Text.
- Nicht-Ziele: Keine Änderung an Prüfbefunden, Zählung, Pausenregeln, Gehalt, Spielmechanik, Speicherung, nativen Dateien oder Jahresauswertung. Fehlende Angaben und echte Befunde behalten ihre bisherige Darstellung.
- Plattform: iOS, LUNA Shift Internal. Die fachliche Einschränkung bleibt als neutrale, aufklappbare Zeile erhalten.
- Dateiscope: `compliance-day-list.tsx`, `check-runner-egg.tsx` und ihre beiden Komponententestdateien unter `src/features/analysis/`; dieses Dokument.
- Branch: Vorhandenen Arbeitsstand auf `codex/gehalt-auszahlung` fortführen, unabhängige Änderungen unverändert erhalten.
- Freigabe: Lokale Korrektur beauftragt; die iOS-Preview-OTA wurde anschließend am 01.11.2026 ausdrücklich bestätigt. Keine Freigabe für Commit, Push, native Builds oder TestFlight.

## Abnahmekriterien

1. Ohne konkrete Befunde oder fehlende Angaben ist der Dino auch bei eingeschränktem Bereitschafts-Prüfumfang sichtbar und per schnellem Doppeltippen spielbar.
2. Die Texte lauten dort „Keine Auffälligkeiten“ und „In den geprüften Zeiten.“; es wird weder „Prüfung abgeschlossen“ noch ein uneingeschränktes Prüfergebnis behauptet.
3. Der Scope-Hinweis bleibt während des Spiels bedienbar. Sobald echte Befunde vorliegen, ersetzt deren bestehende Darstellung die Spielansicht.
4. Spielstand, Highscore, Pausieren und Doppeltipp-Verhalten bleiben erhalten. Die vollständige Prüfung und die Ansicht bei fehlenden Angaben ändern sich nicht.
5. Heller/dunkler Modus, schmale Breite und große Schrift sind in den vorhandenen Komponententests abgedeckt. Die Sicht-/Funktionsabnahme auf dem iPhone steht nach einer gesondert freigegebenen Preview-Veröffentlichung aus.
6. Fokussierte Tests und `npm.cmd run verify:fast` bestehen.

## Lokaler Nachweis am 01.11.2026

- Der Regressionstest zeigt zunächst den Fehler: Der Dino fehlt in der eingeschränkten Leeransicht. Nach der Korrektur bestehen alle 35 fokussierten Oberflächenfälle in drei Suites.
- Die echte Dino-Komponente wird aus der eingeschränkten Monatsprüfung per Doppeltipp geöffnet. Der Scope-Hinweis lässt sich während des Spiels aufklappen; bei einem anschließend auftretenden Pausenbefund verschwindet die Spielansicht und der Spielstand wird gespeichert.
- Vorhandene Tests decken Hintergrundwechsel, Pausieren, gespeicherten Fortschritt, Highscore und fehlerhafte Speicherung weiterhin ab. Fehlende Eingabeangaben behalten ihren eigenen Status ohne Dino, echte Befunde bleiben sichtbar.
- `npm.cmd run verify:fast` mit Exit 0: 537 Unit-Dateien mit 10.319 Tests, 187 Komponentensuites mit 1.792 Tests sowie alle Skriptprüfungen, Typprüfung, Lint, Formatierung und Diffcheck. Protokoll: `.verify-pruefung-dino.log`.
- Gegenüber dem zuletzt veröffentlichten Preview sind genau vier bestehende Quell-/Testdateien geändert; 1.974 bestehende Quellen unverändert. Nachweise und eingefrorener Kandidat unter `artifacts/pruefung-dino/`.
- Zum Abschluss der lokalen Prüfung noch keine Veröffentlichung oder Git-Aktion. Die anschließend freigegebene Preview-OTA ist unten dokumentiert.

## Freigegebene iOS-Preview-OTA am 01.11.2026

- Gruppe `3f756a9f-6597-4853-81be-38e306593755`, iOS-Update `01a19616-5cac-7f48-9c30-47ca7cee2534`, veröffentlicht um `2026-11-01T07:50:10.348Z`.
- Kanal/Branch/Environment `preview`, App-Variante `internal`, Bundle-ID `com.pflegeshift.app.internal`. Der bestehende Preview-Build 44, der lokale Fingerprint und die Update-Runtime stimmen überein: `b99c3cf0dd56e6b1bb126d195f21c665de57760b`.
- Vor Veröffentlichung wurden alle 1.978 Quellen und die vollständige Pfadmenge mit dem erfolgreich geprüften Kandidaten verglichen. Der aktive Preview-Vorgänger war Gruppe `601583ec-32f7-4286-addc-7fa65dad76c3`, Update `01a19601-f42d-7e16-ab3d-b174513f85e2`.
- Export `dist/preview-pruefung-dino`, Bundle `entry-5f936ff706740b565484c88ac7b3fee5.hbc`, 9.888.664 Bytes. Die 34 exportierten Assets sind unverändert; der geprüfte Export wurde mit `--skip-bundler` veröffentlicht.
- Der tatsächliche Preview-/Runtime-Abruf liefert das neue Manifest; Manifest-Hash und vollständig geladene CDN-Bytes entsprechen exakt dem lokalen Export. SHA-256: `c1fda5750be82509b5310789bc52cd593caf20b93ade4ddc123755be2164a601`.
- Nachweise unter `dist/preview-pruefung-dino-preflight/`, insbesondere `compatibility.json`, `export-proof.json`, `quality-gate.json`, `source-before.json` und `delivery-proof.json`. Kopie des Auslieferungsnachweises unter `artifacts/pruefung-dino/delivery-proof.json`.
- Alle eingefrorenen Quellen sind nach Veröffentlichung unverändert. Kein Commit, Push, Merge, nativer Build oder TestFlight-Update. Branch/HEAD bleiben `codex/gehalt-auszahlung` / `d1b13ac788044a7564c673170bf3753547728315`.
- iPhone-Abnahme offen: LUNA Shift Internal vollständig schließen, öffnen und 15 Sekunden warten, erneut schließen/öffnen. Danach die leere Monatsprüfung mit eingeschränktem Prüfumfang öffnen und den Dino zweimal schnell antippen; Scope-Hinweis und Spiel müssen gleichzeitig bedienbar bleiben.
