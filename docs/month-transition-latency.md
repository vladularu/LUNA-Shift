# Verbleibende Verzögerung beim Monatswechsel

Auftrag am 28.10.2026 nach erneutem iPhone-Test: Monatswechsel bei vielen Einträgen weiter verbessern, Berechnungen unverändert lassen und danach ausschließlich iOS-Preview-OTA veröffentlichen. Keine Freigabe für TestFlight, Production, native Builds oder Git-Delivery. Expo SDK 57 (`~57.0.31`), iPhone 14 Pro Max, Branch `codex/monthly-analysis-performance`.

Ausgangsstand ist die getestete Preview-Gruppe `529d782b-de53-4f6f-a236-cf62488a07fb`. Vor Änderungen werden die 75 veröffentlichten Quelldateien anhand ihres SHA-256-Manifests geprüft und unter `phase6-baseline/` im bestehenden Performance-Artefaktverzeichnis gesichert.

Ziel ist die Zeit bis zur richtigen Monatsanzeige und zur vollständigen Vorbereitung der angrenzenden Monate. Nicht-Ziele sind Änderungen an Tarif-, Zeit-, Netto-, Arbeitszeitprüfungs- oder Rundungsregeln, gekürzte Bewertungsfenster, native Integration und persistente Datenbank-Caches. Vorhandene periodenspezifische Navigation und natives Wischen bleiben erhalten.

Arbeitspakete: A) CPU-Zeit, Wartezeiten und Cache-Abfragen im bisherigen Ablauf getrennt messen; B) belegte Engpässe in Anzeige-Freigabe, Warteschlange und Schlüsselbildung einzeln verbessern; C) vollständige Ergebnisvergleiche, fokussierte Lebenszyklus-/Navigationstests und `npm.cmd run verify:fast`, anschließend kompatible Preview-OTA. Scope: Analyse-Seite, vorhandene Vorbereitungs-/Cache-/Warteschlangenhelfer und zugehörige Tests und Benchmarks. Bei mehr als 15 Dateien wird der Scope erneut in getrennte Pakete eingegrenzt.

Abnahme: vollständige Ergebnis-Hashes müssen zum Ausgangsstand identisch bleiben; Dienst-/Profil-/Katalogänderungen müssen sofort alte Ergebnisse verwerfen, Fehler müssen erneut prüfbar bleiben. Ein Monat darf seine richtigen bereits berechneten Zahlen anzeigen, während unabhängige Detailprüfungen noch als ausstehend gekennzeichnet sind. Kein alter Monatsinhalt unter einem neuen Datum. Angrenzende Monate sollen bei gleicher Arbeit weniger Scheduler-Wartezeit benötigen, weiterhin mit begrenzten Arbeitsschritten und wirksamer Stornierung/Priorisierung. Der sichtbare Erfolg auf dem iPhone bleibt nach Installation zu bestätigen.

Suchbudget: drei Hypothesen (Anzeige wartet auf Jahresprüfung; Ablaufsteuerung verzögert Nachbarmonate; wiederholte Schlüsselbildung beansprucht den Renderpfad), höchstens zwei Varianten pro Hypothese. Keine Änderung ohne Baseline und Ergebnisprüfung. Synthetische Node- und Scheduler-Messungen sind keine iPhone-Zeitmessungen.

## Befund und Auswahl

Die Anzeige-Freigabe ist nicht die Hauptursache: `AnalysisMonthTransition` zeigt bereits richtige Monatsdaten, sobald sie für dieselbe Seite verfügbar sind. Diese Freigabe und der native Wisch-Pager bleiben unverändert.

Die bisherige Warteschlange bevorzugte die umfangreichen Gehalts- und Arbeitszeitprüfungen des sichtbaren Monats vor den Übersichten der Nachbarmonate. Nach deren Fertigstellung wartete jede weitere Hintergrund-Fortsetzung erneut auf `requestIdleCallback` mit bis zu 250 ms Timeout. Die Baseline benötigt im Modell über 350 Scheduler-Aufrufe für drei dichte Monatsseiten. Dadurch können viele Sekunden Wartezeit entstehen, obwohl die gesamte CPU-Zeit viel geringer ist.

