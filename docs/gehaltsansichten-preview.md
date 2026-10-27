# Gehaltsansichten: ursprüngliche Karten und flache Navigation

## Task-Vertrag vom 27.10.2026

- Ziel: die ursprüngliche helle Kartenstruktur wiederherstellen, Brutto als reine Auflistung zeigen und genau einen direkten Zugang „Zulage prüfen“ auf der Gehaltsseite anbieten.
- Nicht-Ziele: Änderungen an Berechnungen, Tarifregeln, gespeicherten Angaben, nativen Dateien, Abhängigkeiten oder globalen Design-Tokens.
- Zielplattform: bestehende iOS-Preview-App, APP_VARIANT=internal, Kanal/Branch und Environment preview. Der Systemmodus bleibt berücksichtigt.
- Freigabe: Umsetzung und Preview-OTA zum Testen ausdrücklich beauftragt. Git-Veröffentlichung, native Builds und TestFlight/Production sind nicht beauftragt.
- Arbeitsbranch: codex/gehalt-karten-preview, Basis 4685fd0e5269403cc2899afa23f78355945b3b52. Expo ~57.0.31; SDK-57-Dokumentation geprüft.

## Arbeitspakete und Scope

1. Rücknahme des verworfenen Entwurfs: frühere SalaryPage-, Zuschlags-, Dienstlisten- und Bearbeitungsstruktur aus der Basis wiederherstellen. Die eigenen 17 Dateien wurden zuvor gegen das veröffentlichte SHA-256-Manifest geprüft und außerhalb des Checkouts gesichert. Zusätzliche Seiten für Jahressonderzahlung und Steuer-/Beitragsdetails sowie Kategorie-Links entfallen.
2. Gezielte UI-Korrektur: konkrete Zulagenart, lesende Brutto-Zeilen, direkter Prüfzugang und einheitliche Begriffe. Produktionsscope: src/features/salary/, die beiden vorhandenen Gehaltszeilen in src/features/analysis/ sowie tariff-assessment-screen.tsx. Dazu vorhandene Komponententests und dieses Protokoll. Keine Engine-, Datenbank-, Navigationsschema- oder nativen Änderungen.
3. Prüfung und Preview: fokussierte Tests, verify:fast, Fingerprint, iOS-Export, ausschließlich Preview-OTA und Kontrolle der tatsächlich ausgelieferten Bytes.

## Abnahmekriterien

- Ursprüngliche Karten mit bestehenden Rahmen, Radien, Abständen und Überschriften bleiben erhalten.
- Der dekorative Mond entfällt in der Zuschlagskarte.
- Jahressonderzahlung ist in Übersicht, Brutto, Bearbeitung und Grundlagen einheitlich benannt.
- Brutto zeigt alle Beträge als reine Auflistung ohne Pfeile oder versteckte Klickziele; Abzüge und Berechnungsgrundlagen werden direkt von Gehalt aus geöffnet.
- Die Zulagenbezeichnung entspricht der gespeicherten Monatsauswahl; ohne Auswahl wird die automatische Einschätzung mit dem Hinweis „Geschätzt“ verwendet. Die vier Schicht-/Wechselschichtarten werden unterschieden. Der Status ist auch für VoiceOver verfügbar.
- Genau ein „Zulage prüfen“-Eintrag auf der Gehaltsseite öffnet die bestehende Prüfung für den sichtbaren Monat. Für manuelles Gehalt und Testdaten wird kein unpassender Prüfzugang angezeigt.
- Die Prüfansicht behält Kriterien, Erklärung und Monatskorrektur. Der zusätzliche Weg von dort ins Arbeitsmodell entfällt; die vorhandenen Arbeitseinstellungen bleiben der Bearbeitungsort.
- Jahressonderzahlung wird wieder direkt über die bestehende Bearbeitung angepasst. Es gibt keine zusätzliche lesende Zwischenebene.
- Beträge und wirksame Monate bleiben unverändert. Monatsnavigation, Zurückwischen, große Schrift und bestehende Fehlerzustände bleiben erhalten.
- Fokussierte Tests und verify:fast bestehen. Preview-Runtime wird vor Veröffentlichung mit dem bestehenden iOS-Build abgeglichen.

## Ausgangsstand und Gerätenachweis

- Vor der Korrektur: Preview-Gruppe 2886064b-4611-4a75-a8bf-0fd147ea203d; vom Nutzer anhand der iPhone-Ansicht verworfen.
- Ursprüngliche fünf Fotos dienen als Kartenreferenz. Das weitere Foto zeigt die zu vereinfachende Zulagenprüfung.
- Aktuelles EAS-Preview-Listing vor der Arbeit bestätigt diese Gruppe und Runtime b99c3cf0dd56e6b1bb126d195f21c665de57760b. Build und Runtime werden vor der Veröffentlichung erneut geprüft.
- Der Nutzer hat den veröffentlichten Stand auf dem iPhone getestet und am 27.10.2026 ausdrücklich abgenommen: „Hab es auf dem iPhone getestet, so passt die Ansicht jetzt. Bitte diesen Stand beibehalten.“ Modell und iOS-Version wurden nicht genannt; der Nachweis ist die direkte Rückmeldung in dieser Aufgabe.
- Abgenommene Preview-Gruppe: ecc764d7-37be-4ed2-ae42-82ec4bfdf704, Update 01a17edd-36d0-79c8-a353-fb6dd17d7545, Build 44. Dieser Stand ist die Referenz für die Gehaltsansichten.

