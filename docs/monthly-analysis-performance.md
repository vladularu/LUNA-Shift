# Sollzeit und Monatsauswertung

## Fortsetzung: TV-L/TV-UK und Rückkehr über einen Jahreswechsel

Das neue Gerätefeedback grenzt die verbleibenden Verzögerungen auf TV-L/TV-UK und die Rückkehr aus einem anderen Jahr ein. Die zuvor veröffentlichte Preview-Gruppe `b8c692ff-ea46-45ae-acd4-50e8bce98ad0` (Update `01a18017-0986-7611-b641-288d6792b9fc`) ist mit passender Runtime und identischen Manifest-/CDN-/lokalen Bundle-Hashes verifiziert; Production blieb unverändert. Die 51 Quelldateien dieses Stands sind unter `phase4-baseline/` gesichert. Das neu gemeldete Verhalten ist noch nicht abgenommen.

Ziel: identische TV-L-/TV-UK-Ergebnisse ohne lange synchrone Monatsberechnung während des Renderns und sofortige Wiederverwendung bereits besuchter aktueller Monate nach Jahreswechseln. Nicht-Ziele bleiben native Änderungen, andere Berechnungsregeln, TestFlight und Git-Delivery. iPhone 14 Pro Max, Expo SDK 57; anschließend ausschließlich die bereits freigegebene Preview-OTA.

Wegen des Dateiumfangs drei Arbeitspakete: A) begrenzte exakte Dienst-Caches für TV-L/TV-UK, tarifgerechtes schrittweises Vorbereiten und kooperativer erster Monatsaufruf; B) höchstens drei bereits geladene Drei-Jahres-Bereiche im Arbeitsspeicher, korrekte Übernahme frischer Daten und lokaler Änderungen/Löschungen sowie Invalidierung bei vollständigem Reload; C) das aktuelle Monatsergebnis innerhalb der bestehenden Cache-Grenzen vor Verdrängung durch entfernte Monate schützen. Scope: betroffene Tarifrechner/Cache/Monatsvorbereitung, Datenbereich-Lader und Abgleich, vorhandene Monatsresultat-Caches, zugehörige Tests, Tarifvergleich und diese Dokumentation.

Abnahme lokal: vollständige Ergebnisgleichheit für TV-L und TV-UK (einschließlich Netto, Jahreszahlung, Nachtzeitgutschrift und Zeitumstellung); keine schwere Berechnung während des Renderns; Abbruch/Fehlergrenzen unverändert; Oktober → anderes Jahr → Oktober ohne erneute Bereichsabfrage und ohne verlorene Änderungen; begrenzter Speicher und korrektes Reload-/Regel-/Profil-/Datenänderungsverhalten. Erst gezielte Tests und `verify:fast`, danach Runtime-/Manifest-/CDN-Nachweis. Geräteflüssigkeit bleibt separat zu bestätigen.

### Befund und Umsetzung

Der TV-L-Familienrechner und TV-UK lasen `sectionStart.hour`, `minute` und `dayOfWeek` innerhalb jeder Minuteniteration erneut über Temporal aus. Die Datumssektion ist dabei unveränderlich. Diese Werte werden jetzt einmal pro Sektion gelesen; die individuelle Zeitumstellungs-Minutenfolge bleibt erhalten. Dienstresultate werden je Tarif und Resolver mit vollständigen Wertschlüsseln und maximal 1.024 Einträgen gehalten, getrennt nach Zuschlags-/Pausenoptionen und Netto-Zeitspur. Fehler werden nicht gespeichert. Vorbereitende Schritte verwenden dieselben Beschäftigungsperioden und dieselbe Monats-Schichtbewertung wie der vollständige Rechner. Auch der erste sichtbare Monatsaufruf läuft jetzt außerhalb des Renderns; unerwartete Nachbarfehler werden erst bei Auswahl an die bestehende Fehlergrenze weitergegeben.

Der Datenlader hält höchstens drei abgeschlossene Drei-Jahres-Bereiche und ihre Einträge. Ein bereits geladener Bereich um das aktuelle Jahr bleibt innerhalb dieser Grenze erhalten. Rückkehr in einen vorhandenen Bereich benötigt keine weitere Bereichsabfrage. Frische SQL-Ergebnisse bleiben für ihren Bereich maßgeblich; lokale Änderungen und Löschungen werden weiterhin abgeglichen. Ein ausdrücklicher vollständiger Reload verwirft die gesamte Bereichs-Wiederverwendung. Die vorhandenen 18-Monats-Resultat-Caches schützen ein aktuelles, inhaltlich exakt passendes Ergebnis vor entfernten Monaten, ohne ihre Speichergrenze anzuheben.

`scripts/benchmark-tariff-months.cjs --compare <phase4-baseline>` vergleicht komplette Monatsübersicht, Jahreszahlung und Netto mit dem zuvor veröffentlichten Stand. Alle acht Fälle (TV-L/TV-UK, ein/drei Dienste täglich, Oktober 2026/Januar 2027) liefern identische vollständige Ergebnis-Hashes. Enthalten sind zusätzlich 10.000 irrelevante historische Einträge und eine Zeitumstellungsnacht. Januar-Netto bleibt wie zuvor nach den bisherigen Jahresvoraussetzungen nicht verfügbar.

