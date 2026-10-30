# Sonderdienste: Zeitblöcke und verständliche Eingaben

## Task-Vertrag

- Ziel: Geteilte Dienste, Rufbereitschaft und Bereitschaftsdienst in Vorlagen und einzelnen Diensten klar gruppieren. Jeder Dienstteil hat eigene Zeiten und seine eigene Pause; Hinweise bleiben aufklappbar erreichbar.
- Nicht-Ziele: Änderung von Tarifen, Vergütungsregeln, Persistenz, globalen Designwerten oder nativen Abhängigkeiten.
- Plattform: iPhone, Expo SDK 57 (`~57.0.31`). Referenz: <https://docs.expo.dev/versions/v57.0.0/sdk/date-time-picker/>.
- Basis: `codex/sonderdienste`, `d1c6676`; diese Funktion ist noch nicht in `origin/master` enthalten. Isolierter Branch `codex/sonderdienste-ui`.
- Dateiscope: Sonderdienst-Formular, drei lokale Darstellungs-/Formularhilfen, ein kleiner Adapter für den Diensteditor, Vorlageneditor/Overlay, optionales Accessibility-Label am vorhandenen Zeitpicker sowie fokussierte Tests und dieses Dokument. Insgesamt 15 Dateien, keine Datenmigration.
- Arbeitspakete: (1) Formularstruktur und Zeitblöcke, (2) Entwurfserhalt/Fehlerhinweise und Regressionstests, (3) technische Prüfungen und separate iPhone-Abnahme.
- iOS-Preview-OTA ist durch das ausdrückliche „ja“ zur Preview-Veröffentlichung am 29.10.2026 freigegeben. Commit, Push, EAS Build und TestFlight bleiben separat.

## Verhalten

- Die Dienstform steht vor den Zeiten. Der erste und jeder weitere Dienstteil besitzen dieselben Zeit-/Pausenfelder; Pausen bleiben minutengenau.
- Unterbrechungen sind abgeleitete Hinweise. Die Arbeitszeitsumme zieht Pausen aller Teile ab. Vorlagen zeigen geplante Uhrzeitdauern, datierte Dienste berücksichtigen die bestehende Zeitzonenlogik einschließlich Zeitumstellung.
- Rufbereitschaft zeigt den Zeitraum ohne allgemeine Pause. Einsätze und Wege sind ausschließlich im tatsächlichen Dienst erfassbar; offen, kein Einsatz und vollständig erfasst bleiben unterscheidbar.
- Bereitschaftsstufe und Ausgleich stehen unter Vereinbarung. Offene Angaben bleiben möglich. Die gewählte Stufe verspricht keine vollständige Abrechnung.
- Beim Wechsel der Dienstform bleiben deren bisherige Zeiten, Pausen, Dienstteile und Einsätze im aktuellen Editorentwurf erhalten. Nur die aktive Dienstform wird gespeichert. Der Entwurf ist kein zusätzlicher Persistenzkanal.
- Überschneidungen, ungültige Pausen, Tage und Zeitumstellungen erscheinen am jeweiligen Block. Die bestehende Validierung beim Speichern bleibt maßgeblich.
- Überstunden im ersten Teil eines geteilten Dienstes bleiben zugänglich. Reguläre Dienste, Erinnerungen, Wecker, Ort und Notiz behalten ihre Eingaben.

## Abnahme

- 08:00–10:00 und 17:00–21:00, beide ohne Pause: 6 Stunden Arbeitszeit und 7 Stunden Unterbrechung.
- 15 Minuten im ersten und 7 Minuten im zweiten Teil: 5 Stunden 38 Minuten; keine Rundung.
- Wechsel geteilt → Rufbereitschaft → geteilt erhält Teile und Pausen. Wechsel Rufbereitschaft → Bereitschaftsdienst → Rufbereitschaft erhält Einsätze und Erfassungsstatus.
- Nachtwechsel, mehrtägige Rufbereitschaft, Überschneidungen, ungültige Pausen und Zeitumstellung prüfen.
- Bestehende Vorlagen öffnen, bearbeiten, speichern und erneut öffnen; Werte müssen gleich bleiben.
- `npm.cmd run verify:fast` plus gezielte Sonderdienst- und Editorprüfungen.
- Echte iPhone-Abnahme offen: drei Dienstformen in Hell/Dunkel, große Schrift/VoiceOver, Tastatur, Zeitpicker, Tagesauswahl, Speichern und erneutes Öffnen. Erst nach separat freigegebener Preview-Verteilung; Browser-/Komponententests ersetzen diese Abnahme nicht.

