# Einladungslink einmalig teilen

Bei der Übergabe an das iOS-Teilen-Menü stand der Einladungslink sowohl im
Nachrichtentext als auch im separaten URL-Element. WhatsApp zeigte deshalb
denselben Link zweimal an.

Der Systemversand übergibt auf iOS den Einladungssatz ohne Link als Text und
den Link einmalig als URL-Element. Android erhält Einladungssatz und Link als
einen Text. Direkte Messenger-Entwürfe und der System-Fallback bleiben erhalten.
Empfänger und Versand bestimmt weiterhin der Nutzer.

## Scope und Prüfung

Geändert sind ausschließlich diese beiden Dateien und dieser Nachweis:

- `src/infrastructure/sharing/invitation-delivery.ts`
- `src/infrastructure/sharing/invitation-delivery.component.test.tsx`

Neun fokussierte Versandtests sichern Messenger-Entwürfe, den System-Fallback,
AirDrop sowie die einmalige Ausgabe auf iOS und Android ab. Der veröffentlichte
Preview-Kandidat bestand `npm.cmd run verify:fast` mit 10.376 Unit-Tests und
1.834 Komponententests in 195 Suiten. Für die Git-Übergabe werden die fokussierten
Tests und `verify:fast` auf dem aktuellen Master-Ausgangspunkt erneut ausgeführt.

HTTPS, Landingpage, E-Mail, Einladungs-Token/Annahme, Kalenderrechte und native
Konfiguration sind nicht Teil dieser Korrektur. Das vorgemerkte HTTPS-Paket
bleibt separat. Die bisherigen App-Scheme-Links bleiben bestehen.

## Preview-Veröffentlichung und Abnahme

Am 03.11.2026 wurde die Korrektur für die interne iOS-Preview-App Build 49
veröffentlicht:

- Kanal, Branch und Environment: `preview`, `APP_VARIANT=internal`
- Runtime: `402e757d98ca799660ce5dd15a24bd999cf690eb`
- Update-Gruppe: `bbd71e07-59a9-4f47-80e1-3a6c0f2d03f7`
- Update-ID: `01a1a242-8518-7470-8750-4ccaf292141b`
- Bundle-SHA-256: `684d6b46966bcc4ff46fe208fc172873831b0bc4807ed81b4e404868d1526a80`
- Manifest, Bundle und 34 Assets wurden gegen die ausgelieferten Dateien geprüft.

[Preview-OTA ansehen](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/bbd71e07-59a9-4f47-80e1-3a6c0f2d03f7).
Die Korrektur des doppelten Einladungslinks ist anschließend durch „Ja passt“
für Preview abgenommen. Dies ist keine Abnahme einer HTTPS-Verknüpfung oder
einer TestFlight-Veröffentlichung.

Commit und Push sind danach ausdrücklich freigegeben. Die Git-Übergabe erfolgt
auf `codex/einladung-einmal-fix`, ausgehend von Master
`faf836d84bcd4074d62ccdc708f1f7c7a26b02b5`. Die beiden Versanddateien entsprechen
bytegenau dem veröffentlichten und abgenommenen Preview-Kandidaten. Weitere
Preview-Arbeiten werden nicht in diesen Commit übernommen. PR, Merge und
TestFlight-Veröffentlichung gehören nicht zu diesem Git-Auftrag.
