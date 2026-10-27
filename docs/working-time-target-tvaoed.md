# TVAöD Pflege: automatische Sollzeitreferenz

## Geprüfter Umfang

Paket vom 27.10.2026, aufgeteilt in Fachmodell und Anbindung der vorhandenen Einstellung. Berechnungsdeckung 2026–2027. Die gespeicherte Pflege-Auswahl enthält Ausbildungsjahr, BT-K/BT-B und KAV-Region. Vertragsminuten, Arbeitsort, Sonn-/Feiertagsantwort und datierte Beschäftigungsdaten werden übernommen; keine neue Frage oder zweite Beschäftigungsmaske.

Primärquellen, erneut am 27.10.2026 geprüft:

- [TVAöD BT Pflege, ÄTV 18 vom 06.04.2025, Quellenstand 01.07.2025](https://vka.de/wp-content/uploads/2026/04/TVAOED_BT-Pflege_AETV_18_Lesefassung_Stand_01_07_2025.pdf), § 1a und § 7 Abs. 1–3: Der Erwachsenenpfad verweist auf die Arbeitszeitvorschriften für Beschäftigte des Ausbildenden. Sonn-/Feiertags- und Nachtausbildung ist im Ausbildungszweck zulässig, aber eine Erlaubnis belegt keinen regelmäßigen persönlichen Schichtbetrieb. Die BW-/BT-K-Ausnahme ist ausdrücklich erwähnt.
- [TVAöD AT, ÄTV 14 vom 06.04.2025, Stand 01.08.2025](https://vka.de/wp-content/uploads/2026/04/TVAOED_AT_AETV_14_Lesefassung_Stand_01_08_2025.pdf), § 1 und § 12a Abs. 3: Geltungsbereich und entsprechende Anwendung der Arbeitsbefreiungsregeln des Ausbildenden. Die eigene Ausbildungsfreistellung zur Prüfungsvorbereitung ist kein pauschaler Monatsabzug.
- [TVöD BT-K, ÄTV 15, Stand 01.01.2026](https://vka.de/wp-content/uploads/2026/10/250406_BT-K_AeTV_15_Lesefassung_Stand-01.01.2026.pdf), §§ 44 und 49: BW-/BT-K-Ausbildung 38,5 Stunden; eigene Feiertagsregel des hinterlegten Arbeitgeberbereichs. Für die Prognose führen immer persönliche Vertragsminuten, nicht die Erwachsenen-Vollzeitbasis in BW.
- [TVöD BT-B, ÄTV 19, Stand 01.01.2026](https://vka.de/wp-content/uploads/2026/04/BT-B_AETV_19_Lesefassung_Stand-01_01_2026.pdf), §§ 40 und 49; [TVöD AT 2026](https://vka.de/wp-content/uploads/2026/04/TVoeD_AT_AETV_22_Lesefassung_Stand_01_01_2026.pdf), § 6 Abs. 3; [TVöD AT 2027](https://www.kav-hessen.de/sites/default/files/2025-10/3822d822d89695ead0c2eed7e8b1f1aa/tvoed-at_ifv_aetv-22_1-1-27.pdf). Die bestehenden [2027-](working-time-target-2027.md) und [BT-B-Prüfungen](working-time-target-b.md) bleiben eigenständig.
- [§ 8 JArbSchG](https://www.gesetze-im-internet.de/jarbschg/__8.html) und [§ 18 JArbSchG](https://www.gesetze-im-internet.de/jarbschg/__18.html): eigenständige zeitliche Schutzregeln und Feiertagsfreistellung. Kein pauschaler Abgleich mit einer Erwachsenen-Fünftelregel. [§ 18 PflBG](https://www.gesetze-im-internet.de/pflbg/__18.html) betrifft unter anderem die Ausbildungsorganisation/Freistellung, keine zusätzliche pauschale Sollzeitgutschrift aus der bloßen Kalendereingabe.

Die Übernahme der Feiertags-/Sondertagreferenz ist eine Herleitung aus den Verweisnormen für einen bedingten Planwert. Ein spezielles BAG-Urteil zur konkreten TVAöD-Pflege-Feiertagskonstellation wurde nicht identifiziert. Ein Ausbildungsentgelt, Ausbildungsjahr oder deaktivierter Jugendschutzschalter bestätigt keine individuellen Anspruchsvoraussetzungen.

## Modell und Grenzen

Eigene interne Tarifkennungen `TVAOED_K` und `TVAOED_B`, Quellenversionskennung `2025-07-01` (Ausgabe des BT Pflege, kein behauptetes Inkrafttreten aller Normen an diesem Tag). Eigene Regel-IDs je Arbeitgeberbereich und Berechnungsjahr. Verweisprovenienz bleibt sichtbar, die zentrale Fünftel-/Ausfall-/Rundungsrechnung wird wiederverwendet. 24./31.12. sind tarifliche Sondertage, gesetzliche Feiertage stammen aus Arbeitsort und Datum.

`scopeConfirmed` umfasst bei dieser Familie auch die Voraussetzungen des Erwachsenen-Verweises. Die automatische Ableitung setzt es immer auf null. Ohne datierten Altersnachweis wird keine Volljährigkeit behauptet. Die Referenz ist deshalb vorläufig und wird in der bestehenden aufklappbaren Erklärung als Erwachsenen-Verweis nach § 7 bezeichnet. Ein normaler Monat erzeugt ebenfalls diese Erklärung; es gibt keine Abfrage zu jedem einzelnen Tag.

Aktiver Jugendschutz sperrt den Erwachsenenpfad für Ausbildungsperioden. Statt einer ungeprüften Minderjährigenzahl erscheint „Nicht verfügbar“ mit einem konkreten Hinweis. Während die bestehende Einstellung lädt oder nicht gelesen werden kann, wird ebenfalls kein Erwachsenenwert gezeigt. Nicht-Ausbildungsperioden bleiben davon unberührt. Die aktuelle, undatierte Einstellung erzeugt keine erfundene Altersgeschichte; eine später benötigte Minderjährigenprognose erfordert eine eigene Prüfung und geeignete zeitliche Daten.

Die vorhandene Einstellung wird über einen anwendungsinternen Kontext weitergegeben; der Einstellungsprovider steht dafür außerhalb des Datenproviders. Anwendung und Engine importieren keine Feature-Einstellungen. Es entstehen keine Native-, SQL- oder Cloud-Konfigurationsänderungen.

## Historie und Kompatibilität

Die gemeinsame Beschäftigungszeitleiste übernimmt spätere Teilzeit-, Ausbildungsjahr- und Tarifwechsel. Ein altes UNVERIFIED/TVAOED ohne Bereich bleibt unbekannt, solange kein für das Datum gespeichertes Beschäftigungsprofil den Bereich liefert. Ein expliziter finanzieller TVAöD-Pflege-Eintrag mit BT-K/BT-B kann die Familie liefern, aber keine Volljährigkeit oder endgültigen Tagesanspruch bestätigen.

Gesamtzeitraum-Korrekturen verwenden die bereits geprüfte Vorrangregel. Echte spätere Tarifwechsel bleiben erhalten. Alte Sollzeitkontexte werden nicht umgeschrieben. Neue Tarifkennungen sind strikt validiert und in der vorhandenen Backupversion 21 lesbar; keine Schema-/Versionsanhebung. Ältere Clients kennen neue Kennungen gegebenenfalls nicht und dürfen sie nicht still in Beschäftigtentarife umdeuten.

Dienst-, Frei- oder Unterrichtseinträge verändern die Vertragsprognose nicht. Schul-/Praxis-Istzeit, Unterrichts-/Wegezeitanrechnung, Urlaub/Krankheit, Prüfungsvorbereitung, FZA, Ersatzruhe, Zuschläge und Geldalgorithmen sind nicht Bestandteil dieses Pakets.

## Unabhängige Kontrollwerte

HE, 2310 Wochenminuten = 38,5 Stunden; Fünftel 462 Minuten. Werte gelten als bedingte Erwachsenen-Referenz für den gespeicherten Bereich BT-K oder BT-B.

| Fall                                                  | Kalenderrechnung                                           |  Minuten / Soll |
| ----------------------------------------------------- | ---------------------------------------------------------- | --------------: |
| Juli 2026                                             | 23 × 462                                                   |  10626 / 177:06 |
| Oktober 2026                                          | (22 − Samstag 03.10.) × 462                                |   9702 / 161:42 |
| November 2026 / HE                                    | 21 × 462                                                   |   9702 / 161:42 |
| Dezember 2026 / wechselnde Tage                       | (23 − 24.,25.,26.,31.12.) × 462                            |   8778 / 146:18 |
| Dezember 2026 / feste Mo–Fr                           | (23 − 24.,25.,31.12.) × 462                                |   9240 / 154:00 |
| Dezember 2027 / wechselnde Tage                       | (23 − 24.,25.,31.12.) × 462; Sonntag 26.12. ausgeschlossen |   9240 / 154:00 |
| Dezember 2026 / 39 Stunden                            | 19 × 468                                                   |   8892 / 148:12 |
| Dezember 2026 / 30 Stunden                            | 19 × 360                                                   |   6840 / 114:00 |
| Dezember 2026 / 2311 Minuten                          | runden(19 × 2311 / 5)                                      |   8782 / 146:22 |
| Teilzeit ab 16.12.2026                                | 11 × 462 + (12 − 4) × 360                                  |   7962 / 132:42 |
| Jugendschutz aktiv / Einstellung lädt oder fehlerhaft | kein Erwachsenenwert für Ausbildungsperioden               | nicht verfügbar |

## Prüfung und Auslieferung

Eigene Regressionen für beide Bereiche, persönliche Minuten, BW-Ausbildungsbasis, historische Profile, Mehrdeutigkeiten, Ausbildungsjahr/Teilzeit, tatsächlichen späteren Tarifwechsel, aktive/fehlende/ladende/fehlerhafte Jugendschutz-Einstellung und alte bestätigte Kontexte. Echte SQL-Save/Reload/Backup-Fälle sowie Monats-/Jahres-/CSV-/PDF-Datenvergleich. Oberfläche und Provider-Verbindung erhalten eigene Komponententests. Anschließend Gesamtprüfung und PR-CI auf eingefrorenem Stand; interne iOS-Preview und reale Geräteabnahme bleiben separate Nachweise.
