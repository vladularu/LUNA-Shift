# Verständlicher Dienstplan-Check

## Freigabe und Ausgangspunkt

Der Nutzer hat die zuvor besprochene Vereinfachung und anschließende iOS-Preview-OTA mit „mach das und dann ota“ freigegeben. Die vorhandene kompakte LUNA-Gestaltung bleibt die Referenz. Die Screenshots der Gruppe f1becc28-9495-4f26-8dc4-82e00115e168 bestätigen die verbesserte Liste; die darin gezeigten langen Tarif- und Empfehlungstexte werden jetzt vereinfacht.

Ausgangsquelle: f4af756a61ca9eff9a9bccf6f71344d8641fbc5cf84841766c7e9450b0a11055, HEAD 7025cc840eb6f712cdef4476c02a93ddcca53e70. Vorherige 113 geänderte beziehungsweise neue Dateien und die Laufzeitinventur sind unter artifacts/einfache-prueftexte/before.json und before/ gesichert. Kurzlebiger Arbeitsbranch: codex/einfache-prueftexte.

Zielplattform: iPhone, bestehender interner Preview-Build 49; Hell-/Dunkelmodus, große Schrift und VoiceOver. Installiertes Expo: ~57.0.31. Die passende offizielle SDK-57-Dokumentation wurde vor Codeänderungen geprüft.

## Ziel und Grenzen

LUNA zeigt kurze Beobachtungen mit verständlicher Bedeutung. Interne Voraussetzungen werden nicht als nicht bedienbare Bestätigungsaufträge ausgegeben. Der Haupttext eines Details enthält höchstens zwei kurze erklärende Sätze. Zugehörige Dienste, Quellen, Prüfgrenzen und weitere überlappende Zeiträume bleiben erreichbar und zunächst eingeklappt. Tarifliche Beobachtungen werden nicht als festgestellte Rechtsverstöße dargestellt.

Das gilt ebenfalls für ältere oder unbekannte Hinweisformen: Ein kurzer neutraler Haupttext verweist auf einen anfangs geschlossenen Bereich „Weitere Angaben“. Der vollständige gespeicherte Originaltext bleibt darin unverändert erreichbar und wird nicht abgeschnitten.

Ein laufender oder zukünftiger Zeitraum ist keine fehlende Datengrundlage. Wirklich fehlende Prüfgrundlagen bleiben im vorhandenen Prüfumfang sichtbar und erlauben keine pauschale Entwarnung. Ein konkreter Profilbutton erscheint nur, wenn er tatsächlich zur passenden bearbeitbaren Angabe führt.

Gleiche sich überlappende Beobachtungen derselben Regel und Tarifgrundlage werden in beiden Prüfansichten einmal dargestellt. Alle Ausgangsbeobachtungen bleiben über Details erreichbar. Unbekannte, widersprüchliche oder kritische Befunde werden nicht stillschweigend zusammengeführt.

Unverändert bleiben Prüfschwellen, Engine, Rohbefunde und Rohzählung, Dienst- und Profildaten, Datenbankschema, Gehalt, Zuschläge, globale Farben und Tokens, native Konfiguration und Abhängigkeiten. Keine neue Wochenendregel und keine neue Bestätigungsmaske. Die Erholungsziele 24 und 48 Stunden schließen sich weiterhin aus; die zusätzliche Differenzrechnung im Listentext entfällt.

## Getrennte Arbeitspakete

