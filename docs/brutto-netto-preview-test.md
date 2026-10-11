# Brutto-Netto-Rechner: veröffentlichter iPhone-Preview-Test

## Teststand und Scope

- Ziel: den bereits lokal geprüften Brutto-Netto-Rechner auf einem iPhone mit iOS-Preview-Build 33 testen.
- Verteilung: ausschließlich iOS, EAS-Branch/Channel `preview`, Umgebung `preview`, `APP_VARIANT=internal`, App-ID `com.pflegeshift.app.internal`.
- Umfang: manuelle Berechnung, monatliche Steuerprofile einschließlich SQLCipher-Tabelle/Backup v20 und automatische TVöD-P-Zuschlagsprognose für 2026. Andere Tarifanbindungen und Sonderfälle bleiben begrenzt wie im Umsetzungsbericht beschrieben.
- Keine Code-, Plugin-, SDK- oder native Konfigurationsänderungen für diese Vorbereitung. Kein Commit, Push, Merge, neuer Build oder Production-Update.
- Der Nutzer hat die Veröffentlichung ausdrücklich mit „Ja, Preview-OTA veröffentlichen“ freigegeben. Die OTA ist veröffentlicht und live auf EAS geprüft. Die Übernahme und Abnahme auf dem iPhone stehen noch aus.

## Veröffentlichte OTA

