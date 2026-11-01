# Gehalt: bekannte Ansichten nach iPhone-Rückmeldung

## Auftrag vom 31.10.2026

Die vier neuen Referenzfotos korrigieren gezielt die veröffentlichte klassische Preview `b5d90e63-73d0-43c8-b63d-e0dbcff75f25`.

- Erarbeitete Zuschläge: wieder „Zuschläge je Dienst“ mit Summenkarte einschließlich steuerfreier/steuerpflichtiger Anteile, Filterchips, zusammenhängender Dienstliste und bisherigem Detailfenster je Dienst.
- Auswertung: die eigene Gehaltskarte erhält wieder ihren früheren Aufbau und Titel „Gehalt“. Die separate Karte „Zuschläge erarbeitet“ bleibt erhalten.
- Netto-Einstellungen: wieder die bekannte Einstiegskarte mit Zusammenfassung und eigener Einstellungsseite; keine vollständige Eingabemaske auf der Gehaltsübersicht.
- Abzüge: wieder die vorhandene eigene Abzugsansicht mit Summenkarte, einzelnen positiven Abzugsbeträgen sowie Steuer-/SV-Berechnungsgrundlagen. Die vorher ausdrücklich gewünschte Ausblendung von null Euro bei Soli/Kirche bleibt bestehen.
- Unverändert: Dienst-/Anspruchsmonat und Auszahlung trennen, echte Originaldienstzeiten verwenden, Zulagenversatz 0/1/2 und bisherige geprüfte Brutto-/Netto-Berechnung. Keine Werte aus den Fotos übernehmen oder gespeicherte Zeitregeln zurücksetzen.
- Bestätigte UI-Abgrenzung: der Nutzer behält die klassische Gehaltsaufstellung ausdrücklich bei; nur die Netto-Einstellungskarte und die separate Abzugsseite kommen im früheren Aufbau zurück. Die gesamte Hauptseite wird nicht auf Foto 3 zurückgesetzt.
- Plattform: iOS-Preview, Expo ~57.0.31 und passende SDK-57-Dokumentation geprüft. Die Fotos sind die konkrete visuelle Referenz; die neue Umsetzung benötigt anschließend eine eigene Sichtprüfung.
- Arbeitspakete/Dateiscope: (1) erarbeitete Dienstliste/Klassifikation, (2) Auswertungskarte, (3) Abzugsansicht, (4) Hauptseiten-Einstiege; jeweils vorhandene Komponenten und zugehörige Tests. Keine neue Engine, native Abhängigkeit oder Datenbankmigration.
- Abnahme: lagunabhängige erarbeitete Monatsbeträge/Originaldienste; korrekte Auszahlungssummen; funktionierende Filter und Dienstfenster; bekannte Einstellungs- und Abzugseinstiege mit Monatsrückkehr; Fehler-/Testdatenfälle ehrlich erhalten; keine Nullzeilen bei Soli/Kirche.
- Branch: `codex/gehalt-auszahlung`, vorhandene Arbeit wird weitergeführt. Unabhängige Arbeitsstände bleiben unberührt.
- Checks: gezielte Tests, `npm.cmd run verify:fast`, aktueller iOS-Export; danach iPhone-Sichtprüfung.
- Freigabe: Umsetzung war beauftragt. Nach erfolgreicher lokaler Prüfung hat der Nutzer das neue iOS-Preview-Update mit „Ja“ ausdrücklich freigegeben. Commit, Push, neuer Build und TestFlight-/Store-Veröffentlichung bleiben getrennt.

## Stand

Die vier abgegrenzten Pakete sind implementiert. Gezielte Tests, vollständiger Projektcheck und lokaler iOS-Export sind erfolgreich. Die anschließend freigegebene iOS-Preview-OTA ist veröffentlicht und technisch nachgeprüft; die Geräteabnahme steht aus.

## Umsetzung

