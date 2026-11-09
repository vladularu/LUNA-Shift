# Wochenenden: Vierwochenhinweis und getrennte Prüfungen

## Auftrag

Der Nutzer hat die recherchierte Richtung ausdrücklich zur lokalen Umsetzung freigegeben: Die bisherige Dreier-Regel wird durch einen Hinweis auf weniger als zwei vollständig freie Samstag/Sonntag-Wochenenden innerhalb von vier Wochen ersetzt. Monatszahlen werden angezeigt. Gesetzliche und tarifliche Ansprüche bleiben eigenständige Prüfungen.

Ausgangspunkt ist die technisch geprüfte iOS-Preview-OTA `5521589e-ddb7-4bb0-a1cd-00c1d039bb30`, Source-Digest `313ba7b103b1caee79e8adceb3ed60df9be15b741f1b87fce9b20d6d3a6a2c45`. Branch: `codex/wochenenden-vier-wochen`, HEAD: `7025cc840eb6f712cdef4476c02a93ddcca53e70`. Alle 97 vorher geänderten Dateien sind einschließlich vollständiger Laufzeitinventur unter `artifacts/wochenenden-vier-wochen/before.json` und `before/` gesichert.

Installiertes Expo ist `~57.0.31`. Vor Änderungen wurde die SDK-57-Dokumentation gelesen. Ziel ist das iPhone in Hell-/Dunkelmodus, mit großer Schrift und VoiceOver. Recherchegrundlage ist `artifacts/wochenenden-recherche/Ergebnis.md`, insbesondere BAuA-Handbuch Arbeitszeit, Stand März 2016, Frage 42 auf Seite 33. Die dort dokumentierte PDF-Zugriffsgrenze bleibt transparent; es wird keine umfassende Rechtsfreigabe eines Plans behauptet.

## Grenzen

Keine Änderung von Gehalt, Zuschlägen, Sollzeit, gespeicherten Diensten, nativer Konfiguration, Abhängigkeiten, Datenbankschema oder signierten Regelpaketen. Die bestehenden Nachtregeln ab vier Nächten und der korrigierte Jugend-Feiertagstext bleiben erhalten. Empfehlungen behalten ihren unabhängigen Schalter und neutrale Info-Darstellung; Tarif-Ergebniskarten bleiben blau, gesetzliche warmorange. Übersicht und Einstellungen bleiben neutral.

Dies ist eine lokale Implementierungsfreigabe. Commit, Push, OTA, native Builds, TestFlight und Store sind nicht beauftragt. Bestehende Veröffentlichungsnachweise und die abgenommene TestFlight-Baseline werden nicht überschrieben.

## Vier kleine Pakete

1. **A – Modell und Engine, höchstens 15 Dateien:** Wochenendpolicy und Facts, Ergebnisvertrag, Wochenendberechnung, Anschluss in normalen/Jugend-/Leerpfaden, datumsgetrennte Zusammenführung, Eingabehorizont und deren gezielte Tests. Eigentümer: Engine-Implementierer.
2. **B – Darstellung, höchstens 14 Dateien:** neue neutrale Monatsstatistik mit Details, bestehende Monatsübersicht und Dashboardkarte, beide Ergebnisrenderer, neue Empfehlungstexte und zugehörige Tests. Eigentümer: UI-Implementierer.
3. **C – Gesetz/Tarif, höchstens 15 Dateien:** bestehende Tarifprüfung um eine sichere Sonntagsbeobachtung ergänzen, Quellen-/Geltungsbereich präzisieren, eigene Tarifdetails und Tests. Gesetzesregeln wiederverwenden und gezielt auf Regressionen prüfen. Eigentümer: Tarif-Implementierer.
4. **D – Integration, höchstens 15 Dateien:** allgemeine Kurz-/Legacytexte und Tests, Zurückziehen alter Dreierbefunde aus Sichtbarkeit/Zählung, Cacheversion, Monats-/Jahres-/Exportintegration, leere Monate, dieses Dokument und exakter Quelländerungsnachweis. Eigentümer: Root.

Wenn notwendige zusätzliche Dateien ein Paket über 15 bringen, wird vor dessen Bearbeitung ein weiteres abgegrenztes Paket dokumentiert. Keine parallele Bearbeitung derselben Dateien.

## Verbindlicher Modellvertrag

