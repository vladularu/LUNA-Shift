# Brutto-Netto-Rechner – Arbeitspaket 4

## Task-Vertrag

- Ziel: Rechner aus der monatlichen Gehaltskarte öffnen, vollständige monatliche Steuerangaben lokal sichern und eine nachvollziehbare Netto-Prognose mit einzelnen Abgaben anzeigen.
- Nicht-Ziele: automatische SFN-/Tarifklassifikation, zusätzliche Versicherungsfälle, neue native Module, Git- oder EAS-Verteilung.
- Plattform: Expo SDK `~57.0.22`; bestehende Formular-, Karten-, Typografie- und Farbbausteine. Spätere Abnahme auf dem iPhone mit Tastatur, VoiceOver und großer Schrift.
- Teilpaket 4a: Formwert-Konvertierung und Tests, lokale Auswahlfelder, Profilformular, asynchroner Monats-Hook und Regressionen für Lade-/Schreibkonflikte.
- Teilpaket 4b: Monatsroute und Tests, Rechnerseite, Ergebnis- und Einstiegskarte, Registrierung im App-Stack, Gehaltskarten-Anbindung und Nutzerfluss-Tests. Insgesamt etwa 16 Dateien inklusive Bericht, auf zwei Pakete aufgeteilt.
- Abnahme: keine stillen Steuer-/Versicherungsdefaults; Monatsbindung; ungültige Eingaben erzeugen keine Nettozahl; Änderungen verwerfen ein früheres Ergebnis; Brutto-Vorschlag wird nicht als vollständige Abrechnung bestätigt; einzelne Steuer-/SV-Abzüge und Rechenstand sichtbar; Testlabor und gespeicherte Sonderfälle bleiben gesperrt; fokussierte Tests und `verify:fast` bestehen.
- Commit, Push, Build, OTA und Merge: keine Freigabe.

## Berechnungsgrundlage

Die bestehende Gehaltskarte verwendet `calculateMonthlyPayEstimate`, dessen Summen keine vollständige steuerliche oder sozialversicherungsrechtliche Klassifikation darstellen. Die neue Seite übernimmt den angezeigten Betrag deshalb ausschließlich als Vorschlag. Gesamtbrutto, Steuerbrutto, SV-Brutto und regelmäßiges monatliches SV-Einkommen müssen ausdrücklich angegeben und als vollständig bestätigt werden. Für gewöhnliches vollständig steuer-/SV-pflichtiges Monatsentgelt gibt es eine ausdrückliche Übernahmeaktion; getrennte Werte bleiben bearbeitbar.

Die Beträge und die Bestätigung gelten nur für den geöffneten Rechner und werden nicht als Steuerprofil gespeichert. Die vollständigen Steuer-/Versicherungsangaben werden dagegen je Monat im bereits geprüften Repository und Backup v20 erhalten. Ein neuer Monat übernimmt keine Angaben des vorherigen Monats.

Die Seite rechnet mit den ausdrücklich eingegebenen Bemessungsgrundlagen. Sie ermittelt keine SFN-Freiheit aus vorhandenen Dienst- oder Zuschlagssummen. Ausbildungsprofile werden zusätzlich als nicht unterstützter Fall erkannt, auch wenn im Formular versehentlich ein gewöhnlicher Beschäftigungsfall gewählt wird. Weitere Abzüge einschließlich Zusatzversorgung müssen als Sonderfall angegeben werden; dafür liefert die aktuelle Engine keine Zahl.

## Nachweise

- 59 Eingabe- und Routentests bestehen: unveränderte Übernahme sämtlicher gespeicherter Werte, ausdrücklich fehlende Felder, Datums- und Dezimalgrenzen, Faktorverfahren, getrennte Bruttobasen und alle zehn bekannten Sonderfälle.
- Neun Hook-Regressionen bestehen: Laden erst bei vorbereiteter App, fehlende Profile, verspätete Monatsantworten, erneutes Laden bei Fokus, vollständiger Erwartungsdatensatz, Schreibkonflikte, doppelte Schreibversuche, Fehlerbehandlung und Monatswechsel während eines Schreibzugriffs. Die Repository-Grenze wird in diesen React-Tests isoliert; die echten SQLite-/Backup-Tests bleiben im vollständigen Gate enthalten.
- 22 Nutzerfluss-Tests bestehen mit dem echten BMF-/SV-Rechenkern: Einstieg aus der Gehaltskarte, Brutto als unbestätigter Vorschlag, vollständiger neuer Monatsdatensatz, Betrag und einzelne Abgaben des 5.000-Euro-Referenzfalls, verworfene Ergebnisse nach jeder Betragsänderung, gespeicherte Sonderfälle, Ausbildung, Mini-/Midijob-Erkennung, Testlabor, fehlgeschlagenes Sichern, Monatswechsel, wiederhergestellte Profile und geändertem Arbeitsprofil. Faktorverfahren und Sonderfall-Auswahl werden ausdrücklich bestätigt.
- Die fokussierte Komponentenprüfung inklusive bestehender Gehalts-/Regelkatalog-Regressionen besteht mit 78 Tests in drei Suiten. Protokoll: `artifacts/net-pay-ui-component-tests.log`.
- `npm.cmd run verify:fast` besteht vollständig: Regelverträge, Typprüfung, Lint ohne Warnungen, Formatierung, 8.000 Unit-/Integrationstests in 409 Dateien, 839 Komponententests in 110 Suiten sowie sämtliche Publisher-, Delivery-, Produktions-, Operator-, Inventar-, Sicherheits-, Runtime- und Build-Dependency-Prüfungen. Protokoll: `artifacts/verify-fast-net-pay-ui.log`.
- Der erste vollständige Lauf fand fehlende Props-Typen in zwei neuen Hook-Tests. Nach der Korrektur wurde der gesamte Ablauf erfolgreich wiederholt. Die isolierten React-Tests verwenden eine Repository-Doppelung, während die echten Repository- und Backup-Prüfungen weiterhin mit SQLite laufen. `graft build` und die Whitespace-Prüfung sind erfolgreich.
- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) wurde vor den Änderungen geprüft.
- Noch keine Geräteabnahme. Auf dem iPhone sind insbesondere Scrollen und Tastatur bei langen Formularen, VoiceOver-Zustände, große Schrift, helle/dunkle Darstellung, SQLCipher-Speichern/Neustart und der Rückweg zur Gehaltskarte zu prüfen. Komponententests und Exportmetadaten ersetzen diese Abnahme nicht.
