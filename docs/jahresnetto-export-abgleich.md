# Jahresnetto und PDF-Jahresbericht

Ziel: Der PDF-Jahresbericht verwendet fuer jeden Monat dieselbe Auszahlungsprognose und fuer Jahres-/Teilsumme sowie Monatsanzahl dieselben Regeln wie die Jahresnetto-Anzeige. Verfuegbares Monatsnetto bleibt auch bei einer nur brutto bekannten Sonderzahlung enthalten; der Hinweis auf die unvollstaendige Sonderzahlung bleibt sichtbar. Fehlende, gesperrte und nicht eingerichtete Monate werden nicht zu null umgedeutet. Ein echter Nullbetrag bleibt verfuegbar.

Plattform: bestehende iPhone-Preview, APP_VARIANT=internal, Kanal/Environment preview, Expo SDK 57. Basis ist der abgenommene Luftig-Stand der OTA 01a1b421-f0c8-797f-b232-2ab73dbd7d39 einschliesslich der bereits live erhaltenen Planungshinweis-Korrektur. Die vorhandenen Arbeitsstaende bleiben separat erhalten.

Scope: report-data.ts, report-view-data.ts, report-export-button.tsx, ihre Export-/Bedienungsregressionen, eine Jahresnetto/PDF-Paritaetspruefung, exakter Quellpruefeintrag und diese Dokumentation. Die Kalender-CSV bleibt nach ausdruecklicher Auswahl des Nutzers unveraendert. Monatliches PDF-Layout, Steuerformeln, Tarifregeln, gespeicherte Daten, native Konfiguration, Premium und Git-Auslieferung sind nicht Teil dieser Korrektur.

Abnahme: Jahresnetto und PDF stimmen bei 0/1/12 verfuegbaren Monaten, datierten Netto-Angaben, Auszahlung mit 0/1/2 Monaten Verzoegerung, Testmonaten und Sonderzahlung mit/ohne Netto-Grundlagen ueberein. Beide PDF-Layouts zeigen dieselben Monats- und Jahressummen sowie verbleibende Hinweise. CSV bleibt eine reine Kalenderdatei. Fehler beim Laden der Auszahlungsangaben duerfen keinen falschen Bericht erzeugen. Der PDF-Export bleibt abbrechbar. Die zusaetzlich benoetigten Auszahlungsangaben werden ausschliesslich fuer einen PDF-Jahresbericht mit Gehalt gelesen; die bisherigen Netto-Angaben bleiben im Monats-PDF erhalten.

Freigabe: Implementierung und eigene iOS-Preview-OTA waren beauftragt. Am 7. November 2026 hat der Nutzer Jahresnetto und PDF auf dem iPhone abgenommen und Commit sowie GitHub-Abgleich freigegeben. Keine weitere OTA, kein nativer Build und keine TestFlight-/Production-Veroeffentlichung im Rahmen dieses Git-Abgleichs. Premium bleibt spaeter.

## Umsetzung und lokale Regressionen

Der Jahresbericht nutzt prepareAutomaticNetPaySteps mit der Perspektive PAYOUT, den gespeicherten Auszahlungseinstellungen und der datierten Netto-Timeline. Monatliche Ergebnisbewertung und Jahressummierung werden durch annualNetPayMonth und summarizeAnnualNetPay gemeinsam mit der Anzeige ausgefuehrt. Die zusaetzliche Ausschlussbedingung in der PDF-Aufbereitung wurde entfernt. Der Monatsbericht behaelt seine bisherige Berechnung; die Kalender-CSV und deren Dateiformat bleiben unveraendert. Keine Anzeige-, Tarif-, Steuerformel-, Speicher- oder Premium-Aenderung.

Die neuen Paritaetsregressionen reproduzierten vor der Korrektur vier Abweichungen: unvollstaendige Sonderzahlung, ein bzw. zwei Monate verzoegerte Auszahlung und Testmonate. Nach der Korrektur bestehen 71 Fach-/PDF-/CSV-Faelle und 23 Bedienungs-/Sharingfaelle, darunter 0/1/12 verfuegbare Monate, datierte Steuerangaben, echte Nullwerte an der Forecast-Grenze, Sonderzahlungen mit und ohne Nettobasis und vorlaeufige Vorjahresregeln. Der vollstaendige Preview-Prueflauf bestand mit 10.463 Unit- und 1.915 Komponententests sowie den weiteren verify:fast-Gates. Die nachfolgende iPhone-Abnahme bestaetigt die Uebereinstimmung von Jahresnetto und PDF.

Ein zusaetzlicher Eingabenabgleich stellt sicher, dass Netto wie in der Jahresanzeige das gespeicherte Profil verwendet. Ein fuer Arbeitszeit-/Berichtsgrundlagen angereichertes Berechnungsprofil bleibt fuer die anderen Berichtsteile erhalten. Eine eigene Paritaetsregression deckt diese Unterscheidung ab.

## Erhalt der zwischenzeitlichen Preview-Veroeffentlichung

Vor der Auslieferung erschienen im selben Preview-Kanal die Dienstfolgen-Rahmenkorrektur d4db33a3-61b7-4f7d-a7fb-d0680309828d und anschliessend die Info-Symbol-Korrektur a28e6587-9ff8-4833-95cd-0e2f3171f62b, Update 01a1b479-f2bc-7c8e-8b48-cf354f7123a7. Ihre eingefrorenen Quellarchive und Pruefnachweise wurden verifiziert. Beide Anpassungen wurden erhalten; gemeinsame Berichtsdateien wurden konfliktfrei dreiseitig zusammengefuehrt. Gegenueber dem letzten Live-Vorgaenger unterscheiden sich ausschliesslich die drei vorgesehenen Export-App-Dateien. Der kombinierte Kandidat wurde erneut vollstaendig geprueft und exportiert. Die Exportdateien, Regressionen und diese Dokumentation bilden einen separaten Git-Umfang; fremde Darstellungs- oder Pruefungsanpassungen gehoeren nicht zur Korrektur.

## Abgenommene Preview-OTA

- Gruppe: e6a1ade7-2cca-4c72-b606-49a23a226eda.
- iOS-Update: 01a1b493-cbb3-7737-b20d-82ce892b3708.
- Runtime: 402e757d98ca799660ce5dd15a24bd999cf690eb.
- Quell-Digest: ca5320c5faac70da31b521aba417fad29808f053392bb611c18881fd2df528ac.
- Bundle-SHA-256: 4439dd647c358bb9a614fcd7b0816abfd0d1b586a11e98869148d1f1e714c474.
- Tatsaechlich ausgeliefertes Bundle und alle 34 Assets wurden gegen den Export geprueft.
- Nutzerabnahme: "Ja passt, Jahresnetto und PDF stimmen jetzt überein. Die Korrektur ist abgenommen, bitte committen und mit GitHub abgleichen. Luftig weiterhin beibehalten."

Fuer den Git-Abgleich werden die sechs Export-App- und Testdateien bytegleich aus dem abgenommenen Preview-Stand uebernommen. Die drei zugehoerigen Eintraege im Quellvergleich werden in die aktuelle master-Freigabedatei eingetragen; unabhaengige Eintraege und die Darstellungsbasis von master bleiben erhalten. Die abgenommene Luftig-Preview bleibt separat gesichert. Der isolierte master-Kandidat durchlaeuft verify:fast und die Exportregressionen erneut; der Merge erfolgt erst nach erfolgreicher PR-CI.
