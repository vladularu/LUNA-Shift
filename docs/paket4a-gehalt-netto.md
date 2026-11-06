# Paket 4A – Monatliche Gehalts- und Netto-Detailseiten

Ziel: Gehalt zeigt Gehaltsbestandteile und Gesamtbrutto. Netto-Prognose zeigt Netto-Ergebnis, Abzüge, Schätzstatus und Netto-Einstellungen. Beide Seiten beziehen sich auf denselben ausgewählten Monat und verwenden unveränderte Berechnungen und gespeicherte Angaben. Bestehende Netto-Deep-Links funktionieren weiterhin. Ein klarer Link verbindet die Seiten, bis die eigenständige Übersichtskarte in 4B folgt.

Nicht-Ziele: neue Steuer-/Tarifformeln, Datenmigration, Premium-Sperren, Jahresansichten, neue Exportinhalte, neue native Runtime und globale Designänderungen. Brutto-relevante Zusatzangaben bleiben zugänglich; ihre gemeinsame Speicherung wird noch nicht migriert. Die vorhandene Monatsberichtsfunktion bleibt erhalten.

Plattform: bestehende iPhone-Preview-App Build 49, Kanal/Environment preview, APP_VARIANT=internal. Luftig bleibt erhalten. SDK laut package.json ~57.0.31; passende Expo-Router-Dokumentation https://docs.expo.dev/versions/v57.0.0/sdk/router/.

Vorgesehener Scope: salary-payroll-content.tsx, salary-screen.tsx, net-pay-automatic-screen.tsx, net-pay-screen.tsx, net-pay-settings-screen.tsx, navigation/routes.ts, app/_layout.tsx; vorhandene Salary-Presentation-, Net-Pay-Screen-, automatische Netto-, Analysis-Coverage- und Routentests; Quellenfreigabe und Dokumentation. Maximal 14 Dateien. Bei Erweiterung über 15 Dateien erneut teilen.

Abnahme: identische Brutto-/Netto-Beträge vor und nach der Trennung; kein Netto-Ergebnis oder Steuerabzug in der Gehaltsdarstellung; keine Gehalts-Zusammensetzung in der Netto-Darstellung; fehlende Netto-Einrichtung blockiert Gehalt nicht; technische Fehler in gemeinsamen Zusatzangaben werden kenntlich. Tarif, manuelles Brutto, Zusatzbezüge, Sonderzahlung, Zusatzversorgung, Testmonate, fehlende Daten und Jahreswechsel prüfen. Navigation, Monatserhaltung und Rückkehr nach Einstellungen funktionieren. Export bleibt unten und Luftig in Hell/Dunkel erhalten.

Freigabe: Nutzer hat die Umsetzung von Paket 4 mit eigener Preview-OTA autorisiert. 4A ist das bereits geplante erste Teilpaket. Commit und GitHub-Übernahme für 4A erst nach ausdrücklicher Geräteabnahme. 4B ergänzt anschließend die unabhängige Netto-Karte und kompatible Kartenordnung.

## Umsetzung und eigene Preview-OTA

Git-Basis: Paket 3 wurde nach Abnahme und grüner PR-CI über PR #363 als ad83157870409904815cf379a68601bf414a80d8 übernommen. Der akzeptierte Luftig-Quellstand a52f9f5915b4d2dd73f64bf4adf0fd8f4e5009ae ist separat gesichert. 4A bleibt bis zur iPhone-Abnahme uncommitted.

Gehalt zeigt Gesamtbrutto, Zusammensetzung, Zulagenprüfung und Auszahlungstermin. Die Netto-Prognose zeigt Netto-Ergebnis, Bruttobezug, Abzüge, Schätzstatus und Netto-Einstellungen. Die Seiten wechseln mit demselben Monat; Monatsnavigation, bestehende Deep-Links und der Berichtsexport bleiben erhalten. Beim Öffnen von Netto-Einstellungen ohne Navigationshistorie führt Speichern zurück zur Netto-Prognose dieses Monats.

Die bisherige Bearbeitung der Jahressonderzahlung bleibt in der Netto-Prognose erreichbar, da sie neben dem Brutto auch die Netto-Berechnungsgrundlage verwaltet. Weitere feste Bezüge bleiben im vorhandenen Einstellungsformular gespeichert und bearbeitbar. Keine Datenmigration, keine Tarif-/Steuerformeländerung und keine Premium-Sperre. Die eigene Netto-Karte in der Auswertung folgt in 4B.