Ausgewählt ist folgende Reihenfolge: sichtbare Monatsübersicht, angrenzende Monatsübersichten, sichtbare Arbeitszeitprüfung, sichtbare Gehaltsvorbereitung, übrige Prüfungen und Gehaltsvorbereitungen. Eine aktive Nachbarseite wird weiterhin ohne Neustart hochgestuft. Bei Hintergrundarbeit konkurriert der bisherige Idle-Aufruf mit einer Fortsetzung nach 8 ms; der frühere gewinnt und storniert den anderen. Das bisherige kooperative Budget von vier Millisekunden beziehungsweise 32 Schritten pro Aufruf bleibt erhalten. Ein einzelner Generatorschritt kann dieses Budget weiterhin überschreiten; unveränderte fachliche Berechnungen werden nicht mitten im Schritt unterbrochen.

Die Cache-Schlüssel enthielten dieselben Einträge mehrfach: als Monatsinhalt, Dienstliste, Jahresfenster der Arbeitszeitprüfung und mehrfache tarifliche Rückblicke der Jahreszahlung. Die ausgewählte Schlüsselvariante erstellt eine temporäre Referenztabelle und serialisiert die vollständigen Eintragsinhalte einmal mit `JSON.stringify`. Listenpositionen, Anzahl und sämtliche Inhalte bleiben im Schlüssel enthalten. Es gibt keine Hash-Kollisionen und keinen dauerhaften Fingerprint-Cache. Bei jeder neuen Abfrage werden auch Änderungen ohne Revisionswechsel erneut gelesen. Die eigentlichen Recheneingaben werden unverändert weitergegeben.

| Variante      | Hypothese                                                       | Ergebnis                                                                                            | Entscheidung    |
| ------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------- |
| Ausgangsstand | veröffentlichte Prioritäten und Idle-Fortsetzungen              | Nachbarübersicht im Modell nach rund 2–5 Sekunden                                                   | Vergleichsbasis |
| Queue A       | Monatsübersichten vor unabhängigen Details vorbereiten          | Nachbarübersicht nach rund 0,4–0,7 Sekunden; komplette Ergebnisse identisch                         | übernommen      |
| Queue B       | zusätzlich begrenzte Wartezeit bei ausbleibendem Idle-Aufruf    | restliche Vorbereitung auch bei hoher Idle-Verzögerung nach rund 3–4 statt 14–17 Sekunden im Modell | übernommen      |
| Schlüssel A   | jeden Eintrag separat serialisieren und nach Inhalt internieren | wiederholte Abfragen meist langsamer                                                                | verworfen       |
| Schlüssel B   | gemeinsame Referenztabelle, eine native JSON-Serialisierung     | deutlich kleinere Schlüssel; wiederholt überwiegend geringere Abfragezeit                           | übernommen      |

## Wiederholte Messung

`phase6-final-comparison.json`: pro Fall 11.008 Einträge, drei Dienste täglich über zwölf Monate plus 10.000 irrelevante historische Einträge. Drei Monatsseiten mit vollständiger Übersicht, Arbeitszeitprüfung, Jahreszahlung und Netto. Der Scheduler simuliert ausdrücklich 16 beziehungsweise 80 ms Verzögerung je Idle-Aufruf. Diese Verzögerung ist eine kontrollierte Testbedingung, keine Messung vom iPhone. Die gesamte geleistete fachliche Arbeit und alle vollständigen Ausgabewerte werden verglichen.

| Tarif / Idle-Verzögerung | Nachbarübersicht vorher → nachher | Nachbargehalt vollständig vorher → nachher | CPU für alle drei Seiten vorher → nachher |
| ------------------------ | --------------------------------: | -----------------------------------------: | ----------------------------------------: |
| TV-L / 16 ms             |                    2.403 → 472 ms |                           5.025 → 3.272 ms |                          2.057 → 1.970 ms |
| TV-L / 80 ms             |                    4.541 → 447 ms |                          15.227 → 3.163 ms |                          1.892 → 1.894 ms |
| TV-UK / 16 ms            |                    2.334 → 426 ms |                           4.944 → 3.322 ms |                          1.948 → 1.960 ms |
| TV-UK / 80 ms            |                    4.683 → 424 ms |                          15.866 → 3.370 ms |                          1.963 → 1.978 ms |
| TVöD-E/VKA / 16 ms       |                    2.706 → 773 ms |                           5.432 → 3.788 ms |                          2.288 → 2.355 ms |
| TVöD-E/VKA / 80 ms       |                    5.365 → 599 ms |                          17.309 → 3.656 ms |                          2.183 → 2.202 ms |

Der Gewinn liegt hauptsächlich in vermiedener Wartezeit, nicht in einer weiteren starken CPU-Beschleunigung. Kalte einzelne Generatorschritte sind weiterhin bis etwa 67 ms lang; ein garantiert unterbrechungsfreier Erstaufruf eines ungeplanten Monats ist damit nicht belegt. Der geänderte Ablauf soll angrenzende Monatsübersichten vor dem Wischen bereitstellen.

