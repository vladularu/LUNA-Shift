# Monatsauswertung: Ablaufhärtung und leere Monate

Freigabe 28.10.2026: alle fünf Arbeitspakete der Ablaufanalyse und der besprochene Schnellpfad für leere Monate; anschließend ausschließlich iOS-Preview-OTA. Basis ist die akzeptierte Preview `3253abe1-d309-4136-b3df-afdce1f4b718`. Expo SDK 57 (`~57.0.31`), React Native 0.86, iPhone 14 Pro Max; bestehender Performance-Branch und bisherige Arbeit bleiben erhalten. Kein nativer Build oder TestFlight. Git-Delivery ist für diese OTA nicht erforderlich.

Ziel: Fehler dürfen keinen dauerhaften Ladezustand erzeugen; die Queue berücksichtigt echte freie Zeit und Prioritätswechsel; unveränderte laufende Arbeit bleibt erhalten; Monats-/Bruttowerte und Prüfungen warten nicht auf Netto-Daten; alte Schreibaufträge verdrängen keine neueren gespeicherten Ergebnisse. Leere Monate erhalten eine klare Anzeige und überspringen ausschließlich nachweislich unnötige Arbeit. Grundgehalt, feste Bestandteile, Sonderzahlungen, Sollzeit, Basis-Netto und Einflüsse anderer Monate bleiben korrekt.

Nicht-Ziele: Tarif-/Steuer-/Prüfregeln ändern, gesetzliche oder tarifliche Bewertungsfenster verkürzen, alte Ergebnisse als neue anzeigen, natives Wischen ändern, Netz-/Cloud-Dienste oder neue native Threads einführen. Die konservative OTA-/Katalogversionierung bleibt erhalten, bis ein gleichwertig automatisch geprüfter Ersatz besteht.

Arbeitspakete wegen mehr als 15 erwarteten Dateien: A) Fehler-/Cache-Härtung samt Regressionen; B) Queue, geteilte Aufträge, Wiederverwendung und unabhängige Stufen samt Ablaufregressionen; C) sichere Leerzustände, kleinere Rechenschritte und Messung; D) vollständige Prüfung und Preview-Verteilung. Scope: Analyse-Module/-Hooks/-Karten, Queue und deren Idle-Aufruf, Ergebnis-Repository und Netto-Input-Store, tatsächlich belegte Generator-Engpässe, fokussierte Tests und Benchmark-/Prüfdokumentation. Keine unabhängigen Änderungen im Hauptcheckout.

Abnahme: komplette Berechnungsergebnisse identisch zur Basis, einschließlich leerer Monate, Jugendprüfung, Monats-/Jahresgrenzen, Nachtdiensten, Ausgleichsfenstern, Sonderzahlungen und Beschäftigungsänderungen. Gleichbleibende Schlüssel behalten ihren Generator und Teilfortschritt; geänderte Schlüssel werden ersetzt. Langsame oder fehlerhafte Netto-Eingaben blockieren keine unabhängigen Stufen. Frische Generationen gewinnen gegenüber alten SQL-/Hash-Antworten; Wiederherstellung und Datenbankwechsel bleiben isoliert. „Keine Dienste eingetragen“ ist kein positives Prüfsiegel. Bei späteren Einträgen startet die vollständige betroffene Auswertung automatisch.

Messvertrag: gehashte Kopie aller bisherigen Quellen, gleiche Eingaben und komplette Ergebnis-Hashes. Ausgangsmessung und bestätigter Gewinner für TV-L/TV-UK/VKA mit 11.008 Einträgen; zusätzliche leere und nur im Zielmonat leere Fälle. Höchstens zwei Planungs-/Batch-Varianten pro gemessenem Engpass. Metriken: Öffnen bis bereit, gesamte Vorbereitung, größte Callback-/Generator-Spitze, erzeugte Aufträge bei unveränderten und geänderten Eingaben. Native Frames, React, SQLCipher und Geräteabnahme werden getrennt ausgewiesen. `verify:fast` sowie alle Tarif-/Holdout-Vergleiche vor der OTA. Quellen einfrieren; Manifest-/CDN-Bundle und unveränderte Produktion nach der Veröffentlichung prüfen.