Beide verify:fast-Läufe sind erfolgreich: jeweils 10.405 allgemeine Tests und 1.854 Komponentenfälle in 196 Gruppen, dazu die verpflichtenden Release-/Regelkatalog-/Widget-/Sicherheitstests. Die fokussierte Prüfung der vier betroffenen Komponentensuiten bestand zunächst mit 155 Fällen; zwei zusätzliche Fälle zu fehlender Netto-Einrichtung und nicht geladenen Zusatzbezügen sind in beiden vollständigen Läufen enthalten. Unveränderte act-Warnungen des Kalender-Pager-Tests sind keine fehlgeschlagenen Assertions.

- Preview-Gruppe: eaa90620-31f2-42ff-95ec-4286cd9423ae
- Update-ID: 01a1aee3-8c45-71cb-8b69-be075aab8a63
- Runtime: 402e757d98ca799660ce5dd15a24bd999cf690eb (bestehende iPhone Preview-App Build 49)
- Preview-Quellfingerprint: 025c361bb3506555dad5f3694e1a5a6859afa0b4afd8663ad4f42d1e056d4a73
- Bundle-SHA256: 73213ce21d24cba2377f24350afa8319784333cbde23fa93701de4762e8e050b
- Bundle und 34 Assets vom Server gegen den finalen Export bytegenau verifiziert.
- Alle 34 Asset-Dateien entsprechen dem abgenommenen Paket 3. Luftig bleibt unverändert.

Geräteabnahme ausstehend: beide Monatsseiten in Hell/Dunkel öffnen; gleiche Beträge, Monatwechsel, Abzüge und Rückkehr nach Netto-Einstellungen prüfen. Jahressonderzahlung und verzögerte Zulagen im bekannten Referenzmonat vergleichen. Der Export bleibt unten erreichbar. Keine Production-/TestFlight-Veröffentlichung.

Nachweise außerhalb der Worktrees: paket4a-checks.json, paket4a-source-evidence.json, paket4a-preview-source-evidence.json, paket4a-preview-delivery-proof.json, paket4a-preview-source-archive.json und paket4a-preview-candidate-source.tar.gz. Export: paket4a-preview-export.

# Paket 4 – Ergänzung 4B: zwei eigenständige Auswertungskarten

Korrektur des Nutzers: Die 4A-OTA ist nicht abgenommen. Gewünscht sind zwei eigenständige Einheiten direkt in der Auswertung, Gehalt und Netto. 4B ergänzt jetzt die zuvor getrennten Monatsdetailseiten; die Abnahme betrifft anschließend das vollständige Paket 4.

Ziel: separate Gehaltskarte ohne Nettozeile und eigene Nettokarte mit eigener Detailnavigation. Beide unabhängig sichtbar, ausgeblendet und verschiebbar. Bestehende vier-/fünfteilige Kartenlayouts werden kompatibel gelesen: Netto hinter Gehalt; bei bisher ausgeblendetem Gehalt auch Netto ausblenden. Neu gespeicherte Sichtbarkeiten bleiben unabhängig. Vorbereitete Monatsdaten weiterverwenden, keine zweite Berechnung allein durch eine zusätzliche Karte.

Nicht-Ziele: neue Steuer-/Tariflogik, Premium-Sperre, geänderte Exporte oder native Runtime. Jahres-Netto bleibt im bereits vorgesehenen Jahrespaket. Die vorhandenen globalen Einstellungen gelten weiter für Monat/Jahr, die neue Netto-Karte wird zunächst in der Monatsauswertung dargestellt.

Scope dieser Ergänzung: analysis-view.ts; dashboard-cards.tsx; month-overview.tsx; analysis-view-controls.tsx; analysis-net-pay-row.tsx (erste Zeile ohne übernommene innere Trennlinie); salary-screen.tsx (temporäre Querverweise entfernen); bestehende Domain-, Preference-, Loading-, Salary-Payment-Summary- und Netto-Workflow-Tests; Backup-Restore-Regression; Quellenfreigabe und Paketdokumentation. 14 Dateien in dieser Ergänzung; 4A bleibt als vorheriges separates Arbeitspaket nachvollziehbar.

Plattform: iPhone Preview Build 49, SDK ~57.0.31, Expo-Dokumentation v57.0.0, eigene Preview-OTA, Luftig erhalten. Keine Production-/TestFlight-Freigabe. Paket 4 weiterhin ohne Commit bis zur ausdrücklich bestätigten iPhone-Abnahme.

Abnahme: beide Karten unmittelbar sichtbar; Gehalt öffnet Gehalt, Netto öffnet Netto desselben Monats. Keine Nettozeile in Gehalt. Ausblenden, Einblenden, Sortieren und Neustart erhalten getrennte Einstellungen. Beträge und Hinweise (nicht eingerichtet, Testmonat, fehlerhafte/vorläufige Prognose, Sonderzahlung) unverändert. Pflichtprüfung verify:fast auf Funktions- und Luftig-Stand sowie Quellen-, Runtime-, Export- und Live-OTA-Abgleich.