| Oktober 2026                | Monatsübersicht CPU vorher | Nachher | Vollständige Gehaltsvorbereitung vorher | Nachher |
| --------------------------- | -------------------------: | ------: | --------------------------------------: | ------: |
| TV-L, ein Dienst täglich    |                     595 ms |   87 ms |                                2.256 ms |  252 ms |
| TV-L, drei Dienste täglich  |                     759 ms |   93 ms |                                2.972 ms |  301 ms |
| TV-UK, ein Dienst täglich   |                     502 ms |   62 ms |                                1.851 ms |  216 ms |
| TV-UK, drei Dienste täglich |                     633 ms |   93 ms |                                2.293 ms |  307 ms |

Der längste Übersichtsschritt sinkt in den acht Fällen lokal von etwa 446–758 ms auf 3–13 ms; der längste Gehaltsschritt liegt nachher bei bis zu etwa 21 ms. Vorbereitete Übersichts-/Gehaltsabfragen einschließlich Schlüsselbildung liegen bei etwa 3–5 ms. Diese Node-Zeiten enthalten keine SQLite-Wartezeit, Scheduler-Pausen, React-Darstellung oder iPhone-Frames und garantieren kein hartes Zeitlimit für beliebige Eingaben. Rohdaten: [phase4-tariff-comparison-final.json](C:/Users/veron/.codex/visualizations/2026/10/27/01a17f09-8819-7f23-9155-f6f974bff1af/phase4-tariff-comparison-final.json). Die gemeinsame TV-L-Schleife ist auch für die Pflege-Ausbildung relevant; ihre bestehenden Tests laufen mit.

Ein Syntaxbaumvergleich bestätigt identische vollständige Fachanweisungen nach Rückeinsetzen der unveränderlichen Zeit-Getter: [phase4-statement-proof.json](C:/Users/veron/.codex/visualizations/2026/10/27/01a17f09-8819-7f23-9155-f6f974bff1af/phase4-statement-proof.json). 985 fokussierte Unit-Tests und 84 Komponentenprüfungen bestehen, darunter die tatsächliche Rückkehr über den Jahreswechsel ohne Bereichs-SQL, lokale Änderungen/Löschungen, vollständiger Reload, Cache-Grenzen und Fehlerweitergabe. Der abschließende Gesamtlauf und Veröffentlichungsnachweis werden unter `phase4-verify-fast.log` beziehungsweise `phase4-preview-verification.json` gesichert.

## Fortsetzung nach Gerätebericht: vollständiger Gehaltsablauf

Der Gerätebericht `LUNA-Kalender-Diagnose-1793146968792.json` bestätigt die aktive Preview-OTA `01a17fd1-4440-7d87-95ea-1e510c6f0d24`, Runtime `b99c3cf0dd56e6b1bb126d195f21c665de57760b`, `embedded: false`. Sein einzelnes Kalender-Commit-Ereignis ist keine Laufzeitmessung der Auswertung. Die Bildschirmaufnahme belegt weiterhin mehrsekündige Ladezustände. Die Geräteabnahme ist damit ausdrücklich nicht erreicht.

Ziel dieser Fortsetzung: den vollständigen Gehalts-/Nettoablauf aus dem Renderpfad der Monatsauswertung herausnehmen, doppelte Einstellungen-Ladevorgänge innerhalb einer Seite vermeiden und die tatsächlichen Auswertungsphasen opt-in auf dem Gerät erfassen. Nicht-Ziele: andere Zahlen, Fach-/Steuerformeln, native Änderungen, TestFlight oder Git-Veröffentlichung. Zielgerät und Expo SDK 57 bleiben unverändert. Die frühere Umsetzungs- und Preview-Freigabe wird ausschließlich für diesen fortgesetzten Monatswechsel-Fluss verwendet.

Arbeitspakete: A) generatorbasierte Netto-Vorbereitung mit identischen synchronen Schnittstellen für vorhandene Verbraucher; B) eine vorbereitete Gehaltsquelle je Auswertungsseite, sichere Inhalts-/Resolver-Invalidierung und Abbruch alter Anfragen; C) zahlenbasierte Messpunkte für Auswertungsanforderung, SQL-Laden, Queue-Wartezeit, Rechenschritte und Commit-Zustand. Scope: Netto-Engine/Cache/Adapter, die Auswertungsseite und Nettozeile, vorhandene Arbeitswarteschlange und Diagnoserecorder samt Tests, Benchmark und diese Dokumentation. Die Gesamtarbeit wird wegen des Dateiumfangs in diesen Paketen gehalten.

