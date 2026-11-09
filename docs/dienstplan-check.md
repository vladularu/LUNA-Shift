# Verständlicher Dienstplan-Check

## Auftrag und Ausgangspunkt

Die im Nebenchat ausdrücklich beauftragte lokale Produktrichtung wird im Hauptchat umgesetzt: ein begrenzter Dienstplan-Check mit verständlichen Beobachtungen, eindeutigen Kategorien, erreichbaren Originalerklärungen und Quellen. Empfehlungen sind separat ausschaltbar und erhalten neutrale Karten ohne farbige Fläche oder farbigen Rahmen. Tarifprüfpunkte erhalten einen blauen, gesetzliche Prüfpunkte einen warmen orange-rötlichen Rahmen, jeweils zusätzlich zur Textbezeichnung.

Ausgangspunkt ist die technisch verifizierte iOS-Preview-OTA `067a69c1-64ca-450f-914b-5a51fa72080b` für Build 49 mit Source-Digest `e1eb08806eb527eaa3018c3fdbe434f23711bceb4f5166191371f238be8b1b87`. Die iPhone-Abnahme dieser Vorgänger-OTA wird dadurch nicht behauptet. Branch: `codex/dienstplan-check-kategorien`; HEAD: `7025cc840eb6f712cdef4476c02a93ddcca53e70`. Alle 75 zuvor geänderten Dateien und die vollständige Quellinventur sind unter `artifacts/dienstplan-check/before.json` und `before/` gesichert.

Installiertes Expo: `~57.0.31`. Die versionierte SDK-57-Dokumentation wurde vor der Umsetzung gelesen. Zielgerät ist das iPhone mit Hell-/Dunkelmodus, großer Schrift und VoiceOver.

## Nicht-Ziele und Freigaben

Keine Änderungen an gesetzlichen oder tariflichen Grenzwerten, signierten Regelpaketen, Gehalt/Sollzeit, gespeicherten Diensten, nativer Konfiguration oder Abhängigkeiten. Die zuletzt korrigierte Vier-Nächte-Schwelle in sämtlichen Prüfzweigen und der Jugend-Feiertagstext bleiben erhalten. Übersicht und Einstellungskarten bleiben neutral; die neue farbliche Kennzeichnung betrifft konkrete Ergebniskarten. Der eigene Empfehlungsschalter und die kompakte anfangs geschlossene Diensttabelle bleiben erhalten.

Der Auftrag erlaubt die lokale Implementierung. Commit, Push, OTA, native Builds und TestFlight sind nicht erneut freigegeben. Die erfolgte Vorgänger-Veröffentlichung wird nicht ersetzt, bevor eine neue Veröffentlichung ausdrücklich beauftragt wird.

## Kleine Arbeitspakete

1. **Kategorien und Ergebnisdetails, höchstens 15 Dateien:** `check-presentation.ts`, `palette-values.ts`, `compliance-issue-content.tsx`, `compliance-details.tsx`, gegebenenfalls `planning-hint-details.tsx` und `tariff-check-details.tsx`, neue gesetzliche Detail-/Quellenhelfer und zugehörige Tests. Eigentümer: Karten-Implementierer. Er besitzt auch die bestehenden DayList-/Grouped-/Tarif-Renderertests.
2. **Bündelung, höchstens 6 Dateien:** neuer reiner `check-display-groups.ts`, dessen Fachtests, `compliance-day-list.tsx` und neue Gruppen-Renderertests. Eigentümer: Gruppen-Implementierer. Keine parallelen Änderungen an `compliance-issue-content.tsx` oder `compliance-details.tsx`.
3. **Kompakter Prüfstatus und sichere Leeraussagen, höchstens 10 Dateien:** `check-prerequisites-card.tsx`, `check-scope-disclosure.tsx`, Jahres-Prüfdarstellung und passende Tests. Eigentümer: Root. Die beiden Karten-Renderer erhalten die vereinbarte Status-Schnittstelle durch ihre jeweiligen Eigentümer.
4. **Bezeichnungen und Integrationsnachweis, höchstens 15 Dateien:** Check-Titel in Einstellungen, Routen und Auswertung, zugehörige bestehende Renderertests, ein Integrationstest, dieses Dokument sowie der exakte versionierte Quelländerungsnachweis. Eigentümer: Root. Keine andere Navigation oder Kartenfamilie umgestalten.
5. **Bestehende Testverträglichkeit, höchstens 10 Dateien:** Im vollständigen Projektlauf gefundene alte Titel-, Status- und Leertext-Erwartungen in den bestehenden Tests für Regelabdeckung, große Schrift, das Dino-Spiel, leeren Monat und Prüfdetailseite auf die beauftragte Darstellung umstellen. Eigentümer: Root. Keine Produktionsänderung und keine Abschwächung von Navigations-, Lade-, Spiel-, Ergebnis- oder Barrierefreiheitsprüfungen. Generische Karten-Testdaten mit einem ausdrücklich übergebenen Titel „Prüfung“ bleiben unverändert.