- Veröffentlicht am 9. Oktober 2026 um 21:53:26 UTC (23:53:26 Uhr in Berlin).
- Update-Gruppe: `dc3f6721-74d2-4670-b306-74396fa5d516`.
- iOS-Update-ID: `01a122a8-211f-7554-bf85-6ca2836999c6`.
- Nachricht: „Brutto-Netto: Monatsprofile und TVöD-P-Zuschlagsprognose 2026“.
- Branch `preview`, Plattform `ios`, Runtime `03d174d668f0ea5f757958dccf853632762c554d`: exakt passend zu Preview-Build 33. `eas update:list` bestätigt die Gruppe als neuesten Eintrag auf `preview`. `eas channel:view` bestätigt den aktiven Preview-Channel mit vollständiger Zuordnung zu diesem Branch, Preview-Umgebung und interner App-ID.
- [Veröffentlichtes Update-Manifest](https://u.expo.dev/update/01a122a8-211f-7554-bf85-6ca2836999c6).
- Verwendet wurde der geprüfte Export aus der EAS-Preview-Umgebung mit `--skip-bundler`. Hermes-Bundle: 8.093.149 Bytes, SHA-256 `8EACF62349EB575A9F36CEA034247AB0C1F0807DE1569DDA3B5C92EC1FCC249A`. Der Hash des veröffentlichten Launch-Bundles wurde gegen diesen lokalen Export geprüft und ist identisch.
- Lokale Nachweise: `artifacts/net-pay-preview-published-update.clean.json`, `artifacts/net-pay-preview-publish.stderr.log`, `artifacts/net-pay-preview-updates-after-publication.json` und `artifacts/net-pay-preview-publication-verification.json`.
- Die Veröffentlichung enthält den geprüften, noch uncommitteten Rechnerstand. Die von EAS angezeigte Git-Revision `94a95618552b15138ed5a88f70188550451b93a8` ist die Basisrevision des Checkouts.

## Kompatibilität und Nachweise vom 9. Oktober 2026

- EAS meldet Preview-Build 33 `8deae8f8-679b-4284-978a-a07f74fa6719` als `FINISHED`, Channel `preview`, Runtime `03d174d668f0ea5f757958dccf853632762c554d`.
- `eas fingerprint:compare` mit der EAS-Preview-Umgebung bestätigt denselben Fingerprint für Build 33 und den aktuellen Rechner-Checkout. Die uneingeschränkte lokale `runtimeversion:resolve`-Prüfung liefert ebenfalls exakt diesen Wert, mit 95 Fingerprint-Quellen.
- Die frühere vermeintliche Abweichung `47d76f…` stammt aus einer unvollständigen lokalen Windows-Sandbox-Prüfung mit nur 55 Quellen. Es wurden weder die Runtime-Policy geändert noch ein Fingerprint manuell vorgegeben. Die vorherige Einschätzung einer bestehenden Runtime-Inkompatibilität ist damit korrigiert.
- Der iOS-Export einschließlich Hermes-Bytecode besteht mit vollständigem Windows-TEMP-Zugriff. Ein zweiter Export über `eas env:exec preview` verwendet die tatsächliche Preview-Umgebung und besteht ebenfalls. Bundle: `_expo/static/js/ios/entry-623c44fd11dc55181e8ee15739a3be38.hbc`, etwa 8,1 MB. Artefakte: `artifacts/net-pay-preview-export-eas/` und `artifacts/net-pay-preview-export-eas.log`.
- `npm.cmd run release:check` besteht. Der unveränderte Codestand hat zuvor `verify:fast` mit 8.030 Unit-/Integrationstests und 855 Komponententests vollständig bestanden. Die Vorbereitung hat ausschließlich lokale Prüfartefakte und diesen Bericht ergänzt.
- Vorherige kompatible Preview-OTA: Gruppe `4154b173-233b-4e1f-9717-b26f4a1676c5`, Schnell-einfügen-Animation. Der Rechner basiert auf dem eigenen geprüften Checkout; unabhängige Arbeiten im Hauptcheckout wurden nicht übernommen oder geändert.

## Ablauf auf dem iPhone

1. Auf dem iPhone die interne Preview-App mit Build 33 verwenden. Die Veröffentlichung erfolgte ausschließlich für Preview.
2. App vollständig schließen, öffnen, ungefähr 15 Sekunden warten, erneut schließen und öffnen. Danach OTA-ID und installierten Build für die Abnahme festhalten.
3. In der Gehaltskarte einen Monat aus 2026 öffnen und **Netto berechnen** wählen.
4. Monatliche Steuer- und Versicherungsangaben ausdrücklich auswählen und sichern. Prüfen, ob sie nach einem App-Neustart für denselben Monat wieder geladen werden und für einen anderen Monat fehlen.
5. Die manuelle Variante mit vollständigen geprüften Bruttobasen testen. Ungültige Angaben und Sonderfälle müssen ohne Nettozahl bleiben; jede Betrags-/Profiländerung muss Ergebnis und Bestätigung verwerfen.
6. Bei regulärem TVöD-P: SFN-Grundlohn gesondert angeben, regelmäßiges SV-Einkommen prüfen und die Bedingungen der Dienstplan-Prognose bestätigen. Steuerfreiheit und SV-Freiheit müssen getrennt sichtbar sein. Dienste ohne Zeiten und in den nächsten Monat reichende Dienste dürfen keine automatische Nettozahl liefern.
7. Auf dem Gerät insbesondere Tastatur, Scrollen, große Schrift, VoiceOver, SQLCipher-Speichern und den Rückweg zur Gehaltskarte prüfen. Screenshot und tatsächlich sichtbares Ergebnis belegen die Geräteabnahme; Upload-Metadaten allein reichen dafür nicht.

### Optionaler synthetischer Referenzfall

Für eine reguläre Anstellung ohne Ausbildungsprofil oder weitere Abzüge kann die manuelle Variante mit folgenden ausdrücklich synthetischen Monatsdaten geprüft werden. Diese Werte ersetzen keine echten persönlichen Steuerangaben.

| Angabe                                                           | Testwert                                      |
| ---------------------------------------------------------------- | --------------------------------------------- |
| Monat                                                            | Juli 2026                                     |
| Geburtsdatum                                                     | 15.01.1990                                    |
| Steuerklasse / Kirchensteuer                                     | I / keine                                     |
| Kinderfreibetrag / monatlicher Freibetrag                        | 0 / 0,00 Euro                                 |
| Elterneigenschaft / Kinder unter 25                              | nein / 0                                      |
| Beschäftigung in Sachsen                                         | nein                                          |
| Voller GKV-Zusatzbeitrag                                         | 2,90 %                                        |
| Abrechnungsfall                                                  | regulärer voller Monat, keine weiteren Abzüge |
| Gesamtbrutto, Steuerbrutto, SV-Brutto, regelmäßiges SV-Einkommen | jeweils 5.000,00 Euro                         |
| Erwartete manuelle Netto-Prognose                                | 3.130,09 Euro                                 |

Der automatische Zuschlagsfall hängt zusätzlich von den tatsächlich im App-Dienstplan gespeicherten Diensten ab und hat deshalb keinen einheitlichen Referenzbetrag.
