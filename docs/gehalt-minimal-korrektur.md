# Gehalt: minimale Korrektur nach iPhone-Rückmeldung

## Auftrag vom 31.10.2026

Die veröffentlichte Preview `3962f598-8fd2-4fe3-adf0-157a158dbe36` wurde anhand von acht iPhone-Screenshots abgelehnt: zu viel Text, wiederholte Inhalte, verwirrende Navigation und blockiertes Netto. Die anschließende ruhige Referenz und die ausdrückliche Eingrenzung des Nutzers ersetzen den bisherigen UI-Entwurf.

- Ziel: bestehende Gehalts- und Auswertungsseiten aus `d1b13ac` erhalten. Nur eine zusätzliche Einstellung für die Auszahlung der Zulagen (0/1/2 Monate) und bei Verschiebung einen dezenten Herkunftshinweis ergänzen.
- Nicht-Ziele: neue Reiter, neue Übersichts-/Herkunftskarten, Umgestaltung anderer Karten, neue native Abhängigkeiten oder Änderungen gespeicherter Zulagenentscheidungen.
- Standard: im selben Monat, damit Anzeige und Netto ohne aktive Umstellung wie zuvor funktionieren. Ein ausdrücklich unbekannter gespeicherter Zeitpunkt wird nicht als bestätigter Nullbetrag behandelt.
- Zulagen: gemeinsame Auswahl für alle dienstabhängigen Bestandteile einschließlich bedingter monatlicher Schichtzulagen. Grundentgelt und feste Tarif-/Pflegebezüge gehören weiterhin zum ausgewählten Monat.
- Herkunft: eine kurze Zeile „Zulagen aus September 2026“; einzelne feste Gehaltszeilen bekommen keine wiederholten Monatshinweise.
- Netto: unveränderte Berechnung bei Versatz 0; für vollständige verschobene Zulagen eine kenntlich gemachte Schätzung anhand ihrer ursprünglichen Nachweise und des Mehrbetrags ihrer Abzüge. Ungesicherte Zahlen und die Übernahme kompletter Quellmonatsgehälter sind ausgeschlossen.
- Plattform: bestehendes iOS-Preview, Expo ~57.0.31; SDK-57-Dokumentation geprüft. Die vorliegenden Fotos dokumentieren die abgelehnte Version, keine Abnahme der Korrektur.
- Pakete: alte Salary-UI/Navigation, alte Analysis-Karte mit Projektion/Hinweis, einzelne Einstellung/Default, begrenzte Netto-Korrektur mit Regressionstests. Jedes Paket wird getrennt geprüft.
- Akzeptanz: alte Seiten/Navigation, keine neuen Perspektiv-Reiter und Karten, genau eine zusätzliche Einstellung, korrekte Quellmonate einschließlich Jahreswechsel, keine doppelten Beträge, funktionierende Netto-Schätzung im belegten Normalfall und ehrlicher Zustand bei fehlenden Angaben.
- Prüfung: relevante Fach-/Komponententests, `npm.cmd run verify:fast`, aktueller iOS-Export; anschließend erneute Sichtprüfung auf dem iPhone.
- Branch: bestehender kurzlebiger Feature-Branch `codex/gehalt-auszahlung`. Die abgelehnte UI wird lokal gesichert; unabhängige Arbeitsstände bleiben unberührt.
- Lieferung: Die vorige OTA-Freigabe bezog sich auf die bereits veröffentlichte Version. Für die Korrektur wurde die neue iOS-Preview-OTA anschließend separat freigegeben; Veröffentlichung und Nachprüfung stehen unten. Commit, Push und neuer nativer Build sind weiterhin nicht freigegeben.

## Stand

