# Gebündelte Rust-Anbindung der Jahresauswertung

## Task-Vertrag

- Ziel: Gemeinsame Kalender-/Dienstdaten einmal pro laufendem Jahresauftrag vorbereiten und den geprüften Kalender-/Ersatzruhe-Kern im echten Jahres-Rechenweg nativ ausführen. Gleichartige Teilaufträge dürfen Ergebnisse teilen; vollständige fachliche Horizonte bleiben erhalten.
- Nicht-Ziele: Kein Rust-Port von Gehalt/Netto, keine Änderung gesetzlicher Regeln oder sichtbarer Befunde, keine Kalender-/Cloud-Datenänderung, keine neue Oberfläche, keine SDK-/Paketupdates und kein TestFlight-/Production-Schritt.
- Plattform: iOS Preview, Expo ~57.0.32. Fehlende/ungeeignete native Schnittstelle und native Fehler verwenden den TypeScript-Pfad. Windows für Host-/Fachtests, macOS für den internen nativen Build, tatsächliches iPhone für die abschließende Latenzmessung.
- Basis: Der vollständige ausgelieferte Preview-Build-51-Quellstand, Digest `c49544dd1598a95e614a64f19d7590c1ecb7386ddb1fba4bea9a04a6d682d914`, wurde in einem neuen Checkout auf `codex/rust-annual-integration-20261112` wiederhergestellt. Der Master ist Vorfahr der verwendeten Performance-Basis. Bestehende offene Arbeiten und der native Pilot bleiben unberührt.
- Freigabe: „Oke setze das so um“ für die zuletzt vorgeschlagene gebündelte Integration und die fortgeltenden Freigaben der Optimierungsarbeit. TestFlight-Hold bleibt ausdrücklich bestehen. Kein Git-Commit, Push, Merge oder OTA in diesem Paket. Ein erforderlicher neuer interner Preview-Build wird erst nach Tests, Quell-/Kanalabgleich und passender Runtime gestartet.

## Getrennte Arbeitspakete

1. Engine: Gemeinsame, begrenzte Vorbereitung der tatsächlich verwendeten Monats-/Beschäftigungs-Kontexte und typisierte vorab berechnete Ersatzruhe-Fakten; unveränderte TypeScript-Referenz. Betroffen sind `compliance.ts`, `dated-compliance.ts`, `compliance-sunday-holiday-rest.ts`, neue Vorbereitungs-/Faktentypen und passende Paritätstests; höchstens 12 Dateien.
2. Native Schnittstelle: Gepoolte Jahresdaten, begrenzte Referenzen statt wiederholter Vollkopien, Prüfung der Antwort und zusätzliche Swift-/Rust-Funktion. Das bisherige Pilotprotokoll bleibt funktionsfähig. Scope: `modules/luna-rest-pilot/`, Native-Fingerprint und passende Host-Tests; höchstens 12 Dateien.
3. Scheduler: Ein Jahresjob wartet auf die native Antwort, ohne die JavaScript-Queue mit wiederholten Warteaufrufen zu belegen. Abbruch und Priorität bleiben korrekt. Scope: Analysis-Queue, Shared-Task-Typen und Tests; höchstens 5 Dateien.
4. Jahresintegration: Erst nach Core-Anzeige und Cache-Wiederherstellung vorbereiten; gespeicherte gültige Berichte starten keinen nativen Auftrag. Nur fehlende/ungültige Monatsprüfungen vorbereiten. Scope: Jahresorchestrierung, kleiner plattformspezifischer Adapter, Diagnosezeiten, Cache-Vertrag, exakte Quellfreigaben und Integrations-/Abbruchtests; höchstens 15 Dateien.
5. Cache-Kompatibilität: Der vorhandene Vertragsgenerator erfasst zusätzlich die tatsächlich verwendeten Rust-/Swift-/Wire-Quellen und gesperrten nativen Versionen. Native Rechenänderungen dürfen keine alten Ergebnisse unter unveränderter Rechenkennung wiederverwenden. Scope: Vertragsgenerator, Regressionstest und erzeugte Kennung; höchstens 3 Dateien. Die synchron nutzbare bestehende Jahres-API bleibt erhalten; native Arbeit wird nur in den dafür vorbereiteten UI-/Hintergrund-Jobs verwendet.

## Abnahme

- Vollständige identische Befunde/Jahresergebnisse für normale und überlappende Dienste, eine Endzeitänderung, Nacht-/Jahresgrenzen, 23-/25-Stunden-Tage, Beschäftigungs-/Regionenwechsel, unvollständigen Feiertagskatalog, leere Kalender und Jugendschutz.
- Alte Builds, andere Plattformen, nicht unterstützte Eingaben und fehlgeschlagene native Aufrufe bleiben mit dem bisherigen Rechenweg korrekt.
- Gespeicherter unveränderter Jahresstand wird ohne Rust-Neuberechnung wiederverwendet. Native Antworten überholter/abgebrochener Aufträge werden nicht angezeigt oder gespeichert.
- `npm.cmd run verify:fast`, relevante fokussierte Tests und echte Host-Schnittstellentests; anschließend iOS-Export und gegebenenfalls neuer interner nativer Build.
- Geräteprüfung: Jahr fertig laden, App neu starten und unveränderte Anzeige prüfen; danach nur eine bestehende Dienst-Endzeit ändern und die Performancediagnose exportieren. Gemessen wird die echte Änderung bis zum fertigen Jahresbericht, zusätzlich Vorbereitung, native Übergabe und Rückfall. Ohne diese Aufnahme keine Zusage einer bestimmten App-Beschleunigung.

Änderungen am regulären Rechenweg erzeugen über den bestehenden Generator eine neue Rechenvertragskennung. Einmalige Neuberechnung nach dem Update ist möglich; danach muss der unveränderte Neustart wieder gespeicherte Ergebnisse nutzen. Keine manuelle Umgehung dieser Versionsprüfung.

SDK-Dokumentation: https://docs.expo.dev/versions/v57.0.0/sdk/expo/ ; die gemeinsame Modules-API wird gegen die installierte SDK-57-Version abgeglichen. Neue native Funktionen erfordern eine neue Runtime und einen neuen internen Build.
