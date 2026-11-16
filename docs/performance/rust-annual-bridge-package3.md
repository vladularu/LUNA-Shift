# Paket 3: Rust-Daten für die bestehende Jahresansicht

Referenz: bestätigte iPhone-Preview-OTA `01a1e16c-31c1-70f1-9f0a-03f11f14be73` (Netto-Paket 2). Ziel: vorhandener Preview-Build 54, Expo SDK 57; native Runtime `642bfaefe006b4d4d3114c76973debf29b16036d`.

## Umfang und interne Schritte

1. Datenbrücke: dieselbe serialisierte native Warteschlange für Monats-, Netto- und Jahresaufträge. Jahresstunden, Soll/Ist, Gehalt, Zuschläge und Prüfungen aus den vorhandenen Rust-Domänensektionen. Die vorhandene native Prüflane wird zusätzlich abgefragt; Finanzaufträge berechnen absichtlich keine Prüfungen.
2. Bestehende Daten-Hooks: Jahresübersicht und Jahresdetails nutzen weiterhin ihre ursprünglichen Report-Formate, Warteschlange, Hintergrundvorbereitung, Fehler-/Wiederholungsbehandlung und gespeicherten Ergebnisse. Jahresnetto und Sonderzahlungsprognose kommen aus Rust. Der einzige zusätzlich entnommene Wert neben `sections` ist das bereits in Build 54 vorhandene mathematische Forecast-DTO (`payments`, `proposal`, `automatic`, `issue`). Dessen Transportposition unter `views.gross.value.annualPaymentsState` wird nicht an die App weitergereicht. Native Anzeigeobjekte, UI-Zustände, Layout-Daten und vorformatierte Ansichten werden nicht übernommen. Der vorhandene TS-Helfer ergänzt die bestätigte Sonderzahlung unverändert im bisherigen Anzeige-Report; Steuer-, Gehalts- und Prognoseberechnung laufen in Rust.
3. Prüfungen: echte Rust-WASM-/SQLite-Vergleiche mit dem bisherigen TS-Rechenweg, Cache-/Hook-Regressionen, exakter Dateiscope, Projektprüfung und iOS-Export. OTA bleibt ein gesondert freizugebender Schritt.

## Unverändert

UI/JSX, Texte, Formulare, Navigation, Kalender, Cloud und SQLite-Schema. Alle nativen Dateien, Root-Konfigurationen, Abhängigkeiten und die akzeptierte TestFlight-Baseline bleiben bytegleich zum bestätigten Paket 2. Kein neuer nativer Build, kein Git-Commit/Push und keine TestFlight-Veröffentlichung.

Der Scope-Prüfer erlaubt ausschließlich die Jahres-Datenadapter, ihre bestehenden Hooks, die gemeinsam genutzte TS-Transportdatei und deren Lane-Zuordnung, eng begrenzte Ergebnisvalidierung sowie Test-/Dokumentationsdateien, den generierten Cache-Vertrag und exakte Source-Review-Hashes. Die früheren Paketprüfer werden nicht umgeschrieben.

## Cache und fachliche Abnahme

Engine-Version und Jahres-Eingaben bilden den vorhandenen Cache-Schlüssel. Bereits berechnete Jahre werden aus dem bestehenden Cache wiederverwendet, auch nach Neustart. Alte Zwischenergebnisse der TS-Monatsrechnung werden im nativen Jahrespfad nicht zusätzlich geladen. Dienständerungen bilden einen neuen Schlüssel; veraltete Antworten werden nicht eingeblendet. Unveränderte Nachbarjahre bleiben erhalten. Nach dem OTA-Wechsel kann der geänderte Berechnungsvertrag einmalig eine neue Vorbereitung benötigen.

Die Referenzprüfung verwendet dasselbe `calculationProfile` wie die aktuelle App. Ein nacktes gespeichertes Altprofil ist keine gleichwertige Referenz für Sollstunden: Die laufende App ergänzt es bereits vor dem Jahresaufruf um die Arbeitszeitgrundlage. Diese bestehende Profilaufbereitung bleibt unverändert.

Die einfache Jahresansicht fordert wie bisher keine separate Ausbildungs-Überlagerung an. Deren zwei Rohdatengruppen werden für diesen Jahresauftrag nicht angefordert; der bisherige Jugendschutz-Schalter bleibt erhalten. Ein echter SQLite-/Rust-Test stellt sicher, dass fehlerhafte Daten einer solchen separaten Prüfart die Jahresansicht weiterhin nicht blockieren.

Nach einer freigegebenen Preview-OTA auf dem iPhone prüfen: bekanntes Jahr und Nachbarjahr vollständig öffnen, zurückwischen, App neu starten, anschließend nur eine Dienst-Endzeit ändern und zurücknehmen. Werte, Details, Wischen und Navigation müssen wie gewohnt funktionieren. PC-Vergleiche und Exporte ersetzen diese Geräteabnahme nicht.

Nicht enthalten: eigenständiger Report-Export, weitere Monats-Vorbereitungsschritte, Formulare oder ein allgemeiner Umbau der App. Dieses Paket behauptet keinen vollständigen Port aller verbliebenen TS-Aufrufstellen.
