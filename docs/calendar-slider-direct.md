# Kalenderfoto: direkter und fluessiger Regler

## Task-Vertrag, 29.10.2026

Ziel: Die neue Supershift-Aufnahme zeigt direkte, kurze Beruehrungen und einen weich vergroesserten Glasgriff. Die bisherige 350-ms-Haltezeit entfaellt. Beruehren des Griffs aktiviert sofort; der Griff folgt dem Finger kontinuierlich auf dem UI-Thread. Wert und Vorschau bleiben in ehrlichen 10-Prozent-Schritten von 0 bis 100 Prozent, beim Loslassen gleitet der Griff auf den ausgewaehlten Schritt. Glasgriff, Spur und mittiger Wert erhalten Bewegung aus den bestehenden Motion-Tokens.

Plattform: iPhone, Expo ~57.0.31; SDK-57-Dokumentation fuer Gesture Handler, Reanimated und GlassEffect sowie installierte native Gesten-API geprueft. Referenz: ScreenRecording_10-29-2026 13-22-24_1.mp4, 7,64 Sekunden, 1290 x 2796 Pixel. Kontaktbogen lokal angesehen unter artifacts/calendar-slider-direct/contact.jpg. Die dunkle HDR-Konvertierung dient ausschliesslich der Bewegungs-/Formanalyse.

Scope: calendar-image-opacity-control.tsx, zugehoeriger Komponententest und dieses Dokument auf codex/calendar-slider-direct. Basis ist die vollstaendige zuletzt veroeffentlichte Preview-Gruppe 16f14a18-5fbd-424f-ab1a-effdd6fd3895; ihre Kalenderfarben und alle anderen Quellinhalte bleiben erhalten.

Nicht-Ziele: Fotospeicherung, 50-Prozent-Start fuer neue/ersetzte Fotos, gespeicherte Bestandswerte, Navigation, feste Vorschau, Fade, globale Tokens, Fachlogik, native Konfiguration und Abhaengigkeiten veraendern. Freigabe besteht fuer Umsetzung und iOS-Preview-OTA; Git-Lieferung, native Builds und TestFlight sind separate Schritte.

Abnahme: Direkte Aktivierung innerhalb der mindestens 44-pt-Griffflaeche ohne Wartezeit, kein Wertsprung bei kurzem Tippen, ausserhalb des Griffs freies Scrollen, fluessige UI-Thread-Bewegung, 10-Prozent-Werte mit einmaligem Speichern bei Loslassen, Ruecknahme bei Abbruch/Unmount. VoiceOver, 0/100 Prozent, reduzierte Bewegung/Transparenz und Glas-Fallback bleiben erhalten. Fokussierte Tests, verify:fast, iOS-Export, Runtime-/Manifest-/CDN-Pruefung sind erforderlich. Die sichtbare Bewegung und Gestenkonkurrenz brauchen anschliessend reale iPhone-Abnahme.

## Pruefung und Preview-Auslieferung

- 66 gezielte Komponententests bestanden. Finaler `verify:fast` vollstaendig gruen: 511 Vitest-Dateien / 9.901 Tests, 165 Jest-Suites / 1.556 Tests, alle Script-Gates, Typpruefung, Lint, Formatierung und Diff-Pruefung.
- iOS-Hermes-Export mit React Compiler erfolgreich. Zusaetzliche Babel-Pruefung bestaetigt zehn Worklet-Funktionen, keine Halteaktivierung und keine erzwungene JS-Ausfuehrung. Nur zwei Quell-/Testdateien geaendert; die uebrigen 1.867 Quelldateien entsprechen bytegenau der vorherigen Preview. Die 50-Prozent-Fotospeicherung und Kalenderfarben bleiben damit erhalten.
- Veroeffentlicht am 29.10.2026 um 12:44:31 UTC als [Preview-Gruppe 0fd47221-8957-44da-94fe-369c0af9fc18](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/0fd47221-8957-44da-94fe-369c0af9fc18), iOS-Update `01a187b0-c4de-7c7d-97d7-f22f74b5b1d4`.
- Kanal/Branch/Environment `preview`, Variante `internal`. Frisch berechneter Environment-Fingerprint und Preview Build 44 stimmen ueberein: `b99c3cf0dd56e6b1bb126d195f21c665de57760b`. Die neue Gruppe steht direkt vor ihrem erhaltenen Vorgaenger `16f14a18-5fbd-424f-ab1a-effdd6fd3895`.
- Tatsachliches Preview-Manifest und CDN antworten HTTP 200. Lokales, Manifest- und CDN-Bundle haben identische 12.234.868 Bytes und SHA-256 `30edb5ae5de54bf5205827ff227b7aaab8cd2f41d9036d2a70bb6655aef2c552`. Alle 1.869 Quelldateien und 55 Exportdateien bleiben nach Veroeffentlichung unveraendert.
- Nachweise liegen unter `artifacts/calendar-slider-direct/`: Test-/Exportlogs, Fingerprint, Hashlisten, Preservation-Proof, EAS-Metadaten und `preview-ota-delivery-proof.json`. Keine Git-Lieferung, kein nativer Build und keine TestFlight-OTA fuer diese Korrektur.

Geraeteabnahme offen: Preview-App vollstaendig schliessen, oeffnen und 15 Sekunden warten, nochmals schliessen und oeffnen. Anschliessend kurzes Beruehren, direktes Ziehen, weiches Einrasten, 0/100 Prozent, Scrollen neben dem Griff und einen Geste-Abbruch pruefen. Technische Auslieferungsnachweise bestaetigen nicht das sichtbare Bediengefuehl auf dem iPhone.

## Bestaetigung und Lieferfreigabe

Nach Veroeffentlichung dieser Preview antwortet der Nutzer: "Perfekt jetzt comit push pr merge und TestFlight ota". Damit ist der Slider-Stand bestaetigt und die Git-/PR-/Merge-/Production-OTA-Lieferung ausdruecklich freigegeben. Geraetemodell und iOS-Version wurden nicht genannt; ein zusaetzlicher Screenshot ist nicht vorhanden. Die anschliessende TestFlight-Geraeteabnahme bleibt ein eigener Schritt.

Liefervertrag: aktuelles master nach PR #332 als Basis; nur die fehlenden Slider-/Fotospeicher-Aenderungen, ihre Tests und die beiden Slider-Dokumente liefern. Bereits gemergte Kalenderfarben bleiben bytegleich. Alle sieben PR-CI-Gates muessen bestehen; vor und nach Merge werden Dateiscope, Head/Base und Tree-/Blob-Paritaet geprueft. Die Production-OTA muss zur installierten Build-8-Runtime passen und den bestaetigten Preview-App-Code erhalten. Native Dateien, Pakete, Apple-Gruppen und Beta-Metadaten bleiben ausserhalb dieses Auftrags.
