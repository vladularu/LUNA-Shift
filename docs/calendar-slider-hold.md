# Kalenderfoto: gehaltenen Regler aus der Referenz uebernehmen

## Task-Vertrag, 29. Oktober 2026

Ziel: Der Deckkraftregler wird erst nach kurzem Gedrueckthalten aktiv. Er rastet beim Ziehen und bei VoiceOver in Zehn-Prozent-Schritten von 0 bis 100 Prozent ein. Der kleine ovale Griff vergroessert sich waehrend der Bedienung zu einer transparenten Kapsel. Nur der aktuelle Prozentwert steht mittig; die beiden Endbeschriftungen entfallen. Ein neu ausgewaehltes oder ersetztes Foto startet nach erfolgreichem Speichern immer mit 50 Prozent.

Referenz: `ScreenRecording_10-29-2026 11-58-22_1.mp4`, 7,67 Sekunden, 1290 x 2796 Pixel, sowie das beigefuegte Foto der aktuellen Seite. Kontaktbogen und Einzelbilder sind unter `artifacts/calendar-slider-hold/reference/` lokal extrahiert und angesehen. Die Aufnahme zeigt einen kleinen ovalen Griff im Ruhezustand und eine breitere Glaskapsel waehrend des Ziehens. Referenzfarben werden nicht global uebernommen; bestehende Palette und Systemkomponenten bleiben massgeblich.

Plattform und Basis: iPhone, Expo `~57.0.31`; SDK-57-Dokumentation fuer Gesture Handler, Reanimated und GlassEffect gelesen. Sauberer Ausgangsstand `adb51cf` auf aktuellem `origin/master`, eigener Branch `codex/calendar-slider-hold`.

Scope: `calendar-image-opacity-control.tsx`, `calendar-background-control.tsx`, `calendar-background-preferences.tsx`, `calendar-background-storage.ts`, deren bestehende Tests, ein eigener Slider-Komponententest und dieses Dokument. Vorhandene native Gesture-Handler-, Reanimated- und GlassEffect-Bausteine werden wiederverwendet. Keine neue App-Abhaengigkeit und keine native Konfiguration. Die Speicherschnittstelle uebergibt die optionale Deckkraft zusammen mit den beiden Fotoreferenzen an dieselbe Transaktion.

Nicht-Ziele: Kalendervorschau, Fade, Navigation, globale Tokens, Berechnungen, Cloud-Format oder gespeicherte Bestandswerte veraendern. Die fruehere Git-/TestFlight-Lieferung ist abgeschlossen; dieser neue Implementierungsauftrag enthaelt noch keine neue Git-, Build- oder OTA-Veroeffentlichung.

## Abnahme

- Kurzes Tippen und Wischen vor Ablauf der Haltezeit veraendern weder Vorschau noch gespeicherten Wert. Vertikales Scrollen bleibt vor Aktivierung moeglich.
- Nach 350 ms Halten wird der Griff aktiv. Bewegung rastet in 10-Prozent-Stufen ein; die Vorschau folgt. Gespeichert wird einmal beim Loslassen. Halten ohne Bewegung schreibt nichts.
- Abbruch, Unterbrechung und Unmount stellen den gespeicherten Wert wieder her. Der letzte gueltige Wert wird bei einem Speicherfehler beibehalten.
- VoiceOver passt ohne erforderliches Halten in Zehn-Prozent-Stufen an. Alte Zwischenwerte bleiben beim Laden unveraendert und werden erst bei einer bewussten Anpassung auf die naechste Stufe gesetzt.
- Neue und ersetzte Fotos und ihre 50-Prozent-Deckkraft werden atomar gespeichert. Abbruch oder Fehler behalten das alte Foto und seinen Wert. Neustart sowie Entfernen/Rueckgaengig erhalten den gewaehlten Wert; ausdruecklicher Reset behaelt das bestehende Reset-Verhalten.
- Hell/Dunkel, grosse Schrift, mindestens 44 pt Touchflaeche, reduzierte Bewegung und reduzierte Transparenz werden beruecksichtigt. Fuer nicht verfuegbares natives Glas bleibt eine lesbare Kapsel aus den vorhandenen Systemfarben.
- Fokussierte Tests und `npm.cmd run verify:fast` sind auszufuehren. Gesten, Glasdarstellung und Scrollen brauchen anschliessend eine echte iPhone-Abnahme; automatische Tests ersetzen sie nicht.

## Prüfstand

Die 94 fokussierten Unit-Tests und 64 fokussierten Komponententests bestehen. Der vollständige finale Durchlauf `npm.cmd run verify:fast` besteht mit 511 Vitest-Dateien/9.899 Tests und 165 Jest-Suites/1.549 Tests sowie sämtlichen nachfolgenden Script-Gates, Typprüfung, Lint, Formatierung und Diff-Prüfung. Protokoll: `artifacts/calendar-slider-hold/verify-fast.log`.

Der iOS-Export mit Hermes und React Compiler ist erfolgreich erstellt. Die Gestenregistrierung ist von den verzögerten React-Ereignis-Callbacks getrennt; Reanimated verwendet die Compiler-konformen `get`-/`set`-Methoden. Die Systemvorgaben für reduzierte Bewegung und Transparenz bleiben wirksam. Der Graft-Graph wurde aktualisiert.

