# Tarifregeln in der bestehenden Prüfung

Stand 08.11.2026, Expo ~57.0.31; SDK-57-Dokumentation geprüft.

## Auftrag und Freigabe

Die Nutzerkorrektur und anschließend ausdrücklich gewählte Option lauten: „Tarifregeln in die bestehende Prüfung integrieren, ohne zusätzlichen Schalter“. Hinweise und Empfehlungen bleiben separat ein-/ausschaltbar. Die vorher missverstandene Entfernung der Empfehlungen wird nicht umgesetzt.

Grundlage sind die Quellen- und Regelmatrix vom 08.11.2026 in `output/tarifregeln-2026-11-08`. Diese Untersuchung unterscheidet gesetzliche Vorgaben, verbindliche Tarifnormen und freiwillige Empfehlungen. Die rechtsverbindlichen Tarifnormen ergänzen jetzt die vorhandene dauerhafte Prüfung; sie werden nicht unter den Empfehlungsschalter verschoben.

Zielplattform ist die bestehende iPhone-App in Hell/Dunkel und großer Schrift. Commit, Push, native Builds, OTA und Katalogveröffentlichungen sind nicht freigegeben.

## Arbeitsstand

Kurzlebiger Branch `codex/tarifpruefung-integration`, Basis `d0a08b1ca5b6b6691c7632dd87c4fd137b5abc40`, aktueller Remote-Master zum Arbeitsbeginn. Die bereits autorisierten lokalen Änderungen zu Nachtserien und Detaildarstellung wurden unverändert gesichert (`artifacts/tarif-integration/before.json` und Dateikopien). Unabhängige Änderungen des Desktop-Hauptcheckouts werden nicht übernommen oder bearbeitet.

## Getrennte Pakete

1. Quellen-/Geltungsmodell und reine Tarifprüfer: datierte Tarifzuordnung, Wochenverteilung und tarifliche freie Tage mit konkreten Quellen und Nachweisstatus. Bei fehlenden Voraussetzungen keine erfundene Erlaubnis oder Rechtsverletzung. Kleine fachliche Teilpakete statt eines pauschalen Tarifadapters.
2. Anbindung an die vorhandene Berechnung: identische Ergebnisse in Monatsübersicht, Detailseite, Jahresauswertung und Export; Beschäftigungswechsel, Caches und Vor-/Folgezeiträume berücksichtigen. Die gesetzliche Berechnung wird weiterverwendet.
3. Darstellung: Tarifbefunde innerhalb der vorhandenen gesetzlichen Prüfung, kein zusätzlicher Schalter. „Hinweise & Empfehlungen“ bleiben eine eigene, abschaltbare Kategorie mit Info-Symbol, petrolfarbenem Rahmen und neutraler Fläche. Sachverhalt und kurze Quelle stehen auf der Karte; Dienste, Erklärung und Originalfundstelle unter „Details ansehen“.

Jedes Teilpaket wird vor Überschreitung von 15 Dateien weiter geteilt. Keine neue native Integration, keine Änderung von Gehalt, Sollzeit, Zuschlagssätzen, signierten Katalogen oder gespeicherten persönlichen Daten.

## Fachliche Abnahme

- Ein tariflicher Befund bleibt bei `showPlanning=false` sichtbar und zählt zur vorhandenen rechtlichen Prüfung.
- TVöD, TV-L und TV-UK erhalten unterschiedliche Regeln statt bloß unterschiedlicher Namen. Insbesondere fünf/sechs Tage, notwendige/dringende Gründe, durchschnittliche Tagesverteilung und zusammenhängendes Frei werden getrennt behandelt.
- Sieben Tage Montag–Sonntag werden anders zugeordnet als sieben Tage Mittwoch–Dienstag. Nachtschichten, Monats-/Jahreswechsel und Zeitzone verwenden explizite Kalender-/Zeitbegriffe.
- Reguläre Arbeit, Überstunden, tatsächliche Bereitschaft und Rufbereitschaftseinsätze werden nicht ungeprüft gleichgesetzt. Leere Kalendertage bestätigen keine Freizeit.
- FORECAST-Sollzeitmodelle werden nicht als bestätigter Dienstplan oder nachgewiesene Ausnahme verwendet.
- Unbekannter Tarifbereich, nicht geprüfte Normfassung oder unvollständiger Bezugszeitraum ergibt einen konkreten Prüfstatus. Die App behauptet dadurch keine vollständige Tarifkonformität.
- Hinweise und Empfehlungen bleiben erhalten. Vier Nächte und 24-/48-Stunden-Stufen werden nicht als Tarifrecht umetikettiert.
- Sichtbarkeit, Quellen/Details, gespeicherter Empfehlungsschalter, Jugendprüfung und gesetzliche Bestandsregeln haben gezielte Regressionstests.

## Prüfungen und Lieferung

