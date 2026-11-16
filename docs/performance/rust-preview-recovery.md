# Paket 1: bisherige App mit Rust-Monatsrechnung für Preview

Auftrag vom 15.11.2026: die vertraute App mit dem getesteten Rust-Monatsrechner auf dem vorhandenen Preview-Build 54 prüfbar machen. TestFlight bleibt unverändert.

## Ziel und Grenzen

Oberfläche, Formulare, Navigation, SQLite-Speicherung und Cloud bleiben beim gesicherten bisherigen Stand. Nur Arbeitszeit und Brutto/Zuschläge im vorhandenen Monats-Rechenzugang werden über die bestehende native Rechenschnittstelle berechnet. Netto, Jahresansicht und Dienstplanprüfung bleiben Folgepakete.

Zielplattform: iOS, vorhandener Preview-Build 54, Runtime `642bfaefe006b4d4d3114c76973debf29b16036d`. Expo SDK 57, unveränderte Paketversionen. Die Runtime wird tatsächlich ermittelt und nicht manuell überschrieben.

Keine nativen Codeänderungen oder neuen nativen Builds. Keine Datenmigration, Datenlöschung oder Cloud-Datenkorrektur. Keine Git-Veröffentlichung, keine Änderung der akzeptierten TestFlight-Baseline und keine TestFlight-Veröffentlichung. Dieses Paket bereitet ein Preview-OTA vor; die Geräteabnahme bleibt gesondert nachzuweisen.

## Getrennte Arbeitspakete

1. **Native Konfiguration übernehmen:** `modules/luna-engine/**` aus der geprüften unveränderten lokalen Sicherung kopieren und alle Dateihashes prüfen. Ausschließlich die vier Build-54-Dateien `fingerprint.config.js`, `.easignore`, `eas.json` und `modules/luna-rest-pilot/scripts/build-ios.mjs` bytegleich übernehmen. Diese Dateien und importierte native Quellen werden anschließend gegen ihre Sicherung geschützt. Kein nativer Build.
2. **Monatsdaten und Cache abschließen:** den bestehenden Monatsadapter härten, seine native Engine-Version an Rechenanfragen und Cache-Schlüssel binden und aktive Katalog-/Profilzustände prüfen. Erlaubt sind nur die `monthly-rust-*`-Adapter und ihre Tests, `use-monthly-rust-calculator.ts`, `monthly-analysis.ts`, `use-prepared-monthly-analysis.ts`, `analysis-month-data.tsx` für die Rechenanbindung sowie die bestehenden Cache-/Vertragsdateien mit notwendigen Regressionstests. Die vorhandene Monatsvorbereitung wird über `analysis-warmup-runtime.ts` und den ausschließlich vorbereitenden Effekt `analysis-background-preparation.tsx` an denselben Rechner angeschlossen, damit Hintergrund und sichtbarer Monat denselben Cache verwenden. Diese Verdrahtung bildet ein eigenes Teilpaket; gerenderte Oberfläche und alle bisherigen Bildschirm-/Formular-/Layout-/Navigationsdateien bleiben geschützt.
3. **Quellprüfung und OTA-Vorbereitung:** Cache-Vertrag durch das bestehende Verfahren erzeugen und Invalidation prüfen. Jede neue Quellabweichung im bestehenden Review-Manifest mit eigenem Pfad, exaktem Hash und konkreter Begründung dokumentieren. Vorhandene Freigaben erhalten, akzeptierte Baseline nicht ändern. Scope-Schutz, Fachtests, `verify:fast`, iOS-Export mit eingeschaltetem Monatsanschluss und tatsächliche Build-54-Runtime prüfen. Erst ein vollständig geprüfter Kandidat ist für ein Preview-OTA geeignet.

Neue Prüfdateien bleiben auf den Scope-Prüfer, gezielte Monats-/Cache-Regressionen und dieses Dokument begrenzt. Jede erforderliche Erweiterung über diese Rechen-, Cache- und Build-Konfiguration hinaus wird vor einer Änderung neu eingegrenzt.

Die Formatprüfung nimmt ausschließlich den unveränderlichen Ordner `modules/luna-engine/reference/` mit den umfangreichen generierten Referenzartefakten aus. Diese Dateien werden nicht umformatiert, sondern durch `verify-preview-recovery-scope.mjs` gegen jeden gesicherten Originalhash geprüft; zusätzliche Dateien in diesem Ordner sind ebenfalls verboten. Der Ordner enthält über 300 JSON-Artefakte, einzelne über 100 MB. Alle ausführbaren Quellen durchlaufen weiterhin die normale Formatprüfung.

`scripts/fingerprint-config.test.mjs` prüft weiterhin die vollständige exakte Ausnahmeliste für generierte native Build-Ausgaben. Seine Erwartung wird um die vier bereits in Build 54 vorhandenen Engine-Ausgaben ergänzt; die eingefrorene Fingerprint-Konfiguration selbst bleibt unverändert.

## Abnahme

- Alle übernommenen nativen Quellen stimmen bytegleich mit der geprüften Sicherung überein.
- Tatsächliche iOS-Runtime entspricht Build 54; keine manuelle Runtime-Überschreibung.
- Arbeitszeit und Brutto bleiben in den geprüften Fällen gleich zur bisherigen App, ohne produktive TS-Ersatzrechnung innerhalb des aktivierten Rust-Pfads.
- Gültige Ergebnisse werden bei unveränderten Eingaben wiederverwendet. Andere Engine-Versionen oder geänderte relevante Daten verwenden eigene Cache-Schlüssel.
- Bisherige Oberfläche und Bedienung bleiben gegen die gesicherte Referenz unverändert.
- `verify:fast` und gezielte Tests bestehen, Schutzprüfungen bleiben wirksam.
- Auf dem iPhone anschließend: vertraute Bedienung, Monatswerte, Neustart, Endzeitänderung und stabile Navigation prüfen. Ein Export oder Metadatennachweis ersetzt diese Geräteabnahme nicht.
