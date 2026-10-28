# Einzelprüfung der übrigen Tarife

## Auftrag und Grenzen

Freigabe am 28.10.2026: die übrigen Tarifwege einzeln messen, bei belegtem Bedarf optimieren und danach ausschließlich iOS-Preview-OTA veröffentlichen. Die vorherigen Verbesserungen bleiben erhalten. Kein TestFlight, nativer Build oder Git-Delivery. Expo SDK 57 (`~57.0.31`), Zielgerät iPhone 14 Pro Max. Arbeitsstand: Branch `codex/monthly-analysis-performance`, Basis `6b571f85d453c09ea50756e13299231e0883bda4` plus die 63 bereits geprüften Performance-Dateien.

Vergleichsbasis ist die veröffentlichte Preview-Gruppe `375d8db8-3b97-4371-9562-b4aeaa2a7235`, Update `01a1803f-4b6e-7ddd-8b3e-40fcd8b85e30`. Ihre Quellen sind anhand des Veröffentlichungsmanifests verifiziert und unter `phase5-baseline/` gesichert, einschließlich der bisher unveränderten übrigen Tarifrechner.

Ziel: für TVöD-P, TVöD-E/VKA, TV-H KR, TVAöD Pflege und TVA-L Pflege die erste Monatsübersicht, vollständige Jahres-/Netto-Vorbereitung, Änderung eines Dienstes und vorbereitete Wiederholung messen. TV-L KR, TV-UK und manuelles Gehalt dienen als Kontrollen. Nicht-Ziele: andere Berechnungsformeln, Anspruchsregeln, Rundungen, Bewertungsfenster, UI-/Wischgestaltung, Datenbankschema, native Konfiguration oder Abhängigkeiten.

Arbeitspakete: A) reproduzierbare Tarifmatrix und vollständige Ergebnis-Hashes gegen den veröffentlichten Stand; B) ausschließlich belegte lange oder wiederholte Schritte in den betroffenen Tarifrechnern und ihrer bestehenden Vorbereitung verbessern; C) Invalidierung, Fehler-/Katalog-/Profilwechsel, Zeitumstellung und die gemeinsame Fassung prüfen, dann kompatible Preview veröffentlichen. Bei mehr als 15 Dateien bleibt die Arbeit in diesen Paketen begrenzt. Dateiscope: Benchmark/gezielte Tests, betroffene `simple-*-pay`-Rechner, ihre bereits verwendeten Cache-/Vorbereitungshelfer und diese Dokumentation.

Korrektheits-Gate: komplette Monatsübersicht, Jahreszahlung und Netto vor und nach einer Dienständerung müssen exakt dieselben Hashes liefern; Fachanweisungen werden soweit möglich zusätzlich per Syntaxbaum verglichen. Bestehende Tarif-/Netto-/Sonderfalltests und `npm.cmd run verify:fast` müssen bestehen. Messgrößen: erste und geänderte CPU-Zeit, längster synchroner Generatorschritt, vorbereitete Abfrage und begrenzte Cache-Größen. Identische synthetische Normal-/Mehrfacheintragspläne mit 10.000 irrelevanten historischen Einträgen, Jahr 2026 und Jahreswechsel 2027. Zeitumstellungen, Nachtpausen, Samstag-/Schichtoptionen und Beschäftigungsperioden bleiben in den Regressionstests enthalten.

Suchbudget: höchstens drei belegte Engpasshypothesen, höchstens zwei Implementierungsvarianten je betroffenem Tarifweg, keine nativen/externen Datenänderungen. Baseline und Gewinner werden getrennt wiederholt; bei Effekten innerhalb der Messschwankung entfällt eine unnötige Codeänderung. Node-CPU-Zeiten ersetzen keine iPhone-Zeiten oder sichtbare Geräteabnahme. Diese bleibt nach der ausdrücklich freigegebenen Preview zu bestätigen.

## Befunde und ausgewählte Änderungen

TVöD-E/VKA und TVAöD Pflege berechneten unveränderte Dienste bei jeder Monats- oder Jahresberechnung erneut. Zusätzlich wurden dieselben profil- und dienstabhängigen Regelbedingungen für jede einzelne Minute geprüft. Die ausgewählte Fassung hält erfolgreiche Dienstergebnisse mit vollständigem Inhaltsschlüssel und getrenntem Regelkatalog vor. Regelbedingungen werden nur innerhalb eines synchronen, unveränderlichen Minutenlaufs je Datum wiederverwendet; die bisherige verzögerte Auswertung und Fehlerreihenfolge bleiben erhalten. Datumsdarstellung und Startzeitpunkt werden außerhalb der Minutenschleife ermittelt.

