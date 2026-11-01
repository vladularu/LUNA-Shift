# Pausen bei geteilten Diensten

## Task-Vertrag

- Ziel: Ausdrücklich als geteilter Dienst erfasste Abschnitte sollen eine ausreichend lange, arbeitsfreie Unterbrechung automatisch für die Pausenprüfung berücksichtigen.
- Nicht-Ziele: Keine Änderungen an Gehalt, Zulagen, Arbeitszeitgutschrift, Diensteditor, Datenbank oder nativer Integration. Keine pauschale Anerkennung beliebiger Lücken zwischen unabhängigen Diensten.
- Plattform: Gemeinsame Prüflogik; Abnahme anschließend in LUNA Shift Internal auf dem iPhone.
- Dateiscope: `src/engine/compliance.ts`, neue Hilfslogik und Regressionstests `src/engine/compliance-split-breaks.ts` / `.test.ts`, dieses Dokument.
- Branch: Fortführung des vorhandenen Arbeitsstands auf `codex/gehalt-auszahlung`; unabhängige Änderungen bleiben erhalten.
- Veröffentlichung: Umsetzung freigegeben; iOS-Preview-OTA anschließend am 01.11.2026 ausdrücklich bestätigt. Commit, Push, native Builds und TestFlight sind nicht freigegeben.

## Abnahmekriterien

1. Geteilter Dienst 06–10 und 16–20: keine Pausenwarnung; weiterhin acht Arbeitsstunden, kein zusätzlicher Abzug der Unterbrechung.
2. Mehr als sechs Stunden am Stück bleiben auffällig, auch wenn später eine lange Unterbrechung folgt.
3. Die gesamte Arbeitsdauer bestimmt weiterhin den Pausenbedarf: über sechs Stunden 30 Minuten, über neun Stunden 45 Minuten. Einzelne Unterbrechungen unter 15 Minuten zählen nicht.
4. Unabhängige Diensteinträge behalten die bisherige vorläufige Bewertung ihrer Lücke. Bereitschaft und Rufbereitschaft werden nicht automatisch als freie Pause anerkannt.
5. Andere eingetragene Arbeit oder eine überlappende Rufbereitschaft verhindert die automatische Anerkennung der betroffenen Unterbrechung.
6. Fokussierte Regressionstests und `npm.cmd run verify:fast` bestehen. Die iPhone-Prüfung ist nach einer gesondert freigegebenen Preview-Veröffentlichung offen.

## Fachliche Grundlage

[ArbZG § 4](https://www.gesetze-im-internet.de/arbzg/__4.html) unterscheidet den gesamten Pausenbedarf und die höchstens sechs Stunden zusammenhängende Arbeit. Eine freie Unterbrechung zwischen ausdrücklich geplanten Teilen wird nur für die Prüfung berücksichtigt; sie wird nicht erneut von der Arbeitszeit abgezogen.

Nach [BAG, 21.08.2024, 5 AZR 266/23](https://www.bundesarbeitsgericht.de/entscheidung/5-azr-266-23/) muss spätestens bei Beginn der Pause feststehen, dass und wie lange eine freie Erholungspause besteht. LUNA bewertet die geplanten Einträge; tatsächlich abweichende Dienstzeiten müssen weiterhin korrigiert werden.

## Lokaler Nachweis am 01.11.2026

- Zehn neue Regressionstests bestehen, einschließlich einer durch einen Dienst vom Vorabend belegten Unterbrechung. Zusammen mit Architektur-, Bestands- und Performanceprüfungen: 95 Tests in sechs Dateien bestanden.
- `npm.cmd run verify:fast` vollständig erfolgreich: 537 Unit-Testdateien mit 10.319 Tests, 187 Komponentensuites mit 1.791 Tests sowie alle Skriptprüfungen, Typprüfung, Lint, Formatierung und `git diff --check`.
- Abschlussprotokoll: `.verify-geteilter-dienst-pausen-final.log`. Der erste Durchlauf fand die Dateigrößengrenze; die Hilfslogik wurde ausgelagert. Ein Zwischendurchlauf wurde für die zusätzliche Absicherung über Mitternacht gestoppt.
- Quellenabgleich mit dem zuletzt veröffentlichten Preview: eine bestehende Quelldatei geändert, zwei neue Quelldateien ergänzt, 1.975 bestehende Quellen unverändert. Nachweis unter `artifacts/geteilter-dienst-pausen/`.
- Zum Abschluss der lokalen Prüfung noch keine Veröffentlichung, kein Commit oder Push. Die anschließend freigegebene Preview-OTA ist unten dokumentiert.

## iOS-Preview-OTA am 01.11.2026

- Gruppe: `601583ec-32f7-4286-addc-7fa65dad76c3`; iOS-Update: `01a19601-f42d-7e16-ab3d-b174513f85e2`, veröffentlicht um 07:27:52 UTC.
- Ziel: Kanal/Branch/Environment `preview`, `APP_VARIANT=internal`, Bundle-ID `com.pflegeshift.app.internal`, passender bestehender iOS-Preview-Build 44.
- Runtime: `b99c3cf0dd56e6b1bb126d195f21c665de57760b`. Fingerprint, Build und aktueller Preview-Vorgänger wurden vor Veröffentlichung frisch abgeglichen.
- Die erste Exportvariante ohne Sourcemaps war größer. Mit den bisherigen Export-Einstellungen (`--source-maps --dump-assetmap --clear`) beträgt das Bundle 9.888.680 Bytes, 2.408 Bytes mehr als der Vorgänger. Die 34 exportierten Assets sind unverändert. Veröffentlicht wurde dieser geprüfte Export mit `--skip-bundler`.
- Tatsächlicher Kanal-/Runtime-Abruf, Manifest und CDN-Download stimmen mit dem veröffentlichten Update überein; SHA-256: `6efcc1af612424b535ff9c1c07601813983d2bf83559dd54260647b70b13c990`.
- Alle 1.978 eingefrorenen Quellpfade und Dateihashes sind unverändert. Nachweis: `dist/preview-geteilter-dienst-preflight/delivery-proof.json`, Kopie unter `artifacts/geteilter-dienst-pausen/delivery-proof.json`.
- Keine Git-, TestFlight- oder native Veröffentlichung. Die iPhone-Abnahme bleibt offen: Internal-App vollständig schließen, öffnen und 15 Sekunden warten, erneut schließen und öffnen; danach den geteilten Dienst prüfen.
