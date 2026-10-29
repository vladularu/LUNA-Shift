# Kalender-Monatswechsel: Korrektur nach iPhone-Video

## iPhone-Abnahme und freigegebene Lieferung

Der Nutzer hat am 29.10.2026 die korrigierte Preview-OTA
`ff736820-94d3-4382-8590-adeab9411608` mit „Ja passt“ abgenommen und Commit,
Push, PR, Merge sowie die TestFlight-OTA ausdrücklich freigegeben.
Die Abnahme gilt für den gezeigten Monatswechsel; die TestFlight-Geräteabnahme
folgt nach der gesonderten Production-Veröffentlichung.

Die Kalenderänderung wird für die Git-/TestFlight-Lieferung auf master `88b7b69`
aufgesetzt. Die Preview enthielt zusätzlich den noch nicht gemergten
Sonderdienste-Commit `d7d63ec`; dieser gehört nicht zum Kalender-PR. Alle
abgenommenen Kalenderdateien bleiben beim Wechsel der Basis inhaltsgleich.
Die folgenden Prüf- und Preview-Angaben dokumentieren den Stand vor der
abschließenden Git-/TestFlight-Lieferung.

## Aktueller Auftrag und Umfang

Am 29.10.2026 hat der Nutzer nach dem zweiten Bildschirmvideo die Korrektur
und eine weitere iPhone-Preview-OTA freigegeben. Der Monatsname soll wie in
der Referenz Teil der nativen Monatsseite sein. Die erste OTA mit separater
Titelrolle ist damit als visuell nicht abgenommen dokumentiert.

Zielplattform: iOS Preview, Build 44. Branch: `codex/kalender-monatswechsel`.
Dateiscope: Kalenderheader, Monatsseite, gemeinsame Szenengeometrie, Kalender-
Overlay, bestehender Headerbaustein und fokussierte Tests (14 Dateien inklusive
Dokumentation). Keine Fachlogik, Datenmigration, native Konfiguration oder
TestFlight-Lieferung. Die vorhandene Sonderdienste-Basis `d7d63ec` bleibt erhalten.

## Korrigierte Umsetzung und Abnahme

- Jede Monatsseite besitzt ihren eigenen Titel. Titel und Tage werden zusammen
  vom unveränderten nativen Pager bewegt, ohne separate Offset-Interpolation.
- Die feste Steuerleiste bleibt an ihrem bisherigen Ort. Ihr unsichtbarer
  Monatstitel reserviert nur das bisherige Layout und ist aus VoiceOver entfernt.
- Der Pager beginnt unterhalb der Safe Area und überlappt den gemessenen
  Headerbereich. Tage, Wochentage, Jahreskacheln und Trefferflächen bekommen
  denselben oberen Versatz; die bisherige Rastergröße bleibt erhalten.
- Seitentitel verwenden den vorhandenen Headerbaustein mit identischer Schrift,
  dynamischer Höhe und Platz für die feste Steuerleiste. Benachbarte Titel sind
  sichtbar, werden aber nicht zusätzlich von VoiceOver vorgelesen.
- Die Kalender-Overlays liegen auch außerhalb des nativen iOS-Overlays über der
  nun festen Steuerleiste.
- „Heute“, entfernte Monatsauswahl, teilweise Wischbewegung und sofortige Umkehr
  müssen Titel und Tage als zusammengehörige Seite erhalten. Jahreswechsel,
  Jahresansicht und große Schrift werden gezielt geprüft.
- Reale iPhone-Abnahme nach dieser OTA bleibt offen; Tests ersetzen sie nicht.

## Ergebnis der Korrektur

Veröffentlicht am 29.10.2026 um 18:12 Uhr (Europe/Berlin):
[Preview-Gruppe ff736820-94d3-4382-8590-adeab9411608](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/ff736820-94d3-4382-8590-adeab9411608),
iOS-Update `01a188a5-dd58-71b7-9a89-6947a8cb09a3`.
Runtime `b99c3cf0dd56e6b1bb126d195f21c665de57760b` stimmt mit dem frisch
abgefragten Preview Build 44, Kanal `preview`, Bundle-ID
`com.pflegeshift.app.internal` überein.

Die Prüfschritte sind abgeschlossen:

- 514 Vitest-Dateien / 9.940 Tests bestanden.
- Im vollständigen Jest-Lauf bestanden zunächst 166 von 167 Suiten. Der
  Kalenderbildschirm-Test mockte den gesamten Header und kannte den neu
  ausgelagerten Mess-Hook nicht. Der Mock übernimmt jetzt die echten Exporte.
  Alle 35 betroffenen Tests bestanden im anschließenden gezielten Lauf; damit
  sind insgesamt 167 Suiten / 1.565 Komponententests geprüft.
