# Monatswechsel und aktueller Zeitraum

Ziel: In der Auswertung erscheint der vorbereitete Monatsinhalt mit einer horizontalen Bewegung von rechts nach links. Der vorherige Bericht bleibt während des Ladens sichtbar; Überschrift und Werte gehören stets zum selben Monat. Ein Kalender-Tab-Tipp fordert sofort Heute an. Die erneute Auswahl der Auswertung führt je nach erhaltenem Modus zum aktuellen Monat oder aktuellen Jahr.

Zielgerät: iPhone 14 Pro Max, Expo SDK 57, Reanimated 4.5.1. Keine neue native Abhängigkeit.

Arbeitspaket 1: Tab-Ereignisse und getrennte Rücksprung-Anfragen im ActiveMonthCoordinator; der Auswertungs-Kanal liegt separat in src/navigation/analysis-period-navigation.ts. Native und JavaScript-Tab-Leiste sowie deren Tests.

Arbeitspaket 2: Monats- und Jahresmodus in der Auswertung behandeln die Rücksprung-Anfrage getrennt. Monatsmodus verwendet den aktuellen Monat in der Profilzeitzone. Jahresmodus verwendet das aktuelle Jahr und erhält den ausgewählten Monatsanteil sowie den Jahresmodus. Kalender-Heute und Auswertungs-Rücksprung haben getrennte Ereignisse.

Arbeitspaket 3: Den Monatsinhalt bis zur Berechnung weiter anzeigen, fertigen neuen Inhalt horizontal bewegen, schnelle Folgetipps und Fehler korrekt behandeln; bei reduzierter Bewegung ohne Schiebeanimation wechseln. Rechenformeln und Jahresberichte bleiben unverändert.

Dateiscope: src/navigation/active-month.tsx, app-tabs-js.tsx, app-tabs.native.tsx und zugehörige Tests; src/features/analysis/analysis-screen.tsx, neue Monatsübergangs-Komponente/Hook und zugehörige Tests; diese Taskbeschreibung. Bei notwendiger Anpassung des Netto-Unterbereichs wird nur die Weitergabe bereits geladener Monatsdaten geändert.

Nicht-Ziele: Neue Berechnungsregeln, Tarif-/Netto-Änderungen, Änderungen an Freigaben/Widgets, native Navigation oder neue Pakete. Die 21 Dateien der abgenommenen Preview-OTA 7bce34d4 wurden unverändert übernommen; Nachweis in artifacts/inherited-preview-scope.json. Eigene Auswertungsänderungen erfolgen auf codex/analysis-period-navigation, Basis f819dc0.

Abnahme: Ein Kalender-Tab-Tipp aus anderer oder bereits aktiver Registerkarte löst genau eine Heute-Anfrage aus. Ein Auswertungs-Rücksprung beeinflusst die Kalender-Heute-Anfrage nicht. Monats-/Jahresmodus bleiben erhalten und verwenden den aktuellen Zeitraum. Neues Monatsdatum wird nie mit Werten des vorherigen Monats angezeigt. Rasches Weiter-/Zurücktippen, Jahreswechsel, Ladefehler und reduzierte Bewegung sind abgedeckt. Fokussierte Tests und verify:fast; sichtbarer iPhone-Test nach gesonderter Freigabe zur Preview-Veröffentlichung.

Commit, Push, PR, Merge, Build und eine neue OTA sind für diese Korrektur noch nicht freigegeben.

Prüfstand 21.10.2026: verify:fast vollständig erfolgreich, darunter 9.048 Unit-Tests und 1.297 Komponententests. Zusätzlich bestehen die 54 fokussierten Architektur-/Navigationstests einschließlich der fünf automatisch registrierten Card-Routen. Die Komponententests decken unter anderem den aus einer Detailansicht vorgemerkten Rücksprung, das Beibehalten des sichtbaren Monats bis zum Abschluss bzw. Fehler der neuen Berechnung und das Wischen über Monats- und Jahresgrenzen ab. Sichtbare Animation und Bedienung auf dem iPhone sind noch nicht abgenommen.

Nachweise: artifacts/analysis-period-verify-fast.log, artifacts/analysis-period-final-source-check.log und artifacts/analysis-period-scope.json. Der erste Gesten-Sammellauf wurde beim Anlegen von Test-Junctions durch die Windows-Sandbox eingeschränkt; der unveränderte Wiederholungslauf mit den erforderlichen Dateirechten war erfolgreich. Die 21 geerbten Preview-Dateien sind weiterhin bytegleich.

Zusatzwunsch Fingerwisch, präzisiert am 21.10.2026: seitlich öffnende Ansichten allgemein, vorrangig Auswertung. Arbeitspaket 4 ergänzt eine horizontale Ein-Finger-Geste in der Monats- und Jahresübersicht (links nächster Zeitraum, rechts vorheriger Zeitraum). Kleine, überwiegend senkrechte und abgebrochene Gesten lösen keinen Wechsel aus; der Handler ist nur bei Fokus aktiv. Die Pfeile bleiben bedienbar. Der Monatsübergang folgt nun der Blätterrichtung.

Arbeitspaket 5 aktiviert die native Vollflächen-Zurückgeste für die horizontalen Card-Unterseiten des Root-Stacks, darunter Stunden, Gehalt, Prüfung und Jahresdetails. Auch die fünf automatisch registrierten Card-Routen (Prüfprofil, Prüfungseinstellungen, Private Cloud, Widget-Tag und Kalender-Prototyp) sind enthalten. FormSheets, vertikale Editoren, Quick-Add und Tabwechsel behalten ihre bestehenden Gesten. Ergänzter Dateiscope: app/_layout.tsx, src/navigation/horizontal-back-gesture.ts samt Test sowie src/features/analysis/analysis-period-swipe.tsx samt Komponententest. Kein eigenes Vorwärts-History-System, keine Umstellung der nativen Tabs und keine neue native Abhängigkeit. Abnahme zusätzlich: ein Swipe genau ein Zeitraum; Monats-/Jahresmodus getrennt, vertikales Scrollen und Schutz ungespeicherter Eingaben bleiben wirksam. Native Geste, Gesten-Konflikte und Bewegungsqualität müssen auf dem iPhone geprüft werden.

Die Scrollansicht des aktiven Berichts wird über src/ui/period-swipe-scroll.tsx und src/ui/report-layout.tsx mit der horizontalen Geste gekoppelt. So darf der native Scroll-Recognizer gleichzeitig arbeiten. Außerhalb der Zeitraumübersicht bleibt der zusätzliche Handler aus; die übrigen Bericht-Unterseiten verwenden ihre bisherige Scrollansicht.