`MonthlyComplianceResult.weekendAssessment?: PlanningWeekendAssessment` ist ein berechnetes, cacheserialisierbares Ergebnis; keine neue persönliche Einstellung.

- Assessment: `policyVersion`, `month`, `weekends`, `totalCount`, `freeCount`, `occupiedCount`, `unknownCount`, `windows`.
- Wochenende: `saturday`, `sunday`, `status` (`FREE`, `OCCUPIED`, `UNKNOWN`), `relatedShiftIds`, `reasons`.
- Fenster: `from`, `until` mit **inklusivem** Montag/Sonntag, vier `weekends`, `freeCount`, `occupiedCount`, `unknownCount`, `assessmentComplete`. Die Fensterprüfbarkeit bleibt getrennt von sicher belegten Monatsdaten.
- Neue Hinweis-Facts: `{ rule: "PLANNING_WEEKEND_RECOVERY", assessment }`. Alte `PLANNING_WEEKENDS`-Facts werden nie als neuer Vierwochenbefund interpretiert.

Jeder Sonntag im Anzeigemonat beendet ein Betrachtungsfenster von vier vollständigen Montag–Sonntag-Kalenderwochen. Monatszahlen enthalten die Wochenenden, deren Sonntag im Monat liegt; der zugehörige Samstag kann im Vormonat liegen. Kalendermonate werden nicht mit vier Wochen gleichgesetzt. Kalendergrenzen werden in der Profilzeitzone berechnet; Sommer-/Winterzeit verändert keine Kalendertagszählung.

Bekannte Dienstüberschneidungen belegen ein Wochenende. Vollständig frei wird es nur bei bestätigter vollständiger Arbeitserfassung, ausreichendem Eingabehorizont und ohne offene Dienst-/Bereitschaftszeiten. Unklare Daten bleiben offen; leere Kalendertage allein sind kein Freizeitbeweis. Verlässlich belegte Bereitschaftsbindung kann die Wochenendfreizeit statistisch belegen, ohne damit pauschal eine gesetzliche Arbeitszeitwertung vorzunehmen. Unvollständige Ruf-/Bereitschaftsmodelle bleiben unklar.

Nur vollständig beurteilbare Vierwochenfenster mit weniger als zwei freien Wochenenden erzeugen den neuen Empfehlungshinweis. Pro Monat erscheint höchstens eine entsprechende Karte; alle betroffenen Fenster und ihre Daten bleiben in Details erreichbar. Offene Fenster werden dort klar benannt. Monatszahlen bleiben auch bei null Befunden und ausgeschalteten Empfehlungen sichtbar.

Bei Beschäftigungs-/Zeitzonen-/Vollständigkeitsverläufen darf das Monatsmodell nicht aus dem ersten Teilabschnitt übernommen werden. Das endgültige Modell wird aus dem gesamten geladenen Zeitraum gebildet; echte Änderungen der Beurteilungsgrundlage bleiben konservativ offen. Reine Tarif-/Gehaltswechsel entwerten die Wochenendstatistik nicht automatisch. Die gemeinsame Berechnungsversion invalidiert Monats- und Jahrescaches.

## Gesetz und Tarif

Bestehende Erwachsenen-Sonntagsruhe und beide Jugend-Prüfpfade bleiben unabhängig von der Empfehlung aktiv. Keine Regel „zwei volle Wochenenden pro Kalendermonat“ wird daraus erfunden.

Die vorhandene Tarifprüfung freier Tage einschließlich des zusammenhängenden TV-UK-Blocks bleibt erhalten. Neu wird ein bezeichnetes Zweiwochen-Beobachtungsfenster mit beiden belegten Sonntagen als `TARIFF_FREE_SUNDAY` prüfbedürftig dargestellt. Der Status ist `REVIEW` oder `PENDING`, kein automatisch festgestellter Verstoß. Zugehöriger Tarif, Originalfundstelle, Zeitraumzuordnung, Regelmäßigkeit und Geltungsbereich werden offengelegt. Die Zulässigkeit von Sonntagsarbeit beweist keine regelmäßige Sonn-/Feiertagsarbeit. TV-H-JVA-Geltung und Ausbildungs-Verweisungen werden nicht pauschal unterstellt. Kein neuer Schalter oder Einstellungsbereich wird eingeführt.

## Abnahme