Über 60 Wiederholungen pro Fall sinkt der Median der drei vorbereiteten Monatsabfragen überwiegend von rund 8–9 auf 6–8 ms; ein TV-UK-Lauf liegt innerhalb der Messschwankung. Die drei Übersichtsschlüssel sinken von insgesamt rund 1,48–1,68 Millionen auf 1,20 Millionen Zeichen. Die drei Gehaltsschlüssel sinken bei TV-L/TV-UK von rund 989.000 auf 505.000, bei VKA von 1,97 Millionen auf 712.000 Zeichen. Es werden dieselben Inhalte gespeichert, mit weniger mehrfacher Darstellung.

Die sechs Ablaufvergleiche mit jeweils drei vollständigen Monatsergebnissen stimmen exakt mit der Preview-Vergleichsbasis überein. Zusätzlich bestehen die 32 Hauptfälle und 20 zurückgehaltenen Tarif-/Regions-/Teilzeit-/Jahreswechselfälle des bestehenden Benchmarks, einschließlich einer Dienständerung. 35 bereits veröffentlichte Dateien aus Rechenengine und Gehaltsberechnung sind bytegleich unverändert. Die fokussierten Cache-/Queue-Tests und 90 Lebenszyklus-/Navigations-/Bildschirmtests bestehen. Die vollständige Projektprüfung und Veröffentlichung werden im anschließend eingefrorenen Quellenmanifest protokolliert.

## Reproduktion und Release

Arbeitsverzeichnis: `C:\Users\veron\.codex\worktrees\monthly-analysis-performance\MediShift`. Artefakte: `C:\Users\veron\.codex\visualizations\2026\10\27\01a17f09-8819-7f23-9155-f6f974bff1af`.

```powershell
$performanceArtifacts = 'C:\Users\veron\.codex\visualizations\2026\10\27\01a17f09-8819-7f23-9155-f6f974bff1af'
node --require tsx/cjs scripts/benchmark-analysis-latency.cjs --compare (Join-Path $performanceArtifacts 'phase6-baseline')
node --require tsx/cjs scripts/benchmark-all-tariffs.cjs --compare (Join-Path $performanceArtifacts 'phase6-baseline')
node --require tsx/cjs scripts/benchmark-all-tariffs.cjs --compare (Join-Path $performanceArtifacts 'phase6-baseline') --holdout
npm.cmd test -- src/features/analysis/analysis-entry-keys.test.ts src/features/analysis/analysis-work-queue.test.ts src/features/analysis/monthly-analysis-cache.test.ts src/features/analysis/analysis-salary.test.ts
npm.cmd run test:components -- --runTestsByPath src/features/analysis/use-prepared-monthly-analysis.component.test.tsx src/features/analysis/use-prepared-analysis-salary.component.test.tsx src/features/analysis/use-monthly-compliance.component.test.tsx src/ui/report-period-pager.component.test.tsx src/features/analysis/analysis-rule-coverage.component.test.tsx
node (Join-Path $performanceArtifacts 'phase6-verification-setup.cjs')
node (Join-Path $performanceArtifacts 'phase6-source-gate.cjs')
npm.cmd run verify:fast
node (Join-Path $performanceArtifacts 'phase6-source-gate.cjs') --finalize
$env:APP_VARIANT = 'internal'
npx.cmd --yes eas-cli@latest update --branch preview --platform ios --environment preview --message 'Monatswechsel: Nachbarmonate frueher bereit und weniger Scheduler-Wartezeit' --emit-metadata --json
node (Join-Path $performanceArtifacts 'verify-phase6-preview.cjs')
```

Protokolle: `phase6-queue-variant-a.json`, `phase6-key-variant-a.json`, `phase6-key-variant-b.json`, `phase6-promoted-comparison.json`, `phase6-final-comparison.json`, `phase6-all-tariffs.json`, `phase6-tariffs-holdout.json`, `phase6-calculation-source-proof.json`. Der finale Quellstand wird in `phase6-source-manifest.json` mit erfolgreicher Gesamtprüfung und SHA-256 je Datei festgehalten. `phase6-preview-verification.json` belegt danach passende Runtime sowie identische lokale und ausgelieferte Bundle-Datei. SQL-Wartezeiten, React-Commit-Dauer und native iPhone-Frames sind vom synthetischen Ablaufmodell nicht erfasst; die Geräteabnahme bleibt offen.
