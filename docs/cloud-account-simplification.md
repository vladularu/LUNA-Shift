# Einfacher Cloud-Ablauf

Ziel: Anmeldung direkt mit Apple/Google wie in der dunklen Teilen-Referenz; wenig Text, vorhandene Design-Tokens, automatische private Synchronisation ohne Einrichtungsseite. Gemeinsame Identität für Cloud und Teilen bleibt erhalten.

Plattform: iOS, bestehender Preview-Stand auf `codex/unified-cloud-account`. Die vier iPhone-Screenshots vom 18.10.2026 belegen die beanstandete Oberfläche.

Nicht-Ziele: E-Mail/Passwort, Domain/SMTP, neue native Module, Backend-Schema, Git-Auslieferung, Build und Store-Veröffentlichung. Das neue Preview-OTA wurde nach Abschluss der Korrektur gesondert freigegeben und ist unten dokumentiert.

Arbeitspaket 1: Sicheren automatischen Erstabgleich und Wiederanlauf umsetzen und testen. Neues Konto sichert automatisch, identische Stände werden übernommen, unabhängige Änderungen werden zusammengeführt. Unterschiedliche persönliche Angaben ohne gemeinsamen Ausgangsstand und Kontowechsel erfordern eine Auswahl. Bestehende Offline-, Konflikt-, Wiederherstellungs- und Kontowechselschutzmechanismen bleiben wirksam.

Arbeitspaket 2: Apple-/Google-Schaltflächen aus dem bestehenden Teilen-Design wiederverwenden; Konto-Anmeldung, Teilen und Sicherungszugang vereinfachen. Die bisherige Cloud-Einrichtungsseite wird durch eine Seite für frühere Sicherungen ersetzt. Auswahl- und Fehlermeldungen erscheinen nur bei tatsächlichem Bedarf.

Dateiscope: Private-Cloud-Runtime und Tests, Provider, Account-Oberfläche/Status und Tests, Sharing-Oberfläche/Anmeldeschaltflächen und Tests, Sicherungsoberfläche und Tests, dieses Dokument. Keine Änderungen an unabhängigen Arbeiten im Hauptcheckout. SHA-256-Ausgangsmanifest: `.expo/cloud-simplification/baseline.json`.

Abnahme: Anmeldung direkt ohne Konto-Zwischenschritt aus Teilen; gleicher Account; automatische erste Sicherung und nachfolgender Abgleich; automatische Übernahme/Zusammenführung ohne Datenverlust; tatsächliche Konflikte sichtbar und lösbar; frühere Sicherungen erreichbar; Light/Dark, große Schrift und Apple-/Google-Symbole innerhalb des bestehenden Design-Systems. Fokussierte Tests und `npm.cmd run verify:fast` müssen bestehen. Sichtbare iPhone-Abnahme und Live-Zwei-Geräte-Test bleiben separate Nachweise.

## Ergebnis vom 18.10.2026