- „Zuschläge erarbeitet“ verwendet wieder `SalaryPremiumCard` und `NetPayServiceDetails` mit Filterchips, zusammenhängender Liste und bestehendem `SelectionSheet`. Der Dienstmonat liefert Originalzeiten und Beträge; seine steuerliche Aufteilung verwendet die dort gültigen Netto-Angaben, unabhängig vom Zahlungsversatz. Ein historisches Tarifprofil wird vor der Entscheidung „manuelles Gehalt“ aufgelöst.
- Die Gehaltskarte in der Auswertung verwendet wieder die bisherige `PayListCard`: Grundgehalt, Zeitzuschläge, weitere Zulagen, gegebenenfalls Überstunden/Sonderzahlung sowie Brutto-/Netto-Summe. Die Daten bleiben die echte Auszahlungsprojektion. Die eigene Karte für erarbeitete Zuschläge und ihre unabhängige Sichtbarkeit bleiben bestehen.
- Die klassische Hauptaufstellung bleibt erhalten. Oberhalb steht wieder die bekannte `NetPaySettingsEntry` mit Zusammenfassung und Einstieg zur vorhandenen eigenen Einstellungsseite. Der Auszahlungswähler ist separat direkt sichtbar; die vollständige Netto-Eingabemaske wird dort nicht mehr eingebettet.
- Die Abzugszeile öffnet die vorhandene Abzugsseite mit passendem Auszahlungsmonat. Sie zeigt die Summe, positive Einzelbeträge in der Foto-Reihenfolge und Berechnungsgrundlagen. Reguläre Zusatzversorgung bleibt bei einer nur teilweise offenen Sonderzahlungs-Zusatzversorgung sichtbar. Soli/Kirche bleiben bei null ausgeblendet.
- Historische Netto-Einstellungen verwenden auf der wieder eingebundenen eigenen Seite das zum Editor-Monat gehörende Arbeitsprofil, einschließlich Sachsen und Kirchensteuer-Voreinstellung. Vorhandene Gültigkeits-, Speicher-, Konflikt- und Zurückregeln werden weiterverwendet.
- Die eigene Dienstseiten-Kopfzeile ersetzt den zusätzlichen Stack-Header, damit kein doppelter Kopf entsteht. Die direkte Rückkehr führt zur Auswertung. Der bisherige TV-UK-Hinweis auf zusätzlichen Nacht-Freizeitausgleich bleibt erhalten.

## Prüfung

Fokussiert bestanden: 74 bisherige Gehalts-/Speicherfälle, 65 Tarif-/Navigations- und Ansichtsprüfungen, 25 Einstellungs-/Aufstellungsfälle, 17 direkte Auswertungskartenfälle, neun Dienstansichtsregressionen sowie sechs Abzugsfälle. Dazu gehören 399,87 € erarbeitete Oktober-Zuschläge bei jedem Versatz, echte SFN-Aufteilung und Dienstfenster, nicht rückdatierte Nettodaten, historische Sachsenangaben und unveränderte Sonderzahlungs-/Bereitschafts-/Zusatzversorgungssummen.

`npm.cmd run verify:fast` ist mit Exit 0 abgeschlossen: Typprüfung, Lint, Formatierung, 535 Fachtestsuiten mit 10.286 Tests, 186 Komponententestsuiten mit 1.765 Tests sowie alle abschließenden Skriptprüfungen sind erfolgreich. Nachweis: lokales, ignoriertes Protokoll `.verify-bekannte-ansichten.log`. Der abschließende Diffcheck ist ebenfalls fehlerfrei.

Der lokale iOS-Export mit `APP_VARIANT=internal` ist erfolgreich: `entry-17766898825a5b2576f225f8bee93642.hbc`. Nachweis: `.export-bekannte-ansichten.log`. Zum Abschluss dieses Prüfschritts war noch kein neues EAS Update ausgeführt. Die spätere Freigabe und Veröffentlichung sind nachstehend dokumentiert. Es wurde weder ein Commit noch ein Push, neuer nativer Build oder TestFlight-/Store-Release ausgeführt.

## Freigegebene iOS-Preview-OTA vom 31.10.2026

Nach ausdrücklichem „Ja“ auf die Frage, ob der korrigierte Stand im iOS-Preview bereitgestellt werden soll:

- Kanal, Branch und Environment: `preview`; App-Variante `internal`, Bundle-ID `com.pflegeshift.app.internal`.
- Bestehender kompatibler Preview-Build 44: `812ea1a9-a4c0-48f3-b01a-72011cdad43e`, Status `FINISHED`. Frischer lokaler Fingerprint, Build-Runtime und neue Update-Runtime stimmen exakt überein: `b99c3cf0dd56e6b1bb126d195f21c665de57760b`.
- Updategruppe: `c45baf66-0de8-4698-b59b-e07ec6f2baf8`; iOS-Update-ID: `01a19375-bb53-7691-8655-4b9f3a46e89d`.
- Veröffentlicht: `2026-10-31T19:35:28.851Z`; Nachricht „Gehalt: bekannte Karten, Zuschlaege je Dienst und separate Abzugsansicht“; EAS CLI 27.2.0.
- Der aktive Preview-Kanal zeigt auf Branch `preview`, dessen neueste iOS-Gruppe diese Veröffentlichung ist. Das Manifest bestätigt Runtime, interne App-Variante, Bundle-ID und Projekt-ID.
- EAS hat im Preview-Environment erneut mit Source-Maps exportiert. Der Veröffentlichungsexport trägt denselben Bundle-Dateinamen wie der vorbereitende Export, ist jedoch nicht bytegleich. Die 1.830 vor Veröffentlichung erfassten Quelldateien sind unverändert. Der SHA-256-Hash des tatsächlich veröffentlichten Exports ist `5e1ec199490012296899c8d2cabd9da9db4c64c1d059e1bfe5636c5006ad2476`; er stimmt mit Manifest und direkt heruntergeladenem CDN-Bundle überein (9.875.740 Bytes).
- Der erste manuelle CDN-Prüfabruf ohne die Asset-Download-Header aus dem Multipart-Manifest erhielt HTTP 403. Mit den vom Server gelieferten `assetRequestHeaders` gelingt der protokollgerechte Download und der vollständige Bytevergleich. Es war keine Änderung an App oder Server erforderlich.
- Lokale, ignorierte Nachweise: `dist/preview-gehalt-bekannt-preflight/compatibility.json`, `delivery-proof.json`, `manifest-proof.json`, EAS-Metadaten und Veröffentlichungsprotokoll. Export: `dist/preview-gehalt-bekannt`.
- Veröffentlicht vom geprüften lokalen Arbeitsstand auf Basis `d1b13ac788044a7564c673170bf3753547728315`. Keine zusätzliche Codeänderung, kein Commit, Push, neuer nativer Build oder TestFlight-/Store-Release.
- Offen auf dem iPhone: beide Auswertungskarten, Dienstfilter und Detailfenster, Netto-Einstellungskarte mit Speichern/Rückkehr, separate Abzugsseite, ausgeblendete Nullwerte für Soli/Kirche sowie Zulagenversatz und Monatsnavigation prüfen. Light/Dark und größere Schrift einschließen. Veröffentlichung und Hashnachweis ersetzen diese Sicht- und Funktionsabnahme nicht.

## Nachtrag: Monatszusatz unter der Trennlinie

Der anschließende iPhone-Screenshot zeigt die veröffentlichte Auswertung. Gewünscht ist, „Für Dienste im Oktober 2026“ in der Karte „Zuschläge erarbeitet“ wie den Herkunftshinweis der Gehaltskarte unter der unteren Trennlinie zu platzieren.

- Ziel/Plattform: gleiche Anordnung und dezente Typografie des Zusatzes auf dem iPhone.
- Dateiscope: nur `EarnedPremiumsCard` in `src/features/analysis/salary-overview-cards.tsx` sowie dieser Nachweis. Die bereits vorhandene Option `captionBelowFooter` der gemeinsamen Kartenkomponente wird aktiviert, wie bei `PayListCard`.
- Nicht-Ziele: Beträge, Texte, Monatslogik, Navigation oder andere Karten ändern.
- Abnahme: Hinweis unter der Linie; Betrag darüber; Monatsbezug und direkter Einstieg unverändert. Sichtprüfung nach gesondert freigegebener Preview-OTA offen.
- Stand vor der gemeinsamen Veröffentlichung: implementiert. Die fünf bestehenden Kartenprüfungen sind erfolgreich. `npm.cmd run verify:fast` ist mit Exit 0 abgeschlossen: Typprüfung, Lint, Formatierung, 535 Fachtestsuiten mit 10.286 Tests, 186 Komponententestsuiten mit 1.765 Tests und sämtliche abschließenden Skriptprüfungen sind grün. Nachweise: `.test-zuschlag-hinweis.log`, `.verify-zuschlag-hinweis.log`. Diffcheck erfolgreich. Zu diesem Zeitpunkt war gegenüber der veröffentlichten Preview genau eine Quelldatei verändert und noch keine zusätzliche Veröffentlichung freigegeben. Die spätere gemeinsame OTA ist unten dokumentiert; die iPhone-Sichtprüfung bleibt offen.

