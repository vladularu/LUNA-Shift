# TV-L/KR: Sollzeit 2026–2027

## Auftrag

Ziel: TV-L/KR mit §-43-Bezug in der gemeinsamen Sollzeit-Engine anbinden. Vorhandene Wochenminuten, Feiertagsort, Sonn-/Feiertagsangabe, datierte Gehalts-/Beschäftigungsprofile und bestätigte historische Abweichungen verwenden. Plattform: gemeinsame TypeScript-Logik und bestehende interne iOS-Preview. Keine neue Oberfläche oder native Änderung; zusätzliche Tagesformulare entstehen nicht.

Nicht-Ziele: TV-H, TV-UK, Ausbildung, E/SuE, AVR/DRK, neue Gehalts-/Zuschlagsformeln, Zeitkonto oder FZA-Buchungen. Vertragsstunden werden nicht aus einer Vollzeit-Gehaltsbasis überschrieben.

Dateiscope: drei Domain-Dateien working-time-target.ts, working-time-target-validation.ts und saved-working-time-target.ts; Engine, Regelregister, Berechnungsprofil und neuer TV-L-Test; bestehendes Einstellungs-Formmodell, Backup-Test sowie diese Dokumentation, Quellenmatrix und Integrationsdokumentation. Zusätzlich der bestehende PDF-Renderer und die bereits aufklappbare Arbeitszeiterklärung mit ihrem vorhandenen Komponententest für denselben kurzen Planungsvorbehalt. Insgesamt 15 Dateien. Die Einstellungs-Formmodellprüfung liegt in der neuen TV-L-Testdatei.

Der bisherige Erklärungstext wird bei TV-L innerhalb derselben geschlossenen Aufschlüsselung ersetzt, ohne zusätzliche Karten, Menüs oder Abfragen. Zielgerät ist das iPhone mit bestehender interner Preview-Runtime. Für diesen geänderten Text bleibt ein konkreter Gerätenachweis erforderlich; frühere Kalender-/BT-B-Rückmeldungen gelten nicht als neue TV-L-Abnahme.

Abnahme: eigene versionierte Quellen und IDs, normale/Sondermonate mit unabhängigen Handwerten, Gegenprobe Feiertag gearbeitet gegenüber qualifiziert planfrei, automatische Prognose getrennt von bestätigten Ansprüchen, Historie/Teilzeit/Region, Backup-Rundlauf und gemeinsame Monats-/Jahres-/Exportwerte. K-Referenz 146:18 und bestehende BT-B-Ergebnisse bleiben erhalten. Typecheck, ESLint, Tests, verify:fast, Exporte und sieben PR-CI-Gates. Commit, Push, PR, Merge nach CI und interne Preview sind durch den Nutzer freigegeben; Beta/Production sind eigene spätere Schritte.

## Quellenprüfung am 26.10.2026