- 14 Dateien gegenüber dem gesicherten Ausgangsstand geändert, einschließlich dieses Dokuments. Alle anderen Dateien sind unverändert; keine Änderungen an Abhängigkeiten oder nativer Konfiguration.
- Teilen und Einladungen bieten Apple/Google direkt an. Die Konto-Anmeldung verwendet dieselben vorhandenen Schaltflächen mit Symbolen und Theme-Tokens. Der zusätzliche Weg über „Mit LUNA-Konto anmelden“ entfällt.
- Ein Satz auf der Konto-Anmeldeseite erklärt den automatischen Sync. Name, E-Mail, Sicherungen, Abmelden, Kontolöschung und tatsächlicher Sync-Status bleiben im Konto erreichbar. Eine Datenauswahl beziehungsweise Wiederholung wird nur bei Kontowechsel, Konflikt oder Fehler eingeblendet.
- Der automatische Abgleich startet nach Anmeldung, beim Öffnen beziehungsweise Rückkehr in die aktive App und während der Nutzung im Abstand von 30 Sekunden auf den dafür geeigneten Seiten. Es wurde keine neue iOS-Hintergrundausführung hinzugefügt. Editor- und Testdatenschutz bleiben erhalten.
- Erste Sicherung, identische Stände, leeres Gerät und unabhängige Erständerungen benötigen keine Einrichtung. Unterschiedliche persönliche Angaben ohne gemeinsamen Ausgangsstand bleiben geschützt. Die bisherige Cloud-Seite dient jetzt früheren Sicherungen und erforderlicher Konfliktauswahl.
- Vor der Runtime-Änderung schlugen sechs der betroffenen Fälle fehl; danach bestehen alle 15 Runtime-Tests. 61 fokussierte Oberflächentests bestanden. Im abschließenden Projektlauf bestehen 457 Unit-Dateien mit 8.905 Tests und alle 141 Komponenten-Suiten mit 1.205 Tests.
- `npm.cmd run verify:fast` wurde ausgeführt. Regeln, Typecheck, Lint, Formatierung und sämtliche App-Tests bestanden. Vier Tests zu Verzeichnisverknüpfungen scheiterten ausschließlich an Windows-Sandbox-EPERM. Der unveränderte betroffene Skriptblock und die verbleibenden Skriptprüfungen wurden außerhalb der Sandbox nachgeholt: 199 eindeutige Node-Tests insgesamt bestanden, anschließend `git diff --check` erfolgreich. Der ursprüngliche Gesamtaufruf endete wegen der Sandbox mit Exit 1; der nachgeholte Prüfblock endete mit Exit 0. Prüfbelege: `.expo/cloud-simplification/verify-fast.log` und `verify-remaining.log`.
- iOS-Export mit `APP_VARIANT=internal` erfolgreich: 11.738.468 Bytes, 52 Assets, SHA-256 `22f083493adad426ffe350496175a1550751fe40cacf041e76c46ee7f5e8eb1a`. Alle 14 Dateien blieben während der Gesamttests und des Exports unverändert; dieses Dokument wurde anschließend um die Ergebnisse ergänzt.
- Kontextgraph aktualisiert. Die ursprünglichen Ignore-Dateibytes wurden erhalten. Die Implementierung wurde zunächst lokal abgeschlossen; die anschließende gesonderte OTA-Freigabe ist unten dokumentiert. Kein neuer nativer Build und keine Git-Auslieferung.

## Freigegebenes Preview-OTA

Nach ausdrücklicher Bestätigung mit „ja“ am 18.10.2026 um 02:39 Uhr (Europe/Berlin) veröffentlicht: `preview` / `ios` / EAS-Umgebung `preview`, `APP_VARIANT=internal`.

- Gruppe: `4ef3aa01-8c34-49da-9428-ea26268b6c93`.
- iOS-Update: `01a14c72-9ca1-7476-8095-6be501bb12f3`.
- Runtime: `43b795d13a44499e37cc461aa80ce8c239783788`, exakt passend zum fertigen Preview-Build 41 (`a8a35a6d-9d92-46cf-8b24-1afe0d28d245`). Fingerprint vor Veröffentlichung neu berechnet; keine Runtime erzwungen.
- Der aktive, nicht pausierte Preview-Kanal führt ausschließlich zum Zweig `preview`. Vorheriger Stand war die Gruppe `374ee685-ed56-49b6-a05a-760a1b2ac1dc`; dessen übriger Quellstand blieb erhalten.
- Der neue Stand führt den Preview-Zweig an. Das tatsächlich ausgelieferte Manifest liefert HTTP 200 mit obiger Update-ID und Runtime.
- Das veröffentlichte Paket hat 9.530.256 Bytes und 52 Assets. Lokaler EAS-Export, Manifest und vom CDN heruntergeladenes Paket haben identische SHA-256-Prüfsumme `86AA2672747F6356C7C8BE3953A2D5B088232E1CF5ECA76A3535F731F1F2536F`.
- Preview-Cloud-Ziel und vorhandene öffentliche Client-Konfiguration vor Veröffentlichung geprüft; keine Schlüsselwerte ausgegeben. Alle 1.958 erfassten Quelldateien blieben während Veröffentlichung und Auslieferungsprüfung unverändert. Dieses Dokument wurde anschließend ergänzt.
- Belege liegen unter `.expo/cloud-simplification/ota/`, insbesondere `published-updates.json`, `served-proof.json` und `source-proof-after.json`.

Offen: sichtbare Abnahme in Light/Dark mit großer Schrift auf dem iPhone sowie Zwei-Geräte-/Offline-Abgleich gegen den Live-Dienst. Für die Übernahme: App vollständig schließen, öffnen und ungefähr 15 Sekunden warten, erneut schließen und öffnen. Die Auslieferung ist bestätigt; Geräteabnahme bleibt offen.