Referenzen: [Expo SQLite SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/), [React Native 0.86 requestIdleCallback](https://reactnative.dev/docs/0.86/global-requestIdleCallback).

## Umsetzung

Der Netto-Input-Store fängt jetzt auch Fehler der erfolgreichen SQL-Antwortverarbeitung ab. Ein Widerspruch bei Sonderzahlungen endet im Fehlerzustand und erlaubt einen erneuten Versuch; alte Generationen verändern weder neue Daten noch ein neueres laufendes Promise. Die vorhandene Regel gegen automatisches endloses Wiederholen bleibt bestehen.

Gemeinsame Aufträge beanspruchen vor Cache-Lesen und Berechnung eine Schreibgeneration. Der Cache prüft diese nach asynchronem Hashing, das Repository nochmals innerhalb seiner SQL-Transaktion. Die Koordination ist pro Datenbank und Monat/Stufe begrenzt und gilt auch zwischen neu erzeugten Cache-Instanzen. Die vorhandene Wiederherstellungs-Epoche bleibt zusätzlich maßgeblich. Ein aus dem Sitzungsspeicher neu übernommener Erfolg kann unter seiner aktuellen Generation gespeichert werden; ein älterer noch laufender Schreibauftrag gewinnt dadurch nicht versehentlich. Unvollständige Ergebnisse erhalten keine erweiterte Speicherberechtigung.

Die Queue reicht das echte Idle-Budget weiter. Reine Vorsorge setzt keinen erzwungenen Idle-Timeout; ohne native Idle-API bleibt ein abbrechbarer 16-ms-Fallback. Nach Prioritätswechsel oder Wegfall eines Verbrauchers wird neu geplant. Der Umfang eines Aufrufs bleibt auf 4 ms beziehungsweise 32 Schritte begrenzt; ein einzelner fachlicher Schritt kann dieses kooperative Budget überschreiten. CPU-Messung umfasst jetzt auch den Abschluss-Callback. Cache-Diagnosen unterscheiden Treffer, fehlenden Scope, fehlende Zeile, Prüfsumme, Form, Timeout, Fehler, verworfenen und abgeschlossenen Schreibauftrag ausschließlich durch neutrale numerische Zustände.

Die Vorbereitung gleicht Monate und Stufen anhand ihrer exakten Schlüssel ab. Unveränderte Aufträge behalten Generator und Teilfortschritt. Neue Schlüssel ersetzen alte Verbraucher, ohne sichtbare Mitverbraucher zu beenden. Ein Eingabenwechsel stoppt nur die noch nicht gestartete Schlüsselvorbereitung; App-Hintergrund, Datenbankwechsel und Unmount beenden weiterhin alle Vorsorge. Monats-/Bruttowerte beginnen bereits bei noch ladenden Netto-Eingaben; die Dienstprüfung wartet nur auf ihre eigenen Voraussetzungen. Neu geladene Netto-Angaben ergänzen die Gehaltsstufe.

Die Sollzeit verwendet denselben Tagesledger und dieselbe Rundung; die asynchrone Analyse kann jetzt zwischen Kalendertagen abgeben. Die synchrone öffentliche Funktion leert denselben Generator weiterhin vollständig. Für die gemessene VKA-Spitze war der erste Profilvergleich nicht ursächlich; diese zusätzliche direkte Zuschlagsvariante wurde verworfen. Entscheidend war die erstmals innerhalb eines großen Monatsabschlusses berechnete Nachtdienstfolge. Ihre bestehenden Zeitumrechnungen werden jetzt in Gruppen von höchstens vier Diensten mit unveränderter DST-Ablehnung vorbereitet. Auch die bestehenden Voraussetzungen und vollständigen Nacht-/Ausgleichsfenster bleiben erhalten. Die vorhandene Intervallvorbereitung der Arbeitszeitprüfung verwendet Gruppen von vier statt acht Einträgen.

## Leere Monate

Ein vollständig leeres geladenes Prüffenster überspringt die nachweislich datenabhängigen Prüfungsstufen. Feiertagskatalog-Abdeckung, Jahresbezüge und dieselbe Ergebniszusammenstellung bleiben erhalten; die Jugendprüfung behält ihren vorhandenen eigenen Ablauf. Ein im Zielmonat leerer Monat mit Diensten im Bewertungsfenster durchläuft weiterhin die vollständigen betroffenen Prüfungen. Ohne zahlungsrelevante Dienste entfällt die unnötige Zuschlagsvorbereitung; erforderliche Bezüge zur Nachtdienstfolge anderer Monate bleiben vorbereitbar.

Die Übersicht zeigt „Keine Dienste eingetragen“, ohne grünes Prüfsiegel oder unnötigen Prüf-Spinner. Vorhandene Meldungen, fehlende Grundlagen und Fehler haben Vorrang. Neue Dienste führen automatisch zurück in den normalen Prüfstatus. Grundgehalt, feste Zulagen, Sonderzahlungen, Sollzeit und Basis-Netto bleiben sichtbar und verwenden die bestehenden datierten Berechnungen und Caches. Netto wird nicht pauschal deaktiviert oder durch den Betrag eines anderen Monats ersetzt. Die konservative Bindung gespeicherter Ergebnisse an OTA und tatsächlichen Kataloginhalt bleibt unverändert.

## Prüfung und Messverfahren

Ausgangsbasis: 117 gehashte Dateien der zuvor veröffentlichten Preview; zusätzlich wurden 1.951 Quell-, Skript- und Dokumentdateien vor Änderungen gesichert. Der endgültige Scope wird vor der Gesamtprüfung gegen diese Kopie geprüft. Die Formeln und Daten für Vergütung, Steuern und Tarife bleiben unverändert. Für den Sollzeitkörper werden alle Anweisungen nach Entfernung der eingefügten Yield-Grenzen per AST identisch verglichen; Rundung und Nachtgrenzen werden separat geprüft. Der gemeinsame Aufbau der Prüfergebnisse entspricht dem früheren Abschlussblock.

Regressionen decken unter anderem widersprüchliche Zahlungen, Wiederholungsversuch, verspätete SQL-Antworten, verspätetes Hashing, Cache-Instanzwechsel, Prüfung innerhalb der SQL-Transaktion, Null-Idle-Budget, Herabstufung, fehlendes Idle-API, unveränderte und geänderte Aufträge, noch ladende Netto-Daten, noch ladende Prüfpräferenzen, App-Hintergrund, neue Dienste, feste Gehaltsbestandteile und DST-Mehrdeutigkeiten ab. Gerätebelege für die neue Darstellung und Wischflüssigkeit stehen nach der OTA aus.

Die ursprünglichen 32 Tarifvergleiche und 20 Holdout-Fälle vergleichen vollständige Übersicht, Prüfung, Gehalt und Netto vor und nach Änderung. `--empty` ergänzt 48 kanonische und 30 Holdout-Fälle mit leerem gesamten Prüffenster, nur leerem Zielmonat oder Nachtdienst über die Monats-/Jahresgrenze. Nach dem Ausgangszustand wird jeweils ein neuer Dienst hinzugefügt. Die Referenzdaten werden nicht verkürzt. Alle vollständigen Ergebnis-Hashes müssen identisch sein.

Alle 130 Vergleiche sind vor der Gesamtprüfung identisch. Die zwei abschließenden Messläufe in frischen Prozessen bestätigen ebenfalls alle vollständigen Ergebnis-Hashes und bei Übernahme laufender Arbeit genau einen Monats-, Gehalts- und Prüfauftrag.

| Tarif | Größter Hintergrund-Callback vorher | Abschließende Läufe | Gesamte Vorsorge vorher | Abschließende Läufe |
| ----- | ----------------------------------: | ------------------: | ----------------------: | ------------------: |
| TV-L  |                             21,3 ms |        23,9–24,3 ms |                  4,39 s |         4,55–4,59 s |
| TV-UK |                             17,0 ms |        16,8–17,0 ms |                  4,49 s |         4,66–4,79 s |
| VKA   |                             62,1 ms |        12,7–13,3 ms |                  5,13 s |         5,72–6,00 s |

Die bereits vorbereiteten Ansichten benötigen im Modell 5,2–6,8 ms zum Übernehmen der Daten. Der wesentliche gemessene Gewinn liegt bei der VKA-Spitze; bei TV-L ist keine Verbesserung der größten Callback-Spitze belegt. Die gesamte Vorsorge dauert durch mehr kooperative Grenzen und modellierte 16-ms-Idle-Abstände etwas länger. Das ist eine bewusste Abwägung zugunsten kleinerer Unterbrechungen und korrekter Priorisierung; es ist keine Zusage kürzerer Gesamtwartezeit bei sofortigem Öffnen. Die Tarif-/Leerfallläufe dienen der Ergebnisgleichheit, nicht einer zusätzlichen Geschwindigkeitsaussage. Echte iPhone-Frames bleiben separat zu prüfen.

Es wurden zwei Queue-/Batch-Varianten geprüft. Variante A (zwei Intervalle und zusätzliche Sollzeit-Vorbereitung im Gehalt) verringerte Teile der Spitzen, verlängerte aber die Vorbereitung; die für das Gehalt unnötige Sollzeit-Vorbereitung wurde entfernt. Variante B verwendet vier Intervalle. Für den anschließend genau eingegrenzten Nachtfolgen-Engpass wurden ein Dienst und vier Dienste je Gruppe verglichen; vier bewahrten die Ergebnisgleichheit bei kürzerer Vorbereitung. Der ausgewählte gesamte Stand wird in frischen Prozessen wiederholt. Node-/Scheduler-Werte sind keine iPhone-Frame-Messung. Weitere Optimierungsvarianten werden in dieser Phase nicht verfolgt.

Reproduktion (PowerShell; `<basis>` ist die gehashte Kopie der bisher veröffentlichten Quellen):

```powershell
node --require tsx/cjs scripts/benchmark-analysis-warmup.cjs --compare <basis>
node --require tsx/cjs scripts/benchmark-all-tariffs.cjs --compare <basis>
node --require tsx/cjs scripts/benchmark-all-tariffs.cjs --compare <basis> --holdout
node --require tsx/cjs scripts/benchmark-all-tariffs.cjs --compare <basis> --empty
node --require tsx/cjs scripts/benchmark-all-tariffs.cjs --compare <basis> --empty --holdout
$env:VITEST_MAX_WORKERS = '2'
npm.cmd run verify:fast
```

Vor der Auslieferung werden alle Quellen gehasht und nach erfolgreicher Gesamtprüfung unverändert gegengeprüft. Ziel: bestehender interner iOS-Preview-Build 44, Kanal/Branch/Umgebung `preview`, `APP_VARIANT=internal`, passender Fingerprint. Nach Veröffentlichung müssen Expo-Manifest und CDN-Bundle dem lokalen Export entsprechen und der Produktionskanal unverändert sein. Die zuletzt akzeptierte Preview ist die Rückfallbasis.
