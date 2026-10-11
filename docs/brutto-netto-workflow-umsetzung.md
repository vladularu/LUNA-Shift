# Netto direkt in der Gehaltsauswertung

Freigabe: Nutzer wählte die Gehaltsauswertung als Mittelpunkt und beauftragte am 10.10.2026 die Umsetzung des interaktiven Entwurfs.

Ziel: Brutto, Netto, Abzüge und steuerfreie/steuerpflichtige Zeitzuschläge auf einen Blick. Einmalige Einrichtung in drei Schritten; später einzelne Bereiche ändern, gültig ab dem ausgewählten Monat. Plattform: bestehende iOS-App, Expo SDK 57 (`~57.0.22`). Referenz: https://docs.expo.dev/versions/v57.0.0/.

## Arbeitspakete

1. Gehaltsübersicht und direkte Detaildialoge: `salary-screen.tsx`, `net-pay-automatic-entry-card.tsx`, neue `net-pay-salary-summary.tsx` und `net-pay-sheet.tsx`. Brutto-Zusammensetzung wandert in die direkte Detailansicht. Bereits berechnete Ergebnisse werden wiederverwendet.
2. Drei Schritte und gezielte Bearbeitung: `net-pay-setup-form.tsx`, `net-pay-setup-values.ts`, `net-pay-automatic-screen.tsx`, `net-pay-screen.tsx`. Der bestehende Rechner bleibt über die Netto-Angaben erreichbar. Bestehende Sonderfälle, optionale Eingaben und historische Gültigkeit bleiben erhalten.
3. Komponententests für Einrichtung, Bearbeitung, direkte Details, Monatswechsel und Sonderfälle; passende Unit-Tests und `npm.cmd run verify:fast`. Graph nachziehen. iPhone-Abnahme separat.

Nicht im Auftrag: neue Steuer-/Tarifregeln, Migrationen, native Abhängigkeiten, OTA, Commit, Push, Merge oder Store-Veröffentlichung. Unabhängige Änderungen bleiben unberührt; Ausgangshashes liegen in `artifacts/net-pay-workflow-before.json`.

## Abnahme

- Genau eine Gehaltsübersicht, keine zweite Brutto-/Netto-Navigation für das gleiche Ergebnis.
- Brutto, Abzüge und Zuschläge öffnen direkt ihre Details, ohne zweite Berechnung.
- Drei Einrichtungsschritte: Steuern, Familie, Versicherung & Vorsorge.
- Änderungen eines Bereichs erhalten alle anderen Werte und speichern ab dem ausgewählten Monat; Schreibkonflikte sichtbar, kein automatisches Überschreiben.
- Unbekannte Zusatzversorgung bleibt ausdrücklich am Netto gekennzeichnet; 2027 behält den vorläufigen Stand 2026.
- Fehlende Gehalts-/Tarifgrundlage führt zur Gehaltsgrundlage. Testmonate erlauben keine persönlichen Netto-Ergebnisse oder Speicherung.
- Tastatur, große Schrift, kleine iPhones, helle/dunkle Darstellung und reale Bedienung benötigen Gerätebelege.

## Ergebnis der Umsetzung

13 Dateien gegenüber dem Ausgangsstand geändert bzw. ergänzt; andere Dateien, Tarif-/Steuerregeln und native Konfiguration unverändert. Die alten Links verwenden dieselbe Übersicht. Details öffnen direkt, ohne erneute Netto-Berechnung. Spätere Änderungen öffnen ausschließlich Steuern, Familie oder Versicherung & Vorsorge; gespeicherte optionale Angaben und Sonderfälle bleiben erhalten.

`npm.cmd run verify:fast` erfolgreich auf dem endgültigen Quellstand. Zusätzlich 144 gezielte Unit-Tests, 97 Workflow-/Persistenz-Komponententests und nach der Modal-Anpassung 62 erneute Dialog-Regressionstests erfolgreich. Protokoll und Quellhashes: `artifacts/net-pay-workflow-verification.json`, `artifacts/net-pay-workflow-verify-fast.log`, `artifacts/net-pay-workflow-tested-source-hashes.json`.

Die Dialoge haben einen eigenen Safe-Area-Provider entsprechend der [Expo-SDK-57-Dokumentation](https://docs.expo.dev/versions/v57.0.0/sdk/safe-area-context/). Die JS-Komponententests ersetzen die native Insets-Messung durch einen Testadapter und belegen keine iPhone-Darstellung. Geräteabnahme und neue Preview-OTA stehen aus.