## Verbindliche Schnittstellen

Ein neuer reiner Helfer liefert `CheckDisplayGroup { id, date, primary, relatedIssues }`. `primary` und `relatedIssues` sind Originalbefunde; es werden keine synthetischen fachlichen Befunde erzeugt. `ComplianceIssueContent` erhält optional `relatedIssues`.

Nur bekannte Planungsregeln werden gebündelt. Nachtserie und Erholung benötigen dieselbe validierte Sequenz. Allgemeine Dienstserie und Nachtserie müssen anhand der vorhandenen Dienste eindeutig zu einem gemeinsamen zusammenhängenden Dienstblock gehören. Der folgende Dienst aus `nextShiftId` zählt nicht als Nacht der Serie. Fehlende Daten, mehrdeutige Zuordnung, unbekannte Regeln und rein zufällige Datumsüberschneidung bleiben getrennt. Gesetzliche und tarifliche Befunde werden nicht mit Empfehlungen vermischt.

Die Gruppenkarte nennt die Anzahl ihrer Einzelprüfpunkte. Monat, Jahr und Export zählen weiterhin Originalbefunde; `countChecks`, Engine, Domain und Exportwerte bleiben unverändert. Gruppenbeobachtungen, Originalanker, Erklärungen und Quellen bleiben zugänglich. Die zugehörigen Dienste erscheinen einmal als anfangs geschlossene kompakte Übersicht aus der ID-Vereinigung.

Für den kompakten Status erhält `CheckPrerequisitesCard` zusätzlich `scopeIssues?: readonly ComplianceIssue[]` und `aggregateScopeCount?: number`. Er fasst die bisher getrennten Angaben und Bereitschaftsgrenzen zusammen. Die beiden Renderer zeigen ihn einmal für Voraussetzungen oder eingeschränkten Umfang und entfernen ihre zusätzliche separate Scope-Zeile. Der vorhandene Name bleibt für Aufrufer kompatibel.

## Abnahme

- Empfehlungen neutral, Tarif blau und Gesetz warmorange/rötlich auf neutraler Fläche, jeweils mit passendem Textlabel. Keine alleinige Unterscheidung über Farbe; Info-Symbol bei Empfehlungen bleibt ruhig.
- Karten zeigen die konkrete Beobachtung und den knappen Vergleichswert, etwa „4 Nächte in Folge“ und „Empfohlen: höchstens 3 Nächte“. Originalerklärung, vertiefter Regelmaßstab, Voraussetzungen, mögliche Ausnahmen, zugehörige Dienste und verfügbare Quellen liegen unter „Details ansehen“, auch bei gesetzlichen Prüfpunkten.
- Quellen werden nur über feste bekannte Regel-IDs und offizielle Primärlinks zugeordnet. Für Datenprobleme wird keine Rechtsquelle erfunden; unbekannte Befunde behalten ihre Originalaussage.
- Bei gebündelten Empfehlungen gehen weder zusätzliche Diensttage noch Erholung oder Originalquellen verloren. Zwei Originalbefunde können eine Karte mit zwei Prüfpunkten ergeben; Monats-/Jahres-/Exportzählung bleibt gleich.
- Fehlende Angaben und Bereitschaftsgrenzen erscheinen in einem kompakten, aufklappbaren Prüfstatus. Einzelheiten bleiben erreichbar. Unklare Voraussetzungen erzeugen keine scheinbare Freigabe.
- Der Leerzustand beschreibt ausschließlich „Keine Auffälligkeiten in den unterstützten Prüfungen“. Bei fehlenden Voraussetzungen wird die Einschränkung sichtbar.
- Schalter aus: Empfehlungen verschwinden, gesetzliche und tarifliche Prüfungen bleiben zugänglich.
- Mindestens 44 Punkte große Aktionen, schmale Ansichten, große Schrift und VoiceOver; kompakte Diensttabelle und Nachtüberläufe erhalten.
- Bestehende Fachregressionen ab vier Nächten sowie derselben/folgenden Woche bleiben grün. Aufgabenspezifische Tests, `npm.cmd run verify:fast`, unabhängiges Review, lokaler iOS-Export und exakter Quellvergleich schließen die lokale Umsetzung ab. Geräteabnahme bleibt ein eigener Schritt.