Vergleichsbasis ist der unverändert gesicherte 27-Dateien-Stand der vorherigen Preview unter `phase3-baseline/`. Messgrößen sind erste und wiederholte vollständige Netto-Vorbereitung, längster synchroner Schritt, kein schwerer Aufruf während des Renderns und Anzahl der Einstellungen-Ladevorgänge je Seite. Suchbudget: höchstens zwei Varianten dieses Ablaufs mit lokalen Normal-, Stress-, Fehler- und Jahreswechselfällen. Abnahme: vollständige Ergebnisgleichheit, Profil-/Monats-/Regelwechsel, unveränderte Fehler-/Sonderzahlungssemantik, Inhaltsgleichheit frisch geladener Objekte ohne Render-Rückkopplung, keine veralteten Ergebnisse, fokussierte Tests und `verify:fast`. Gerätezeiten werden erst mit passender neuer Preview und den neuen Auswertungsereignissen bewertet.

### Umsetzung und lokale Nachweise der Gehaltsvorbereitung

Die Auswertungsseite lädt Netto-Einstellungen einmal und übergibt ihrer Nettozeile ein fertiges Modell. Jahressonderzahlung und vollständiges Netto werden außerhalb des Renderns in derselben priorisierten Warteschlange wie die übrige Monatsvorbereitung berechnet. Der sichtbare Monat erhält Vorrang; Nachbarmonate bereiten ihre Ergebnisse vor. Monats-, Profil-, Eingabe- oder Regelwechsel brechen alte Aufträge ab. Frische, inhaltlich gleiche SQL-Objekte starten denselben Auftrag nicht erneut. Vollständige verfügbare Ergebnisse bleiben begrenzt wiederverwendbar; fehlgeschlagene Berechnungen werden nicht dauerhaft als gültiges Ergebnis gespeichert.

Die alten synchronen Gehalts-Schnittstellen bleiben erhalten. Die SFN-Zuordnung gibt nach einzelnen Diensten ab; absolute Minuten einer Zeitumstellungsnacht werden in Paketen von 32 vorbereitet. Fachprüfungen, Reihenfolge, genaue Bruchteile, Rundung und Fehlertexte bleiben erhalten. Die Cache-Schlüssel verwenden die vorhandenen Monats-/Tarifselektoren für alle möglichen Jahresreferenzmonate und den gewünschten Nettomonat. Dadurch entfällt die wiederholte vollständige Serialisierung irrelevanter historischer Einträge. Die unterschiedlichen bisherigen Sonderzahlungsquellen für Brutto (gesamte gespeicherte Timeline) und Netto (Einstellungen) bleiben ausdrücklich erhalten.

`scripts/benchmark-analysis-salary.cjs --compare <phase3-baseline>` vergleicht vollständige Jahres-/Nettoresultate mit dem tatsächlich zuvor veröffentlichten JS-Stand und dessen unveränderter Git-Basis. Alle 18 Fälle (Normalplan, dichter überschneidungsfreier Plan, Fehler-Stressplan; September bis November; 2026/2027) liefern dieselben vollständigen SHA-256-Ergebnis-Hashes. Jeder Plan enthält zusätzlich 10.000 irrelevante historische Einträge. Der dichte Plan hat bis zu 93 Dienste je Monat und in 2026 ein verfügbares Netto. Der Fehler-Stressplan enthält Überschneidungen; die 2027-Prognosen bleiben nach denselben bisherigen Voraussetzungen nicht verfügbar.

| Vollständiger verfügbarer Ablauf 2026 | Wiederholter Aufruf vorher | Vorbereiteter Aufruf nachher | Erste CPU-Berechnung nachher |
| ------------------------------------- | -------------------------: | ---------------------------: | ---------------------------: |
| Normalplan, September bis November    |                   41–46 ms |                   2,5–3,1 ms |                   226–250 ms |
| Bis zu 93 Dienste je Monat            |                   46–53 ms |                   4,8–6,9 ms |                   620–789 ms |

Diese Werte enthalten Schlüsselbildung, Brutto, Jahreszahlung und Netto, aber keine SQLite-Wartezeit, Scheduler-Pausen, React-Darstellung oder iPhone-Frames. Die erste Berechnung bleibt Arbeit und wird vor einem Wechsel schrittweise vorbereitet. Ein einzelner synchroner Schritt erreichte lokal noch etwa 24 ms beim Normalplan, 59 ms beim dichten Plan und 68 ms beim Fehler-Stressplan. Die Vier-Millisekunden-Queuegrenze unterbricht solche Einzelschritte nicht; eine durchgehend nahtlose erste oder sehr schnelle unvorbereitete Navigation ist daher noch nicht durch diese Messung bewiesen. Rohdaten: [phase3-salary-comparison-final.json](C:/Users/veron/.codex/visualizations/2026/10/27/01a17f09-8819-7f23-9155-f6f974bff1af/phase3-salary-comparison-final.json).

