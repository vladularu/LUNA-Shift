# Begrenzter Monats-Anschlussversuch

Start: 15.11.2026, 16:05:12 UTC. Ende spätestens 17:35:12 UTC.

Ziel: Den bisherigen Monats-Rechenzugang für Arbeitszeit und Gehalt mit der vorhandenen Rust-Brücke verbinden. Die bisherige Darstellung und der vorhandene Ergebnis-Cache bleiben erhalten.

Grundlage: gesicherter Build-52-Quellstand mit 1.253 Source-Inventory-Dateien und Digest `92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9`.

Nicht-Ziele: vollständiger Port aller Berechnungen, UI-/UX-Änderungen, Datenbankmigrationen, Cloud-Änderungen, Native-Build, OTA, Commit, Push oder TestFlight.

Pakete:

1. Alte App isoliert sichern und Dateiabweichungen begrenzen.
2. Monats-Arbeitszeit und Gehalt durch die vorhandene native Rechenschnittstelle führen, bisherige Fachergebnisse zurückgeben.
3. Echte Rust-Ausgaben mit Referenz und bisherigem Monats-Hook prüfen; bestehende Tests und `verify:fast` ausführen. Offene Geräteabnahme ausdrücklich festhalten.

Erlaubte bestehende Änderungsdateien: `src/features/analysis/use-prepared-monthly-analysis.ts` und `src/features/analysis/analysis-month-data.tsx` ausschließlich für Rechenanbindung. Bildschirm-, Formular-, Layout-, Navigations-, Speicher- und Cloud-Dateien bleiben unverändert.

Neue Dateien bleiben auf Monats-Brücke, Eingabeadapter, Plattformtransport, zugehörige Tests, lokalen Scope-Prüfer und dieses Dokument begrenzt. Bestehende Rust-Quellen und native ABI bleiben unverändert.

Abnahme: mindestens ein vollständiger Monat durch die echte vorhandene Rust-Binary; kompatible Werte für den bestehenden Monats-Hook; keine TS-Ersatzberechnung im getesteten Rust-Pfad; unveränderte Darstellungsdateien; bekannte Ergebnisse und Abbrüche bleiben korrekt. PC-Tests ersetzen keine iPhone-Abnahme.

Der produktive Anschluss ist über `EXPO_PUBLIC_RUST_MONTH_TRIAL=1` ausdrücklich einschaltbar. Der unveränderte bisherige Rechenweg bleibt außerhalb des Versuchs aktiv. Im getesteten Rust-Pfad gibt es keine TS-Ersatzberechnung für Arbeitszeit oder Gehalt. Bisherige Auswahl von Eingabedatensätzen und App-Orchestrierung bleiben TypeScript.

Der Adapter nutzt ausschließlich fachliche Ergebnisabschnitte. Der PC-Prüflauf entfernt native `views` vollständig, bevor die Antwort beim Adapter ankommt. Die bestehende Binary berechnet diese zusätzlichen Ausgaben intern weiterhin; sie zu unterdrücken wäre eine getrennte Änderung der nativen Engine und gehört nicht zu diesem Versuch.

Vor einer Auslieferung bleiben insbesondere iPhone-Abnahme, Fehlerfälle außerhalb der geprüften Monatsfälle, Bindung des dauerhaften Caches an die Engine-Version und die unveränderte Build-54-Native-Konfiguration zu prüfen. Der Versuch veröffentlicht nichts und ist kein vollständiger Rust-Port.
