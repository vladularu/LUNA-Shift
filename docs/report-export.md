# Berichtsexport PDF und CSV

## Task-Vertrag

Ziel: Vollständige Monats- und Jahresberichte mit Kalendereinträgen, Arbeitszeit,
Schichtstatistik, Prüfhinweisen und Gehaltsprognose offline exportieren.
Nicht-Ziele: Import, Cloud-Synchronisierung, neue Gehaltsberechnungen und Veröffentlichung.
Zielplattform: iPhone.
Scope: src/features/report-export/, Monatsauswertung, Jahresauswertung,
Gehaltsansicht, package.json/package-lock.json und diese Dokumentation.

Arbeitspakete:

1. Gemeinsamer Berichtsdatenbestand aus den vorhandenen Berechnungen.
2. CSV-Erzeugung und lokale PDF-Erzeugung mit expo-print für SDK 57.
3. Exportbedienung in den drei Ansichten und iPhone-Abnahme.

Abnahmekriterien:

- Monat und Jahr enthalten sämtliche fachlichen Felder der Einträge und des
  aktuellen Profils, Tarifbestätigungen, Arbeitsmuster, vollständige Auswertung
  und Gehaltsprognose inklusive Zuschlagspositionen und Zulagenprüfung.
- Gelöschte Einträge und Einträge außerhalb des Zeitraums fehlen in der Tagesliste.
  Berechnungen verwenden weiterhin nötige Dienste außerhalb des Berichtszeitraums.
- PDF und CSV beruhen auf denselben Daten. CSV verwendet UTF-8 mit BOM,
  Semikolon, deutsche Dezimalzahlen und sichere Textzellen.
- Fehlende Regeln/Berechnungen sind gekennzeichnet. Jahressummen nennen die
  Anzahl der enthaltenen Gehaltsmonate.
- Exportdateien werden ausschließlich im Cache erzeugt und nach Ende des
  Teilen-Dialogs gelöscht. Die App ändert keine Nutzerdaten.
- Lang laufende Jahresberechnungen geben zwischen Berechnungsschritten die UI frei.
- Tests und verify:fast bestehen.
- iPhone: PDF und CSV jeweils öffnen, teilen, in Dateien speichern und mit
  Monat/Jahr in der App vergleichen. Testfälle: Nachtdienst, Abwesenheiten,
  Termine, lange Notiz, Umlaute, fehlender Tarifstand, leerer Monat und Abbruch.

PDF: mehrseitiger A4-Bericht mit wiederholten Tabellenköpfen und sämtlichen Details.
CSV: eine vollständige Tabelle im Langformat, mit Bereich, Zeitraum, Datensatz,
Feld, Wert, Einheit und stabilem Feldschlüssel; die Bereiche lassen sich in Excel filtern.

Berichte sind keine Datensicherung: App-Einstellungen, Vorlagen und gelöschte
Datensätze gehören weiterhin zur separaten JSON-Datensicherung.
Das Profil entspricht den aktuellen Berechnungsgrundlagen der App, nicht einer
historischen Lohnabrechnung. Gehaltsbeträge sind unverbindliche Brutto-/Nettoschätzungen.

## Native Verfügbarkeit

expo-print ist eine neue native Abhängigkeit. Ein bestehender Preview- oder
TestFlight-Build ohne dieses Modul kann PDF nicht erzeugen. Vor iPhone-Abnahme
ist ein neuer, ausdrücklich freigegebener nativer Build erforderlich.
Keine OTA, kein Build, kein Commit, kein Push und keine Veröffentlichung sind
durch die Implementierungsfreigabe autorisiert.

Expo-Referenz: https://docs.expo.dev/versions/v57.0.0/sdk/print/

## Historie: für gemeinsamen Build zurückgestellt

Stand 2026-10-09: Der Nutzer hat den Berichtsexport zurückgestellt, bis weitere
Änderungen für einen gemeinsamen Build bereitstehen. Jetzt keine separate OTA
und keinen EAS-Build starten. Die bisherige OTA-Freigabe wird nicht weiter verwendet.

Die Implementierung bleibt lokal und uncommitted auf `codex/berichte-export`
im angehängten Worktree `C:/Users/veron/.codex/worktrees/berichte-export/MediShift`.
Nicht archivieren oder verwerfen, solange sie für den gemeinsamen Build benötigt wird.

Bereits bestanden: `verify:fast`, 38 gezielte Exporttests und lokaler iOS-Export.
PDF benötigt `expo-print ~57.0.2` und einen neuen nativen Build. Preview-Build 33
enthält dieses Modul nicht; der geprüfte Exportstand ist nicht OTA-kompatibel.
Vor späterer Auslieferung den kombinierten Stand erneut prüfen und eine neue
explizite Build- oder OTA-Freigabe einholen. Commit und Push bleiben separat freizugeben.

## Integration am 2026-10-11

Der Nutzer hat die gemeinsame Umsetzung mit Design, Netto-Prognose und den
aktuellen Preview-Änderungen einschließlich Git-Delivery und Preview-Build freigegeben.
Der ursprüngliche Export-Arbeitsstand bleibt erhalten; die Zusammenführung erfolgt
auf `codex/shared-preview-design-netto-export` vom aktuellen master.

Monats- und Jahresberichte enthalten jetzt die wirksamen datierten Netto-Angaben,
die vorhandene automatische Berechnung, Steuer-/SV-/Zusatzversorgungsabzüge und
die vollständige Zuschlagszuordnung. Die Jahressumme berücksichtigt nur verfügbare
Netto-Monate und weist die Abdeckung aus. Fehlende oder nicht unterstützte Netto-
Berechnungen erscheinen mit Grund als Nicht verfügbar; fehlende Werte sind keine Null.

Es gelten die Prüf- und Geräteabnahmekriterien aus `shared-preview-build.md`.