Die 1.868 Quell-/Konfigurationsdateien außerhalb Markdown und das iOS-Bundle sind unverändert geprüft. Export: 12.227.007 Bytes, SHA-256 `3b1dfc3b42580774a0e44d1f48c3da96254b2c844347360f4a0c6a53ba2b581d`; Nachweis `artifacts/calendar-slider-hold/candidate-proof.json`. Das Bundle enthält die neuen Regler- und Wertanzeigen. Paket-/Lockdateien, native Konfiguration, globale Tokens, feste Vorschau und die bestehende Rand-Zurückgeste sind unverändert. Der lokale Scope umfasst neun Dateien.

Ein eigener Screenshot oder Gerätenachweis der neuen Implementierung liegt noch nicht vor. Auf dem iPhone sind Halteaktivierung, vertikales Scrollen vor Aktivierung, ovaler/gläserner Griff in beiden Erscheinungsbildern, 0/100 Prozent, Abbruch und Neustart sowie neue/ersetzte Fotos mit 50 Prozent zu prüfen. Der neue Stand liegt lokal auf `codex/calendar-slider-hold`; eine neue OTA-/Git-Veröffentlichung wurde nicht ausgeführt.

## Preview-OTA ausdrücklich beauftragt

Anschließend hat der Nutzer mit „Ota preview“ ausschließlich die iOS-Preview-Veröffentlichung freigegeben. Bei der frischen Kanalprüfung wurde die inzwischen veröffentlichte Gruppe `36b8b9db-0683-486c-96d4-476eb886a707` mit Feiertagsfarben und kräftigeren Wochenenden festgestellt. Diese bereits ausgelieferte Funktion muss im neuen Gesamtpaket erhalten bleiben.

Der erweiterte Lieferumfang ist in zwei Arbeitspakete getrennt: (1) den oben geprüften Slider in neun Dateien und (2) die unveränderte Übernahme der veröffentlichten Kalender-/Präferenz-/Backup- und Testdateien. Die 1.868 eingefrorenen Quelldateien des veröffentlichten Stands wurden gegen dessen Source- und Auslieferungsnachweise abgeglichen (Bundle-SHA-256 `33ea6bd0683ef1ff2198a9111e35d0be9f52f31d9f32735eee763e4eebce328e`). Gegenüber dem gemeinsamen `master`-Stand wurden 22 Dateien bytegleich übernommen. Der einzige überlappende Komponententest wurde konfliktfrei mit beiden Änderungen zusammengeführt. Nachweis: `artifacts/calendar-slider-hold/preview-ota/integration-receipt.json`.

Die ursprünglichen Slider-Nachweise bleiben unter `artifacts/calendar-slider-hold/` erhalten. Für den kombinierten Stand folgen ein eigener vollständiger Projektcheck, der Export im tatsächlichen Preview-Environment, erneute Runtime-Prüfung und Auslieferungsnachweise unter `preview-ota/`. Native/Widget-Dateien, Pakete und Konfiguration werden dabei nicht geändert. Eine Git-, native Build- oder Production-/TestFlight-Veröffentlichung ist nicht Teil dieser neuen Freigabe.

## Kombinierte iOS-Preview veröffentlicht

- [Preview-Gruppe 16f14a18-5fbd-424f-ab1a-effdd6fd3895](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/16f14a18-5fbd-424f-ab1a-effdd6fd3895), iOS-Update `01a1878e-3611-77f2-bc6d-6e371055ee10`, erstellt am 29.10.2026 um 12:06:46 UTC.
- Kanal, Branch und Environment `preview`, Variante `internal`. Build-Profil-, Environment- und kombinierter Environment-Fingerprint passen zu Preview Build 44: `b99c3cf0dd56e6b1bb126d195f21c665de57760b`.
- Kombinierter `verify:fast` vollständig grün: 511 Vitest-Dateien/9.901 Tests, 165 Jest-Suites/1.555 Tests und sämtliche Script-Gates, Typprüfung, Lint, Formatierung und Diff-Prüfung. Zusätzlich 65 gezielte Komponententests grün.
- 1.869 Quelldateien außerhalb Markdown und alle 55 Exportdateien nach Veröffentlichung unverändert. Sieben Slider-Quelldateien bleiben bytegleich, ein Komponententest enthält beide Änderungen; 22 bereits veröffentlichte Dateien sowie 29 Widget-/Native-/Konfigurationsdateien bleiben bytegleich zu ihren jeweiligen geprüften Ständen.
- Vor Upload war Gruppe `36b8b9db-0683-486c-96d4-476eb886a707` weiterhin aktuell. Nach Upload steht die neue Gruppe vor genau dieser Vorgängergruppe; kein zwischenzeitliches Preview wurde ausgelassen.
- Tatsächlich ausgeliefertes Preview-Manifest und CDN: HTTP 200. Bundle: 12.229.605 Bytes. Lokale, Manifest- und CDN-SHA-256 identisch: `a2d0a83c0d61cabb86bcdf3a871a3ead826525850da7528ae28e9a54e103f23a`.
- Nachweise: `preview-ota-delivery-proof.json`, `preservation-proof.json`, `verify-fast-result.json`, beide Kandidaten-Hashlisten, Fingerprints, veröffentlichte Metadaten und `updates-after.json` unter `artifacts/calendar-slider-hold/preview-ota/`. Keine Git-Lieferung, kein nativer Build und keine neue Production-/TestFlight-OTA.

Die echte Geräteabnahme steht aus. Preview vollständig schließen, öffnen und etwa 15 Sekunden warten, erneut schließen und öffnen. Danach Halten, Ziehen in beide Richtungen, 0/100 Prozent, zentralen Wert, Scrollen vor Aktivierung, Abbruch und neue Fotos mit 50 Prozent sowie die erhaltenen Kalenderfarben prüfen.
