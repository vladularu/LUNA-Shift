# TVöD-B / BT-B: Sollzeit 2026–2027

## Auftrag und Abnahme

Ziel: Die bestehende automatische Sollzeit-Prognose um den eigenen TVöD-B-/BT-B-Adapter ergänzen. Vorhandene Wochenstunden, Arbeitsort, Tarif, Sonn-/Feiertagsangabe und historische Zeiträume werden verwendet. Keine zusätzlichen Einstellungen oder Einzelbestätigungen im normalen Ablauf. Plattform: gemeinsame TypeScript-Engine und bestehende iOS-Preview; keine neue Oberfläche oder native Integration.

Nicht-Ziele: TV-L, TV-H, TV-UK, Ausbildung, AVR, DRK, neue Gehaltsregeln, Zusatzurlaub, Zeitkonto oder Freizeitausgleich. TVöD VKA E und SuE werden nicht allein wegen eines Tabellen-/Variantennamens automatisch freigegeben.

Dateiscope (maximal 15 Dateien): die drei Domain-Dateien working-time-target.ts, working-time-target-validation.ts und saved-working-time-target.ts; Engine-Regeln, Engine, Berechnungsprofil, bestehende Automatiktests und neue BT-B-Tests; bestehendes Einstellungs-Formmodell mit Tests; bestehender Backup-Regressionstest; diese sowie Quellen-, Integrations- und Kalender-Abnahmedokumentation.

Abnahme: eigene Regel-IDs und Rechtsquellen, selbstständig hergeleitete Normal-/Sondermonate, vorhandener TVöD-K-Fall weiterhin 146:18, feste und wechselnde Verteilung, Teilzeit, historische Tarifwechsel, Dienstplan-/Prognosetrennung, unbekannte Voraussetzungen/Versionen, Backup-Rundlauf und unveränderte Gehalts-/Istberechnung. Typecheck, ESLint, fokussierte Tests, vollständiges verify:fast, iOS-Export und sieben PR-CI-Gates. Commit, Push, PR, Merge und interne Preview sind vom Nutzer freigegeben.

## Quellenprüfung vom 26.10.2026