Fokussierte Referenz-, Integrations- und Komponententests pro Paket, anschließend `npm.cmd run verify:fast`. Wegen der übergreifenden Integration folgt das vollständige Gate, soweit die vorhandene Umgebung es ausführen kann. Quellzuordnung wird mit dem bestehenden Review-Nachweis aktualisiert; der akzeptierte Build-Nachweis bleibt unangetastet. Geräteabnahme erfolgt nach einer separat autorisierten Preview-OTA. Metadaten und automatisierte Tests ersetzen den iPhone-Nachweis nicht.

## Umgesetzter Prüfumfang

- `TARIFF_WEEK_DAYS`: ab sechs belegten Arbeitstagen in derselben Kalenderwoche wird die familienbezogene Fünf-/Sechstageverteilung zur Prüfung vorgelegt. TV-UK behält sein Durchschnittsmodell. Mehrarbeit, persönliche Anwendbarkeit und Ausnahmegründe werden ausdrücklich zur Klärung benannt; die bloße Schichtzahl ergibt keinen automatischen Rechtsverstoß.
- `TARIFF_FREE_DAYS`: eigene Zweiwochen-Beobachtung für die passenden Krankenhaus-/Pflegebereiche, TV-UK zusätzlich mit zusammenhängendem Zweitageblock. Ein Befund entsteht nur, wenn selbst alle noch möglichen freien Tage die Orientierung nicht erfüllen können. Der konkrete tarifliche Bezugszeitraum muss weiterhin zugeordnet werden. Leere Kalendertage sind kein Beweis arbeitsfreier Tage.
- `TARIFF_SCOPE`: fehlende, widersprüchliche oder nicht geprüfte datierte Tarifgrundlagen werden als Voraussetzung angezeigt. Explizit fehlerhafte/laufende Sollzeitkontexte oder Lücken fallen nicht auf die aktuelle Gehaltsauswahl zurück. Beschäftigungsgrenzen und Änderungen des bestätigten Geltungsbereichs werden berücksichtigt.
- Quellenfamilien: TVöD BT-K/BT-B, TV-L allgemein/Pflege, TV-UK Pflege BW sowie Verweisungen für erwachsene TVAöD-/TVA-L-Auszubildende. TV-H Pflege bleibt wegen des Justizvollzugs-Geltungsbereichs und des noch ausstehenden Originalabgleichs bedingt. Die geprüfte Zeitabdeckung 2026 ist keine behauptete tarifliche Ablauffrist.
- Empfehlungen: Nachtserien ab vier Nächten und die 24-/48-Stunden-Stufen bleiben erhalten. Arbeitsserien folgen der ausdrücklich gewählten BAuA-Empfehlung mit höchstens fünf Tagen; der Hinweis beginnt ab sechs. Der pauschale Automatismus zu zwei gearbeiteten Wochenenden wurde entfernt.

Die vorhandenen gesetzlichen Pausen-/Ruhezeit-/Ausbildungs- und Bereitschaftsprüfungen bleiben bestehen. Nicht belegte Betriebsvereinbarungen, Opt-ins oder weitere tarifliche Ruhezeitöffnungen werden durch dieses Paket nicht als Erlaubnis aktiviert. Es wird keine vollständige Prüfung aller Tarifbestimmungen behauptet.

## Technische Nachweise

Vor dem Gesamtgate bestanden die beiden Tarif-Engine-Suiten mit 42 Tests, die sechs betroffenen UI-Suiten mit 76 Komponententests sowie acht reine Darstellungstests. Integration, Jahresberichte, Cachevalidierung und Export bestanden zusammen 84 gezielte Tests; weitere Komponentenprüfungen bestanden ebenfalls. Der abschließende TypeScript-Check ist grün. Ein unabhängiges Code-/Sicherheitsreview hat die beiden gefundenen Kontextfehler nach Korrektur erneut geprüft und keine weiteren notwendigen Findings gemeldet.

Der Quellvergleich zu `artifacts/hinweise-details/source-check.json` bestätigt genau 29 Appquelldateien in diesem Integrationspaket. Der akzeptierte Build-9-Nachweis, signierte Regeln, native Konfiguration, Abhängigkeiten und alle nicht zugehörigen Appquellen bleiben bytegleich. Der lokale Nachweis liegt in `artifacts/tarif-integration/source-check.json`; er ist weder eine OTA-Veröffentlichung noch eine Geräteabnahme.

Der erste vollständige Lauf bestand `verify:fast` mit 10.570 Fachtests und 1.938 Komponententests; die anschließende parallele Coverage meldete 16 Zeitüberschreitungen in sechs Jahressuiten. Dabei wurde zusätzlich unnötige Tarifkontext-Auflösung für leere und dünn belegte Monate entfernt. Die drei neuen Regressionen bestätigen null Abfragen bei leerem Monat, erhaltene Scopebefunde bei wenigen Diensten und vermiedene Wochen-/Freitageabfragen ohne Kandidaten. Die 136 Tests der sechs betroffenen Jahressuiten bestanden danach auch mit Coverage. Die Optimierung wurde unabhängig nachgeprüft; es gibt keine Änderung an Regeln, Zeitgrenzen oder Coverage-Schwellen.