Ein TypeScript-Syntaxbaumvergleich bestätigt identische Fachanweisungen für die komplette automatische Nettofunktion, die komplette SFN-Klassifizierung, Sonderzahlungs-Overrides und die Referenzmonatssumme nach Entfernung der Scheduling-Anweisungen: [phase3-statement-proof.json](C:/Users/veron/.codex/visualizations/2026/10/27/01a17f09-8819-7f23-9155-f6f974bff1af/phase3-statement-proof.json). Zeitumstellungsminuten, Inhalte/Invalidierung, Abbruch, vorbereitete Nachbarn, SQL-Dopplung und opt-in Messung sind zusätzlich durch fokussierte Unit-/Komponententests abgedeckt.

### Gezielte Geräteaufnahme nach dieser Preview

Unter „Mehr“ heißt die bestehende lokale Messung jetzt „Performancediagnose starten“. Schema 2 erfasst `analysis-request`, `analysis-view`, Commit-Bereitschaft, Schlüsselvorbereitung, Gehaltseinstellungen, Cachetreffer und Warteschlangenarbeit. Queue-Dauer enthält Wartezeit, `wait` die Zeit bis zum ersten Schritt, `cpu` die Summe der Schritte und `maximum` deren längste Dauer. Stufen: 1 Übersicht, 2 Arbeitszeitprüfung, 3 Jahreszahlung und vollständiges Netto. `analysis-lag` ist die Verzögerung eines JS-Timers, keine native Frame-/Touchmessung. Ohne ausdrücklich gestartete Diagnose läuft kein zusätzlicher Intervalltimer. Begrenzung, numerische Whitelist, App-/Update-ID und Löschung beim Neustart bleiben erhalten.

Gerätetest: neue Preview übernehmen; unter „Mehr“ Diagnose starten; zur Auswertung wechseln; kurz warten und mehrmals zwischen einem dicht belegten Monat und beiden Nachbarn wischen; über „Diagnosebericht teilen“ exportieren. Die Datei heißt `LUNA-Performance-Diagnose-….json`. Bericht und optionales Bildschirmvideo sind zusammen mit der neuen Update-ID auszuwerten. TestFlight, nativer Build und Git-Delivery bleiben ausgeschlossen. Die vollständigen Projektgates und die Veröffentlichungsbelege werden unter `phase3-verify-fast.log` und `phase3-preview-verification.json` gesichert; eine erfolgreiche Veröffentlichung ist weiterhin keine Geräteabnahme.

## Fortsetzung: vorbereitete Monatswechsel

Freigabe am 28.10.2026: Engpässe prüfen, nahtlosen Monatswechsel bei vielen Einträgen optimieren, Berechnungsergebnisse erhalten und anschließend ausschließlich Preview-OTA veröffentlichen. Kein TestFlight, nativer Build oder Git-Delivery-Schritt.

Zielgerät bleibt iPhone 14 Pro Max, Expo SDK 57. Die vorherige Preview-Gruppe `f19afa7f-7d6d-44c6-91fe-167942e9d5fa` ist die Vergleichsbasis. Die bisherige Umsetzung und alle unabhängigen Checkout-Arbeiten bleiben erhalten.

Drei begrenzte Arbeitspakete: (A) vollständige Monatsresultate mit exakten Inhalten und kompletten Bewertungsfenstern wiederverwenden; (B) Nachbarseiten und Arbeitszeitprüfung über eine gemeinsame priorisierte Warteschlange vorbereiten; (C) lange Prüfungsschritte kooperativ aufteilen und die kombinierte Fassung auf Ergebnisgleichheit prüfen. Scope: Monatsanalyse/Cache, ihre Hooks und Komponentenprüfungen, kooperativer Scheduler, betroffene Generator-Schritte, reproduzierbarer Vergleich und diese Dokumentation. Native Pagersteuerung, Fachformeln und Datenbankschema bleiben erhalten. Bei mehr als 15 Dateien bleibt die Umsetzung in diesen Arbeitspaketen getrennt.

Messung: erster und wiederholter Monatsaufruf, maximale synchrone Generator-Schritte sowie vorbereitete Wechsel bei Normal- und Stressplänen mit zusätzlich 10.000 historischen Einträgen. Suchbudget: diese drei Hypothesen, höchstens drei Umsetzungsvarianten, lokale synthetische Daten, keine externen Datenänderungen. Abnahme: vollständige Ergebnisgleichheit einschließlich Nachbar-/Vorjahresabhängigkeiten, korrekte Invalidierung, begrenzter Speicher, Abbruch veralteter Arbeit, vorbereitete Prüfungen und Wisch-/Periodenregressionen; fokussierte Tests und `verify:fast`. Tatsächliche iPhone-Flüssigkeit bleibt bis zum anschließenden Preview-Test offen.

### Umsetzung und Vergleich dieser Fortsetzung

