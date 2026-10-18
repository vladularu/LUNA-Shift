# Jahressonderzahlung: Monate, Gehalt und Netto

Stand: 18. Oktober 2026. Basis: `5e7b111f8103d09c6b84e44d5a957c1f68a3d125`.

## Task-Vertrag

- Ziel: Tarifabhängigen Auszahlungsmonat anbieten, bestätigte Sonderzahlungen im Monatsbrutto und in der Nettoprognose berücksichtigen; die lange Sonderfallliste aus dem normalen Eingabefluss nehmen.
- Plattform: Expo SDK 57, iPhone zuerst; plattformunabhängige Berechnung.
- Nicht-Ziele: Keine Freigabe von Entwurfstarifen, keine automatische Anspruchszusage, keine neue Steuerjahresregel, keine nativen Änderungen. Kein Commit, Push, Build, OTA oder Store-Schritt.
- Arbeitspaket 1: Quellen und Monate, Jahreszahlungsdaten und Validierung (`src/domain`, neuer Berechnungsadapter).
- Arbeitspaket 2: Einmalzahlungssteuer, anteilige SV-Grenzen und Anschluss an die vorhandene Netto- und Exportstrecke (`src/engine`, `src/features/report-export`).
- Arbeitspaket 3: Eigener Bereich für die Sonderzahlung und vereinfachte Netto-Angaben (`src/features/salary`) mit gezielten Komponenten- und Regressionstests.
- Abnahme: Richtiger Zahlungsmonat und Jahreswechsel; keine Doppelzählung oder Vererbung ins nächste Jahr; bestehende Einstellungen bleiben lesbar; falsche oder fehlende Daten erzeugen keine erfundene Gesamtberechnung; fokussierte Tests und `verify:fast`. Visuelle iPhone-Abnahme bleibt ein separates Gate.

## Quellen und Grenzen

Die hier angebotenen Monate sind der reguläre Tariftermin. Ein abweichender tatsächlicher Auszahlungsmonat muss gespeichert werden können. Eine vorhandene Tabelle oder ein recherchierter Termin hebt den DRAFT-Status einer Vergütungsstrecke nicht auf.

| Familie                                     | Regulärer Termin                                                                    | Primärquelle                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| TVöD-P / BT-K, VKA E, Anlage A, SuE / BT-B  | November                                                                            | VKA, § 20 Abs. 5 TVöD-AT; § 54 BT-K bzw. BT-B für Abweichungen |
| TV-L / KR                                   | November                                                                            | TdL, § 20 Abs. 5 TV-L                                          |
| TVAöD Pflege                                | November                                                                            | VKA, § 14 TVAöD-Pflege                                         |
| TVA-L Pflege                                | November                                                                            | TdL, § 16 Abs. 3 TVA-L Pflege                                  |
| TV-H / KR                                   | November                                                                            | Land Hessen, § 20 TV-H                                         |
| TV-UK Pflege                                | November                                                                            | AGU, § 18 Abs. 5 TV UK                                         |
| AVR Caritas Pflege, Anlagen 31/32           | November                                                                            | AVR Caritas, § 16 Abs. 5 Anlagen 31/32                         |
| DRK-Reformtarifvertrag E/P/S und Ausbildung | November                                                                            | DRK-RTV, § 23; Ausbildungsregelung                             |
| AVR-DD                                      | November und Juni des Folgejahres; Anspruch und betriebliche Kürzung separat prüfen | AVR-DD Anlage 14                                               |
| Eigene Vergütung / andere Haustarife        | Nach Vertrag                                                                        | Kein erfundener Tariftermin oder Prozentsatz                   |

Primärquellen, am 18. Oktober 2026 abgerufen:

- [TVöD-AT, Stand 01.01.2026, § 20](https://vka.de/wp-content/uploads/2026/04/TVoeD_AT_AETV_22_Lesefassung_Stand_01_01_2026.pdf) und [BT-K, § 54](https://vka.de/wp-content/uploads/2026/10/250406_BT-K_AeTV_15_Lesefassung_Stand-01.01.2026.pdf).
- [TV-L, § 20](https://www.gesetze-bayern.de/Content/Document/TV_L-20), ergänzend die bestehenden quellengestützten KR-Zuordnungen im Regelkatalog.
- [TVAöD-Pflege, § 14](https://vka.de/wp-content/uploads/2026/04/TVAOED_BT-Pflege_AETV_18_Lesefassung_Stand_01_07_2025.pdf): Referenz August bis Oktober, 90 Prozent.
- [TVA-L Pflege, § 16, Stand 14.02.2026](https://www.tdl-online.de/fileadmin/downloads/TV-Ausbildung/TVA-L-Pflege/260804_TVA-L_Pflege_i.d.F._des_%C3%84TV_Nr._13.pdf): November-Ausbildungsentgelt, 95 Prozent.
- [TV-H, § 20](https://innen.hessen.de/sites/innen.hessen.de/files/2023-01/tv-h_fassung_aendtv_nr._20_vom_15.10.2021.pdf) und [amtliche Bemessungssätze ab 2025](https://rp-kassel.hessen.de/sites/rp-kassel.hessen.de/files/2026-06/bemessungssaetze_jsz_ab_2019_1.pdf): KR5–8 90 Prozent, KR9–12 60 Prozent. Keine ungeprüfte automatische Satzzuordnung für KR13–16.
- [TV UK, § 18](https://agu-uniklinika.de/wp-content/uploads/2025/07/01_TV-UK_durchgeschrieben-Fassung-Ae9-vom-03.07.2024.pdf): Referenz Juli bis September, 88 Prozent.
- [AVR Caritas Gesamtausgabe 2026, Anlagen 31/32 § 16](https://www.lambertus.de/media/wysiwyg/websites/lam_lambertus/AVR_Online-PDF_2026_final.pdf).
- [DRK-RTV, 52. Änderungstarifvertrag, § 23 und Ausbildungsregelung](https://btg.drk.de/fileadmin/user_upload/Bundestarifgemeinschaft/05_grundlagen_news/DRK-RTV_idF_52.AETV_14.AETV-TVUE_durchgeschriebene_Fassung.pdf).
- [AVR-DD, Stand 01.01.2026, Anlage 14 Abs. 3–4, PDF-Seite 219](https://www.arkdd.de/avr/avrdd_20260101.pdf): regulär 50/50; bei negativem Ergebnis für bestimmte Einrichtungen 25/75, Juni-Zahlung kann zusätzlich gekürzt werden. Der Monatsplan bestätigt weder Höhe noch Anspruch.
- [BMF, sonstige Bezüge und voraussichtlicher Jahresarbeitslohn](https://usth.bundesfinanzministerium.de/lsth/2026/A-Einkommensteuergesetz/VI-Steuererhebung-36-47/2-Steuerabzug-vom-Arbeitslohn-Lohnsteuer-38-42g/Paragraf-39b/r-39b-6.html) sowie der vorhandene amtliche PAP 2026; [TK: Beiträge aus Einmalzahlungen](https://www.tk.de/resource/blob/2031414/9e6a0f7936f10f5601e9902db664ac5a/beratungsblatt-einmalzahlungen-data.pdf).

## Umgesetzter Rechenweg

Die acht im normalen Gehaltsfluss vorhandenen Modelle (TVöD-P, VKA E, TV-L/KR, TV-H/KR, TV-UK, TVAöD, TVA-L und eigene Vergütung) verwenden denselben Anschluss für bestätigte Zahlungen. Die Liste der Monate umfasst zusätzlich die Entwurfsfamilien; deren unvollständiges Gesamtbrutto wird dadurch nicht freigegeben.

Der Bruttobetrag wird für genau einen Auszahlungsmonat gespeichert. Weitere Raten bekommen ihren eigenen Monat, auch im Folgejahr. Pro Monat wird ein bestätigter Gesamtbetrag geführt. 0 ist eine ausdrückliche Absage/Korrektur, fehlende Angaben sind keine Null. Eigene Vertragsmonate sind frei wählbar.

Seit der Preview-Korrektur wird für 2026 ein Tarifvorschlag automatisch aus der vorhandenen Monatsberechnung im regulären Auszahlungsmonat berücksichtigt. Er verwendet die ausgewählte Gehaltsbasis und deren hinterlegte Dienste/Zulagen für den jeweiligen Referenzzeitraum. Historische Stufen-/Arbeitszeitwechsel, Anspruchsmonate, Stichtage, Sondervereinbarungen und dienstplanmäßige Überstunden müssen geprüft und im bestätigten Betrag korrigiert werden. Für nicht belegte Gruppen, andere Jahre und eigene Vergütung wird kein Satz erfunden. Die Prognose braucht weder Knopfdruck noch Speichern. Gespeicherte eigene Jahreszahlungen ersetzen die automatische Planung des jeweiligen Jahres, einschließlich 0 als Absage. Siehe `automatische-jahressonderzahlung.md`.

Solange Entwicklertestmonate aktiv sind, wird kein persönlicher Tarifvorschlag erzeugt; das schützt auch Zulagen-Rückblicke außerhalb des Referenzzeitraums. Bestätigte Zahlungsbeträge werden unabhängig vom Gültigkeitsbeginn der ersten Netto-Einrichtung im jeweiligen echten Bruttomonat angezeigt.

Für Netto sind zwei Grundlagen möglich:

1. Vereinfachte Jahresprognose: laufendes Entgelt unverändert und durchgehend sozialversichert seit Januar. Dies ist die Standardannahme der automatischen Prognose; die Grundlagen sind in den Gehaltsdetails einsehbar. Eigene Abrechnungswerte bleiben optional.
2. Jahreswerte aus der Abrechnung: voraussichtliches Jahressteuerbrutto ohne diese Zahlung, bisher verbeitragte KV/PV- und RV/AV-Grundlagen einschließlich laufendem Zahlungsmonat sowie SV-Tage.

Der lokale PAP erhält `SONSTB` und `JRE4`; laufender Lohn und Sonderzahlung werden steuerlich getrennt behandelt. KV/PV und RV/AV verwenden jeweils ihre anteilige Jahres-BBG abzüglich bereits verbeitragter Grundlagen. Frühere Zahlungen verbrauchen den jeweiligen SV-Spielraum. Die laufende monatliche SFN-Grundlage wird durch Weihnachtsgeld nicht erhöht.

**Offene fachliche Grenzen:** Zusätzliche Zusatzversorgungsbeiträge der Sonderzahlung und deren Steuer-/SV-Auswirkungen sind noch nicht allgemein berechnet. Bestehende laufende Zusatzversorgung bleibt enthalten; die Ausgabe benennt diese Teilberechnung ausdrücklich. Bei möglicher Märzklausel ohne Vorjahresdaten sowie fehlenden oder widersprüchlichen Jahreswerten bleibt das laufende Netto unter „Netto ohne Sonderzahlung“ sichtbar. Es wird keine vollständige Nettoauszahlung behauptet. PKV, Mini-/Midijobs und andere bisher nicht unterstützte Grundfälle bleiben geschützt.

Monats-/Jahresansicht, Gehaltsbestandteile und PDF verwenden dieselben abgeleiteten oder manuell angepassten Cash-Monate. Der Kalender-CSV bleibt eine Tagesliste. Jahresnettosummen zählen keine Monate mit fehlendem Sonderzahlungsnetto als vollständige Netto-Monate.

## Speicherung und Eingabeseite

Die bestehenden lokalen JSON-Einstellungen erhalten einen optionalen, validierten Jahreszahlungsdatensatz. Keine Datenbankmigration und keine native Abhängigkeit. Eigene Revisionsnummern pro Zahlungsmonat verhindern, dass ein späteres Steuerprofil alte Beträge wiederbelebt; gleichrangige widersprüchliche Versionen werden abgewiesen. Andere Netto-Einstellungen erhalten die Jahreszahlungen beim Speichern.

Die lange Checkboxliste ist ersetzt durch Versicherungsart an der Versicherungsangabe und einen kompakten Beschäftigungsfall unter den optionalen Details. Laufende Zulagen und reine Nettoabzüge bleiben eigene Euro-Felder. Weitere steuer-/SV-wirksame Abzüge werden weiterhin gesondert gekennzeichnet. Bestehende Sonderfälle werden nicht beim Öffnen gelöscht. Weihnachtsgeld hat seinen eigenen Bereich in der Gehaltsübersicht.

## Abnahme

- Automatisiert: Centbeträge, unterschiedliche SV-Jahresgrenzen, mehrere Raten, Jahreswechsel, unbekannt gegenüber bestätigter Null, revisionssichere Korrektur, SQLite-Rundlauf, alle acht normalen Gehaltsmodelle, Tarifreferenzzeiträume, gespeicherte Formulardaten und PDF-Kennzeichnung.
- Vor Auslieferung auf iPhone offen: Formular bei normaler und großer Schrift, Monat wechseln, Vorschlag anpassen/speichern, Folgejahr ohne Wiederholung, Netto mit/ohne Jahresgrundlagen und Vergleich mit einer echten anonymisierten Abrechnung.
- Commit, Push, PR, Build und OTA sind nicht Teil dieser Freigabe.
