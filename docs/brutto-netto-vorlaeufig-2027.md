# Vorläufige Netto-Prognose 2027

## Task-Vertrag

- Ziel: Die automatische Prognose für 2027 mit dem letzten geprüften Abzugsstand ermöglichen und diesen unmittelbar beim Ergebnis kennzeichnen. Gehalt, Dienstzeiten, Feiertage und Altersgrenzen bleiben dem angefragten Monat zugeordnet.
- Nicht-Ziele: Keine endgültige 2027-Abrechnung, keine ungeprüften Entwurfsparameter, keine neuen Tarifabschlüsse, Sonderfälle oder Einmalzahlungen. Keine Änderung an nativen Abhängigkeiten, Datenbank oder persönlicher Einrichtung. Keine nativen Builds oder Git-Auslieferung. Die Preview-OTA wurde am 10. Oktober 2026 separat freigegeben.
- Plattform: Expo SDK 57 (~57.0.22), iPhone Preview; reine TypeScript-/React-Native-Änderung.
- Checkout: Bestehender Feature-Branch `codex/brutto-netto-prototype`; die bisherigen Feature-Änderungen bleiben erhalten.
- Dateiscope: Jahresstand-Modul und Test; NetPay-/SFN-Domaintypen; Netto-, SFN- und automatische Berechnung; Cache und Cache-Test; vorhandene automatische Engine- und Komponententests; Ergebnis- und Einstiegskarte; dieses Dokument (14 Dateien).
- Abnahme: 2027 über alle acht unterstützten Gehaltsmodelle mit vorhandenem Brutto; sichtbarer Hinweis und gerundete Hauptanzeige; korrekte tatsächliche Feiertags-/Alterszuordnung; steuerpflichtige und steuerfreie Zuschläge getrennt; 2026 numerisch unverändert; Cache reagiert auf den Berechnungsstand; `verify:fast` und fokussierte Tests bestehen.
- Gerätenachweis: Nach einer gesondert freigegebenen OTA die 2027-Einstiegs- und Detailansicht auf dem iPhone prüfen. Der Gerätenachweis ist noch offen.

## Berechnungspolitik

2026 verwendet weiterhin den geprüften BMF-PAP, die Sozialversicherungswerte und Zusatzversorgungsmodelle von 2026. 2027 ist eine ausdrücklich vorläufige Fortschreibung dieser Abzugsgrundlagen. Für die Hauptanzeige wird ausschließlich bei dieser Fortschreibung auf zehn Euro gerundet; rechnerische Beträge bleiben intern centgenau und in den Details nachvollziehbar.

Die zentrale Jahresauswahl liefert den Prognosezeitraum, Regelstand, Status und eine Versionskennung. Dieser Stand ist Bestandteil des Cache-Schlüssels. Spätere geprüfte Jahresmodelle können die Fortschreibung in dieser Auswahl ersetzen; eine solche Aktualisierung muss zugleich die passenden Berechnungsmodelle und Referenztests mitbringen.

Die automatische Prognose wählt den vorläufigen Modus. Die vorhandenen manuellen/Referenz-Abrechnungswege bleiben standardmäßig auf geprüfte Jahre beschränkt. Der SFN-Prognosemodus setzt geplante Dienste voraus. Es wird kein Monat auf 2026 umdatiert: Geburtstag, Ferien-/Feiertagskalender, Tarifgültigkeit, Schichtbeginn und Nachtzeiten stammen weiterhin aus dem tatsächlichen Prognosemonat.

Ein fehlendes Brutto oder eine abgelaufene Tariftabelle wird durch die Netto-Fortschreibung nicht ersetzt. TVöD-P, TVöD E und TVAöD Pflege haben im bestehenden Datenbestand nur bis März 2027 vollständige Tabellen; deren spätere Monate bleiben ohne neue Gehaltsgrundlagen unvollständig. Andere vorhandene Tarifstände werden nach ihrer eigenen Gültigkeit verwendet.

## Quellen und Einordnung

