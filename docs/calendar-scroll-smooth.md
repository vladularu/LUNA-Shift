# Fluessiger Monatswechsel beim Wischen

## Auftrag und Grenzen

Ziel: Aufbauarbeit aus der laufenden nativen Monatsbewegung entfernen.
Plattform: iPhone, Expo SDK 57 (`~57.0.31`). Grundlage ist die auf dem iPhone
bestaetigte Preview-OTA `9a37a2ac-ea18-4d8a-bb34-03487680853e` mit Today-Ruecklauf.
Branch: `codex/kalender-scroll-fluessig` auf `5727449` mit den bereits freigegebenen
lokalen Today-Dateien. Der akzeptierte Ausgangszustand ist unter
`artifacts/calendar-scroll-smooth/accepted-before/` gesichert.

Dateiscope dieser Korrektur: `calendar-stable-pager.tsx`, dessen bestehender
Komponententest, ein gezielter `calendar-scroll-work.component.test.tsx` und diese
Dokumentation. Kalendergestaltung, Daten, Fachlogik, native Konfiguration und die
Today-Grenze (1–2 Monate animiert, ab 3 direkt) bleiben erhalten.

## Diagnose und Abnahme

Der bisherige Pager verschiebt sein vorbereitetes Fuenfmonatsfenster bereits
beim Ueberschreiten der halben Seite in `onScroll`. Dadurch wird waehrend einer
laufenden Wischbewegung ein kompletter eintretender Monat aufgebaut und der
austretende Monat entfernt. Auch das Zurueckwischen um dieselbe Schwelle
wiederholt diese Arbeit. Der gezielte Komponententest zaehlt die dadurch
ausgeloesten Mounts und Unmounts. Dies belegt vermeidbare Arbeit, ersetzt aber
keine Messung von iPhone-Frames.

Abnahmekriterien: keine zusaetzlichen Monats-Mounts oder -Unmounts beim Hin- und
Herwischen um die Monatsschwelle; vorhandene Seiten bleiben verfuegbar; weitere
Nachbarn werden nach Bewegungsende vorbereitet; eine neue Geste verwirft alte
Vorbereitung. Jahreswechsel, Jahresansicht, ferne Spruenge, Today und wiederholtes
Wischen muessen weiterhin korrekt sein. `verify:fast` und fokussierte Tests
muessen bestehen. Die erneute Sichtpruefung erfolgt anschliessend auf dem iPhone.

## Korrektur und Vergleich

Bereits vorbereitete Seiten bleiben waehrend der laufenden Bewegung bestehen.
Die Vorschau des sichtbaren Monats wird weiter gemeldet. Erst nach einem echten
nativen Bewegungsende verschiebt sich das begrenzte Fenster; weitere Randseiten
werden anschliessend mit abbrechbarer Idle-Arbeit vorbereitet. Ein neuer
Wischbeginn macht auch bereits zugestellte alte Idle-Callbacks ungueltig.

Sofortige Vorbereitung bleibt fuer den Kaltstart, eine schnelle Folgegeste ohne
vorherige Ruhephase oder einen nativen Sprung ausserhalb der geladenen Seiten
erhalten. Dadurch sind beide naechsten Wischziele verfuegbar. Die bereits
bestaetigte Today-Animation bereitet ihren Weg unveraendert vor.

Vergleichssequenz: vier native Scroll-Ereignisse auf den Seitenpositionen
`24.6`, `24.4`, `24.6`, `24.4` waehrend einer einzigen Geste.

| Aufbauarbeit waehrend der Geste | Vorher | Nachher |
| ------------------------------- | ------ | ------- |
| Monatsansichten neu aufgebaut   | 4      | 0       |
| Monatsansichten entfernt        | 4      | 0       |

Nachweise: `artifacts/calendar-scroll-smooth/baseline-red.log` und
`focused-clean-final.log`. Der gezielte Schwellentest ist zuerst am bisherigen
Verhalten fehlgeschlagen und besteht mit der Korrektur. Nach der kontrollierten
Idle-Zustellung wird genau eine neue Randseite vorbereitet. Schnelle Folgen in
beide Richtungen bleiben auch bei ausbleibender Idle-Zeit auf hoechstens fuenf
Monate begrenzt.

## Pruefergebnis vom 29.10.2026

- Vier fokussierte Kalender-Suites: 78 Tests bestanden. Die gezielten
  Arbeitslasttests decken Schwellenwechsel, nachgelagerte Vorbereitung,
  abgebrochene Callbacks und schnelle Folgen ohne Idle-Zeit ab.
