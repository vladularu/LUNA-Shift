# Jahressonderzahlung: nachvollziehbare Prognose

Ziel: TV-L/KR, TV-UK Pflege und TV-H/KR mit unverändertem Tarif weiter automatisch berechnen; fehlende Prognosen mit konkretem Grund und vorhandener Korrektur-/Betragseingabe darstellen.

Basis: iOS-Preview-OTA 2d1b5896-efab-44e6-9acc-1f8be4a4cee6 vom 10.11.2026. Die archivierte Quelle ist vor Änderungen mit 1.201 Quelldateien und Digest 2c7b23d8f3394d19445faa8345493a5fc85d1e3fcce268fca26654cbd7a5c1c9 abgeglichen. Isolierter Branch codex/jahressonderzahlung-status, von origin/master angelegt und mit exakt dieser Preview-Quelle belegt.

Plattform: Expo SDK 57.0.31, iPhone, bestehender interner Preview-Build 49. SDK-Referenz: https://docs.expo.dev/versions/v57.0.0/sdk/updates/.

Arbeitspaket 1: typisierter Prognosestatus und Regressionen für durchgehenden Tarif, tatsächlichen Wechsel, rückwirkende Berichtigung, unvollständige Referenzmonate, nicht unterstützte Gruppen/Jahre und gespeicherte Beträge/Nullzahlungen.

Arbeitspaket 2: Weitergabe an bestehende Gehaltsansichten; kompakter Grund in der Monatsübersicht und Erläuterung mit vorhandenen Aktionen in den Details. Keine neuen Karten oder Navigationsbereiche.

Dateiscope: annual-salary-{proposal,forecast,issue,payment-editor}, use-annual-salary-forecast, bestehende Gehaltsdetails/-abrechnung, analysis-screen, month-overview, dashboard-cards und gezielte Tests; exakte Hashfreigaben im bestehenden TestFlight-Quellvergleich. Keine Änderung von Tarifprozenten, Anspruchsregeln, Datenbankschema, nativen Modulen, Assets oder Runtime.

Abnahme: automatische Novemberzahlung bei durchgehendem Tarif; echte Wechsel mit Prüfhinweis ohne erfundenen Betrag; Berichtigung für den gesamten Zeitraum reaktiviert die Prognose; Referenzfehler nennt den Monat; gespeicherte Zahlungen einschließlich Null und verschobene Raten bleiben maßgeblich; keine Doppelzählung in Monat/Jahr/Export. Fokussierte Tests, verify:fast, iOS-Export, tatsächlicher Fingerprint und CDN-Abgleich. Sichtprüfung der neuen Zustände auf dem iPhone nach Preview-Veröffentlichung offen.

Freigabe: Umsetzung und iOS-Preview-OTA ausdrücklich beauftragt. Commit, Push, Merge, nativer Build und TestFlight gehören nicht zum Auftrag.