- Nach dieser reinen Testkorrektur wurden Typprüfung, Lint, Formatierung und
  sämtliche verbleibenden Script-Prüfungen aus `verify:fast` erfolgreich beendet.
  Es wird kein einzelner unterbrechungsfrei grüner Gesamtlauf behauptet.
- Die anfängliche Überschreitung des Dateibudgets wurde durch Verlagerung der
  Header-Höhenmessung in den Header behoben; die Architekturprüfung besteht.
- Lokaler Export, Live-Manifest und authentifizierter CDN-Download stimmen
  überein (beide HTTP 200): SHA-256
  `a2c245d7a8f48e4590a845bb5f4eb1a78a0789d720f488795778b360c2cf42fe`,
  12.287.292 Bytes. Alle 1.882 erfassten Quellen sind nach Veröffentlichung
  unverändert. Nach dem Export wurde ausschließlich der genannte Test-Mock
  korrigiert; sämtliche exportierten App-Quellen blieben unverändert.

Nachweise liegen unter `artifacts/calendar-month-page/`: `verify-fast-final.log`,
`focused-screen.log`, `remaining-gates.log`, `export-final.log`,
`environment-fingerprint.json`, `published-update.json` und
`delivery-verification.json`. Die geprüften Preview-Vorgänger sind erhalten.
Git-Commit/Push und TestFlight wurden nicht ausgeführt. Reale iPhone-Abnahme
bleibt offen: schließen, öffnen und 15 Sekunden warten, nochmals schließen und
öffnen; langsame Wischbewegung, Umkehr, „Heute“ und Jahresansicht prüfen.

Die Graft-Abfragen lieferten mindestens 12.382 dokumentierte eingesparte Tokens;
wegen eines abgeschnittenen Abfrageprotokolls ist dies eine Untergrenze.

Die folgenden Abschnitte dokumentieren die inzwischen ersetzte erste Umsetzung.

---

# Monatswechsel mit mitlaufendem Titel

## Auftrag und Scope

Am 29.10.2026 hat der Nutzer die Umsetzung des vertikalen Monatswechsels nach
seinem Bildschirmvideo und eine OTA beauftragt. Ziel ist die iPhone-Preview
gemäß AGENTS.md und WORKFLOW.md. Basis: master `88b7b69`, Branch
`codex/kalender-monatswechsel`, Expo `~57.0.31`. Vor der Veröffentlichung wurde
die Basis auf die inzwischen veröffentlichte Sonderdienste-Preview `d7d63ec`
vorgezogen. Die Kalenderänderung bleibt separat als uncommitteter Neun-Dateien-Scope.

Die Monatsseiten folgen bereits nativ dem Finger und rasten auf Monatsgrenzen
ein. Neu folgt auch der Monatsname demselben nativen Scrollwert. Vorher sprang
er beim Überschreiten der halben Seite um. Jetzt schieben sich der ausgehende
und eingehende Titel passend zum Seitenfortschritt nach oben bzw. unten; beim
Umkehren läuft die Bewegung unmittelbar zurück. Es gibt keine nachlaufende
Zeit- oder Federanimation. Die Bedienelemente und die Tabnavigation stehen fest.

Dateiscope: Kalender-Pager, Kalender-Header, Kalender-Screen, neue Titelkomponente,
optionaler Titelinhalt im gemeinsamen Screen-Header, zugehörige Tests einschließlich
der bisherigen Schriftgrößenregel für einzeilige Kalenderüberschriften und diese
Dokumentation. Die vorhandene Monatsgeometrie, Datenberechnung, native
Konfiguration und Abhängigkeiten bleiben unverändert. Der Wechsel zur
Jahresansicht behält seinen vorhandenen Übergang.

## Abnahmekriterien

- Langsam vor- und zurückziehen: Titel und Monatsseiten folgen ohne separaten
  Nachlauf; loslassen rastet auf einen vollständigen Monat ein.
- Mehrfach schnell wechseln, während des Ziehens umkehren und Dezember/Januar
  überqueren: Datum und Überschrift passen zusammen.
- „Heute“, direkte Monatsauswahl und geänderte Fensterhöhe setzen auch die
  Titelposition zurück; alte Scrollereignisse übernehmen keinen falschen Monat.
