# Netto-Prognose: Ladezeit und Übersicht

## Task-Vertrag (10.10.2026)

Ziel: Die automatische Netto-Prognose öffnet zügig und zeigt das Monatsergebnis vor Einrichtungshinweisen. Netto, Gesamtbrutto, Abzüge und steuerfreie/steuerpflichtige Zeitzuschläge sind ohne Aufklappen sichtbar.

Nicht-Ziele: Neue Steuermodelle, native Änderungen, neue Pflichtangaben, automatische Zuordnung einer unbekannten Zusatzversorgung, Änderungen an unabhängigen Kalenderfunktionen.

Plattform: iOS Preview Build 33 / Expo SDK 57 (~57.0.22). Die Screenshots der bisher veröffentlichten Version zeigen ein berechnetes Ergebnis, aber zu lange Erklärungen und unklare Zuschlagsdarstellung.

Arbeitspaket 1: Zuschlagszeitspur und SFN-Minutenprüfung beschleunigen, ohne Grenzen, Pausen, Sommerzeit oder Cent-Rundung zu ändern; identische automatische Prognosen zwischen Gehaltsauswertung und Detailseite wiederverwenden. Scope: simple-pay.ts (nur Erzeugung der Zeitspur), net-pay-sfn.ts, neuer begrenzter Prognosecache, use-automatic-net-pay.ts und fachliche Regressionstests.

Arbeitspaket 2: Ergebnis zuerst, kompakte Betragszeilen, Zuschläge explizit aufteilen, ein Detailbereich für Abzüge und Grundlagen; Angaben nach dem Ergebnis ändern. Scope: net-pay-result-card.tsx, net-pay-automatic-screen.tsx und vorhandene Netto-Komponententests.

Abnahmekriterien:

- Repräsentative 31-Dienste-Prognose vor/nach Änderung mit identischen Ergebnissen messen; Desktop-Messungen als solche ausweisen.
- Bestehende SFN-Regressionen einschließlich Sommerzeit, Monatsgrenze, Feiertagen, bezahlten/unbezahlten Pausen und Grenzen bleiben unverändert korrekt.
- Dienstplan, Profil, persönliche Angaben, Monatsbrutto und Regelkatalog invalidieren den begrenzten Cache; Fehler bleiben erneut prüfbar.
- Hauptansicht zeigt beide Zuschlagsanteile, einschließlich 0 Euro, und verwendet die tatsächliche Zuordnung.
- Unbekannte Zusatzversorgung ist direkt am Netto sichtbar. Formulare, Testmonatsperre, Fehlerbehandlung und manueller Rechner bleiben erreichbar.
- Fokussierte Tests und npm.cmd run verify:fast bestehen.
- Erneutes Öffnen, erster Aufruf, beide Themes und große Schrift benötigen anschließend einen iPhone-Nachweis. Lokale Tests ersetzen ihn nicht.

Commit, Push, Build und neue OTA: nicht für diese Korrektur freigegeben.

## Umsetzung und Nachweise

Die TVöD-Zeitspur sammelt zusammenhängende Minutenintervalle numerisch und formatiert nur deren Grenzen. Die SFN-Prüfung berechnet normale Tage arithmetisch, verwendet bei einer Zeitumstellung weiterhin absolute Temporal-Minuten und summiert identische exakte Bruchbeträge gemeinsam. Die Rundung erfolgt weiterhin pro Dienst auf volle Cent. Überschneidungen werden anhand der vollständigen Zeitintervalle geprüft.

Ein flüchtiger, auf zwölf Ergebnisse begrenzter Cache je unveränderlichem Regelkatalog verbindet Gehaltsauswertung und Detailseite. Inhaltsschlüssel enthalten Monat, Arbeitsprofil, persönliche Angaben, Dienstplan und Monatsbrutto. Änderungen ohne neue Revision werden erkannt; nicht verfügbare Ergebnisse bleiben erneut prüfbar.

Die Hauptansicht beginnt mit dem Netto. Gesamtbrutto, Abzüge und Zeitzuschläge inklusive steuerfreiem und steuerpflichtigem Anteil stehen direkt darunter. Ein Detailbereich enthält Abzüge und Grundlagen; ein zweiter Button öffnet die vorhandene Einrichtung. Eine unbekannte Zusatzversorgung wird unmittelbar am Netto markiert. Der manuelle Rechner bleibt erreichbar.