1. **A – Tariftexte und wiederverwendbare Aufklappbereiche, höchstens sechs Dateien:** tariff-check-details.tsx und Komponententest; neue tariff-check-presentation.ts und Test; neue check-detail-disclosure.tsx und Komponententest, jeweils unter src/features/analysis/.
2. **B – Empfehlungsdetails, höchstens sechs Dateien:** planning-hint-presentation.ts und Test; planning-hint-details.tsx und Komponententest; weekend-assessment-summary.tsx und Komponententest, jeweils unter src/features/analysis/.
3. **C – Integration und konservative Zusammenfassung, vierzehn Dateien:** check-prerequisites-card.tsx und Komponententest; check-scope-disclosure.tsx; check-display-groups.ts und Test; compliance-issue-content.tsx; compliance-day-list.tsx und Komponententest; compliance-details.tsx; analysis-compliance-details.component.test.tsx; dienstplan-check-groups.component.test.tsx; neuer simple-check-copy-integration.component.test.tsx; annual-report-view.component.test.tsx und planning-hint-list.component.test.tsx, jeweils unter src/features/analysis/. Die zwei zuletzt genannten Testdateien wurden nach der ersten Gesamtprüfung zugeordnet, um acht bestehende Erwartungen an das freigegebene Aufklapp- und Statusverhalten anzupassen. Keine Veränderung der Visibility-, Rohzählungs- oder Engine-Verträge.
4. **D – Root-Integration, Quellenschutz und Veröffentlichung, fünf Dateien:** dieses Dokument; ausschließlich konkret erklärte Kandidatenpfade in releases/testflight/build-9.reviewed-changes.json; check-copy.ts sowie die vorhandenen check-runner-egg.component.test.tsx und check-summary-card.component.test.tsx unter src/features/analysis/. Der gemeinsame eingeschränkte Status heißt „Prüfung eingeschränkt“, ohne semantische Lockerung. Ignorierte Aufgaben- und Veröffentlichungsnachweise liegen unter artifacts/einfache-prueftexte/ und artifacts/einfache-prueftexte-ota/.

Keine Paketüberlappung bei Schreibzugriffen. Neue Dateien oder Erweiterungen eines Pakets werden vorher abgestimmt. Quellenadressen bleiben unverändert. Der gemeinsame Aufklappbereich erhält die API CheckDetailDisclosure({title, children, testID?}), ist zunächst geschlossen, besitzt mindestens 44 Punkte Berührungsfläche und einen zugänglichen Aufklappzustand.

Die reine UI-Gruppierung darf einen optionalen Zeitzonenparameter erhalten. Beide Tarif-Prüfrenderer geben ihre bestehende Profil-Zeitzone weiter; ohne diese Angabe werden Tarifbeobachtungen konservativ nicht zusammengefasst. Vor einer Zusammenfassung müssen die tatsächlich zugeordneten Dienstzeiten die behaupteten Zeiträume und belegten Tage unterstützen. Nachtüberhänge und Zeitumstellungen werden über vorhandene Zeithilfen berücksichtigt.

## Abnahme und Veröffentlichung

- Keine pauschalen Anzeigen „Nicht beurteilbar“ oder „Einordnung prüfen“ als Aufforderung auf Tarifkarten; keine nicht bedienbaren Geltungsbereichsbestätigungen.
- Tarifhinweise, Empfehlungen und gesetzliche Auffälligkeiten bleiben unterscheidbar. Echte Lücken bleiben ehrlich erklärt und blockieren eine falsche Entwarnung.
- Kurze Details mit erreichbaren Originalzeiträumen, Diensten, Quellen und verständlichen Grenzen; überlappende Zusammenfassung in beiden Renderern abgesichert.
- Nachtlänge und Erholung bleiben fachlich unverändert; pro Nachtphase höchstens eine Erholungsaussage, ohne zusätzliche Differenzrechnung in der Liste.
- Relevante Regressionen zunächst RED, danach GREEN, unabhängiger Review, npm.cmd run verify:fast, exakter Quellenschutz und iOS-Export unter Preview-Umgebung.
- Vor Veröffentlichung frischer Abgleich von Preview-Kanal, Vorgänger und Runtime. Danach ausgeliefertes Bundle und sämtliche Assets gegen den geprüften Export vergleichen.
- Die Preview-OTA ist freigegeben. Commit, Push, PR/Merge, neuer nativer Build und TestFlight sind nicht beauftragt. Die iPhone-Abnahme der neuen Fassung bleibt nach der Veröffentlichung offen.

## Umgesetzter und unabhängig geprüfter Stand

Die Tarifkarten erklären ihre Beobachtung mit kurzen Texten. Geplante Zeiträume gelten nicht als fehlende Grundlage. Echte Lücken bleiben im Prüfumfang sichtbar; ein Profilbutton wird nur für eine vorhandene passende Eingabemöglichkeit angeboten. Gespeicherte Abweichungen bleiben ausdrücklich als „Abweichung erkannt“ sichtbar. Quellen, verständliche Prüfgrenzen, unbekannte Originalbedingungen und ältere Originaltexte bleiben zunächst geschlossen und vollständig erreichbar.

