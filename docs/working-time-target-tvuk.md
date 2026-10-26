# TV-UK Pflege BW – Sollzeit

## Task-Vertrag

- Ziel: TV-UK aus den vorhandenen, auch datierten Beschäftigungsangaben erkennen und die eigenen Sollzeitregeln in der gemeinsamen Engine anwenden.
- Nicht-Ziele: neue Einstellungsfragen, Lohn- oder Zuschlagsänderungen, Buchungen auf dem Ampelkonto, native Änderungen, TestFlight oder Production.
- Plattform: bestehende iOS-Preview; unveränderte Navigation und aufklappbare Sollzeiterklärung. Exportprüfung umfasst Monats-, Kompakt- und Jahres-PDF.
- Scope (15 Dateien): Domainvertrag und dessen zwei Validatoren; Regelregister, Berechnungsprofil, bestehender Formularadapter, zentrale Engine und TV-UK-Tagesregel; TV-UK-Regressionen, Backup- und Komponentenprüfung; vorhandene Erklärung und PDF-Hinweise; dieses Dokument und Quellenkatalog.
- Abnahme: unabhängig von Diensteinträgen 154:00 h im Dezember 2026 bei 38,5 h, BW und regelmäßiger Sonn-/Feiertagsarbeit; 169:24 h im Oktober, 161:42 h im November. Keine Samstags-/Sonntags-Fünftelabzüge im Kontenbereich, keine doppelten Abzüge. Historie, Teilzeit, Rundung, Backups und bisherige Tarife bleiben geprüft.
- Freigaben: Umsetzung, Git und interne Preview durch den Nutzer erteilt. Merge erst nach CI und tatsächlicher iPhone-Abnahme der neuen Erklärung.

## Quellen und Geltung

