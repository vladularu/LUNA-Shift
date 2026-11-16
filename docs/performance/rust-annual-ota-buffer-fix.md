# Jahresansicht: begrenzte Monatsantworten für Preview Build 54

Die Preview-OTA `01a1e1c6-0a30-7834-86fe-9d69e24dd939` konnte beim Öffnen der Jahresansicht `APP_RENDER_FAILED` anzeigen. Mit der vorhandenen Sicherung 865 wurde der Fehler über originale SQLite-Migrationen, Repository-Leser und das unveränderte Rust-WASM reproduziert: `runFinance` lieferte `OUTPUT_BUFFER_UNAVAILABLE`. Der normale native Antwortkanal in Build 54 ist auf 4 MiB begrenzt. Die komplette Jahres-Gehaltsantwort enthält zusätzliche Auswertungsblöcke, die die bisherige UI nicht benötigt; bei realen Profilverläufen überschreitet sie diese Grenze. Die bisherigen 63 Vergleichsfälle hatten diese Datenmenge nicht abgedeckt.

Der Nutzer hat ausdrücklich den OTA-Weg gewählt: Rust berechnet die Monatswerte; TypeScript summiert vorübergehend die zwölf Ergebnisse. Ein neuer nativer Build ist dafür nicht erforderlich.

## Begrenzte Korrektur

- Jahres-Arbeitszeit, Jahres-Netto und Jahresprüfungen bleiben native Jahresabfragen. Die Brücke fragt keine vollständigen Jahres-Gehaltsblöcke mehr an.
- Die zwölf einzelnen Gehaltsabfragen laufen auf derselben nativen Snapshot-/Besitzer-Warteschlange. Rust berechnet weiterhin Gehalt, Zuschläge, Steuern, Sozialversicherung, SFN und Sonderzahlungsprognose. Die vorhandene monatliche Payroll-Antwort liefert das mathematische Sonderzahlungs-DTO; UI-Daten daraus werden nicht an React weitergegeben.
- Ein kleiner TS-Adapter bildet ausschließlich die bisherigen Jahressummen und ihre abschließende Cent-Rundung. Fehlende Regelabdeckung bleibt monatsweise nicht verfügbar; andere Fehler werden nicht als Nullbetrag ausgegeben.
- Die bisherigen Report-Formate, gespeicherten Ergebnisse, Formulare, Navigation und Renderer bleiben erhalten. Ein neuer Cache-Schlüssel trennt die geänderte Brücke von alten Jahresständen. Beim ersten Aufruf nach der OTA kann einmalig neu vorbereitet werden.
- Bekannte native Transportcodes werden als datensparsame Fehlerklasse protokolliert. Personenbezogene Fehlertexte werden nicht exportiert.

## Scope und Abnahme

Produktive Änderungen: gemeinsame Finanzbrücke, Jahres-Datenadapter, bestehende Jahres-Netto-Cache-Annahme und der neue kleine Summenadapter. Dazu fokussierte Tests, das native Vergleichsskript, dieser Nachweis, der generierte Cache-Vertrag und exakte Source-Review-Einträge. Alle anderen Dateien müssen zum veröffentlichten Paket-3-Snapshot bytegleich bleiben, insbesondere UI/JSX, native Dateien, Root-Konfiguration, Datenbank und Cloud.

Prüfungen: vollständige DTO-Parität mit dem bisherigen TS-Rechenweg für Sicherung 865 (2026 und Nachbarjahr), Netto-/Sonderzahlungsparität, leere Netto-Einrichtung, 63 native Vergleichsfälle, unveränderte gespeicherte Jahre und Abbruch-/Wiederholungsfälle, strenger Schutz gegen erneute `YEAR`-Gehaltsanfragen, `verify:fast`, reale Build-54-Runtime, iOS-Export und Byteabgleich nach der ausdrücklich freigegebenen Preview-OTA. Private Sicherungsdaten werden ausschließlich lokal geprüft und nicht in den Quellcode übernommen.

Die Summierung in TS ist eine ausdrücklich gewählte vorübergehende Einschränkung des vollständigen Rust-Ports. Eine spätere kompakte native Jahresantwort kann sie ersetzen. TestFlight und Git-Auslieferung sind nicht Teil dieser Korrektur. Die iPhone-Abnahme bleibt nach der OTA separat erforderlich.