Die Empfehlungsdetails zeigen kurze Beobachtung und Empfehlung. In der Nachtliste steht die tatsächlich freie Zeit ohne zusätzliche Defizitrechnung. Wochenenddetails zeigen einen repräsentativen auffälligen Zeitraum; weitere betroffene Zeiträume lassen sich aufklappen. Eine allgemeine Wochenendstatistik wurde nicht wieder eingeführt.

Die Tarifzusammenfassung erfordert eindeutige vollständige Originale mit passenden tatsächlichen Dienstzeiten, der Profil-Zeitzone und konsistenten Beobachtungsfenstern. Mehrdeutige IDs, widersprüchliche Belege, unpassende Kalenderwochen und unterschiedliche Grundlagen bleiben getrennt. Nachtüberhänge und die Zeitumstellung sind abgesichert.

Alle drei Pakete und das kleine gemeinsame Textdelta wurden unabhängig geprüft; offene Reviewbefunde sind behoben und nachgeprüft. Die abschließende Anpassung von zwei bestehenden Tests erweitert den Umfang auf 31 Aufgaben-Dateien mit weiterhin 13 Laufzeitdateien; der erneute Review prüft dieses reine Testdelta. 88 unabhängige vorherige Dateien, die abgenommene TestFlight-Baseline und das veröffentlichte Vorgängerarchiv bleiben unverändert. Der eingefrorene Source-Digest ist fad8401ac537df31ba5a430d18860c2c63139516652f5eff02cf9b60232996c2. Der lokale iOS-Export ist erfolgreich. Die abschließenden Prüf- und Veröffentlichungsnachweise werden unter artifacts/einfache-prueftexte/ und artifacts/einfache-prueftexte-ota/ geführt.

Die abschließende vollständige Ausführung von npm.cmd run verify:fast ist erfolgreich: 10.782 Vitest-Tests in 564 Dateien, 2.020 Jest-Tests in 210 Suites und sämtliche weiteren Sicherheits- und Infrastrukturprüfungen sind grün. Das anfängliche Fehlprotokoll der acht alten UI-Erwartungen ist separat erhalten. Die beiden betroffenen Testdateien wurden ohne entfernte Fälle oder Schutzassertions an das freigegebene Verhalten angepasst und unabhängig nachgeprüft; alle zwölf vorherigen Integrationsdateien und der Produkt-Digest blieben dabei identisch. Der bereits erfolgreiche iOS-Export gehört zu genau diesem unveränderten Produktstand.

Der technische Implementierungsnachweis liegt in artifacts/einfache-prueftexte/result.json. Die gesonderte freigegebene Preview-Veröffentlichung wird mit Kanal-, Runtime-, Bundle- und Asset-Abgleich in artifacts/einfache-prueftexte-ota/release-result.json dokumentiert. Die neue iPhone-Sichtprüfung steht aus.

## Abnahme und isolierter master-Abgleich am 09.11.2026

Mit „1. ja 2. starte“ hat der Nutzer den Dienstplan-Check auf dem iPhone abgenommen. Die anschließende Freigabe erlaubt die isolierte Zusammenführung mit master und lokale Tests; die funktionierende Preview bleibt unverändert. Referenz ist Preview Build 49, Gruppe 901771fe-0888-4ab2-90f2-d12b9ec094ed, Quell-Digest e0b8f1f37cca08bfe8efdb645568c8cbd544c3fb091a2cabe02ae894d6d689c3.

Der separate Branch codex/dienstplan-check-master-abgleich basiert auf d0a08b1ca5b6b6691c7632dd87c4fd137b5abc40. Er übernimmt ausschließlich den abgegrenzten Dienstplan-Check und die Sortierkorrektur. Bestehende Gehalts-/PDF-Berechnungen, die sonstige Gestaltung von master, native Konfiguration und die akzeptierte TestFlight-Baseline bleiben erhalten. Der Quellvergleich erklärt jeden betroffenen Laufzeitpfad einzeln; die vollständige Dateiliste und Arbeitspakete liegen unter artifacts/dienstplan-integration/.

Die lokale Integration erhält einen eigenen Prüflauf. Die vorherige iPhone-Abnahme belegt die Preview-Funktionen; sie bestätigt keine zusätzliche Veröffentlichung oder Geräteprüfung des integrierten master-Kandidaten. Commit, Push, PR/Merge, OTA und native Builds sind weiterhin nicht freigegeben.
