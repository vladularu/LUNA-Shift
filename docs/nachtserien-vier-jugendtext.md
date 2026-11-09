# Einheitliche Nachtserien und Jugend-Feiertagstext

## Task-Vertrag

- Ziel: Nachtserien in allen bestehenden Prüfzweigen ab der vierten Nacht als freiwilligen Hinweis erkennen; den Text zum Feiertagsausgleich Jugendlicher auf dieselbe oder die folgende Woche korrigieren.
- Nicht-Ziele: Keine Änderung gesetzlicher Grenzwerte oder signierter Regelpakete, keine Erweiterung der Erholungsprüfung auf zusätzliche Profile, keine Änderung von Karten, Symbolen, Rahmenfarben, Tarif- oder Gehaltsberechnungen.
- Zielplattform: bestehende Expo-SDK-57-iPhone-Preview; installierte Expo-Version `~57.0.31`, passende SDK-57-Dokumentation vor Änderungen gelesen.
- Ausgangspunkt: lokaler Korrekturstand `e4bae6792be3b6267eb73ab285909cfd5cff0d063e21fac18ba92b53ec84c44e` auf HEAD `7025cc840eb6f712cdef4476c02a93ddcca53e70`. Vorhandene Änderungen sind unter `artifacts/night-threshold-correction/before.json` und `before/` gesichert.
- Branch: `codex/nachtserien-vier-jugendtext`. Der bestehende lokale Preview-Stand wird weitergeführt; unabhängige Änderungen bleiben erhalten.
- Erlaubter Dateiscope: `src/engine/compliance-planning-series.ts`, `src/engine/simple-youth-duty-week.ts`, `src/engine/compliance-version.ts`, zugehörige Regressionen in `compliance.test.ts`, `simple-youth-duty-time.test.ts`, `features/analysis/check-correction-integration.test.ts`, dieses Dokument und die exakte Quelländerungserklärung unter `releases/testflight/`.
- Abnahme: Drei Nächte ohne Serienhinweis; vier und fünf Nächte mit genau einem freiwilligen Serienhinweis, jeweils in Pflege-, Krankenhaus-, sonstigem und Jugend-Prüfzweig. Monatsgrenzen bleiben korrekt. Der Jugendtext nennt einen berufsschulfreien Arbeitstag derselben oder der folgenden Woche. Monats- und Jahrescaches verwerfen den vorherigen Regelstand.
- Commit, Push, native Builds und OTA: durch diesen Auftrag nicht freigegeben. Geräteabnahme nach separat freigegebener Preview-OTA; keine neue Gestaltung.

## Umsetzung und Beleg

Der ältere Serienzweig verwendet künftig `PLANNING_NIGHT_POLICY.firstNightHint` statt einer abweichenden Schwelle aus historischen Katalogdaten. Der bestehende Pflegezweig verwendet dieselbe Produktregel bereits. Die optionalen Erholungshinweise unter 24 beziehungsweise 48 Stunden bleiben in ihrem bestehenden fachlichen Umfang erhalten.

Für den Jugendtext gilt [§ 18 Abs. 3 JArbSchG](https://www.gesetze-im-internet.de/jarbschg/__18.html): Ersatzfreistellung an einem anderen berufsschulfreien Arbeitstag derselben oder der folgenden Woche. Die ausführliche Jugendprüfung verwendet diesen Zeitraum bereits; geändert wird die unzutreffende Beschreibung der vereinfachten Prüfung.

## Prüfergebnis

- Vor der Korrektur: zwölf gezielt rote Fälle in drei Suiten, darunter die fehlende vierte Nacht in den älteren Prüfzweigen, der Jugendtext und der noch gültige alte Cache.
- Nach der Korrektur: 151 gezielte Tests in sechs Suiten grün. Die neuen Nachtfälle prüfen drei/vier/fünf Nächte sowie den Monatswechsel in Pflege-, Krankenhaus- und sonstigem Profil, jeweils mit und ohne einfache Jugendprüfung. Auch ein als benutzerdefiniert gespeicherter Dienst wird anhand seiner Nachtarbeitszeiten erkannt.
- `npm.cmd run verify:fast` vollständig grün: Typprüfung, Lint, Formatierung, 558 Fachtestsuiten mit 10.649 Tests, 202 Komponentensuiten mit 1.944 Tests sowie Regelpaket-, Sicherheits-, Laufzeit- und weitere Projektprüfungen. Nur die unterstützte Vitest-Parallelität war auf zwei Worker begrenzt; keine Testzeitgrenzen oder Prüfschwellen wurden verändert.
- Quellvergleich: genau drei geänderte Appdateien gegenüber dem vorherigen lokalen Stand. Die weiteren 67 zuvor geänderten Dateien außerhalb dieses Auftrags sind bytegleich erhalten. Native Konfiguration, Abhängigkeiten, signierte Regelpakete und die akzeptierte TestFlight-Baseline bleiben unverändert.
- Korrigierter Source-Digest: `e1eb08806eb527eaa3018c3fdbe434f23711bceb4f5166191371f238be8b1b87`.

Protokolle, Exitcodes und Hashes liegen unter `artifacts/night-threshold-correction/`, insbesondere `red.log`, `focused.log`, `verify-fast.log` und `final-validation.json`. Der abschließende Vergleich bindet die bestandene Prüfung an unveränderte App-, Test- und Freigabedateien.

Der Stand ist lokal umgesetzt und geprüft. Keine Commit-, Push-, Build- oder OTA-Veröffentlichung wurde durchgeführt. Die iPhone-Abnahme der geänderten Ergebnisse und des Jugendtextes steht nach einer separat freigegebenen Preview-OTA aus; die bestehende Gestaltung bleibt erhalten.
