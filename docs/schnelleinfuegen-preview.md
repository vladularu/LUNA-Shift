# Schnelleinfügen: abgenommener Stand

## iPhone-Abnahme und Lieferfreigabe

Der Nutzer hat die finale Preview am 28.10.2026 mit „Ja perfekt“ bestätigt und anschließend Commit, PR/Merge und OTA für TestFlight freigegeben. Abgenommene Preview-Gruppe: `a3fb2270-c1a8-4889-97b8-fb901793bc19`, Quellstand `2b03dcee79a0d6b2f0580840e0bd1e2c82992f4b`. Damit sind kompakte transparente Felder, einheitlich dünne Konturen, Zeiten und sanfte Wahl/Abwahl ohne Icon-Skalierung, die Einfüge-/Entfernen-Animation und der Neustart ohne alte Tagesmarkierung auf dem iPhone bestätigt.

Die Lieferung umfasst genau 15 Dateien relativ zu `master`: Kalender-UI, zugehörige Tests, zwei JavaScript-neutrale TypeScript-Korrekturen in Routen-/Icon-Typen und diese Dokumentation. Ziel ist PR-CI, Merge nach `master` und anschließend ein iOS-OTA auf `production` mit `APP_VARIANT=production` für TestFlight Build 8. Der aktuelle Build-Fingerprint und der neu berechnete Production-Fingerprint stimmen überein: `ab053760e06bdf85a83f64fc65cfee0aab41fe12`. Die TestFlight-Geräteabnahme bleibt ein eigener Schritt nach der Veröffentlichung. Der abgenommene Preview-Stand bleibt die visuelle Referenz für diesen Nutzerfluss.

## Tagesmarkierung beim erneuten Start zurücksetzen

Ziel: Die schwarze Datumsmarkierung des zuletzt angetippten Tages wird beim erneuten Öffnen von Schnelleinfügen nicht wieder eingeblendet. Beim Start wird die Sichtbarkeit der vorigen Auswahl zurückgesetzt. Ein neuer Tipp im laufenden Modus darf den Tag weiterhin markieren. Die unabhängige heutige Datumsmarkierung bleibt erhalten.

Scope: Kalenderbildschirm, dessen Komponententest und diese Dokumentation; drei Dateien. Zielplattform: bestehender iOS-Preview-Build 44. Vorlagen, Speichern, Datumswert für Editoren, Kalendergestaltung, Animationen und native Konfiguration bleiben erhalten. Fortgeltende Freigabe für Umsetzung und Preview-OTA. Abnahme: Tag antippen, Planung beenden und erneut starten zeigt keine alte Auswahl; der nächste Tagestipp wird wieder markiert. Beide Fälle mit und ohne gewählte Vorlage sowie die weiterhin sichtbare heutige Datumsmarkierung prüfen. Die aktuelle Gestaltung wurde vom Nutzer mit „Super“ bestätigt; diese Korrektur betrifft nur das Wiederauftauchen der alten Markierung.

Prüfung: 58 fokussierte Komponententests bestanden. `npm.cmd run verify:fast` vollständig bestanden: 9.838 Unit-Tests in 508 Dateien, 1.506 Komponententests in 163 Dateien und alle zusätzlichen Projektchecks. Im ersten Gesamtlauf lief der unveränderte Worklet-Serialisierungstest des Diensteditors in sein Zeitlimit; die Einzelprüfung und die vollständige Wiederholung bestehen ohne Änderung von Quellcode oder Zeitlimits. Der interne iOS-Fingerprint bleibt `b99c3cf0dd56e6b1bb126d195f21c665de57760b`. Protokolle: `C:/Users/veron/.codex/tmp/quick-entry-selection-reset-20261028/`. Die Sichtprüfung dieser Korrektur auf dem iPhone wurde anschließend durch den Nutzer bestätigt.