Geprüft am 27.10.2026: [AGU-Tarifübersicht](https://agu-uniklinika.de/tarifvertraege/) und [Manteltarifvertrag in der Fassung ÄTV 9 vom 03.07.2024, gültig ab 01.01.2025](https://agu-uniklinika.de/wp-content/uploads/2025/07/01_TV-UK_durchgeschrieben-Fassung-Ae9-vom-03.07.2024.pdf). Der Mantel gilt gemäß § 1 für tarifgebundene nichtwissenschaftliche Beschäftigte der erfassten AGU-Mitglieder (Freiburg, Heidelberg, Tübingen und Ulm); er ist kein allgemeiner Tarif aller Universitätskliniken. Die Entgeltvereinbarung von Juli 2026 ersetzt keine Arbeitszeitregel.

§ 8 Abs. 1 nennt 38,5 Stunden und eine historische Besitzstandsregel. Maßgeblich bleiben die individuellen Wochenminuten; die Engine setzt sie nicht neu fest. § 8 Abs. 2 erlaubt durchschnittlich fünf, bei betrieblicher Notwendigkeit bis zu sechs Arbeitstage. Das ist keine feste Montag-bis-Freitag-Woche.

§ 8 Abs. 3 stellt grundsätzlich auf tatsächlich ausgefallene dienstplanmäßige oder betriebsübliche Stunden an Werktagen ab. Regelmäßig freie Tage lösen diesen Ausfallabzug nicht aus. Für Bereiche mit Arbeitszeitkonten verweist die Norm auf § 13 Abs. 4 Buchst. b.

§ 13 Abs. 1 sieht Konten für Schichtarbeit, Bereitschafts-/Rufbereitschaft und regelmäßige Arbeit zu den genannten zuschlagspflichtigen Zeiten vor. Weitere Bereiche können durch Dienstvereinbarung einbezogen werden. § 13 Abs. 4 Buchst. b reduziert im Kontenbereich für gesetzliche Feiertage sowie 24./31. Dezember die Sollstunden jeweils um ein Fünftel der durchschnittlichen Wochenzeit, ausschließlich Montag bis Freitag. Der Abzug hängt dort nicht von einem Diensteinsatz an diesem Tag ab. Samstag und Sonntag erhalten keinen solchen Fünftelabzug. Heiligabend und Silvester bleiben tarifliche Sondertage.

## Umsetzungsgrenze

Die Implementierung wird erst nach den Qualitätsgates und der Geräteabnahme als abgeschlossen dokumentiert. Ein unbekannter persönlicher Geltungs- oder Kontenbereich ist keine Anspruchsbestätigung. Allgemeine Ausfallfälle nach § 8 Abs. 3 außerhalb eindeutig bestätigter fester Freistellung bleiben offen; dafür werden keine neuen Nutzerfragen eingeführt. Kontensalden, Ausgleichszeiträume, Krankheits-/Urlaubsgutschriften und Zuschlagsfaktoren gehören in getrennte Folgepakete.

## Berechnungsmodell und Daten

Die vorhandene exklusive PUK-Auswahl erkennt die Tarifgruppe. Regelmäßige Sonn-/Feiertagsarbeit liefert die bedingte Kontenprognose; ein Nein liefert die feste Montag-bis-Freitag-Referenz nach § 8. Ein unbekannter Wert bleibt unbekannt. Die Prognose bestätigt weder persönlichen Tarifgeltungsbereich noch einzelne Ansprüche. Die Kontenregel wird bei tatsächlich bestätigtem Tarifgeltungsbereich und bestätigtem regelmäßigem Schichtmodell nach § 13 Abs. 1 angewandt. Im internen Berechnungsvertrag kann der Kontenbereich ausdrücklich vorgegeben oder ausgeschlossen sein. Die bestehende Oberfläche bekommt dafür keine neuen Eingabefelder.

Die zwei internen Bestätigungsfelder bleiben bei der Ableitung aus Beschäftigungsdaten `null`. Bestehende Profile und unklare alte `TV_UK`-Marker werden nicht umgeschrieben. Datierte Beschäftigungswechsel werden über den vorhandenen Verlauf aufgelöst. Die neue typisierte Regel ergänzt das bereits streng validierte Sollzeit-JSON; Datenbank und Backupversion 21 bleiben erhalten. Frühere Backupversionen erzeugen keine Bestätigungen. Widersprüchliche bestätigte Schichtarbeit bei ausdrücklich ausgeschlossenem Kontenbereich wird abgewiesen.

Die zentrale Monatsengine berechnet weiterhin Feiertagsregionen, Monatsbasis und den ganzzahligen Fünftelzähler. Nur die Tagesentscheidung ist tarifabhängig. Ein Datum erzeugt höchstens einen Abzug; gesetzlicher Feiertag hat Vorrang vor tariflichem Sondertag. Der bestehende Rundungsausgleich verbindet gerundete Positionssummen mit dem erst am Gesamtzähler gerundeten Monatsergebnis. Negative Gesamtziele werden als nicht verfügbar markiert.

## Unabhängige Kontrollwerte

Kalenderzählung mit BW-Feiertagen und 2.310 persönlichen Wochenminuten, `2.310 / 5 = 462` Minuten. Es werden ausschließlich Montag-bis-Freitag-Tage für die Kontenregel gezählt. Die Erwartungen stammen aus diesen Zählungen und dem Tariftext, nicht aus Engineausgaben.

| Monat         | Basis in Referenztagen | Gesetzliche Abzüge                             | Sondertage | Rechnung   |       Soll |
| ------------- | ---------------------: | ---------------------------------------------- | ---------- | ---------- | ---------: |
| Januar 2026   |                     22 | 01./06.01.                                     | –          | `20 × 462` |     154:00 |
| April 2026    |                     22 | 03./06.04.                                     | –          | `20 × 462` |     154:00 |
| Juli 2026     |                     23 | –                                              | –          | `23 × 462` |     177:06 |
| Oktober 2026  |                     22 | 03.10. am Samstag: kein Fünftel                | –          | `22 × 462` |     169:24 |
| November 2026 |                     21 | 01.11. am Sonntag: kein Fünftel                | –          | `21 × 462` |     161:42 |
| Dezember 2026 |                     23 | 25.12.; 26.12. am Samstag ohne Fünftel         | 24./31.12. | `20 × 462` | **154:00** |
| Mai 2027      |                     21 | 06./17./27.05.; 01.05. am Samstag ohne Fünftel | –          | `18 × 462` |     138:36 |
| Juli 2027     |                     22 | –                                              | –          | `22 × 462` |     169:24 |
| Dezember 2027 |                     23 | 25./26.12. am Wochenende ohne Fünftel          | 24./31.12. | `21 × 462` |     161:42 |

Dezember 2026 mit 30 Stunden: `20 × 360 = 7.200` Minuten = 120:00 h. Mit 2.311 Wochenminuten: `20 × 2.311 / 5 = 9.244` Minuten = 154:04 h. Teilzeitwechsel am 16.12.: `11 × 462 + (12 − 3) × 360 = 8.322` Minuten = 138:42 h. Eintritt erst am 16.12. bei 38,5 h: `9 × 462 = 4.158` Minuten = 69:18 h.

Das ursprüngliche TVöD-K-Beispiel bleibt unter seinen Voraussetzungen bei 146:18 h. Sein Samstagsabzug darf nicht auf TV-UK übertragen werden. Reine Diensteinträge ändern weder den Prognosewert noch dessen Abzüge; Istzeit und TV-UK-Vergütung werden unabhängig verglichen.

## Quellenbeleg und offene Punkte

Die heruntergeladene aktuelle AGU-Mantelfassung hat SHA-256 `55601f36409ab2fc27adf5f8f959d26b74258c0aff387a3267ebdfe863f394d3`. Prüfdeckung: Berechnungsjahre 2026–2027, Versionsidentität 01.01.2025. Die Prüfgrenze ist kein behauptetes Tarifende. Außerhalb der Deckung bleibt eine aus Bestandsdaten abgeleitete bisherige Werktagsreferenz vorläufig; neue Tarifansprüche werden dort nicht aktiviert.

Eine gezielte Suche nach einschlägiger BAG-Rechtsprechung zur TV-UK-Kontenfeiertagsnorm lieferte keinen bestätigten einschlägigen Treffer. Deshalb wird keine fremde BAG-Entscheidung als TV-UK-Beleg verwendet. Abweichende Dienstvereinbarungen, betriebliche Sechstageverteilung und allgemeine variable Ausfallstunden nach § 8 benötigen ein eigenes Folgepaket. Die Geldberechnung, Ersatzruhetage, Zusatzurlaub und Ampelkonto-Abrechnung werden durch diese Monatsprognose nicht bestätigt.

## Qualität und Geräteabnahme

Fokussierte Fach-/Integrationstests und Komponentenprüfungen sind vor der Veröffentlichung durchzuführen. Danach folgen `verify:fast`, PR-CI und iOS-Export. Tatsächliche PDF-Seiten und die interne iPhone-Preview werden getrennt geprüft. Geräteabnahme für TV-UK ist noch offen; bisherige TV-H-Bilder sind dafür kein Nachweis.