- `VITEST_MAX_WORKERS=1 npm.cmd run verify:fast`: Exit 0. Typpruefung, Lint,
  Formatpruefung, 511 Vitest-Dateien mit 9.911 Tests, 167 Jest-Suites mit
  1.585 Tests und alle weiteren Skriptpruefungen bestanden.
- Vollstaendiges Protokoll:
  `artifacts/calendar-scroll-smooth/verify-fast-complete.log`.
- Der akzeptierte Ausgangsstand ist ausserhalb des Pagers und seines Tests
  identisch. `git diff --check` besteht; der Checkout enthaelt die neun bereits
  akzeptierten Today-Dateien und zwei neue Dateien dieser Korrektur.

Die tatsaechliche Fluessigkeit ist noch auf dem iPhone gegen den bestaetigten
Preview-Stand zu vergleichen. Mit „ja ota“ ist die Veroeffentlichung dieser
Korrektur im bestehenden iPhone-Preview-Kanal freigegeben.

## Freigegebene iPhone-Preview-OTA

Veroeffentlicht am 29.10.2026 um 23:12 Uhr (Europe/Berlin):

- Kanal/Branch und Environment `preview`, `APP_VARIANT=internal`, nur iOS.
- Update-Gruppe `06bee579-7d47-4cd5-abe4-0c76cf2fab34`, Update-ID
  `01a189b8-9611-7d81-ac71-51bf18c5ae87`.
- Runtime `b99c3cf0dd56e6b1bb126d195f21c665de57760b`, passend zu Preview
  Build 44 (`812ea1a9-a4c0-48f3-b01a-72011cdad43e`).
- Grundlage ist die zuvor bestaetigte Preview-Gruppe
  `9a37a2ac-ea18-4d8a-bb34-03487680853e`. Nur Pager und Pager-Test werden
  ersetzt; Regressionstest und diese Dokumentation sind neu. Die uebrigen
  2.234 veroeffentlichten Dateien bleiben identisch. Today-Ruecklauf, Profilbild
  und Rufbereitschaft sind dadurch im neuen Preview-Bundle enthalten.
- Der isolierte Auslieferungsstand besteht die Typpruefung und alle 78 Tests
  der vier betroffenen Kalender-Komponentensuites. Veroeffentlicht wurde der
  zuvor gepruefte Export mit `--skip-bundler`.
- Manifest und CDN-Bundle liefern HTTP 200. Export, Manifest-Hash und
  heruntergeladenes Bundle sind identisch: 12.325.908 Bytes, SHA-256
  `f25737dd193d5b56e22f5b79e028f66d3a8ba11f2e12c15187a84dce27c9f89d`.
  Alle 52 Manifest-Assets passen zum Export. Die 2.238 eingefrorenen
  Quelldateien blieben zwischen Export und Auslieferungspruefung unveraendert.
- Nachweise unter `artifacts/calendar-scroll-smooth/`:
  `preview-preservation.json`, `preview-published.json`,
  `preview-delivery-verification.json`, `preview-export.log`,
  `preview-typecheck.log` und `preview-components-final.log`.

Geraetepruefung: Preview-App vollstaendig schliessen, oeffnen und 15 Sekunden
warten, erneut schliessen und oeffnen. Danach mehrere Monatswechsel zuegig in
beide Richtungen und das Abbrechen einer Teilbewegung pruefen. Die sichtbare
Fluessigkeit auf dem iPhone ist noch nicht bestaetigt.

## Zielreferenz vom 29.10.2026 um 23:31 Uhr

Die neue Nutzerreferenz `ScreenRecording_10-29-2026 23-31-11_1.mov` zeigt
Supershift: Monatsname und Kalender folgen dem Finger zusammen; Teilbewegungen
gleiten weich zum bisherigen Monat zurueck, groessere Gesten wechseln die Seite.
Die Aufnahme ist 11,64 Sekunden lang (1290 x 2796, rund 59,52 aufgenommene Bilder
pro Sekunde). Uebersichten der Aufnahme liegen unter
`artifacts/calendar-video-reference-233111/`. Dies sind Eigenschaften der
Aufnahme und keine Messung der LUNA-Bildrate.

Im vorhandenen LUNA-Pager ueberschreibt `snapToInterval` das angeforderte
`pagingEnabled` auf iOS: React Native 0.86.3 reicht dadurch nativ
`pagingEnabled=false` weiter. Zusammen mit `disableIntervalMomentum` und
`decelerationRate=fast` entsteht eine andere Einrastbewegung als beim normalen
iOS-Seitenblaettern. Der neue Test verwendet den echten ScrollView-Wrapper und
weist diesen bisher verdeckten Unterschied nach.

