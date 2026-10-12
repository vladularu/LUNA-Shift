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

## Korrektur der iOS-PDF-Ausgabe

Gerätenachweis: Build 34 mit OTA `60e22222-d2b0-4643-a0da-cbdd7eb3f4bd`, Screenshot vom 12.10.2026. Alle PDF-Varianten brechen ab, CSV funktioniert. Die bisherige Geräteabnahme ist damit nicht bestanden.

Scope der Korrektur: ausschließlich iOS-Druckgeometrie, begrenzter erneuter Anpassungsversuch, sichere Fehlermeldungen und Exporttests. Bestehende Berichtsdaten, CSV, Netto-Berechnung und native Abhängigkeiten bleiben erhalten.

Der iOS-WebView-Druckformatter benötigt Pixelmaße innerhalb des nativen Druckrechtecks. Die Browser-Vorschau behält ihre A4-Druckpunkte. Maximal ein erneuter Anpassungsversuch wird erlaubt; auch danach gilt die Seitenbegrenzung. Die tatsächliche iPhone-PDF-Ausgabe muss nach dem Korrektur-OTA erneut bestätigt werden.

Technische Prüfung der Korrektur: `verify:fast` bestanden (8.423 Unit-Tests, 985 Komponententests); danach finaler Exportstand mit 41 Unit- und 19 Komponententests sowie TypeScript, Lint und Formatprüfung geprüft. Zwölf HTML-Szenarien passen im Modell des nativen Druckrechtecks ohne Fußzeilenüberlauf. iOS-Hermes-Export erfolgreich; Fingerprint stimmt mit Build 34 überein. Diese Nachweise ersetzen keinen PDF-Export auf dem Zielgerät.
