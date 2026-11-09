# Korrektur der Prüfung und kompakte Dienstübersicht

## Auftrag

Nutzerfeedback vom 08.11.2026: Sechs oder sieben Dienste in Folge sollen nicht als pauschaler Rechtsverstoß erscheinen. Der freiwillige Hinweis bei drei Wochenenden in Folge fehlt. Die einzelnen großen Dienstblöcke beanspruchen zu viel Platz.

Zielplattform ist die bestehende iPhone-Preview, Hell/Dunkel und große Schrift. Ausgangspunkt ist die tatsächlich veröffentlichte Gruppe `d02074b8-98a3-4abd-96b8-f551ab43f046`, Source-Digest `23b663d5408fc85dcc19efa533e6bb63d971a283c2b6b8f260ba84bfe1bdd6f5`. Lokaler Branch: `codex/pruefung-wochenenden-kompakt`; alle bisherigen Dateien und der veröffentlichte Source-Stand wurden unter `artifacts/check-correction/before.json` und `before/` gesichert.

Expo bleibt bei `~57.0.31`; die SDK-57-Dokumentation wurde vor Änderungen geprüft. Keine neue native Integration, Abhängigkeit, Gehalts-/Sollzeitänderung, Datenmigration oder Änderung signierter Regelpakete. Die bestehende Oberfläche und insbesondere Info-Symbol, neutrale Flächen, Petrolrahmen und getrennte Empfehlungsschalter bleiben erhalten. Dieser Korrekturauftrag enthält keine neue Commit-, Push-, Build- oder OTA-Freigabe.

## Getrennte Arbeitspakete

1. **Tariflicher Auslöser:** Sechs belegte Tage allein erzeugen keinen Wochenverteilungs-Prüfpunkt mehr. Sieben belegte Kalendertage derselben Woche bleiben ein neutraler Prüfpunkt zur Einordnung der regelmäßigen Arbeitszeit, kein automatisch festgestellter Verstoß. Eine Dienstserie über den Wochenwechsel ist ein anderer Sachverhalt. Datierter Geltungsbereich, Voraussetzungen und tarifliche freie Tage bleiben eigenständig.
2. **Wochenendhinweise:** Wiederaufnahme als freiwilliger Hinweis ab dem dritten belegten Wochenende in Folge, mit dynamischer Anzahl und nachvollziehbarem Zeitraum. Wochenenden umfassen Samstag/Sonntag; tatsächliche oder klar geplante Dienstüberschneidungen und Nachtausläufe werden berücksichtigt. Monats-/Jahresübergänge werden anhand eindeutiger Befundanker zugeordnet. Fortgesetzte Serien bleiben im jeweiligen Folgemonat erkennbar; eine identische Wochenendbeobachtung darf nicht doppelt gezählt werden.
3. **Darstellung und Konsistenz:** Dienstübersicht anfangs geschlossen, aufklappbar als kompakte Tabelle mit Datum, Dienst und Uhrzeit. Nachtüberlauf sichtbar, große Schrift und VoiceOver erhalten. Der tatsächliche Endzeitpunkt einer Dienstserie wird erläutert, ohne aus einem Nachtauslauf einen zusätzlichen Dienst zu machen. Monats-/Jahrescaches werden für die veränderten Regeln erneuert. Gemeinsame Referenztests und exakter Quellvergleich schließen die Pakete ab.

Jedes Paket bleibt unter 15 Dateien oder wird bei Bedarf vor Erweiterung weiter geteilt. Die Implementierung erfolgt mit neuen roten Regressionstests, anschließend grünen Fach-/Komponententests und unabhängigem Review.

## Quellen und Aussagegrenzen