Die Anpassung aktiviert auf iOS natives Seitenblaettern mit normalem Abbremsen.
Android behaelt seine bisherige Intervall-Konfiguration. Die gemessene
Viewporthoehe wird ohne Rundung uebernommen: Native Seitenpositionen muessen
auch bei nicht ganzzahligen Hoehen mit den Kalenderseiten uebereinstimmen. Zwei
zusaetzliche Screen-Faelle sichern den Dezember-/Januar-Wechsel mit gebrochener
Hoehe ab. Das begrenzte Vorladen und der bestaetigte Today-Ruecklauf bleiben
Bestandteil des Pagers.

Scope dieser Verfeinerung: Pager, Kalender-Screen, Screen-Test, ein neuer Test
fuer den echten nativen Wrapper und diese Dokumentation. Der vorherige
Preview-Quellstand ist unter `artifacts/calendar-scroll-reference/accepted-before/`
gesichert. `native-wrapper-red.log` und `fractional-height-red.log` dokumentieren
die beiden gezielten Fehlernachweise vor der Korrektur. Die Umsetzung erfolgt
auf dem bestehenden Aufgabenbranch. Mit „ja“ ist die angebotene Preview-OTA
fuer diese Verfeinerung am 30.10.2026 ausdruecklich freigegeben.
Die neue Bewegung muss auf dem iPhone gegen die Videoreferenz geprueft werden.

Fokussiert bestehen der echte ScrollView-Wrapper und die Kalenderansicht mit
44 Tests. Pager, Today und die vier Arbeitslastfaelle bestehen ebenfalls. Die
zwei neuen Faelle mit nicht ganzzahliger Hoehe waren vor der Korrektur rot und
bestaetigen danach den Wechsel von Dezember zu Januar.

### Nachpruefung zur Videoreferenz am 30.10.2026

- `npm.cmd run verify:fast` wurde ausgefuehrt: Typpruefung, Lint,
  Formatpruefung und 511 Vitest-Dateien mit 9.911 Tests bestanden.
- Im anschliessenden Jest-Gesamtlauf bestanden 167 von 168 Suites und 1.587 von
  1.588 Tests. Ein bereits vorhandener umfangreicher Pager-Integrationstest
  ueberschritt das unveraenderte 5-Sekunden-Limit. Der kombinierte Aufruf endete
  deshalb mit Exit 1; sein Rohprotokoll bleibt erhalten.
- Die betroffene Pager-Suite bestand im isolierten Wiederholungslauf alle 17
  Tests. Produktcode und Testzeitgrenze wurden dafuer nicht geaendert.
- Alle noch ausstehenden Skriptpruefungen aus `test:all` wurden danach in ihrer
  bestehenden Reihenfolge ausgefuehrt und bestanden. Die vorangegangenen
  erfolgreichen Pruefphasen wurden bei unveraendertem Quellstand beibehalten.
- Belege unter `artifacts/calendar-scroll-reference/`:
  `verify-fast-complete.log`, `pager-retry.log`, `remaining-checks.log` und
  `verification-result.json`. Die Quellhashes dokumentieren den geprueften Stand.
- Damit sind alle erforderlichen Pruefungen einschliesslich der isolierten
  Wiederholung bestanden. Die reale iPhone-Abnahme der neuen Bewegung steht
  aus; die freigegebene Preview-OTA wird dafuer vorbereitet.

