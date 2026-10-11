# Brutto-Netto-Prototyp 2026

Stand: 9. Oktober 2026. Arbeitspaket 1 auf `codex/brutto-netto-prototype`, Basis `origin/master` (`94a95618552b15138ed5a88f70188550451b93a8`).

## Task-Vertrag

- Ziel: Einen offline berechenbaren, separat getesteten Netto-Kern für reguläre monatliche Arbeitnehmerentgelte im Jahr 2026 bereitstellen.
- Nicht-Ziele: App-Oberfläche, Profilpersistenz, Backupmigration, automatische SFN-Klassifikation, Tarifänderungen, produktive Aktivierung und Veröffentlichung.
- Plattform: Reines TypeScript/JavaScript für die Expo-SDK-57-App. Node-Tests und Browser-Bündelprüfung sind Entwicklungsnachweise; Hermes/iPhone-Abnahme steht aus.
- Dateiscope: Neue Domain-/Engine-Module und Tests, generierter BMF-Code samt Herkunft/Lizenz, offizielle XML- und Referenzfixtures, zwei Entwicklerskripte, diese Dokumentation sowie `package.json`/`package-lock.json` für die exakt gepinnte Dezimalbibliothek.
- Abnahme: Amtliche Referenzwerte für Lohnsteuer, Solidaritätszuschlag und Kirchensteuer-Bemessungsgrundlage stimmen centgenau überein; Sozialabgaben und Grenzen folgen geprüften Primärquellen; Sonderfälle bleiben explizit nicht verfügbar; `verify:fast` und fokussierte Tests bestehen.
- Screenshots: In diesem Paket keine UI-Änderung. Vor der späteren sichtbaren Integration ist eine iPhone-Abnahme erforderlich.
- Commit, Push, EAS Build, EAS Update, Merge und Store-Veröffentlichung: nicht freigegeben.

## Unterstützter Umfang

`calculateMonthlyNetPay(input)` berechnet einen vollständigen Monat 2026 bei regulärer Beschäftigung mit gesetzlicher Krankenversicherung und Krankengeldanspruch sowie Pflichtversicherung in RV/AV. Kranken- und Pflegebeiträge werden im angenommenen Fall vom Arbeitgeber einbehalten. Die regulären monatlichen SV-Einkünfte müssen über 2.000 Euro liegen. Zulässige Altersfälle beginnen bei 18 Jahren; Personen, die zu Jahresbeginn bereits 64 Jahre alt sind, werden wegen der noch nicht integrierten Altersentlastung ausgeschlossen.

Unterstützt sind Steuerklassen I–VI, Faktorverfahren in Klasse IV, monatlicher ELStAM-Freibetrag, Kinderfreibetragszähler, Kirchensteuersätze 0/8/9 Prozent, individueller GKV-Zusatzbeitrag, Kinderlosenzuschlag, Beitragsabschläge für berücksichtigungsfähige Kinder unter 25 und die Sachsen-Regel für den Beschäftigungsort.

Der Zuschlag für Kinderlose setzt erst nach dem Monat des 23. Geburtstags ein. Elterneigenschaft, Anzahl berücksichtigungsfähiger Kinder und steuerlicher Kinderfreibetragszähler sind getrennte Angaben. Der Aufrufer bestätigt die für den jeweiligen Monat gültige Anzahl der Kinder; deren Geburtsdaten/Änderungen werden in diesem Paket nicht gespeichert oder automatisch ermittelt.

Mini-/Midijobs, PKV, Mehrfachbeschäftigung, Einmalzahlungen, Zusatzabzüge (einschließlich bAV/VBL/ZVK), Teilmonate, Rentenbezug, Ausbildung und andere Versicherungsfälle sind nicht unterstützt. `specialCases: []` ist die ausdrückliche Zusicherung des Aufrufers, dass keiner dieser Fälle vorliegt. Klasse VI allein beweist keine Mehrfachbeschäftigung; das entsprechende Merkmal muss separat angegeben werden.

