# LUNA: zweite Textüberarbeitung

Freigabe: die Vorschläge aus dem kritischen Review mit Tabellen-IDs in kleinen Paketen umsetzen und die betroffenen Abläufe prüfen. T028 heißt ausdrücklich **Wecker**. Kein Commit, Push, Build oder OTA.

## Vertrag

- Ziel: die 30 Reviewpunkte einschließlich T028 umsetzen: eindeutigere Begriffe, weniger Wiederholungen und kürzere Einstiege. Die bisherige Vergleichstabelle bleibt als historische Grundlage erhalten.
- Grundlage: `codex/luna-copy-flows`, Basiscommit `84d23045a3525eddee4827f1daa82b806b734dbe`; 126 bereits geänderte/neue Dateien vor dieser Runde. Der vorhandene Stand bleibt erhalten.
- Plattform: iPhone. Expo `~57.0.22`; vor Änderungen mit der offiziellen SDK-57-Dokumentation abgeglichen.
- Nicht-Ziele: Berechnungen, rechtliche Regeln, Rechte, Datenbank, Speicherung, Benachrichtigungszeiten, native Konfiguration oder Abhängigkeiten verändern. Keine Veröffentlichung.
- Scope: höchstens 15 Quell-/Test-/Berichtsdateien je Paket. Gemeinsame Dateien können nacheinander zu verschiedenen Paketen gehören.
- Abnahme im Code: vorhandene relevante Verhaltensprüfungen aktualisieren und seriell ausführen; Beträge, Payloads, Rückwege, Fehler-/Abbruchfälle und Datenschutz erhalten. Anschließend `npm.cmd run verify:fast`, Diff- und Scopeprüfung sowie unabhängige Reviews.
- Geräteabnahme: geänderte Beschriftungen, große Schrift, VoiceOver, aufklappbare Details und echte Erinnerungen am neuen iPhone-Teststand prüfen. Diese Abnahme wird durch Tests nicht ersetzt und bleibt ohne freigegebenen Teststand offen.

## Pakete

| Paket | Ablauf / IDs                                | Umsetzungsscope                                                                                 |
| ----- | ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| P21a  | Wecker / T028–T030, T033                    | Erinnerungs-/Weckerauswahl und Diensteditor; betroffene bestehende Tests                        |
| P21b  | Ort übernehmen / T025–T027                  | Ortssuche und Auswahl; bestehende Tests                                                         |
| P21c  | Vorlagen-Teilfehler / T016                  | Vorlageneditor und bestehender Teilfehler-/Retrytest                                            |
| P22a  | Gehalt / T072, T081, T082, T084, T163       | Netto-Hinweise und Details; bestehende Fach-/Navigationstests                                   |
| P22b  | Auswertung / T045, T053, T062, T069, T071   | Jahres-/Monats-/Tarifhinweise und Prüfgrundlagen; bestehende Tests                              |
| P23   | Einstellungen / T106, T107, T109, T112–T116 | Prüfungseinstellungen und Informationsseiten; vorhandene Details und Tests                      |
| P24a  | Backup / T117, T122, T123                   | Backupübersicht; vorhandene Export-/Abbruch-/Wiederherstellungstests                            |
| P24b  | Einladung / T139                            | Nur redundanten Absatz nach aktivem Beitritt entfernen; Status und Weiteraktion erhalten        |
| P25a  | Systemmitteilungen / T035–T041              | Neutrale Texte kürzen; vollständige SDK-Requests, Zustellzeitpunkte und Cancel/Reconcile prüfen |
| P25b  | PDF-Prüfumfang / T170                       | Gemeinsame Umfangsformulierung; bestehende PDF-/Exportprüfungen                                 |

T011, T031, T048, T085, T095, T108, T121, T125 und T126 werden in ihrer geschützten Bedeutung beibehalten. Insbesondere enthalten Erinnerungen weiterhin keine persönlichen Titel, Orte oder Notizen.

## Nachweise

Plan, eingefrorener Ausgangsstand, Paketdifferenzen, Testprotokolle und Status je Tabellen-ID liegen im Gesprächsordner unter `implementation/P21-P25`. Ergebnisse werden nach der gemeinsamen Prüfung ergänzt.

## Ergebnis