## Nachtrag: Summenkarte folgt dem Zuschlagsfilter

Auftrag: Bei Auswahl einer Zuschlagsart (etwa Nacht, Samstag, Sonntag oder Feiertag) zeigt die Summenkarte oben ausschließlich den Betrag dieser Art. Nur „Alle“ zeigt den gesamten Zuschlagsbetrag. Die Hinweise auf steuerfreie und steuerpflichtige Anteile müssen zur Auswahl passen.

- Zielplattform: iOS; vorhandene Ansicht „Zuschläge je Dienst“ über beide bisherigen Einstiege.
- Dateiscope: gemeinsame Dienstansicht, ihre zwei Bildschirm-Einstiege und gezielte Präsentations-/Integrationstests. Die Summenkarte verwendet denselben Filterzustand wie die Liste.
- Nicht-Ziele: Tarif-/Steuerregeln, Berechnungs-Engine, Dienstfenster, Monatszuordnung oder Gestaltung weiterer Seiten ändern.
- Abnahme: Filterbetrag entspricht der Summe der angezeigten Zuschlagsart, auch wenn ein Dienst mehrere Zuschläge enthält. „Alle“ stellt Gesamtbetrag und gesamte Steueraufteilung wieder her. Fehlende Steuerdaten bleiben unbekannt. Sonderdienste dürfen über mehrere Quelltraces nicht doppelt zählen. Monatswechsel und verschwundene Kategorien hinterlassen keine veraltete Filtersumme.
- Veröffentlichung: Zunächst hat der Nutzer ausdrücklich „Noch nicht, weitere Änderungen“ angewiesen; deshalb blieben Filter- und Hinweis-Korrektur lokal. Mit dem späteren Auftrag „Alles ota“ wurden beide gemeinsam für das bestehende iOS-Preview freigegeben; siehe nachstehende Veröffentlichung. Keine Build- oder Git-Freigabe.
- Umsetzung: Die gemeinsame Dienstansicht besitzt nun Summenkarte und Filterzustand gemeinsam. Beide bisherigen Einstiege verwenden sie. Kategorienbetrag und Dienstliste nutzen dieselben gefilterten Centbeträge. Die Steueraufteilung verwendet ausschließlich die vorhandenen klassifizierten Anteile derselben Kategorie; bei nicht eindeutig trennbaren Tarifschlüsseln bleibt sie unbekannt. Die vorherige Gesamtsummenkarte wird nicht zusätzlich gerendert. Bestehende Hinweise, Dienstfenster, Abstände und Quellmonate bleiben erhalten.
- Gezielt geprüft: Die neue Regression konnte den bisherigen unveränderten Gesamtbetrag bei „Nacht“ vor dem Fix reproduzieren. Danach bestehen die neun Prüfungen der erarbeiteten Dienstseite und alle 74 bisherigen Gehalts-/Speicherprüfungen. Sieben neue Interaktionsfälle prüfen vier Zuschlagsarten mit gemischten Diensten, Rückkehr zu „Alle“, fehlende Steuerdaten, verschwundene Filterkategorien, mehrdeutige Feiertagsschlüssel und mehrere Einsätze desselben Sonderdienstes. Die Summe und die steuerfreien/steuerpflichtigen Anteile folgen jeweils der Auswahl. Nachweise: `.test-zuschlag-filter-before.log`, `.test-zuschlag-filter-after.log`, `.test-zuschlag-filter-focused.log`, `.test-zuschlag-filter-direct.log`.
- Stand vor der gemeinsamen Veröffentlichung: lokal implementiert und geprüft. `npm.cmd run verify:fast` ist mit Exit 0 abgeschlossen: Typprüfung, Lint, Formatierung, 535 Fachtestsuiten mit 10.286 Tests, 187 Komponententestsuiten mit 1.772 Tests sowie alle abschließenden Skriptprüfungen sind grün. Nachweis: `.verify-zuschlag-filter.log`. Diffcheck erfolgreich, Codeindex aktualisiert. Gegenüber der vorherigen Preview betreffen die Änderungen sechs vorhandene Quelldateien (einschließlich des vorigen Monatshinweis-Fixes) sowie die neue Filter-Testdatei. Kein Commit, Push oder Build. Sichtprüfung auf dem iPhone weiterhin offen.

