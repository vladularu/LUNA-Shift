# Auswahlleisten passend zu den Karten

## Task-Vertrag, 29.10.2026

Ziel: Die in den drei iPhone-Screenshots gezeigten Auswahlleisten sollen in Form, Hoehe und Abstaenden zu den vorhandenen Karten passen. Betroffen sind beispielsweise Anzahl/Stunden, Hell/Dunkel/System, LUNA Standard/Eigenes Foto und Name/Kuerzel/Symbol. Umsetzung in der gemeinsamen SelectionControl, einschliesslich ihres SegmentedControl-Wrappers. Karten mit 16 pt Radius erhalten stimmige untergeordnete Controls mit 12 pt aussen und 8 pt fuer die aktive Auswahl, abgeleitet aus bestehenden Tokens.

Masse: Horizontale Leisten werden von 52 auf mindestens 44 pt Gesamthoehe reduziert. Jede einzelne Option behaelt ihre mindestens 44 pt grosse Touchflaeche; die aktive sichtbare Flaeche wird vertikal um 4 pt eingerueckt. Kompakte Ansichtsumschalter haben 8 statt 12 pt seitlichen Innenabstand. Bei grosser Schrift bzw. schmaler Anzeige bleiben die bisherigen gestapelten Optionen mit natuerlich wachsender Hoehe erhalten.

Plattform: iPhone, Expo ~57.0.31. SDK-57-Dokumentation vor Aenderung geprueft. Branch codex/card-selection-geometry auf master 592154b. Scope: src/ui/selection-control.tsx, bestehender Komponententest, Integrationstests appearance-screen.component.test.tsx und tariff-assessment-screen.component.test.tsx sowie dieses Dokument. Bestehende Tests auf ihre weiterhin gueltigen Funktions-, Farb-, VoiceOver- und Dynamic-Type-Vertraege pruefen.

Nicht-Ziele: Karten selbst, globale Tokens und Palette, unabhaengige Filterchips, akzeptierte Gehaltskarten, Tabs/Zurueck-Navigation, Slider-Gesten, Speicherung und Fachberechnungen veraendern. Die globale Pillengeometrie wird nicht geaendert, weil sie auch eigenstaendige Filterchips und andere bereits akzeptierte Ansichten steuert. Die optionale Rueckfrage zur gläsernen Zurueck-Leiste ist von dieser unabhaengigen Anpassung getrennt.

Abnahme: Gleiche Eckenfamilie und durchgaengige Groessen in den gezeigten Auswahlleisten; weiterhin mindestens 44 pt Touchflaechen, unveraenderte Radio-/Tab-Semantik, deaktivierte Optionen und grosse Schrift ohne abgeschnittene Labels. Fokussierte Komponententests und npm.cmd run verify:fast. Reale iPhone-Sichtpruefung bleibt erforderlich. Dieser neue Auftrag erlaubt die Implementierung; er enthaelt keine neue Git- oder OTA-Veroeffentlichung.

## Pruefergebnis

38 gezielte Komponententests bestehen. Der finale vollstaendige verify:fast-Durchlauf ist gruen: 511 Vitest-Dateien / 9.901 Tests, 165 Jest-Suites / 1.556 Tests, alle Script-Gates, Typpruefung, Lint, Formatierung und Diff-Pruefung. Die bestehenden Geometrie-Erwartungen in drei Tests wurden an die freigegebene Form angepasst; Verhalten, Kontrast und Accessibility werden weiterhin geprueft.

Ein lokaler interaktiver Formvergleich liegt unter artifacts/card-selection-geometry/index.html und wurde im Browser angesehen. In allen vier dargestellten Gruppen wurden 44 px Gesamt-/Optionshoehe und 12/8 px Radien gemessen. Dieser HTML-Vergleich erklaert die Geometrie und ist ausdruecklich kein iPhone-App-Screenshot. Die echte iPhone-Sichtpruefung steht aus. 1.869 Quell-/Konfigurationsdateien sind eingefroren; Scope und Nachweise liegen unter artifacts/card-selection-geometry/. Keine Git-Lieferung und keine neue OTA fuer diese Anpassung.

## Freigegebene iOS-Preview-OTA

Auf den anschliessenden ausdruecklichen Auftrag "Ota preview" wurde der unveraenderte gepruefte Stand am 29.10.2026 um 14:42:37 UTC veroeffentlicht: [Preview-Gruppe 8f40477b-0fed-4d78-b13e-e1d218de7890](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/8f40477b-0fed-4d78-b13e-e1d218de7890), iOS-Update 01a1881c-e537-724e-9909-f34d7689327a. Kanal, Branch und Environment preview; Variante internal. Frisch berechneter Fingerprint und Preview Build 44 passen zusammen: b99c3cf0dd56e6b1bb126d195f21c665de57760b.

Die vorherige Preview 0fd47221 bleibt vollstaendig erhalten, ausgenommen SelectionControl und drei dazugehoerige Testdateien. 1.865 andere Quell-/Konfigurationsdateien sind bytegleich. Vor und nach Upload steht die neue Gruppe direkt vor diesem Vorgaenger. Alle 1.869 Quelldateien und 55 Exportdateien sind nach Veroeffentlichung unveraendert. Das tatsaechliche Preview-Manifest und der CDN-Download antworten HTTP 200; lokaler, Manifest- und CDN-Hash stimmen ueberein: SHA-256 7cca1bde81f20440336dbdda59db3e3a64860d572ccb94428f1984bf37774a85 bei 12.234.982 Bytes. Nachweise liegen unter artifacts/card-selection-geometry/preview-ota/.

Keine Git-Lieferung, kein nativer Build und keine Production-/TestFlight-OTA fuer diese Anpassung. Die neue iPhone-Sichtpruefung steht aus: Preview-App vollstaendig schliessen, oeffnen und 15 Sekunden warten, nochmals schliessen und oeffnen. Danach die Auswahlleisten in Auswertung und Kalendergestaltung sowie grosse Schrift pruefen.

## Preview-Abnahme und Freigabe zur Beta-Lieferung

Nach dieser Preview bestaetigte der Nutzer am 29.10.2026: "Perfekt jetzt comit push pr merge und TestFlight ota". Damit ist der gezeigte Auswahlleisten-Stand in Preview akzeptiert und die Lieferung dieses fuenf Dateien umfassenden Scopes ausdruecklich freigegeben: Commit, Branch-Push, PR, Merge nach erfolgreicher PR-CI und anschliessende iOS-Production-OTA fuer die bestehende TestFlight-Beta. Ein genaueres iPhone-Modell oder eine iOS-Version wurden nicht angegeben; eine gesonderte Abnahme bei maximaler Schriftgroesse wurde nicht behauptet.

Die Umsetzung bleibt unveraendert. Vor dem Merge werden PR-Head, aktueller master, die vollstaendige Dateiliste und alle sieben CI-Gates geprueft. Nach dem Merge muessen Kandidat und Merge denselben Baum sowie dieselben fuenf Datei-Blobs besitzen. Vor der OTA werden Production-Environment, Variante production, Kanal/Branch production und die Runtime des bestehenden TestFlight-Builds erneut abgeglichen; danach werden Update-Metadaten, Manifest und ausgelieferter Bundle-Hash geprueft. Es ist kein nativer Build erforderlich. Bestehende Testergruppen und Beta-Metadaten bleiben erhalten. Die anschliessende TestFlight-Geraeteabnahme bleibt ein eigener Schritt.
