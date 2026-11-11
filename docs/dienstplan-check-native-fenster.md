# Native Details im Dienstplan-Check

Die Details eines Prüfpunkts öffnen im selben nativen `formSheet` wie die Schichtzulage. Beide Routen verwenden dieselbe Fensterkonfiguration. Die Prüfungsdetails behalten die native Kopfzeile, die abgerundeten Karten, Dienstsymbole und aufklappbaren Quellen. Der feste untere Zurück-Bereich entfällt; Schließen erfolgt über den Pfeil oben oder die native Wischgeste nach unten. Der Scrollbereich reserviert keinen Platz für eine ausgeblendete Fußleiste.

Ein ausgewählter Befund wird nur lokal im Speicher an die Detailroute übergeben. Die URL enthält einen kurzlebigen Bezeichner. Doppelte Aufrufe werden abgefangen; beim Schließen wird die Übergabe freigegeben. Entfernte Prüfpunkte schließen ihr Detail, veraltete Aufrufe erhalten eine sichere Rückkehr. Bearbeiten, Kopieren/Teilen und ein zusätzliches Aktionsmenü werden nicht angeboten.

Gesetzliche, tarifliche und Planungshinweise behalten ihre bestehenden Ergebnisse und Hinweise zu Prüfgrenzen. Kurze Wechsel zeigen beide Dienste und ihre Zeiten. Die Datumsbeschriftung fängt fehlende Kalenderangaben in iOS-Intl ab. Alle 16 Produkt- und 13 Testdateien stammen unverändert aus dem eingefrorenen Preview-Archiv; der Source-Review wird gezielt mit dem aktuellen master zusammengeführt.

## Abnahme und Auslieferung

Der Nutzer bestätigte zuerst den nativen Fensteraufbau und danach die Fassung ohne untere Zurück-Leiste jeweils mit „ja passt“. Die letzte Abnahme bezieht sich auf Preview Build 50, Update `01a1cc7f-3e48-7ac1-bc58-acb0bdffeba2`, Gruppe `01742367-50b1-44a4-98ab-aea636a55e66`. Dessen vollständiger App-/Asset-Quellstand hat den Digest `3eefda9d287bec0dc38e53233c0b3755def7af8ec1a007daa411e81295b8b87c`; Bundle und alle 34 Assets wurden nach dem Upload geprüft.

Dieser Git-Abgleich umfasst ausschließlich das Prüfungsfenster, seine Tests, diese Dokumentation und die zugehörigen exakten Source-Review-Einträge. Andere Darstellungsarbeiten und die separaten Optimierungs-PRs #381 bis #385 werden nicht mit ausgeliefert oder gemergt. Die übernommenen Produkt-/Testdateien werden vor Commit und nach Merge gegen die abgenommenen Archivbytes verglichen.

Eine TestFlight-OTA wurde nicht veröffentlicht: Der Production-Fingerprint des abgenommenen Preview-Quellstands ist `66946ae16f584a0e81f0d0042a8bb4e46fe8c9c5`; TestFlight Build 9 verwendet `c223286c3cbf6ce5f7873c6e595d558028d9d8fb`. Direkte Fingerprint-Berechnung und der Prüfaufruf des geschützten Expo-Updates-Publishers bestätigen denselben Unterschied. Zusätzlich verweist die gespeicherte Build-9-Baseline noch auf die OTA vom 4. November, während live die bereits veröffentlichte OTA vom 10. November ausgeliefert wird. Baseline, Runtime und Release-Schutz werden nicht umgangen. Ein neuer nativer TestFlight-Build benötigt eine eigene Freigabe.
