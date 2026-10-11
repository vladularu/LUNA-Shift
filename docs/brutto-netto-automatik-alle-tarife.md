# Recherche: automatische Netto-Prognose für alle Tarife

Stand: 10. Oktober 2026. Untersucht wurde der veröffentlichte Brutto-Netto-Teststand im Checkout `codex/brutto-netto-prototype`, Basisrevision `94a95618552b15138ed5a88f70188550451b93a8`, mit Expo `~57.0.22`. Dieser Bericht beschreibt den nächsten Ausbau; er erweitert die veröffentlichte App noch nicht.

Die inzwischen freigegebene lokale Umsetzung und ihre konkreten Grenzen stehen im [Umsetzungsbericht](brutto-netto-automatik-umsetzung.md). Der folgende Recherchetext bleibt als Ausgangsbefund erhalten.

## Ergebnis und Ziel

Empfohlen wird ein gemeinsamer Netto-Rechner für alle Tarifmodelle, gespeist aus den vorhandenen Vergütungsberechnungen. Der Nutzer richtet seine persönlichen Steuer-, Versicherungs- und Zusatzversorgungsangaben einmal ein. Danach übernimmt LUNA monatlich Tabellenentgelt, Teilzeitumfang, Zulagen und Zuschläge und zeigt die Netto-Prognose automatisch in der Gehaltskarte.

„Alle Tarife“ umfasst hier sämtliche vorhandenen Gehaltsmodelle, die zusätzlichen Tarifmodule und weitere Tarife über denselben Anschluss. Ausbildung gehört zum Ausbauziel. Die Verfügbarkeit eines Tarifpakets allein belegt allerdings noch keine vollständige Brutto- oder Netto-Berechnung.

Zielplattform: iPhone, lokal und offline. Dateiscope dieser Recherche: ausschließlich dieser Bericht. Nicht Bestandteil: Änderungen am Rechner, Veröffentlichung oder Git-Delivery.

## Was der verlinkte Rechner vormacht

