# Paket 4: monatliche Dienstplanpruefung ueber die bestehende Rust-Bruecke

Referenz: auf dem iPhone bestaetigte Preview-OTA `01a1e203-83cc-73b7-b408-162579b070a7`, Quelldigest `b97fcd880c59dec21550d4f660c8e19f2b0a769273f2766fd4746e5ee915fcaf`.

## Ziel und Grenzen

Die Monatspruefung in Uebersicht, bestehenden Details und Hintergrundvorbereitung nutzt die vorhandene Rust-Prueflane in Preview Build 54 (Expo SDK 57). Sie liefert unveraendert `MonthlyComplianceResult`. TypeScript behaelt Datenzugriff, Aufrufsteuerung, Darstellung und gespeicherte Ergebnisse. Vorhandene Monats-/Netto-/Jahresauftraege teilen weiterhin dieselbe native Besitzer-Warteschlange.

Nicht-Ziele: native Codeaenderungen, Build, neue Architektur, Layout/Texte/Formulare/Navigation, Cloud, Datenbankmigration, Report-Export, erweiterte Ausbildungspruefung, Gehaltsumbau oder weitere Bereinigungen. TestFlight bleibt unveraendert. Commit, Push und OTA sind durch dieses Umsetzungspaket nicht freigegeben.

## Teilpakete und Dateiscope

1. Datenadapter und Fachtests: `monthly-rust-finance.ts`, neue `monthly-rust-checks.ts`, ihr Unit-Test und eine synthetische native Ergebnisfixture. Monatliche Checks laufen ausschliesslich ueber `admitChecks`/`runChecks`; die Finanzlane fordert weiterhin keine Checks an. Es werden nur fachliche Sektionen ausgelesen. Separate Trainingsquellen werden wie in der bisherigen einfachen Pruefung nicht angefordert. Rohdaten und sichtbare Jugendschutzauswahl muessen zusammenpassen.
2. Verbraucher und Cache: neuer `use-monthly-rust-checks-calculator.ts`, bestehende `use-monthly-compliance.ts`, `analysis-warmup-runtime.ts`, `analysis-background-preparation.tsx`; zugehoeriger neuer Hook-Integrationstest und bestehender Warmup-Test. Sichtbare Pruefung, Details und Hintergrund nutzen denselben versionsgebundenen Schluessel. Unveraenderte gespeicherte Ergebnisse werden wiederverwendet, spaete Antworten verworfen. Gerendertes JSX bleibt bytegleich.
3. Nachweis: neuer `test-monthly-checks-wasm.mjs`, eigener Scope-Pruefer, dieses Dokument, generierter Cachevertrag und exakte Review-Hashes in `releases/testflight/build-9.reviewed-changes.json`. Alle anderen Dateien bleiben bytegleich zur bestaetigten OTA. Bestehende Paket-Scope-Pruefer und die akzeptierte TestFlight-Baseline werden nicht geaendert.

## Abnahme

Echte vorhandene Rust-WASM-Binary gegen den originalen TypeScript-Rechenweg vergleichen: Standard-/Jugendschutz, Profilverlaeufe, Monats-/Jahresgrenzen, Befunde und leere Monate. Den vorhandenen lokalen Datenstand ausschliesslich lokal pruefen. Uebersicht/Details teilen einen Auftrag; Hintergrund und sichtbare Seite verwenden denselben Cache. Neustart ohne Aenderung loest bei gueltigem gespeichertem Ergebnis keine neue Pruefung aus; Dienst-Endzeitaenderung und Fehler/Wiederholung bleiben korrekt. Keine Antwort darf die bestehende native 4-MiB-Grenze ueberschreiten. Monats-, Netto- und Jahrespaket muessen weiter bestehen.

Fokussierte Tests, Scope-Pruefung, `npm.cmd run verify:fast`, SDK-57-iOS-Export und tatsaechlicher Build-54-Runtime-Abgleich sind lokale Gates. Eine spaeter ausdruecklich freigegebene Preview-OTA erfordert eine eigene iPhone-Abnahme; PC-Tests ersetzen diese nicht.
