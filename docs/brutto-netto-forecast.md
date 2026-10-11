# Brutto-Netto – automatische TVöD-P-Prognose (Arbeitspaket 5)

## Task-Vertrag

- Ziel: Die vorhandene TVöD-P-Monatsprognose einschließlich zeitgenauer Zuschlagszuordnung an den geprüften SFN- und Netto-Rechenkern anbinden.
- Nicht-Ziele: andere Tarifpfade, tatsächlich geleistete Arbeit bescheinigen, individuelle Pausen speichern, Sonderabrechnungen/Zusatzversorgung, native Änderungen oder Git-/EAS-Verteilung.
- Plattform: Expo SDK `~57.0.22`, Dokumentation SDK 57; reine TypeScript-/React-Native-Erweiterung.
- Paket 5a: optionale Zeitspur im bestehenden einfachen TVöD-P-Rechenkern, Adapter mit Abgleich sämtlicher Zuschlagssummen und fachliche Regressionen.
- Paket 5b: optionalen monatlichen SFN-Grundlohn bearbeiten; getrennte automatische Prognose mit sichtbarer mittiger Pausenannahme, Arbeitsort-, Vollständigkeits- und Zusätzlichkeitsbestätigung; Ergebnisbindung an sämtliche Quelldaten. Zwölf Dateien einschließlich Tests, gemeinsamer Testdaten und Bericht.
- Abnahme: unveränderte bestehende Brutto-/Zuschlagsbeträge; genaue Zeitspuren einschließlich Zeitumstellung; Samstag/Überstunden/Pauschalzulagen werden nicht als SFN befreit; fehlende Angaben, andere Tarifpfade, Monatsgrenzen und Widersprüche liefern keine automatische Nettozahl; Änderungen verwerfen Bestätigungen/Ergebnisse; gezielte Tests und `verify:fast` bestehen.
- Geräteabnahme: iPhone, Tastatur, große Schrift und VoiceOver stehen anschließend aus. Keine Freigabe für Commit, Push, Merge, Build oder OTA.

## Grundlage