Die [iOS-Preview mit zurückgesetzter Tagesmarkierung](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/a3fb2270-c1a8-4889-97b8-fb901793bc19) wurde am 28.10.2026 um 21:47 Uhr veröffentlicht, Code-Commit `2b03dcee79a0d6b2f0580840e0bd1e2c82992f4b`, Update-ID `01a18444-2734-76cc-9b5a-1ea57bf150ac`. Preview liefert die interne Variante zur passenden Runtime. Manifest und CDN-Bundle antworten mit HTTP 200; das ausgelieferte Bundle stimmt mit lokalem Export und Manifest-Hash überein: SHA-256 `b903d660b12fa87d1bb31fad442ac65e96b889ad00586347d9817a10d8a15a38`. Geräteprüfung: nach Update einen Tag antippen, Schnelleinfügen beenden und erneut öffnen; nur die heutige Datumsmarkierung bleibt vor dem nächsten Tagestipp sichtbar.

Die nachfolgenden Abschnitte dokumentieren frühere Iterationen.

## Feinschliff nach iPhone-Video vom 28.10., 20:35 Uhr

Ziel: Der zuletzt angetippte Tag erhält keinen dauerhaft dickeren Platzhalterrahmen oder abweichende Füllung mehr. Alle leeren Felder bleiben bei einem Punkt Rahmenbreite und derselben Themenfläche. Deren Deckkraft sinkt von 60 auf 25 Prozent; die Kontur bleibt unverändert erkennbar.

Das Video zeigt eine kurz unscharfe Kontur am unteren Dienst-Icon. Die Kachel hatte zwei überlagerte Skalierungen: beim Drücken und bei der Auswahl. Beide entfallen lokal für diese Kachel. Icon und Beschriftung behalten ihre Größe; sanftes Anheben, Zurückgleiten und Öffnen/Schließen der Zeiten bleiben erhalten. Kein Austausch von Symbolen, keine globale Änderung an Icons oder Druckanimationen.

Scope: bestehender iOS-Preview-Build 44, zwei UI-Dateien, deren zwei Komponententests und diese Dokumentation. Daten, Speichern, Kalender-Einfügeanimation und native Konfiguration bleiben erhalten. Umsetzung und Preview-OTA sind durch die fortgeltende Freigabe gedeckt. Abnahme: nach Tippen/Entfernen/Wechsel des Tages keine zurückbleibende dicke Kontur; transparentere Füllung in Hell/Dunkel; ruhiges Icon bei Wahl/Abwahl mit weiterhin sanftem Hub. Die erneute Sichtprüfung auf dem iPhone folgt nach der Veröffentlichung.

Prüfung: `npm.cmd run verify:fast` vollständig bestanden: 9.838 Unit-Tests in 508 Dateien, 1.504 Komponententests in 163 Dateien und alle zusätzlichen Projektchecks. Vier fokussierte Kalender-/Planungssuiten bestehen mit 87 Tests. Regressionen prüfen den identischen dünnen Rahmen samt Füllung vor/nach dem Tageswechsel sowie die Auswahlbewegung ohne Skalierung und ohne skalierende Druck-Handler. Der neu berechnete interne iOS-Fingerprint bleibt `b99c3cf0dd56e6b1bb126d195f21c665de57760b` und passt zu Build 44. Protokolle und Videoausschnitte: `C:/Users/veron/.codex/tmp/quick-entry-polish-20261028/`. Die erneute Sichtprüfung auf dem iPhone bleibt offen.

Die [iOS-Preview mit Feinschliff](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/6e3e4ed4-3e28-47e7-b2dd-cd6e8a1a2b78) wurde am 28.10.2026 um 21:29 Uhr veröffentlicht, Code-Commit `98d5e88fa0f32ddeb0b3468eabd2e961aefdfe2d`, Update-ID `01a18433-c98d-713e-a8e1-3af057073697`. Der echte Preview-Kanal liefert dieses Update als interne Variante zur passenden Runtime. Manifest und CDN-Bundle antworten mit HTTP 200; der ausgelieferte Bundle-Hash stimmt mit lokalem Export und Manifest überein: SHA-256 `7ccc1c853bd61970b1566c163d69758827011bb11afc90b84b8519767c768b1f`. Geräteabnahme dieser Iteration offen.

Die nachfolgenden Abschnitte dokumentieren frühere Iterationen.

## Zweite Korrektur nach iPhone-Foto vom 28.10., 20:05 Uhr