## Lokaler Abschluss am 09.11.2026

Die Umsetzung ist lokal abgeschlossen. Empfehlungen bleiben neutral, Tarif-Ergebniskarten sind blau umrandet und gesetzliche Ergebniskarten warmorange umrandet. Bekannte, eindeutig zusammengehörige Planungsbefunde werden verlustfrei gebündelt. Einzelbefunde, Quellen und die anfangs geschlossene gemeinsame Diensttabelle bleiben in den Details erreichbar. Ein kompakter Prüfstatus bündelt offene Angaben und Umfangsgrenzen; der Leertext ist ausdrücklich auf unterstützte Prüfungen begrenzt.

- `npm.cmd run verify:fast`: vollständig grün, 562 Fachtestsuites mit 10.702 Tests sowie 205 Komponententestsuites mit 1.964 Tests; sämtliche nachfolgenden Prüfskripte und Diffprüfung bestanden. Der erste Gesamtlauf fand neun veraltete Erwartungen in fünf Testdateien. Diese wurden ohne Produktionsänderung korrigiert und anschließend mit 104 gezielten Tests sowie dem vollständigen erneuten Lauf bestätigt.
- Unabhängiges Code-, Quellen-, URL-Sicherheits- und Testdiffreview: keine notwendigen Befunde offen. Geschlossene Reviewfälle betreffen widersprüchliche Nachtserien, unvollständige Folgedienst-Zuordnung, das Schließen des Status vor Profilnavigation und eine doppelte Rahmenangabe.
- Lokaler iOS-Export: erfolgreich, 34 Assets. Bundle-SHA-256: `657ca676fb1f19ac48edc8013280af7ff811fa6b68d72cb66f2681e5da4da7fd`.
- Exakter Quellvergleich: 22 geänderte Laufzeitdateien ausschließlich in der beauftragten Darstellung, alle übrigen Laufzeitquellen unverändert zur Vorgänger-OTA. Die 55 unabhängigen zuvor geänderten Dateien blieben bytegleich. Engine, Domain, Regelpakete, Berechnungen, Exportwerte, native Konfiguration und Abhängigkeiten sind unverändert. Die akzeptierte TestFlight-Baseline blieb ebenfalls bytegleich.

Geprüfter Source-Digest: `313ba7b103b1caee79e8adceb3ed60df9be15b741f1b87fce9b20d6d3a6a2c45`. Vollständiger Nachweis mit Dateihashes, Testlogs und lokalem Export: `artifacts/dienstplan-check/final-validation.json`. Der Quellschutz prüft dabei den Stand vor und nach der Gesamtprüfung gegen denselben Digest.

Für diesen neuen Stand wurden weder Commit noch Push, OTA oder nativer Build ausgeführt. Die tatsächliche iPhone-Darstellung in Hell-/Dunkelmodus, mit großer Schrift und VoiceOver bleibt abzunehmen. Lokale Tests und Export ersetzen diese Abnahme nicht.
