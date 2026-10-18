# Mehr: direkte Arbeitsdaten und gemeinsames Konto

Freigabe: „oke setze um“ am 18.10.2026. Zielbild ist die zuletzt gezeigte Kombination: Variante 2 mit der LUNA-Cloud-Kachel aus Variante 3, Bild `exec-b505a53d-a054-4f47-a9ba-f83050c2308a.png`.

Ziel: direkte Zugriffe auf Arbeitgeber, Arbeitszeit/Ort, Tarif/Gehalt und das tarifabhängige Schichtmodell unter Mehr; echte Cloud-Identität mit Initialen und Sync-Symbol; übersichtliche Tarifauswahl mit Fertig; unterer Teilen-Block entfällt; Kontolöschung als zentrierte rote Textaktion unter Abmelden.

Nicht-Ziele: Tarifberechnung, Auth-/Lösch-Backend, automatische Änderung des gespeicherten Berichtsnamens, Datenmigration, neue native Module, Commit/Push/PR/Merge, OTA oder Build. Die vorhandenen unterstützten Tarife, Prüfungsangaben, lokalen Daten und Schutzbestätigungen bleiben erhalten.

Plattform: vorhandene Expo-SDK-57-iOS-App, Preview-Build 41. Bestehender veröffentlichter Quellstand wird auf `codex/mehr-direkt` weitergeführt; Hauptcheckout bleibt unberührt. SHA-256-Ausgangsmanifest: `.expo/settings-alternatives/baseline.json`.

Arbeitspaket 1: Mehr-Kacheln, Arbeitgeber-Editor und Rückwege, kompakte Tarifoberfläche mit vorhandenen Auswahl- und Speicherfunktionen. Dateiscope: Settings-Feature, Account-Kachel/Status, Routen, bestehende Icon-Zuordnung und zugehörige Tests.

Arbeitspaket 2: Teilen ohne unteren Verwaltungs-/Konto-Block; Freigabeverwaltung über Kopfmenü einschließlich mehrerer eigener Freigaben. Zentrierte Löschaktion bei unverändert geschützter Kontolöschung. Dateiscope: Sharing-/Account-Oberfläche und Tests.

Arbeitspaket 3: fokussierte Interaktionsprüfungen, vollständiges `npm.cmd run verify:fast`, iOS-Export, Quellumfang/Design-Token-Prüfung. Visuelle iPhone-Abnahme und Live-Löschung bleiben offen; die bereitgestellten Screenshots zeigen den vorherigen Stand.

Abnahme: Die direkten Arbeitszugriffe öffnen die richtige bestehende Funktion; Schichtmodell erscheint weiterhin nur für die unterstützten Tarife. Arbeitgeber speichern verändert keinen Kontonamen/Berichtsnamen und keinen Tarif. Cloud-Identität wechselt ohne veraltete Anzeige, Gäste sehen Anmelden, Sync-Symbol behauptet keinen erfolgreichen Abgleich vor tatsächlichem Erfolg. Arbeitsprofil wirkt unter Mehr nicht mehr wie ein zweites Konto. Konto bleibt ausschließlich unter LUNA Cloud erreichbar. Freigaben sind im Kopfmenü weiterhin vollständig verwaltbar. Konto löschen bleibt eine mindestens 44pt hohe, zentrierte rote Textaktion mit Bestätigung und Schutz gegen Kontowechsel. Light/Dark und große Schrift verwenden bestehende Tokens und Komponenten.

Umgesetzt: Die vier Arbeitszeilen ersetzen die bisherige Arbeitsprofil-Karte. Arbeitgeber hat ein eigenes Formular ohne zweite Namenseingabe. Tarif, Eingruppierung und Stufe stehen zusammen unter Dein Tarif; bestehende Berufs-, Einrichtungs- und Tarifregionsangaben bleiben unter Arbeitsbereich erreichbar. Die manuelle Bruttoeingabe und TV-H-Vollzeitwahl bleiben verfügbar. Änderungen werden über Fertig gespeichert; der vorhandene Schutz beim Verlassen bleibt aktiv.

Die Cloud-Kachel verwendet die tatsächliche Cloud-Identität und den aktuellen Sync-Zustand. Bei großer Schrift erscheint das Personensymbol anstelle dekorativer Initialen; der Name skaliert weiter. Die Freigabeverwaltung ist über das Kopfmenü erreichbar, bei mehreren eigenen Kalendern über eine Auswahl. Die Löschaktion verwendet weiterhin die vorhandene Bestätigung und den Schutz gegen einen Kontowechsel.

Prüfergebnisse am 18.10.2026:

- Regelvertragsprüfung, Typprüfung, Lint ohne Warnungen, Formatprüfung und `git diff --check` bestanden.
- `npm.cmd run verify:fast` wurde ausgeführt. Der vollständige Unit-Lauf bestand mit 457 Dateien und 8.906 Tests. Im vollständigen Komponentenlauf bestanden 141 Suiten; der neue Cloud-Kacheltest setzte zunächst eine normale Schriftgröße voraus, während die Testumgebung große Schrift verwendete. Nach expliziter Vorgabe beider Schriftgrößen bestand die betroffene Suite mit vier Tests. Insgesamt sind damit 142 Suiten und 1.215 Komponententests abgedeckt. Seit dem vollständigen Lauf änderte sich ausschließlich diese Testdatei, anschließend diese Dokumentation; der Produktionscode blieb identisch.
- Die abschließenden Typ-, Lint-, Format- und sämtliche 13 verbleibenden Node-Gates aus `verify:fast` wurden separat erfolgreich ausgeführt: 199 Node-Tests, keine Fehler. Nachweise: `.expo/settings-alternatives/verify-fast.log`, `focused-account-card.log` und `finish-gates.log`.
- `APP_VARIANT=internal npm.cmd run export:ios` bestanden: 52 Assets und Bundle `entry-87cfbc54cd344c9cfc63f7b56b6d5249.hbc`, 11.740.250 Bytes, SHA-256 `AEC10CB47484F8DFA88CF14115E128F30B1D66CCA5958F24F115B333A6EE68DF`. Nachweise: `.expo/settings-alternatives/export-ios.log` und `export-proof.json`.
- SHA-256-Abgleich gegen die 1.958 Ausgangsdateien: 14 beabsichtigt geänderte Dateien, drei neue Dateien einschließlich dieser Dokumentation, keine Löschungen und keine weiteren Quelländerungen. Native Konfiguration, Abhängigkeiten und die exakten `.gitignore`-Bytes sind unverändert. Der Graft-Graph wurde aktualisiert.

Offen: tatsächliche Darstellung und Bedienung auf dem iPhone, besonders Light/Dark, große Schrift, Konto-/Tarifauswahl und die Löschbestätigung. Eine echte Kontolöschung wurde nicht ausgelöst. Kein Commit, Push, PR, Merge oder neuer nativer Build. Die Umsetzung wurde zunächst lokal abgeschlossen; die anschließend gesondert freigegebene Preview-OTA ist unten dokumentiert.

## Veröffentlichtes iOS-Preview-OTA

Nach ausdrücklicher Freigabe mit „ota“ am 18.10.2026 um 03:33 Uhr (Europe/Berlin) veröffentlicht: `preview` / `ios` / EAS-Umgebung `preview`, `APP_VARIANT=internal`.

- Gruppe: `74d120b8-23d4-42c4-bd50-82cc47f85960`.
- iOS-Update: `01a14ca4-65bc-70ba-9e60-907f92fbead4`, erstellt `2026-10-18T01:33:24.796Z`.
- Runtime: `43b795d13a44499e37cc461aa80ce8c239783788`, passend zum fertigen Preview-Build 41 (`a8a35a6d-9d92-46cf-8b24-1afe0d28d245`). Neu berechneter Fingerprint mit 145 Bestandteilen stimmt exakt überein; keine Runtime erzwungen.
- Aktiver Preview-Kanal führt ausschließlich zum Zweig `preview`. Dessen vorherige Gruppe `4ef3aa01-8c34-49da-9428-ea26268b6c93` entspricht dem geprüften Ausgangsstand. Die neue Gruppe führt den Zweig nach Veröffentlichung an.
- Cloud-Ziel und öffentliche Client-Konfiguration wurden mit der EAS-Preview-Umgebung geprüft, ohne Schlüsselwerte auszugeben. Veröffentlicht wurde ein neuer EAS-Export mit dieser Umgebung.
- Tatsächlich ausgeliefertes Manifest: HTTP 200 mit obiger Update-ID und Runtime. Lokaler EAS-Export, Manifest und heruntergeladenes CDN-Paket besitzen dieselbe SHA-256-Prüfsumme `FDD00F5EB1FBAFF003DB1DB7044936F51CCBE1B73E79EC1202B8F5E1050EA8FC`.
- Hermes-Paket `entry-bce819c3a3a658e8a8172b8c168b8070.hbc`, 9.529.188 Bytes und 52 begleitende Assets.
- Alle 1.961 erfassten Quelldateien blieben während Veröffentlichung und Auslieferungsprüfung unverändert. Dieses Dokument wurde anschließend um den Nachweis ergänzt. Keine Git-Auslieferung und kein neuer nativer Build.
- Belege: `.expo/settings-alternatives/ota/final-proof.json`, `published-updates.json`, `updates-after.json`, `served-proof.json` und `source-proof-after.json`.

Auslieferung und Kompatibilität sind bestätigt. Die zugehörige SDK-Referenz ist [Expo Updates für SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/updates/).

## Bestätigte Geräteabnahme

Nutzerbestätigung am 18.10.2026 zur oben veröffentlichten OTA: „Ja, die OTA ist angekommen. Die neue Mehr-Seite und die Cloud-Kachel passen so.“ Damit sind die sichtbare Übernahme der OTA sowie die neue Mehr-Seite und Cloud-Kachel auf dem iPhone bestätigt und abgenommen.

Diese Bestätigung umfasst keine gesonderte Abnahme von Teilen-Verwaltung, Tarifbearbeitung, Kontolöschung, Zwei-Geräte-Synchronisation oder allen Light/Dark- und Schriftgrößenzuständen. iPhone-Modell und iOS-Version wurden nicht genannt. Nachweis: direkte Nutzerbestätigung in diesem Chat; ergänzender lokaler Datensatz `.expo/settings-alternatives/ota/device-acceptance.json`.
