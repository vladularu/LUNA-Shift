# Zurückwischen in Auswertungs-Untermenüs

## Auftrag

- Ziel: In Gehalt und allen Gehaltsdetails führt die native Wischgeste nach rechts eine Ebene zurück, ohne den Monat zu wechseln.
- Nicht-Ziele: Änderungen an Auswertungsübersicht, Monats-/Jahreswischer, Berechnungen oder nativer Konfiguration. Bestehende Monatspfeile bleiben erhalten.
- Plattform und Zielgerät: iOS, iPhone in der bestehenden Preview-App.
- Basis: `origin/master`, `b2fda7589480d8146ad5a70dd869708fbc12ecd2`.
- Branch: `codex/analysis-submenu-back-swipe`.
- Dateiscope: `salary-screen.tsx`, `salary-details-screen.tsx`, `horizontal-back-gesture.ts`, die beiden zugehörigen Testdateien und dieses Dokument.
- Freigaben: lokale Implementierung, Tests und iOS-Preview-OTA für den vom Nutzer bestätigten Build 44. Nach erfolgreicher iPhone-Abnahme sind Commit, Push, PR und Merge nach erfolgreicher CI ausdrücklich freigegeben, ausschließlich für die Zurückwisch-Änderung und ihre Tests/Dokumentation. Neue native Builds und Production/TestFlight sind nicht freigegeben.

## Abnahmekriterien

1. Auswertungsübersicht: Wischen zwischen Monaten/Jahren funktioniert wie bisher.
2. Gehalt: Nach rechts wischen führt zur Auswertung, ohne den Monat zu ändern.
3. Gehaltsbestandteile, Abzüge, Zeitzuschläge, Zuschläge je Dienst und Berechnungsgrundlagen: Nach rechts wischen führt genau zur vorherigen Seite, auch bei mehreren übereinander geöffneten Details.
4. Monatspfeile, verknüpfte Details und Export verwenden weiterhin den gewählten Monat.
5. Vertikales Scrollen, Zurück-Schaltflächen und andere Auswertungs-Unterseiten bleiben bedienbar.

## Prüfung

- Fokussierte Regressionen: 25 Navigationstests und 135 Komponententests bestanden. Alle fünf Gehaltsdetailbereiche und die Gehaltsübersicht sind abgedeckt; die vorhandenen Tests für Monatspfeile, Export und Auswertungswischer bleiben grün.
- `npm.cmd run verify:fast`: vollständig bestanden, Exit-Code 0. Enthalten sind Typecheck, Lint ohne Warnungen, Formatprüfung, 9.727 Unit-Tests, 1.430 Komponententests in 155 Suiten und die zusätzlichen Skriptprüfungen.
- Die Auswertungsübersicht, ihr Monats-/Jahreswischer und der Analyse-Stack sind gegenüber der Basis unverändert.
- iPhone-Abnahme am 27.10.2026 durch direkte Nutzerrückmeldung bestätigt: Zurückwischen in den Untermenüs funktioniert, der Monat bleibt erhalten und die Auswertungsübersicht ist wie vorher. Bezug: bestätigter Preview Build 44 und die unten dokumentierte OTA-Gruppe. Das genaue iPhone-Modell wurde nicht genannt.
- Native Gestenerkennung und Animation können durch Komponententests nicht auf dem iPhone abgenommen werden.

## Umsetzung

Die Gehaltsseiten rendern nur den ausgewählten Monat und verwenden keinen horizontalen `ReportPeriodPager` mehr. Die bestehenden Monatspfeile setzen den Monat weiterhin über `useReportMonth`. Für `salary` und `salary-details` gelten dieselben nativen Zurück-Gesten wie für die übrigen Auswertungsdetails; die bisherige Ausnahme für horizontales Monatswischen entfällt.

Expo-Version der Basis: `~57.0.31`. Verwendete Referenz: [Expo Router Stack für SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/router/stack/). Die verlinkte [Optionsreferenz des nativen Stacks](https://reactnavigation.org/docs/native-stack-navigator/#fullscreengestureenabled) beschreibt die vollflächige Zurück-Geste unter iOS.

Keine neuen Abhängigkeiten oder Änderungen an nativer Konfiguration.

## Preview-Veröffentlichung am 27.10.2026

- Ziel: `preview`, iOS, `APP_VARIANT=internal`, Environment `preview`, Preview Build 44.
- Passender fertiger EAS-Build: `812ea1a9-a4c0-48f3-b01a-72011cdad43e`.
- Lokaler und veröffentlichter Fingerprint: `b99c3cf0dd56e6b1bb126d195f21c665de57760b`; identisch mit Build 44.
- Update-Gruppe: `6f430fbb-8fef-4e6f-b3b4-d2ef21f7415b`.
- iOS-Update-ID: `01a17e4c-3688-7ae9-b31d-15580d0b709f`.
- [EAS-Update](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/6f430fbb-8fef-4e6f-b3b4-d2ef21f7415b).
- EAS-Veröffentlichung: Exit-Code 0. Preview-Kanal zeigt auf Branch `preview`; das Update ist als neuestes iOS-Update gelistet.
- Direkte Kanalabfrage für Build 44: Manifest HTTP 200, Bundle-CDN HTTP 200. Die vom Manifest gelieferten Asset-Request-Header wurden beim Bundleabruf angewendet.
- Lokaler Export, Manifest und ausgeliefertes Bundle stimmen überein: SHA-256 `8894b85cea31ab6b51357dcaa2fcc2704cbf508b0a2b4fe7eca41d174b2cd3cb`, 9.781.628 Bytes.
- Production-Update-Gruppe vor und nach Veröffentlichung unverändert: `1149699c-6a06-4a97-ae16-50f230a08fdc`.
- Die geprüften fünf Code-/Testdateien wurden für den Upload unverändert verwendet. Keine neue Veröffentlichung für die ältere Runtime von Build 43.
- iPhone-Abnahme erfolgreich, direkt vom Nutzer bestätigt: „Hab es auf dem iPhone getestet, passt so. Zurückwischen in den Untermenüs funktioniert, der Monat bleibt erhalten und die Auswertungsübersicht ist wie vorher.“ Diese Abnahme gilt für die hier veröffentlichte Preview-Version.
