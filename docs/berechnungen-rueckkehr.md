# Korrektur C zu Paket B: Rückkehr und erster Jahresaufruf

- Ziel: bestehende Netto-/Gehaltswerte beim App-Wechsel sichtbar halten und das Jahresnetto bereits vor dem Öffnen vorbereiten. Platz für die beiden üblichen Netto-Hinweise reservieren, ohne lange Hinweise abzuschneiden.
- Ausgangspunkt: veröffentlichte, noch nicht abgenommene Paket-B-Preview `1ef493bf-a7c6-4f3c-9804-ed78fa87802c`. Deren Quellenarchiv und Prüfnachweise bleiben erhalten. Korrektur C wird als getrenntes Folgepaket mit eigener Änderungsmenge und eigener Preview-OTA dokumentiert; beide bleiben bis zur Abnahme uncommittet.
- Nicht-Ziele: Berechnungsformeln, gespeicherte Finanzdaten, native Integration und Luftig ändern. Kein TestFlight, Commit oder GitHub-Abgleich.
- Plattform: iOS-Preview, Expo ~57.0.31; Dokumentation https://docs.expo.dev/versions/v57.0.0/.
- Scope C1: analysis-background-preparation.tsx und bestehender Integrationstest: Rückkehr revalidiert mit erhaltenen Daten; tatsächliche Änderungen invalidieren weiterhin.
- Scope C2: derselbe Hintergrund-Einstieg, use-annual-net-pay.ts und annual-net-pay-view.tsx; bestehende Lifecycle-/Integrationstests sowie gezielter Kartentest. Gemeinsame priorisierte Hintergrund-/Vordergrundberechnung, keine neue Finanzformel. Mit Dokumentation und Quellenregister maximal neun Dateien im Korrekturpaket.
- Kriterien: unveränderte Rückkehr zeigt zu keinem Zeitpunkt leere Gehalts-/Netto-Daten; veränderte Daten werden nach dem Lesen übernommen, Fehler sichtbar und bestätigte Schreibvorgänge weiterhin sofort invalidiert. Vorbereiteter Jahreswert ist beim ersten Öffnen sofort verfügbar; laufende Vorbereitung wird geteilt und im Vordergrund priorisiert. Hintergrundarbeit wartet auf App-Bereitschaft und stoppt bei inaktiver App. Kein Vorjahreswert oder Ergebnis eines alten Regelkatalogs wird als aktuell gezeigt.
- Visuelle Grenze: zwei normale Hinweiszeilen erhalten denselben Platz beim Laden und nach dem Berechnen. Längere Hinweise und große Schrift dürfen wachsen; sie werden nicht abgeschnitten. Der sichtbare kalte Erstaufruf und App-Umschalter müssen auf dem iPhone abgenommen werden.
- Prüfung: fokussierte Regressionsfälle, verify:fast, exakter Feature-/Preview-Quellenabgleich, Runtime-/Export-/OTA-Bytevergleich. iPhone-Abnahme steht aus.

## Technischer Liefernachweis (07.11.2026)

- `verify:fast` erfolgreich: 10421 Unit-Tests, 1901 Komponententests und sämtliche ergänzenden Repository-Prüfungen.
- Fokussierte Regressionstests: 89 Fälle jeweils auf Feature- und Preview-Stand. Echte gemeinsame Vorbereitung: wiederholte inaktive/Hintergrund-Rückkehr bleibt durchgehend sichtbar; veränderte Zeitreihe wird übernommen, Lesefehler sichtbar; erster vorbereiteter Jahresaufruf ohne neue Berechnung, laufende Arbeit geteilt und priorisiert.
- Exakter Quellenvergleich: drei App-Dateien gegenüber der letzten Paket-B-Preview geändert; separater Korrekturscope von acht Dateien inklusive Tests, Dokument und Register. Paket B und Korrektur C zusammen: 22 offene Dateien, noch nicht committed. Luftig bleibt erhalten.
- Preview-Quellfingerabdruck: `8605454186bcdbf8db9a12e166d13834b19f9910a274923b96d48567b2d6c205`.
- Runtime `402e757d98ca799660ce5dd15a24bd999cf690eb` passt unverändert zur installierten Preview-App.
- Eigene Preview-OTA-Gruppe `9838f1e6-5e66-4b2d-95e9-7624b210f7b2`; Update `01a1b39d-e95f-7710-804e-0f877ca44fea`.
- Live ausgeliefertes Bundle und alle 34 Assets bytegenau gegen den Export bestätigt. Bundle-SHA256 `98bdf8af2b23e9f7f4fbdb83186c3eda9e16358abdce86557735121e82a0dee2`.
- Abnahme offen: App-Umschalter mehrfach öffnen/zurückkehren, kalter App-Start mit erstem Jahresaufruf, Jahreswechsel, Netto-Angaben ändern; jeweils Hell/Dunkel. Eine noch nicht fertige Erstberechnung kann weiterhin einen Ladezustand benötigen. Die zwei üblichen Hinweise haben reservierten Platz, lange Hinweise bleiben flexibel.
- Commit und GitHub-Abgleich erst nach ausdrücklicher Nutzerabnahme. Keine Production-/TestFlight-Veröffentlichung und kein nativer Build.

## Abnahme (07.11.2026)

Die Korrekturen wurden zusammen mit Korrektur D ausdrücklich auf dem iPhone in Hell/Dunkel und nach Neustart abgenommen. Zugeordnete OTA und Git-Freigabe: [Kaltstart – Geräteabnahme](berechnungen-kaltstart.md#geräteabnahme-und-git-freigabe-07112026).