- Paket A: vollständige Resultate für 18 Monate je Resolver, exakte Inhaltsschlüssel aus den gesamten rechtlichen und tariflichen Bewertungsfenstern, kopierte eingefrorene Resultate ohne Einfrieren der Eingaben. Gemeinsame Eintragssnapshots erhalten die Intervall-Wiederverwendung zwischen Nachbarmonaten. Ohne vollständiges Gehalt werden nur gültige Zeitresultate geteilt; fehlende oder fehlerhafte Gehaltsdaten bleiben erneut berechenbar.
- Paket B: Nachbarmonate werden außerhalb des Renderns vorbereitet, einschließlich der vollständigen Arbeitszeitprüfung. Fertige Prüfungen bleiben über das Aushängen einer Pagerseite hinaus erhalten. Eine gemeinsame Warteschlange gibt dem sichtbaren Monat Vorrang, verarbeitet maximal 32 Schritte beziehungsweise vier Millisekunden je Durchlauf und bricht überholte Aufträge ab. Sichtbare Arbeit wartet nicht auf einen Idle-Callback. Ein bereits laufender einzelner Schritt kann weiterhin länger als vier Millisekunden dauern. Der bisher sichtbare Monat behält seine fertige Vorschau, wenn er zur Nachbarseite wird.
- Paket C: Monatsstunden und Diensttypen geben nach einzelnen Tagen ab; TVöD-Zuschläge wärmen denselben bestehenden Cache je Dienst vor. Arbeitszeit-Prüfungen geben nach Tagesgruppen ab, die Intervallvorbereitung verwendet kleinere Pakete, und Ersatzruhetag-Kandidaten werden schrittweise aufgebaut. Fachanweisungen, Rundung, Bewertungszeiträume und Reihenfolge der Findings bleiben erhalten. Netto-Jahreszahlungen behalten bei unveränderter Datenbasis dieselbe Referenz und lösen dadurch keine unnötigen Jahresprognosen aus.

Reproduzierbar mit `node --require tsx/cjs scripts/benchmark-month-transition.cjs --compare 6b571f85d453c09ea50756e13299231e0883bda4`. Der getrennte Referenzprozess lädt die ursprünglichen Monats-/Prüfungsfunktionen aus Git und verwendet die bereits geprüften vorherigen Sollzeit-/Gehaltsoptimierungen. Verglichen werden vollständige Monatsübersichten und Prüfergebnisse per SHA-256. Alle vier Fälle waren identisch. Je Fall fünf Aufrufe, identische Daten mit 10.000 zusätzlichen historischen Einträgen:

| Plan   | Jahr | Monat wiederholt vorher | Nachher | Längster Prüfschritt vorher |  Nachher |
| ------ | ---- | ----------------------: | ------: | --------------------------: | -------: |
| Normal | 2026 |                11,80 ms | 1,74 ms |                    27,18 ms |  6,89 ms |
| Stress | 2026 |                35,67 ms | 2,59 ms |                    47,79 ms |  8,46 ms |
| Normal | 2027 |                10,85 ms | 3,19 ms |                    21,19 ms |  7,20 ms |
| Stress | 2027 |                36,32 ms | 5,53 ms |                    40,81 ms | 10,38 ms |

Die vorbereitende Monatsübersicht wurde zusätzlich mit frischem Resolver schrittweise gemessen; der längste einzelne Schritt lag in diesen vier Fällen bei etwa 1,6–6,2 ms. Die gesamte erste Berechnung wird dadurch nicht kostenlos: unter Last wird sie vor dem Wechsel in Abschnitten vorbereitet. Diese Node-Messungen enthalten keine SQLite-Latenz, React-Darstellung, native Frames oder iPhone-Zeiten und garantieren keine maximale Laufzeit für beliebige Pläne oder andere Tarifzweige.

Rohdaten und vollständige Hashes: [phase2-comparison-final.json](C:/Users/veron/.codex/visualizations/2026/10/27/01a17f09-8819-7f23-9155-f6f974bff1af/phase2-comparison-final.json). Geräteabnahme bleibt nach Veröffentlichung der zugehörigen Preview-Gruppe offen.

### Abschließende lokale Abnahme am 28.10.2026

