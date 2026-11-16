# Numerische Kalender-/Ruhezeitberechnung in der App

## Task-Vertrag

- Ziel: Die im PC-Pilot geprüfte numerische Kalenderdarstellung in den bestehenden Ersatzruhetags-Rechenblock übernehmen und die nun günstigeren Rechenschritte sinnvoll bündeln.
- Nicht-Ziele: Keine Rust-/Swift-/Native-Integration, keine neue Oberfläche, keine Cloud-, Datenbank-, Tarif- oder Nettoänderung. TestFlight/Production bleiben unverändert. Keine Änderung der bisherigen Pilotdateien.
- Plattform: Bestehende Expo-SDK-57-App, zuerst lokale Node-Prüfungen; sichtbare Gesamtdauer ist anschließend auf dem iPhone in Preview zu prüfen.
- Basis: Geprüfter Performance-Stand `a1768181caa9d42330c9be6e7259503fb0a9b2b4`, eigener Checkout/Branch `codex/calendar-rest-integration-20261112`.
- Dateiscope: `src/engine/compliance-sunday-holiday-rest.ts`, neue Kalender-/Intervall-Helfer und deren Tests, gegebenenfalls ergänzte bestehende Ruhezeit-Tests, erzeugte `analysis-cache-version.generated.ts`, die exakt zugeordneten Einträge in `releases/testflight/build-9.reviewed-changes.json` und dieses Dokument. Maximal 15 Dateien; keine native Konfiguration oder Paketänderung.
- Abnahme: Gleiche vollständige Fach-Ergebnisse gegen den eingefrorenen Pilot und den vorherigen Engine-Stand, Mitternacht/Sommerzeit/Jahreswechsel/überlappende Intervalle, begrenzte Generator-Schritte, passende Tests und `npm.cmd run verify:fast`. Lokaler TestFlight-Quellvergleich muss bestehen.
- Geräteabnahme: Unveränderte gespeicherte Jahreswerte nach Neustart, eine geänderte Dienst-Endzeit und Wechsel zwischen Monaten/Jahren auf dem iPhone prüfen. PC-Zeiten ersetzen diesen Nachweis nicht.

## Ansatz

Innere Schleifen verwenden ganzzahlige ISO-Kalendertage. Bounded gemeinsame Caches speichern Kalenderdaten und tatsächliche Tagesgrenzen getrennt nach Zeitzone. Die Tagesgrenzen bleiben Temporal-Berechnungen mit der bisherigen Disambiguierung; ein Tag wird nicht pauschal als 24 Stunden behandelt.

Normalisierte Arbeitsintervalle werden einmal indiziert. Vorheriges Arbeitsende und nächster Arbeitsbeginn lassen sich danach über binäre Suche ermitteln, statt die gleiche Liste für jeden Kandidaten vollständig zu scannen. Die Zuordnung nach Ruhequalität, Kalendertagsabstand und früherem Tag sowie die Dienstnachweise bleiben erhalten.

Kooperative Generator-Grenzen bleiben bestehen. Primitive Tagesbesuche und vorbereitete Intervall-/Kandidatenarbeit werden in größeren begrenzten Portionen verarbeitet. Der äußere Scheduler und die gespeicherten Auswertungen bleiben unverändert.

Der berechnungsbezogene Quellvertrag wird regulär neu erzeugt. Damit darf nach dem ersten Update einmalig eine Neuberechnung nötig sein; spätere unveränderte Neustarts verwenden weiterhin den gespeicherten Stand. Der TestFlight-Baselineanker und seine Geräteabnahme werden nicht geändert.