TV-H KR und TVA-L Pflege erhalten dieselbe begrenzte Wiederverwendung von Dienstergebnissen. Ihre Vorbereitung läuft schrittweise über die Dienste, sodass der abschließende Monatsrechner auf diese Ergebnisse zugreifen kann. Bei TV-H werden dabei die tatsächliche Zulagenentscheidung, bezahlte Wechselschichtpausen und Samstagsoptionen berücksichtigt; die zusätzliche Monatsbewertung wird ebenfalls begrenzt wiederverwendet. Beschäftigungswechsel mit mehreren Perioden bleiben beim bisherigen verbindlichen Rechner.

TVöD-P wurde einzeln gemessen. Die zusätzliche Änderung seiner eigenen Minutenschleife war über die Wiederholungen nicht zuverlässig besser und wurde verworfen. Die bereits veröffentlichte Fassung bleibt erhalten. TV-L KR, TV-UK und manuelles Gehalt wurden als Kontrollen erneut verglichen. Die bereits vorhandenen TV-L-/TV-UK-Optimierungen bleiben bestehen. Noch nicht angebundene Entwürfe weiterer Tarifpakete wurden nicht aktiviert.

Variante A ergänzte Dienst-Caches und schrittweise Vorbereitung. Variante B ergänzte die lokale Wiederverwendung von Regelbedingungen und der TV-H-Bewertung. Ausgewählt wurde B für die vier oben genannten Tarifrechner; für TVöD-P bleibt die Ausgangsfassung. Maßgeblich sind kürzere zusammenhängende Rechenschritte und weniger Wiederholung bei Änderungen. Die erste vollständige Berechnung benötigt bei TV-H und TVA-L teilweise mehr gesamte CPU-Zeit durch Vorbereitung, Schlüsselbildung und begrenzte Caches. Eine allgemeine Beschleunigung jedes Kaltpfads ist deshalb nicht belegt.

## Messung und Korrektheit

32 Hauptfälle: acht Tarifwege, ein beziehungsweise drei Dienste pro Tag, Oktober 2026 und Januar 2027. Dazu 20 zurückgehaltene Fälle für BT-B/KAV-BW, drittes Ausbildungsjahr, TVA-L Ost und TV-H KR13 in Teilzeit. Jeder Fall enthält 10.000 irrelevante historische Einträge und Pläne in mehreren Monaten. Verglichen werden die vollständige Übersicht, Arbeitszeitprüfung und Gehaltsvorbereitung einschließlich Jahreszahlung und Netto, jeweils vor und nach einer Dienständerung bei gleicher Revision. Die bestehenden Grenzen automatischer Jahreszahlungsvorschläge (unter anderem 2027 und TV-H KR13) bleiben identisch; die Nettoergebnisse der Messfälle sind verfügbar.

Alle 52 vollständigen Ergebnis-Hashes stimmen mit dem bisher veröffentlichten Preview-Stand überein. Zusätzlich sind die Syntaxbaum-Anweisungen der vier ursprünglichen Dienstrechner, der TV-H-Bewertung und der ursprünglichen Regelbedingungsprüfung identisch. Neue Regressionstests prüfen Inhaltsänderungen, getrennte Regelkataloge, Fehlerwiederholung, unveränderte Eingaben, begrenzte Cache-Größen sowie bezahlte Pausen und Samstagsoptionen.

Ein wiederholter Vorher-/Nachher-Lauf der ausgewählten Fassung, Oktober 2026 mit drei Diensten pro Tag; Millisekunden, gerundet:

| Tarif        | Längster Schritt Übersicht | Längster Schritt Jahres-/Netto-Vorbereitung | Übersicht nach Dienständerung | Erste vollständige Jahres-/Netto-Vorbereitung |
| ------------ | -------------------------: | ------------------------------------------: | ----------------------------: | --------------------------------------------: |
| TVöD-E/VKA   |                   166 → 54 |                                    366 → 28 |                      149 → 42 |                                     545 → 447 |
| TVAöD Pflege |                   164 → 49 |                                    276 → 51 |                      149 → 42 |                                     449 → 365 |
| TV-H KR      |                    60 → 26 |                                    198 → 31 |                      101 → 76 |                                     301 → 326 |
| TVA-L Pflege |                    52 → 11 |                                     63 → 20 |                       99 → 78 |                                     174 → 234 |

