# Kurze PDF- und CSV-Berichte

Ziel: gut lesbare Monats- und Jahresberichte nach den bestätigten Vorschauen.

Nicht-Ziele: Änderungen an Netto-, Tarif- oder Zeitkonto-Berechnungen, neue native Abhängigkeiten, Store-Veröffentlichung.

Plattform: iOS, LUNA Shift Internal Build 34, OTA-Kanal `preview`, Umgebung `preview`.

Scope: `src/features/report-export/` und dieses Dokument. Umsetzung auf `codex/export-standard-kompakt`.

Arbeitspakete:

1. Bestehende Berechnungen für eine lesbare Dienstliste verwenden; PDF und CSV gezielt formatieren.
2. Auswahl Standard/Kompakt und optionales Gehalt im bestehenden Auswahl-Sheet anbieten.
3. Tests, reale HTML/PDF-Rasterprüfung, Runtime-Abgleich und freigegebenes iOS-OTA.

Abnahme:

- Standard ist vorausgewählt; Kompakt ist eine Seite, Standard zwei bis höchstens drei Seiten.
- Gehaltsprognose kann bei beiden PDF-Varianten ausgeschaltet werden und hinterlässt keine Gehaltsdaten im PDF.
- Monat: Übersicht und Dienstliste; kompakt ein Monatskalender. Jahr: zwölf Monatszeilen statt einzelner Tagesdetails.
- Sehr volle Monate werden ausdrücklich tagesweise verdichtet; die vollständige Einzelliste bleibt im CSV.
- CSV: eine Zeile pro Dienst, Abwesenheit oder Termin, mit deutschen Zahlen und Excel-Formelschutz.
- Fehlende Berechnungen erscheinen als nicht verfügbar; Jahresprognosen nennen ihre Monatsabdeckung.
- Urlaubsgutschriften und Dienstzeit sind getrennt; Nachtdienste und Zeitumstellung verwenden die bestehende Engine.
- Tests und `verify:fast` müssen bestehen. Zielgerät muss die Auswahl und neu exportierte PDF/CSV bestätigen.

Freigaben: Umsetzung und OTA ausdrücklich erteilt; vorhandene unabhängige Änderungen bleiben unberührt. Geräteabnahme des neuen OTA steht bis zur Nutzerrückmeldung aus.