Die bisherige Salary-Ansicht einschließlich Header, Zurücknavigation und Summary ist wiederhergestellt. Die Auswertung verwendet wieder die alte Kartenstruktur und Zeilen. Die neue Auswahl befindet sich unter den vorhandenen Netto-Einstellungen. Die verworfenen Reiter und Herkunftskarten wurden entfernt; Jahres-/Exporttexte wurden ebenfalls auf den Ausgangsstand zurückgeführt.

Ein positiver verschobener Zulagenbestandteil erhält einen gemeinsamen Herkunftshinweis. Für fehlende Daten steht stattdessen kurz „Zulagen für … noch offen“. Ein bestätigter Nullbetrag erzeugt keinen falschen Herkunftshinweis für feste aktuelle Monatsbezüge. Treffen unterschiedliche Schichtzulagentypen gemeinsam ein, bleibt die bestehende eine Betragszeile erhalten und heißt neutral „Schichtzulagen“.

Die UI wurde gezielt gegen den Ausgangsstand geprüft. Die unabhängigen Reviews und die lokale Gesamtprüfung sind abgeschlossen. Die gesondert freigegebene Preview-OTA ist veröffentlicht; die Geräteabnahme steht noch aus.

## Lokale Prüfung am 31.10.2026

- `npm.cmd run verify:fast`: erfolgreich; 533 Unit-Testdateien mit 10.272 Tests, 182 Komponentensuiten mit 1.718 Tests sowie sämtliche nachfolgenden Skriptprüfungen bestanden.
- Nach der letzten kleinen Anzeige-Korrektur zusätzlich die 15 Tests in `salary-composition.test.ts` sowie Typ-, Lint- und Formatprüfung erneut erfolgreich ausgeführt. Unbekannte Quell-Zeitzuschläge erscheinen als Gedankenstrich statt als bestätigter Nullbetrag.
- `APP_VARIANT=internal npm.cmd run export:ios`: erfolgreich; aktuelles Bundle `entry-da3cce43b63fb7243eeeec9fb2afad54.hbc` in `dist/ios`.
- Codeindex aktualisiert; `git diff --check` erfolgreich. Kein Commit, Push oder nativer Build.
- Offen: die ruhige Darstellung, den Wechsel 0/1/2, die tatsächlichen Netto-Einstellungen und die Rücknavigation im bestehenden iOS-Preview auf dem iPhone prüfen. Technische Prüfungen ersetzen diese Geräteabnahme nicht.

## Freigegebene iOS-Preview-OTA am 31.10.2026

Nach ausdrücklichem „ja“ zur Bereitstellung dieser vereinfachten Version veröffentlicht und serverseitig nachgeprüft:

- Kanal, Branch und Environment: `preview`; `APP_VARIANT=internal`, Bundle-ID `com.pflegeshift.app.internal`.
- Bestehender kompatibler iPhone-Build: Preview 44, EAS-Build `812ea1a9-a4c0-48f3-b01a-72011cdad43e`.
- Lokaler Fingerprint, bestehende Build-Runtime und veröffentlichte iOS-Runtime: `b99c3cf0dd56e6b1bb126d195f21c665de57760b`.
- Updategruppe: `6a014c36-2fe9-4254-926e-65054a71b186`; iOS-Update: `01a192c1-2438-7d12-8ad8-ff55ca8a7beb`.
- Veröffentlicht: `2026-10-31T16:18:13.688Z` (17:18 Uhr Europe/Berlin); Nachricht „Gehalt: bisherige Ansichten, eine Zulagen-Einstellung und dezenter Monatshinweis“; EAS CLI 27.2.0.
- Export und Veröffentlichung mit explizitem Preview-Environment. Der aktive Preview-Kanal zeigt auf Branch `preview`; seine neueste iOS-Gruppe entspricht dieser Veröffentlichung. Manifest-App-Variante und Bundle-ID wurden direkt über EAS Update geprüft. Der SHA-256-Hash des ausgelieferten Bundles stimmt mit dem lokal geprüften iOS-Bundle überein.
- Aus dem geprüften lokalen Arbeitsstand auf Basis `d1b13ac788044a7564c673170bf3753547728315` veröffentlicht. Keine zusätzliche Codeänderung, kein Commit, Push, neuer nativer Build oder TestFlight-/Store-Release.
- Die frühere überladene Preview wurde durch diese Gruppe ersetzt. Die tatsächliche Installation und Sichtprüfung auf dem iPhone bleibt offen.