## Aktueller Stand: zwei eigenständige Karten, erneute Preview-Abnahme

Der Nutzer hat die reine Detailseitentrennung der 4A-OTA ausdrücklich nicht abgenommen. Diese neue OTA ergänzt die entscheidende Trennung direkt in der Monatsauswertung: Gehalt und Netto sind eigenständige Karten mit eigener Sichtbarkeit, Reihenfolge und Detailnavigation. Gehalt enthält keine Nettozeile mehr. Die provisorischen Querverweise zwischen den beiden Detailseiten sind entfernt.

Netto verwendet die vorhandene vorbereitete Prognose. Berechnungsformeln, Beträge und gespeicherte Gehalts-/Steuerdaten bleiben unverändert. Gespeicherte vier- und fünfteilige Kartenlayouts erhalten Netto direkt nach Gehalt; nur bei dieser Übernahme erbt Netto ein bisher ausgeblendetes Gehalt. Danach lassen sich beide Karten unabhängig verwalten. Ungültige Kartenlisten bleiben ungültig; die Backup-Wiederherstellung wird mitgeprüft. Die Jahres-Netto-Trennung bleibt im vorgesehenen Jahrespaket.

Die Änderung ist als Ergänzung 4B mit 15 betroffenen Dateien separat eingegrenzt; die nicht abgenommene Detailseitenarbeit 4A bleibt Teil desselben offenen Pakets 4. Beide vollständigen verify:fast-Läufe bestehen mit 10.413 allgemeinen Tests sowie 1.855 Komponentenfällen in 196 Gruppen und allen weiteren Pflichtprüfungen. Fokussiert sind 35 Domain-/Backup-Fälle und 102 Komponentenfälle geprüft. Ein zunächst nicht vorhandenes Icon wurde vor Export durch das vorhandene Rechner-Icon ersetzt; eine Typangabe im neuen Test wurde vor den finalen Prüfläufen korrigiert.

- Neue Preview-Gruppe: 023da9fd-d6a7-4fda-86f2-ec007ce246db
- Neue Update-ID: 01a1af13-0738-7d23-9f40-5925cf668f42
- Runtime: 402e757d98ca799660ce5dd15a24bd999cf690eb (iPhone Preview Build 49)
- Preview-Quellfingerprint: 580670e380e876feacea2ee7359d36ad65b2087593d9c3619807694e1fce9fee
- Bundle-SHA256: 34a2f1441b72c4856cf110ae23c8ea5b41f48121a3543047f979abb8baa108ec
- Bundle und 34 Assets vom Server bytegenau gegen den geprüften Export verifiziert.
- Luftig und die 34 bisherigen Assets bleiben erhalten. Git-Basis unverändert: ad83157870409904815cf379a68601bf414a80d8.

Geräteabnahme offen: zwei Karten direkt in der Monatsauswertung; Gehalt öffnet Gehalt und Netto öffnet Netto im gewählten Monat; unabhängig ein-/ausblenden, sortieren und App neu öffnen. Beträge sowie fehlende Einrichtung, Testmonat und Sonderzahlungsstatus vergleichen. Hell/Dunkel prüfen. Kein Paket-4-Commit vor ausdrücklicher Abnahme; keine Production-/TestFlight-Veröffentlichung.

Nachweise: paket4b-checks.json, paket4b-source-evidence.json, paket4b-preview-source-evidence.json, paket4b-preview-delivery-proof.json, paket4b-preview-source-archive.json und paket4b-preview-candidate-source.tar.gz. Export: paket4b-preview-export-final.

## Jahres-Netto ergänzt – Paket 4C

Der Nutzer bestätigt die getrennten Monatskarten und meldet die noch fehlende Netto-Karte der Jahresauswertung. Diese Ergänzung zieht die Jahres-Netto-Trennung in das offene Paket 4 vor. Die vorherige Aussage, dies bleibe im späteren Jahrespaket, ist damit überholt.

Die Jahresauswertung enthält jetzt eigene Gehalts- und Nettokarten mit unabhängiger Sichtbarkeit und Reihenfolge. Netto öffnet eine eigene Jahresdetailseite mit zwölf Monatszeilen; jede führt zur bestehenden Netto-Ansicht des ausgewählten Monats. Die jährliche Summe wird aus der unveränderten monatlichen Auszahlungsprognose gebildet. Fehlende/gesperrte Monate werden nicht zu Null umgedeutet. Teilsumme, Monatsanzahl und Hinweise zu vorläufiger Berechnung, Zusatzversorgung, Jahreswechsel und Sonderzahlung bleiben sichtbar. Die Netto-Einstellungen werden nach ihrem Gültigkeitsmonat aufgelöst. Keine Steuerformel, kein Tarif und kein gespeicherter Gehaltswert geändert.

