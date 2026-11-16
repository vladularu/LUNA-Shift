# Rust-iPhone-Pilot

## Task-Vertrag

- Ziel: Den geprüften Kalender-/Ersatzruhe-Teilblock als native Rust-Bibliothek über Swift/Expo ausführen und denselben unveränderlichen synthetischen Jahresauftrag mit TypeScript vergleichen. Vollständige Ergebnisse, native Kernzeit, Validierung und gesamte Übergabe getrennt messen.
- Nicht-Ziele: Keine Umstellung der produktiven Kalender-/Gehaltsberechnung, keine Nutzerdaten im Pilot, keine Cloud-/Datenbankänderung, kein TestFlight-/Production-Schritt, kein Git-Commit/Push/Merge.
- Plattform: iOS Preview, Expo ~57.0.32. Windows für Kern-/Schnittstellentests; Apple-Toolchain für iOS-Kompilierung und iPhone für Abnahme erforderlich.
- Basis: `a1768181`, aktueller Master ist Vorfahr. Die acht bereits geprüften numerischen Kalender-/Ruhezeit-Dateien werden unverändert übernommen. Die später für einen Build verwendete Quelle muss zusätzlich alle bereits veröffentlichten Preview-Anpassungen erhalten.
- Freigabe: Umsetzung des vorgeschlagenen nativen iPhone-Piloten durch „Ja mach das“, einschließlich des dafür ausdrücklich beschriebenen neuen internen Preview-Builds. Kein OTA-/Store-/Git-Auftrag daraus ableiten.
- Paket A: `modules/luna-rest-pilot/rust/` und C-Header, sichere begrenzte C-Schnittstelle, Host-Tests und Ergebnisgleichheit mit vorhandenen Fixtures.
- Paket B: Swift-Modul, Podspec, Modulkonfiguration, gepinnter iOS-Buildschritt und Paket-Hook. Vorhandene Module unverändert lassen.
- Paket C: TypeScript-Vergleich, synthetische Daten, manueller Diagnose-Einstieg und Export; keine automatische Doppelberechnung im regulären Betrieb. Jedes Paket bleibt unter 15 geänderten Dateien, gemeinsam maximal 30 zusätzliche Dateien; Überschreitung erneut eingrenzen.
- Abnahme: Vollständige Gleichheit mit den eingefrorenen PC-Referenzergebnissen; Fehler an der Schnittstelle dürfen keinen Absturz oder ungültige Werte verursachen; höchstens ein Vergleichslauf gleichzeitig; fehlendes natives Modul im alten Build bleibt ein normaler Zustand; Tests und `verify:fast`; tatsächlicher nativer Build und abschließend iPhone-Lauf. PC-/Mock-Ergebnisse werden nicht als iPhone-Abnahme ausgegeben.
- Nachweis: Neuer Diagnoseexport mit Build-/Runtime-/Update-Kennung, rotierender Reihenfolge, Aufwärmlauf und einzelnen Messwerten. Rechenkern und End-to-End bleiben getrennt. Der Vergleich dient diesem Teilblock, nicht der vollständigen Jahres-/Nettoberechnung.

## Dokumentation

Expo SDK 57: https://docs.expo.dev/versions/v57.0.0/sdk/expo/

Die gemeinsame Modules-API wurde gegen die installierte SDK-57-Implementierung abgeglichen. Die native Funktion läuft auf einer eigenen seriellen Queue. Der Rust-Build verwendet `Cargo.lock` und Rust 1.99.1; Abhängigkeiten und Bootstrap-Installer werden per Prüfsumme kontrolliert. Neue native Bibliotheken benötigen eine neue Runtime und einen neuen Preview-Build.

## Geräteprüfung nach erfolgreichem Build

In Preview unter Einstellungen beim vorhandenen Diagnosebereich „Rust-Vergleich starten“ ausführen und danach „Rust-Bericht teilen“. Die synthetischen Daten enthalten keine echten Dienste. Alle Vergleichsfälle müssen übereinstimmen. Während des Rust-Auftrags muss die aktive App bedienbar bleiben; die separat ausgeführte TypeScript-Kontrolle kann den JavaScript-Thread kurz beanspruchen. Ein unveränderter App-Neustart und der normale Kalender bleiben zusätzlich zu prüfen.