## Nachweise

- Formularhelfer: 11 Tests bestanden; unter anderem exakte Pausen, Überschneidungen, Tageswechsel, Zeitumstellung und 14-tägige Rufbereitschaft.
- Fokussierte Komponentenprüfung: 60 Tests in drei Suites bestanden (`special-duty-fields`, `template-editor-screen`, `shift-edit-overlay`).
- Architektur- und Formularhelferprüfung: 47 Tests bestanden. Die bestehende Größenbegrenzung des Diensteditors bleibt unverändert.
- Gesamtlauf `npm.cmd run verify:fast` am 29.10.2026 mit Exit-Code 0: Typecheck, Lint, Formatierung, 9.984 Unit-Tests in 517 Dateien, 1.573 Komponententests in 167 Suites und sämtliche weiteren enthaltenen Repository-Gates bestanden. Lokales Log: `sonderdienste-ui-verify-final.log`.
- Lokale Komponentenprüfung im Browser: Hell/Dunkel, 390 px Breite ohne horizontales Überlaufen und tatsächliche Pause-Eingabe 15 + 7 Minuten mit Ergebnis 5 Std. 38 Min. geprüft.
- Die Vorschau rendert die echten Formular-Komponenten mit Beispieldaten. Ihre Zeitfelder verwenden den Web-Zweig; sie ist kein Nachweis für die nativen iPhone-Zeitpicker oder einen kompletten Speichervorgang auf dem Gerät.
- Lokale Screenshots: `artifacts/sonderdienste-ui-preview/dunkel.jpg` und `hell.jpg` (bewusst nicht versionierte Prüfartefakte). Der temporäre Vorschau-Server wurde nach der Prüfung beendet.
- Graft-Graph nach der Umsetzung aktualisiert. Commit und Push wurden nicht ausgeführt.

## Preview-Veröffentlichung

- Ziel: iOS, Kanal/Branch und Environment `preview`, `APP_VARIANT=internal`.
- Preview Build 44 (`812ea1a9-a4c0-48f3-b01a-72011cdad43e`) und lokaler iOS-Fingerprint stimmen überein: `b99c3cf0dd56e6b1bb126d195f21c665de57760b`.
- Veröffentlichungsgrundlage ist die bestehende Preview-Gruppe `4bab2f28-91ba-423f-9df3-af47687a5b7a`, Update `01a189eb-5c05-7069-9242-899c87e21416`, Commit `38198fce30a7c3efa3c53ffb2028d121d7f94a64`. Sie enthält die aktuelle Kalender-/Profilbildgestaltung, Bereitschaftsabrechnung und die direkte Verknüpfung aus der Gehaltsansicht. Die beiden während der Prüfung neu veröffentlichten Pakete wurden vollständig erhalten.
- Acht geänderte Bestandsdateien passen bytegenau auf diese Basis. Im Sonderdienst-Formular bleiben zusätzlich `StandbyAgreementFields` und die Tarifzuordnung aus der Vereinbarung erhalten. Sechs neue Dateien ergänzen den UI-Scope. Paket-/Lockdatei, App-Konfiguration und native Fingerprint-Konfiguration sind unverändert.
- Die kombinierte Veröffentlichungsquelle liegt getrennt unter `artifacts/ui-ota/`. Die ursprüngliche UI-Implementierung auf `d1c6676` bleibt für die spätere Git-Integration erhalten; deren Übernahme muss die neue Bereitschaftsabrechnung ebenfalls berücksichtigen. Die zusätzliche UI-Anbindung und ihr Regressionstest sind in `artifacts/sonderdienste-ui-preview/publication-integration.patch` festgehalten.

### Prüfstand der veröffentlichten Quelle