`netCents` bezeichnet das geschätzte Nettoentgelt vor nicht modellierten persönlichen Abzügen. Der Wert ist keine Zusage zur Bankauszahlung und keine Einkommensteuerveranlagung. Das Ergebnis übernimmt keine Bewertung der Vollständigkeit einer vorgelagerten Tarifprognose.

## Drei Bruttobeträge und SFN

Gesamtbrutto, steuerpflichtiges Brutto und SV-Brutto werden in ganzen Cent übergeben. Das reguläre monatliche SV-Brutto ist zusätzlich erforderlich, damit ein hoher Einzelmonat einen eigentlichen Midijob nicht versehentlich wie reguläre Beschäftigung behandeln lässt. Ein verfügbares Ergebnis verlangt die vollständigen Eingaben; Werte werden nicht automatisch ergänzt.

Die erste Schnittstelle unterstützt ausschließlich gewöhnliches steuer-/SV-pflichtiges Entgelt und bereits fachlich eingeordnete SFN-Anteile. Dafür gilt `steuerpflichtiges Brutto <= SV-Brutto <= Gesamtbrutto`. Sie akzeptiert keine anderen komplexen Steuer-/SV-Ausnahmen. Die eingegebenen Bemessungsgrundlagen sind Voraussetzungen, kein Nachweis der Steuerfreiheit.

Die bestehende `MonthlyPayEstimate`-Bruttosumme darf noch nicht direkt angeschlossen werden: Tarifliche Zuschlagsfenster, steuerlich begünstigte Zeitfenster, tatsächliche Arbeitsleistung, Grundlohn und Höchstgrenzen müssen vorher in einem separaten SFN-Modul abgeglichen werden. Steuerfreiheit nach § 3b EStG verwendet höchstens 50 Euro Grundlohn pro Stunde, SV-Freiheit höchstens 25 Euro. Ein tariflicher Zuschlag ist nicht automatisch steuerfrei. Geplante Dienste bleiben Prognosen, bis tatsächliche Arbeitsleistung und Abrechnungszuordnung bestätigt sind.

## Herkunft, Versionierung und Reproduktion

