# Paket 3: Kalenderdarstellung und eigenes Hintergrundbild

## Task-Vertrag

- Ziel: Eigene Karte Dienstbezeichnung mit Name/Kürzel/Symbol als runde Auswahlzeilen wie Dienstfarben. Eigene Karte Zeitangabe mit Keine/Startzeit/Gesamtdauer als exklusive Auswahl. Eine Karte Eigenes Hintergrundbild mit Foto auswählen beziehungsweise Vorschau, Foto ändern, Bildsichtbarkeit, Entfernen und Rückgängig.
- Nicht-Ziele: Premium-Sperren, Datenverlust, neue native Integration, Kalender-/Widget-Neugestaltung, Berechnungsänderungen, Production/TestFlight-Veröffentlichung.
- Plattform: bestehende iOS-Preview-App Build 49, Hell/Dunkel, kleine Breite und große Schrift; separate Luftig-Darstellung erhalten.
- Scope: calendar-display-controls.tsx, calendar-background-control.tsx, neue calendar-choice-rows.tsx, calendar-preferences.tsx; bestehende Appearance-/Preferences-Tests und gezielte Quellenfreigaben. Weniger als 15 Dateien.
- Expo: ~57.0.31; passende Referenz https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/. Keine SDK-/Paket-/Plugin-Änderung.

## Kompatible Übernahme

Die gespeicherten booleschen Zeitfelder bleiben erhalten; Parser und Datenbankschema benötigen keine Migration. Keine Zeitangabe, nur Startzeit und nur Gesamtdauer werden eindeutig angezeigt. Ein Altbestand mit beiden aktiven Feldern bleibt beim Laden unverändert und wird nicht automatisch überschrieben. Die UI zeigt einen Hinweis auf die bisherige Kombination und fordert eine explizite Wahl aus den drei neuen Optionen. Bis dahin bleibt auch die bisherige Kalender-/Widget-Anzeige unverändert.

Die neue Provider-Aktion setzt beide Felder mit einem einzigen Update und einer gemeinsamen Speicherung. Fehlerbehandlung, Schreibreihenfolge, Rücksetzen und Wiederholen verwenden die vorhandene Persistenzlogik. Bestehende unabhängige Schalter für Inhalte bleiben erhalten.

## Abnahmekriterien

- Auswahl in den zwei eigenen Karten ist eindeutig, sofort in der Vorschau wirksam und nach Neustart erhalten; erneutes Antippen der aktiven Auswahl schreibt nicht erneut.
- Altbestand mit beiden Zeitwerten bleibt bis zur ausdrücklichen Auswahl erhalten; ein fehlgeschlagener Speichervorgang stellt die vorherigen Werte wieder her, Wiederholen speichert die ganze Auswahl.
- Vor geladenen Einstellungen und bei ausgeblendeten Diensten sind die betreffenden Optionen deaktiviert.
- Ohne Foto gibt es genau Foto auswählen; keine LUNA-Standard-/Eigenes-Foto-Umschaltung. Abbruch verändert nichts. Mit Foto sind Ändern, Bildsichtbarkeit und Entfernen verfügbar; Rückgängig stellt das vorherige Bild wieder her.
- Vollständiges verify:fast für Funktions- und Preview-Quelle, gezielte Persistenz-/Foto-/Vorschautests, gleiche native Runtime sowie Quellen- und OTA-Bytevergleich vor Übergabe.
- Eigene Preview-OTA ausdrücklich freigegeben. Geräteabnahme von Paket 3 steht aus. Commit/GitHub erst nach Abnahme; Paket 2 wird zuvor separat über CI und PR integriert.

## Preview-Auslieferung zur Abnahme

Paket 2 ist nach ausdrücklicher Geräteabnahme über PR #362 vollständig CI-grün integriert. Basis für Paket 3 ist der Merge 319f8cad723e3972e10d29bac1fa2e568561309f. Der abgenommene Paket-2-Luftig-Stand liegt separat unter e0cd75ca4140598acd9a7d515be0f8dcd3afc681 auf GitHub.

