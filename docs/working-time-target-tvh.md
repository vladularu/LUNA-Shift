# TV-H Pflege: Sollzeitadapter für den §-43-Bezug

## Aufgabe und Umfang

Ziel: Die vorhandene TV-H-Pflegeauswahl, individuelle Vertragsminuten, Arbeitsort und Sonn-/Feiertagsangabe liefern eine automatische, nachvollziehbare Sollzeit-Prognose. Ein eigener Adapter verwendet die gemeinsame Engine. Datierte Beschäftigungsdaten bleiben maßgeblich. Keine zusätzliche Eingabe oder Tagesbestätigung im normalen Ablauf.

Nicht-Ziele: allgemeiner TV-H E, Ärzte, Klinik-Haustarife, Änderungen an Gehaltsformeln, automatische FZA-/Zeitkontobuchungen, Zusatzurlaub, Bereitschaft/Rufbereitschaft, native Änderungen und Beta-/Production-Veröffentlichung. Plattform: bestehende interne iOS-Preview, Expo ~57.0.22 und versionierte SDK-57-Dokumentation.

Branch: `codex/tvh-pflege-sollzeit`, Basis `fab6ae0bb49e725d74ffe0283d598bc5bbb594a5`. Baseline vor Änderungen: 78 Tests in drei Sollzeit-/TV-H-Dateien bestanden; vorangehender master-Lauf 40409809753, Versuch 2, mit sieben erfolgreichen Gates.

Dateiscope, höchstens 13 Dateien: dieses Dokument, `working-time-target-sources.md`, `working-time-target-integration.md`; die drei Domain-Dateien `working-time-target.ts`, `saved-working-time-target.ts`, `working-time-target-validation.ts`; die Engine-Dateien `working-time-target-rules.ts`, `working-time-calculation-profile.ts`, `working-time-target.ts` und neuer `working-time-target-tvh.test.ts`; `working-time-target-form-model.ts`, vorhandener Komponenten- und vorhandener Backup-Test.

## Quellenprüfung und Grenzen

