# Gehalt: klassische Abrechnung

## Freigegebener Auftrag vom 31.10.2026

Der Nutzer hat nach drei interaktiven Entwürfen die klassische Abrechnung gewählt und die Umsetzung ausdrücklich beauftragt. Maßgeblich ist diese Auswahl mit der anschließenden Korrektur im Screenshot: der gesamte Abzugsblock ist aufklappbar; darin erscheinen Kranken-, Pflege-, Renten- und Arbeitslosenversicherung einzeln. Soli und Kirchensteuer werden nur angezeigt, wenn sie anfallen.

- Zielplattform: bestehende LUNA-iOS-Preview, Expo ~57.0.31; passende SDK-57-Dokumentation geprüft. Native Sichtprüfung auf dem iPhone bleibt eigenes Abnahmekriterium.
- Ziel: zwei eigene Karten in der monatlichen Auswertung: „Zuschläge erarbeitet“ nach Dienstmonat und „Gehalt & Netto“ nach Auszahlungsmonat. Beide besitzen einen direkten Einstieg.
- Gehalt: eine durchgehende Seite mit direkt erreichbaren Auszahlungs-/Netto-Einstellungen oben, anschließend deutlich sichtbarem Gesamtbrutto und Netto sowie einer klassischen Aufstellung. Abzüge inline aufklappen; kein Navigieren zu einer weiteren Abzugsseite notwendig.
- Erarbeitete Zuschläge: bestehende fachliche Tages-/Dienstaufschlüsselung und Erläuterungen auf einer eigenen Seite; unabhängig vom eingestellten Auszahlungsversatz.
- Bestehende Finanzberechnung, individuelle Nettodaten, Bedingtheit monatlicher Schichtzulagen, Quellmonate, Regelprüfung und Datenintegrität erhalten. Keine Beispielwerte aus der Visualisierung übernehmen.
- Nicht-Ziele: neue Tarif-/Steuerregeln, Änderungen fremder Arbeitsstände, native Abhängigkeiten, Umgestaltung anderer Auswertungskarten oder Jahresberichte.
- Dateiscope/Arbeitspakete: (1) Auswertung/Ansichtspräferenzen/erarbeitete Zuschläge und Routen, (2) Haupt-Gehaltsseite und Abzugsdarstellung, (3) Inline-Einstellungen auf Basis vorhandener validierter Speicherung. Neue Präsentationsmodule sind erlaubt; keine Datenbankmigration.
- Abnahme: 0/1/2 Monate verschieben nur die Auszahlungsbestandteile; erarbeitete Tageswerte bleiben beim Dienstmonat. Fehler/Loading/Testdaten bleiben ehrlich. Keine doppelten Gehaltsbestandteile, kein stiller Verlust gespeicherter Einstellungen, Monats-/Zurücknavigation korrekt. Soli/Kirche bei null unsichtbar; alle übrigen tatsächlich anfallenden Abzüge einzeln im Disclosure.
- Prüfung: aufgabenspezifische Tests, `npm.cmd run verify:fast`, iOS-Export, anschließender Screenshot-/Gerätenachweis in Preview.
- Branch: bestehender `codex/gehalt-auszahlung`; vorherige uncommittete Arbeit wird weitergeführt.
- Veröffentlichung: Zunächst war nur die Umsetzung freigegeben. Der Nutzer hat die nachstehende iOS-Preview-OTA anschließend ausdrücklich beauftragt. Commit, Push, nativer Build, TestFlight und Store bleiben davon getrennt.

## Stand

Die drei Arbeitspakete sind implementiert, zusammengeführt und lokal vollständig geprüft. Die früheren vereinfachten Seiten werden durch den nun ausdrücklich gewählten Entwurf abgelöst. Die gesondert freigegebene iOS-Preview-OTA ist veröffentlicht und technisch nachgeprüft; die Geräteabnahme steht noch aus.

## Umsetzung

- Eigene Monatskarten mit unabhängiger Sichtbarkeit und Reihenfolge. Vorhandene Vier-Karten-Einstellungen werden beim Laden verlustfrei ergänzt; neue und ältere Backups werden geprüft. Die Jahresansicht behält ihre bisherigen Karten.
- „Zuschläge erarbeitet“ öffnet den vorhandenen Bericht mit echten Tages-/Dienstbeträgen und Berechnungsdetails. Sein Monatswechsel und die Rückkehr zur Auswertung behalten den ausgewählten Dienstmonat bei. Zahlungsregeln verändern diese erarbeiteten Beträge nicht.
- „Gehalt & Netto“ öffnet die klassische Gehaltsseite. Die Kernbeträge navigieren nicht; die Aufstellung, Abzüge und Berechnungsgrundlagen bleiben inline. Ein normaler Header-Zurückweg ersetzt hier den doppelten unteren Zurückknopf.
- Auszahlungseinstellung, Herkunftsmonat, Steuerklasse und Kirchensteuer sind direkt sichtbar. Die vollständigen weiteren Netto-Angaben bleiben auf derselben Seite aufklappbar. Bestehende Validierung, zeitliche Gültigkeit, Zusatzversorgung und atomare Konfliktprüfung bleiben erhalten. Es gibt keine zusätzliche Steuerberechnung.
- Der Abzugsblock verwendet die endgültigen Arbeitnehmerbeträge der vorhandenen Prognose. Krankenversicherung einschließlich Zusatzbeitrag wird genau einmal gezählt; Rentenversicherung und Zusatzversorgung bleiben getrennt. Soli/Kirchensteuer erscheinen ausschließlich bei positivem Betrag. Persönliche Nettoabzüge erscheinen bei vorhandenem Wert.
- Besondere Prognosen bleiben ehrlich bezeichnet: gerundete Vorjahreswerte, offene Sonderzahlungs-Netto-Basis und fehlende Zusatzversorgung. Ein teilweise offenes Jahreszahlungs-Netto wird nicht mit dem gesamten Brutto als vollständig verrechnet dargestellt.
- Fehler bei einer inline gespeicherten Auszahlungseinstellung verwerfen weder einen offenen Netto-Entwurf noch die letzte gültige Prognose. Der Fehler bleibt lokal sichtbar. Monatswechsel und Quellmonats-Recovery schützen ungespeicherte Eingaben; während einer Speicherung sind Monatswechsel gesperrt.