Referenzen: [Expo SDK 57 Reanimated](https://docs.expo.dev/versions/v57.0.0/sdk/reanimated/),
[React Native 0.86 ScrollView](https://reactnative.dev/docs/0.86/scrollview#snaptointerval).

### Preview-OTA zur Videoreferenz am 30.10.2026

- Veroeffentlicht um 00:44 Uhr (Europe/Berlin), nach der ausdruecklichen
  Freigabe mit „ja“: Gruppe `e012595e-980a-4fb7-a73b-e414447ebd97`,
  iOS-Update `01a18a0c-a401-7afe-97e1-6e2240863f08` auf `preview`,
  `APP_VARIANT=internal`, EAS-Environment `preview`.
- Runtime `b99c3cf0dd56e6b1bb126d195f21c665de57760b` passt zu Preview Build 44.
  Der Export und die Typpruefung des endgueltigen kombinierten Stands bestanden.
- Waehrend der Vorbereitung erschien die Sonderdienste-UI-OTA
  `877c1f50-5fd9-4059-8b62-55e905b8a095`. Deren veroeffentlichter Quellstand
  wurde vor dem erneuten Export uebernommen. Von 2.254 eingefrorenen Quelldateien
  bleiben 2.249 gegenueber dieser Preview unveraendert. Die Kalenderkorrektur
  umfasst drei geaenderte Code-/Testdateien, diese Dokumentation und einen neuen
  Test. Die nachtraegliche Kanalpruefung bestaetigt die Sonderdienste-OTA als
  unmittelbaren Vorgaenger; es gab keine dazwischenliegende Veroeffentlichung.
- Auf diesem Quellstand bestanden die vier weiteren Kalender-Suites alle 64
  Tests. Alle 17 Pager-Faelle bestanden ueber unveraenderte Wiederholungslaeufe:
  Der normale Pager-Lauf bestand 15 von 17, ein Vergleichslauf mit voruebergehend
  hoeherer Prioritaet des eigenen Testprozesses 16 von 17. Jeder Timeout-Fall
  bestand im jeweils anderen Lauf. Ein separater Jahreswechsel-Fall bestand
  ebenfalls. Damit sind alle 81 fokussierten Faelle erfolgreich abgedeckt;
  ein vollstaendig gruener Pager-Gesamtlauf gelang in dieser Auslieferungsphase
  jedoch nicht. Die wechselnden 5-Sekunden-Timeouts bleiben als Einschraenkung
  dokumentiert. Der Retention-Timeout trat auch im zuvor vollstaendig geprueften
  Hauptarbeitsstand auf. Assertions, Produktcode und Testzeitgrenzen wurden
  fuer diese Nachpruefungen nicht geaendert.
- Live-Manifest und Bundle antworten mit HTTP 200 und liefern genau diese
  Update-ID. Das ausgelieferte Bundle entspricht dem lokalen Export:
  12.377.978 Bytes, SHA-256
  `0a39b4f561965c99f163301e5ec9e1a0575e94bd4e5b48515e859a4799d3fde1`.
  Alle 52 Manifest-Asset-Hashes stimmen mit dem Export ueberein.
- Belege unter `artifacts/calendar-scroll-reference/`:
  `preview-preservation.json`, `preview-components-verification.json`,
  `preview-components-pager-final.log`, `preview-components-rest-final.log`,
  `preview-components-priority.log`, `retention-main-control.log`,
  `preview-prepublish-verification.json`, `preview-published.json`,
  `preview-delivery-verification.json` und `preview-history-verification.json`.

Die technische Auslieferung ist bestaetigt. Die sichtbare Bewegung gegen die
Supershift-Videoreferenz muss auf dem iPhone abgenommen werden: Preview-App
vollstaendig schliessen, oeffnen und etwa 15 Sekunden warten, erneut schliessen
und oeffnen. Dann Teilbewegungen abbrechen, mehrere Monate in beide Richtungen
blaettern und den bestaetigten Heute-Ruecklauf pruefen.

### Abnahme und Git-/TestFlight-Auftrag am 30.10.2026

Der Nutzer hat die zuletzt veroeffentlichte Preview-Gruppe
`e012595e-980a-4fb7-a73b-e414447ebd97` mit „ja perfekt, gute aarbeit“ bestaetigt
und anschliessend Commit, Push, Pull Request, Merge und TestFlight-OTA
ausdruecklich freigegeben. Dies ist die Nutzerabnahme des Kalenderverhaltens in
der iPhone-Preview; es liegt keine instrumentierte Bildratenmessung vor.

Ziel der Lieferung: den bestaetigten kurzen Heute-Ruecklauf, das begrenzte
Vorbereiten der Monatsseiten und natives iOS-Seitenblaettern gemeinsam sichern.
Scope: die zehn geaenderten oder neuen Kalender-Code-/Testdateien sowie
`docs/calendar-today-return.md` und diese Dokumentation. Fachlogik, gespeicherte
Daten, Kalendergestaltung und native Konfiguration bleiben ausserhalb des
Auftrags. Ein neuer nativer Build ist nicht Teil dieser JavaScript-OTA.

Die Lieferung erfolgt auf `codex/kalender-scroll-fluessig`; vor dem Merge muessen
alle Pull-Request-CI-Pruefungen erfolgreich sein. Die Production-OTA wird gegen
den aktuellen TestFlight-Quellstand und die installierte Production-Runtime
abgeglichen. Abnahmekriterien sind der begrenzte Dateiscope, unveraenderte
abgenommene Kalender-Codehashes, erfolgreiche CI sowie gepruefte Runtime,
Kanalzuordnung und Bundle-Hashes. Die spaetere TestFlight-Geraeteabnahme bleibt
ein eigener Nachweis.
