# Paket 5: Jahresgehalt übersichtlich gliedern

## Task-Vertrag

- Ziel: Jahresgehaltsdetails in Jahressumme, enthaltene weitere Gehaltsbestandteile und zwölf Monatsziele gliedern. Doppelten Einleitungskasten durch eine kompakte Zusammenfassung mit Jahr ersetzen.
- Nicht-Ziele: neue Berechnung, andere Beträge, Steuer-/Tariflogik, Netto, Exportinhalte, globale Karten-/Theme-Änderungen, native Integration, Premium.
- Plattform: bestehende iOS-Preview Build 49, APP_VARIANT=internal, Kanal preview; Luftig beibehalten.
- Scope: annual-report-view.tsx, vorhandener annual-report-view.component.test.tsx, gezielte Quellenfreigabe und dieses Dokument (vier Dateien).
- Expo: ~57.0.31; Referenz https://docs.expo.dev/versions/v57.0.0/.
- Abnahme: Jahressumme/Teilsumme und x von 12 eindeutig; fehlende Beträge bleiben fehlend; keine Hochrechnung; manuelles Brutto ohne erfundene Tarifbestandteile; zwölf Monatsziele und Zeitzuschläge öffnen dieselben Ziele. Hell/Dunkel, große Schrift, Scrollende und Rücknavigation auf iPhone prüfen.
- Freigabe: Implementierung und eigene Preview-OTA. Kein Commit, Push, PR/Merge oder TestFlight vor separater Freigabe beziehungsweise Geräteabnahme.

## Darstellung

Oben steht eine einzelne Zusammenfassung „Gehaltsprognose [Jahr]“ mit bestehender Bruttosumme, Abdeckung und bei Teiljahren dem Hinweis, dass nur verfügbare Monate enthalten sind. Darunter folgen „Weitere Gehaltsbestandteile“ mit den vorhandenen Zuschlags-, Überstunden- und Zulagenwerten sowie „Nach Monaten“ mit den bisherigen Monatszeilen. Diese Bestandteile werden ausdrücklich als im Brutto enthalten bezeichnet; sie sind keine vollständige Aufschlüsselung des Jahresgrundentgelts. Bei manuellem Brutto entfällt diese tarifliche Karte. Bestehende Kartenprimitiven erhalten die separate Luftig-Geometrie.

Geräteabnahme steht aus. Auslieferungsnachweis folgt nach bestandenen Prüfungen.

## Preview zur Abnahme

Paket 5 ist auf Preview veröffentlicht. Beide vollständigen verify:fast-Prüfungen bestehen mit jeweils 10.419 allgemeinen Tests und 1.862 Komponentenfällen; zusätzlich 14 fokussierte Jahresansichtsfälle. Der erste fokussierte Sandbox-Aufruf scheiterte vor dem ersten Test am Jest-Cache (EPERM); unveränderter Wiederholungslauf mit Cache-Zugriff erfolgreich.

- Preview-Gruppe: edddcca1-0e2a-49b3-8574-4fe1bbb12d48
- Update-ID: 01a1b30f-612b-799b-8550-419f7397f179
- Runtime: 402e757d98ca799660ce5dd15a24bd999cf690eb
- Quellfingerprint: 1a3b49b7e0969aae614466f6afbcc19d32dd09481030ed19997a5e0e2c068a8e
- Bundle-SHA256: 867acb188917df3a50b8974e4c11c9c9c90f6f891104be88bf7be05bf49821ef
- Bundle und 34 Assets bytegenau vom Server verifiziert.

Luftig erhalten. Keine neue native Version oder Production-/TestFlight-OTA. Paket 5 bleibt uncommitted; Geräteabnahme steht aus. Prüfen: Auswertung > Jahr > Gehalt, Zusammenfassung/Bestandteile/Monate in Hell und Dunkel, große Schrift, Januar/Dezember und Rückkehr ins gewählte Jahr.

## Geräteabnahme und Git-Freigabe

Der Nutzer hat Paket 5 auf dem iPhone ausdrücklich in Hell und Dunkel abgenommen: „Ja passt in Hell und Dunkel, Paket 5 ist abgenommen. Bitte committen und mit GitHub abgleichen. Luftig weiterhin beibehalten.“

Die Abnahme gehört zur Preview-Gruppe edddcca1-0e2a-49b3-8574-4fe1bbb12d48 und Update-ID 01a1b30f-612b-799b-8550-419f7397f179. Die zuvor dokumentierte offene Paket-5-Abnahme ist damit abgeschlossen. Vor dem Commit wurden die aktiven OTA-Bytes einschließlich 34 Assets, das vollständige Quellarchiv und die Nachweise beider vollständigen Prüfläufe erneut abgeglichen. Der finale Dateiumfang beträgt drei Dateien; die bestehenden Tests wurden unverändert ausgeführt.

Der Funktionsstand wird über PR und grüne CI integriert. Der abgenommene Luftig-Stand wird separat auf GitHub gesichert. Die bestehende Preview-OTA bleibt unverändert; keine Production-/TestFlight-Veröffentlichung.
