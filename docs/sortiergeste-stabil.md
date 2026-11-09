# Stabile iPhone-Sortiergeste

## Auftrag und Abgrenzung

Der Nutzer meldet, dass Ziehen in Auswertung und Dienstvorlagen nicht mehr funktioniert: Die Ansicht öffnet sich, die Zeile wird nach längerem Halten für etwa eine halbe Sekunde angehoben und fällt dann zurück. Ziel ist eine eng begrenzte lokale Korrektur des gemeinsamen Übergangs zum Ziehen. Die bestehende LUNA-Darstellung bleibt erhalten. iPhone und Preview-Build 49 sind das Zielgerät; die abschließende Geräteprüfung steht aus.

Erlaubter Dateiscope: src/ui/reorderable-list.tsx, der bestehende reorderable-list.component.test.tsx, die bestehenden analysis-view-preferences.component.test.tsx und templates-manager-screen.component.test.tsx, dieses Dokument und der exakt zugehörige Kandidatenpfad in releases/testflight/build-9.reviewed-changes.json. Die beiden zusätzlichen Tests vergleichen weiterhin sämtliche visuellen Kartenwerte und erwarten lediglich das bewusst stabile overflow visible der Sortierkarte. Keine Änderung an Speicherung, Listenreihenfolge, Dienstdaten, Gestenerkennungsdauer, Scrollverhalten, globalem SurfaceCard, nativer Konfiguration oder Abhängigkeiten. Commit, Push, native Builds und eine neue OTA sind mit dieser Fehlermeldung nicht gesondert freigegeben.

Ausgangspunkt ist die veröffentlichte Preview-Gruppe dc819c43-e346-4f01-af49-2dfdcd479a63 mit Source-Digest fad8401ac537df31ba5a430d18860c2c63139516652f5eff02cf9b60232996c2. Die letzte OTA änderte die Sortierkomponenten und ihre beiden Aufrufer nicht. Die frühere Anpassung 7025cc8 vom 7. November führte die gemeinsame SurfaceCard mit Schatten und bedingt gewechseltem overflow ein. Vor Änderungen werden der vollständige Quellstand und alle vorhandenen Änderungen unter artifacts/sortiergeste-stabil/ gesichert. Arbeitsbranch: codex/sortiergeste-stabil.

Expo ~57.0.31, React Native 0.86.3 und Gesture Handler 2.32.0 wurden lokal geprüft; die passenden offiziellen SDK-57- und Gesture-Handler-2.x-Dokumentationen wurden gelesen.

## Technischer Befund

Beim Start der Haltegeste schaltet die Kartenhülle von overflow hidden auf visible. SurfaceCard liefert einen boxShadow. Im installierten React Native berechnet RCTViewComponentView.mm in styleWouldClipOverflowInk (894–900) und finalizeUpdates (675–684) dadurch einen anderen nativen Containermodus. currentContainerView (954–985) verschiebt enthaltene Views beim Wechsel zwischen den Containern. Dieser native Umbau während einer laufenden Geste passt zum beschriebenen Abbruch. Er ist als konkrete Ursachenhypothese belegt; ein reproduzierter UIKit-Abbruch auf dem iPhone liegt noch nicht vor.

Die Kartenhülle soll vom ruhenden Zustand bis zum Ablegen offen und stabil bleiben. Bestehende Kartenfarben, Rundungen, Rahmen und Schatten bleiben erhalten. Bereits angelegte Verschiebepositionen und die vorhandenen Speicher- und Abbruchpfade werden unverändert wiederverwendet.

## Abnahmekriterien

- Kein Wechsel der Clipping-/Schatten-Konfiguration der Elternkarte beim Anheben, Ziehen oder Ablegen.
- Einfache und tatsächlich verwendete benutzerdefinierte Zeileninhalte bleiben verschiebbar; Speichern erfolgt erst beim Ablegen.
- Bestehende Tests für Folgeverschiebungen, Abbruch, Fehler, VoiceOver und Randschrollen bleiben grün.
- Neue Regression zunächst RED, dann GREEN; npm.cmd run verify:fast, lokaler iOS-Export und exakter Quellvergleich.
- Geräteabnahme für Halten, mehrmaliges Ziehen und gespeicherte Reihenfolge in beiden Ansichten nach einer gesondert freigegebenen Preview-Veröffentlichung.

