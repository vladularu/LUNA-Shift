# Brutto-Netto-Automatik: iOS-Preview-Test

Freigabe: „ota“, 10. Oktober 2026. Die neue Automatik wurde auf dem Preview-Kanal veröffentlicht. Ein neuer nativer Build war nicht erforderlich. Geräteabnahme steht aus.

## Veröffentlichter Stand

| Angabe                    | Verifizierter Wert                                                 |
| ------------------------- | ------------------------------------------------------------------ |
| App                       | LUNA Shift Internal, `com.pflegeshift.app.internal`                |
| Zielbuild                 | iOS Preview Build 33, `8deae8f8-679b-4284-978a-a07f74fa6719`       |
| Kanal / Branch / Umgebung | `preview` / `preview` / `preview`                                  |
| Veröffentlichung          | 10. Oktober 2026, 01:51:55 Uhr MESZ                                |
| Gruppe                    | `2c5322e6-8b1b-4e1e-aba9-04b6ccf7159c`                             |
| Update-ID                 | `01a12314-99e7-76a7-b674-8634ad8ee9db`                             |
| Runtime / Fingerprint     | `03d174d668f0ea5f757958dccf853632762c554d`                         |
| Hermes-Bundle             | `entry-fc336cadf0ef9d3000765fdc57347494.hbc`, 8.131.702 Bytes      |
| SHA-256                   | `00a2f793b4e2abc1ce0d1423e81bc61b78da0c8b818bff4cf5015579e1ea0a13` |

[Update im EAS-Dashboard](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/2c5322e6-8b1b-4e1e-aba9-04b6ccf7159c)

Der native Fingerprint wurde vollständig mit 95 Quellen gegen Build 33 verglichen. Der unpausierte Preview-Kanal liefert die neue OTA-ID aus; das heruntergeladene Start-Bundle entspricht sowohl seinem Manifest-Hash als auch dem lokalen Export unter der EAS-Preview-Umgebung. Der erste direkte CDN-Aufruf ohne Asset-Header wurde mit HTTP 403 abgewiesen. Der anschließende Download mit den vom Expo-Protokoll gelieferten Asset-Headern war erfolgreich. Diese Prüfung bestätigt die Auslieferung; das sichtbare Ergebnis auf dem iPhone bleibt gesondert zu prüfen.

## Update auf dem iPhone laden

1. **LUNA Shift Internal** mit bestehendem Preview-Build 33 vollständig schließen.
2. Mit Internetverbindung öffnen und etwa 15 Sekunden warten.
3. Erneut vollständig schließen und wieder öffnen.
4. Unter **Gehalt** die Netto-Angaben einmal einrichten und speichern. Danach werden vorhandenes Grundgehalt und berechnete Dienstplan-Zuschläge automatisch verwendet.

## Abnahme

- Einrichtung, Speicherung und Neustart: Angaben bleiben erhalten; das Ergebnis erscheint erneut.
- Folgemonat: gültige persönliche Angaben werden übernommen, die Gehaltsdaten kommen aus dem gewählten Monat.
- Datierte Änderung: ein neues Profil wirkt ab seinem Startmonat; der Vormonat bleibt erhalten.
- Dienstplan ändern: die Netto-Prognose wird entsprechend dem neuen Gehalt aktualisiert.
- Tarif wechseln: die Automatik folgt dem aktiven Modell. Wählbar sind TVöD-P, TVöD E, TV-L/KR, TV-H/KR, TV-UK, TVAöD Pflege, TVA-L Pflege und ein manuelles festes Monatsbrutto.
- Zusatzversorgung: ausgewähltes Modell und Abzüge prüfen; fehlende oder nicht unterstützte Angaben sperren die automatische Zahl verständlich.
- Große Schrift, VoiceOver, Tastatur, Scrollen und Rückweg zur Gehaltskarte auf dem iPhone prüfen.

Screenshots mit sichtbarem Build-/Update-Stand sowie ein Neustartnachweis fehlen noch. EAS-Veröffentlichung, Bundle-Vergleich und Komponententests ersetzen diese Gerätenachweise nicht.

## Grenzen des Teststands

Unterstützt ist die laufende Monatsprognose 2026 für die genannten acht Gehaltsmodelle im beschriebenen GKV-/SV-Fall. Einmalzahlungen, PKV, Mini-/Midijobs, mehrere Beschäftigungen, Teilmonate, Rentenfälle und noch nicht vollständig berechenbare Caritas-/DRK-Entwürfe gehören nicht zur vollständigen automatischen Netto-Prognose. Monatsübergreifende Dienste bleiben bis zu einer getrennten Abrechnungszuordnung gesperrt. Details stehen im [Umsetzungsbericht](brutto-netto-automatik-umsetzung.md).

## Prüfprotokolle

- `artifacts/net-pay-automatic-verify-fast.log`: vollständiges schnelles Gate bestanden; 8.071 Unit-/Integrationstests und 868 Komponententests.
- `artifacts/net-pay-automatic-release-check.log`: Release-Konfiguration konsistent.
- `artifacts/net-pay-automatic-fingerprint-summary.json`: Build und Update vollständig kompatibel.
- `artifacts/net-pay-automatic-export-eas.log`: erfolgreicher iOS-/Hermes-Export mit tatsächlicher Preview-Umgebung.
- `artifacts/net-pay-automatic-channel-summary.json`: veröffentlichte OTA im unpausierten Preview-Kanal.
- `artifacts/net-pay-automatic-publication-verification.json`: Manifest und Bundle tatsächlich ausgeliefert und Hash geprüft.