Die Werte schwanken zwischen Läufen; auch unveränderte Kontrollen schwanken. Es handelt sich um synthetische Node-CPU-Zeiten, nicht um gemessene iPhone- oder Wischzeiten. SQL-Laden, Wartezeit des Schedulers, React und native Frames sind nicht enthalten. Vorbereitete Ergebnisabfragen bleiben im Millisekundenbereich. Die bisherige Grenze des vollständigen Gehalts-Caches bleibt bestehen: ohne erfolgreichen Jahreszahlungsvorschlag wird das Gesamtergebnis nicht gespeichert, damit fehlende Daten und vorübergehende Fehler erneut geprüft werden können. Auch manuelles Gehalt und Fälle ohne automatischen Jahreszahlungsvorschlag nutzen weiterhin die vorhandenen unteren Caches. Ein nahtloser Übergang auf dem iPhone bleibt nach Installation der Preview zu bestätigen.

## Reproduzierbare Prüfung und Veröffentlichung

Ausführen im Arbeitsverzeichnis `C:\Users\veron\.codex\worktrees\monthly-analysis-performance\MediShift`. Die per SHA-256 geprüfte Vergleichsbasis und Messprotokolle liegen unter `C:\Users\veron\.codex\visualizations\2026\10\27\01a17f09-8819-7f23-9155-f6f974bff1af`.

```powershell
$performanceArtifacts = 'C:\Users\veron\.codex\visualizations\2026\10\27\01a17f09-8819-7f23-9155-f6f974bff1af'
node --require tsx/cjs scripts/benchmark-all-tariffs.cjs --compare (Join-Path $performanceArtifacts 'phase5-baseline')
node --require tsx/cjs scripts/benchmark-all-tariffs.cjs --compare (Join-Path $performanceArtifacts 'phase5-baseline') --holdout
node (Join-Path $performanceArtifacts 'phase5-verification-setup.cjs')
npm.cmd test -- src/engine/remaining-tariff-cache.test.ts src/engine/pay-conditions-cache.test.ts src/engine/tvh-assessment-cache.test.ts src/engine/simple-nursing-training-pay.test.ts src/engine/simple-vka-e-pay.test.ts src/engine/simple-tvh-kr-pay.test.ts src/engine/simple-tvh-kr-profile-pay.test.ts src/engine/simple-tval-pflege-pay.test.ts src/engine/simple-pay.test.ts src/engine/net-pay-automatic-forecast.test.ts
npm.cmd run test:components -- --runTestsByPath src/features/analysis/tvl-remuneration-hooks.component.test.tsx src/features/salary/net-pay-automatic-screen.component.test.tsx src/features/analysis/analysis-rule-coverage.component.test.tsx
node (Join-Path $performanceArtifacts 'phase5-source-gate.cjs')
npm.cmd run verify:fast
node (Join-Path $performanceArtifacts 'phase5-source-gate.cjs') --finalize
$env:APP_VARIANT = 'internal'
npx.cmd --yes eas-cli@latest update --branch preview --platform ios --environment preview --message 'Weitere Tarife: kleinere Rechenbloecke und Wiederverwendung bei Dienstaenderungen' --emit-metadata --json
node (Join-Path $performanceArtifacts 'verify-phase5-preview.cjs')
```

Messbelege: `phase5-baseline-measurement.json`, `phase5-variant-a.json`, `phase5-variant-b.json`, `phase5-comparison-final.json`, `phase5-promoted.json` und `phase5-promoted-holdout.json`. Die letzten beiden sind die ausgewählte Fassung nach Verwerfen des zusätzlichen TVöD-P-Eingriffs. `phase5-statement-verification.json` dokumentiert die unveränderten Fachanweisungen. Veröffentlichung und Gesamttests werden separat im eingefrorenen `phase5-source-manifest.json` und `phase5-preview-verification.json` festgehalten; sie ersetzen keine Geräteabnahme.