- [BT-B, ÄTV 19, Stand 01.01.2026, VKA](https://vka.de/wp-content/uploads/2026/04/BT-B_AETV_19_Lesefassung_Stand-01_01_2026.pdf): § 40 begrenzt den Einrichtungs-/Arbeitgeberkreis gegenüber BT-K. § 49 Abs. 2 enthält die eigene Fünftelregel im regelmäßigen Siebentage-Schichtplan bei Arbeitspflicht oder unabhängig vom Feiertag planmäßig frei mit anderweitiger Erfüllung der Wochenzeit. § 49 Abs. 1 und Abs. 3 betreffen getrennte Ausgleichsansprüche. § 57 ist keine Befristung der Arbeitszeitnorm auf Ende 2026.
- [TVöD-AT 2026](https://www.kav-hessen.de/sites/default/files/2025-11/2fc7b3ed3c5d1eb8f6d08a3898a6af26/tvoed-at_ifv_aetv-22_1-1-26.pdf), [TVöD-AT 2027](https://www.kav-hessen.de/sites/default/files/2025-10/3822d822d89695ead0c2eed7e8b1f1aa/tvoed-at_ifv_aetv-22_1-1-27.pdf), jeweils § 6 Abs. 3: relevante Sondertagsregel unverändert. Freistellung/Ausfallstunden am 24./31.12. und Freizeitausgleich bei tatsächlicher Arbeit sind getrennt zu behandeln.
- [BAG 6 AZR 143/16](https://www.bundesarbeitsgericht.de/entscheidung/6-azr-143-16/): Entscheidung betrifft TVöD-K. Die ergänzend verwendete Samstagsauslegung wird hier als Übertragung auf den gleichlautenden BT-B-Tatbestand kenntlich gemacht; es wird keine eigene BT-B-Entscheidung behauptet. Maßgebliche Anspruchsquelle des neuen Adapters ist § 49 BT-B selbst.

Prüfdeckung: 01.01.2026–31.12.2027 nach aktuell veröffentlichten Texten. Spätere Jahre oder unbekannte Profilversionen bleiben vorläufig. Individuelle Wochenstunden werden verwendet; eine tarifliche Vollzeitdauer wird nicht aus dem Tarifnamen erfunden. Die Sonn-/Feiertagsangabe liefert weiterhin nur das Prognosemodell, keinen bestätigten individuellen Tagesanspruch.

## Unabhängige Kontrollwerte

Hessen, vertraglich 39 Stunden = 2.340 Minuten, Referenztag 468 Minuten. Kalenderzählung und Handrechnung, nicht aus der Implementierung abgeleitet:

| Monat / Modell                                    | Rechnung                      | Soll   |
| ------------------------------------------------- | ----------------------------- | ------ |
| Juli 2026 / ohne Sondertage                       | 23 × 468                      | 179:24 |
| Oktober 2026 / wechselnd, Samstag 03.10.          | 22 × 468 − 468                | 163:48 |
| Dezember 2026 / wechselnd                         | 23 × 468 − 4 × 468            | 148:12 |
| Dezember 2026 / fest Mo–Fr                        | 23 × 468 − 3 × 468            | 156:00 |
| Mai 2027 / wechselnd                              | 21 × 468 − 4 × 468            | 132:36 |
| Juli 2027 / ohne Sondertage                       | 22 × 468                      | 171:36 |
| Dezember 2027 / wechselnd                         | 23 × 468 − 3 × 468            | 156:00 |
| Dezember 2027 / fest Mo–Fr                        | 23 × 468 − 2 × 468            | 163:48 |
| Dezember 2026 / 30 Stunden, wechselnd             | 23 × 360 − 4 × 360            | 114:00 |
| Dezember 2027 / 30 Stunden, wechselnd             | 23 × 360 − 3 × 360            | 120:00 |
| Dezember 2026 / K 38,5 bis 15.12., B 39 ab 16.12. | 11 × 462 + 12 × 468 − 4 × 468 | 147:06 |

In der strikten Dienstplanrechnung setzen diese Abzüge explizite Voraussetzungen voraus. Die automatische Prognose verwendet die vertragliche Referenz unabhängig von eingetragenen Diensten und bleibt gekennzeichnet. 24./31.12. sind keine gesetzlichen Feiertage; ein Sonntag erzeugt keinen zusätzlichen Fünftelabzug.

## Daten- und Backup-Kompatibilität

Außerhalb der geprüften Jahre behält eine nur aus der Familie abgeleitete BT-B-Prognose die bisherige ausdrücklich vorläufige Referenz. Beispiel Dezember 2025 mit 39 Vertragsstunden: 23 Montag-bis-Freitag-Tage minus die beiden gesetzlichen Feiertage 25./26.12. ergeben 21 × 468 = 9.828 Minuten / 163:48. Daraus wird kein bestätigter BT-B-Anspruch abgeleitet. Ein expliziter individueller Anspruch bleibt ohne geprüfte Version offen.

Bestehende K-/Custom-/unbekannte Profile bleiben lesbar. Gespeicherte bekannte alte BT-B-Familienmarker werden ausschließlich im Berechnungsprofil erkannt, ohne Rückschreiben oder Anspruchsbestätigung. Ein mehrdeutiger Marker wird nicht aus dem heutigen Gehaltstarif rückwirkend als BT-B ausgelegt. Bestätigte historische Angaben und datierte Wechsel behalten Vorrang.

Der neue explizite BT-B-Tariftyp wird am gemeinsamen JSON-/Engine-Eingang validiert. Keine Datenbankmigration und keine Überschreibung von Bestandsprofilen. Ein Backup mit dem neuen Tariftyp benötigt eine App, die diesen Typ unterstützt; ältere Leser dürfen ihn nicht als BT-K oder eigenen Tarif umdeuten. Legacy-Backups bleiben in der neuen App lesbar. Der tatsächliche Export-/Restore-Rundlauf wird getestet.

## Umsetzung und Ergebnisse

Typecheck und 231 gezielte Tests in neun Dateien bestanden. Enthalten sind eigene BT-B-Referenzen, unveränderte K-Referenzen, Datenhistorie, Anspruchs-/Prognosetrennung, echte Backup-Wiederherstellung, gemeinsame Monats-/Jahreswerte sowie HTML/PDF- und CSV-Berichtsdaten. Die vorhandenen Architekturgrenzen bleiben unverändert.

Vollständiges verify:fast, endgültige Testzahlen, CI und der Preview-Lieferstand werden im zugehörigen Pull Request und Abschlussbericht dokumentiert. Es gibt keine neue Oberfläche und keine native Änderung. Die frühere iPhone-Abnahme der Kalenderanzeige wird ausdrücklich nicht als bereits erfolgte Geräteprüfung dieses neuen Tarifadapters dargestellt.