- [BMF-Jahresgrundlagen](https://www.bmf-steuerrechner.de/interface/programmablauf.xhtml)
- [Finanztip: ausdrücklich vorläufige 2027-Prognose](https://www.finanztip.de/brutto-netto-rechner/)
- [öffentlicher-dienst.info: getrennte Tarifgültigkeit und Steuerjahrauswahl](https://oeffentlicher-dienst.info/c/t/rechner/tvoed/p?id=tvoed-p-2026)
- [§ 3b EStG](https://www.gesetze-im-internet.de/estg/__3b.html?level=1) und [SvEV](https://www.gesetze-im-internet.de/svev/BJNR338510006.html): Die bisher geprüften Zuschlagsgrenzen werden in der 2027-Schätzung fortgeschrieben; das ist keine Bestätigung aller endgültigen Rechtsgrundlagen von 2027.

Stand der Recherche: 10. Oktober 2026.

## Verifikation

- Fokussierte Netto-/Profiltests: 476 bestanden in 13 Dateien. Darunter 2027-Fälle für alle acht Gehaltsmodelle, die tatsächliche 23-Jahre-Grenze, Karfreitag 2027, Sonntagszuschläge, verschiedene Steuer-/SV-Grenzen, beide Zeitumstellungen und Cache-Wechsel nach einer Regelrevision.
- Fokussierte Komponententests: 58 bestanden in fünf Suiten. 2027-Hinweis, gerundete Hauptanzeige, geerbte Angaben ohne erneute Einrichtung und offene Zusatzversorgung sind abgedeckt.
- `npm.cmd run verify:fast`: Exit 0; 8.218 Unit-/Integrationstests in 418 Dateien sowie 880 Komponententests in 115 Suiten; TypeScript, Lint, Formatierung und die weiteren Regel-/Sicherheits-/Runtime-Gates bestanden.
- Graft-Kontextgraph aktualisiert. Die 13 geprüften Quelldateien blieben zwischen den fokussierten Tests und dem vollständigen Gate unverändert.
- Vergleich mit dem Quellsnapshot der zuletzt veröffentlichten Performance-OTA: elf bestehende Netto-Dateien verändert, zwei neue Jahresstand-Dateien hinzugefügt. App-Konfiguration, Paketdateien, Tarifpakete und andere abgedeckte App-Quelldateien blieben unverändert. Dieses neue Dokument ist die vierzehnte Datei im Task-Scope.
- Nachweise liegen lokal in `artifacts/net-pay-2027-focused.log`, `artifacts/net-pay-2027-components.log`, `artifacts/net-pay-2027-verify-fast.log`, `artifacts/net-pay-2027-source-scope.json`, `artifacts/net-pay-2027-tested-source-hashes.json` und `artifacts/net-pay-2027-verification.json`.
- Die separat freigegebene Preview-OTA ist veröffentlicht und technisch geprüft; die iPhone-Abnahme steht aus. Keine Commit-/Push-/Merge-Auslieferung im Rahmen dieses Auftrags.

## Preview-OTA vom 10. Oktober 2026

- Veröffentlichung: 15:29:49 MESZ, ausschließlich iOS, Branch/Kanal/Environment `preview`, App-Variante `internal`.
- Meldung: `Netto-Prognose 2027: vorläufig mit Stand 2026`.
- [EAS-Update-Gruppe](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/a5f53343-8514-4712-bd51-78f88488d762): `a5f53343-8514-4712-bd51-78f88488d762`; iOS-Update `01a12601-6bec-7cc0-b72c-1b83b471c237`.
- Build 33 (`8deae8f8-679b-4284-978a-a07f74fa6719`) ist weiterhin kompatibel. Runtime/Fingerprint `03d174d668f0ea5f757958dccf853632762c554d`; alle 95 nativen Fingerprint-Bestandteile stimmen mit dem Build überein.
- Die 13 getesteten Quelldateien waren vor der Veröffentlichung unverändert. Der OTA-Snapshot mit 1.336 Dateien blieb während Export und Veröffentlichung unverändert.
- Der aktive, nicht pausierte Preview-Kanal zeigt auf diese Update-Gruppe. Das ausgelieferte Manifest bestätigt iOS, die erwartete Runtime und `com.pflegeshift.app.internal`.
- Das ausgelieferte Hermes-Bundle ist bytegleich mit dem lokalen Export: 6.765.392 Byte; SHA-256 `c7dc1c4a035c1013c80d22dd3ac1d16f91155479310b9132c34e17a81f497afd`.
- Nachweise: `artifacts/net-pay-2027-ota-publication-summary.json`, `artifacts/net-pay-2027-ota-publication-verification.json`, `artifacts/net-pay-2027-ota-channel-after.json`, `artifacts/net-pay-2027-ota-update-list.json`, `artifacts/net-pay-2027-ota-source-snapshot.json` und die zugehörigen Fingerprint-/Build-/Export-Artefakte.
- Geräteabnahme offen: Preview-App vollständig schließen, öffnen und etwa 15 Sekunden warten; nochmals schließen und öffnen. Einen verfügbaren Monat 2027 auswählen und den Hinweis `2027 vorläufig · Abzüge nach Stand 2026`, die gerundete Hauptanzeige und die Zuschlagsaufteilung prüfen. Fehlende Tarifgrundlagen ab April 2027 bleiben weiterhin sichtbar.
