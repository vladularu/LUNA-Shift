# TVöD VKA E: vorhandenen Besonderen Teil für die Sollzeit nutzen

## Umfang und Quellenprüfung

Paket vom 27.10.2026, Berechnungsdeckung 2026–2027. Die E-Entgeltgruppe ist eine Vergütungszuordnung und legt keinen Besonderen Teil fest. Das bereits gespeicherte `VkaETariff.sector` benennt BT-K oder BT-B. § 40 des jeweiligen Besonderen Teils knüpft an Arbeitgeber und Einrichtung an; § 49 Abs. 2 gilt für die dort erfassten Beschäftigten und ist nicht auf die P-Tabelle beschränkt.

Die Prognose verwendet deshalb die vorhandenen, getrennt geprüften BT-K-/BT-B-Adapter einschließlich ihrer eigenen Quellen und Regelkennungen. Keine neue Tariffamilie, keine neue Engine, keine Änderung des Anspruchsnachweises. Sie bleibt eine Prognose aus Vertragsdaten, keine Bestätigung eines konkreten Tagesanspruchs.

Primärquellen, am 27.10.2026 erneut geprüft:

- [VKA BT-K, ÄTV 15 vom 06.04.2025, Stand 01.01.2026](https://vka.de/wp-content/uploads/2026/10/250406_BT-K_AeTV_15_Lesefassung_Stand-01.01.2026.pdf): § 40 Abs. 1/2 (Einrichtungsbezug), § 44 Abs. 1/1a (persönliche Arbeitszeit und mögliche Vereinbarung), § 49 Abs. 1–3 (Feiertagsarbeit und Fünftelregel). Die VKA führt den Link seit 08.10.2026; das Dokument selbst weist 01.01.2026 aus.
- [VKA BT-B, ÄTV 19 vom 06.04.2025, Stand 01.01.2026](https://vka.de/wp-content/uploads/2026/04/BT-B_AETV_19_Lesefassung_Stand-01_01_2026.pdf): § 40 (eigener Geltungsbereich), § 49 Abs. 1–3 (eigene Feiertagsregel, keine Übernahme aus BT-K).
- [VKA AT, ÄTV 22, Stand 01.01.2026](https://vka.de/wp-content/uploads/2026/04/TVoeD_AT_AETV_22_Lesefassung_Stand_01_01_2026.pdf): § 6 Abs. 1–3 und § 38. Für 24./31.12. werden weiter die begrenzten bestehenden Sondertag-Prognoseregeln verwendet; kein Doppelabzug und keine Istzeitbuchung.
- [KAV Hessen AT, ÄTV 22, Stand 01.01.2027](https://www.kav-hessen.de/sites/default/files/2025-10/3822d822d89695ead0c2eed7e8b1f1aa/tvoed-at_ifv_aetv-22_1-1-27.pdf): wie in den [2027-](working-time-target-2027.md) und [BT-B-Prüfungen](working-time-target-b.md) begrenzte Weiterverwendung der einschlägigen Arbeitszeitnormen. Die Prüfdeckung ist kein behauptetes Tarifende.

Vertragsminuten bleiben maßgeblich. Weder E-Gruppe/Stufe noch KAV-Baden-Württemberg-Auswahl oder Gehaltstabelle schreiben Wochenstunden um. Regionale Feiertage richten sich nach dem Arbeitsort. E-Tabellenauswahl allein erlaubt weder BT-V noch SuE noch einen sonstigen Besonderen Teil; diese sind nicht Bestandteil der einfachen E-Auswahl und dieses Pakets.

## Datenfluss und historische Grenzen

`currentTariff` und `employmentTargetTariff` verwenden den bestehenden `targetTariffForSector` mit dem gespeicherten E-Sektor. Konflikte mit anderen Vergütungsgrundlagen bleiben unbekannt. `scopeConfirmed` bleibt `null`; die bestehende Sonn-/Feiertagsantwort liefert nur das Prognosemodell, keinen bestätigten Schichtplan oder Anspruch.

Ein altes `UNVERIFIED/VKA_E` enthält keinen Besonderen Teil. Nur ein für das jeweilige Datum vorhandener Beschäftigungsdatensatz mit E-Zuordnung darf diesen Marker in der Leseprojektion auflösen. Ein heutiges Profil allein schreibt historische unbekannte Zuordnungen nicht um. Andere mehrdeutige Marker, ausdrückliche Ablehnungen und besondere historische Versionen werden nicht als neue Bestätigung behandelt.

Die vorhandene gemeinsame Zeitleiste verarbeitet spätere Stunden-, Stufen- und Tarifwechsel. Ausdrückliche Gesamtzeitraum-Korrekturen verwenden die bereits geprüfte Korrekturpriorität; echte spätere Änderungen bleiben geschützt. Alte Sollzeitkontexte bleiben unverändert gespeichert. Keine SQL-, Backup-, Cloud- oder Profilversion wird angehoben (Backup weiterhin 21).

Erfasste Dienste, freie Tage, Urlaub oder Krankheit bestimmen diese Vertragsprognose nicht. Tatsächliche Arbeitszeit, Zuschläge, Zeitkontobuchungen und Freizeitausgleich bleiben eigene Berechnungen. Die Oberfläche zeigt weiterhin Ergebnis und aufklappbare Aufschlüsselung; keine Tagesfragen, Bestätigungen oder zweite Beschäftigungsmaske.

## Unabhängige Kontrollwerte

HE, 38,5 Wochenstunden = 2310 Minuten; ein Fünftel = 462 Minuten. Bei regelmäßigem Schichtbetrieb Mo–So wird die vorhandene Referenz von fünf Arbeitstagen genutzt. Die folgenden Kalenderrechnungen gelten jeweils für E/BT-K und E/BT-B, mit eigenen Regelkennungen.

| Fall                                   | Handrechnung                                                 | Sollzeit |
| -------------------------------------- | ------------------------------------------------------------ | -------: |
| Juli 2026                              | 23 × 462                                                     |   177:06 |
| Oktober 2026                           | (22 − Samstag 03.10.) × 462                                  |   161:42 |
| November 2026 / HE                     | 21 × 462                                                     |   161:42 |
| Dezember 2026 / rotierend              | (23 − 24., 25., 26., 31.12.) × 462                           |   146:18 |
| Dezember 2026 / feste Mo–Fr-Verteilung | (23 − 24., 25., 31.12.) × 462                                |   154:00 |
| Dezember 2027 / rotierend              | (23 − 24., 25., 31.12.) × 462, Sonntag 26.12. ausgeschlossen |   154:00 |
| Dezember 2026 / 39 Stunden / rotierend | 19 × 468                                                     |   148:12 |
| Dezember 2026 / 30 Stunden / rotierend | 19 × 360                                                     |   114:00 |
| Dezember 2026 / 2311 Wochenminuten     | runden(19 × 2311 / 5)                                        |   146:22 |
| Teilzeit ab 16.12.2026                 | 11 × 462 + (12 − 4) × 360                                    |   132:42 |
| Feste Woche 600/480/360/600/270/0/0    | 4×600 + 5×480 + 5×360 + 5×600 + 4×270 − 2×600 − 270          |   153:30 |

## Abnahme und verbleibender Umfang

Eigene Integrationsfälle prüfen beide Sektoren, keine/regelmäßige/unbekannte Sonn-/Feiertagsarbeit, persönliche Minuten und gemeinsame Rundung, Tarifkonflikte, gespeicherte historische Angaben, ausdrückliche Scope-Ablehnung, untermonatliche Teilzeit/Stufe sowie einen echten späteren TV-UK-Wechsel. Eine gemeinsame Zahl wird in Monatsauswertung, Jahresübersicht, CSV, beiden PDF-Datenlayouts und Sondertagkalender geprüft. Speicher-/Reload-/Backup-Tests verwenden die echte SQL-Testdatenbank und den vorhandenen Save-Flow.

Die iPhone-Abnahme erfolgt separat mit der konkreten internen Preview. Exporte und CI sind kein Gerätenachweis. BT-V/SuE, Ausbildung, AVR/DRK und tatsächliche Ausgleichsansprüche bleiben getrennte Folgepakete.
