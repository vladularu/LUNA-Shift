# Paket B: gemeinsame Netto-Einstellungen und bedarfsgerechte Vorbereitung

- Ziel: vorhandene Netto-Einstellungen Ã¼ber Monats-/JahresÃ¼bersicht und Details wiederverwenden, offene Editor-EntwÃ¼rfe mit ihrer ursprÃ¼nglichen KonfliktprÃ¼fung erhalten, gleichzeitige Lesezugriffe teilen und nicht benÃ¶tigte Gehaltsvorbereitung in anderen Jahresdetails abschalten.
- Nicht-Ziele: Berechnungsformeln, Datenbankschema, Tarifwerte, gespeicherte Einstellungen, Layout, Luftig oder native Integration verÃ¤ndern.
- Plattform: bestehende iOS-Preview, APP_VARIANT=internal; Expo ~57.0.31 und Dokumentation https://docs.expo.dev/versions/v57.0.0/.
- Produktionsscope: use-net-pay-profile.ts, analysis-salary-input-store.ts, use-annual-salary-payments.ts, annual-report-view.tsx die beiden bestehenden Netto-Editor-Einstiege net-pay-settings-screen.tsx und salary-payroll-settings.tsx sowie je eine Invalidierungsbenachrichtigung nach erfolgreicher lokaler Wiederherstellung und Cloud-Ãœbernahme. Alle Ã¼brigen SpeichervorgÃ¤nge melden Ã„nderungen bereits.
- Tests: Hook-Lifecycle, gemeinsamer Store, jÃ¤hrliche Vorbereitung, Detail-Auswahl, Backup und Cloud-Transaktionen. Mit Dokument und exakter Quellenfreigabe hÃ¶chstens 15 Dateien.
- Akzeptanz: neue und gleichzeitig geÃ¶ffnete Ansichten Ã¼bernehmen passende bereits geladene Daten ohne Leerzustand; Monatswechsel wÃ¤hlt das zutreffende Profil aus derselben Zeitreihe. Speichern, ZurÃ¼cksetzen, Wiederherstellen und Cloud-Ãœbernahme invalidieren erst nach erfolgreichem Commit; fehlgeschlagene Transaktionen erhalten den bisherigen Stand. Alte Antworten Ã¼berschreiben keine neuen Daten. Ein explizites Neuladen erhÃ¤lt gÃ¼ltige Daten bis zum Abschluss; Fehler bleiben sichtbar. Arbeitszeit-, PrÃ¼fungs-, Dienste- und Zuschlagsdetails starten keine Gehalts-/Netto-Vorbereitung.
- PrÃ¼fung: fokussierte Komponenten-/Datenbanktests, verify:fast auf der tatsÃ¤chlichen Preview-Quelle, QuellenparitÃ¤t beider Worktrees und iOS-Export/Runtime/Live-Bytevergleich.
- Abnahme: wiederholt Monats-/Jahres-Gehalt und Netto Ã¶ffnen, Monate wechseln, Netto-Einstellung Ã¤ndern und Auswirkungen prÃ¼fen, Sonderzahlungen zurÃ¼cksetzen; Hell/Dunkel und Luftig beibehalten. Backup-/Cloud-Invalidierung wird zusÃ¤tzlich durch echte Datenbanktests geprÃ¼ft.
- Lieferung: eigene Preview-OTA im vereinbarten Ablauf; Paket B bleibt bis zur Nutzerabnahme uncommittet. Kein TestFlight-/Store-Schritt.

## Technischer Liefernachweis (07.11.2026)

- `verify:fast` erfolgreich: 10421 Unit-Tests, 1893 Komponententests und alle zusätzlichen Repository-Prüfungen.
- Fokussierte Komponentenprüfung: jeweils 55 Fälle auf Preview- und Feature-Stand; fokussierte Datenbank-/Store-Prüfung: 115 Fälle. Offene Editor-Entwürfe und deren ursprüngliche Konfliktbasis bleiben bei externen Änderungen erhalten; eigene erfolgreiche Speicherung und explizites Neuladen übernehmen den neuen Stand.
- Genau acht App-Dateien gegenüber dem abgenommenen Paket A geändert; insgesamt 15 Dateien einschließlich Tests, Dokumentation und Quellenregister. Feature-/Preview-Änderungen sind identisch, die separate Luftig-Darstellung bleibt erhalten.
- Preview-Quellfingerabdruck: `0d8504c1a77e3c22d25c5dd4c8b63fa604e1a5e8d331081a0392dd651f3c9c43`.
- iOS-Runtime: `402e757d98ca799660ce5dd15a24bd999cf690eb`; kompatibel zur vorhandenen Preview-App.
- Eigene Preview-OTA-Gruppe: `1ef493bf-a7c6-4f3c-9804-ed78fa87802c`; Update: `01a1b379-6765-7abc-9f2c-4e178a940361`.
- Ausgeliefertes iOS-Bundle und alle 34 Assets bytegenau gegen den geprüften Export bestätigt. Bundle-SHA256: `d37fd04050f3165d6224fcf4cba4f6a51efd24af7cb5deaac3bf1d961d6d5022`.
- Paket A ist über PR #366 nach vollständig grüner CI in `master` übernommen; Merge `be94e6802fdde95f6f0655cdf6a37204ec2fc01c` enthält exakt den akzeptierten Feature-Baum.
- Paket B: Geräteabnahme offen. Keine Commits/Pushes für Paket B vor dieser Abnahme; kein Production-/TestFlight- oder nativer Build-Schritt.

## Abnahme (07.11.2026)

Die Korrekturen wurden zusammen mit Korrektur D ausdrücklich auf dem iPhone in Hell/Dunkel und nach Neustart abgenommen. Zugeordnete OTA und Git-Freigabe: [Kaltstart – Geräteabnahme](berechnungen-kaltstart.md#geräteabnahme-und-git-freigabe-07112026).