- `npm.cmd run verify:fast` vollständig bestanden: 496 Unit-Testdateien / 9.761 Tests, 156 Komponenten-Testdateien / 1.448 Tests und alle weiteren Projektprüfungen. Finales Protokoll: [phase2-verify-fast.log](C:/Users/veron/.codex/visualizations/2026/10/27/01a17f09-8819-7f23-9155-f6f974bff1af/phase2-verify-fast.log).
- Die vollständige Prüfung hat zwei zusätzliche Randfälle abgesichert: Bereits tief eingefrorene Gehaltsresultate bleiben zwischen Übersicht und Gehaltsdetails geteilt; frisch geladene, inhaltlich gleiche Anfragen erzeugen keine Render-Rückkopplung, auch bei noch fehlenden Gehaltsdaten. Beide Fälle haben Regressionstests. Zwischenläufe liegen getrennt in den gleichnamigen `initial`, `identity` und `equivalent-input`-Protokollen.
- Letzte Vergleichswiederholung mit identischen vollständigen Ergebnis-Hashes: [phase2-comparison-release.json](C:/Users/veron/.codex/visualizations/2026/10/27/01a17f09-8819-7f23-9155-f6f974bff1af/phase2-comparison-release.json). Die wiederholten Monatsaufrufe lagen in den vier Fällen bei etwa 2,6–6,4 ms, die längsten Prüfschritte bei etwa 7,7–12,3 ms. Das sind lokale CPU-Messungen; keine iPhone-Frame- oder Ladezeiten.
- Der TypeScript-Parser bestätigt, dass die Fachanweisungen für Monatsstunden, Diensttypenaufteilung und tägliche Arbeitszeitprüfung nach Entfernung der neuen Yield-Anweisungen identisch sind: [phase2-statement-proof.json](C:/Users/veron/.codex/visualizations/2026/10/27/01a17f09-8819-7f23-9155-f6f974bff1af/phase2-statement-proof.json).
- Gesamtumfang einschließlich der bereits veröffentlichten ersten Pakete: 27 Dateien, davon 15 produktive Dateien, acht Testdateien, drei Benchmarks und diese Dokumentation. Acht Dateien aus dem vorherigen Stand bleiben per SHA-256 unverändert. Native Pagersteuerung, Abhängigkeiten und native Konfiguration wurden nicht geändert.
- Vorschau-Ziel: iOS-Preview-Build 44, `APP_VARIANT=internal`, Kanal/Branch/Environment `preview`, Runtime `b99c3cf0dd56e6b1bb126d195f21c665de57760b`. Git-Delivery, nativer Build und TestFlight bleiben separat. Die neue Preview-Gruppe und Manifest-/CDN-Prüfsummen werden im Veröffentlichungsnachweis gespeichert; die Geräteabnahme bleibt offen.

## Task-Vertrag

- Ziel: identische Berechnungsergebnisse mit weniger wiederholter Sollzeitberechnung und einer priorisierten sichtbaren Monatsauswertung.
- Nicht-Ziele: Änderungen an Tarifformeln, Rundung, Steuerberechnung, Auszahlungslogik, Startkonfiguration, Datenbank oder Synchronisierung; keine Veröffentlichung.
- Plattform: iOS, Zielgerät iPhone 14 Pro Max, Expo SDK 57 (`~57.0.31`).
- Basis: `6b571f85d453c09ea50756e13299231e0883bda4`, Branch `codex/monthly-analysis-performance`.
- Paket 1: `src/engine/working-time-target.ts`, begrenzter Cache in `src/engine/working-time-target-cache.ts`, fokussierte Cache-/Ergebnisgleichheitstests.
- Paket 2: `src/features/analysis/analysis-screen.tsx`, `use-monthly-compliance.ts`, zugehörige Komponenten-/Leistungstests. Vorbereitete Pagerseiten und native Wischbewegung erhalten.
- Fortsetzung nach „weiter und später OTA“: Paket 3 teilt die Referenzberechnung der Jahressonderzahlung auf Grundlage des bestehenden Monatsbrutto-Caches. Zusätzlicher Scope: `annual-salary-proposal.ts`, `annual-salary-proposal-cache.ts` samt Tests und `scripts/benchmark-salary-calculations.cjs`. Berechnungsformeln und Netto-Steuerlogik bleiben unverändert. Gesamtumfang 13 Dateien, in drei getrennten Arbeitspaketen; OTA bleibt zurückgestellt.
- Abnahme lokal: unveränderte Minuten, Rundungen, Summen und Prüfergebnisse; korrekte Cache-Invalidierung bei anderen Monaten, Profilen, Kontexten und Regelkatalogen; keine veralteten Ergebnisse nach Änderungen; weniger Idle-Aufrufe; Pager-Regressionstests; fokussierte Tests und `npm.cmd run verify:fast`.
- Geräteabnahme offen: Wischen, Monatswechsel und Neuberechnung auf dem iPhone mit dokumentierter Build-/Update-ID. Lokale Tests ersetzen diesen Nachweis nicht.
- Commit, Push, Build, OTA, Merge und Store-Veröffentlichung: nicht freigegeben.

## Umsetzung und Nachweise

### Paket 1: identische Sollzeit wiederverwenden

Ein begrenzter Cache speichert bis zu 48 Monatsresultate je Regelkatalog. Sein Wertschlüssel enthält Monat, Region, Wochenminuten, vollständige Sollzeit-Metadaten und den tatsächlich verwendeten Kontext. Dadurch nutzen Tages-/Monatssumme und Diensttypenaufteilung dasselbe eingefrorene Ergebnis. Änderungen an wiederverwendeten Kontextobjekten werden durch den Wertschlüssel erkannt. Validierung und Lade-/Fehlerprüfungen erfolgen weiterhin vor dem Cachezugriff. Formeln, Rundung und Anspruchsvoraussetzungen wurden nicht verändert.

Fokussierte Tests prüfen gleiche Eingaben, veränderte Beschäftigungsperioden und endgültige Dienstplanfakten, andere Monate/Regionen, Regelkatalogwechsel, Lade-/Fehlerzustände und die Speicherbegrenzung.

