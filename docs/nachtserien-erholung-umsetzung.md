# Nachtserien und anschließende Erholung

## Task-Vertrag

- Ziel: Die freigegebene Regelmatrix vom 07.11.2026 umsetzen: Hinweis ab der vierten aufeinanderfolgenden Nacht; nach abgeschlossenen Serien ab zwei Nächten Hinweise bei weniger als 24 beziehungsweise 48 Stunden arbeitsfreier Zeit.
- Plattform: plattformunabhängige Berechnung, bestehende iPhone-Oberfläche. Info-Symbol, neutrale Flächen/Texte und petrolfarbener Rahmen bleiben erhalten.
- Nicht-Ziele: gesetzliche Schwellen, signierte Regelpakete, Tarif-/Gehaltsberechnung, Jugend-/Mutterschutzregeln, native Integration und Veröffentlichungen.
- Dateiscope: neue wissenschaftliche Planungspolicy und Nachtserienberechnung, Anbindung in der Compliance-Engine, typisierte Darstellungsfakten, vorhandene Prüfungsdetails einschließlich Quellen und zugehörige Tests; dieses Dokument und die genaue Quellzuordnung des lokalen Kandidaten.
- Arbeitspakete: 1. Berechnung, Datenqualität und fachliche Regressionstests. 2. Bestehende neutrale Darstellung, Quellenzugang und Darstellungstests. 3. Eng begrenzter Quellnachweis für die neun geänderten/neuen App-Quelldateien in `releases/testflight/build-9.reviewed-changes.json` und Abschluss der Prüf-Gates. Der dritte Schritt ergänzt einen Dateinachweis für die autorisierte Umsetzung; er behauptet keine Geräteabnahme und verändert keine akzeptierte Baseline.
- Abnahme: exakte Grenzen, reale verstrichene Zeit bei Zeitumstellung, Monat/Jahr, tatsächliche Nachtfenster, geteilte/fehlende/überlappende Dienste, eine Karte je Serie und unveränderte gesetzliche Zähler; `verify:fast`.
- Geräteabnahme: nach gesondert freigegebener Preview auf dem iPhone; Hell/Dunkel, beide Erholungsstufen, lange Serie und Quellenansicht.
- Commit, Push, Build und OTA sind für diesen Umsetzungsschritt nicht freigegeben.

## Fachliche Grundlage

Die versionierte Produktpolicy verwendet die Dreierempfehlung der [BGW](https://www.bgw-online.de/bgw-online-de/themen/sicher-mit-system/gesundheit-managen/schichtarbeit/schichtarbeit-verlaesslich-planen-und-beschaeftigte-einbinden-24194) und von [Garde et al., 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7737811/). Die [BAuA](https://www.baua.de/DE/Themen/Arbeitsgestaltung/Arbeitszeit/Nacht-und-Schichtarbeit) nennt mindestens 24 und bevorzugt 48 Stunden nach einer Nachtphase. Das sind Gestaltungsempfehlungen, keine individuell validierten Sicherheitsgrenzen. Die Regelversion und Quellen werden in den Darstellungsfakten festgehalten. Signierte gesetzliche Kataloge bleiben unverändert.

Nachtfenster werden im Pflegeprofil lokal von 23:00 bis 06:00 Uhr erfasst; mehr als 120 belegte Arbeitsminuten qualifizieren. Geteilte Abschnitte derselben Nacht zählen einmal. Unklare Pausenlagen werden konservativ berücksichtigt. Diese Operationalisierung bildet kürzere Nachtarbeit und die individuelle Belastung nicht vollständig ab.

Erholung beginnt am Ende des letzten ganzen Nachtdienstes und endet mit dem ersten folgenden Arbeitseinsatz. Genau 24 Stunden gehören zur Stufe unter 48 Stunden; genau 48 lösen keinen Erholungshinweis aus. Unter 24 Stunden hat Vorrang; Nachtanzahl und Erholung werden für dieselbe Serie zusammengefasst. Einzelnächte bleiben für die neue Erholungsprüfung außerhalb des freigegebenen Erstumfangs.

Für die Monatszuordnung erhält eine lange Serie das Datum ihres vierten Nachtfensters, ein reiner Erholungshinweis das Datum des letzten Nachtfensters. Dadurch wird dieselbe Serie in benachbarten Monats-/Jahresauswertungen nicht doppelt gezählt. Die tatsächliche Dauer wird einschließlich der nachfolgenden Dienste über die Monatsgrenze berechnet.

Für eine bewertete Erholungsphase müssen alle Arbeitszeiten als erfasst bestätigt, das Serienende bekannt und relevante Dienstzeiten vorhanden sein. Ohne bekannten Folgedienst bleibt die Phase offen; leere Kalenderdaten belegen keine Freizeit. Aus Datenlücken folgt keine positive Erholungsbewertung. Auch bei mindestens 48 Stunden wird keine persönliche Erholung oder rechtliche Unbedenklichkeit bescheinigt.

Nicht existierende oder doppelt vorkommende lokale Uhrzeiten bei der Zeitumstellung gelten für diese Hinweise als unklar. Die Berechnung erfindet dafür weder eine qualifizierende Nacht noch eine genaue Erholungsdauer. Die bisherige Behandlung solcher Uhrzeiten in den gesetzlichen Prüfungen wird dabei nicht verändert.

Die Nachtprüfung läuft in kleinen unterbrechbaren Schritten und verwendet pro Berechnung zwischengespeicherte Nachtfenster. Die vorhandenen übrigen Planungsprüfungen wurden ohne Änderung ihrer Regeln aus der zentralen Engine ausgelagert. Ein vorhandener persistenter Auswertungscache bindet seine Ergebnisse bereits an die Expo-Update-ID; ein späteres OTA übernimmt daher keine alten Nachtprüfungen aus einem vorherigen Update.