## Prüfung

- 138 gezielte Komponenten- und Ablaufprüfungen bestanden, einschließlich der Tarifabdeckung für TVöD, TV-L, TV-H, TV-UK und Ausbildung.
- Der interne Fingerprint passt exakt zur Runtime von iOS-Preview Build 44.
- iOS-Hermes-Export mit Preview-Umgebungsvariablen erfolgreich erstellt.
- Vollständiges verify:fast bestanden: 491 Unit-Testdateien mit 9.727 Tests, 155 Komponentensuiten mit 1.437 Tests sowie die enthaltenen Projekt-, Sicherheits- und Runtime-Prüfungen.
- Die Preview-Veröffentlichung ist mit Quellmanifest und Auslieferungsnachweis dokumentiert. Manifest und Bundle lieferten HTTP 200; lokale und ausgelieferte SHA-256-Prüfsummen stimmen überein. Die anschließende iPhone-Abnahme ist oben festgehalten.

## Freigabe zur Übernahme

- Der Nutzer hat am 27.10.2026 Commit, Push, PR, Merge nach grüner CI und anschließend ein OTA für TestFlight ausdrücklich beauftragt.
- Der akzeptierte Quellstand bleibt unverändert. Nur diese Dokumentation ergänzt Abnahme und Übernahmefreigabe.
- Vor dem Commit: alle Quell-/Testdateien mit dem Preview-Quellmanifest vergleichen; genau die 14 freigegebenen Dateien aufnehmen.
- Vor dem Merge: vollständige PR-Dateiliste, Head/Base und alle sieben CI-Prüfungen einschließlich quality-gates kontrollieren. Danach den Merge mit dem geprüften Quellstand vergleichen.
- Das TestFlight-OTA wird erst danach für APP_VARIANT=production, iOS und Kanal/Branch/Environment production vorbereitet. Runtime und aktueller Production-Ausgangsstand werden separat geprüft. Native Builds sind nicht beauftragt.
- Die Preview-Abnahme und die anschließende TestFlight-Abnahme sind getrennt dokumentiert. Beide bestätigen die Gehaltsansichten des unten festgehaltenen Referenzstands.

## Erfolgreiche TestFlight-Abnahme und Referenzstand

Der Nutzer hat die Gehaltsansichten am 27.10.2026 auch in der über TestFlight installierten LUNA-App auf dem iPhone erfolgreich getestet und ausdrücklich abgenommen:

> Hab es jetzt auch in TestFlight auf dem iPhone getestet, passt so. Bitte diesen Stand beibehalten.

Die direkte Rückmeldung in dieser Aufgabe bestätigt die Aktivierung und die Darstellung der Gehaltsansichten. Modell und iOS-Version wurden nicht genannt; ein zusätzlicher Screenshot wurde nicht bereitgestellt. Die Abnahme bezieht sich auf die Gehaltsansichten dieses Updates.

| Referenz                       | Abgenommener Stand                                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Pull Request                   | [PR #324](https://github.com/vladularu/LUNA-Shift/pull/324), nach sieben erfolgreichen CI-Prüfungen gemergt                                   |
| Quellstand                     | `f255b94b490325f18f7fdd617052bb910945df70`                                                                                                    |
| TestFlight-Build               | iOS Build 8, Build-ID `2c6c8695-d965-4c0d-804c-7bc65fd91ec2`                                                                                  |
| App und Umgebung               | `com.lunashift.app`, `APP_VARIANT=production`, Kanal/Branch/Environment `production`                                                          |
| Runtime                        | `ab053760e06bdf85a83f64fc65cfee0aab41fe12`                                                                                                    |
| OTA-Gruppe                     | [d7289818-49a5-41d9-b8f1-657e1eccb94d](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/d7289818-49a5-41d9-b8f1-657e1eccb94d) |
| OTA-Update                     | `01a17ef4-d394-773d-bfbd-d06b3756a12a`                                                                                                        |
| Ausgeliefertes Bundle, SHA-256 | `60d9388c3017e763b2769b8dd82c002ed3cc5e3ac43e338677e1126b2344bfb5`                                                                            |

Manifest und Bundle wurden bei der Veröffentlichung mit HTTP 200 und übereinstimmenden lokalen/CDN-Prüfsummen technisch geprüft. Die anschließende Nutzerabnahme ergänzt diesen Nachweis um die Prüfung auf dem iPhone; die TestFlight-Abnahme ist damit abgeschlossen.

Die oben beschriebenen Gehaltsansichten sind sowohl in Preview als auch in TestFlight abgenommen. Die ursprünglichen Karten, Brutto als reine Auflistung, die konkrete Zulagenart, der einmalige direkte Zugang „Zulage prüfen“, die Bezeichnung „Jahressonderzahlung“ und die Ansicht ohne dekorativen Mond bilden den verbindlichen Referenzstand für weitere Änderungen. Diese Abnahmedokumentation ändert weder die Oberfläche noch Berechnungen oder das veröffentlichte OTA.
