# Widget-Aufbereitung ohne langen JavaScript-Block

Ziel: Den gemessenen synchronen Widget-Block von 427–442 ms verkürzen, verbleibende Vorbereitung kooperativ aufteilen und unveränderte Widget-Inhalte wiederverwenden. Plattform: iOS-Preview, Expo SDK 57, bestehende Build-54-Runtime. Ausgangspunkt ist exakt die veröffentlichte Preview-OTA `01a1ea29-d511-7766-8fb3-d797e069aa45` auf `master` 1d1b6ca8 einschließlich ihrer 17 noch nicht committeten Dateien.

Nicht-Ziele: Rechenregeln, Widget-Gestaltung, gespeichertes Format, Datenbank, native Konfiguration, Rust-Schnittstellen, Abhängigkeiten oder TestFlight ändern. Kein FPS-Limit. Autorisiert sind diese Korrektur und ihre iOS-Preview-OTA; kein Commit, Push oder nativer Build.

Dateiscope: Widget-Timeline, Widget-Highlights, deren kooperative Vorbereitung, Widget-Synchronisierung, property-list-Konvertierung im vorhandenen iOS-Adapter, zugehörige Unit-/Komponententests, numerische Diagnosebeschreibung, dieses Dokument und exakte Quellhashes im bestehenden TestFlight-Abgleich. Höchstens 15 neue Aufgabendateien; die vorherige veröffentlichte Quelle bleibt separat erhalten.

Abnahme vor Veröffentlichung: gleiche vollständige Widget-Inhalte wie im Vorgänger bei Monats-/Jahreswechsel, Sommerzeit, Schichten, Terminen, Farben, Foto, geteilten Kalendern und deren Ablauf; keine veraltete Veröffentlichung bei neuen Daten, Profilwechsel oder Unmount; korrekte Aktualisierung bei Mitternacht und Rückkehr; unveränderte native Runtime und Assets. Fokussierte Tests, `verify:fast`, Produktions-Export und genauer Vorgänger-/Quell-/CDN-Abgleich müssen bestehen.

Geräteabnahme nach OTA: dieselbe Diagnosestrecke, zusätzlich Widget-Inhalte und Aktualisierung nach Dienst-/Terminänderung, Profilwechsel und App-Rückkehr prüfen. Synchronen Höchstwert der Aufbereitung und Publikation sowie UI-Intervalle über 34/50 ms vergleichen. Desktop-Zeiten, Exporte und Tests ersetzen diesen Nachweis nicht. Ein einzelner Arbeitsschritt und die native Veröffentlichung sind nicht beliebig unterbrechbar; deren verbleibende Kosten müssen im neuen Bericht sichtbar bleiben.

## Umsetzung und lokaler Nachweis

Identische Tagesdaten, Schichtdarstellungen und Monatsraster werden innerhalb genau einer Timeline wiederverwendet. Die Gültigkeit geteilter Kalender und monatsabhängige URLs sind Teil der Wiederverwendung. Neue Aufrufe beginnen mit leeren internen Daten-Caches.

Die App bereitet Feiertagsmonate, Einträge und Tagesdaten in Generator-Schritten vor. Im Vordergrund gibt sie nach etwa 4 ms oder spätestens 32 Schritten wieder an den Host ab; der einzelne Schritt bleibt unteilbar. Im Hintergrund wird die aktuelle Vorbereitung ohne Warten auf Idle-Callbacks abgeschlossen. Nach jedem Wiedereinstieg wird die Aktualität des Auftrags geprüft. Die bestehenden synchronen Datenfunktionen bleiben als Adapter für reine Aufrufer und Release-Verträge erhalten.

Ein bereits erfolgreich veröffentlichtes Widget wird bei identischen abgefragten Einträgen, unverändertem Profil/Regelresolver, unveränderten geteilten Kalendern, Einstellungen, Hintergrund und demselben lokalen Tag nicht erneut aufgebaut. Nach Fehler, Profilentfernung, neuem Tag oder zurückgestellter Uhr wird korrekt aktualisiert. Die native property-list-Konvertierung verwendet gemeinsame Objekte nur innerhalb derselben Veröffentlichung erneut; keine globalen Inhalts-Caches und keine Formatänderung.

Die Diagnose meldet für `widget-work` Phase 1 die summierte synchrone Arbeit, die Anzahl der Scheiben und deren längste Dauer. Idle-Warten ist darin nicht enthalten. Phase 2 bleibt die gesamte Konvertierung und native Publikation; Phase 4 zählt bekannte unveränderte veröffentlichte Eingaben. Alle Daten bleiben numerisch.

Ein unabhängiger Vergleich mit der vorherigen Implementierung aus `HEAD` prüft 60 Kombinationen aus Datum, Zeitzone, Darstellung, Profilzustand, eigenen Terminen/Diensten und geteilten Kalendern einschließlich ihrer Gültigkeitsgrenzen. Die kompletten Ausgaben sind identisch. Bei 47 synthetischen Diensten benötigt die Timeline allein unter Windows/Node im Median 24,6 ms vorher und 3,7 ms nachher (je 15 Messungen nach Aufwärmen). Diese Zahlen enthalten weder native Publikation noch Feiertagsaufbereitung und sind keine iPhone-FPS-Messung. Benchmark und Vergleichsartefakte liegen unter `C:/Users/veron/.codex/tmp/widget-fluessig-benchmark/`.

Exakter neuer Aufgabenscope:

- `src/features/widgets/calendar-widget-data.ts`
- `src/features/widgets/calendar-widget-data.test.ts`
- `src/features/widgets/calendar-widget-preparation.ts`
- `src/features/widgets/calendar-widget-preparation.test.ts`
- `src/features/widgets/calendar-widget-sync.tsx`
- `src/features/widgets/calendar-widget-sync.component.test.tsx`
- `src/features/widgets/native-calendar-widget.ios.ts`
- `src/features/widgets/native-calendar-widget.component.test.tsx`
- `src/features/widgets/widget-calendar-highlights.ts`
- `src/application/calendar-performance.ts`
- `docs/widget-performance-korrektur.md`
- `releases/testflight/build-9.reviewed-changes.json`

## Erhalt der zwischenzeitlich veröffentlichten Preview

Beim Live-Abgleich war bereits die Header-OTA `01a1ea3b-a254-7d9f-ad0b-88872944dd31` aktiv. Ihre drei eingefrorenen Dateien für Datumspfeile, Header-Abstand und zugehörige Tests werden exakt aus dem verifizierten Auslieferungsartefakt übernommen. Der vollständige Ausgangs-Quellhash stimmt damit mit dieser aktuellen OTA überein. Neuere, noch unveröffentlichte Header-Arbeiten im anderen Checkout bleiben unberührt. Die Widget-Korrektur wird auf diesem erhaltenen Stand erneut geprüft.