- Offizieller [BMF-PAP/XML 2026](https://www.bmf-steuerrechner.de/interface/pseudocodes.xhtml), heruntergeladen am 9. Oktober 2026. Datei: `scripts/fixtures/net-pay/Lohnsteuer2026.xml.gz`, SHA-256 des entpackten Originals `63d8981646d139eba2f4dd990c13b43c4fb3883b402a5a40cddf253aa7aa96b4`. XML-interner Stand: 23. Oktober 2025. Das deterministische Gzip-Archiv erhält die Originalbytes einschließlich amtlicher Einrückung und vermeidet deren Whitespace-Befunde im Git-Diff.
- [LstGen](https://github.com/jenner/LstGen), Commit `2e6342e3a33857fa0ee9d0d255c978c717c0df61`. Die PyPI-Version 0.7.1 enthält die TypeScript-Ausgabe noch nicht; daher wird für diesen Prototyp ausdrücklich der gepinnte Git-Quellstand verwendet. Generator ist MIT-lizenziert; Hinweis liegt bei `src/vendor/bmf/LICENSE-LstGen.txt`.
- `bigdecimal.js` exakt 1.7.2, Lizenz `GPL-2.0-only WITH Classpath-exception-2.0`. Diese Abhängigkeit ist nicht MIT-lizenziert. Für spätere Distribution müssen ihre Lizenz- und Copyright-Hinweise im Drittanbieter-Verzeichnis erhalten bleiben.
- Generierter PAP wird nicht manuell fachlich geändert. Das Skript normalisiert ausschließlich die Schreibweise von Arraytypen für die bestehende ESLint-Regel; anschließend läuft Prettier.
- In der App gibt es keine Netzwerkanfrage für diese Berechnung. Das eigenständige Referenzskript wird ausschließlich als ausdrücklich angestoßene Entwicklerprüfung verwendet.

Reproduktion in einer Python-Umgebung mit `lxml` und den LstGen-Abhängigkeiten:

```powershell
git clone https://github.com/jenner/LstGen.git artifacts/lstgen
git -C artifacts/lstgen checkout 2e6342e3a33857fa0ee9d0d255c978c717c0df61
python scripts/generate-net-pay-pap.py --lstgen-source artifacts/lstgen/src
npm.cmd exec -- prettier --write src/vendor/bmf/lohnsteuer2026.ts
```

Der Generator kontrolliert Git-Commit und XML-Prüfsumme vor dem Schreiben. Bei Änderungen der amtlichen Regeln müssen neue Quellen, Gültigkeiten und Referenzfälle gemeinsam geprüft werden. Für 2025 oder 2027 erfolgt ausdrücklich keine Wiederverwendung der 2026-Regeln.

Die BMF-Testschnittstelle darf ausschließlich zur Programmprüfung verwendet werden. Die Zustimmung zu ihrem Nutzungshinweis wurde vom Nutzer für die synthetischen Referenztests ausdrücklich freigegeben. Zum späteren Aktualisieren wird ein gültiger Testcode aus dem offiziellen Hinweis über `BMF_TEST_CODE` bereitgestellt; er wird nicht in die Fixture geschrieben:

```powershell
node scripts/refresh-net-pay-references.mjs
npm.cmd exec -- prettier --write scripts/fixtures/net-pay/bmf-2026-reference.json
npm.cmd test -- src/engine/net-pay.test.ts
```

## Fachliche Quellen

- [BMF: Programmablaufpläne, Rundungen und Abgrenzung zu Sozialabgaben](https://www.bmf-steuerrechner.de/interface/programmablauf.xhtml)
- [BMF: Reichweite des Testzugangs](https://www.bmf-steuerrechner.de/interface/einganginterface.xhtml)
- [BMAS: SV-Rechengrößen 2026](https://www.bmas.de/DE/Service/Gesetze-und-Gesetzesvorhaben/sozialversicherungs-rechengroessenverordnung-2026.html)
- [TK: Beitragssätze 2026](https://www.tk.de/firmenkunden/versicherung/beitraege-faq-und-mehr/beitragssaetze/hoehe-tk-beitragssaetze-2032248)
- [TK: Beitragsberechnung und separate GKV-Anteile](https://www.tk.de/firmenkunden/versicherung/beitraege-faq-und-mehr/basiswissen-beitraege/beitraege-zur-sozialversicherung-berechnen-2031348)
- [§ 2 BVV: Berechnung und Rundung der Beitragsanteile](https://www.gesetze-im-internet.de/beitrvv/__2.html)
- [BMG: Pflegeversicherung, Elterneigenschaft und Sachsen](https://www.bundesgesundheitsministerium.de/themen/pflege/online-ratgeber-pflege/die-pflegeversicherung/finanzierung)
- [§ 55 SGB XI: Kinderlosenzuschlag und Altersgrenze](https://www.gesetze-im-internet.de/sgb_11/__55.html)
- [DRV: SFN-Steuer-/Beitragsfreiheit](https://www.deutsche-rentenversicherung.de/DRV/DE/Experten/Arbeitgeber-und-Steuerberater/summa-summarum/Lexikon/S/steuerfreie_sfn_zuschlaege.html)
- [§ 9 AVKirchStG Bayern: Centbruchteile bleiben unberücksichtigt](https://www.gesetze-bayern.de/Content/Document/BayAVKirchStG-9)
- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)

## Entwicklungsnachweise

- 38 synthetische BMF-Referenzfälle wurden am 9. Oktober 2026 live abgerufen und als feste Fixture gespeichert: alle Steuerklassen, Faktorgrenzen, Kinder-/Sachsen-Fälle, GKV-Zusatzbeiträge, Freibetrag, Beitragsgrenzen, Soli bei höherem Einkommen und 23. Geburtstag.
- 105 fokussierte Tests bestehen. BMF-Werte werden mit unabhängig gespeicherten Schnittstellenergebnissen verglichen; zusätzliche Tests prüfen SV-Beträge nach den Quellen, separate Rundung, Netto-Abstimmung, getrennte Bemessungsgrundlagen, unveränderliche Ergebnisse und Fehlerfälle.
- Keine manuelle Lohnabrechnung und kein TK-Webrechner-Ergebnis als zusätzliche End-to-End-Referenz erfasst. Die SV-Fälle prüfen die dokumentierten gesetzlichen Formeln und Werte.
- Der Kern wurde mit esbuild als Browser-Bündel für ES2022 gebaut: sieben gebündelte Quelldateien, keine externen Imports. Das Bündel wurde anschließend unter Node ausgeführt und lieferte ebenfalls 313.009 Cent Netto. Das ist keine Abnahme in einem Browser oder auf dem iPhone.
- Die erneute Generierung samt Prettier ergibt denselben SHA-256 für die TypeScript-Datei: `638ec3b4fe8b4531169af5a0fac1158ddcb267774cc2773b11829a05e1c20cd8`.
- `npm.cmd run verify:fast` besteht vollständig: Regelverträge, Typprüfung, Lint ohne Warnungen, Formatierung, 7.776 Unit-Tests in 402 Dateien, 808 Komponententests in 108 Suiten sowie Publisher-, Delivery-, Produktions-, Operator-, Inventar-, Sicherheits-, Runtime- und Build-Dependency-Prüfungen. Bei einem ersten Lauf fehlten die bestehenden Postinstall-Schutzpatches im frischen Checkout; nach dem vorgeschriebenen Nachinstallationsskript ist auch die vollständige Wiederholung grün. Das lokale Laufprotokoll liegt in `artifacts/verify-fast.log`.
- iPhone/Hermes ist noch nicht geprüft. Der Code wird noch nicht von einem App-Nutzerfluss importiert.

### Nachvollziehbarer Beispielfall

5.000 Euro Monatsbrutto, Steuerklasse I, keine Kirchensteuer, kinderlos über 23, Beschäftigungsort außerhalb Sachsens, voller GKV-Zusatzbeitrag 2,90 Prozent, keine weiteren Abzüge:

| Posten                                      |     Betrag |
| ------------------------------------------- | ---------: |
| Gesamtbrutto                                | 5.000,00 € |
| Lohnsteuer                                  |   782,41 € |
| Solidaritätszuschlag / Kirchensteuer        |     0,00 € |
| Krankenversicherung inklusive Zusatzbeitrag |   437,50 € |
| Pflegeversicherung                          |   120,00 € |
| Rentenversicherung                          |   465,00 € |
| Arbeitslosenversicherung                    |    65,00 € |
| Geschätztes Netto                           | 3.130,09 € |

## Folgende Arbeitspakete

1. SFN-Klassifikation und Abrechnungszuordnung mit geprüften Grundlohn-/Zeitsegmentregeln; Fälle mit unvollständigem Brutto bleiben nicht verfügbar.
2. Monatlich gültiges Steuerprofil, lokale Speicherung, Validierung sowie Backupkompatibilität.
3. Gehaltskarte mit nachvollziehbaren Abgaben und klarer Prognosekennzeichnung; Abnahme auf dem iPhone.
4. Gesonderte Unterstützung für Zusatzversorgung, weitere Abzüge und zusätzliche Beschäftigungs-/Versicherungsfälle.

Commit-/Verteilungsgates werden nach den erfolgreichen fachlichen und technischen Prüfungen getrennt behandelt.
