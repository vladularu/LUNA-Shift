# Sollarbeitszeit: Paket A/B

Stand: 23.10.2026. Ausgangspunkt: `origin/master` / `ab25991685f29f4787b515b21bf9e96e17e335ef`, Repository `vladularu/LUNA-Shift` (lokale Remote-URL verwendet noch den GitHub-Weiterleitungsnamen `PflegeShift`). Arbeitsbranch: `codex/tarif-sollzeit-ab`, eigener Checkout. Der unabhängige, veränderte Desktop-Checkout bleibt erhalten.

## Task-Vertrag und Paketgrenze

- Ziel A: vorhandene Sollzeitwege, auswählbare Tarifmodelle, Quellen und Anspruchslücken inventarisieren.
- Ziel B: dieselbe zentrale Engine hinter bestehendem Tages-/Monats-API; zusätzliche explizite, datierte Berechnungseingaben; nachvollziehbare TVöD-K-Regeln und Regressionen.
- Plattform: gemeinsame TypeScript-Engine für iOS/Android/Web; Expo `~57.0.22`, [SDK-57-Dokumentation](https://docs.expo.dev/versions/v57.0.0/) geprüft.
- Dateiscope: `src/domain/working-time-target.ts`, `src/engine/working-time-target{,-input,-rules,.test}.ts`, `src/engine/{daily-summary,daily-summary.test,monthly-summary}.ts` und die beiden Dokumente `docs/working-time-target-{analysis,sources}.md`.
- Nicht-Ziele: Tarifaktivierung für weitere Familien, neue Einstellungen/Navigation, SQLite, Backupformat, Cloud, Gehaltsregeln, Zuschläge, Ersatzruhe-/Zeitkonto-/Freizeitausgleichsbuchungen, native Konfiguration und Veröffentlichungen.
- Abnahme B: 8.778 Minuten im ausdrücklich qualifizierten Referenzfall; keine doppelten Feiertagsabzüge; unbestätigte Voraussetzungen bleiben vorläufig; historische Lücken ergeben keine sichere Gesamtzahl; keine fiktive Istzeit; bestehende Monats-/Vergütungsfälle bleiben grün.
- Keine visuelle Änderung. Geräteabnahme wird für Paket D benötigt; lokale Tests und Exporte ersetzen sie nicht.
- Git-Freigabe am 23.10.2026 nach lokaler Verifikation ausdrücklich erteilt: Commit, Push und eigener A/B-Pull-Request. Merge und Veröffentlichungen bleiben separate Freigaben.

## Ursache und betroffene Aufrufwege

Vorher berechnete `calculateMonthlyTargetMinutes` in `src/engine/monthly-summary.ts:21` ausschließlich `round(Wochenminuten / 5 × Werktage Mo–Fr ohne Feiertage)`. Der Profilparameter enthielt Bundesland, Feiertagsregion und Wochenminuten. Gehaltstarif, besonderer Teil, Schichtmodell, Datumsgültigkeit und Dienstplan waren nicht verfügbar.

`calculateDailyTargetMinutes` in `src/engine/daily-summary.ts:61` enthielt dieselbe Annahme mit Rundung je Tag. Bei nicht durch fünf teilbaren Wochenminuten konnten Tages- und Monatswerte deshalb zusätzlich auseinanderlaufen. `calculateDailyWorkCredit` verwendete den damaligen Tagessollwert auch für Krankheit/Urlaub. Ein Tarifabzug an dieser Stelle hätte ungewollt die Istgutschrift verändert.

Die vor der Änderung geprüften Graphkanten und anschließenden Detailprüfungen ergeben:

| Verbraucher                            | Berechnungsweg                                                                     | Befund                                                                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Monatsauswertung / Arbeitszeitdetails  | `calculateMonthlyAnalysis` → `calculateMonthlySummary` → Monatsziel                | Ein zentraler Monatsweg, bislang ohne Anspruchskontext                                                                                     |
| Jahresauswertung                       | `annual-report.ts:165` und `annual-core-report.ts:201` → `calculateMonthlySummary` | Zwei Aggregations-/Cachepfade, keine weitere Tarif-Sollzeitformel; beide müssen später den Kontext in Aufruf und Cache-Schlüssel aufnehmen |
| Kalender / Tagesdetails / Stundenserie | `calendar-metrics.ts:39/60` → `calculateDailyWorkCredit` → Tagesziel               | Bisher eigenständige Tagesformel; jetzt ebenfalls zentrale Ziel-Engine                                                                     |
| PDF/CSV                                | `report-export/report-data.ts:56` → Monatsanalyse/Jahresbericht                    | Keine eigene Sollzeitformel; Kontext, Status und Erklärungszeilen müssen in D durchgereicht/exportiert werden                              |
| Istzeit und Abwesenheit                | `calculateTimedDailyWorkCredit`, `calculateDailyWorkCredit`                        | Tatsächliche Arbeitszeit bleibt aus Einträgen; bestehende Abwesenheitsgutschrift bleibt ausdrücklich separat erhalten                      |
| Gehalt                                 | `pay.ts`, `simple-*` und `remuneration-*`                                          | Eigene Vergütungswege; ein Zuschlag bestätigt weder Arbeitszeitmodell noch Sollzeitanspruch                                                |

`salary-basis-options.ts` bietet TVöD-P, TVöD VKA E, TV-L Pflege, TV-H Pflege, TV-UK Pflege, TVAöD Pflege, TVA-L Pflege und eigenes Monatsbrutto an. TVöD-P/E können BT-K beziehungsweise BT-B tragen. Die datierte Auswahl in `remuneration-tariff-options.ts` hat eine andere, engere Aktivierungsgrenze; vorhandene Caritas-/DRK-/SuE-/AVR-DD-Entwürfe sind keine automatisch aktivierte App-Unterstützung.

`UserProfile` hält die aktuellen Arbeitsstunden/Region und mehrere optionale Gehaltsmodelle. `DatedRemunerationProfile` hält datierte persönliche Wochenminuten und Tarifauswahl, aber keinen vollständigen historischen Arbeitszeit-/Feiertagsregion-/Dienstplankontext. `regularRotatingNightWork`, `sundayHolidayWorkEligible` und Schichtzulagenbestätigungen ersetzen die Voraussetzungen des BT-K § 49 Abs. 2 nicht.

## Architekturentscheidung

`calculateMonthlyWorkingTimeTarget` ist die gemeinsame Sollzeit-Engine. Die bisherigen numerischen APIs delegieren dorthin. Es gibt keine zweite zusätzliche Monatsformel. Der Detailvertrag liefert Basissoll, gesetzliche und tarifliche Abzüge, Rundungsdifferenz, Datum, Regel-ID, Rechtsgrundlage, Quelle, Bedingung, Status und Tagesbeiträge.

Der zusätzliche `WorkingTimeTargetContext` wird als letzter optionaler API-Parameter übergeben. Er enthält überschneidungsfreie Gültigkeitsintervalle mit individuellen Wochenminuten, Bundesland/Feiertagsregion, tatsächlichem Modell und unabhängig bestätigter Tarifgeltung. Dazu kommen abschließende tagesbezogene Dienstplanangaben und gegebenenfalls explizite Beschäftigungsgrenzen. Gehaltstabellen, leere Kalender, `FREE`-Einträge, Profilerstellungsdatum oder Zuschlagsmodus erzeugen diese Bestätigungen nicht.

Die rotierende Variante benennt ausdrücklich eine **betriebliche Mo–Fr-Referenzbasis von jeweils einem Fünftel**, bei tatsächlich wechselnden fünf Arbeitstagen im Siebentageplan. Diese Variante ist keine Behauptung einer festen Mo–Fr-Arbeitswoche. Andere Verteilungen benötigen eine eigene belegte Basis. Feste Wochen erlauben dagegen sieben individuelle Tageswerte, deren Summe exakt den Wochenminuten entsprechen muss.

Der Rechenweg führt ganzzahlige Minutenzähler mit dem festen Nenner fünf. Er akkumuliert keine dezimalen Stunden und rundet erst kumulierte Werte auf ganze Minuten. Tagesbeiträge sind Differenzen der gerundeten kumulierten Werte; sie summieren sich exakt zum Monatsziel. Auch Basis und Abzüge werden kumuliert gerundet; `roundingMinutes` zeigt die daraus entstehende Differenz ausdrücklich. Für eine nicht durch fünf teilbare Wochenminute ist das ein Rundungsausgleich, kein zusätzlicher Tarifanspruch. Beispiel: `22 × 1001 / 5` ergibt 4.404 Minuten, nicht `22 × round(1001 / 5)`.

Ein Samstagsabzug kann einen negativen **Tagesbeitrag zur Monatszielbuchung** ergeben. Das ist keine negative Arbeitsleistung. Eine insgesamt negative Monatssollzeit wird als nicht verfügbar markiert, um eine ungeprüfte Teilmonats-/Betriebsregel nicht durch Abschneiden auf null zu verstecken.

- `FINAL`: Die unterstützte Zielregel und alle für das Monatsziel benötigten Angaben sind bestimmt. Dies bestätigt weder die Vergütung noch ein gesamtes Arbeitszeitkonto.
- `PROVISIONAL`: Ein Zielwert mit offenen oder ausdrücklich als Legacy-Schätzung gekennzeichneten Positionen. `PENDING`-Positionen ziehen **null** Minuten ab.
- `UNAVAILABLE`: Historische Angaben fehlen oder die Monatsbasis ist widersprüchlich. Der Detailwert ist `null`; die numerische API wirft einen sichtbaren Fachfehler.

Ohne neuen Kontext bleibt der bisherige Monatswert kompatibel, ausdrücklich als Legacy-Referenz im Detail-API gekennzeichnet. Die vorhandenen UI-Aufrufer bekommen in B noch keine neuen Tarifbestätigungen: **Der reale Nutzerfall wird erst durch die Profil-/Anzeigeintegration D aktiv korrigiert.** Die bisherigen Monats-Summary-Objekte bleiben ohne neuen Kontext unverändert aufgebaut. Beim Kontextaufruf wird `targetCalculation` mitgeliefert. Ist-/Urlaubs-/Krankheitsminuten bleiben unabhängig von diesem Kontext.

Der zusätzliche Gemeinderegionstest hat eine weitere Bestandsgrenze nachgewiesen: Der eingebettete Legacy-Feiertagskatalog (Vertrag 1) bildet die lokalen Feiertagsregionen nicht vollständig ab. Explizite neue Profile für BY/SN/TH benötigen deshalb einen regionalfähigen Feiertagsresolver ab Vertrag 2. Eine unbekannte Region oder ein zu alter Katalog liefert `UNAVAILABLE` mit Grund, statt ein endgültiges falsches Ergebnis. Der regionale Test verwendet das bereits vorhandene geprüfte `de-holidays/2026`-Paket; dieses wird durch B nicht eigenständig aktiviert.

## Referenz Dezember 2026

Explizite Testannahmen: BT-K-Geltung bestätigt, geprüfter Regelstand 01.01.2026, Hessen, 2.310 persönliche Wochenminuten, bestätigter regelmäßiger Schicht-/Wechselschichtplan über sieben Tage, vereinbarte Fünftel-Referenzbasis; 24./25./26./31.12. im abschließenden Plan frei; nicht wegen des jeweiligen gesetzlichen Feiertags frei; andernorts regulär zu erfüllende Arbeitszeit bestätigt; am 24./31. je 462 ausgefallene Minuten bestätigt. Keine zusätzliche Freistellungs-/Zeitgutschrift für dieselbe Position wird eingebucht.

| Position                                        |   Minuten |    Stunden |
| ----------------------------------------------- | --------: | ---------: |
| 23 Referenztage Montag bis Freitag              |    10.626 |     177:06 |
| 24.12., tariflich                               |      −462 |      −7:42 |
| 25.12., gesetzlich / BT-K § 49 Abs. 2           |      −462 |      −7:42 |
| 26.12., gesetzlich / Samstag / BT-K § 49 Abs. 2 |      −462 |      −7:42 |
| 31.12., tariflich                               |      −462 |      −7:42 |
| Finale Sollzeit                                 | **8.778** | **146:18** |
| Bisheriger LUNA-Wert                            |    10.164 |     169:24 |
| Differenz                                       | **1.386** |  **23:06** |

Der ATOSS-Wert ist die vom Nutzer gelieferte externe Regressionserwartung; es wurde kein ATOSS-System live ausgelesen. Rechtsgrundlagen und Kontrollrechnungen stehen im [Quellen-/Tarifinventar](working-time-target-sources.md). Bei fester Mo–Fr-Woche und bestätigter Freistellung am 24./31. ergibt dieselbe Stundenbasis **154:00**, weil der Samstag keinen festen Arbeitstag ersetzt.

## Noch getrennt auszuführen

1. **D1, vor Aktivierung:** datierte Arbeitszeit-/Regions-/Tarifgeltung und relevante Planangaben in bestehenden Profilen ergänzen. Vorhandene datierte Vergütung wiederverwenden, aber Zeitmodell nicht daraus ableiten. Fehlende Historie offen lassen. Nicht bestätigte Bestandsprofile unverändert lassen. Speicher-/Backupvertrag versionieren und Rückwärtskompatibilität testen; keine destruktive Migration.
2. **D2:** denselben Kontext durch Tages-/Monats-/Jahrespfade, Cache-Schlüssel und PDF/CSV reichen; `PROVISIONAL`/`UNAVAILABLE` und offene Positionen sichtbar darstellen. Aufklappbare Sollzeit-Erklärung im bestehenden Kartenlayout; gesetzliche Feiertage und tarifliche Sondertage im Kalender unterscheiden. Screenshot- und iPhone-Abnahme im Preview nach gesonderter Verteilungsfreigabe.
3. **C, jeweils einzeln:** BT-B, TVöD E im tatsächlichen besonderen Teil, TV-L, TV-H, TV-UK, Ausbildung. Für jeden Adapter normale Monate und Sonderfälle aus unabhängigen Quellen bestätigen. Kein Übernehmen der BT-K-Arbeitsleistungsregel in TV-L/TV-H und kein Samstagabzug für TV-UK-Kontenbereiche aus BT-K ableiten.
4. **P1-Folgeroadmap:** bezahlte Feiertagsfreistellung und ihre Darstellung im Ist-/Zeitkonto, Freizeitausgleich für Arbeit am 24./31. und Feiertagsarbeit außerhalb § 49 Abs. 2; sicherstellen, dass dieselbe Entlastung nicht zusätzlich gutgeschrieben wird.
5. **P2:** Ersatzruhetage, Ausgleichsfristen und abweichende Betriebsvereinbarungen; Überstunden/Mehrarbeit anhand des richtigen Ausgleichszeitraums, nicht allein des Monatssaldos; Dienstplanbewertung von Urlaub/Krankheit.
6. **P3:** Zusatzurlaub, Bereitschafts-/Rufbereitschaftsbewertung und deren getrennte Vergütung. Bestehende Zuschlagsregeln bleiben in ihrer eigenen Engine.

Die 2026-Grenze im BT-K-Adapter ist der **geprüfte Anwendungszeitraum**, kein behauptetes tarifliches Außerkrafttreten. Für andere Fassungen/Jahre wird eine Meldung statt stiller Weitergeltungsannahme geliefert. Der Mechanismus gilt für sämtliche Monate innerhalb des geprüften Zeitraums, nicht nur Dezember.

## Verifikation

Unveränderte Ausgangsprüfung: 62 Tests grün. Neue Regression zunächst rot wegen fehlender Engine, anschließend 96 fokussierte Tests grün. Der zusätzliche Regionalfall war mit dem Legacy-Resolver zunächst rot; nach expliziter Fähigkeitsprüfung und Verwendung des vorhandenen geprüften Regionalkatalogs sind alle 32 neuen Enginefälle grün. Der erste Gesamtlauf hatte noch den alten Regionaltest geladen (9.146 andere Tests grün); der abschließende Gesamtlauf wurde vollständig auf dem korrigierten Stand wiederholt.

| Prüfung                               | Tatsächlicher Befehl / Nachweis                                                                                                                                                                                                                                     | Ergebnis                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Abhängigkeiten / Hooks                | `npm.cmd ci --no-audit --no-fund`, `npm.cmd run workflow:setup`                                                                                                                                                                                                     | Erfolgreich; keine Paket-/Lockfileänderung                                                                                                            |
| Gesamtes schnelles Gate               | `$env:VITEST_MAX_WORKERS='1'; npm.cmd run verify:fast`                                                                                                                                                                                                              | **Exit 0**, einschließlich Regelverträge, Katalogvalidierung, Typecheck, ESLint ohne Warnungen, Prettier, kompletter Testkette und `git diff --check` |
| Fach-/Integrationstests im Gate       | `vitest run`                                                                                                                                                                                                                                                        | **474 Dateien, 9.147 Tests bestanden**                                                                                                                |
| Komponententests im Gate              | `jest --runInBand`                                                                                                                                                                                                                                                  | **150 Suites, 1.378 Tests bestanden**                                                                                                                 |
| Weitere Skriptprüfungen im Gate       | Publisher/Delivery/Preflight/Trust/Operator, Tarifinventar, Audit/Runtime/Build-Abhängigkeiten, Kalender-Worklets, Sharing-Sicherheit, native Widgets, Decoder                                                                                                      | **207 Tests bestanden**, keine Fehler                                                                                                                 |
| Neue gezielte Regressionen / Coverage | `npm.cmd test -- src/engine/working-time-target.test.ts --pool=threads --maxWorkers=1 --coverage --coverage.include=src/engine/working-time-target.ts --coverage.include=src/engine/working-time-target-input.ts --coverage.reportsDirectory=coverage/target-final` | **32 Tests bestanden**, 95,67 % Zeilen, 91,97 % Zweige, 100 % Funktionen; globale Testschwellen unverändert                                           |
| Lokale iOS-Buildprüfung               | `$env:APP_VARIANT='internal'; npm.cmd run export:ios`                                                                                                                                                                                                               | **Exit 0**, Hermes-Bundle und `dist/ios/metadata.json` erzeugt; kein signierter nativer Build und keine Verteilung                                    |
| Integrität                            | SHA-256-Vergleich der acht Code-/Testdateien vor/nach dem finalen Gate                                                                                                                                                                                              | **8/8 unverändert**; nur Abschlussdokumentation danach ergänzt                                                                                        |
| Ursprünglicher Desktop-Checkout       | `git diff --exit-code -- src/engine/daily-summary.ts src/engine/daily-summary.test.ts src/engine/monthly-summary.ts` im Desktop-Checkout; neue Engine dort nicht vorhanden                                                                                          | **Unberührt**                                                                                                                                         |
| Kontextgraph                          | `graft build`                                                                                                                                                                                                                                                       | Erfolgreich aktualisiert; lokaler, ignorierter Cache                                                                                                  |

Die Kontrollwerte in der Quellenmatrix sind handgerechnet. Die Tests prüfen neben dem Dezemberfall feste/wechselnde Verteilung, Arbeit/Planfrei/Freistellung, Wochenenden, fehlende/entgegenstehende Angaben, Teilzeit, ungleichmäßige feste Tageswerte, datierte Tarif-/Stunden-/Regionswechsel, normale Monate, Beschäftigungsgrenzen, Jahres-/Versionsgrenze, doppelte/inkonsistente Eingaben, die Trennung von Istzeit/Abwesenheitsgutschrift und die Übereinstimmung der Tages-/Monats-APIs. Die vorhandenen Gehalts-, Kalender-, Monats-/Jahres- und Exporttests bleiben unverändert grün. Die neue Tarifkorrektur in diesen UI-/Export-Aufrufern ist weiterhin Teil von D und wird durch diese grünen Bestandsfälle nicht als bereits integriert behauptet.

Logs liegen lokal in `%TEMP%/luna-tarif-sollzeit-verify-fast-final.log` und `%TEMP%/luna-tarif-sollzeit-export-ios.log`; die geprüften Codehashes in `%TEMP%/luna-tarif-sollzeit-source-hashes.json`. Keine echte iPhone-Abnahme durchgeführt, weil B weder UI noch native Integration verändert. Der lokale Verifikationsstand wurde vor Commit/Push/PR festgehalten. Der Nutzer hat anschließend die Git-Lieferung dieses A/B-Standes freigegeben; PR-CI wird für den dadurch erzeugten Commit geprüft. Eine Zusammenführung oder Produktions-/Preview-/TestFlight-Veröffentlichung ist damit nicht freigegeben.

## Geänderte Dateien

| Datei                                     | Änderung                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/domain/working-time-target.ts`       | Neuer gemeinsamer Eingabe-/Ergebnisvertrag                                                 |
| `src/engine/working-time-target.ts`       | Zentrale Berechnung und nachvollziehbares Minutenjournal                                   |
| `src/engine/working-time-target-input.ts` | Datums-, Minuten-, Regionen-, Intervall- und Widerspruchsprüfung                           |
| `src/engine/working-time-target-rules.ts` | Identifizierte Quellen-/Regelbeschreibungen und geprüfter Zeitbereich                      |
| `src/engine/working-time-target.test.ts`  | 32 neue fachliche Enginefälle                                                              |
| `src/engine/monthly-summary.ts`           | Bestehende Monats-APIs delegieren an die gemeinsame Engine                                 |
| `src/engine/daily-summary.ts`             | Gemeinsame Tageszielberechnung, getrennt erhaltene Abwesenheitsgutschrift                  |
| `src/engine/daily-summary.test.ts`        | Regression zur unveränderten Abwesenheitsgutschrift bei Bruchteilsreferenzen               |
| `docs/working-time-target-analysis.md`    | Bestandsaufnahme, Architektur, Referenzrechnung, Abgrenzung und Prüfnachweise              |
| `docs/working-time-target-sources.md`     | Tarif-/Quellenmatrix, Geltung, Unterstützungsstatus, offene Rechtsfragen und Referenzwerte |