## Gemeinsame iOS-Preview-OTA für Monatshinweis und Zuschlagsfilter

Nach ausdrücklichem Auftrag „Alles ota“ sind beide zuletzt lokal gehaltenen Korrekturen gemeinsam veröffentlicht:

- Kanal, Branch und Environment: `preview`; App-Variante `internal`, Bundle-ID `com.pflegeshift.app.internal`.
- Bestehender Preview-Build 44: `812ea1a9-a4c0-48f3-b01a-72011cdad43e`, Status `FINISHED`. Frischer lokaler Fingerprint, Build-Runtime und veröffentlichte Runtime stimmen exakt überein: `b99c3cf0dd56e6b1bb126d195f21c665de57760b`.
- Updategruppe: `54612983-a03f-44ba-9e0e-b4bae9055d40`; iOS-Update-ID: `01a19400-562f-7a14-ba0f-c475f0f9f748`.
- Veröffentlicht: `2026-10-31T22:06:52.463Z`; Nachricht „Zuschlaege: gefilterte Summe und Monatshinweis unter der Linie“; EAS CLI 27.2.0. Vorgängergruppe: `c45baf66-0de8-4698-b59b-e07ec6f2baf8`.
- Der aktive Preview-Kanal zeigt auf Branch `preview`, dessen neueste iOS-Gruppe diese Veröffentlichung ist. Das Manifest bestätigt Runtime, interne App-Variante, Bundle-ID und Projekt-ID.
- Frischer EAS-Veröffentlichungsexport: `entry-e27a4788287ee7afba946a5717eccd90.hbc`, 9.876.800 Bytes. SHA-256 `da8d0d4be65ee7b3bd96cc6638e8b5b75c1227506efc5a542d1d28fc5ad3f904` stimmt mit Manifest und dem vollständig heruntergeladenen CDN-Bundle überein. Die Asset-Download-Header aus der Multipart-Antwort wurden verwendet.
- Alle 1.831 vor Veröffentlichung erfassten Quelldateien sind unverändert. Die Veröffentlichung enthält damit den bereits vollständig geprüften Stand; keine weitere App-Codeänderung in diesem Freigabeschritt.
- Lokale, ignorierte Nachweise: `dist/preview-zuschlag-filter-preflight/compatibility.json`, `delivery-proof.json`, EAS-Metadaten, Quellhashes und Veröffentlichungsprotokoll. Export: `dist/preview-zuschlag-filter`.
- Veröffentlicht vom lokalen Arbeitsstand auf Basis `d1b13ac788044a7564c673170bf3753547728315`. Kein Commit, Push, neuer nativer Build oder TestFlight-/Store-Release.
- Offen auf dem iPhone: Monatshinweis unter der Linie prüfen; danach Nacht/Samstag/Sonntag/Feiertag auswählen und jeweilige Summe sowie Steueraufteilung prüfen. „Alle“ muss den gesamten Zuschlagsbetrag wiederherstellen. Filter nach Öffnen/Schließen des Dienstfensters und Monatswechsel prüfen; Light/Dark und größere Schrift einschließen. Technische Auslieferungsnachweise ersetzen diese Sicht- und Funktionsabnahme nicht.

## Nachtrag: bekannte Kartenform für Zusammensetzung und Netto-Berechnung

Der Nutzer zeigt den früheren Bildschirm „Gehaltsbestandteile“ als Formreferenz. Die neue Gehaltsseite soll bei „Zusammensetzung“ und „Netto-Berechnung“ dieselben ruhigen, abgerundeten Karten mit abgesetzter Kopfzeile und feinen Zeilentrennern verwenden.