- [TdL-Lesefassung, ÄTV 14 vom 14.02.2026](https://www.tdl-online.de/fileadmin/downloads/TV-L/260812_TV-L__i.d.F._des_%C3%84TV_Nr._14_VT_neu.pdf), § 43 Nr. 1 und Nr. 3 zu § 6 Abs. 3, Druckseiten 81–82: Geltung für nichtärztliche Beschäftigte im beschriebenen Klinik-/Einrichtungskreis. Sondertage 24./31.12. betreffen Ausfallstunden bzw. eigenen Ausgleich. Feiertagsarbeit und qualifiziert planmäßig freie Werktagsfeiertage haben unterschiedliche Folgen.
- [Amtliche Wiedergabe § 43 TV-L, Bayern](https://www.gesetze-bayern.de/Content/Document/TV_L-43), Nr. 3 Ziffer 2: Satz 8 setzt sieben Tage abdeckenden Schichtplan, planfrei unabhängig vom Feiertag und anderweitig zu erfüllende Wochenzeit voraus. Satz 4 bis 7 betrifft stattdessen tatsächliche Feiertagsarbeit und gesonderten Ausgleich. Samstag ist ein Werktag; Sonntag liefert keinen Satz-8-Abzug.
- [BAG 17.11.2016, 6 AZR 465/15](https://www.bundesarbeitsgericht.de/entscheidung/6-azr-465-15/), insbesondere Rn. 16–18: konkreter FZA bei Feiertagsarbeit, keine Ersetzung durch den automatischen TVöD-Sollzeitmechanismus. Der eigene Adapter schließt eine pauschale bestätigte Fünftelverminderung bei Feiertagsarbeit aus. Er bucht keinen FZA.
- [ÄTV 14 mit zeitlich gestaffelten Änderungen](https://www.tdl-online.de/fileadmin/downloads/TV-L/%C3%84nderungstarifvertr%C3%A4ge/%C3%84TV_Nr._14_zum_TV-L.pdf), §§ 5–7: Änderungen im Juli 2026 betreffen unter anderem Überstunden/Zulagen. Für Universitätskliniken Ost ändert sich 2027 die tarifliche Vollzeitbasis auf 39,5 Stunden. Die hier verwendeten Feiertagstatbestände ändern sich dadurch nicht. Individuelle Vertragsminuten und eine etwaige datierte Änderung bleiben führend; keine automatische Umdeutung fester Teilzeitstunden oder eines unbekannten Prozentvertrags.

Prüfdeckung: 01.01.2026–31.12.2027, Quellenversion 2026-02-14; keine Behauptung eines Tarifendes danach. Unbekannte Versionen/Jahre erhalten keine bestätigten Tarifabzüge. Entgelttabelle, Arbeitsort oder Berufsbezeichnung allein bestätigen nicht den individuellen Geltungsbereich.

## Prognose und Anspruch

Die bestehende FORECAST-Rechnung bleibt unabhängig von eingetragenen Diensten. Für den TV-L-§-43-Bezug ist der Fünftel-Planwert ausdrücklich eine gleichmäßige Referenz für den hypothetischen Fall qualifiziert dienstplanmäßig freier Feiertage. Er ist kein behaupteter Anspruch bei Feiertagsarbeit; jede solche Zeile bleibt PROFILE_ESTIMATE und das Ergebnis PROVISIONAL. Die Bedingung wird in der vorhandenen Aufschlüsselung genannt. Keine zusätzlichen Fragen.

Die getrennte ROSTER-Rechnung prüft dagegen die nachgewiesenen Umstände: Bei bestätigter Feiertagsarbeit kein Fünftelabzug und ein Hinweis auf getrennten Ausgleich. Bei bestätigtem planfrei mit anderweitiger Wochenerfüllung ein Fünftel. Unbekannt, bloß leerer Kalender oder Freistellung nur wegen des Feiertags bestätigen diesen Anspruch nicht. Arbeit am 24./31.12. erzeugt ebenfalls keinen fiktiven Sollabzug oder Iststunden.

## Unabhängige Kontrollwerte

Hessen, ausdrücklich vereinbarte 38,5 Stunden = 2.310 Minuten, Referenztag 462 Minuten. Kalenderzählung und Tarifbedingungen liefern die Handwerte; keine Erwartungswerte aus dem Algorithmus:

| Fall                                                                               | Rechnung           | Soll   |
| ---------------------------------------------------------------------------------- | ------------------ | ------ |
| Juli 2026, ohne Sondertage                                                         | 23 × 462           | 177:06 |
| Oktober 2026, 03.10. qualifiziert planfrei                                         | 22 × 462 − 462     | 161:42 |
| Oktober 2026, 03.10. gearbeitet; FZA getrennt                                      | 22 × 462           | 169:24 |
| Dezember 2026, 25./26. qualifiziert planfrei, 24./31. je 462 Ausfallminuten        | 23 × 462 − 4 × 462 | 146:18 |
| Dezember 2026, 25./26. gearbeitet, 24./31. je 462 Ausfallminuten                   | 23 × 462 − 2 × 462 | 161:42 |
| Dezember 2026, alle vier Tage gearbeitet; FZA getrennt                             | 23 × 462           | 177:06 |
| Dezember 2026, fest Mo–Fr und 24./31. freigestellt                                 | 23 × 462 − 3 × 462 | 154:00 |
| Mai 2027, alle vier Werktagsfeiertage qualifiziert planfrei                        | 21 × 462 − 4 × 462 | 130:54 |
| Juli 2027, ohne Sondertage                                                         | 22 × 462           | 169:24 |
| Dezember 2027, Samstag 25. qualifiziert planfrei und 24./31. je 462 Ausfallminuten | 23 × 462 − 3 × 462 | 154:00 |
| Dezember 2026, 30 Stunden, entsprechende Voraussetzungen                           | 19 × 360           | 114:00 |

Die gleichmäßige FORECAST-Referenz kann denselben Zahlenwert wie der qualifizierte Planfrei-Fall haben; Status und Voraussetzungen unterscheiden sie vom bestätigten Anspruch. Ein ATOSS-Vergleich für TVöD-K ist keine TV-L-Rechtsgrundlage.

## Kompatibilität und offene Grenzen

Keine destruktive Migration und kein neues Backup-Format. Bekannte explizite historische §-43-Kennungen können in der Berechnung erkannt werden; mehrdeutige Tarifmarker werden nicht aus einer heutigen Auswahl rückwirkend bestätigt. Außerhalb der Prüfdeckung bleibt die frühere gekennzeichnete Referenz bei nur abgeleiteten Profilen erhalten. Neue TV-L-Tariftypen erfordern einen entsprechend aktuellen Backup-Leser.

Regionale Feiertage werden mit dem vorhandenen geprüften Regionalkatalog getestet. Wenn der aktive Resolver noch den älteren Katalog ohne Regionalvertrag verwendet, bleibt BY/SN/TH wie bisher ausdrücklich nicht verfügbar. Dieses Paket aktiviert keinen anderen Regelkatalog stillschweigend.

Konkreter FZA mit Fristen und Ausweisung, Zeitkonto, Ersatzruhetage, individuelle Ausfallstunden, Zusatzurlaub und die Vertragsgrundlage bei tariflichen Vollzeitänderungen bleiben getrennte Folgeaufgaben. Die bestehenden Gehaltsmodule und ihre Fassungswechsel werden nicht geändert.

## Umsetzung und Nachweise

Typecheck und 317 gezielte Unit-/Integrationstests in zwölf Dateien sowie zehn gezielte Komponententests sind bestanden. Die neue TV-L-Datei enthält 36 Fälle; zusätzlich wird ein tatsächlicher Backup-Export/Restore mit gearbeiteten Feiertagen geprüft. Monats-, Jahres-, Kalender- und CSV-/HTML-Berichtsdaten verwenden dieselbe Berechnung. Der bedingte Planungshinweis erscheint einmal im Monats-/Jahresbericht und bleibt in der App innerhalb der bisherigen aufklappbaren Erklärung. Die gesetzten Architekturgrenzen bleiben bestehen.

Die vollständigen Gate-, CI-, Export- und Preview-Nachweise werden im zugehörigen PR und Abschlussbericht dokumentiert. Ein erforderlicher iPhone-Nachweis für den neuen TV-L-Erklärungstext bleibt vor Merge offen, bis er konkret vorliegt; technische Exporte und Komponententests ersetzen ihn nicht.