[TVöD AT § 6 Abs. 1 Satz 3, Stand 01.01.2026](https://www.vka.de/assets/media/docs/0/Tarifvertr%C3%A4ge/TVoeD_AT_AETV_22_Lesefassung_Stand_01_01_2026.pdf) unterscheidet die Verteilung auf fünf und aus notwendigen betrieblichen/dienstlichen Gründen auf sechs Tage. Die App kann aus einer bloßen Anzahl weder alle persönlichen Voraussetzungen noch eine rechtswidrige Anordnung beweisen. Sie bestätigt auch nicht pauschal, dass jede Siebentagesverteilung zulässig wäre.

Die [BGW](https://www.bgw-online.de/bgw-online-de/themen/sicher-mit-system/gesundheit-managen/schichtarbeit/schichtarbeit-verlaesslich-planen-und-beschaeftigte-einbinden-24194) empfiehlt möglichst ganze freie Wochenenden. Die Quelle nennt keine allgemeine gesetzliche Höchstzahl von zwei gearbeiteten Wochenenden. Der dritte belegte Wochenendtermin ist hier der ausdrücklich gewünschte LUNA-Auslöser, keine der BGW zugeschriebene harte Grenze. Leere Kalendertage bestätigen keine tatsächlich genommene Freizeit.

## Abnahmefälle

- Der Screenshotplan mit sechs belegten Tagen in den Wochen 26.10.–01.11. und 23.–29.11. erhält hierfür keine pauschalen Tarifkarten.
- Die freiwillige Dienstserienempfehlung bleibt unabhängig davon verfügbar; gesetzliche und tarifliche Prüfungen bleiben bei ausgeschalteten Empfehlungen sichtbar.
- Die belegten Wochenenden 14./15., 21./22. und 28./29.11. erzeugen einen freiwilligen Dreierhinweis. Bei Fortsetzung am 05./06.12. bleibt November nachvollziehbar bei drei, Dezember weist die fortgesetzte Viererserie aus.
- Der letzte Nachtdienst am 29.11., 21:00, endet tatsächlich am 30.11., 07:30. Die Dienstübersicht erklärt diesen Überlauf, zählt ihn nicht als siebten gesonderten Dienst.
- Zugehörige Dienste sind anfangs platzsparend zusammengefasst und aufklappbar; Quellen und Erklärungen bleiben im selben Detailfenster erreichbar.
- Monatsauswertung, Jahreszählung, Export, Cache-Neuberechnung und Jugendschutz behalten ihre getrennten fachlichen Rollen.

## Prüfstatus

- Fachlogik: 117 gezielte Tests in fünf Suiten grün. Dazu gehören sechs gegen sieben belegte Kalendertage, drei/vier Wochenenden, Monats-/Jahresgrenzen, Nachtausläufe, Teilzeiten, Zeitzonen, Pausenpositionen, alte Metadaten und gelöschte beziehungsweise überarbeitete Einträge.
- Darstellung: 51 gezielte Fachtests und 53 Renderertests in vier Komponentensuiten grün. Die bestehende Gruppierungsprüfung erwartet jetzt ausdrücklich geschlossene Dienstlisten und prüft dieselben Dienstangaben nach dem Öffnen. Der erste Gesamtlauf hatte nur diese alte Sichtbarkeitserwartung beanstandet; sein Protokoll bleibt unter `artifacts/check-correction/verify-fast-first.log` erhalten.
- Integration und Export: 60 Tests grün, darunter der nachgebaute Screenshotplan, Monats-/Jahresauswertung, Empfehlungsschalter, Cache-Version und lesbare deutsche Exportfelder.
- Unabhängiges Review: keine offenen notwendigen Befunde. Zwei gefundene Sonderfälle wurden mit zunächst roten Regressionen geschlossen: spätere zusätzliche Teilzeiten und zeitlich bekannte Bereitschaftspausen an der Wochenendgrenze. Auch die nachträgliche Gruppierungs-Testanpassung wurde separat gegengeprüft.
- Quellvergleich: elf gezielte Appdateien gegenüber der veröffentlichten Preview geändert; der übrige Preview-Quellstand, native Konfiguration, Abhängigkeiten und die akzeptierte TestFlight-Baseline bleiben erhalten. Korrigierter Source-Digest: `e4bae6792be3b6267eb73ab285909cfd5cff0d063e21fac18ba92b53ec84c44e`.

Das abschließende `npm.cmd run verify:fast` ist vollständig grün: Typprüfung, Lint, Formatierung, 558 Vitest-Suiten mit 10.624 Tests, 202 Komponentensuiten mit 1.944 Tests sowie Regelpaket-, Sicherheits-, Laufzeit- und weitere Projektprüfungen. Wegen bekannter CPU-Last der Jahresprüfungen wurde ausschließlich die unterstützte Vitest-Parallelität auf zwei Worker begrenzt; Testzeitgrenzen und Prüfschwellen blieben unverändert.

Auch `APP_VARIANT=internal npm.cmd run export:ios` ist erfolgreich; der lokale iOS-JavaScript-/Asset-Export liegt in `dist/ios`. Protokolle, Exitcodes, Dateihashes und abschließender Quellvergleich stehen unter `artifacts/check-correction/`, insbesondere `final-validation.json`. Dieser lokale Export ist kein nativer EAS-Build und keine OTA-Veröffentlichung.

Keine Veröffentlichung und keine Geräteabnahme: Die neue Preview-OTA benötigt eine eigene Freigabe. Danach sind auf dem iPhone Hell/Dunkel, große Schrift, der November-Wochenendhinweis, die abgeschalteten Empfehlungen sowie Öffnen/Schließen der kompakten Dienstlisten abzunehmen. Der bestehende veröffentlichte Stand und seine Veröffentlichungsbelege bleiben unverändert.
