# Eigener Zeitraum je Tab

Ziel: Kalender und Auswertung behalten innerhalb der laufenden App-Sitzung jeweils ihren eigenen zuletzt betrachteten Zeitraum und die gewählte Ansicht. Ein Wechsel auf einen anderen Tab löst keinen Heute-/Aktuell-Auftrag aus. Nur ein weiterer Tipp auf den bereits aktiven Kalender beziehungsweise die aktive Auswertung löst die vorhandene Heute-/Aktuell-Funktion aus.

Nicht-Ziele: Keine dauerhafte Speicherung über einen App-Neustart, keine Änderung von Berechnungen, Kalenderdaten, nativen Modulen, Gestaltung oder bewussten Monatswechseln innerhalb einer Seite. Keine Änderung an den übrigen offenen Arbeitsständen.

Basis: origin/master 7c9031fe16254491a22ef51af65b000c0cfb84d1; am 22.10.2026 per git fetch abgeglichen. Branch: codex/tab-period-state.

Plattform: iOS zuerst; NativeTabs und JavaScript-Tabnavigation erhalten dieselbe Regel. Expo SDK 57, package.json ~57.0.22. API-Referenz: https://docs.expo.dev/versions/v57.0.0/sdk/router/native-tabs/

Dateiscope:

- src/composition/pflegeshift-runtime-provider.component.test.tsx
- src/composition/pflegeshift-runtime-provider.tsx
- src/navigation/use-data-month.ts
- src/navigation/use-data-month.component.test.tsx
- src/navigation/active-month.tsx
- src/navigation/analysis-period-navigation.ts
- src/navigation/app-tabs.native.tsx
- src/navigation/app-tabs-js.tsx
- src/features/analysis/use-analysis-navigation.ts
- src/features/analysis/analysis-rule-coverage.component.test.tsx
- src/features/analysis/analysis-screen.tsx
- src/navigation/active-month.test.ts
- src/navigation/calendar-tab-date.component.test.tsx
- src/features/analysis/use-analysis-navigation.component.test.tsx
- docs/tab-period-state.md

Abnahmekriterien:

1. Kalender Dezember -> Mehr -> Kalender zeigt weiterhin Dezember; erst der nächste Tipp springt zu heute.
2. Kalender Juni und Auswertung Dezember bleiben beim Wechsel in beiden Richtungen voneinander unabhängig.
3. Die Auswertung öffnet ohne vorherigen eigenen Stand den aktuellen Monat in der Profil-Zeitzone.
4. Die Auswertung behält Monat/Jahr und Monats-/Jahresansicht beim Tabwechsel und bei einem erneuten Mount innerhalb der Sitzung.
5. Erneutes Tippen auf die aktive Auswertung führt in der Monatsansicht zum aktuellen Monat und in der Jahresansicht zum aktuellen Jahr. Der Kalender wird dabei nicht verändert.
6. Ein Tabwechsel startet keine programmierte Monats-/Jahresfahrt im Auswertungs-Pager.
7. Der Datenlader folgt dem sichtbaren Tab beziehungsweise einem expliziten Berichtsmonat; auch weit auseinanderliegende Jahre bleiben getrennt auswertbar.
8. Explizite Zeitraum-Routen und das Zurückgehen aus einer Unterseite behalten ihre bisherige Funktion.

Prüfung: gezielte Vitest-/Jest-Regressionen einschließlich Hook und echtem ReportPeriodPager; danach npm.cmd run verify:fast und git diff --check.

Geräteabnahme: Noch offen. Im bestehenden passenden iOS-Preview-Build die Kriterien 1, 2, 5 und 6 per Bildschirmaufnahme prüfen; Build-/Update-ID und Gerät festhalten. Code- und Komponententests belegen den sichtbaren iPhone-Ablauf nicht.

Commit, Push, PR/Merge, EAS Update, EAS Build und Store-Veröffentlichung: nicht freigegeben.

Lokale Prüfergebnisse (22.10.2026):

- Typecheck, Lint mit null Warnungen, vollständige Formatprüfung und git diff --check bestanden.
- Vollständige Unit-Suite: 469 Dateien / 9.072 Tests bestanden; Windows-Ausführung mit --pool=threads --maxWorkers=1. Nach der letzten Fokus-Korrektur zusätzlich 58 Navigationstests bestanden.
- Vollständiger Komponentendurchlauf ausgeführt (149 Suites). Zwei veraltete Testdoubles wurden an die getrennten Zustände angepasst. Die vier betroffenen Suites wurden danach mit 75/75 Tests erfolgreich nachgeprüft, einschließlich expliziter Berichtsrouten, Startup und Pager ohne Fahrt beim Tabwechsel.
- Alle weiteren unveränderten verify:fast-Prüfschritte bestanden: Regelpublikation/-auslieferung, Produktions-Preflight/-Provisionierung/-Trust, Preview-Operator, Tarifinventar, Audit-/Runtime-Policy, Build-Abhängigkeiten, Kalender-Worklets, Sharing-Sicherheit, native Widget-Tests und Decoder-Härtung.
- npm.cmd run verify:fast wurde ausgeführt; der Standardlauf blieb unter Windows im Vitest-Fork-Pool ohne Testfortschritt. Die gleichen Prüfschritte wurden deshalb in nachvollziehbaren Teilläufen abgeschlossen; geändert wurden nur die Vitest-Laufzeitparameter, keine Testgrenzen oder Anwendungseinstellungen.
- Der lokale Graft-Graph wurde nach den Codeänderungen aktualisiert.
- Geräteabnahme bleibt offen; keine Git- oder Release-Veröffentlichung ausgeführt.