## Lokales Ergebnis

Die gemeinsame Sortierkarte verwendet nun vom ruhenden Zustand bis nach dem Ablegen unverändert overflow visible. Die einzige Produktänderung ist dieser Wert samt erklärendem Kommentar. Der neue Test weist den bisherigen Wechsel hidden → visible für normale und benutzerdefinierte Zeilen nach (zunächst zwei erwartete Fehler bei 17 bestehenden grünen Fällen). Nach der Korrektur bestehen alle 35 gezielten Sortier- und Ansichtsprüfungen. Die beiden visuellen Tests vergleichen weiterhin sämtliche ursprünglichen Kartenwerte und berücksichtigen nur die funktional notwendige offene Sortierhülle. Ein inverser Vergleich bestätigt, dass keine bestehenden Testfälle oder übrigen Assertions verändert wurden.

Die vollständige Prüfung npm.cmd run verify:fast ist erfolgreich: 10.782 Vitest-Tests in 564 Dateien, 2.022 Jest-Tests in 210 Suites sowie die weiteren Sicherheits- und Infrastrukturprüfungen sind grün. Der lokale iOS-Export ist erfolgreich. Der Quellenschutz begrenzt die Laufzeitänderung auf src/ui/reorderable-list.tsx und bewahrt 118 vorherige unabhängige Dateien, die abgenommene TestFlight-Baseline und das veröffentlichte Vorgängerarchiv. Source-Digest: e0b8f1f37cca08bfe8efdb645568c8cbd544c3fb091a2cabe02ae894d6d689c3.

Nachweise: artifacts/sortiergeste-stabil/result.json und die dort referenzierten Protokolle. Die Korrektur ist lokal geprüft; der tatsächliche Gestenablauf auf dem iPhone ist noch nicht bestätigt. Es wurden weder eine neue OTA noch Commit, Push oder ein nativer Build ausgeführt.

## Anschließende Veröffentlichungsfreigabe

Am 9. November 2026 hat der Nutzer die konkret geprüfte Sortierkorrektur mit „ja“ als iOS-Preview-OTA freigegeben. Die Veröffentlichung erfolgt ausschließlich für preview / ios / preview mit APP_VARIANT=internal nach frischem Vorgänger-, Kanal-, Quell- und Runtime-Abgleich. Ihr gesonderter technischer Nachweis wird unter artifacts/sortiergeste-stabil-ota/release-result.json geführt. Eine neue Git- oder native Build-Freigabe wurde damit nicht erteilt; die iPhone-Bestätigung bleibt offen.

## Isolierter master-Abgleich am 09.11.2026

Die veröffentlichte Sortierkorrektur wurde mit „passt“ für Auswertung und Schichten auf dem iPhone bestätigt. Der Nutzer hat anschließend die isolierte Zusammenführung mit master und lokale Tests beauftragt; die funktionierende Preview bleibt unverändert. Referenz: Preview Build 49, Gruppe 901771fe-0888-4ab2-90f2-d12b9ec094ed.

Auf codex/dienstplan-check-master-abgleich bleibt die vorhandene cardStyle-Schnittstelle einschließlich der vom Rahmen abhängigen Höhe von master erhalten. Die Korrektur hält ausschließlich overflow während Anheben, Ziehen und Ablegen sichtbar. Die Regressionen prüfen regulären und eigenen Zeileninhalt jeweils mit Standardrahmen und einem eigenen schmalen Rahmen. Die bestehenden Abnahme-, Höhen-, Speicher-, Abbruch- und VoiceOver-Prüfungen bleiben erhalten. Lokale Nachweise: artifacts/dienstplan-integration/. Keine Git-Auslieferung, OTA oder native Veröffentlichung im Rahmen dieser Integration.