[TV-H ÄTV 24 vom 24.05.2024](https://innen.hessen.de/sites/innen.hessen.de/files/2023-01/tv-h_fassung_aendtv_nr._20_vom_15.10.2021.pdf): § 43 Nr. 1 betrifft Krankenpflege im Justizvollzug. Nr. 3 Ziff. 2 ersetzt § 6 Abs. 3: Sätze 1–3 betreffen Sondertagsausfall; Sätze 4–7 Feiertagsarbeit und getrennten Ausgleich; Satz 8 den qualifizierten planfreien Werktagsfeiertag im Siebentagedienst. Sonntage erhalten keinen zusätzlichen Werktagsabzug. Die frühere Quellenzeile HE1 verwechselte Nummer und Geltungsbereich; sie wird berichtigt.

[Offizielle Tarifeinigung 27.03.2026](https://innen.hessen.de/sites/innen.hessen.de/files/2026-03/tarifeinigung_2026-03-27.pdf), alle neun Seiten und [Anlage 1](https://innen.hessen.de/sites/innen.hessen.de/files/2026-03/anlage_1_zur_tarifeinigung_allg-teil.pdf), enthalten keine Änderung dieses Feiertagstatbestands. Entgeltanpassungen, spätere Zulagen und beantragte zusätzliche Freizeit nach § 6a werden nicht zu Sollzeitabzügen umgedeutet. Die [Arbeitgeberübersicht](https://innen.hessen.de/buerger-staat/arbeits-und-dienstrecht/oeffentliches-dienst-und-arbeitsrecht/tarifvertraege-allgemeine-verwaltung) verlinkt weiterhin ÄTV 24. Die [Universität Marburg](https://www.uni-marburg.de/de/universitaet/administration/verwaltung/dezernat2/personalabteilung/allgemeine-informationen/freizeit-statt-geld-1/freizeit-statt-geld) nennt bereits ÄTV 25; dessen vollständiger Änderungstext konnte nicht gesondert aufgefunden werden. Prüfgrundlage sind daher ausdrücklich die veröffentlichte Lesefassung und die konkrete 2026-Einigung, keine behauptete vollständig konsolidierte ÄTV-25-Fassung. Spätere abweichende Änderungen benötigen eine neue Prüfung.

SHA-256 der erneut geladenen offiziellen Dateien: Mantel `8ea0e67084ccf6b275b1c8e96424121b80e2c0b6f24bac587dd009c90b6cdc4f`; Einigung `2e84e64dc93f5a0884d5463eec67bb8b38e7bfc8c713e682d23711794283f3a1`. Beide stimmen mit den bereits dokumentierten Quellen überein. Der Dateiname des Mantels ist älter als sein Deckblatt.

BAG 6 AZR 465/15 betrifft TV-L; es wird nicht als TV-H-Entscheidung ausgegeben. Eine unmittelbar passende veröffentlichte TV-H-Feiertagsentscheidung wurde bei der gezielten Suche nicht identifiziert. Die TV-H-Regelidentität beruht auf dem eigenen Normtext. Die Entscheidung 5 AZR 582/11 zu Vertragsbezug ersetzt diese Feiertagsprüfung nicht. Betriebliche Abweichungen und individuelle Tarifbindung bleiben gesondert.

## Berechnungsmodell

Prüfkennung `2026-03-27`, technische Deckung 01.01.2026–31.12.2027: Die hier verwendete Feiertagsnorm ist im geprüften 2026-Einigungstext unverändert. Das ist keine tarifliche Befristungsbehauptung. Eigene jahresbezogene IDs `tvh-kr-2026/2027-43-…` tragen TV-H-Quellen; es werden keine TV-L-/TVöD-IDs übernommen.

Die Gehaltsauswahl schlägt den Bezug vor und setzt `scopeConfirmed: null`. Eine tatsächliche bestätigte Berechnung verlangt explizite Geltung und Voraussetzungen. Verneinte Geltung, unbekannte Fassungen oder fehlende Tatsachen liefern keine bestätigten Abzüge. Allgemeiner TV-H, unklare alte `TV_H`-Marker und Gehaltskonflikte bleiben ungeprüft. Es werden weder Daten migriert noch bestehende Kontexte überschrieben.

FORECAST ignoriert Dienste und alte Einzelbestätigungen. Die gleichmäßige Fünftelreferenz ist ein bedingter Planfrei-Wert, Status `PROVISIONAL` und Zeilenstatus `PROFILE_ESTIMATE`. Der vorhandene kurze Erklärungstext nennt den Justizvollzugsbezug. Nur bei einschlägigen Werktagsfeiertagen erscheint dieser Vorbehalt innerhalb der aufklappbaren Erklärung und einmal im PDF. Normale Monate bleiben knapp. Eine Kalenderlücke bestätigt keinen Anspruch.

Rechnung und Rundung verwenden die vorhandenen ganzzahligen Fünftelzähler und den gemeinsamen Monatsledger. Vertragsminuten werden weder aus KR-Gruppe noch aus tariflicher Vollzeit ersetzt. Feste Verteilung, datierte Änderungen, regionale Kalenderprüfung und Doppelabzugsschutz bleiben gemeinsam. Istzeit, Zuschläge und Gehalt werden unabhängig geprüft.

Rundungskontrolle bei 2.311 Wochenminuten im Dezember 2026: Monatsbasis 10.630,6 → 10.631; gesetzlicher und tariflicher Abzug jeweils 924,4 → 924. Das ungerundete Endergebnis 8.781,8 wird auf 8.782 Minuten gerundet. Der bereits vorhandene ausgewiesene Minutenausgleich von −1 hält die gerundeten Positionen zusammen: 10.631 − 924 − 924 − 1 = 8.782. Es wird keine zusätzliche Tagesrundung eingeführt.

## Unabhängige Handkontrollen

Hessen, individuell 2.310 Wochenminuten, Referenz 462 Minuten. Prognosewerte setzen eine gleichmäßige qualifizierte Planfrei-Referenz voraus; für bestätigte Fälle sind Geltung, Siebentagedienst, Feiertagskonstellation und Sondertagsausfall ausdrücklich festgelegt.

| Monat/Fall                                                                    | Handrechnung in Minuten                          | Soll   |
| ----------------------------------------------------------------------------- | ------------------------------------------------ | ------ |
| April 2026                                                                    | 22 × 462 − 2 × 462                               | 154:00 |
| Juli 2026, normal                                                             | 23 × 462                                         | 177:06 |
| Oktober 2026, 03.10. qualifiziert planfrei                                    | 22 × 462 − 462                                   | 161:42 |
| Oktober 2026, 03.10. gearbeitet oder kein Nacharbeiten                        | 22 × 462                                         | 169:24 |
| November 2026, normal                                                         | 21 × 462                                         | 161:42 |
| Dezember 2026, zwei qualifizierte Feiertage und 24./31. je 462 Ausfallminuten | 23 × 462 − 4 × 462                               | 146:18 |
| Dezember 2026, 25./26. gearbeitet, 24./31. je 462 Ausfallminuten              | 23 × 462 − 2 × 462                               | 161:42 |
| Dezember 2026, alle vier Tage gearbeitet                                      | 23 × 462                                         | 177:06 |
| Dezember 2026, fest Mo–Fr mit passendem Sondertagsausfall                     | 23 × 462 − 3 × 462                               | 154:00 |
| Mai 2027                                                                      | 21 × 462 − 4 × 462                               | 130:54 |
| Juli 2027, normal                                                             | 22 × 462                                         | 169:24 |
| Dezember 2027, 26.12. Sonntag ohne zusätzlichen Abzug                         | 23 × 462 − 3 × 462                               | 154:00 |
| Dezember 2026, vertraglich 30 Stunden                                         | 19 × 360                                         | 114:00 |
| Dezember 2026, vertraglich 40 Stunden                                         | 19 × 480                                         | 152:00 |
| Dezember 2026, 2.311 Wochenminuten                                            | Monatsreferenz 19 × 2.311 / 5, auf ganze Minuten | 146:22 |
| Wechsel 38,5 auf 30 Stunden am 16.12.2026                                     | 11 × 462 + (12 − 4) × 360                        | 132:42 |

Der ursprüngliche TVöD-K-/ATOSS-Wert bleibt ein eigener Regressionstest. Eine gleiche Zahl macht daraus keinen allgemeinen TV-H-Anspruch.

## Abnahme und verbleibende Arbeit

Erforderlich: Typecheck, ESLint, fokussierte Fälle einschließlich TVöD-K/BT-B/TV-L-Gegenkontrollen, tatsächlicher Backup-Rundlauf, Komponententests, vollständiges `verify:fast`, sieben PR-Gates und iOS-Export. Monats-/Jahres-/Kalender-/CSV-/PDF-Daten müssen denselben Sollwert verwenden. Bestehende Vergütung und Istminuten müssen gleich bleiben.

Für die interne iPhone-Prüfung: TV-H-Prognose aus passenden vorhandenen Angaben, Ergebnis zuerst, Vorbehalt erst nach Aufklappen, keine Tagesfragen; Normalmonat und Dezember ansehen. Die neue Anzeige benötigt einen eigenen Gerätenachweis. Keine fremde tatsächliche Tarifauswahl zum bloßen Test überschreiben. Git- und interne Preview-Schritte sind freigegeben; Merge nach erfolgreichen Gates und erforderlichem Sichtnachweis. Beta/Production bleiben außerhalb dieses Pakets.

Fokussierter Nachweis vor dem vollständigen Gate: 262 Unit-/Integrationstests in zehn Dateien bestanden, darunter 35 eigene TV-H-Fälle und zwei tatsächliche TV-H-Backup-Rundläufe. 13 Komponententests bestanden, darunter Oktober/November/Dezember für TV-H ohne neue Fragen oder Schreibvorgang. Typecheck erfolgreich. Drei synthetische PDFs mit dem tatsächlichen Berichtsbuilder erstellt; Standardmonat zwei, Kompaktmonat eine, Jahr zwei Seiten. Alle fünf Seiten mit Poppler gerendert und visuell geprüft; Vorbehalt jeweils einmal, keine zusätzliche Seite nach Kürzung des eigenen TV-H-Textes. Der bestehende TV-L-Text bleibt erhalten.

Noch offen vor Abnahme: vollständiges Gate, PR-CI, interne Preview und eigener iPhone-Sichtnachweis. Nicht umgesetzt: allgemeiner TV-H-/Haustarifadapter, konkrete FZA-Buchungen/-Fristen, Zeitkonto, Ersatzruhe, Zusatzurlaub sowie Ausbildungs- und besondere Abwesenheitsfälle. Die vollständige ÄTV-25-Konsolidierung bleibt als Quellenlücke ausdrücklich dokumentiert.