[§ 3b EStG](https://www.gesetze-im-internet.de/estg/__3b.html) knüpft die Befreiung an zusätzlich zum Grundlohn bezahlte, tatsächlich geleistete Arbeit. Der Grundlohn ist gesondert zu bestimmen, mit höchstens 50 Euro für die Steuerfreiheit. [§ 1 SvEV](https://www.gesetze-im-internet.de/svev/__1.html) begrenzt die entsprechende SV-Freiheit auf 25 Euro je Stunde. Quellen am 9. Oktober 2026 erneut geprüft.

Der Dienstplan erlaubt nur eine bedingte Prognose: wenn die geplanten Dienste tatsächlich so gearbeitet, Pausen so genommen und Zuschläge so zusätzlich abgerechnet werden. Die bestehende Gehaltsprognose setzt unbezahlte Pausen in die Schichtmitte. Diese Annahme wird ausdrücklich angezeigt und bestätigt; sie wird nicht zu einem Arbeitszeitnachweis umgedeutet. Arbeitsort/Feiertagsregion stammen aus dem Arbeitsprofil und sind ebenfalls zu bestätigen.

Die automatische Anbindung wird auf den bestehenden TVöD-P-Pfad begrenzt. Andere Tarifpfade haben eigene Zeit-/Abrechnungsregeln und benötigen getrennte Adapter. Die manuelle Berechnung bleibt verfügbar. Monatliche Steuerprofile mit Sonderfällen liefern weiterhin keine Nettozahl.

## Umsetzung und Bedienung

1. Den Rechner aus der Gehaltskarte öffnen und die monatlichen Steuer-/Versicherungsangaben sichern. Für die automatische Variante zusätzlich den steuerlich bestimmten SFN-Grundlohn je Stunde eintragen. Das bestehende optionale Profilfeld wird genutzt; Datenbankschema und Backup-Version ändern sich in diesem Paket nicht.
2. Die automatische Karte berechnet das Brutto erneut aus den aktuellen Diensten, Tarifentscheidungen, Arbeitsprofil- und Regelkatalogdaten. Sie vertraut nicht auf einen älteren Bruttobetrag in den Routenparametern.
3. Das regelmäßig erwartete monatliche SV-Einkommen gesondert angeben. Bruttovollständigkeit, Arbeitsort, mittige unbezahlte Pausen und zusätzliche Zuschlagszahlung ausdrücklich für diese bedingte Prognose bestätigen.
4. Der Adapter nutzt die Zeitspur derselben Regelauswahl wie die Gehaltskarte. Er gleicht jeden Dienst, jeden Zuschlag, Überstunden und sämtliche Bruttobestandteile ab. Nachtzahlungen werden getrennt von Sonntags-/Feiertagszahlungen klassifiziert. Samstagszuschläge, Überstundenentgelt und pauschale Monatszulagen bleiben steuer-/SV-pflichtig.
5. Die Karte zeigt gezahlte Zuschläge, voraussichtliche Steuerfreiheit und SV-Freiheit getrennt. Darunter stehen die Bemessungsgrundlagen und einzelnen Abgaben des Netto-Rechenkerns. Änderungen am Dienstplan, Steuerprofil, Arbeitsort, Tarifentscheidung, Arbeitsmuster, Regelkatalog oder regelmäßigen Einkommen verwerfen Ergebnis und Bestätigung.

Die Bestätigung und das regelmäßige Einkommen bleiben im geöffneten Rechner. Die Schichtzeiten werden als `PLANNED` klassifiziert. Unterschiedliche tatsächliche Pausen, andere Arbeitsorte, weitere Entgeltbestandteile oder Arbeitgeberabrechnungen benötigen geprüfte Grundlagen in der manuellen Variante. Dienste, die in den nächsten Abrechnungsmonat hineinreichen, werden automatisch gesperrt; der bisherige Brutto-Rechner ordnet sie dem Startmonat zu, während die SFN-Engine pro Abrechnungsmonat arbeitet. Diese Abweichung wird nicht stillschweigend aufgelöst.

## Gezielte Nachweise

- 29 neue Adapter-/Zeitspurtests: unveränderte Brutto-Zuschlagsrechnung; konkrete Nacht-/Sonntagsintervalle und mittige Pause; unabhängiger SFN-Grenzbetrag; Frühlings-/Herbst-Zeitumstellung; Feiertage/Vorfeiertage; getrennte Steuer-/SV-Grenzen; keine Befreiung von Samstag, Überstunden oder Monatszulagen; fehlende/widersprüchliche Daten; sechs andere Tarifpfade; Monatsgrenzen und unvollständige Dienste.
- Ein zusätzlicher Formwerttest prüft Bearbeiten, ausdrückliches Leeren und Zurückweisen eines ungültigen SFN-Grundlohns. Die vorhandene Prüfung der unveränderten Speicherung umfasst das weiterhin identische monatliche Profilformat.
- 16 neue Komponententests prüfen die tatsächliche Verbindung von Tarif-, SFN- und BMF-Rechenkern, fehlende Angaben, Sonderfälle, Testlabor, Mini-/Midijob-Grenze, Monatsgrenzen und die Ergebnisbindung an geänderte Quelldaten.
- Fokussierter Fachlogiklauf: 174 Tests in fünf Dateien bestanden; Komponentenlauf einschließlich bestehender manueller Rechnerflüsse: 38 Tests in zwei Suiten bestanden. Protokolle: `artifacts/net-pay-forecast-unit-tests.log` und `artifacts/net-pay-forecast-component-tests.log`.
- Die erste Prüfung fand, dass der bisherige Brutto-Rechner Dienste ohne Uhrzeiten ausfiltert. Der neue Adapter sperrt solche Dienste ausdrücklich. Eine Testannahme zur SV-Grenze wurde mit einem tatsächlich darüber liegenden Feiertagszuschlag korrigiert; Typ-/Textselektorfehler in Tests wurden behoben. Danach bestanden die gezielten Prüfungen und die Typprüfung.
- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) wurde vor den Änderungen erneut geprüft. Es sind keine nativen Änderungen enthalten.

## Abschlussprüfung und offene Abnahme

- `npm.cmd run verify:fast` besteht auf dem endgültigen Codestand vollständig: Regelverträge, Typprüfung, Lint ohne Warnungen, Formatierung, 8.030 Unit-/Integrationstests in 410 Dateien, 855 Komponententests in 111 Suiten sowie sämtliche Publisher-, Delivery-, Produktions-, Operator-, Inventar-, Sicherheits-, Runtime- und Build-Dependency-Prüfungen. Protokoll: `artifacts/verify-fast-net-pay-forecast-final.log`.
- Nach der Abschlusskorrektur auf ausgeschriebene Bundesland-/Feiertagsregionsnamen wurde der gesamte Ablauf erneut erfolgreich ausgeführt. Der Graph wurde mit `graft build` aktualisiert; die Whitespace-Prüfung besteht.
- Änderungen liegen uncommitted im separaten Checkout `.worktrees/brutto-netto-prototype` auf `codex/brutto-netto-prototype`. Es wurde nichts gepusht, gemergt oder per EAS verteilt.
- Offen ist die iPhone-Abnahme: Formular mit Tastatur und großer Schrift bedienen; Arbeitsort-/Pausenbestätigung mit VoiceOver prüfen; SFN-Grundlohn in SQLCipher speichern und nach Neustart wieder laden; bedingtes Ergebnis sowie separate Steuer-/SV-Freiheit prüfen; Ergebnis nach Dienst-/Profiländerung verwerfen; manuellen Rückfall und Monatsgrenzensperre prüfen. Lokale Tests belegen diese Geräteabnahme nicht.
- Weitere Tarifadapter und tatsächlich dokumentierte individuelle Pausen sind spätere, getrennte Arbeitspakete. Die heutige automatische Variante bleibt eine TVöD-P-Dienstplan-Prognose mit ausdrücklich bestätigter mittiger Pausenannahme.
