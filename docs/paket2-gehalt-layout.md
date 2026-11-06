# Paket 2: Gehaltsabschluss, Export und Detailnavigation

## Ergebnis und Umfang

Der feste leere Streifen am unteren Rand von Gehalt & Netto entfällt: Der untere Systemabstand liegt im scrollbaren Inhalt. Die beschriftete Exportaktion steht am Inhaltsende. Sie folgt der primären Aktion aus Teilen mit invertierenden Hell-/Dunkelfarben, großer Mindesthöhe, Innenabständen und Kontur. Navigierende Karten und Zeilen in Monats-/Jahresauswertung und Jahres-Zeitzuschlägen zeigen Chevron statt eingekreister drei Punkte.

Berechnungen, Exportdaten, Monatszuordnung, gespeicherte Daten, native Integration sowie vorhandene Tab- und Zurück-Leisten bleiben erhalten. Die separate Luftig-Darstellung wird im Preview-Branch bewahrt. Expo bleibt bei ~57.0.31.

## Geräteabnahme

Der Nutzer hat Paket 2 am 6. November 2026 ausdrücklich abgenommen: „Ja jetzt passt es in Hell und Dunkel. Paket 2 ist abgenommen, bitte committen und mit GitHub abgleichen.“ Die Abnahme gilt für den folgenden iOS-Preview-Stand auf Build 49:

- OTA-Gruppe: 9f24beb5-0089-4e24-a4b2-894941bf183b
- Update: 01a1ae3c-3e15-798c-a091-a3ba70e9c682
- Runtime: 402e757d98ca799660ce5dd15a24bd999cf690eb
- Preview-Quellfingerprint: 6a19912059332674dc1cde1a14dd89d58654f942672927114863e320e8bfa92c
- Funktionsbranch-Quellfingerprint: da20bc12aef4b6c17b8472c75a9948597db3c9f57d6ddb5033b6f63c40b09fc2
- Bundle-SHA256: a70ba27d01df33a48eaebf339feb376492c3d2fc57770ada967ff417dbbe16f2

Die erste Paket-2-OTA wurde durch die abgenommene R2-Korrektur ersetzt. Production/TestFlight wurde nicht veröffentlicht.

## Prüfung und Git-Integration

Beide vollständigen verify:fast-Läufe bestehen mit jeweils 10.404 Fachtests und 1.843 Komponentenfällen in 196 Testgruppen sowie allen weiteren Schutzprüfungen. Zusätzlich bestehen 89 fokussierte Export-/Gehaltsfälle. Der erste R2-Preview-Prüflauf meldete eine Markdown-Formatabweichung; nach Korrektur bestand der vollständige Wiederholungslauf.

Das ausgelieferte Bundle und 34 Assets wurden bytegenau gegen den geprüften Export verifiziert. Die aktuelle Preview-Quelle und die archivierten Dateien wurden vor dem Commit erneut abgeglichen. Der Exportbutton erreicht in beiden Farbmodi 16,97:1 Kontrast.

Basis: c915fc2a61e851be345f0db3896ee544ec7ac22b (Paket 1, PR #361). Funktionsbranch: codex/paket2-gehalt-layout. Separater Preview-Sicherungsbranch: codex/paket2-preview-luftig. Git-Integration nach ausdrücklicher Geräteabnahme; Merge erst nach erfolgreicher PR-CI.

Nachweise im chatbezogenen Verzeichnis: paket2-r2-checks.json, paket2-r2-source-evidence.json, paket2-r2-preview-source-evidence.json, paket2-r2-preview-delivery-proof.json, paket2-r2-preview-source-archive.json und das vollständige Quellarchiv. Paket 3 erhält eine eigene Preview-OTA und eine gesonderte Geräteabnahme.
