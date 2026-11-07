# Berechnungen: Paket A – stabile Ergebnisse bei Navigation

- Ziel: fertige Jahres- und Jahres-Netto-Ergebnisse bei Fokuswechseln erhalten, identische Jahres-Netto-Anfragen gemeinsam bearbeiten und fertige Ergebnisse beim erneuten Öffnen wiederverwenden.
- Nicht-Ziele: Formeln, Beträge, Monatsabdeckung, Netto-Einstellungen, Datenbank, native Integration und Luftig-Gestaltung ändern. Gemeinsames Laden der Einstellungen und bedarfsgerechte Gehaltsvorbereitung folgen als Paket B nach der Abnahme dieses Pakets.
- Plattform: iOS-Preview, bestehende interne App und Runtime. Expo ~57.0.31; Referenz https://docs.expo.dev/versions/v57.0.0/.
- Dateiscope: use-annual-net-pay.ts, use-simple-annual-report.ts, analysis-screen.tsx, annual-details-screen.tsx, zugehörige Lifecycle-/Navigationsprüfungen, dieses Dokument und exakte Quellenfreigaben.
- Akzeptanz: Fokusverlust entfernt keine fertigen Ergebnisse. Rückkehr und erneut geöffnete Ansichten nutzen identische fertige Ergebnisse. Ein gleichzeitig aktiver Verbraucher verliert seinen Auftrag nicht durch einen anderen Verbraucher. Änderungen an Eingaben, Jahr oder Regelkatalog invalidieren weiterhin; verspätete Ergebnisse werden verworfen. Keine neue Berechnung einer kalten inaktiven Seite.
- Geräteabnahme: wiederholt Übersicht → Jahres-Netto → zurück; schnelle und abgebrochene Zurück-Gesten, andere Jahresdetails, Jahreswechsel und echte Datenänderung in Hell/Dunkel. Beträge und Monatsliste bleiben bei unveränderten Eingaben stabil.
- Prüfung: fokussierte Regressionen, verify:fast, exakter Quellenabgleich, Runtime- und Exportprüfung vor eigener Preview-OTA im bestehenden freigegebenen Abnahmeablauf.
- Vorhandene Änderungen: kompakte Jahres-Netto-Ansicht bleibt erhalten; noch nicht abgenommen oder committet.
- Git: kurzlebige codex/berechnungen-navigation-Branches; bestehende getrennte Feature-/Luftig-Quellen bleiben erhalten. Kein Commit/Push vor Abnahme. Keine TestFlight-/Store-Veröffentlichung.

## Umsetzung und Prüfungen

Die Aktivität der Seite steuert jetzt nur die Berechnung, nicht die Gültigkeit fertiger Ergebnisse. Identische Jahres-Netto-Anfragen teilen ihren laufenden Auftrag und verwenden bis zu sechs unveränderliche Ergebnisse im Arbeitsspeicher wieder. Vollständige Eingaben und Regelkatalog-Identität bilden die Zuordnung; neue Daten, andere Jahre und verspätete Ergebnisse bleiben abgesichert.

Der bestehende Scene-Wrapper bleibt unverändert: Die Korrektur verhindert den Ergebnisverlust in den untergeordneten Hooks, statt sich auf das Festhalten von React-Elementen zu verlassen.

- Vollständiges verify:fast auf der tatsächlichen Luftig-Preview-Quelle bestanden: 10.419 allgemeine Tests, 1.879 Komponentenfälle sowie sämtliche ergänzenden Schutzprüfungen.
- 93 fokussierte Prüfungen in beiden Worktrees bestanden; darunter 17 neue Fälle zu Fokus, gemeinsamen Aufträgen, erneuten Ansichten, Invalidierung und Detailnavigation.
- Genau vier zusätzliche App-Dateien gegenüber der zuvor ausgelieferten kompakten Netto-Ansicht geändert. Die sieben Implementierungs-/Testdateien dieses Pakets sind in Feature und Preview bytegleich.
- Geräteabnahme steht aus. Paket B (gemeinsame Einstellungen und bedarfsgerechte Vorbereitung) ist noch nicht umgesetzt und folgt nach Abnahme dieses Pakets.

## Eigene Preview-OTA

- Nachricht: Berechnungen A: stabile Jahreswerte - Luftig.
- Gruppe: 25138531-70b1-433a-b4d1-20751a897159.
- Update: 01a1b354-e158-7e24-b90e-09c0eed1f6e5.
- Vorgänger: 01a1b32e-9517-7be7-87dc-3d6e179cac7c.
- Kanal/Environment: preview; Plattform: iOS; APP_VARIANT=internal.
- Runtime: 402e757d98ca799660ce5dd15a24bd999cf690eb.
- Preview-Quellfingerprint: e98e01d88299f4b64f0c285fdbb28a81a6228bbb4ccc4f06bbec117df6372cf1.
- Feature-Quellfingerprint: 10560d1bb06a575b5cd085a1e1374a0351a1e7350eee1db2202926b21e55a618.
- Bundle-SHA256: 9004ae30f643bb66b652a5fe5bf3c43945eca32b81dca538235d8c6fd84c3dc0.
- Bundle und alle 34 Assets nach Veröffentlichung bytegenau gegen den geprüften Export verifiziert.

Die technische Auslieferung ist bestätigt; die iPhone-Abnahme in Hell/Dunkel steht aus. Das separate Laden der Einstellungen beim Öffnen einer neuen Detailseite gehört weiterhin zu Paket B. Commit, Push, GitHub-Abgleich und TestFlight wurden nicht ausgeführt.

## Abnahme am 7. November 2026

Der Nutzer bestätigt den aktuellen Preview-Stand mit „ja passt“. Diese Rückmeldung gehört zu Paket A einschließlich der darin erhaltenen kompakten Jahres-Netto-Ansicht, Preview-Gruppe 25138531-70b1-433a-b4d1-20751a897159, Update 01a1b354-e158-7e24-b90e-09c0eed1f6e5. Die zuvor offene Geräteabnahme dieses Stands ist damit abgeschlossen.

Vor dem Commit wurden die Live-OTA einschließlich Bundle und aller 34 Assets, alle 2.420 Dateien des Kandidatenarchivs sowie die Prüflog-Hashes erneut abgeglichen. Der vereinbarte Ablauf erlaubt jetzt Commit und GitHub-Abgleich dieses Pakets. Die separate Luftig-Quelle wird ebenfalls gesichert; der Feature-Stand wird ausschließlich nach grüner PR-CI integriert. Paket B erhält anschließend eine eigene Preview-OTA und bleibt bis zu seiner Abnahme uncommittet.