### Paket 2: sichtbaren Monat priorisieren

Die native Pagerimplementierung bleibt unverändert. Die aktuelle Seite verwendet neue Eingaben sofort. Nachbarseiten erhalten ihre neuen Berechnungsgrundlagen über Reacts `useDeferredValue`, sodass ihre Vorschauen im Hintergrund vorbereitet bleiben. Ihre vollständige Arbeitszeitprüfung startet erst bei Auswahl; bereits fertige passende Ergebnisse bleiben beim Zurückwischen erhalten.

Der Monatsprüfungs-Hook bündelt kurze Generator-Schritte innerhalb von vier Millisekunden und höchstens 32 Schritten. Er verändert weder Reihenfolge noch Inhalt der Prüfung. Bei Daten-/Regelwechsel oder ausgeblendeter Seite wird ausstehende Arbeit abgebrochen. Die Zeitgrenze unterbricht keinen einzelnen bereits laufenden Schritt; lange Einzelschritte bleiben ein möglicher Folgepunkt.

Komponentenprüfungen decken aktuelle sichtbare Daten, vorbereitete Nachbarseiten, native Monats-/Jahreswechsel, Schritt-/Zeitgrenzen, Abbruch und Wiederverwendung fertiger Prüfungen ab.

### Lokaler Vergleich gegen die Basis

Reproduzierbar mit:

```powershell
node --require tsx/cjs scripts/benchmark-monthly-analysis.cjs --compare 6b571f85d453c09ea50756e13299231e0883bda4
```

Der Vergleich lädt die ursprüngliche Sollzeit-Engine in einem separaten Node-Prozess. Vollständige Monatssumme, Diensttypenaufteilung und Sollzeitledger werden per SHA-256 verglichen. Alle vier Fälle waren identisch. Sieben Zeitstichproben je Fall, jeweils für Juli:

| Synthetischer Plan | Jahr | Median vorher | Median nachher |
| ------------------ | ---- | ------------: | -------------: |
| Normal             | 2026 |      31,27 ms |       11,42 ms |
| Stress             | 2026 |      50,94 ms |       36,27 ms |
| Normal             | 2027 |      26,27 ms |       10,90 ms |
| Stress             | 2027 |      50,10 ms |       36,04 ms |

Die Zahlen messen nur die Monatszeitberechnung einschließlich Diensttypenaufteilung unter Node. Gehalt, React-Rendering, Datenbank, Idle-Wartezeiten und iPhone-Wischbewegung sind nicht enthalten. Es sind keine Geräte-Ladezeiten.

### Lokale Abnahme der Pakete 1 und 2

- `npm.cmd run verify:fast`: am 27.10.2026 bestanden. 492 Unit-Testdateien / 9.734 Tests, 155 Komponenten-Testdateien / 1.441 Tests, alle zusätzlichen Projektprüfungen und `git diff --check` grün.
- Der vollständige Lauf verwendete die frisch aus dem Lockfile installierten Worktree-Abhängigkeiten und `VITEST_MAX_WORKERS=1`. Der lokale Graft-Graph wurde aktualisiert.
- Vergleich gegen die Basis: alle vier vollständigen Ergebnis-Hashes identisch; siehe obige Messwerte. Kein Nachweis einer bestimmten Ladezeit auf dem iPhone.
- Scope: neun Dateien, davon vier produktive Dateien (Sollzeit-Engine/Cache, Auswertung, Prüfungs-Hook), drei Testdateien, ein reproduzierbarer Benchmark und diese Dokumentation. Formeln und native Pagerimplementierung unverändert.
- Vollständiges Gate-Protokoll: [performance-verify-fast.log](C:/Users/veron/.codex/visualizations/2026/10/27/01a17f09-8819-7f23-9155-f6f974bff1af/performance-verify-fast.log).
- Geräteabnahme bleibt offen: gefühlte Reaktionszeit, Wischen und die vollständige reale Neuberechnung auf dem iPhone 14 Pro Max. Ein später separat freigegebenes Preview-Update beziehungsweise ein passender Testlauf ist dafür erforderlich.
- Kein Commit, Push, Merge, EAS Build, OTA oder Store-Schritt ausgeführt. Die Änderungen bleiben lokal auf `codex/monthly-analysis-performance` erhalten.

### Paket 3: Referenzberechnung der Jahressonderzahlung teilen

Die bestehende Monatsbrutto-Berechnung bleibt die gemeinsame Basis. Eine begrenzte Wiederverwendung auf Ebene der Jahresprognose vermeidet, dass Übersicht, Nettozeile und Export dieselben Referenzmonate erneut vorbereiten. Pro Regelkatalog werden höchstens zwölf vollständige Vorschläge im Arbeitsspeicher gehalten. Der Wertschlüssel berücksichtigt Jahr, vollständiges Arbeitsprofil einschließlich Historie, Einträge, Zulagenentscheidungen und Arbeitsmuster. Frisch geladene Objekte mit identischem Inhalt teilen das Ergebnis; inhaltliche Änderungen auch ohne neue Revision führen zur Neuberechnung.