- Eigene Paket-3-Preview-Gruppe: a46de845-3afb-4a77-bdba-272261ebcc56
- Update-ID: 01a1ae65-8a3a-7989-b4ba-d088d8285b95
- Runtime: 402e757d98ca799660ce5dd15a24bd999cf690eb
- Preview-Quellfingerprint: a3e134b3cdd81f51248e5c9bf440e5040dc1b8fc9acd669c4e7c267fb8b268cf
- Bundle-SHA256: c7676f076d6f80a244276c51b2490112a4a33ddcf1b897dd2b3cbd979868c309
- Bundle und 34 Assets vom Server bytegenau gegen den geprüften Export verifiziert.

Beide vollständigen verify:fast-Läufe bestehen: jeweils 10.404 Fachtests und 1.852 Komponentenfälle in 196 Testgruppen sowie alle weiteren Schutzprüfungen. Zusätzlich bestehen 108 fokussierte Fälle für Zeitwahl/Persistenz, Foto-Abbruch/Entfernen/Rückgängig, Vorschau und Widgets. Anfänglich veraltete Testannahmen zu entfernten UI-Elementen, die Typisierung der Testtabelle und die Simulation schneller Eingaben wurden korrigiert. Ein weiterer Einstiegstest erwartete noch die alte Überschrift; nach dessen Anpassung bestand auch der vollständige Wiederholungslauf. Die Runtime entspricht der vorhandenen Preview-App Build 49.

Paket 3 ist noch nicht auf dem iPhone abgenommen und bleibt uncommitted. Die Abnahme umfasst Dienstbezeichnung, Keine/Startzeit/Gesamtdauer, Speicherung nach Neustart sowie Foto auswählen/abbrechen/ändern/entfernen/rückgängig in Hell und Dunkel. Der Altbestand mit beiden Zeitfeldern bleibt bis zur expliziten Wahl erhalten. Keine Production-/TestFlight-OTA und keine neue native Version.

Nachweise im chatbezogenen Verzeichnis: paket3-checks.json, paket3-source-evidence.json, paket3-preview-source-evidence.json, paket3-preview-delivery-proof.json, paket3-preview-source-archive.json und das vollständige Quellarchiv.

## Korrektur R2: fixierte Zwei-Wochen-Vorschau wie das Widget

Nutzerauftrag: Die obere Kalender-Vorschau soll wie das Zwei-Wochen-Widget aussehen und weiterhin fixiert bleiben. Die Einstellungsreihenfolge wurde als Matrix gezeigt und anschließend vom Nutzer als A–B–E–F–G–C–D–H festgelegt.

Referenz ist LUNACalendarContent im vorhandenen nativen Widget: zwei Reihen mit sieben Tagen, 12 pt horizontaler und 10 pt vertikaler Innenabstand, Datumszahl 14 pt in 28 × 20 pt, 8 pt Abstand zum Dienst, Dienstschrift 11 pt und Zeilenhöhe 13 pt. Die Vorschau erhält eine stabile kompakte Höhe von 168 pt. Die große Monatsüberschrift und die gesonderte Wochentagszeile entfallen. Monatsübergreifende Tage bleiben gleichwertige Zellen. Beispieldaten, Einstellungen, Foto und heutiger Tag werden weiterhin berücksichtigt. Die Vorschau bleibt außerhalb des scrollbaren Einstellungsbereichs.

Scope der Korrektur: appearance-calendar-preview.tsx und die beiden vorhandenen Appearance-/Kalender-Einstiegstests; Quellenfreigabe und Dokumentation. Keine Änderung an nativen Widget-Dateien, Persistenz oder Berechnungen. Die anschließend konkretisierten Auswahlkarten und Reihenfolge werden wie unten beschrieben angepasst. Expo ~57.0.31; Referenz https://docs.expo.dev/versions/v57.0.0/sdk/widgets/.