- 10.029 Unit-Tests in 520 Dateien bestanden; alle 171 Komponenten-Suites erfolgreich geprüft, einschließlich der gezielten Wiederholungen. Die 63 fokussierten Sonderdienst-/Editorprüfungen und die 68 Tests der zuletzt erhaltenen Gehaltsverknüpfung bestehen ebenfalls.
- Der ursprüngliche Sammellauf endete bei den Komponententests mit einem temporären Icon-Dateisystemfehler und Kalender-Zeitlimits. Onboarding besteht in der Wiederholung. Nach Trennung des Veröffentlichungssnapshots vom Browser-Vorschauprojekt bestehen auch alle 17 Kalenderfälle mit unveränderten Tests und Zeitlimits; die beiden betroffenen Fälle benötigen rund 3,3 und 3,1 Sekunden. Der Quellstand blieb beim Verzeichniswechsel für alle 2.253 Dateien bytegleich.
- Typprüfung, Lint und Formatprüfung sowie sämtliche weiteren `verify:fast`-Prüfphasen sind bestanden. Der erste Sammellauf und die erfolgreiche Wiederholung einzelner Phasen sind getrennt protokolliert; der fehlgeschlagene Sammellauf wird nicht nachträglich als Exit-Code 0 ausgewiesen.
- Die letzte zusätzlich veröffentlichte Änderung betrifft nur vier unabhängige Gehaltsdateien. Diese wurden unverändert übernommen und anschließend mit Typprüfung, Lint und ihren beiden vollständigen Komponenten-Suites geprüft. Bereits bestandene, unveränderte Prüfphasen bleiben anhand der Quellprüfsummen zugeordnet.
- Nachweise: `publication-final-checks.json`, `publication-preservation.json`, `publication-source-hashes.json`, `publication-latest-verify-fast.log`, `publication-calendar-clean-path.log`, `publication-final-gates.log` und `publication-navigation-checks.log` unter `artifacts/sonderdienste-ui-preview/`.

### Veröffentlicht und ausgeliefert

Veröffentlicht am **30.10.2026, 00:23 Uhr (Europe/Berlin)**:
[Preview-Gruppe 877c1f50-5fd9-4059-8b62-55e905b8a095](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/877c1f50-5fd9-4059-8b62-55e905b8a095), iOS-Update `01a189fa-03b1-774d-8cb2-126fe5eaaeff`.

Das vorbereitete iOS-Bundle wurde mit `--skip-bundler` unverändert veröffentlicht. Das anschließende EAS-Listing führt diese Gruppe vor der erhaltenen Gehaltsverknüpfung. Das Live-Manifest für Kanal `preview` liefert genau diese Update-ID und die Runtime von Preview Build 44.

- Manifest und Bundle: jeweils HTTP 200.
- Bundle: 12.378.003 Bytes; SHA-256 `0ee26ea8c707d9ca9df033fd0318c8106b9ff331f18349a796df7b550cbebe00` stimmt lokal, im Manifest und beim CDN-Download überein.
- Alle 52 Manifest-Assets stimmen mit dem Export überein. Sämtliche 2.253 eingefrorenen Quelldateien sind unverändert; 2.238 veröffentlichte Dateien bleiben gegenüber der letzten Preview identisch.
- Auslieferungsnachweis: `artifacts/sonderdienste-ui-preview/publication-delivery-verification.json`.
- Commit, Push, neuer nativer Build und TestFlight-Veröffentlichung wurden nicht ausgeführt.

### Noch offene Geräteabnahme

In **LUNA Shift Internal (Preview)** vollständig schließen, öffnen und etwa 15 Sekunden warten, nochmals schließen und öffnen. Danach die drei Dienstformen mit Pausen, Tageswechseln, Vereinbarungsangaben sowie Speichern und erneutem Öffnen prüfen. Hell/Dunkel, große Schrift und VoiceOver bleiben Teil der iPhone-Abnahme. Die technische Auslieferung bestätigt noch keine sichtbare Übernahme auf dem Gerät.

## Korrektur nach iPhone-Rückmeldung vom 30.10.2026

