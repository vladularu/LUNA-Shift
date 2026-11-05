# Paket 1: Speichern oben in Arbeit und Gehalt

## Ergebnis und Scope

Die Beschäftigungseditoren Arbeit, Gehalt, Arbeit & Gehalt und Arbeitsmodell verwenden genau eine Speichern-Aktion oben rechts, auch beim Einstieg aus Mehr. Unveränderte Entwürfe und laufende Speicherungen sperren die Aktion. Die native Toolbar blendet wie bei der Dienstvorlage den zusätzlichen geteilten iOS-Glashintergrund aus.

Bestehende Validierung, Zeitraumwahl, Verwerfen, Fehlerbehandlung und Persistenz bleiben erhalten. Persönliche Angaben und Arbeitgeber behalten ihren bisherigen Speichereinstieg. Keine Änderung an Tarif-/Netto-Berechnungen, Datenmodell oder nativen Abhängigkeiten.

App-Dateien: `src/features/settings/settings-editor-screen.tsx`, `src/ui/form-layout.tsx`. Zugehörige Komponentenassertionen und Router-Testdoubles sind angepasst.

## Geräteabnahme und Auslieferung

Paket 1 wurde vom Nutzer am 6. November 2026 ausdrücklich auf der Preview-App abgenommen und für Commit sowie GitHub-Abgleich freigegeben. Die vorherige R1 mit zusätzlichem grauem Glashintergrund ist durch diese korrigierte R2 ersetzt.

- Ziel: iOS Preview Build 49, Kanal/Branch und Environment `preview`, `APP_VARIANT=internal`.
- Runtime: `402e757d98ca799660ce5dd15a24bd999cf690eb`.
- Abgenommene OTA-Gruppe: `2acd4c71-ef83-4b8a-b036-ccae4e438be6`.
- Update: `01a1ae04-66be-7684-9d53-df7d005cb3b3`.
- Preview-Quellfingerprint: `9f550b7b2302492b045e211b2993fb2d960750e61995b050dd6b751861157381`.
- Bundle-SHA256: `2d85cd18d7d2248a95539d584c456d79de206461e47f84c21a243aa76b0a0f55`.
- Bundle und alle 34 Assets vom Update-Server bytegenau gegen den geprüften Export verifiziert.
- Expo `~57.0.31`; Referenz: https://docs.expo.dev/versions/v57.0.0/sdk/router/stack/.

Die ausdrückliche Paketabnahme ersetzt keine separat dokumentierten Android-/Web-Tests oder TestFlight-Abnahme. Eine Production-/TestFlight-Veröffentlichung ist nicht Teil dieses Pakets.

## GitHub und separate Preview-Darstellung

Ausgangspunkt ist master `380b1370d79b2ce3c5a2c2128016441f6fa6d9c3`. Der Nutzer verlangt, die separate Luftig-Gestaltung der Preview zu erhalten. Deshalb werden zwei abgegrenzte Branches gesichert:

- `codex/paket1-speichern-oben`: kleiner Funktionspatch für den master-PR.
- `codex/paket1-preview-luftig`: vollständiger abgenommener Preview-Quellstand; zusätzlich 33 unveränderte Darstellungsdateien und passende Komponentenassertionen aus dem hashgeprüften Quellarchiv der vorherigen Preview. Dieser Branch wird nicht als Designänderung nach master gemergt.

Die akzeptierte TestFlight-Baseline bleibt unangetastet. Die konkreten Quellabweichungen sind einzeln in `releases/testflight/build-9.reviewed-changes.json` begründet. Paket 2 beginnt nach erfolgreicher PR-CI und GitHub-Integration des Funktionspatches.

## Prüfung und Nachweise

Beide Arbeitsstände bestehen `npm.cmd run verify:fast`: jeweils 10.404 Fachtests, 1.840 Komponentenfälle in 195 Testgruppen sowie die zusätzlichen Schutzprüfungen. 32 fokussierte Editorfälle bestehen. Ein erster Git-Lauf mit parallel laufendem Export und Fachtests überschritt in zehn bestehenden Fällen das unveränderte Zeitlimit; der vollständige Wiederholungslauf bestand ohne Anpassung der Tests oder Zeitlimits.

Die chatbezogenen Nachweise umfassen `paket1-r2-checks.json`, `paket1-r2-preview-delivery-proof.json`, `paket1-r2-preview-source-archive.json`, das vollständige Quellarchiv und `paket1-r1-device-feedback.json`. Die Abnahme bezieht sich auf die oben genannte R2, nicht auf die verworfene R1.
