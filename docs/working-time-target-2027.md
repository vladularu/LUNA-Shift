# TVöD-K: geprüfte Sollzeitregeln 2027

## Auftrag und Abnahme

Ziel: Die zentrale Sollzeit-Engine für das Kalenderjahr 2027 anhand veröffentlichter Tariftexte prüfen und erweitern. Bestehende Profile mit Versionskennung `2026-01-01` bleiben gültig; historische Ergebnisse und Regel-IDs für 2026 bleiben erhalten. Plattform: bestehende iOS-App, gemeinsame TypeScript-Engine für Auswertung und Exporte. Keine neue Oberfläche und keine native Änderung.

Nicht-Ziele: andere Tarifadapter, Gehaltsänderungen, Zusatzurlaub, Zeitkonto oder Freizeitausgleich. Keine neue Profilabfrage, Migration oder Tarifbindung aus einem Gehaltstabellennamen.

Dateiscope: `working-time-target-rules.ts`, `working-time-target.ts`, die bestehenden Sollzeittests, neue 2027-Regressionstests und diese sowie die bestehende Quellen-/Integrationsdokumentation. Abnahme: unabhängige Kontrollwerte, unveränderte 2026-Referenz, unbekannte Versionen und 2028 weiterhin vorläufig; Typecheck, ESLint, fokussierte Tests, `verify:fast`, iOS-Export und PR-CI.

## Quellenprüfung vom 26.10.2026

- [TVöD-AT, ÄTV 22, Stand 01.01.2027](https://www.kav-hessen.de/sites/default/files/2025-10/3822d822d89695ead0c2eed7e8b1f1aa/tvoed-at_ifv_aetv-22_1-1-27.pdf), § 6 Abs. 3, Druckseite 11: Die für 24./31. Dezember maßgebliche Regel ist gegenüber der veröffentlichten AT-Fassung 2026 unverändert. Freistellung/Ausfallstunden und gesonderter Freizeitausgleich bei Arbeit bleiben zu unterscheiden.
- [BT-K, ÄTV 15, Stand 01.01.2026, aktuell bei VKA verlinkt](https://vka.de/wp-content/uploads/2026/10/250406_BT-K_AeTV_15_Lesefassung_Stand-01.01.2026.pdf), § 49 Abs. 2, Druckseiten 10–11: Fünftelregel im regelmäßigen Siebentage-Schichtplan bei Arbeitspflicht oder unabhängig vom Feiertag planmäßig frei mit anderweitig zu erfüllender Wochenzeit. Der Katalogeintrag vom 08.10.2026 enthält weiterhin diese Fassung. Eine neuere einschlägige Änderung wurde nicht gefunden.
- [Hessische Feiertagsübersicht](https://innen.hessen.de/buerger-staat/feiertage): gesetzliche Feiertage nach Arbeitsort; 24./31. Dezember werden ausschließlich als tarifliche Sondertage geführt.

Die zeitliche Prüfdeckung ist keine Behauptung, der Tarif ende am 31.12.2027. Entgelttabellenlaufzeiten bestimmen nicht automatisch die Geltung dieser Arbeitszeitnormen. Der veröffentlichte AT-Stand für 2027 und die unveränderte BT-K-Norm tragen die hier begrenzte Prüfung. Spätere Änderungen sind erneut zu prüfen.

## Unabhängige Kontrollwerte

Kalendertage mit Python-Standardbibliothek gegenkontrolliert; Minuten aus der dokumentierten Regel von Hand berechnet. Vertragswoche 2.310 Minuten, Referenztag 462 Minuten, Hessen. Prognosen verwenden das vertragliche Referenzmodell und bleiben als Prognose gekennzeichnet. Sichere Tagesansprüche erfordern in der getrennten Dienstplanrechnung weiterhin explizite Voraussetzungen.

| Monat / Modell                                 | Rechnung                                    | Soll   |
| ---------------------------------------------- | ------------------------------------------- | ------ |
| Dezember 2026 / wechselnd                      | 23 × 462 − 4 × 462                          | 146:18 |
| Januar 2027 / wechselnd                        | 21 × 462 − Neujahr 462                      | 154:00 |
| Mai 2027 / wechselnd                           | 21 × 462 − 4 × 462 (01., 06., 17., 27.05.)  | 130:54 |
| Mai 2027 / fest Mo–Fr                          | 21 × 462 − 3 × 462                          | 138:36 |
| Juli 2027 / beide Modelle                      | 22 × 462                                    | 169:24 |
| Dezember 2027 / wechselnd                      | 23 × 462 − 25.12. − 24.12. − 31.12., je 462 | 154:00 |
| Dezember 2027 / fest Mo–Fr                     | 23 × 462 − 24./31.12., je 462               | 161:42 |
| Dezember 2027 / halbe Vertragswoche, wechselnd | 23 × 231 − 3 × 231                          | 77:00  |

Der 26.12.2027 ist Sonntag und erzeugt keinen zusätzlichen BT-K-Abzug. Der 25.12. ist Samstag und fällt ausschließlich im passenden wechselnden Modell unter die Fünftelregel. Bei fester Woche setzt die strikte Sondertagsrechnung die bestätigte Freistellung/Ausfallzeit voraus.

## Umsetzung und Prüfung

Wird nach den Prüfungen ergänzt.