- Ziel: Pausen in Sonderdiensten mit demselben aufklappbaren Auswahlrad wie in regulären Vorlagen bearbeiten; vorhandene genaue Pausen erhalten. Abrechnungszeilen bei TVöD Pflege/Betreuung, TV-L und TV-H vollständig lesbar darstellen. Den hinterlegten Profiltarif auch in Vorlagen übernehmen.
- Plattform: iPhone, Expo SDK 57 (`~57.0.31`), zuerst lokale Prüfung; neue Preview-OTA separat freizugeben.
- Nicht-Ziele: Tarifberechnungen, individuelle Vereinbarungen, Datenmigrationen, native Abhängigkeiten und TestFlight.
- Basis/Erhalt: lokaler Branch `codex/sonderdienste-ui-korrektur` auf der veröffentlichten Grundlage `38198fc`; die ursprüngliche UI-Arbeit bleibt auf `codex/sonderdienste-ui` und zusätzlich unter `artifacts/sonderdienste-ui-preview/before-pause-correction/` gesichert. Sämtliche Laufzeitquellen wurden vor der Korrektur gegen die tatsächlich ausgelieferte Preview geprüft.
- Arbeitspakete: (1) gemeinsamen Pausen-Picker aus der bestehenden Vorlage verwenden, (2) Abrechnung ohne schmale Wertspalte und mit Profiltarif, (3) fokussierte Regressionen, `verify:fast` und visuelle Prüfung. Die Korrektur bleibt auf UI, Profilanbindung und zugehörige Tests begrenzt.
- Abnahme: Öffnen der Pause erzeugt keine Tastatur und verändert keinen gespeicherten Wert. Erst eine bewusste Auswahl speichert die neue Pause. Beide Teile und Bereitschaft besitzen denselben Ablauf. Alle Abrechnungswerte bleiben bei schmaler Breite und großer Schrift lesbar. Bei bekanntem Profiltarif wird keine zweite Tarifwahl verlangt; bei unbekannter Grundlage bleibt die manuelle Wahl möglich. Versionierte Vereinbarungen werden beim Bearbeiten und Speichern erhalten.
- Userklärung: Die zusätzlichen Fehler beziehen sich auf die Darstellung mehrerer Abrechnungszeilen bei TVöD Pflege/Betreuung, TV-L und TV-H; eine zusätzliche Rechenfehlermeldung wurde nicht gemeldet.
- Freigaben: Umsetzung und lokale Tests; kein neuer Commit, Push, Build oder EAS Update.

### Umgesetzte Korrekturen

- Reguläre Vorlagen und Sonderdienst-Zeitblöcke verwenden gemeinsam `PausePicker` mit dem vorhandenen `PauseWheel`. Die Pause öffnet das Auswahlrad statt einer Zahlentastatur. Die üblichen Werte sind 0, 15, 30, 45 und 60 Minuten. Bereits gespeicherte Sonderwerte wie 7 Minuten bleiben beim Öffnen und Speichern exakt erhalten und stehen während dieser Auswahl zusätzlich im Rad.
- Alle Auswahlwerte innerhalb der Bereitschaftsabrechnung stehen unter ihrer Beschriftung und erhalten die gesamte verfügbare Textbreite. Das gilt auch für Bewertung, Bereitschaftsgruppe, Stundenentgelt und Freizeitausgleich. Der Profilwert heißt kurz „Aus Tarifprofil“.
- Der Vorlageneditor ermittelt die Tarifzuordnung aus dem bestehenden Profil und dessen Beschäftigungsstand am Bezugsdatum. Bei bekanntem Tarif erscheint „Tarif aus deinem Profil“; eine erneute Tarifwahl entfällt. Ohne eindeutige Profilgrundlage bleibt die manuelle Auswahl erhalten.
- Bereitschaftsstufe, Arbeitgeberbewertung, abweichende Bereitschaftsgruppe und Ausgleich bleiben zugänglich: Der hinterlegte Tarif liefert diese individuellen Angaben nicht vollständig. Versionierte Vereinbarungen und bestehende Rechenregeln bleiben erhalten.

### Lokale Prüfung der Korrektur

