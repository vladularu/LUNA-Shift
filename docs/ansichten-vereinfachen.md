# Weniger Verwaltungsseiten

Freigabe am 18.10.2026: doppelte Freigabeverwaltung vollständig aus dem normalen Teilen-Ablauf entfernen. Ergänzende Nutzerreferenz: auch die dauerhafte Sicherungsseite ist im Konto nicht erforderlich.

Ziel: Teilen zeigt Einladungen, Personen und eingehende Kalender direkt. Seltene kalenderweite Aktionen liegen in einem kompakten Menü mit Bestätigung. Das Konto enthält keine dauerhafte Sicherungen-Zeile; eine ausdrückliche Wiederherstellung ist über sein Kopfmenü erreichbar.

Nicht-Ziele: Änderung von Cloud-Daten, Freigaberechten, Synchronisationslogik, Backup-Aufbewahrung, Backend, Abhängigkeiten oder nativer Konfiguration. Keine echte Löschung oder Wiederherstellung, keine Git-Auslieferung, kein neuer Build und keine neue OTA ohne weitere ausdrückliche Freigabe.

Plattform: Expo SDK 57, iOS Preview-Build 41. Branch `codex/teilen-ohne-verwaltung`, vorhandener Arbeitsstand aus dem vom Nutzer akzeptierten Preview-OTA `74d120b8-23d4-42c4-bd50-82cc47f85960`. Unabhängige Änderungen bleiben erhalten. Ausgangsmanifest: `.expo/ansichten-vereinfachen/baseline.json`.

Arbeitspaket 1: doppelte Verwaltungsseite und kalenderbezogene Zwischenübersicht entfernen. Zugriffsrechte bleiben bei den einzelnen Personen. Kalenderweite Beendigung und Verlassen eines empfangenen Kalenders werden über ein kurzes Auswahlmenü bestätigt; mehrere eigene Kalender bleiben eindeutig auswählbar. Nur pausierte Freigaben öffnen eine aktuelle Sicherheitsvorschau. Scope: Sharing-Oberfläche, neue Menü-/Wiederherstellungskomponenten, betroffene Sharing-Tests.

Arbeitspaket 2: Sicherungen-Zeile aus dem Konto entfernen; seltene Wiederherstellung über Kopfmenü. Bestehende Historie, Datenauswahl und Schutz vor Kontowechsel erhalten. Scope: Konto-Oberfläche und Tests, Titel der bestehenden privaten Wiederherstellungsansicht.

Abnahme: keine reguläre Seite Freigabe verwalten mehr; Einladungen und Personenverwaltung direkt; Beenden erst nach Bestätigung und nur für den ausgewählten Kalender; Abbrechen ohne Mutation; empfangene Kalender weiterhin ausblendbar, farblich änderbar und verlassbar; keine automatische Veröffentlichung pausierter oder fremder Gerätebindungen; nach Fehler frische Vorschau nötig. Konto ohne Sicherungen-Zeile, Wiederherstellung nur nach ausdrücklichem Menüaufruf. Automatischer Sync und vorhandene Sicherungen bleiben erhalten.

Prüfung: betroffene Interaktionstests, vollständiges `npm.cmd run verify:fast`, iOS-Export und Hash-Abgleich des zulässigen Dateiumfangs. Die Darstellung der neuen Menüs und Abläufe muss anschließend separat auf dem iPhone bestätigt werden. Referenz: [Expo Router SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/router/).

Umgesetzt: Die reguläre Freigabeverwaltung und ihre Zwischenübersicht sind entfernt. Das bestehende Auswahlmenü enthält Beenden beziehungsweise Verlassen mit einer Bestätigung für den ausgewählten Kalender. Einladungen und individuelle Zugriffe bleiben direkt erreichbar. Pausierte Freigaben behalten ihre ausdrückliche Vorschau; eine fehlgeschlagene Veröffentlichung erfordert eine neue Vorschau. Im Konto ersetzt das Kopfmenü mit „Sicherung wiederherstellen“ die dauerhafte Sicherungen-Zeile. Der seltene Wiederherstellungsablauf bleibt erhalten und heißt „Wiederherstellen“.

Erfolgreiche lokale Prüfung am 18.10.2026:

- 68 gezielte Interaktionstests in vier Suites.
- Vollständiges `npm.cmd run verify:fast`: Regelprüfung, Typprüfung, Lint, Formatierung, 8.906 Unit-Tests, 1.220 Komponententests in 142 Suites, 199 Skripttests sowie `git diff --check`.
- Lokaler iOS-Export mit `APP_VARIANT=internal`, 52 Assets und Hermes-Bundle `entry-df08bbe5b051e443022551246fd1b58d.hbc`. SHA-256: `27D54DEC79A67047E3066BA8C48F5E1F6EB415FBD0865CBE245D65C9E5528CCB`.
- Graft-Graph aktualisiert; ursprüngliche `.gitignore`-Bytes erhalten. Alle eingefrorenen Quelldateien sind während Prüfung und Export unverändert geblieben.