- Ziel/Plattform: die bekannte iPhone-Kartenoptik auf die aktuelle klassische Gehaltsaufstellung übertragen; die Hauptseite bleibt eine durchgehende Seite.
- Dateiscope: Präsentation in `src/features/salary/salary-payroll-content.tsx`, bestehende Bildschirm-/Katalogtest-Lokatoren und dieser Nachweis. Verwendung von `SalarySectionCard`, `SalaryAmountRow` und `CardSeparator` wie im Foto; keine globalen Design-Token ändern.
- Nicht-Ziele: Beträge, Berechnung, Anspruchs-/Auszahlungsmonate, Netto-Einstellungen, erarbeitete Zuschläge oder die bestehende separate Abzugsseite verändern. Keine Werte aus dem alten Screenshot übernehmen.
- Umsetzung: zwei eigene Standardkarten „Zusammensetzung“ und „Netto-Berechnung“ ersetzen die gemeinsame Karte mit kleinem Radius und kräftigen 2-Punkt-Linien. Einzelfelder erhalten die bekannten feinen Trenner. Die Netto-Summe bleibt betont; die vorhandenen direkten Einstiege und aufklappbaren Berechnungsdetails bleiben erhalten. Die großen Brutto-/Netto-Beträge oben bleiben sichtbar.
- Abnahme: gleiche Kartenform, Kopfzeilen, Zeilenoptik und Abstände wie im Referenzbild, aktuelle Auszahlungssummen und Quellen weiterhin korrekt; keine neuen Unterseiten oder doppelt addierten Gehaltsbestandteile. Prüfung mit Light/Dark, schmalem iPhone und großer Schrift.
- Freigabe: Nach lokaler Umsetzung und vollständiger Prüfung hat der Nutzer die neue iOS-Preview-OTA mit „Ja“ ausdrücklich freigegeben. Build und Git-Veröffentlichung bleiben getrennt. Die vorherige OTA-Freigabe betraf den vorigen Hinweis-/Filterstand.
- Stand: lokal implementiert. Die 142 bestehenden Gehalts-, Darstellungs- und Katalogfälle bestehen, einschließlich Brutto-/Netto-Abgleich, separater Abzugsansicht, Zulagenmonaten 0/1/2, Sonderzahlungen, fehlenden Angaben sowie schmalen Ansichten und großer Schrift. Alte Prüfungen auf das Fehlen der neuen Überschrift wurden auf sichtbare Abschnittsüberschriften bei weiterhin fehlender zusätzlicher Navigationsstufe angepasst. Nachweise: `.test-gehalt-kartenform.log`, `.test-gehalt-kartenform-integration.log`.
- Vollständige Prüfung: `npm.cmd run verify:fast` ist mit Exit 0 abgeschlossen; Typprüfung, Lint, Formatierung, 535 Unit-Testdateien mit 10.286 Tests, 187 Komponentensuiten mit 1.772 Tests und alle abschließenden Skriptprüfungen sind erfolgreich. Nachweis: `.verify-gehalt-kartenform.log`. Diffcheck erfolgreich, Codeindex aktualisiert. Gegenüber der vorherigen Preview wurde eine Präsentationsdatei plus zwei bestehende Testdateien geändert. Die danach freigegebene OTA ist nachstehend dokumentiert. Die iPhone-Sichtprüfung bleibt offen. Kein Commit, Push oder nativer Build.

## Freigegebene iOS-Preview-OTA der Kartenkorrektur

Nach ausdrücklichem „Ja“ auf die Frage zur Bereitstellung der neuen Kartenoptik veröffentlicht:

- Kanal, Branch und Environment: `preview`; App-Variante `internal`, Bundle-ID `com.pflegeshift.app.internal`.
- Bestehender Preview-Build 44: `812ea1a9-a4c0-48f3-b01a-72011cdad43e`, Status `FINISHED`. Frischer lokaler Fingerprint, Build-Runtime und veröffentlichte Runtime stimmen exakt überein: `b99c3cf0dd56e6b1bb126d195f21c665de57760b`.
- Updategruppe: `52b74700-e39a-47d6-bab4-37a82be12a74`; iOS-Update-ID: `01a1943c-afef-73bb-ab3b-3ff793a7cb78`.
- Veröffentlicht: `2026-10-31T23:12:47.599Z` (01.11.2026 in Berlin); Nachricht „Gehalt: vertraute Karten fuer Zusammensetzung und Netto-Berechnung“; EAS CLI 27.2.0. Vorgängergruppe: `54612983-a03f-44ba-9e0e-b4bae9055d40`.
- Der aktive Preview-Kanal zeigt auf Branch `preview`, dessen neueste iOS-Gruppe diese Veröffentlichung ist. Das Manifest bestätigt Runtime, interne App-Variante, Bundle-ID und Projekt-ID.
- Frischer Veröffentlichungsexport: `entry-d747b5eadc0acddf59595e1d96820146.hbc`, 9.876.788 Bytes. SHA-256 `b90189088b5c6262cd90266dc8a64dbce0303a3ac9b36ac62ffcac5e87ed6aa2` stimmt mit Manifest und dem vollständig heruntergeladenen CDN-Bundle überein. Die Asset-Download-Header aus der Multipart-Antwort wurden verwendet.
- Alle 1.831 vor Veröffentlichung erfassten Quelldateien sind unverändert. Keine weitere App-Codeänderung nach dem grünen Gesamtcheck.
- Lokale, ignorierte Nachweise: `dist/preview-gehalt-kartenform-preflight/compatibility.json`, `delivery-proof.json`, EAS-Metadaten, Quellhashes und Veröffentlichungsprotokoll. Export: `dist/preview-gehalt-kartenform`.
- Veröffentlicht vom lokalen Arbeitsstand auf Basis `d1b13ac788044a7564c673170bf3753547728315`. Kein Commit, Push, neuer nativer Build oder TestFlight-/Store-Release.
- Offen auf dem iPhone: Kartenform, Kopfzeilen, feine Trenner und Ausrichtung von „Zusammensetzung“ und „Netto-Berechnung“ gegen das Referenzfoto prüfen; Light/Dark und größere Schrift einschließen. Direkter Abzugseinstieg und Berechnungsdetails müssen weiter funktionieren. Technische Auslieferungsnachweise ersetzen die Sicht- und Funktionsabnahme nicht.

## Nachtrag: Zusammenfassung als Karte und Berechnungsgrundlagen nur bei Abzügen

Die neuen iPhone-Screenshots zeigen drei konkrete Korrekturen an der veröffentlichten Kartenfassung: den doppelten unteren Bereich „Berechnungsgrundlagen“ entfernen, Gesamtbrutto/Netto oben in eine Karte setzen und den Abzugsbetrag auf dieselbe rechte Kante wie die übrigen Beträge ausrichten.

- Zielplattform: iOS. Dateiscope: Gehalts-Präsentation, gemeinsame Betragszeile mit optionaler lokaler Pfeilposition sowie vorhandene Abzugsansicht und ihre Notizübergabe; dazu bestehende Integrationstests und dieser Nachweis.
- Umsetzung: Die zwei oberen Kennzahlen erhalten eine gemeinsame Standardkarte mit passender Innenkante. Bei schmaler Ansicht/großer Schrift bleibt die vertikale Anordnung erhalten. Der Abzugspfeil steht neben dem Label; der Betrag bleibt rechts bündig. Andere Betragszeilen behalten ihre bisherige Pfeilposition.
- Die doppelte untere Grundlagen-Karte entfällt vollständig, einschließlich einer sonst leeren Kartenhülle. Steuer-/SV-Grundlagen stehen auf der Abzugsseite. Vorhandene ergänzende Quellmonats-/Sonderzahlungsnotizen werden ebenfalls dort angezeigt. Der relevante 2027-Vorläufigkeitshinweis bleibt bei den oberen Kennzahlen sichtbar. Der vorhandene Sonderzahlungseditor bleibt bei Bedarf erhalten.
- Nicht-Ziele: Beträge, finanzielle Berechnung, Zulagenversatz, Monats-/Anspruchszuordnung, Filter oder globale Designtokens verändern.
- Abnahme: eine gerahmte Brutto-/Netto-Zusammenfassung, keine zusätzliche Grundlagen-Schaltfläche auf der Hauptseite, Bündigkeit der Geldspalte, Abzugsnavigation und dortige Grundlagen/Notizen unverändert erreichbar; Light/Dark und große Schrift prüfen.
- Freigabe: Nach lokaler Umsetzung und vollständigem Check hat der Nutzer die iOS-Preview-OTA mit „Ja“ ausdrücklich freigegeben. Commit, Push und nativer Build bleiben getrennt.
- Gezielt geprüft: alle 99 vorhandenen Fälle der Gehaltsintegration, klassischen Darstellung, Abzugsansicht und Dienstfilter bestehen. Die bisherigen Grundlagen-Prüfungen nutzen nun den Abzugseinstieg und prüfen dort dieselben Steuer-/SV-Werte sowie Quellmonatsnotizen; die alten Monats-/Netto-/Sonderzahlungsfälle bleiben erhalten. Der 2027-Vorläufigkeitshinweis ist direkt bei der Zusammenfassung nachgewiesen. Nachweis: `.test-gehalt-zusammenfassung.log`.
- Stand: umgesetzt. `npm.cmd run verify:fast` ist mit Exit 0 abgeschlossen: Typprüfung, Lint, Formatierung, 535 Unit-Testdateien mit 10.286 Tests, 187 Komponentensuiten mit 1.772 Tests und alle abschließenden Skriptprüfungen sind grün. Nachweis: `.verify-gehalt-zusammenfassung.log`. Diffcheck erfolgreich, Codeindex aktualisiert. Gegenüber der vorherigen Preview wurden vier Präsentationsdateien und die bestehende Gehaltsintegrationstestdatei geändert. Die anschließend freigegebene OTA ist nachstehend dokumentiert. Kein Commit, Push oder nativer Build. Die iPhone-Sichtprüfung bleibt offen.