## Prüfung

Die fokussierten Prüfungen der drei Pakete sind grün. Financial-Integrationstests erhalten die bisherigen 69 Fälle und ergänzen Inline-Save/Reload, Jahreszahlungsabgrenzung, positive Soli-/Kirchensteuer, Speicherkonflikt und Monatswechsel-Guard. Der zusätzliche Eingabe-/Speicherreview fand keine P1/P2 im geänderten Pfad; Authentifizierung und Datenbankschema wurden nicht neu auditiert.

Abschließende lokale Prüfung am 31.10.2026:

- `npm.cmd run verify:fast`: Exit 0, einschließlich Typprüfung, Lint ohne Warnungen, Formatierung, 535 Unit-Testdateien mit 10.286 Tests, 184 Komponentensuiten mit 1.747 Tests und allen nachfolgenden Skriptprüfungen.
- `APP_VARIANT=internal npm.cmd run export:ios`: Exit 0; aktuelles Bundle `entry-123ed14bfbd2691502ace02479d49072.hbc`.
- Die bisherigen Backup- und Bereitschafts-Kartentests wurden auf die getrennten Karten angepasst; alte und neue Sicherungen sowie die unveränderten Bereitschafts-Gesamtbeträge sind abgesichert. Die früheren 69 Gehaltsfälle und fünf ergänzende Integrationsfälle bestehen im vollständigen Lauf.
- Codeindex aktualisiert; `git diff --check` erfolgreich. Kein Commit, Push, neuer nativer Build oder TestFlight-/Store-Release für diese klassische Ansicht. Das gesondert freigegebene EAS Update ist unten dokumentiert.

Für die echte Sichtabnahme ist die veröffentlichte Preview jetzt auf dem iPhone zu prüfen. Der lokale Export, Komponententests und Veröffentlichungsmetadaten ersetzen diesen Gerätenachweis nicht.

## Freigegebene iOS-Preview-OTA vom 31.10.2026

Nach ausdrücklichem Auftrag „Ja, bitte im iOS-Preview bereitstellen.“ veröffentlicht:

- Kanal, Branch und Environment: `preview`; App-Variante `internal`, Bundle-ID `com.pflegeshift.app.internal`.
- Kompatibler bestehender iPhone-Build: Preview 44, EAS-Build `812ea1a9-a4c0-48f3-b01a-72011cdad43e`.
- Lokaler Fingerprint, Build-Runtime und veröffentlichte iOS-Runtime: `b99c3cf0dd56e6b1bb126d195f21c665de57760b`, exakt übereinstimmend.
- Updategruppe: `b5d90e63-73d0-43c8-b63d-e0dbcff75f25`; iOS-Update-ID: `01a19335-5366-7843-b679-e9f164dc37d4`.
- Veröffentlicht: `2026-10-31T18:25:07.942Z`; Nachricht „Gehalt: klassische Abrechnung, zwei Auswertungskarten und aufklappbare Abzüge“; EAS CLI 27.2.0.
- Frischer Export und Veröffentlichung mit explizitem Preview-Environment. Der aktive Preview-Kanal zeigt auf Branch `preview`; seine neueste iOS-Gruppe entspricht dieser Veröffentlichung. Das Manifest bestätigt interne App-Variante und Bundle-ID. Der SHA-256-Hash des ausgelieferten Bundles stimmt mit `entry-123ed14bfbd2691502ace02479d49072.hbc` aus dem lokal geprüften Stand überein.
- Veröffentlicht aus dem geprüften lokalen Arbeitsstand auf Basis `d1b13ac788044a7564c673170bf3753547728315`. Keine zusätzliche Codeänderung, kein Commit, Push, neuer nativer Build oder TestFlight-/Store-Release.
- Offen: auf dem iPhone beide Karten, Monats-/Zurücknavigation, Inline-Einstellungen und deren Speicherung, Zulagenversatz 0/1/2 sowie Abzüge-Disclosure mit bedingten Soli-/Kirchensteuer-Zeilen prüfen; Light/Dark und größere Schrift einschließen.