Ziel: Große Tagesrahmen durch gut erkennbare Platzhalter direkt auf Diensthöhe ersetzen. Ein voll deckender Rahmen und eine zu 60 Prozent deckende Themenfläche halten die kompakten Felder auch vor dem Kalenderfoto sichtbar. Die gesamte Tageszelle bleibt als Tippfläche erhalten; die Datumsmarkierung bleibt unverändert. Keine zusätzliche Safe-Area-Abdeckung.

Die untere Dienstvorlage hebt sich bei Auswahl um vier Punkte leicht an, vergrößert sich behutsam und öffnet ihre Uhrzeiten über 240 ms. Bei Abwahl gleitet alles mit derselben Kurve zurück. Die Zeitspalte bleibt für die Rückbewegung montiert und wird erst räumlich eingeklappt; VoiceOver erhält unmittelbar den richtigen Auswahlzustand. Schnelles Wechseln kehrt die laufende Bewegung um. Reduzierte Bewegung verwendet keine Verschiebung oder Skalierung. Die bestätigte Einfüge-/Entfernen-Animation im Kalender bleibt erhalten.

Nicht-Ziele: Datenbank, Speichern, Berechnung, native Konfiguration, globale Farben und andere Ansichten. Zielplattform: iOS Preview, bestehender Build 44. Dateiscope: gemeinsame Kalenderansicht, Vorlagenkachel und -leiste, zugehörige Komponententests und diese Notiz; sechs Dateien. Umsetzung und erneutes Preview-OTA folgen der fortgeltenden Freigabe.

Abnahme: Kompakte Felder stehen unter dem Datum auf Eintragshöhe, bleiben in Hell/Dunkel lesbar und behalten die große Tippfläche. Wahl, Abwahl und direkter Vorlagenwechsel bewegen sich sanft vorwärts/rückwärts, einschließlich der Uhrzeiten. Prüfung auf dem iPhone nach Veröffentlichung offen.

Prüfung: `npm.cmd run verify:fast` vollständig bestanden, einschließlich 9.838 Unit-Tests in 508 Dateien, 1.504 Komponententests in 163 Dateien und sämtlicher zusätzlicher Projektchecks. Die vier fokussierten Kalender-/Planungssuiten bestehen mit 87 Tests. Der neu berechnete interne iOS-Fingerprint bleibt `b99c3cf0dd56e6b1bb126d195f21c665de57760b` und stimmt mit Build 44 sowie der vorherigen Preview überein. Protokolle: `C:/Users/veron/.codex/tmp/quick-entry-refinement-20261028/`. Das Nutzerfeedback bestätigt die Kalenderanimation der vorherigen Preview; diese neue Gestaltung und Auswahlbewegung benötigen noch die Sichtprüfung auf dem iPhone.

Die [neue iOS-Preview](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/76ddda8e-1f3a-4e87-83ce-38c9855f5530) wurde am 28.10.2026 um 20:20 Uhr veröffentlicht, Code-Commit `e3e478ac15630a0ade516171ba2fc0e5921ac398`, Update-ID `01a183f5-1cc1-7175-ab0e-9b9c688453f5`. Der echte Preview-Kanal liefert dieses Update als interne Variante zur Runtime von Build 44. Manifest und Bundle antworten mit HTTP 200; der ausgelieferte Bundle-Hash stimmt mit lokalem Export und Manifest überein: SHA-256 `4e3095d318a46e0ace3767c4aa02227bef25f785d4be9c853f99ca6f2952adcf`. Geräteabnahme dieser Iteration offen.

Die nachfolgenden Abschnitte dokumentieren frühere Iterationen.

## Korrektur nach iPhone-Feedback

Ziel: Die ursprünglichen, gut sichtbaren Tagesrahmen und den Bereich hinter der unteren Leiste wiederherstellen. Die hinzugefügte und als störend gemeldete Safe-Area-Abdeckung entfällt. Beginn/Ende an der aktiven Vorlage bleiben erhalten. Ein zweiter Tipp auf dieselbe Vorlage wählt sie wieder ab.

