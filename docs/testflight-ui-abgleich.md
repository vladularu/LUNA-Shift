# TestFlight-Abgleich: Oberfläche und vorhandene Build-9-Basis

Ziel: Die bereits abgenommenen Header, Zurück-Buttons, Titelgeometrie und dazugehörige native Basis aus der wiederhergestellten TestFlight-OTA dauerhaft auf master erhalten.

Referenz: Build 9, OTA `ac656e8a-0c56-4e5b-8229-ab34cfe1cdc3`. Gerätenachweis vom 04.11.2026: „Auf iPhone passt das, erledige die restliche Aufgaben wie beschrieben.“ Der Referenz-Quellstand ist gegen das eingefrorene Manifest mit 2.406 Dateien und das unveränderte ausgelieferte Bundle geprüft.

## Getrennte Teilpakete

1. Gemeinsame Glas-Zurück-Buttons und deren Verwendung in Gehalt, Netto, Freigaben und Auswahlansichten (8 Dateien).
2. Navigation, Header-Geometrie, Monats-/Jahreswechsel und Regressionstests (14 Dateien).
3. Bereits in Build 9 vorhandene Nativebasis: nicht blockierender Start, Header-Material-Modul und exakte Scroll-Edge-Abhängigkeit einschließlich Lockfile und Konfigurationstest (8 Dateien).

Alle 30 Quell-/Testdateien werden bytegleich aus der abgenommenen Referenz übernommen. Der aktuelle Test mit dem neutralen Card-Footer-Beispiel bleibt erhalten; ein bloßer Beispielbetrag gehört nicht zur UI-Wiederherstellung.

Nicht-Ziele: Keine Rücksetzung des aktuellen Tarif-/Regelkatalogs, der Datenbank, der Netto-Korrektur oder des Einladungs-Fixes. Keine neue OTA, kein neuer nativer Build und keine Veränderung des parallel bearbeiteten Preview-Stands.

## Abnahmekriterien

- Vorhandene Glas-Zurück-Buttons und Header-Optionen sind wieder eingebunden.
- Der ausgeblendete Monatstitel bleibt nach Monats-/Jahreswechsel vollständig abwesend.
- Analyse-Header und große Schrift behalten die vorherige Geometrie.
- Einstellungen übernehmen Hell-/Dunkelmodus ohne Speichern auch im Header.
- Production behält Bundle-ID, App Group und die bereits installierte Build-9-Nativebasis.
- Alle Änderungen außerhalb des beschriebenen Scopes bleiben erhalten.
- Fokussierte UI-/Konfigurationstests, `verify:fast` und alle PR-CI-Gates bestehen.
