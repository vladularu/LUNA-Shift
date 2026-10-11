# Abnahme: Onboarding und Dienstplanprüfung

## Auftrag und Grenzen

Ziel: Bestehende Änderungen prüfen, gefundene Fehler im freigegebenen Umfang korrigieren und einen reproduzierbaren iPhone-Abnahmeplan mit technischem Nachweis vorbereiten.

Scope: die vier bestehenden Arbeitspakete in `docs/onboarding-pruefung-arbeitspakete.md`, ihre Regressionstests und diese Abnahmeunterlagen. Ein separater lokaler Kandidat kombiniert die Änderungen mit dem Netto-Commit `8dec08e1b9dd8f6fe13666b997d7e8ae4596ae05`.

Nicht-Ziele: neue Tarife, Nettoformeln, native Konfiguration, Git-Veröffentlichung, neuer Build und Store-Schritte. Nach Abschluss der Vorbereitung wurde die iOS-Preview-OTA für Build 33 am 11.10.2026 ausdrücklich freigegeben. Die vorhandenen Arbeitscheckouts bleiben erhalten.

Zielplattform: reales iPhone mit dem vorhandenen internen Preview-Build 33; Expo SDK 57 (`~57.0.22`). Technische Grundlage: [versionierte Expo-Dokumentation](https://docs.expo.dev/versions/v57.0.0/).

Akzeptanz: kontrollierte Prüfangaben und unveränderte Gehaltsdaten, stabile Navigation und Speicherung, gleiche Monats-/Jahresdarstellung, alle sieben bestehenden Tarifoptionen, erfolgreiche lokale Gates und iOS-Bündelung des kombinierten Kandidaten. Screenshots, Tastatur, große Schrift und VoiceOver werden separat am Gerät geprüft.

## Review und technische Nachweise

- Behoben: Beim Speichern einer zuvor unbekannten Feiertagsregion konnte das Profil aktualisiert werden, bevor die Navigation schließt. Dadurch verkürzte sich die Standard-Fragenliste und die offene letzte Seite verwies auf eine fehlende Frage. Der Fehler wurde im Test reproduziert; der Ablauf behält jetzt seine anfängliche Fragenliste bis zum Schließen. Eine neue Fragenroute beginnt einen neuen Ablauf.
- Acht fokussierte Komponententests bestanden: bewusste Antworten, unbekannte Angaben, Später, Fehler/Wiederholung, Regionsspeicherung und ungültige/doppelte Fragenrouten.
- Kombinierter Kandidat: `C:\Users\veron\Desktop\MediShift\.worktrees\onboarding-netto-abnahme`, Branch `codex/onboarding-netto-abnahme`, Basis `8dec08e1b9dd8f6fe13666b997d7e8ae4596ae05`. Onboarding-Änderungen wurden per Patch übertragen; beide ursprünglichen Checkouts bleiben erhalten.
- Sieben zusätzliche Persistenztests im Kandidaten bestanden: alle Tarifprofile und datierte Netto-Angaben bleiben nach dem Speichern der Prüfangaben und einer Backup-Wiederherstellung erhalten. Der Test liegt in `src/infrastructure/database/onboarding-net-pay-persistence.test.ts` und setzt den Netto-Stand voraus.
- `npm.cmd run verify:fast`: bestanden am 11.10.2026. 420 Vitest-Dateien / 8.352 Tests, 113 Jest-Suites / 880 Komponententests und 141 Werkzeug-/Richtlinientests; Regelkatalog, Typprüfung, Lint, Formatierung und Diff-Prüfung bestanden.
- `APP_VARIANT=internal`, `CI=1`, `npm.cmd run export:ios`: bestanden. Der kombinierte Kandidat lässt sich als iOS-Hermes-Bundle exportieren. Graft-Graph aktualisiert.
- Build 33 wurde read-only in EAS bestätigt: `8deae8f8-679b-4284-978a-a07f74fa6719`, iOS, Profil `preview`, Distribution `internal`, Status `FINISHED`, App-Version `0.1.0`, erstellt am 06.10.2026. [Build-Metadaten](https://expo.dev/accounts/vladularu/projects/pflegeshift/builds/8deae8f8-679b-4284-978a-a07f74fa6719).
- Der lokale iOS-Fingerprint des Kandidaten und der bei Build 33 gespeicherte Fingerprint stimmen überein: `03d174d668f0ea5f757958dccf853632762c554d`. Das belegt die native Kompatibilität für diesen Varianten-/Plattformvergleich; die sichtbare Funktion wird am iPhone geprüft. Grundlage des Vergleichs: [Expo-Fingerprint für SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/fingerprint/).
- Die Schritte von `verify:full` werden auf unverändertem Code einzeln ausgeführt, damit das bereits bestandene schnelle Gate nicht wiederholt wird. Die Unit-Coverage ist bestanden: 419 Dateien / 8.351 Tests; Statements 92,84 %, Branches 90,58 %, Functions 97,56 %, Lines 94,35 %. Der Coverage-Befehl schließt den bestehenden Monats-Performancetest aus, daher ein Test weniger als im schnellen Gate. Sieben bestehende Jahrestests liefen zunächst bei paralleler Coverage in das 5-Sekunden-Limit; der vollständige Wiederholungslauf mit `npm.cmd run test:coverage:unit -- --maxWorkers=1` bestand ohne Code- oder Timeout-Änderung.
- Produktions-Abhängigkeitsaudit bestanden: keine unbehobenen hohen oder kritischen Advisories; die zwei installierten Backports für `node-forge` und `braces` wurden geprüft. Lokale Release-Konfiguration konsistent. Web- und Android-Exporte mit `--max-workers 1` bestanden; iOS-Export ebenfalls bestanden. Die Exporte sind technische Nachweise, keine Geräteabnahme für diese Plattformen.
- Komponenten-Coverage bestanden: 113 Suites / 880 Tests; Statements 77,04 %, Branches 75,44 %, Functions 70,85 %, Lines 79,33 % im konfigurierten Coverage-Scope. Alle Schritte der erweiterten lokalen Prüfung sind damit bestanden.
- Der geprüfte Code umfasst die Netto-Basis plus 25 geänderte/neue TypeScript-Dateien. Lokaler SHA-256 des Quellstands: `1d1f35c2dfe1866e30900de8f0fc9debb7b2c81e84c2fb52d2a41e78508bd534`. Einzeldatei- und Bundle-Hashes liegen im Kandidaten in `artifacts/onboarding-abnahme/manifest.json`; das Manifest ist ein lokal ignorierter Prüfbeleg.
- Status: lokale technische Prüfung und Abnahmevorbereitung abgeschlossen; iOS-Preview-OTA veröffentlicht und technisch verifiziert. Gerätenachweis offen. Der Kandidat ist uncommittet.

## Veröffentlichte Preview-OTA

- Freigabe am 11.10.2026 durch „ota“; veröffentlicht auf Branch/Kanal `preview`, Plattform `ios`, Umgebung `preview`, Variante `internal`, für Build 33.
- [OTA-Gruppe](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/64cf5978-8991-46b1-8bbc-2a4ad68985b4): `64cf5978-8991-46b1-8bbc-2a4ad68985b4`; Update-ID `01a12906-29d4-7855-a5dc-e6cb631b17b1`.
- Vor Veröffentlichung wurde der bisherige Preview-Stand `5be96581-90f5-4829-83ba-8a7f7ff0383f` abgeglichen: alle 1.665 Dateien außerhalb des freigegebenen Onboarding-Scopes stimmen mit dem veröffentlichten Quellsnapshot überein. Die neueren Netto-Änderungen einschließlich Krankenkassenauswahl, Darmstadt-Zusatzversorgung und stabiler Rückkehr in die Gehaltsansicht bleiben erhalten.
- Der Quellstand entspricht weiterhin dem getesteten SHA-256. Der Fingerprint wurde unter den aktuellen Preview-Umgebungsvariablen erneut geprüft und stimmt mit Build 33 überein. Der Preview-Kanal ist aktiv und zeigt auf die neue Gruppe.
- Das ausgelieferte Manifest bestätigt Update-ID, Runtime, App-ID `com.pflegeshift.app.internal` und Bundle-Hash. Das mit den Expo-Asset-Headern heruntergeladene CDN-Bundle ist bytegleich mit dem lokalen Preview-Export: 8.184.394 Bytes, SHA-256 `9b4a12ed6f2a16a15fe12e32d7785a4ea636bf1e8e36d170decf496d05dff956`.
- Der erneute Export unterscheidet sich vom ersten Abnahmeexport ausschließlich im temporären Compilerdateinamen und dessen gültiger Hermes-Prüfsumme. Der übrige Bytecode ist vollständig identisch; der Vergleich liegt in `artifacts/onboarding-abnahme/ota-preflight.json`. Ein erster CDN-Abruf ohne die Protokoll-Asset-Header lieferte HTTP 403; mit diesen Headern ist er erfolgreich (HTTP 200).
- Veröffentlichungsnachweis: `artifacts/onboarding-abnahme/ota-publication-verification.json`; Kanalnachweis: `ota-channel-after.json`; Quellabgleich: `preview-source-preservation.json` im selben Verzeichnis. Diese lokalen Prüfbelege sind Git-ignoriert.
- Auf dem iPhone Build 33 vollständig schließen, öffnen, etwa 15 Sekunden warten, erneut schließen und wieder öffnen. Vor der Abnahme bestätigen, dass die neue Update-ID geladen ist. Die Geräteabnahme bleibt offen.

## Geräteprotokoll

Vor Beginn ausfüllen:

| Merkmal                 | Wert                                                        |
| ----------------------- | ----------------------------------------------------------- |
| iPhone / iOS            | Offen                                                       |
| App-Variante und Build  | internal / preview / iOS / Build 33                         |
| Erwartete Update-ID     | `01a12906-29d4-7855-a5dc-e6cb631b17b1`; am Gerät bestätigen |
| Kandidatenbasis         | `8dec08e1b9dd8f6fe13666b997d7e8ae4596ae05` plus Prüfscope   |
| Nativer iOS-Fingerprint | `03d174d668f0ea5f757958dccf853632762c554d`                  |
| Datum / prüfende Person | Offen                                                       |
| Darstellung             | Hell, Dunkel, größte unterstützte Schrift und VoiceOver     |

Vor dem Test sicherstellen, dass Build 33 die oben genannte Update-ID lädt, und den geladenen Stand dokumentieren. Die Veröffentlichung allein bestätigt noch keine Übernahme durch das iPhone.

Für den Erststart eine separate Testinstallation ohne Profil verwenden. Für Bestandsfälle ein Testprofil verwenden; persönliche Kalenderdaten nicht für einen Erststart löschen. Ein Onboarding-Testmodus prüft die Darstellung und schreibt kein Profil.

## Reproduzierbare Testdaten

Für die Prüffälle: Gesundheitswesen, Nordrhein-Westfalen, 30 Wochenstunden, keine regionale Sonderregel, Zeitzone Europe/Berlin, Monat Oktober 2026. Die drei Prüfangaben zunächst auf Weiß ich nicht setzen. Dienste im Testkalender anlegen:

| Datum      | Dienst | Zeit                    | Pause  | Zweck                                  |
| ---------- | ------ | ----------------------- | ------ | -------------------------------------- |
| 11.10.2026 | Früh   | 07:00–15:00             | 30 min | Sonntagsarbeit und offene Zulässigkeit |
| 12.10.2026 | Nacht  | 21:30–06:00 am Folgetag | 30 min | Offener Nachtarbeitsstatus             |
| 13.10.2026 | Früh   | 07:00–15:00             | 30 min | Kurze Ruhezeit nach der Nacht          |

Erwartung: offene Grundlagen erscheinen getrennt; die kurze Ruhezeit bleibt als tatsächliche Auffälligkeit sichtbar. Danach nacheinander Sonn-/Feiertagsarbeit = Nein, dann Ja setzen; die kritische Feststellung zur Zulässigkeit reagiert darauf. Gesamtarbeitszeiten = Nein hält die Grundlage eingeschränkt. Andere rechtliche Hinweise zur Datenabdeckung können zusätzlich erscheinen und bleiben sichtbar.

Für die Region den Arbeitsort im Testprofil nach Bayern ändern, die Region auf Weiß ich nicht belassen und im Ergänzungsablauf „Keine regionale Sonderregel“ auswählen. Nach Speichern und Neustart muss die bewusste Auswahl erhalten sein.

Für die Tarifpfade jeweils ein frisches Testprofil verwenden; 30 Wochenstunden eignen sich für alle folgenden Eingaben:

| Tarif        | Auswahl für den Test                                         |
| ------------ | ------------------------------------------------------------ |
| TVöD-P       | P8, Stufe 4, BT-K, anderes Tarifgebiet                       |
| TVöD-E       | E8, Stufe 4, BT-K, anderes Tarifgebiet                       |
| TV-L KR      | KR8, Stufe 4, West                                           |
| TV-H KR      | KR5, Stufe 1a, tarifliche Vollzeit 38,5 h; Arbeitsort Hessen |
| TV-UK Pflege | PUK8, Stufe 7; Arbeitsort Baden-Württemberg                  |
| TVAöD Pflege | 2. Ausbildungsjahr, BT-K, anderes Tarifgebiet                |
| TVA-L Pflege | 3. Ausbildungsjahr, Ost                                      |

Zusätzlich TVöD-P P6/Stufe 1 zu P7 wechseln: Stufe 1 darf dort nicht übernommen werden. Manuelles Brutto: `3.450,50`; die Zusammenfassung und gespeicherte Grundlage zeigen 3.450,50 Euro. Bei Später bleibt die Gehaltsgrundlage offen und später einrichtbar.

Netto im Tarif-Testprofil über die Gehaltsfunktion für Oktober 2026 einrichten. Die Netto-Angaben und das Ergebnis vor dem Ergänzen der Prüfangaben dokumentieren; nach Ergänzen, Neustart und Offline-Öffnung müssen dieselben Angaben erhalten sein. Vergleichsbasis ist dasselbe Profil mit unveränderten Diensten und Gehaltswerten.

## Kurzer Abnahmelauf

1. Erststart: Willkommen → Berufsbereich → Arbeitszeit/Arbeitsort → Gehalt → Zusammenfassung. Zurück erhält Eingaben; „Zum Kalender“ speichert einmal.
2. Gehalt: jeweils Nach Tarif, Eigenes Brutto und Später prüfen. Tariffelder beginnen ohne geratenen Tarif; fehlende Pflichtangaben führen zum betroffenen Feld. Ein Tarifwechsel entfernt unpassende Gruppe/Stufe.
3. Prüfung: Bestandsprofil mit unbekannten Prüfangaben öffnen. „Prüfung eingeschränkt“ und „Angaben ergänzen“ sind sichtbar; offene Grundlagen erhöhen nicht den Zähler tatsächlicher Auffälligkeiten.
4. Ergänzen: Ja, Nein und Weiß ich nicht bewusst wählen. „Später“ verlässt ohne Speichern; Zurück erhält Antworten. Beim Speichern bleiben Gehalt, Tarif und Wochenstunden erhalten.
5. Feiertagsregion: Bayern mit unbekannter Region öffnen, letzte Frage beantworten und speichern. Erfolgreiche Rückkehr ohne Fehler; Region bleibt nach Neustart erhalten.
6. Auffälligkeit: Eine kurze Ruhezeit bleibt neben der eingeschränkten Grundlage sichtbar. „Nein“ zur Zulässigkeit von Sonn-/Feiertagsarbeit bleibt bei einem Sonntagsdienst eine kritische Feststellung.
7. Monat/Jahr: Derselbe Datensatz erscheint konsistent. Monate mit offenen Grundlagen sind im Jahr erreichbar; freiwillige Planung ausblenden verändert gesetzliche Feststellungen nicht.
8. Netto: Nach Tarifstart die Netto-Einrichtung in der Gehaltsfunktion ausführen. Danach Prüfangaben ergänzen und kontrollieren, dass Netto-Konfiguration und Gehaltsbasis erhalten bleiben. Erneut starten und offline öffnen.
9. Darstellung: Alle drei Gehaltspfade und die letzte Prüfprofilfrage in Hell/Dunkel prüfen. Mit großer Schrift bleibt der Inhalt scrollbar, der Hauptbutton erreichbar und die Tastatur verdeckt keine benötigte Aktion. VoiceOver liest Frage, Auswahlzustand und Aktion verständlich vor.

## Erforderliche Nachweise

- Onboarding: Arbeitszeitseite, Tarifseite und Zusammenfassung; mindestens einmal mit großer Schrift und sichtbarer Tastatur.
- Prüfung: eingeschränkter Monat; derselbe Monat mit tatsächlicher Auffälligkeit; Jahresliste mit offenem Monat.
- Prüfprofil: letzte Regionfrage, erfolgreiche Rückkehr und gespeicherte Werte nach Neustart; kurze Aufnahme für VoiceOver und Zurück/Später.
- Gehalt: Netto-Ergebnis vor und nach dem Ergänzen der Prüfangaben.

## Ergebnis und Freigabe

| Fall                                                  | Ergebnis | Nachweis |
| ----------------------------------------------------- | -------- | -------- |
| Erststart und Speicherung                             | Offen    |          |
| Tarif / manuelles Brutto / Später                     | Offen    |          |
| Eingeschränkte Prüfung und tatsächliche Auffälligkeit | Offen    |          |
| Ergänzen / Zurück / Später / Region speichern         | Offen    |          |
| Monats- und Jahresdarstellung                         | Offen    |          |
| Netto-Erhalt / Neustart / offline                     | Offen    |          |
| Hell/Dunkel / große Schrift / Tastatur / VoiceOver    | Offen    |          |

Geräteabnahme: offen. Ein technisches Gate, Export oder eine technisch verifizierte OTA-Veröffentlichung allein bestätigt diese Fälle nicht.
