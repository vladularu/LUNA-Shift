# Paket 5: Gehaltsvorbereitung durch die vorhandene Rust-Engine

Referenz ist die auf dem iPhone bestaetigte Paket-4-Preview-OTA `01a1e22e-acb6-798a-abed-f93360b25bec`, Quelldigest `7a29616e94d8ad632e600f14640480e5c049286f21eb241807b1afd110c3b5a0`.

## Ziel und Nicht-Ziele

Die bestehende Gehaltsvorbereitung fuer monatliche Auswertung, Gehaltsdetails und Sonderzahlung liefert Jahresprognose, Auszahlungszuordnung und gegebenenfalls Netto aus Rust. TypeScript behaelt SQLite-Zugriff, die Auswahl vorhandener Eingabedatensaetze, Cache/Abbruchsteuerung und die vertraute UI. Keine zusaetzliche Architektur, kein neuer nativer Rechenkern. Ziel: iOS Preview Build 54, Expo SDK 57, unveraenderte Runtime.

Unveraendert bleiben UI/JSX, Texte, Formulare, Navigation, Cloud, Datenbankschema, Abhaengigkeiten, native Dateien und TestFlight. Keine Datenkorrektur, Loeschung oder Aenderung der Jahres-Summenloesung. Report-Export und andere Bereinigungen sind Folgeaufgaben. Umsetzung und lokale Pruefungen sind freigegeben; Commit, Push, Build und OTA sind nicht Teil dieser Freigabe.

## Getrennte Teilpakete

1. **Fachliche Datenbruecke:** `monthly-rust-finance.ts`, `monthly-rust-net.ts`, `analysis-salary.ts`, `persistent-salary-value.ts` und neuer `monthly-rust-salary-preparation.ts` mit Unit-Test/aufgezeichneter synthetischer Fixture. Native Monats-Brutto-/Netto-Sektionen und eine getrennte begrenzte Payroll-Abfrage laufen auf demselben bestehenden Snapshot/Besitzer. Aus der Payroll-Antwort werden nur die vier urspruenglichen mathematischen Jahresprognosefelder entnommen; native Anzeigeobjekte werden nicht an React gegeben. Die kompakte native Auszahlungsprojektion wird nur um die bereits geladenen Original-Dienst-/Profilmetadaten ergaenzt, ohne Gehaltsrechnung in TS.
2. **Bestehende Verbraucher:** neuer `use-rust-salary-preparation.ts`, bestehende `use-salary-report.ts`, `use-rust-automatic-net-pay.ts`, `use-annual-salary-forecast.ts`. Die drei bestehenden Verbraucher `salary-details-screen.tsx`, `salary-payroll-content.tsx`, `net-pay-automatic-entry-card.tsx` duerfen nur Datenargumente fuer den aktuellen Monat anpassen. Gerenderte JSX-Ausdruecke bleiben bytegleich. Sichtbarer Monat, Details, Netto und Hintergrund nutzen den vorhandenen vollstaendigen Gehaltscache und dieselben Eingaben. Bestehende Loading-/Fehler-/Retry-Zustaende bleiben erhalten; keine Platzhalterbetragsanzeige bei laufender Berechnung.
3. **Pruefung und Vorbereitung:** neue Unit-/Hook-/Komponentenpruefungen, echter Rust-WASM-Vergleich, eigener Scope-Pruefer, dieses Dokument, generierter Cache-Vertrag und exakte Source-Review-Hashes. Aeltere Paketpruefer und die akzeptierte TestFlight-Baseline bleiben unveraendert.

## Abnahme

Originale TS-Ergebnisse gegen echte eingefrorene Rust-WASM pruefen: Sonderzahlungsprognosen, gespeicherte Sonderzahlungen, Auszahlungsversatz, Jahreswechsel, manuelles Gehalt, fehlende Netto-Einrichtung, Tarif-/Profilverlaeufe, Testmonate und fehlende Regeln. Den vorhandenen privaten Datenstand nur lokal verwenden. Ergebnisse, Fehler und Detailmetadaten muessen kompatibel bleiben. Unveraenderte Ergebnisse werden beim Wiederbesuch/Neustart wiederverwendet; Dienst-, Einstellungs- oder Enginewechsel invalidieren gezielt, spaete Antworten werden verworfen. Im aktivierten Vorbereitungspfad duerfen die bisherigen TS-Rechenfunktionen nicht ausgefuehrt werden.

Die bisherigen Monats-/Netto-/Jahres-/Pruefpakete muessen weiter bestehen. Source-/JSX-/Native-Schutz, `verify:fast`, lokaler iOS-Export und tatsaechliche Build-54-Runtime werden geprueft. Jede native Antwort bleibt unter 4 MiB. Nach einer gesondert freigegebenen Preview-OTA bleiben iPhone-Funktions- und Performance-Abnahme erforderlich. Lokale Vergleichszeiten sind kein Nachweis eines iPhone-Geschwindigkeitsgewinns.