Die vorhandenen Anspruchsprüfungen laufen vor dem Cachezugriff. Nicht unterstützte Jahre, eigene Vergütung, nicht abgedeckte Tarifgruppen, Konfliktprofile und Testdaten lesen oder serialisieren daher keine Einträge für einen Cache-Schlüssel. Fehlende oder fehlgeschlagene Vorschläge werden nicht gespeichert. Eigene gespeicherte Sonderzahlungen bleiben außerhalb dieser Wiederverwendung und wirken sofort. Das gespeicherte Ergebnis und seine Referenzmonate sind eingefroren; Eingabeobjekte werden nicht eingefroren oder verändert.

Die vorhandenen Anspruchsprüfungen und sämtliche Anweisungen der Referenzmonatsberechnung wurden über den TypeScript-Parser mit der ursprünglichen Funktion aus `6b571f85d453c09ea50756e13299231e0883bda4` verglichen und sind unverändert. Der Cache umschließt ausschließlich die Referenzmonatsberechnung nach erfolgreicher Anspruchsprüfung. Nachweis: [performance-salary-statement-proof.json](C:/Users/veron/.codex/visualizations/2026/10/27/01a17f09-8819-7f23-9155-f6f974bff1af/performance-salary-statement-proof.json). Der zusätzliche Benchmark vergleicht Monatsbrutto, Vorschlag und Zahlungsergebnis einschließlich vollständiger Ergebnis-Hashes:

```powershell
node --require tsx/cjs scripts/benchmark-salary-calculations.cjs --compare 6b571f85d453c09ea50756e13299231e0883bda4
```

Der synthetische Ablauf bereitet Übersicht und Netto-Grundlagen für drei Monate vor. Sieben Stichproben je Fall, Median:

| Plan   |   Vorher | Nachher |
| ------ | -------: | ------: |
| Normal |  6,44 ms | 4,87 ms |
| Stress | 11,90 ms | 9,37 ms |

Alle Ergebnis-Hashes waren identisch. Der erste Aufruf blieb in derselben Größenordnung (Normal etwa 220/221 ms, Stress etwa 794/789 ms); daraus folgt kein belastbarer Kaltstartgewinn. Die Messung erfasst CPU-Arbeit unter Node, keine iPhone-Ladezeit, keine vollständige Netto-Steuerberechnung und kein Rendering. Das zusätzliche Paket verbessert wiederholte Vorbereitung; es löst keine native Update-Wartezeit. Rohdaten: [performance-salary-benchmark.json](C:/Users/veron/.codex/visualizations/2026/10/27/01a17f09-8819-7f23-9155-f6f974bff1af/performance-salary-benchmark.json).

Die 32 fokussierten Tests decken gemeinsame Nutzung, geänderte Referenzdienste und Profile, Arbeitsmuster/Zulagen, Regelkatalogwechsel, Testdaten, ungelöste Gehaltsgrundlagen, vorübergehende Fehler, eigene Zahlungsbeträge und die Speicherbegrenzung ab. Fünf zusätzliche Profilfälle bestätigen, dass ohne verfügbare automatische Prognose keine Einträge für den Cache gelesen werden.

### Kombinierte lokale Abnahme aller drei Pakete

- `npm.cmd run verify:fast`: am 27.10.2026 vollständig bestanden. 493 Unit-Testdateien / 9.748 Tests, 155 Komponenten-Testdateien / 1.441 Tests und alle weiteren Projektprüfungen grün.
- Finales Protokoll: [performance-verify-fast-salary.log](C:/Users/veron/.codex/visualizations/2026/10/27/01a17f09-8819-7f23-9155-f6f974bff1af/performance-verify-fast-salary.log). Ein Zwischenlauf wurde für die Vorverlagerung der Anspruchsprüfungen angehalten und danach vollständig neu ausgeführt; er liegt getrennt als `performance-verify-fast-salary-intermediate.log` vor.
- Gesamtumfang: 13 Dateien, davon sechs produktive Dateien, vier Testdateien, zwei reproduzierbare Benchmarks und diese Dokumentation.
- Alle acht Code-, Test- und Benchmarkdateien aus den bereits geprüften Paketen 1/2 sind anhand ihrer gespeicherten SHA-256-Werte unverändert bestätigt. Das zusätzliche Paket ergänzt nur die Sonderzahlungs-Vorbereitung und ihre Nachweise.
- Berechnungsanweisungen und geprüfte Ergebnis-Hashes stimmen mit der Basis überein. Die Messungen belegen lokale CPU-Verbesserungen, keine bestimmte Ladezeit oder flüssige Wischbewegung auf dem iPhone.
- Kein Commit, Push, Merge, EAS Build, OTA oder Store-Schritt ausgeführt. Der kombinierte Stand bleibt lokal auf `codex/monthly-analysis-performance` erhalten.
- Geräteabnahme und spätere Preview-Veröffentlichung bleiben offen beziehungsweise zurückgestellt.