Eine kurze Pop-Bewegung bestätigt die Auswahl einer Vorlage und das Einfügen eines eigenen Dienstes; beim Entfernen blendet der Dienst kurz aus. Diese Bewegung folgt den vorhandenen Motion-Tokens und entfällt bei reduzierter Bewegung zugunsten einer kurzen Überblendung. Initiales Laden und Monatswechsel spielen keine Reihe von Ein-/Ausblendungen ab. Optimistische und gespeicherte IDs derselben Vorlage behalten denselben visuellen Eintrag, damit Speichern die Animation nicht wiederholt.

Nicht-Ziele: Änderungen an Datenbank, Speicherwarteschlange, Berechnungen, globalem Design oder nativen Modulen. Plattform: bestehender iOS-Preview-Build 44. Dateiscope: zwölf Dateien in Kalender-UI, zugehörigen Komponententests und dieser Dokumentation. Umsetzung und erneutes Preview-OTA sind durch die fortgeltende Freigabe des Nutzers gedeckt.

Abnahme: Tagesrahmen vor Foto in Hell/Dunkel erkennbar, keine zusätzliche deckende Safe-Area-Fläche, Vorlage an-/ab-/erneut anwählbar, ohne aktive Vorlage kein Eintragen, kleine Rückmeldung beim Setzen/Entfernen, keine doppelte Animation durch Speichern und Rücksicht auf reduzierte Bewegung. Die finale Sichtprüfung erfolgt auf dem iPhone.

Die Korrektur besteht `npm.cmd run verify:fast` vollständig: 9.838 Unit-Tests in 508 Dateien, 1.499 Komponententests in 163 Dateien und alle zusätzlichen Projektchecks. Die fokussierten Tests prüfen zusätzlich die neue Abwahl, vollständige Tages-Tippflächen, unveränderte Eintragsgeometrie, dieselbe visuelle Instanz nach dem Ersetzen einer vorläufigen ID und Übergänge ohne räumliche Bewegung bei aktivierter Bewegungsreduktion. Der iOS-Fingerprint bleibt `b99c3cf0dd56e6b1bb126d195f21c665de57760b`; native Konfiguration und Abhängigkeiten sind unverändert. Protokolle: `C:/Users/veron/.codex/tmp/quick-entry-correction-20261028/`. Die Geräteabnahme der Korrektur ist noch offen.

Die [korrigierte iOS-Preview](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/9e115a62-b82a-4ddc-be7e-4730df5f05f4) wurde am 28.10.2026 veröffentlicht, Code-Commit `709e6b5ce25e89939a44fe44a6141dfe92765793`, Update-ID `01a183e2-f096-74de-ade8-d7e4fb35467f`. Der echte Preview-Kanal liefert das neue Update zur Runtime von Build 44. Manifest und CDN-Bundle antworten mit HTTP 200. Das Bundle stimmt bytegenau mit dem lokalen Export und mit dem Manifest-Hash überein: SHA-256 `f04fff8f5f04746d4a2faa3ef1069d72d924e1d190870273024456e18b1db219`. Die technische Veröffentlichung ersetzt keine visuelle Abnahme auf dem iPhone.