Das abschließende Gate führte erneut `verify:fast` und alle übrigen Schritte aus `verify:full` aus. Nur die Unit-Coverage lief mit `--maxWorkers=1`, um die bekannte CPU-Konkurrenz der Jahresprüfungen zu vermeiden; Komponentencoverage, Audit, Release-Konfiguration und Web-/Android-/iOS-Exporte blieben vollständig erhalten. Das Abschlussprotokoll liegt unter `artifacts/tarif-integration/verify-full.log` und endet mit Exitcode 0.

## Abschlussergebnis

- `verify:fast`: bestanden, 555 Fachtest-Suiten mit 10.573 Tests sowie 201 Komponentensuiten mit 1.938 Tests; auch Regel-, Sicherheits-, Runtime-, Format- und Diff-Prüfungen grün.
- Vollständige Unit-Coverage: 554 Suiten mit 10.572 Tests bestanden. Der bereits im npm-Skript ausgeschlossene Performance-Test wird dort weiterhin nicht instrumentiert. Zeilen 93,63 %, Statements 92,09 %, Zweige 89,69 %, Funktionen 94,90 %.
- Vollständige Komponentencoverage: alle 201 Suiten und 1.938 Tests bestanden.
- Produktionsaudit: gemäß Projektpolicy bestanden; vorhandene installierte Sicherheitsbackports verifiziert. Release-Konfiguration konsistent.
- Lokale Expo-Exporte für Web, Android und iOS erfolgreich. Dies sind keine nativen Builds und keine Veröffentlichung.
- Abschließender Quellvergleich bestanden: 29 Appquelldateien dieses Pakets; Digest `7cf77b0a965f32558d5d104321c33f719b0e8de0c2eba16d72da901c3f0a76c2`. Akzeptierter Build-Nachweis und nicht zugehörige Quellstände bleiben erhalten. Reproduzierbarer Nachweis: `artifacts/tarif-integration/final-validation.json`.

Die lokale Implementierung ist abgeschlossen. Offen bleibt die iPhone-Abnahme in Hell/Dunkel und großer Schrift nach einer separat freigegebenen Preview-OTA. Commit, Push, OTA und native Builds wurden in diesem Auftrag nicht ausgeführt.

## Separat freigegebene Preview-OTA am 08.11.2026

Auf den anschließenden ausdrücklichen Auftrag „ota“ wurde die Erweiterung als iOS-Preview veröffentlicht: Gruppe `d02074b8-98a3-4abd-96b8-f551ab43f046`, Update `01a1b91e-8996-7d96-b93e-0eb5e09d3971`. Kanal, Branch und Environment sind `preview`; die interne Runtime `402e757d98ca799660ce5dd15a24bd999cf690eb` entspricht dem bestehenden Build 49.

Der isolierte Veröffentlichungsstand `codex/tarif-preview-ota` übernimmt die 29 freigegebenen Appdateien exakt aus der Implementierung und bewahrt die übrigen 1.160 Quellen der tatsächlich zuletzt ausgelieferten Preview. Dadurch bleiben auch die bestätigte Luftig-Darstellung sowie Jahresnetto und PDF erhalten. Der veröffentlichte Quell-Digest lautet `23b663d5408fc85dcc19efa533e6bb63d971a283c2b6b8f260ba84bfe1bdd6f5`.

`verify:fast` bestand auf diesem zusammengeführten Stand mit 10.573 Fachtests und 1.938 Komponententests. Nach einem einzelnen Parallel-Timeout wurde unverändert mit `VITEST_MAX_WORKERS=2` geprüft; Testgrenzen und Appcode wurden dafür nicht geändert. Der iOS-Export wurde unter der EAS-Preview-Umgebung erstellt, die aktive Vorgänger-OTA unmittelbar vor dem Upload erneut geprüft.

Nach Veröffentlichung wurden der tatsächlich über den Preview-Kanal gelieferte Bundle-Hash `d0ee60c5f53fa5c15bd69ece66639f0c95b945f1fadf243b70bd7736faf06e34` und alle 34 Assets per Download gegen den lokalen Export geprüft. EAS bestätigt die neue Gruppe und passende Runtime. Der Nachweis liegt unter `artifacts/tarif-integration/ota/delivery-proof.json`, der vollständige Veröffentlichungskandidat unter `../tarif-preview-ota/artifacts/tarif-ota/`.

Die iPhone-Abnahme dieser Erweiterung bleibt offen. Es erfolgten kein Commit, Push, nativer Build oder Production-/TestFlight-Update.