Abnahme: genau zwei vollständige Wochen, keine große Monats-/Wochentags-Kopfzeile, kompakte Widget-Geometrie und stabile Position beim Scrollen. Dienstfarben, Name/Kürzel/Symbol, Zeitangaben sowie Foto/Deckkraft aktualisieren die Vorschau; Hell/Dunkel und große Schrift dürfen die Einstellungsbedienung nicht verdecken. Separate Preview-OTA zur erneuten Abnahme, weiterhin kein Paket-3-Commit vor Abnahme.

| ID  | Aktuelle Reihenfolge    | Einstellungen                                           |
| --- | ----------------------- | ------------------------------------------------------- |
| A   | Aussehen                | Hell · Dunkel · System                                  |
| B   | Eigenes Hintergrundbild | Foto wählen/ändern · Deckkraft · Entfernen · Rückgängig |
| E   | Dienstfarben            | Kräftige Farben · Pastellfarben                         |
| F   | Dienstbezeichnung       | Name · Kürzel · Symbol                                  |
| G   | Zeitangabe              | Keine · Startzeit · Gesamtdauer                         |
| C   | Kalenderinhalt          | Dienste & Abwesenheiten · Termine · Feiertage           |
| D   | Feiertage & Sondertage  | Rot · Blau · Orange                                     |
| H   | Abschluss               | Kalenderoptionen zurücksetzen · Speicherstatus          |

Vorschau oben und Zurück-Leiste unten sind fixierte Bereiche außerhalb dieser Reihenfolge.

### Bestätigte Umsortierung und Auswahlgestaltung in R2

Der Nutzer hat anschließend A–B–E–F–G–C–D–H ausdrücklich festgelegt. Die Trennlinie zwischen den Dienstfarben entfällt. Aussehen bekommt die gleichen runden Auswahlmarkierungen wie die anderen Auswahlkarten, bleibt aber auch auf kleinen Breiten und bei großer Schrift in einer Zeile: Hell / Dunkel / System. Text darf innerhalb seiner Zelle angepasst werden; die vollständigen Bedienungslabels bleiben für VoiceOver erhalten.

Erweiterter Dateiscope: calendar-display-controls.tsx, appearance-mode-control.tsx, calendar-choice-rows.tsx und shift-color-scheme-picker.tsx zusätzlich zur lokalen Widget-Vorschau und ihren bestehenden Tests. Weiterhin unter 15 Dateien; keine Änderung der fachlichen Auswahl-/Speicherlogik oder nativen Widgets.

Die Widget-Vorschau-Maße liegen als additive zentrale Designwerte in src/theme/tokens.ts. Die vorhandenen Luftig-Werte bleiben erhalten. Die Schriftprüfung dokumentiert die begrenzten Vorschauzellen und die ausdrücklich horizontale Moduswahl mit vollständigen VoiceOver-Labels; normale Einstellungstexte bleiben skalierbar. Gesamtscope: 14 Dateien einschließlich Tests, Dokumentation und Quellenfreigabe.

## Preview-Korrektur R2 zur erneuten Abnahme

- Preview-Gruppe: 3f37bbf2-8a2f-47b3-aad0-4104812f1b4b
- Update-ID: 01a1ae94-42e7-7d63-ba39-14b7cccdfe87
- Runtime: 402e757d98ca799660ce5dd15a24bd999cf690eb (bestehende Preview-App Build 49)
- Preview-Quellfingerprint: 53114b4a0488b5d7c6bf3862488f4c45dd2b32facbd2e5a0ae26a306e22d9c70
- Funktions-Quellfingerprint: 4b689040d6aada6c64241727ff94a8638a4a6fea3fcf09aacb0c25191436994a
- Bundle-SHA256: b05e0a4a7fb356d4164313c438820f158990cff8a3ef9bab09b12c8a96ca3d15
- Bundle und alle 34 Assets vom Server gegen den eingefrorenen Export verifiziert.
- GitHub-Master vor Veröffentlichung: 319f8cad723e3972e10d29bac1fa2e568561309f, unverändert gegenüber Paket 2.

