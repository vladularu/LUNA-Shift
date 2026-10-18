# Eintragsarten in Dienstvorlagen

Auftrag vom 18.10.2026: Die bisherige Dienstart-Auswahl in Dienstvorlagen auf
Dienst, Fortbildung, Urlaub, Krank und Frei vereinfachen und als iOS-OTA für
Preview und den installierten TestFlight-Build veröffentlichen. Der Nutzer hat
Implementierung und beide Veröffentlichungen ausdrücklich freigegeben.

Ziel: Die Auswahl heißt Eintragsart. Neue normale Vorlagen verwenden CUSTOM
(Dienst). Früh, Spät, Nacht und Tag bleiben frei wählbare Titel. Bestehende
Vorlagen dieser vier Typen werden als Dienst angezeigt; beim unveränderten
Speichern oder erneuten Auswählen von Dienst bleibt ihr gespeicherter Typ
erhalten. Fortbildung und Abwesenheiten behalten ihre bisherige Verarbeitung.

Nicht-Ziele: Datenmigration, neue Zeit- oder Gehaltsberechnung, neue native
Konfiguration, neuer Build, Store-Veröffentlichung oder Veröffentlichung fremder
Arbeitsstände über Git.

Dateiscope dieser Änderung: template-editor-screen.tsx, zugehörige
Komponententests und dieses Dokument. Die isolierte Arbeitskopie auf
codex/eintragsart übernimmt den zuvor veröffentlichten Gesamtstand aus
unified-cloud-account bytegleich; die Bestandskopie bleibt unverändert.
Der Herkunfts- und Dateiabgleich liegt unter .expo/eintragsart/.

OTA-Basis: Preview-Gruppe 631a40a5-d222-4614-8258-c4c9694a5114 und
Production-Gruppe a88450d2-f9e6-462f-bdfa-f9e2a1dca319. Beide lieferten vor dieser
Änderung denselben JavaScript-Stand aus. Preview nutzt APP_VARIANT=internal,
Umgebung/Kanal/Branch preview und Runtime
43b795d13a44499e37cc461aa80ce8c239783788 (Build 41). TestFlight nutzt
APP_VARIANT=production, Umgebung/Kanal/Branch production und Runtime
4a9747e5fdc6a52760d6955a95584cdd1e85607e (Build 5).

Abnahmekriterien: exakt fünf fachliche Eintragsarten, Dienst als Standard,
unveränderte Titel/Zeiten/Farben und alte Typen bestehender Dienstvorlagen,
korrekte Speicherung jeder Eintragsart, Abbrechen ohne Typwechsel,
Komponententests und verify:fast erfolgreich. Vor OTA: beide Fingerprints gegen
die vorhandenen Builds prüfen. Nach OTA: Kanal, Runtime, Gruppe, Manifest und
ausgeliefertes Bundle prüfen. Die anschließende visuelle Abnahme auf dem iPhone
bleibt separat; automatisierte Prüfungen ersetzen sie nicht.

## Ergebnis am 18.10.2026

Die 17 gezielten Komponententests und der vollständige Lauf von verify:fast sind
erfolgreich: 457 Unit-Dateien mit 8.905 Tests, 142 Komponenten-Suites mit 1.224
Tests sowie 203 Skripttests. Zusätzlich bestanden die 14 privaten Cloud- und
Decoder-Prüfungen. Die lokale Unit-Ausführung verwendete einen Thread statt
Windows-Unterprozessen; Testumfang und Zeitlimits blieben unverändert. Die
vorübergehende Änderung des Testaufrufs wurde anschließend zurückgenommen.

Für die Veröffentlichung wurde ausschließlich das scripts-Feld der package.json
in der isolierten Kopie auf die Metadaten der vorhandenen OTA-Linie gesetzt.
Alle anderen Fingerprint-Quellen stimmten bereits überein. Abhängigkeiten,
native Konfiguration und der geprüfte App-Code blieben unverändert. Die
Decoder-Härtung wurde ausdrücklich verifiziert. Beide abschließend neu
berechneten Fingerprints entsprechen exakt den vorhandenen Builds; es gab
keinen Runtime-Override. Nach der Veröffentlichung wurde die ursprüngliche
package.json bytegleich wiederhergestellt.

Veröffentlicht für iOS:

- Preview, Build 41: Gruppe 10e9ff81-b49f-47f1-800a-0c4dd9b2df08,
  Update 01a14d16-8422-7b85-870a-ddcb25c9f126.
- Production für TestFlight Build 5: Gruppe 1ed38bc5-cf74-4585-8ebb-66ff77f09bd6,
  Update 01a14d18-5d53-7de5-84e8-b31e3baaf432.

Die echten Kanal-Endpunkte antworten jeweils mit HTTP 200 und liefern die neue
Update-ID, die passende Runtime sowie die richtige App-Variante und Bundle-ID.
Lokaler Export, Manifest und tatsächlicher CDN-Download stimmen für beide
Kanäle überein. Beide Hermes-Bundles sind bytegleich: 9.519.368 Bytes,
SHA-256 F9D38C46EA4D055F3DE0EEB0CEF0F50A52489AE673D206E117FFB325794DAD20.

Der Dateiabgleich umfasst 1.962 vorhandene Dateien. Gegenüber der bisherigen
Veröffentlichung sind nur der Vorlageneditor und seine Komponententests
geändert; hinzu kommt dieses Dokument. Die ursprüngliche Arbeitskopie und
andere Arbeitsstände bleiben erhalten. Der eigenständige Implementierungspatch
liegt unter .expo/eintragsart/implementation.patch. Es wurde kein neuer nativer
Build und keine neue Apple-Submission gestartet.

Nachweise: .expo/eintragsart/verification-result.json, verify-fast.log,
extra-security.log, metadata-proof.json, source-proof.json, beide abschließenden
Fingerprint-Dateien, Veröffentlichungsdateien und die jeweiligen
served-proof.json. Die sichtbare Übernahme und Abnahme dieser Änderung auf dem
iPhone ist nach der Veröffentlichung noch offen. Dafür die App vollständig
schließen, öffnen, etwa 15 Sekunden warten und erneut schließen und öffnen.