Alle 30 freigegebenen Reviewpunkte mit 38 Tabellen-IDs sind im Code umgesetzt. T028 heißt in Auswahl und Dienstzeile wieder **Wecker**; aktiv steht dort **Zum Dienstbeginn**. Die Runde umfasst zehn Pakete mit jeweils höchstens acht Quell-/Testdateien; auch einschließlich der beiden gemeinsamen Berichte bleibt jedes Paket unter 15 Dateien. Insgesamt ändern sich 36 Quell-/Testdateien und zwei Berichte gegenüber dem eingefrorenen Stand vor dieser Runde.

- Die 277 gezielten Unit-Tests und 252 Komponententests der betroffenen Abläufe sind bestanden. Unabhängige Reviews zu allen Paketen sind ohne offene Befunde abgeschlossen.
- Der gemeinsame Lauf `npm.cmd run verify:fast` ist am 16.10.2026, 00:12 vollständig mit Exitstatus 0 bestanden: Regeln, Typecheck, ESLint ohne Warnungen, Prettier, 8.832 Unit-Tests in 450 Dateien, 1.178 Komponententests in 137 Suiten, alle 13 nachfolgenden Skriptgruppen und Diffprüfung.
- Alle 129 geänderten/neuen Dateien blieben über den erfolgreichen Gesamtlauf hashgleich. Danach wurden ausschließlich dieser Bericht und die Paketübersicht ergänzt und erneut formatiert. Nichts ist gestaged; Basiscommit und die unabhängigen Arbeitskopien bleiben unverändert.

### Zwei gezielt behandelte Details

T045 unterscheidet weiterhin zwischen laufender Jahresberechnung und abgeschlossener Berechnung mit fehlenden Grundlagen. Während des Ladens steht keine falsche Nicht-berechenbar-Meldung.

Bei T123 entfällt die zusätzliche Erklärzeile: Der Auswahlknopf **Backup-Datei auswählen** war bereits vorhanden. Ihn direkt darüber zu wiederholen wäre unnötig. Vorschau, Warnungen, Datenersatzbestätigung und Abbrechen bleiben erhalten. T139 entfernt nur den redundanten aktiven Erfolgssatz; Status, Kalendername, Bestätigungshinweis bei ausstehendem Zugriff und beide Weiteraktionen bleiben.

Der erste Gehalts-GREEN-Lauf fand einen mehrdeutigen Testselektor: **Netto-Angaben** traf zusätzlich **Netto-Angaben prüfen**. Nur dieser Selektor wurde auf die Einstellungszeile mit Steuerklassen-Zusammenfassung präzisiert. Alle Produktaktionen und Finanz-/Speicherassertions blieben erhalten. Die betroffene 40-Fälle-Suite und der anschließende Gesamtgate sind grün. Der erste Fehlerlauf, das Ein-Zeilen-Diff und die unabhängige Nachprüfung sind archiviert. Keine Grenze, kein Timeout und keine fachliche Assertion wurde gelockert.

### Vergleich und Geräteabnahme

[Umgesetzte Texte mit denselben Tabellen-IDs](C:/Users/veron/.codex/visualizations/2026/10/15/01a14034-a8b5-77b2-b0e1-6cfcd4126913/implementation/P21-P25/LUNA-Texte-umgesetzt.html) · [Status je ID als CSV](C:/Users/veron/.codex/visualizations/2026/10/15/01a14034-a8b5-77b2-b0e1-6cfcd4126913/implementation/P21-P25/implementation-by-id.csv) · [Prüfprotokoll](C:/Users/veron/.codex/visualizations/2026/10/15/01a14034-a8b5-77b2-b0e1-6cfcd4126913/implementation/P21-P25/verify-fast.log) · [iPhone-Prüfliste](C:/Users/veron/.codex/visualizations/2026/10/15/01a14034-a8b5-77b2-b0e1-6cfcd4126913/implementation/P21-P25/iPhone-Abnahme-Runde2.md).

Die ursprüngliche Vergleichstabelle und der zweite Review bleiben als historische Grundlage erhalten. Die echte iPhone-Abnahme steht weiter aus; insbesondere VoiceOver, große Schrift, Darstellung und Zustellung der neutralen Mitteilungen sind am geänderten Teststand zu prüfen. Die ursprünglichen 18 Gerätefälle für P18–P20 bleiben offen. Der tatsächliche OTA-Stand von TestFlight Build 5 ist unbekannt.

Kein Commit, Push, Build oder OTA wurde durchgeführt. Es gibt keine Änderung an Abhängigkeiten, nativer Konfiguration, Rechenregeln, Rechten oder Benachrichtigungszeiten.

Referenz vor den Änderungen: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) und [SDK-57-Mitteilungen](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/).