- Ein zugänglicher Monatsname für VoiceOver; Nachbartitel werden nicht vorgelesen.
- Große Schrift erhält dieselbe Titelhöhe und vollständige zugängliche Beschriftung.
- Bei „Bewegung reduzieren“ wechselt der Monatsname ohne zusätzliche Bewegung.
- Fokussierte Tests und `npm.cmd run verify:fast` bestehen.
- Die reale iPhone-Sichtprüfung erfolgt nach Installation der Preview-OTA.

## OTA-Grundlage

Live geprüft: Preview Build 44 (`812ea1a9-a4c0-48f3-b01a-72011cdad43e`),
Kanal/Branch/Environment `preview`, `APP_VARIANT=internal`, Runtime
`b99c3cf0dd56e6b1bb126d195f21c665de57760b`. Derselbe Fingerprint wurde im
isolierten Checkout neu berechnet. Vorherige Preview-Gruppe:
`8f40477b-0fed-4d78-b13e-e1d218de7890`; deren Auswahlleistenänderung ist in der
master-Basis enthalten. Während der Prüfung erschien die Sonderdienste-Gruppe
`08025256-efbc-4b06-86a0-a9ca8df2c864`. Deren Commit `d7d63ec` wurde unverändert
als neue Basis übernommen, damit die OTA die gerade veröffentlichten Funktionen
einschließlich ihrer Datenmigration erhält. Geräteabnahme ist offen; Git-Lieferung und TestFlight gehören
nicht zu dieser Preview-Veröffentlichung.

SDK-Referenzen: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/),
[Updates](https://docs.expo.dev/versions/v57.0.0/sdk/updates/).

## Technische Prüfung

`VITEST_MAX_WORKERS=1 npm.cmd run verify:fast` ist auf der vollständigen
Preview-Basis `d7d63ec` mit der Kalenderänderung bestanden: 514 Vitest-Dateien
mit 9.937 Tests, 167 Jest-Suiten mit 1.564 Tests sowie alle zusätzlichen
Script-Prüfungen, Typprüfung, Lint, Formatierung und Diff-Prüfung.

Der anfängliche Lint-Befund zur Referenzübergabe wurde durch einen getrennten
Adapter für die native Scroll-Anbindung behoben. Die neue Titelkomponente
übernimmt die bereits erlaubte einzeilige Kalenderüberschrift mit skalierter
Höhe und vollständiger VoiceOver-Beschriftung; die Schriftgrößenprüfung kennt
diesen zusätzlichen Ort jetzt ausdrücklich. Ein unveränderter Worklet-Test
erreichte im parallelen Lauf sein Zeitlimit, bestand aber isoliert sowie im
vollständigen seriellen Lauf ohne Änderung seines Zeitlimits.

Der iOS-Export wurde mit dem EAS-Preview-Environment erstellt. 1.882 Quell- und
Konfigurationsdateien sind per SHA-256 festgehalten. Protokolle, Fingerprint,
Quellmanifest und Bundle liegen lokal unter `artifacts/calendar-month-swipe/`.
Die echte iPhone-Abnahme ist weiterhin offen.

## Veröffentlichte Preview-OTA

Veröffentlicht am 29.10.2026 um 16:29:23 UTC:
[Gruppe e0a65cdf-0379-4a24-9b8d-97a8591d4f9b](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/e0a65cdf-0379-4a24-9b8d-97a8591d4f9b),
iOS-Update `01a1887e-a366-7147-ad77-46de8bcf3e4e`. Das vorab exportierte Bundle
wurde mit `--skip-bundler` unverändert hochgeladen. Die Runtime stimmt mit
Preview Build 44 überein. Das EAS-Listing bestätigt die neue Gruppe unmittelbar
vor der erhaltenen Sonderdienste-Preview.

Das Live-Manifest und der authentifizierte CDN-Download liefern HTTP 200. Lokaler
Export, Manifest und heruntergeladenes Bundle stimmen überein: SHA-256
`2b0af94573a6b54c05468b2bf6469757df1a6dcf6adf61714551058c228755a3`,
12.287.340 Bytes. Alle 1.882 erfassten Quell-/Konfigurationsdateien sind nach
Veröffentlichung unverändert. Nachweis: `delivery-verification.json` im lokalen
Artefaktordner.

Für die Sichtprüfung die Preview vollständig schließen, öffnen und etwa
15 Sekunden warten, nochmals schließen und öffnen. Langsames Ziehen, sofortiges
Umkehren, Dezember/Januar, „Heute“, Jahresansicht und große Schrift prüfen.
Die technische Auslieferung ist bestätigt; eine reale iPhone-Abnahme wurde
noch nicht behauptet.