## Freigegebene iOS-Preview-OTA für Zusammenfassung und Abzugsdarstellung

Nach ausdrücklichem „Ja“ auf die Frage zur Bereitstellung der drei Korrekturen veröffentlicht:

- Kanal, Branch und Environment: `preview`; App-Variante `internal`, Bundle-ID `com.pflegeshift.app.internal`.
- Bestehender Preview-Build 44: `812ea1a9-a4c0-48f3-b01a-72011cdad43e`, Status `FINISHED`. Frischer lokaler Fingerprint, Build-Runtime und veröffentlichte Runtime stimmen exakt überein: `b99c3cf0dd56e6b1bb126d195f21c665de57760b`.
- Updategruppe: `284807f9-0700-4619-8fed-06b54293c20f`; iOS-Update-ID: `01a1949b-8cbf-7403-ae81-c113c674fce2`.
- Veröffentlicht: `2026-11-01T00:56:24.511Z`; Nachricht „Gehalt: Summenkarte, buendige Abzuege und Grundlagen nur bei Abzuegen“; EAS CLI 27.2.0. Vorgängergruppe: `52b74700-e39a-47d6-bab4-37a82be12a74`.
- Der aktive Preview-Kanal zeigt auf Branch `preview`, dessen neueste iOS-Gruppe diese Veröffentlichung ist. Das Manifest bestätigt Runtime, interne App-Variante, Bundle-ID und Projekt-ID.
- Frischer Veröffentlichungsexport: `entry-f64bac699ca71e2a05b53f9cd120b285.hbc`, 9.876.800 Bytes. SHA-256 `05c133b48c01249f2caef54ee77d8c8b9d190b2276757d61b8d56be92f1b4950` stimmt mit Manifest und dem vollständig heruntergeladenen CDN-Bundle überein. Die Asset-Download-Header aus der Multipart-Antwort wurden verwendet.
- Alle 1.831 vor Veröffentlichung erfassten Quelldateien sind unverändert. Keine weitere App-Codeänderung nach dem grünen Gesamtcheck.
- Lokale, ignorierte Nachweise: `dist/preview-gehalt-zusammenfassung-preflight/compatibility.json`, `delivery-proof.json`, EAS-Metadaten, Quellhashes und Veröffentlichungsprotokoll. Export: `dist/preview-gehalt-zusammenfassung`.
- Veröffentlicht vom lokalen Arbeitsstand auf Basis `d1b13ac788044a7564c673170bf3753547728315`. Kein Commit, Push, neuer nativer Build oder TestFlight-/Store-Release.
- Offen auf dem iPhone: gemeinsame Brutto-/Netto-Karte und Bündigkeit der Geldspalte prüfen; der Pfeil steht neben „Abzüge“. Die untere Grundlagen-Karte darf nicht mehr erscheinen; die Grundlagen einschließlich ergänzender Quellmonats-/Sonderzahlungsnotizen müssen über „Abzüge“ erreichbar bleiben. Light/Dark und größere Schrift einschließen. Technische Auslieferungsnachweise ersetzen die Sicht- und Funktionsabnahme nicht.
