# Gehalt: Anspruchs- und Auszahlungsmonate

Die UI der unten dokumentierten Preview wurde am 31.10.2026 anhand der iPhone-Fotos abgelehnt. Die anschließende Vorgabe lautet: bisherige Seiten beibehalten, nur eine Zulagen-Auszahlungseinstellung und ein dezenter Herkunftshinweis. Der aktuelle Auftrag steht in [gehalt-minimal-korrektur.md](gehalt-minimal-korrektur.md).

## Task-Vertrag vom 31.10.2026

- Ziel: den freigegebenen Entwurf mit getrenntem Dienst-/Anspruchsmonat und Auszahlungsmonat in LUNA umsetzen. Die bestehende monatsübergreifende Zulagenprüfung bleibt erhalten. Gehalt und Auswertung bekommen flache Reiter.
- Nicht-Ziele: neue Tarifansprüche, pauschale Verschiebung aller Zulagen, neue native Module, Änderungen an unabhängigen Arbeitsständen oder Veröffentlichungen.
- Plattform/Zielgerät: bestehende iOS-Preview-App auf dem iPhone; die Geräteabnahme ist ein eigener, noch offener Schritt.
- Branch/Basis: codex/gehalt-auszahlung, aktueller origin/master d1b13ac.
- Expo: ~57.0.31; SDK-57-Referenz und SQLite-Dokumentation gelesen.
- Dateiscope: Domain/Zahlungszuordnung, vorhandene Datenablage und Gehaltsberechnung, Gehalt/Auswertung, Navigation sowie zugehörige fokussierte Tests. Keine globalen Design-Tokens oder nativen Dateien.
- Arbeitspakete: (1) Zahlungsregeln und zeitliche Zuordnung, (2) gemeinsame Brutto-/Netto-Pipeline, (3) Ansichten und Einstellungen. Bei wachsendem Dateiscope werden Pakete weiter unterteilt.
- Akzeptanz: Versatz 0/1/2, unabhängige Zulagenzuordnung, gespeicherte Monatsentscheidungen nur für ihren Anspruchsmonat, Herkunft je Bestandteil, unvollständige Daten sichtbar, konsistente Netto-/Brutto-Basis, unveränderte Stunden/Dienste beim Perspektivwechsel, Jahreswechsel, flache Reiter und bestehende Kartenstruktur.
- Erforderliche Prüfung: npm.cmd run verify:fast, gezielte Fach- und Komponententests, anschließend iPhone-Screenshots für Auszahlung/Erarbeitet, Rhythmus, Zulagenprüfung und fehlende Grundlagen.
- Initiale Freigabe: Commit, Push, Build, OTA und Store-Veröffentlichung nicht freigegeben. Die spätere gesonderte iOS-Preview-OTA-Freigabe ist unten protokolliert.

## Umsetzung