Beide vollständigen verify:fast-Läufe bestehen mit jeweils 10.404 allgemeinen Tests und 1.852 Komponentenfällen in 196 Gruppen; zusätzlich bestehen 108 fokussierte Fälle und 11 gezielte Design-/Schriftprüfungen. Die erste Vollprüfung meldete lokale Designliterale und die noch nicht dokumentierten kompakten Schriftkontexte; diese wurden durch zentrale Vorschauwerte beziehungsweise begründete Schriftregeln behoben. Eine Preview-Formatierung wurde korrigiert, anschließend bestand dessen vollständiger Wiederholungslauf.

Die native Widget-Implementierung bleibt unverändert. Die lokale Vorschau folgt dessen kompakter Zwei-Wochen-Geometrie und nutzt weiterhin die vorhandenen Beispieldaten der ersten beiden Kalenderwochen des gewählten Monats. Sie bleibt fixiert. Reihenfolge A–B–E–F–G–C–D–H; Hell / Dunkel / System horizontal mit exklusiver Auswahl; keine Trennlinie zwischen den Dienstfarben; Luftig bleibt erhalten.

Geräteabnahme weiterhin offen. Paket 3 bleibt bis zur ausdrücklichen Abnahme uncommitted; kein Push, PR oder Merge für Paket 3. Keine Production-/TestFlight-Veröffentlichung.

Nachweise: paket3-r2-checks.json, paket3-r2-source-evidence.json, paket3-r2-preview-source-evidence.json, paket3-r2-preview-delivery-proof.json, paket3-r2-preview-source-archive.json und das zugehörige Quellarchiv im chatbezogenen Verzeichnis.

## Korrektur R3: animierte Aussehen-Auswahl mit Icons

Ziel: Das Video vom 6. November 2026 dient als Referenz für eine zwischen drei Segmenten gleitende aktive Fläche. Hell/Sonne, Dunkel/Mond und System/Smartphone bleiben in einer horizontalen Zeile. Die aktive Fläche nutzt die vorhandene schwarz/weiße Primärpalette: dunkel im Hellmodus, hell im Dunkelmodus, mit kontrastierendem Text und Icon. Bewegung reduzieren wird über die bestehende Systemvorgabe respektiert.

Scope: lokale appearance-mode-control.tsx, Rücknahme des nur dafür eingeführten horizontalen Zweigs in calendar-choice-rows.tsx, vorhandene Appearance- und Schriftprüfungen sowie Quellenfreigabe/Dokumentation. Insgesamt weiterhin 14 Dateien im Paket. Keine Änderung an globalen Auswahlleisten, Kalendergeometrie, nativer Integration oder Persistenz. Expo ~57.0.31; versionierte Referenz https://docs.expo.dev/versions/v57.0.0/sdk/reanimated/.

Abnahme: weiches Gleiten zwischen allen drei Optionen, genau eine aktive Auswahl, passende Icons/Kontraste in Hell/Dunkel/System, kein vertikales Stapeln, Bedienung bei großer Schrift und deaktiviertem Laden, keine erneute Speicherung beim Antippen der aktiven Option. Luftig und Reihenfolge A–B–E–F–G–C–D–H bleiben erhalten. Eigene Preview-Korrektur-OTA; Commit/GitHub weiterhin erst nach Geräteabnahme.

## Preview-Korrektur R3 zur erneuten Abnahme