Reanimated 4.x: [LayoutAnimationConfig](https://docs.swmansion.com/react-native-reanimated/docs/layout-animations/layout-animation-config/), [Custom animations](https://docs.swmansion.com/react-native-reanimated/docs/layout-animations/custom-animations/).

Die folgenden Abschnitte dokumentieren die erste Preview-Iteration als historischen Ausgangspunkt.

## Task-Vertrag

- Ziel: Ruhige Platzhalter auf Diensthöhe, Zeiten an der aktiven Vorlage und ein abgestimmter Wechsel von Navigation zu Einfügeleiste.
- Nicht-Ziele: Keine Änderung an Speichern, Entfernen, Tarifberechnung, globalem Design oder nativen Modulen.
- Zielplattform: iOS Preview, bestehender Build 44.
- Dateiscope: Kalenderdarstellung, Vorlagenleiste, zugehörige Komponententests, zwei reine Typkorrekturen für generierte Expo-Typen und diese Notiz; zehn Dateien.
- Freigabe: Umsetzung und Preview-OTA vom Nutzer ausdrücklich freigegeben.
- Abnahme: Große Tages-Tippflächen erhalten; Zeiten aus der tatsächlichen Vorlage; ganztägige Vorlagen ohne erfundene Uhrzeiten; Navigation vollständig verdeckt, bevor die Leiste sichtbar wird; Öffnen und Schließen mit Reduced Motion; Eintragen und Entfernen mehrerer Tage auf dem iPhone.

## Umsetzung

Der gemeinsame Kalender zeigt freie Eintragsplätze unter den Datumsköpfen. Tagesfelder behalten ihre vollständige Tippfläche. Die aktive Vorlage erhält rechts neben Symbol und Namen Beginn und Ende beziehungsweise den Hinweis „Ganztägig“. Die Auswahlleiste berücksichtigt die breitere aktive Vorlage beim Scrollen. Ein synchronisierter Hintergrund verdeckt die Navigation vor dem Einfahren der Leiste und gibt sie beim Schließen anschließend frei.

Die Detailspalte wächst mit der eingestellten Schriftgröße; Vorlagennamen bleiben umbrechbar. Die beim Browserstart generierten Expo-Typen machten zwei Konflikte im unveränderten Ausgangscode sichtbar. `useDataMonth` behandelt die Routensegmente für die Gruppenprüfung als schreibgeschützte Zeichenketten. Der Icon-Adapter reicht seinen bestehenden Style mit dem passenden SVG-View-Typ weiter. Beide Korrekturen ändern ausschließlich die TypeScript-Typisierung.

Die zusätzliche Browserprüfung war durch „Worker chunk not found“ für den Expo-SQLite-Web-Worker blockiert. Der iOS-Export funktioniert. Die visuelle Geräteabnahme bleibt im Preview auf dem iPhone erforderlich.

Expo SDK 57: [Reanimated](https://docs.expo.dev/versions/v57.0.0/sdk/reanimated/), [Updates](https://docs.expo.dev/versions/v57.0.0/sdk/updates/).

## Prüfung

- `npm.cmd run verify:fast`: vollständig bestanden, einschließlich 508 Unit-Testdateien mit 9.838 Tests und 163 Komponenten-Testdateien mit 1.498 Tests sowie sämtlicher zusätzlicher Projektchecks.
- Fokussierte Kalender-/Leistentests und Schriftgrößenprüfung erfolgreich. Geprüft sind tatsächliche Vorlagenzeiten, ganztägige Vorlagen, Nachtdienste, erhaltene Tages-Tippflächen und Auswahl-/Leistenübergänge.
- Die beiden Typkorrekturen erzeugen nach Entfernung der TypeScript-Typen exakt dasselbe JavaScript wie die Ausgangsdateien.
- Interner iOS-Fingerprint stimmt mit Preview Build 44 überein: `b99c3cf0dd56e6b1bb126d195f21c665de57760b`.
- Vollständige lokale Protokolle und Auslieferungsnachweis: `C:/Users/veron/.codex/tmp/quick-entry-audit-20261028/`.
- Die visuelle Abnahme der finalen OTA auf dem iPhone bleibt offen.

## Preview-OTA vom 28.10.2026

- [Veröffentlichte Preview](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/6cb951e8-f8cd-498e-92fd-e744284c3901), iOS, Environment und Kanal `preview`, `APP_VARIANT=internal`.
- Code-Commit: `8399a3f3533231d7caa86401b004afefe41164c4`. Der ausgelieferte Quellstand stimmt mit dem gesicherten Manifest überein.
- Update-ID: `01a183bc-2a2b-7676-b881-5cc8b4e203dd`; Runtime passt zu Build 44.
- Der echte Preview-Kanal liefert dieses Update. Manifest und CDN-Bundle antworten mit HTTP 200; das ausgelieferte Bundle ist bytegleich zum lokalen Export und entspricht dem Manifest-Hash.
- Bundle SHA-256: `5f7982b8cfc9929e669d8b910753867d3f5ce46929aab0e0f4f168d4e8da44ab`.
- Geräteabnahme: Preview vollständig schließen, öffnen und rund 15 Sekunden warten, erneut schließen und öffnen. Anschließend Vorlagenauswahl, Uhrzeiten, mehrere Einträge, erneutes Antippen zum Entfernen und den Leistenwechsel prüfen.