- A–A–F–F erreicht zwei freie Wochenenden; A–A–A–F erreicht nur eines. Bei F–A–A–A–F werden beide betroffenen Viererfenster erfasst, ohne Kartenflut. Die Grenze bei genau zwei ist stabil.
- Monats-/Jahreswechsel, randüberschreitende Samstage, Freitagnächte, Sonntagnächte, Tagesgrenzen, DST, unvollständige Zeiten, Bereitschaft, Löschung/Revision und Beschäftigungsverlauf sind getestet.
- Bei fehlender Bestätigung/Horizont stehen offene Wochenenden und Fenster sichtbar da; keine sichere Freizeit oder Freigabe wird behauptet.
- Monatszahlen sind auch bei null Befunden, vollständig leerem Monat und ausgeschalteten Empfehlungen erreichbar. Beide Renderer und die bestehende Monatsübersicht nutzen denselben Modellvertrag.
- Die Empfehlung nennt Beobachtung und Maßstab kurz. Quellen, Grenzen, betrachtete Fenster und eine anfangs geschlossene kompakte Dienstübersicht liegen unter Details.
- Gesetzliche/tarifliche Befunde bleiben bei ausgeschalteten Empfehlungen sichtbar. Eine Sollvorgabe wird nicht zu einem harten Verbot umgedeutet.
- Mindestens 44 Punkte große Aktionen, Zeilenumbruch bei großer Schrift, verständliche VoiceOver-Namen und die bisherigen Kategorie-Farben bleiben erhalten.
- Gezielte Fach-/Renderer-/Integrationsprüfungen, `npm.cmd run verify:fast`, unabhängiges Review, lokaler iOS-Export und exakter Quellvergleich sind erfolgreich. Reale iPhone-Abnahme bleibt ein eigener nachfolgender Schritt.

## Umgesetzt und lokal geprüft

Der endgültige Laufzeitstand hat Source-Digest `df0fba0733dde5e2739401995d6260afff50ec6d3c85ab49bb6b5f3dad5ad3cf`. Genau 24 Laufzeitdateien wurden gegenüber der veröffentlichten Preview angepasst. Der auf vier Pakete verteilte Scope umfasst 44 Dateien: 24 Laufzeitdateien, 18 Testdateien, dieses Dokument und den exakten Quelländerungsnachweis. Paket A enthält nach der begründeten Erweiterung eines vorhandenen Horizonttests zwölf Dateien; alle Pakete bleiben unter 15 Dateien.

`npm.cmd run verify:fast` ist vollständig mit Exitcode 0 abgeschlossen: 10.732 Fachtests in 563 Suiten und 1.976 Komponententests in 206 Suiten sowie alle weiteren Pflichtprüfungen sind grün. Der lokale iOS-Export mit SDK 57 und `APP_VARIANT=internal` ist ebenfalls erfolgreich. Die abschließenden 130 Integrationsfälle prüfen unter anderem Monats-/Jahres-/Exportabgleich, gespeicherte Modelle und das Zurückziehen alter Wochenendbefunde.

Die unabhängigen Reviews aller vier Pakete sind ohne offene Befunde abgeschlossen. Gefundene Randfälle wurden mit RED/GREEN abgesichert: zu schmale Eingabehorizonte, eine zu spezielle Erklärung offener Dienstdaten, zurückgezogene Cache-Voraussetzungen und widersprüchliche Monats-/Befundmodelle. Ein alter Integrations-Grenztest erwartete noch den bisherigen kürzeren Ladezeitraum; er prüft jetzt zusätzlich den benötigten Unterrand am 25. Mai 2026 und den Ausschluss des 24. Mai. Die bisherigen oberen Grenzen und die getrennte Zulagenauswahl bleiben exakt abgesichert. Der erste fehlgeschlagene Vollprüflauf bleibt im Artefaktordner erhalten.

Der Quellenwächter bestätigt unveränderte Laufzeitdateien außerhalb der 24 benannten Änderungen und unveränderte Rohbytes von 64 bisherigen geänderten Dateien außerhalb dieses Auftrags. Die abgenommene TestFlight-Baseline und das Archiv der veröffentlichten Preview bleiben identisch. Vorherstand, Paketnachweise, Reviews, Prüflogs, iOS-Exporthashes und endgültiger Nachweis liegen unter `artifacts/wochenenden-vier-wochen/`.

Es wurde nichts committet, gepusht oder als OTA bzw. nativer Build veröffentlicht. Die reale iPhone-Abnahme in Hell-/Dunkelmodus, mit großer Schrift und VoiceOver steht aus.
