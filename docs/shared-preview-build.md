# Gemeinsamer Preview-Build: Design, Netto und Berichtsexport

## Task-Vertrag

Ziel: Den bestätigten Design-Stand, die vollständige Netto-Prognose, die letzten
Preview-Änderungen an Onboarding/Prüfung und den zurückgestellten PDF-/CSV-Export
in einer gemeinsamen iPhone-App zusammenführen.

Nicht-Ziele: Neue Berechnungsregeln, Cloud-Synchronisierung, Datenimport zwischen
den getrennten Design-/Internal-Apps und Store-Veröffentlichung.

Ziel: iPhone, Expo SDK 57, APP_VARIANT=internal, App-ID
com.pflegeshift.app.internal, EAS-Profil und OTA-Kanal preview.

Scope: Die Änderungen der gespeicherten Design-, Onboarding-/Prüfung- und
Export-Arbeitsstände; Netto-Exportintegration; zugehörige Tests; native
Abhängigkeiten und App-Konfiguration. Unabhängige Arbeitsstände bleiben erhalten.

Freigabe: Der Nutzer hat am 2026-10-11 die Umsetzung und alle hierfür benötigten
Freigaben erteilt, einschließlich Git-Delivery und gemeinsamem Preview-Build.

## Arbeitspakete

1. Aktuellen master mit Netto als Basis verwenden und die letzten
   Preview-Änderungen an Onboarding und Prüfung integrieren.
2. Bestätigtes Design einschließlich Kalenderanimationen, Dienst-/Terminansicht,
   Sortierung, Gruppierung und Navigation übertragen; Netto-Seiten angleichen.
3. Gespeicherten Monats-/Jahresexport übernehmen und Netto-Prognose,
   Berechnungsgrundlagen und Abzüge in die gemeinsame PDF-/CSV-Datenbasis aufnehmen.
4. Native SVG-, Schrift- und PDF-Unterstützung in der Internal-Variante bündeln;
   bestehende Datenbank und App-Identität erhalten; Laufzeit neu bestimmen.
5. verify:fast, relevante Regressionstests, verify:full und PR-CI prüfen;
   gemeinsamen nativen Preview-Build erstellen und auf dem iPhone abnehmen.

## Abnahmekriterien

- Netto-Ergebnisse und Profile bleiben erhalten und korrekt; bestehende
  Internal-Daten bleiben nach dem Upgrade lesbar.
- Das bestätigte Design funktioniert zusammen mit Netto ohne Demo-Initialisierung.
- PDF und CSV enthalten denselben vollständigen Monats-/Jahresdatenbestand,
  einschließlich verfügbarer Netto-Prognosen und ihrer Abzüge/Grundlagen.
- Unverfügbare Werte erscheinen als Nicht verfügbar, niemals als erfundene Null.
- CSV bleibt gegen Formeleingaben geschützt; PDF und CSV lassen sich auf dem
  iPhone öffnen, teilen und speichern; temporäre Dateien werden bereinigt.
- Runtime und Kanal sind korrekt; eine inkompatible OTA erreicht Build 33 nicht.
- Tests, Exporte und PR-CI bestehen. Technische Checks ersetzen keine Geräteabnahme.
- Vor Merge wird die gemeinsame App auf dem iPhone bestätigt: Start mit bisherigen
  Daten, Netto-Vergleich, Kalenderanimationen, Dienste/Termine, Sortierung und Exporte.

Expo-Referenzen:

- https://docs.expo.dev/versions/v57.0.0/sdk/print/
- https://docs.expo.dev/versions/v57.0.0/sdk/svg/

## Abnahmestand

Integration abgeschlossen. Das schnelle Gate besteht: 8.413 Unit-Tests,
977 Komponententests in 123 Suites sowie die zusätzlichen Regel-, Runtime- und
Worklet-Prüfungen. Die fokussierten integrierten Ansichten bestehen mit 95 Tests.
Der vollständige Release-Check läuft; die gemeinsame iPhone-Abnahme steht aus.

Die ursprünglichen Arbeitsstände wurden anhand ihrer HEADs und SHA-256-Prüfsummen
verglichen und blieben unverändert. Der bestehende Netto-Rechenkern und die
Netto-Profilpersistenz entsprechen unverändert dem bestätigten master-Stand.

Der neue native iOS-Fingerprint für das Profil preview lautet
758b626456b8bc81c6c91bf9a8dfd1d138f7ca92. Build 33 verwendet dagegen
03d174d668f0ea5f757958dccf853632762c554d; die vollständige Integration benötigt
deshalb den neuen nativen Preview-Build.
