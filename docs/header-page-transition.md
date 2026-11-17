# Header mit der Seite bewegen

## Auftrag

Ziel: Auf regulären iPhone-Unterseiten folgen Titel, linker Zurückbutton und rechte Aktionen derselben interaktiven Seitenbewegung. Der vorhandene `GlassBackButton` mit nativem `GlassView` bleibt erhalten, einschließlich Transparenz-Fallback und 44-Punkt-Touchfläche. Referenzen sind die Videos vom 17.11.2026, 17:05:55 und 17:06:15.

Nicht-Ziele: Fachlogik, gespeicherte Daten, SDK-/Native-Änderungen, Umgestaltung der Teilen-Seite, Änderungen an Sheets oder vertikalen Editoren.

Plattform: iOS, zuerst bestehende Preview-App auf dem iPhone. Android und Web behalten ihre bisherigen Header. Umsetzung auf `codex/header-mit-seite`, Basis `origin/master` vom 17.11.2026 (`1d1b6ca8`). Die parallele FPS-Diagnose bleibt in ihrem eigenen Checkout.

Dateiscope: Root-Stack, gemeinsame seiteninterne Kopfzeile, zugehörige Komponenten-/Navigationstests und konkrete Quellvergleichseinträge. Keine Änderung an `GlassBackButton`, nativen Modulen oder Paketversionen.

## Umsetzung

Der Root-Stack verwendet auf regulären iOS-Card-Routen einen eigenen Header innerhalb der nativen Bildschirmfläche. Die bestehende Routenauswahl für horizontale Zurückgesten grenzt Sheets und vertikale Darstellungen aus. Der native Stack und seine interaktive Zurückgeste bleiben erhalten; nur die separate native Navigationsleiste wird für diese Routen durch den mitbewegten Header ersetzt.

Die Kopfzeile übernimmt Titel, Seitenfarbe, Schrift, linken Glasbutton und rechte Aktionen aus den aufgelösten Screen-Optionen. `Stack.Toolbar.View`-Aktionen werden innerhalb der Kopfzeile dargestellt, damit insbesondere Speichern und Schließen weiterhin erreichbar sind. Es werden keine zusätzlichen Opacity-Animationen um native Glasflächen gelegt.

Referenz: [Expo SDK 57 Stack](https://docs.expo.dev/versions/v57.0.0/sdk/router/stack/), [Expo SDK 57 GlassEffect](https://docs.expo.dev/versions/v57.0.0/sdk/glass-effect/).

## Abnahme

- Kalender gestalten: langsam vom Rand zurückziehen, mehrfach die Richtung wechseln, abbrechen und vollständig zurückgehen. Titel, Glasbutton und Inhalt müssen gleichzeitig folgen. Der Fotoregler darf weiterhin keine Zurückgeste auslösen.
- Arbeitgeber: dieselben Gesten prüfen; Zurückbutton und vorhandene Speichern-Aktion müssen ihre bisherige Funktion behalten.
- Dienstvorlage und Arbeitsprofil: rechte Toolbar-Aktion, gesperrtes/aktives Speichern und ungespeicherte Eingaben prüfen.
- Teilen-Seite als Vergleich, zusätzlich eine verschachtelte Unterseite sowie ein modales Detailfenster öffnen.
- Helles/dunkles Erscheinungsbild, große Schrift und reduzierte Transparenz prüfen. Native Glasdarstellung und bisherige kompakte Kopfzeilenposition müssen auf dem Gerät bestätigt werden.

Status: Implementierung und lokale Prüfungen; iPhone-Abnahme steht aus. Kein Commit, Push, Build, OTA oder TestFlight-Release durch diesen Auftrag freigegeben.

## Lokale Prüfung am 17.11.2026

- `npm.cmd run verify:fast`: erfolgreich, einschließlich 598 Unit-Testdateien mit 11.131 Tests, 224 Komponenten-Testgruppen mit 2.149 Tests und den anschließenden Vertrags-/Runtime-/Sicherheitsprüfungen.
- Die neuen Tests verwenden echte Expo-Router-Navigation und prüfen nativen Glasmodus, Touchfläche, Zurück sowie dynamisch gesperrtes/aktives Speichern über `headerRight` und `Stack.Toolbar.View`.
- Nach dem abschließenden Abstandsabgleich: Typprüfung, gezielter Lint und Formatprüfung erfolgreich; der neue Header-Test ist auch im vollständigen Komponentenlauf grün.
- iOS-Export des endgültigen Stands erfolgreich: `entry-2af915edfad808d710a5343dd3bf175f.hbc`.
- TestFlight-Quellschutz: erfolgreich, 2.659 Quellen, keine ungeklärte Abweichung. Nur die beiden geänderten App-Quellen sind zusätzlich mit exakten Hashes begründet; die abgenommene Baseline wird nicht ersetzt.
- Glasbutton, Gestenregeln, Paketversionen und native Konfiguration stimmen mit der Branch-Basis überein. Visuelles Verhalten und Glasmaterial bleiben bis zur echten iPhone-Abnahme unbestätigt.