- Preview-Gruppe: fd649ffd-adff-4c5b-a3f0-acaaf6b262d3
- Update-ID: 01a1aeb8-ba02-7242-a121-76ded8ded277
- Runtime: 402e757d98ca799660ce5dd15a24bd999cf690eb (bestehende Preview-App Build 49)
- Preview-Quellfingerprint: 5d3ccf2cf018c33df87e0110b103221cff1a04f901aae8777e85011766275fe7
- Funktions-Quellfingerprint: b7b0fdf002a85660a0e5830b0a89dde094a89e37d4b6649542086389ef6de509
- Bundle-SHA256: 8260ff8e106c0a50a28798ba28628a1fbf71b89adb972c49766770bc3b119a93
- Bundle und 34 Assets vom Server bytegenau gegen den finalen Export verifiziert.
- GitHub-Master vor Veröffentlichung: 319f8cad723e3972e10d29bac1fa2e568561309f.

Die Auswahl folgt der Video-Referenz: gemeinsame horizontale Leiste mit einer gleitenden aktiven Fläche, Sonne/Hell, Mond/Dunkel und Smartphone/System. Vorhandene App-Icons und Schwarz-/Weiß-Palette mit kontrastierender Beschriftung. Animation über 240 ms mit ruhigem Auslauf und systemgesteuertem Reduce Motion. Genau eine aktive Fläche; Breite wird bei Layoutänderungen neu berechnet. Keine weitere Speicherung beim Antippen der bereits aktiven Option. Systemmodus folgt weiterhin der Geräteeinstellung.

Beide finalen verify:fast-Läufe bestehen mit jeweils 10.404 allgemeinen Tests und 1.852 Komponentenfällen in 196 Gruppen. Zusätzlich bestehen 108 gezielte Fälle und 11 Design-/Schriftprüfungen. Anfänglich falsche Testannahmen zu Palettenparameter und Track-Inset wurden korrigiert. Ein direkter Icon-Paketimport wurde vor Veröffentlichung durch die vorhandene App-Komponente ersetzt; die daraufhin gestarteten finalen Prüfläufe und der finale Export beziehen sich auf diesen Stand. Der Zwischenexport mit zusätzlichen Icon-Schriften wurde nicht veröffentlicht. Ein früherer, abgebrochener Prüflauf hatte eine act-Warnung aus dem bestehenden Kalender-Pager-Test; sie betraf keine fehlgeschlagene Assertion.

Geräteabnahme der Animation, Hell/Dunkel/System, großen Schrift und Systemoption Bewegung reduzieren steht aus. Luftig, fixierte Zwei-Wochen-Vorschau und Reihenfolge A–B–E–F–G–C–D–H bleiben erhalten. Paket 3 bleibt uncommitted; Commit/GitHub erst nach ausdrücklicher Abnahme. Keine Production-/TestFlight-Veröffentlichung.

Nachweise: paket3-r3-checks.json, paket3-r3-source-evidence.json, paket3-r3-preview-source-evidence.json, paket3-r3-preview-delivery-proof.json, paket3-r3-preview-source-archive.json und zugehöriges Quellarchiv. Finaler Export: paket3-r3-preview-export-final.

## Geräteabnahme und Git-Freigabe am 6. November 2026

Der Nutzer hat Paket 3 ausdrücklich auf dem iPhone abgenommen: „Ja jetzt passt es, Paket 3 ist abgenommen. Bitte committen und mit GitHub abgleichen.“ Die Abnahme ist der finalen R3-Preview-Gruppe fd649ffd-adff-4c5b-a3f0-acaaf6b262d3 und Update-ID 01a1aeb8-ba02-7242-a121-76ded8ded277 zugeordnet. Die zuvor als offen dokumentierte Paket-3-Geräteabnahme ist damit abgeschlossen. Weitere Veröffentlichung nach Production/TestFlight ist damit nicht freigegeben.

Vor dem Commit wurden die aktiven OTA-Bytes, sämtliche 34 Assets, die unveränderten geprüften Quellfingerprints und beide vollständigen Testnachweise erneut abgeglichen. Der Funktionsstand wird separat über PR/CI integriert; der abgenommene Luftig-Stand wird als eigener Preview-Branch gesichert. Paket 4 startet anschließend auf der integrierten Basis und erhält eine eigene Preview-OTA.