Lokale Messung mit Windows/Node, Oktober 2026, 31 Nachtdienste (keine iPhone-Messung):

- Vorher: automatische Netto-Berechnung 2.301–2.343 ms; Zeitspur 1.005 ms; SFN-Prüfung 1.335 ms.
- Nachher: automatische Netto-Berechnung 139–187 ms; Zeitspur 111 ms; SFN-Prüfung 67 ms.
- Wiederverwendung mit frisch kopierten, identischen Eingaben: 0,27–0,39 ms. Dies misst den Prognosecache und ist keine gesamte Bildschirm-Ladezeit.
- Sämtliche Werte des Vergleichsmonats bleiben identisch. 192 direkte Vergleichsfälle mit der vorherigen SFN-Implementierung stimmen ebenfalls überein.
- 366 fokussierte Fachtests und 49 Komponententests bestanden; TypeScript-Prüfung bestanden.

Die vollständige Projektprüfung `npm.cmd run verify:fast` besteht: 8.177 Unit-/Integrationstests, 878 Komponententests in 115 Suiten sowie alle nachfolgenden Regel-, Audit-, Runtime- und Build-Abhängigkeitsprüfungen. TypeScript, Lint, Formatierung und `git diff --check` sind erfolgreich. Der Graft-Graph wurde aktualisiert.

Nachweise: artifacts/net-pay-performance-before.json, artifacts/net-pay-performance-after.json, artifacts/net-pay-sfn-differential.json, artifacts/net-pay-performance-verification.json und die zugehörigen Testlogs. Die neue Ansicht und die Ladezeiten auf dem iPhone sind noch nicht abgenommen; die Änderungen wurden noch nicht als OTA veröffentlicht.

Zum Screenshot: 330,63 Euro ist dort der steuerfreie Anteil (Gesamtbrutto minus Steuerbrutto). Ohne die einzelnen Zuschlagspositionen lässt sich nicht abschließend feststellen, ob dies alle Zeitzuschläge des Nutzers sind. Die neue Anzeige macht beide Anteile sichtbar. Die Zuordnung unterscheidet Nacht, Sonntag/Feiertag und sonstige Zuschläge; feste Zulagen und Überstunden werden nicht pauschal befreit. Gesetzliche Referenz: https://www.gesetze-im-internet.de/estg/__3b.html.

## Anschließend freigegebene Preview-OTA

Der Nutzer hat die Veröffentlichung anschließend ausdrücklich mit „OTA“ freigegeben. Am 10.10.2026 um 04:31:12 MESZ wurde „Netto-Prognose: schneller und kompakter“ für iOS / Preview veröffentlicht:

- Gruppe: `73acb408-6147-4d68-8c7a-f520a815add8`
- Update: `01a123a6-704e-7dc3-9488-0e8495c0bf84`
- Build 33: `8deae8f8-679b-4284-978a-a07f74fa6719`
- Runtime: `03d174d668f0ea5f757958dccf853632762c554d`
- Alle 95 nativen Fingerprint-Bestandteile stimmen mit Build 33 überein. Alle 1.334 App-/Konfigurations-/Regel-/Asset-Dateien blieben während des Bundelns unverändert; gegenüber der vorherigen OTA sind nur die acht getesteten Quelldateien geändert.
- Preview-Kanal unpausiert, aktuelle Gruppe und ausgeliefertes Update geprüft. Das ausgelieferte Hermes-Bündel ist bytegleich mit dem lokalen EAS-Preview-Export: 6.762.488 Bytes, SHA-256 `04055af007a063e041e48a490ae1df227b5e4b535808b0bd4b980cb60919ead0`.

Nachweise: artifacts/net-pay-performance-ota-summary.json, artifacts/net-pay-performance-ota-publication-verification.json, artifacts/net-pay-performance-ota-channel-summary.json und artifacts/net-pay-performance-ota-source-verification.json.

Die iPhone-Abnahme der neuen Ansicht und der tatsächlichen Ladezeiten bleibt offen. Die App vollständig schließen, öffnen und ungefähr 15 Sekunden warten, erneut schließen und öffnen. Anschließend ersten Aufruf und Wiederöffnen, beide Themes und größere Schrift prüfen. Git- oder Store-Veröffentlichung wurden nicht beauftragt.