- Gehalt und monatliche Auswertung teilen die Perspektiven `PAYOUT` („Auszahlung“) und `EARNED` („Erarbeitet“). Die Reiter sind flach und unterstrichen. Arbeitszeit, Dienste und gesetzliche Prüfungen folgen weiterhin dem ausgewählten Dienstmonat.
- Fünf Gruppen bekommen unabhängig einen Versatz von 0, 1 oder 2 Monaten oder einen ausdrücklich offenen Zahlungszeitpunkt: Zeitzuschläge, monatliche Schicht-/Wechselschichtzulage, stundenbezogene Schichtzulage, ausgezahlte Überstunden und Bereitschaftsvergütung. Grundentgelt, Pflegezulage und weitere feste Tarifbezüge bleiben beim jeweiligen Monat; Jahressonderzahlungen behalten ihren gesonderten Auszahlungsmonat.
- Regeln gelten ab einem Anspruchsmonat. Die Zuordnung prüft jeden möglichen Herkunftsmonat einzeln, damit ein Rhythmuswechsel mehrere Herkunftsmonate in einer Auszahlung zusammenführen kann.
- Monatliche Schichtzulagen bleiben bedingte Ansprüche. Jeder Herkunftsmonat verwendet die vorhandene Tarifberechnung, die monatsübergreifenden Nachweise und ausschließlich seine gespeicherte Monatsentscheidung. Die Gehaltsseite behält einen einzigen Einstieg „Zulage prüfen“.
- Fehlende Herkunftsdaten erzeugen einen offenen Gesamtbetrag. Ein leerer Dienstmonat wird erst nach ausdrücklicher Bestätigung als vollständig behandelt. Aus einem unbekannten Monat wird kein vermeintlich gesicherter Nullbetrag.
- Reines manuelles Festgehalt benötigt keine Einrichtung variabler Zahlungsgruppen. Die Ausnahme prüft den gesamten historischen Monat und verändert keine gespeicherte Regel. Frühere Tarifabschnitte oder eine unvollständige Profilhistorie bleiben offen.
- Das Netto klassifiziert originale Dienstnachweise mit ihren damaligen Tarifen und Netto-Grundlagen. Anschließend werden Auszahlungsbrutto, Abzüge und Jahressonderzahlung einmal berechnet. Die Nettowerte mehrerer Dienstmonate werden nicht addiert.
- Bei beitragspflichtigen verspäteten variablen Bezügen ist die Arbeitgebermethode ausdrücklich zu bestätigen. Nicht unterstützte Beitragszuordnungen, fehlende historische Netto-Angaben oder unstabile Grundlagen bleiben mit Begründung offen. Für verspätete monatliche Schichtzulagen wird keine ungesicherte SV-Vereinfachung unterstellt.
- Zusätzliche laufende Bruttobeträge erscheinen auch in der Auswertung als eigene Zeile und im Gesamtbrutto. Die Ansicht „Erarbeitet“ zeigt kein als Auszahlung missverständliches Netto.
- Zahlungsregeln werden versioniert in den bestehenden privaten Benutzereinstellungen gespeichert, einschließlich Konfliktprüfung, Backup und validiertem Restore. Es gibt keine neue native Abhängigkeit oder Datenbankschema-Migration.
- Die bestehende Jahresberechnung und tarifliche Jahresdurchschnitte bleiben nach Dienst-/Anspruchsmonat erhalten. Jahresansicht und PDF-Berichte benennen dies ausdrücklich. Auszahlungsprojektionen werden im Speicher wiederverwendet; der ältere, nur oberflächlich validierte persistente Auswertungscache wird dafür nicht verwendet.
- Hintergrundvorbereitung und sichtbare Auswertung verwenden dieselben Eingaben und denselben Schlüssel, einschließlich aller möglichen Herkunftsmonate und ihrer Prüfzeiträume. Ein Perspektivwechsel erneuert die Gehaltsstufe; die Vorbereitung der Arbeitszeit und Prüfungen bleibt unabhängig.

Die Umsetzung wurde in getrennten Paketen bearbeitet: Domain/Speicherung, Bruttozuordnung, Nettoadapter, gemeinsame Eingaben/Einstellungen, Gehaltsansichten, monatliche Auswertung, Hintergrundvorbereitung und Berichtskennzeichnung.

## Technische Prüfung

Gezielte Prüfungen decken Zahlungsversätze und Jahreswechsel, Rhythmuswechsel, bedingte Zulagen mit Nachweisen im Vormonat, ursprüngliche SFN-Daten, historische Netto-Grundlagen, SV-Abgrenzung eingehender und ausgehender Ansprüche, Cache-Invalidierung, Speicher-/Restore-Konflikte, Quellmonatsnavigation und Reiter ab.

Abschließender Stand vom 31.10.2026:

- `npm.cmd run verify:fast`: Exit 0. Darin 532 Vitest-Dateien mit 10.237 bestandenen Tests und 181 Jest-Dateien mit 1.721 bestandenen Tests, außerdem Typprüfung, Lint ohne Warnungen, Formatierung, Regelvalidierung und sämtliche enthaltenen Sicherheits-/Laufzeitchecks.
- `npm.cmd run export:ios`: Exit 0, aktuelles Hermes-Bundle erfolgreich erzeugt. Es wurde nichts hochgeladen.
- Netto-Arbeitspaket: gezielte Abdeckung von 89,54 % Zeilen und 89,23 % Zweigen; Quellklassifikation, Ein-/Ausgangsabgrenzung und einmalige Finalisierung geprüft.
- Hintergrundvorbereitung: 13 Komponententests und 5 Runtime-Tests bestanden. Benchmark-Smoke für TV-L, TV-UK und VKA mit expliziten vollständigen Zero-Lag-Eingaben bestanden; Finanzvergleich und Projektionsinvarianten getrennt geprüft.
- Unabhängige Reviews der Speicherung und Netto-/Analysis-Integration abgeschlossen. Gefundene Probleme mit ausgehenden Ansprüchen, offenem Monat, Cache-Abhängigkeiten und Fehlerweitergabe sind durch Regressionstests abgesichert.
- `git diff --check` bestanden; der Graft-Graph wurde aktualisiert. Der Arbeitsstand liegt ausschließlich auf `codex/gehalt-auszahlung` im getrennten Worktree. Pull-Request-CI wurde noch nicht ausgeführt.

## iOS-Preview-OTA vom 31.10.2026

Nach ausdrücklicher Freigabe des Nutzers als iOS-Preview-OTA veröffentlicht und serverseitig geprüft:

- Kanal/Branch/Environment: `preview`; App-Variante `internal`, Bundle-ID `com.pflegeshift.app.internal`.
- Kompatibler bestehender iPhone-Build: Preview 44, EAS-Build `812ea1a9-a4c0-48f3-b01a-72011cdad43e`, Expo SDK 57.
- Lokaler Fingerprint, Build-Runtime und veröffentlichte iOS-Runtime stimmen exakt überein: `b99c3cf0dd56e6b1bb126d195f21c665de57760b`.
- Updategruppe: `3962f598-8fd2-4fe3-adf0-157a158dbe36`; iOS-Update-ID: `01a18fe4-9a94-7ece-a117-029fb7429aa5`.
- Veröffentlichung: `2026-10-31T02:58:06.1Z`, Nachricht „Gehalt: Anspruchs- und Auszahlungsmonate, Zulagenprüfung und flache Reiter“; EAS CLI 27.2.0.
- Prüfung: Preview-Kanal aktiv und auf Branch `preview`; neueste Gruppe entspricht der veröffentlichten Gruppe; Plattform iOS, Environment `preview`, Manifest-App-Variante und Bundle-ID korrekt.
- Veröffentlichung aus dem geprüften lokalen Arbeitsstand auf Basis `d1b13ac788044a7564c673170bf3753547728315`. Die Freigabe umfasst diese Preview-OTA; Commit, Push, nativer Build und TestFlight-/Store-Veröffentlichung wurden nicht ausgeführt.

## Noch offene Geräteabnahme

Die folgenden Zustände sind im bestehenden passenden iOS-Preview-Build auf dem iPhone zu bestätigen:

1. Auswertung und Gehalt: „Auszahlung“ und „Erarbeitet“, gleicher Monat, unveränderte Dienst-/Arbeitszeitwerte; Light/Dark und große Schrift.
2. Zahlungsrhythmus: 0/1/2 Monate, getrennte monatliche/stundenbezogene Zulage, Anspruchsmonat der Gültigkeit und Wechsel des Rhythmus.
3. „Zulage prüfen“: korrekter Anspruchsmonat, Nachweise über die Monatsgrenze und Speicherung ohne Übertragung auf andere Monate; Quellenlink und native Zurück-Navigation.
4. Fehlender Herkunftsmonat, ausdrückliche Bestätigung eines leeren Monats und ungeklärte Netto-/SV-Grundlage mit verständlicher Weiterführung.

Die technische Preview-Veröffentlichung ist bestätigt; die Geräteabnahme steht aus. Weder der iOS-Export noch EAS-Metadaten ersetzen den Screenshot- oder Gerätenachweis.