Die Berechnung nutzt die vorhandene kooperative Aufgabenwarteschlange außerhalb des Renderns. Vollständige Eingabeinhalte und Resolver-Identität bestimmen die Gültigkeit; bei Jahres-/Datenwechsel oder Fokusverlust wird abgebrochen und verspätete Ergebnisse werden ignoriert. Bestehende Monats-Caches bleiben nutzbar. Kein neues persistentes Cache-Format und keine native Änderung.

Separater Scope laut paket4c-contract.md: Berechnungs- und Darstellungsanteil, zusammen 14 Implementierungs-/Testdateien plus Quellenfreigabe und Dokumentation. Beide verify:fast-Läufe erfolgreich: 10.419 allgemeine Tests und 1.862 Komponentenfälle in 197 Gruppen, außerdem alle übrigen Pflichtprüfungen. Gezielt: 23 Unit-/Routenfälle und 86 Komponentenfälle. Geräteprüfung offen. Vor den finalen Läufen wurden zwei Import-Reihenfolgen im Test und die isolierte Testumgebung der Prüfungseinstellungen korrigiert. Vier unveränderte Unit-Tests überschritten bei gleichzeitig laufenden allgemeinen Tests ihre Zeitlimits; die Wiederholung mit unveränderten Tests und Zeitlimits bestand. Frühere Fehlerprotokolle bleiben zur Nachvollziehbarkeit erhalten.

- Preview-Gruppe: 5828acb5-299f-48f7-aa15-f491f482de32
- Update-ID: 01a1af45-53ac-7f40-814d-a563c5d76a23
- Runtime: 402e757d98ca799660ce5dd15a24bd999cf690eb
- Preview-Quellfingerprint: 66a81fcec98cd7076cadc9805579ddbc3ea7d48a4c1cced4049661e0b4797645
- Bundle-SHA256: 2776e9eb43a57a899508e334bda4e51806bc75591a442e1947d1fbb4e45f1914
- Bundle und 34 Assets bytegenau vom Server verifiziert.
- Luftig erhalten. Keine Production-/TestFlight-Veröffentlichung. Paket 4 weiterhin ohne Commit bis zur ausdrücklichen Abnahme.

Abnahme am iPhone: Jahresauswertung öffnen, Gehalt und Netto als getrennte Karten prüfen, Netto öffnen und Januar/Dezember auswählen; Jahr wechseln; Monatsanzahl und vorhandene Monatswerte vergleichen; Sichtbarkeit/Reihenfolge und Hell/Dunkel prüfen. Nachweise: paket4c-checks.json, paket4c-source-evidence.json, paket4c-preview-source-evidence.json, paket4c-preview-delivery-proof.json, paket4c-preview-source-archive.json und paket4c-preview-candidate-source.tar.gz.

## Geräteabnahme vom 6. November 2026

Der Nutzer hat die finale Preview mit „ja das passt“ abgenommen, nachdem die separate Netto-Karte auch in der Jahresauswertung ergänzt wurde. Damit ist Paket 4 einschließlich Monats-/Jahreskarten und getrennter Detailseiten abgenommen. Die vorstehenden offenen Abnahmestände sind historische Zwischenstände.

Abgenommene Preview-Gruppe: 5828acb5-299f-48f7-aa15-f491f482de32; Update-ID: 01a1af45-53ac-7f40-814d-a563c5d76a23; iPhone Preview-App Build 49, Luftig. Das ausgelieferte Bundle und alle 34 Assets sind bytegenau verifiziert. Die vollständigen verify:fast-Läufe auf Funktions- und Preview-Stand bestanden mit jeweils 10.419 allgemeinen Tests und 1.862 Komponentenfällen. Der abschließende Quellenabgleich bestätigt unveränderte App-Dateien gegenüber diesen geprüften Ständen; zusätzlich sind alle 2.417 Dateien des archivierten Preview-Quellstands abgeglichen.

Gemäß dem bestehenden Auftrag wird Paket 4 jetzt separat über Commit, Pull Request und grüne GitHub-CI übernommen. Der Luftig-Stand erhält eine eigene Sicherung auf dem Preview-Branch. Diese Abnahme erteilt keine neue Production-/TestFlight-Veröffentlichung.