## Netto-Schätzung für verschobene Zulagen

Versatz 0 verwendet unverändert die bisherige Berechnung. Ein vollständiges verschobenes Bundle wird bei unveränderten relevanten Grundlagen aus der aktuellen Basis und den zusätzlichen Abzügen im Quellenmonat geschätzt:

`Netto = aktuelle Basis + Brutto der Quellenzulagen − zusätzliche Quellensteuer − zusätzliche Quellen-SV − zusätzliche Quellen-Zusatzversorgung`.

Die zusätzlichen Abzüge ergeben sich jeweils aus Quelle mit und ohne vollständigem Zulagenbundle. Beide Quell-Endpunkte enthalten weder Jahreszahlung noch persönliche Nettoabzüge. Die aktuelle Jahreszahlung wird über ein eigenes marginales Delta ergänzt; aktuelle persönliche Nettoabzüge werden genau einmal am Ende berücksichtigt. Es werden keine vollständigen Monatsgehälter addiert. Die SFN-Zeiten und Stundenlohngrundlagen bleiben beim ursprünglichen Dienstmonat.

Für eine verschobene monatliche Schichtzulage wird zunächst nur der neutrale Ersatz eines gleichen aktuellen Anspruchs bei gleichem Zulagentyp und unveränderten relevanten Steuer-/SV-/Versorgungsgrundlagen unterstützt. Fehlende Quellenangaben, andere Monatszulagen, Teilmonate, Basis- und Jahreswechsel bekommen keinen erfundenen Ersatzwert. Fehlende Netto-Angaben verweisen in die bestehenden Einstellungen des betroffenen Quellenmonats.

Das ist eine Prognose mit der Annahme, dass die Quellen-Nachberechnung mit der Auszahlung einbehalten wird. Diese Annahme steht einmal in den vorhandenen Berechnungsgrundlagen. Unterschiedliche Arbeitgeberverfahren und zusätzliche Korrekturen sind damit nicht als exakte Bankzahlung zugesichert. Grundlage der Modellentscheidung sind die periodische Nachberechnung laufender Bezüge nach [BMF R39b.5 (2026)](https://esth.bundesfinanzministerium.de/lsth/2026/A-Einkommensteuergesetz/VI-Steuererhebung-36-47/2-Steuerabzug-vom-Arbeitslohn-Lohnsteuer-38-42g/Paragraf-39b/r-39b-5.html), die besonderen Regeln für regelmäßig verzögerte variable Bezüge in der [DRV GRA §14](https://rvrecht.deutsche-rentenversicherung.de/SharedDocs/rvRecht/01_GRA_SGB/04_SGB_IV/pp_0001_25/p_0014/gra_sgb004_p_0014_beitragsberechnung.html) und die Unterscheidung vom tatsächlichen Arbeitnehmerabzug in [§28g SGB IV](https://www.gesetze-im-internet.de/sgb_4/__28g.html).

Der Prüfdatensatz reproduziert 4.075,58 € Grundentgelt, 141,82 € Pflegezulage, 25 € Tarifzulage, 234,63 € Quellen-Zeitzuschläge und 250 € unveränderte monatliche Schichtzulage: Cash-Brutto 4.727,03 €. Echte synthetische Dienste liefern die SFN-Beträge; aktuelle Oktoberdienste und Überstunden werden nicht in dieses Cash-Netto übernommen. Der synthetische Oktober-Überstundenbetrag ist tariflich 92,59 € und wird nicht künstlich an die 88,61 € aus dem Gerätefoto angepasst.