- Fokussierte Komponentenprüfung: 39 Tests in vier Suites bestanden. Enthalten sind die drei genannten Tariffamilien, die Profilanbindung im Vorlageneditor, bewusste Pausenauswahl ohne Texteingabe und Erhalt genauer bestehender Pausen.
- Abschließender Gesamtlauf am 30.10.2026: `npm.cmd run verify:fast` mit Exit-Code 0. Typprüfung, Lint ohne Warnungen, Formatprüfung, 10.029 Unit-Tests in 520 Dateien, 1.626 Komponententests in 171 Suites und sämtliche weiteren enthaltenen Repository-Prüfungen bestanden. Die bestehende Größenbegrenzung der Pausenrad-Komponente bleibt eingehalten.
- Nachweise: `artifacts/sonderdienste-ui-preview/correction-verify-final.log`, `correction-focused.log` und `correction-source-hashes.json`. Die abschließend geprüften Laufzeit- und Testdateien bleiben diesen Prüfsummen zugeordnet.
- Browserprüfung mit Originalkomponenten und Inter-Schrift: alle drei Tarife in Hell/Dunkel; 320 px Breite ohne horizontales Überlaufen (`scrollWidth = clientWidth = 320`). Pause 30 → 45 sowie Dienstteil 2 mit 7 → 15 Minuten und aktualisierter Arbeitszeitsumme geprüft. Die Pausenauswahl enthält kein Texteingabefeld.
- Screenshots unter `artifacts/sonderdienste-ui-preview/`: `correction-tariffs-dark.png`, `correction-tariffs-light.png`, `correction-320-dark.png`, `correction-320-light.png` und `correction-split-selected.png`. Das lokale Prüfprojekt gehört nicht zum Produktumfang. Browser-Zeitfelder und Startpositionen des Scrollrads ersetzen keinen Nachweis der nativen iPhone-Bedienung.
- Temporärer Browser-Tab und Vorschau-Server beendet; Viewport-Vorgabe zurückgesetzt. Graft-Graph aktualisiert.
- Die erneute iPhone-Abnahme einschließlich großer Schrift, VoiceOver, Startposition des Pausenrads sowie Speichern und erneutem Öffnen bleibt offen. Dafür ist zuerst eine neue, separat freigegebene iOS-Preview-OTA nötig.

## Veröffentlichte Preview-Korrektur vom 30.10.2026

Freigabe: ausdrückliches „ja“ zur neuen iOS-Preview-OTA. Die Freigabe umfasst diese Veröffentlichung; Git-Auslieferung, native Builds und TestFlight bleiben separat.

Veröffentlicht am **30.10.2026, 02:03:04 (Europe/Berlin)**: [Preview-Gruppe fd9c16ce-0fe1-48a7-a163-2b6fb7cf560c](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/fd9c16ce-0fe1-48a7-a163-2b6fb7cf560c), iOS-Update `01a18a54-ed78-798e-b07a-5903e24682ec`.

- Ziel: iOS, Kanal/Branch und Environment `preview`, `APP_VARIANT=internal`, bestehender Preview Build 44. Lokale Runtime, Export-Runtime, frische Build-Metadaten und veröffentlichte Runtime stimmen überein: `b99c3cf0dd56e6b1bb126d195f21c665de57760b`.
- Die zwischenzeitlich veröffentlichten Netto-Einstellungen, die Kalenderkorrekturen für Blättern, Tageszahlen und Monatstitel sowie die Berechnung echter Bereitschaftspausen bleiben erhalten. Letzte Veröffentlichungsgrundlage ist `ec0a1055-ba39-4c0f-8dd8-9ca86c334b3c`; 2.247 bereits veröffentlichte Dateien bleiben bytegleich.
- Der freigegebene UI-Ausgangsstand hat `verify:fast` mit Exit-Code 0 bestanden. Die zusätzliche Vereinigung wurde mit Typprüfung, Lint und Formatprüfung sowie 89 Architektur-/Formular-/Navigationstests, 74 Vergütungstests und 162 UI-/Gehalts-Komponententests in acht Suites geprüft.
- Im kombinierten Lauf traten zwei bereits bekannte Kalender-Zeitlimits auf. Die unveränderte Kalender-Suite besteht abschließend mit allen 17 Fällen einzeln; die beiden kritischen Fälle benötigen rund 3,9 und 3,1 Sekunden. Dazu wurden der lokale Node-Heap begrenzt und Speicherbereinigung zwischen den Testfällen aktiviert. Testcode und Zeitlimits bleiben unverändert. Ursprünglicher Fehlerlauf und erfolgreiche Wiederholung sind getrennt protokolliert; es wird kein durchgehend grüner Gesamtlauf der vereinigten Quelle behauptet.
- Auslieferung bestätigt: Manifest und Bundle jeweils HTTP 200, Update-ID und Runtime passend. Das Bundle hat 12.379.016 Bytes; SHA-256 lokal, im Manifest und beim CDN-Download identisch: `b10ef6cb2820d877847f1f883ca985a355f1188abe744f6cb8a2ea0bf1fb7916`. Alle 52 Manifest-Assets stimmen mit dem Export überein.
- Die 2.259 eingefrorenen Quelldateien unter `artifacts/correction-ota/` und die freigegebenen UI-Dateien bleiben unverändert. Nachweise: `correction-ota-release-proof.json`, `correction-ota-after-delivery.json`, `correction-ota-final-checks.json` und zugehörige Logs unter `artifacts/sonderdienste-ui-preview/`.
- iPhone-Abnahme offen: LUNA Shift Internal vollständig schließen, öffnen, etwa 15 Sekunden warten, nochmals schließen und öffnen. Danach Pausenauswahl, Profiltarif, Abrechnungszeilen sowie Speichern und erneutes Öffnen prüfen.