Die Windows-Sandbox verweigerte beim ersten Export das Schreiben der Hermes-Ausgabedatei. Der unveränderte Export bestand anschließend außerhalb der Sandbox mit temporärem Ordner im Projekt. Auch die vollständige Prüfung lief außerhalb der Sandbox, damit die vorhandenen Windows-Junction-Tests ausgeführt werden konnten. Protokolle und Hash-Manifeste liegen unter `.expo/ansichten-vereinfachen/`.

Abgegrenzter Dateiumfang: fünf vorhandene Dateien geändert (`account-screen.tsx`, dessen Komponententest, `private-cloud-screen.tsx`, `calendar-sharing-screen.tsx` und dessen Komponententest); zwei Sharing-Komponenten ergänzt (`sharing-calendar-actions.tsx`, `sharing-publication-recovery.tsx`); `sharing-calendar-management.tsx` entfernt; dieses Dokument ergänzt. Der Abgleich mit 1.961 Ausgangsdateien bestätigt, dass kein unabhängiger Arbeitsstand verändert wurde.

Offen bleibt die iPhone-Abnahme der neuen Konto- und Freigabemenüs in Hell und Dunkel, einschließlich Abbrechen, Kalenderauswahl und Übergang zur Einladung beziehungsweise Wiederherstellung. Die bereits akzeptierte Mehr-Seite und Cloud-Kachel wurden nicht geändert. Die Änderung wurde zunächst lokal geprüft; die anschließend gesondert freigegebene OTA ist unten dokumentiert. Ein neuer nativer Build oder eine Git-Auslieferung wurde nicht durchgeführt.

## Veröffentlichtes iOS-Preview-OTA

Nach ausdrücklicher Freigabe mit „ota“ am 18.10.2026 um 04:12 Uhr (Europe/Berlin) veröffentlicht: Kanal und Branch `preview`, Plattform `ios`, EAS-Umgebung `preview`, `APP_VARIANT=internal`.

- Gruppe: `52b699ef-afd3-4391-b810-63db4f8f2727`.
- iOS-Update: `01a14cc8-9d71-7594-bab6-15c819155b70`, erstellt `2026-10-18T02:12:58.353Z`.
- Runtime: `43b795d13a44499e37cc461aa80ce8c239783788`. Der mit der Preview-Umgebung neu berechnete Fingerprint aus 145 Bestandteilen entspricht exakt dem fertigen internen Preview-Build 41 (`a8a35a6d-9d92-46cf-8b24-1afe0d28d245`). Keine Runtime wurde erzwungen.
- Der aktive Preview-Kanal führt ausschließlich zum Branch `preview` und liefert die neue Gruppe aus. Die vorherige Gruppe `74d120b8-23d4-42c4-bd50-82cc47f85960` entspricht dem akzeptierten Ausgangsstand.
- Die öffentliche Cloud-Client-Konfiguration der EAS-Preview-Umgebung wurde vor der Veröffentlichung geprüft, ohne Schlüsselwerte auszugeben. EAS hat mit dieser Umgebung einen neuen Export erstellt.
- Der tatsächliche Update-Endpunkt antwortet mit HTTP 200 und der neuen Update-ID. Lokaler EAS-Export, ausgeliefertes Manifest und heruntergeladenes CDN-Paket stimmen überein: SHA-256 `61F52E7D7BB13814A7288B2DAA679AD4B99D8A628E194AF625268F3E9BA334CF`.
- Hermes-Paket `entry-d500b5babe91648dc8aef29991512c73.hbc`, 9.527.868 Bytes und 52 begleitende Assets.
- Alle 1.963 erfassten Quelldateien blieben während Veröffentlichung und Auslieferungsprüfung unverändert. Erst anschließend wurde dieses Dokument um die Nachweise ergänzt. Die Produktionsdateien entsprechen weiterhin dem vollständigen erfolgreichen Testlauf.
- Belege: `.expo/ansichten-vereinfachen/ota/final-proof.json`, `published-updates.json`, `updates-after.json`, `channel-after.json`, `served-proof.json` und `source-proof-after.json`.

Die Auslieferung und Kompatibilität sind geprüft; die sichtbare Übernahme dieser neuen OTA auf dem iPhone ist noch nicht bestätigt. App vollständig schließen, öffnen und etwa 15 Sekunden warten, dann erneut schließen und öffnen. SDK-Referenz: [Expo Updates für SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/updates/).