Der [TVöD-P-Rechner 2026](https://oeffentlicher-dienst.info/c/t/rechner/tvoed/p?id=tvoed-p-2026) fragt Entgeltgruppe, Stufe, Arbeitszeitanteil, Zusatzversorgung, Pflege-/Schichtzulagen und weitere monatliche Zulagen ab. Hinzu kommen Steuerjahr, Steuerklasse, Faktor IV, Kirchensteuer, Kinderfreibeträge, Kinder für die Pflegeversicherung und Krankenkassenbeitrag. Die verlinkte Tarifperiode reicht vom 1. Mai 2026 bis 31. März 2027; Tarifperiode und Steuerjahr sind daher getrennt zu behandeln.

Der [DRK-Rechner 2026](https://oeffentlicher-dienst.info/c/t/rechner/einstieg?id=drk-2026) verwendet ebenfalls Tarifgruppe/Stufe, Arbeitszeit, monatliche Zulagen, Zusatzversorgung und persönliche Steuer-/Versicherungsdaten. Das unterstützt die Empfehlung eines gemeinsamen Netto-Kerns mit tarifabhängiger Brutto-Ermittlung.

In der gelesenen TVöD-P-Formularansicht werden keine individuellen Dienstintervalle übernommen. LUNA kann diese bereits aus dem Kalender beziehen. Die Übernahme des Bedienprinzips ist sinnvoll; die minutengenaue Verarbeitung der eigenen Dienste ist eine zusätzliche Aufgabe.

Eine öffentliche Entwickler-API dieses Anbieters wurde in dieser Recherche nicht verifiziert. Für LUNA ist die lokale Berechnung mit eigenen Tarifdaten und amtlichem Steuerverfahren deshalb der geeignete Ausgangspunkt. Der Webrechner dient als Vergleich für ausgewählte synthetische Fälle.

## Welche Eingaben automatisch übernommen werden sollten

| Angabe                                                               | Quelle in LUNA                                                   | Bedienung im Zielablauf                                                   |
| -------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Tarif, Variante, Region, Gruppe und Stufe                            | Gültiges Gehalts-/Vergütungsprofil                               | Bereits vorhandene Auswahl übernehmen                                     |
| Tabellenentgelt und Teilzeitumfang                                   | Tarifversion, Vertragsstunden, tarifliche Vollzeit               | Automatisch berechnen; feste Monatsgehälter nach Vertrag behandeln        |
| Eigener Monatslohn/Stundenlohn                                       | Eigene Vergütungskonfiguration                                   | Gespeicherten Betrag beziehungsweise Stundenlohn verwenden                |
| Nacht-, Sonntags- und Feiertagszuschläge                             | Dienste, Pausen, Arbeitsort und Tarifregeln                      | Automatisch nach Zeitintervallen berechnen                                |
| Pflege-, Schicht- und andere laufende Zulagen                        | Tarifregeln und vorhandene Anspruchsentscheidungen               | Bestehende Angaben wiederverwenden; nur fehlende Voraussetzungen erfragen |
| Mehrarbeit/Überstunden                                               | Dienste und gespeicherte Abrechnungszuordnung                    | Auszahlung, Freizeitausgleich und Zuschlag unterscheiden                  |
| Steuerlicher SFN-Grundlohn                                           | Regelmäßige geeignete Entgeltbestandteile und Vertragszeit       | Fachlich ableiten; keine normale manuelle Betragseingabe                  |
| Regelmäßiges SV-Entgelt                                              | Vertrag und regelmäßig erwartete beitragspflichtige Bestandteile | Ableiten; bei unbekannten regelmäßigen Bestandteilen gezielt ergänzen     |
| Steuerklasse, Kirchensteuer, Kinder, Krankenkasse, Faktor/Freibetrag | Persönliches Netto-Profil                                        | Einmal erfassen, später bei Änderungen bearbeiten                         |
| VBL/ZVK/KZVK und Abrechnungsmodell                                   | Arbeitgeberbezogene Zusatzversorgung                             | Einmal auswählen; Tarif/Bundesland allein genügt nicht                    |

Ein Dienstplan liefert Arbeitszeiten, aber keine Steuerklasse oder Krankenkasse. Ebenso kann er bei festem Monatsgehalt nicht den arbeitsvertraglichen Entgeltanspruch ersetzen. Urlaub, Krankheit, Eintritt/Austritt und abweichende Zahlungsmonate benötigen die zugehörigen gespeicherten Vertrags- und Abrechnungsdaten.

## Nachgewiesener Stand in LUNA

| Modell/Familie                | Vorhandene Grundlage im Test-Checkout                                     | Erforderlicher Ausbau für automatische Netto-Prognose                                                                |
| ----------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| TVöD-P                        | Monatliche Gehaltsprognose und automatische SFN-Anbindung vorhanden       | Zusätzliche manuelle Bruttobasen ablösen; persönliche Angaben fortgelten lassen; Zusatzversorgung ergänzen           |
| TVöD VKA E-Tabelle            | Eigener Zweig der monatlichen Gehaltsberechnung                           | Positionen und Zuschlagsintervalle an gemeinsamen Netto-Eingang anbinden                                             |
| TV-L/KR                       | Eigener Monatsberechnungszweig; datierte Vergütungspositionen vorhanden   | Vollständigkeit der gewählten Berechnungsstrecke prüfen, fehlende Komponenten ergänzen und SFN anbinden              |
| TV-H Pflege und TV-UK Pflege  | Jeweils eigener Monatsberechnungszweig                                    | Tarifbesonderheiten, Zeitspuren und vollständige Entgeltbasis anschließen                                            |
| TVAöD Pflege und TVA-L Pflege | Ausbildungsberechnungen vorhanden                                         | Ausbildungsfall im Steuer-/SV-Kern unterstützen; gesonderte Berechnungsregeln berücksichtigen                        |
| TVöD Anlage A und SuE         | Datierte Vergütungsstrecke mit gespeicherten Bestätigungen                | Verfügbare Positionen anbinden; noch unvollständige Komponenten je Variante vervollständigen                         |
| Caritas Pflege                | Entwurfsberechnungen für mehrere Komponenten und gespeicherte Monatsdaten | Gesamtabrechnung vervollständigen: der gelesene Kompositionsvertrag bleibt ausdrücklich `completeGross: false`       |
| DRK E/P/S und Ausbildung      | Eigene Entwurfs-/Profilmodule                                             | Grundentgeltentwurf zu vollständiger Monatsabrechnung erweitern; Zuschläge, Zulagen und weitere Komponenten ergänzen |
| Eigene Vergütung              | Monatlicher Betrag sowie datierte eigene Vergütungspositionen             | Gespeicherte Zuschlagsregeln und vollständige Abrechnungsbasis anschließen                                           |
| Weitere Tarifverträge         | Erweiterbarer Regelkatalog                                                | Vollständigen Brutto-Anbieter implementieren; anschließend denselben Netto-Kern verwenden                            |

Diese Tabelle ist eine Anschlussanalyse, keine Zusage, dass bereits alle genannten Tarife ein vollständiges Monatsbrutto liefern. Die sieben benannten Tarifmodelle und die manuelle Monatsvergütung stehen in der bisherigen Gehaltsauswahl. Weitere Familien existieren in eigenen Modulen beziehungsweise in der datierten Vergütungsstrecke.

Konkrete Codebelege:

- `src/features/settings/salary-basis-options.ts`: bisherige Gehaltsauswahl.
- `src/engine/simple-pay.ts:588–651`: Verzweigung für TVA-L, TV-H, TV-UK, TV-L/KR, VKA E, Ausbildung und manuelle Vergütung.
- `src/engine/net-pay-tvoed-forecast.ts:11–22`: die aktuelle automatische Netto-Anbindung schließt andere Tarifprofile ausdrücklich aus.
- `src/features/salary/net-pay-sfn-forecast.tsx:159–187`: regelmäßiges SV-Einkommen wird zusätzlich eingegeben und die Berechnung manuell ausgelöst.
- `src/features/salary/net-pay-profile-form.tsx:50–52,170–181,220–224`: Angaben gelten bisher nur für den Monat; SFN-Grundlohn wird manuell erfasst; Ausbildung und Zusatzversorgung sind noch Sonderfälle ohne Berechnung.
- `src/features/analysis/use-monthly-remuneration.ts:17–58`: vorhandener Zugang zu Diensten, datierten Profilen, Zulagen, Überstunden, Abwesenheiten und Sonderzahlungen.
- `src/engine/remuneration-month.ts:189–218`: gemeinsame Entgeltpositionen; ein Gesamtbrutto entsteht nur bei vollständigen Komponenten.
- `src/domain/remuneration-result.ts:90–115`: Zeitpositionen besitzen Zeitraum, Schichtbezug, Betrag, Tarifquelle und Pausenmethode; eine steuerliche Zuschlagsklassifikation muss ergänzt werden.
- `src/features/settings/remuneration-tariff-options.ts:222–229`: konkrete Vollständigkeitsgrenzen von TVA-L und TV-L/KR in der datierten Tarifauswahl.
- `src/engine/caritas-care-draft-monthly-composition.ts:76–98` und `src/engine/drk-employee-draft-base.ts:45–65`: bekannte Teilsummen sind ausdrücklich kein vollständiges Gesamtbrutto.

## Gemeinsame technische Grundlage

Die bestehende Brutto-Berechnung sollte ihre Entgeltpositionen an einen gemeinsamen Monatsdatensatz liefern. Dieser enthält Gesamtbrutto, Steuerbrutto, SV-Brutto, regelmäßiges SV-Entgelt, SFN-Grundlohn, Zuschlagsintervalle, Abzüge, Zahlungsmonat und Vollständigkeit. Tarifadapter übersetzen vorhandene Ergebnisse in dieses Format; der Netto-Kern verwendet dasselbe Steuerverfahren für alle.

Die datierte Vergütungsstrecke ist dafür ein geeigneter Ausgangspunkt, weil sie Quellen, Zeiträume und Einzelpositionen bereits kennt. Für die bisherige Gehaltsstrecke ist ein Adapter nötig. Pro Monat wird genau eine maßgebliche Vergütungsquelle gewählt, damit Tabellenentgelt und Zulagen nicht doppelt einfließen. Caritas-/DRK-Entwürfe müssen dabei ihre Vollständigkeitsgrenzen behalten, bis die fehlenden Komponenten fachlich angeschlossen sind.

Der amtliche [BMF-Programmablaufplan](https://www.bmf-steuerrechner.de/interface/pseudocodes.xhtml) liefert Lohnsteuer, Solidaritätszuschlag und die Bemessungsgrundlage für Kirchenlohnsteuer. Das BMF stellt ausdrücklich keinen vollständigen Brutto-Netto-Rechner bereit: Sozialabgaben und weitere Abrechnungsbestandteile bleiben Teil der eigenen Umsetzung. Der vorhandene Kern für 2026 lässt sich weiterverwenden; zusätzliche Jahre benötigen eigene amtliche Jahresparameter.

Der steuerliche SFN-Grundlohn darf nicht pauschal mit dem tariflichen Zuschlagsstundensatz gleichgesetzt werden. [§ 3b EStG](https://www.gesetze-im-internet.de/estg/__3b.html) knüpft ihn an den laufenden Arbeitslohn bei der regelmäßigen Arbeitszeit und begrenzt die steuerliche Basis auf 50 Euro je Stunde. Die SV-Freiheit hat nach [§ 1 SvEV](https://www.gesetze-im-internet.de/svev/__1.html) eine gesonderte Basisgrenze von 25 Euro. Steuerfreiheit verlangt tatsächlich geleistete Arbeit und zusätzlich gezahlte Zuschläge; zukünftige Dienste ergeben deshalb eine bedingte Prognose.

Für die automatische Ableitung werden geeignete laufende Grundlohnkomponenten je Tarif gekennzeichnet und auf die regelmäßige Monatsarbeitszeit umgerechnet. Nicht bekannte Arbeitgeberbestandteile bleiben als konkret benannte Ergänzung offen. Pauschale Schichtzulagen dürfen nicht allein wegen ihres Namens als steuerfreie Nachtzuschläge behandelt werden.

Zusatzversorgung ist ein eigenes Abrechnungsmodul. Die [VBL](https://www.vbl.de/de/vblklassik1) unterscheidet West und Ost sowohl bei Beiträgen als auch bei der steuerlichen Behandlung. Beispielsweise wird der Arbeitnehmeranteil im Westen aus bereits versteuertem Einkommen getragen; Beiträge zur Kapitaldeckung im Osten können die steuerliche Basis verändern. Ein pauschaler Prozentabzug am Ende reicht daher nicht für alle Modelle. Auswahl, Arbeitnehmer-/Arbeitgeberbeiträge, steuerliche und SV-Wirkung müssen zusammen verarbeitet werden.

Einmalzahlungen benötigen ebenfalls einen eigenen Berechnungsweg und gegebenenfalls zusätzliche Jahres-/Vorabrechnungsdaten. Eine Jahressonderzahlung einfach zum laufenden Monatslohn zu addieren und durch die bisherige reguläre Monatsberechnung zu schicken, wäre kein allgemeiner korrekter Anschluss.

## Einfacher Ablauf für den Nutzer

1. In **Gehalt → Netto einrichten** persönliche Angaben und Zusatzversorgung einmal speichern. Vorhandenen Tarif, Arbeitszeit und Arbeitgeberangaben übernehmen.
2. Das Profil erhält ein Gültigkeitsdatum und gilt für folgende Monate fort. Änderungen werden datiert gespeichert; ältere Monate behalten ihren damaligen Stand. Bestehende Monatsprofile werden bei der Umstellung nicht stillschweigend überschrieben.
3. Die Gehaltskarte zeigt automatisch **Brutto-Prognose**, **Netto-Prognose** und **Zuschläge** für den ausgewählten Monat. Die Aufschlüsselung zeigt Steuern, Sozialversicherung, Zusatzversorgung sowie steuer-/SV-freie Zuschläge.
4. Änderungen an Diensten, Gehaltsprofil oder Steuerangaben berechnen das Ergebnis neu. Bei fehlenden Angaben erscheint eine konkrete Aktion, zum Beispiel **Zusatzversorgung auswählen** oder **Überstunden-Auszahlung klären**.

Normale Nutzer müssen kein Steuerbrutto, SV-Brutto, regelmäßiges SV-Einkommen oder SFN-Grundlohn abschreiben. Eine optionale Expertenansicht kann die automatisch ermittelten Grundlagen und begründete Korrekturen zeigen. Fehlende Entgeltbestandteile werden gezielt ergänzt; unbekannte Beträge werden nicht automatisch zu null.

## Umsetzung in getrennten Arbeitspaketen

Der Ausbau berührt voraussichtlich deutlich mehr als 15 Dateien und wird daher aufgeteilt:

1. **Gemeinsamer Monatsdatensatz und Quellenwahl:** Entgeltpositionen vereinheitlichen, Vollständigkeit und Zahlungsmonat sichern; bisherige Bruttosummen unverändert erhalten.
2. **Tarifanschlüsse:** TVöD-P, VKA E, TV-L/KR, TV-H und TV-UK mit ihren eigenen Zeitspuren verbinden; Anlage A/SuE und eigene Vergütung anschließen. Jede Familie erhält einen belegten Vergleichsfall.
3. **Weitere Familien vervollständigen:** Caritas und DRK aus den vorhandenen Modulen integrieren und die jeweils ausgeschlossenen Entgeltbestandteile ergänzen. Weitere Tarife verwenden denselben Anschlussvertrag.
4. **Abrechnungsumfang erweitern:** Zusatzversorgung, Ausbildung und Einmalzahlungen implementieren; PKV, Mini-/Midijob und andere Beschäftigungskonstellationen separat nach fachlichem Bedarf abdecken. Tarifabdeckung und Beschäftigungsfall sind getrennte Prüfdimensionen.
5. **Dauerhaftes Netto-Profil und Sicherung:** datierte persönliche Angaben, nachvollziehbare Übernahme bestehender Monatsprofile, SQLCipher-Persistenz und Backup-Kompatibilität.
6. **Bedienung und Abnahme:** Netto direkt in der Gehaltskarte, automatische Neuberechnung, knappe Ergänzungsfragen; anschließend Referenztests und reale iPhone-Abnahme.

Native Änderungen sind für die beschriebene Architektur zunächst nicht vorgesehen. Ob ein späterer Stand per OTA verteilbar ist, wird anhand seines tatsächlichen Fingerprints geprüft.

## Abnahmekriterien

- Für jeden angeschlossenen Tarif stimmen übernommenes Grundentgelt, Zulagen, Zuschläge und Gesamtbrutto centgenau mit seiner maßgeblichen Brutto-Berechnung überein.
- Persönliche Angaben werden einmal erfasst und gelten datiert fort; Neustart, Monatswechsel und Backup-Wiederherstellung erhalten denselben Stand.
- Ein normaler unterstützter Fall zeigt ohne erneute Bruttoeingabe automatisch eine Netto-Prognose.
- Nacht/Sonntag/Feiertag, steuerpflichtige Zulagen, Teilzeit, tarifliche Grenzzeiten, Monate mit Tarifwechsel und Dienste über Monatsgrenzen haben eigene Vergleichsfälle. Vorhandene Pausenmethoden bleiben sichtbar als Prognoseannahme.
- Fehlende oder nur teilweise bekannte Entgeltbestandteile verhindern ein als vollständig ausgewiesenes Monatsnetto und benennen die konkrete Lücke.
- BMF-Referenzen prüfen die Steuerteile. Gleich parametrisierte synthetische Fälle vergleichen zusätzlich Webrechner, Sozialabgaben und Zusatzversorgung; Abweichungen werden je Bestandteil erklärt.
- Ausbildung und Sonderzahlungsmonate werden erst als unterstützt ausgewiesen, wenn der jeweilige Steuer-/SV-Fall geprüft ist. Ein Tarifname allein schaltet diese Fälle nicht frei.
- UI, automatische Aktualisierung und lokale Speicherung werden auf dem iPhone geprüft; Metadaten oder Exporte ersetzen diese Abnahme nicht.

## Grenzen dieser Recherche

Es wurden die öffentlich lesbaren Formulare und Primärquellen ausgewertet; kein neuer numerischer Vergleichslauf gegen den Webrechner durchgeführt. Das bedeutet: das Bedienprinzip und die benötigten Eingaben sind geprüft, eine centgenaue Gleichheit der Ergebnisse mit diesem Anbieter wird hier nicht behauptet.

Die SvEV-Regel mit der 25-Euro-Grenze war über den Suchindex der amtlichen Seite lesbar; direkte HTML-/PDF-Abrufe der Seite liefen während der Recherche in einen Timeout. Für eine spätere Änderung der SV-Implementierung ist der aktuelle vollständige Normtext erneut zu prüfen.