## Git- und TestFlight-Auslieferung

- Nutzerbestätigung: „ja super. commit push pr merge und testflight ota“. Diese Rückmeldung bestätigt den angebotenen Preview-Stand für den besprochenen UI-Ablauf und gibt Commit, Push, PR, Merge nach grüner CI sowie die anschließende iOS-TestFlight-OTA frei. Gerät und iOS-Version wurden nicht genannt; eine vollständige Build-Regression wird daraus nicht abgeleitet.
- Die noch offene Grundlage ist Entwurfs-PR #335 mit Sonderdienst-Datenmodell und Berechnungen. Auf die konkrete Rückfrage hat der Nutzer zusätzlich „Ja, PR #335 ebenfalls ausliefern“ freigegeben. Ausgangshead der Grundlage: `9b28b9db41e2683bdf7a148283be30fd454b3d65`.
- Ziel: Die bestätigte Sonderdienst-Oberfläche auf aktuellem `master` integrieren, die Grundlage und den UI-Scope getrennt prüfen und erst nach vollständiger erfolgreicher PR-CI mergen. Anschließend die UI mit allen bereits veröffentlichten Beta-Inhalten als kompatible iOS-OTA ausliefern.
- Arbeitspakete: (1) Grundlage und UI in getrennten Git-Schritten integrieren, (2) lokale Prüfungen, vollständige PR-CI und Tree-/Blob-Vergleich, (3) TestFlight-Runtime, Export und Live-Auslieferung prüfen.
- UI-Dateiscope: die 21 bereits implementierten UI-, Test- und Dokumentationsdateien dieses Checkouts. Berechnung und Persistenz kommen aus der zusätzlich freigegebenen Grundlage. Die separat laufende Überarbeitung der Gehaltskarten wird dadurch nicht vorweggenommen.
- Nicht-Ziele: zusätzliche Fachfunktionen, native Builds, neue SDK-/Paketversionen, Änderungen an TestFlight-Gruppen oder dem öffentlichen Link.
- Abnahme: Geprüfter PR-Head und aktueller Base-Stand, ausschließlich beabsichtigter Dateiscope, alle sieben CI-Gates erfolgreich, gemergte Quellen identisch zum geprüften Stand. Production-OTA mit `APP_VARIANT=production`, bestehendem Kanal/Environment `production` und tatsächlich passender TestFlight-Runtime. Die spätere Übernahme auf dem iPhone bleibt separat zu bestätigen.

### Integrationsstand für die Auslieferung

- Während der Vorbereitung wurde PR #335 um die gewünschte Einordnung der Bereitschaftsvergütung bei den übrigen Zulagen erweitert (`437c324`). Diese sechs Dateien werden über die Grundlage integriert; ihre Preview-Abnahme bleibt Voraussetzung für die Beta-Auslieferung.
- Die Grundlage ist verlustfrei mit `master` (`1657a27`) zusammengeführt. Integrationshead: `932ad32cc715948803fa83085bc79e0f77c35702`. Bereits auf master vorhandene Änderungen fallen aus dem PR-Diff heraus; verbleibender Grundlagen-Scope: 95 Dateien.
- Die automatischen Cloud- und Netto-Zusammenführungen stimmen mit der gemeinsamen Preview überein. Typprüfung sowie Cloud-/Datenbank-/Bereitschaftstests und die zusätzlichen 42 Navigations- sowie 70 Gehalts-Komponententests sind bestanden.
- Der einzige UI-Konflikt betraf den Bereitschaftspausen-Hinweis im umgebauten Zeitblock. Aufgelöst ist er mit der veröffentlichten Referenzdatei. Alle 20 UI- und Testdateien des UI-Commits stimmen bytegenau mit der bestätigten Preview-Quelle überein; die Dokumentation ist die 21. Datei.
- Der bestehende TestFlight-Build 8 ist frisch als Store-Build bestätigt. Sein Fingerprint und die lokal aufgelöste Production-Runtime stimmen überein: `ab053760e06bdf85a83f64fc65cfee0aab41fe12`.
