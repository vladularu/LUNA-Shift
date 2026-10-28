# Dauerhafte lokale Auswertungsergebnisse

Freigabe: 28.10.2026, „Ist das möglich zu implementieren?“ nach dem Vorschlag einer dauerhaften Ergebnisspeicherung mit Änderungsprüfung. Die bestehende Performance-Arbeit und Preview-Freigabe bleiben erhalten; kein TestFlight, nativer Build oder Git-Delivery. Basis ist Preview-Gruppe `0147c1d9-9c7b-4cf9-84ae-6405a5f2bbde`, Branch `codex/monthly-analysis-performance`, Expo SDK 57 (`~57.0.31`).

Ziel: Fertige erfolgreiche Monats-, Gehalts-/Netto- und Prüfergebnisse auch nach Prozessneustart wiederverwenden, wenn die tatsächlichen Abhängigkeiten unverändert sind. Nicht-Ziele: neue Formeln, Rundungen, Tarifannahmen, neue native Module, UI-/Gestenänderungen, Datensynchronisierung oder ein Cache für unvollständige/fehlgeschlagene Berechnungen.

Plattform: bestehende lokale SQLite-/SQLCipher-Verbindung, iOS-Preview, iPhone 14 Pro Max. Der begrenzte abgeleitete Cache gehört nicht zu Nutzerdaten-Backup oder Cloud-Sync. Er darf jederzeit fehlen. Eine eigene versionierte, bedarfsgesteuert angelegte Cache-Tabelle ändert weder die Nutzerdaten noch deren Schema-/Backup-Version; alte App-Versionen können sie ignorieren.

Pakete wegen des erwarteten Scopes von mehr als 15 Dateien: A) stabiler Katalogfingerabdruck, begrenzte SQLite-Ablage und fehlertoleranter Cache-Dienst; B) Einbindung in die drei bestehenden kooperativen Vorbereitungen mit unveränderten Eingangsschlüsseln und vollständiger Stornierung; C) Neustart-/Änderungs-/Fehlerregressionen, Messung, Gesamtprüfung und kompatible Preview-OTA. Scope: neue Cache-Dateien und Tests, Regelresolver-Metadaten, Analyse-Provider/Hooks, Benchmark und dieses Dokument. Bestehende Engine-Dateien und native Wischsteuerung bleiben unverändert.

Abnahme: identische vollständige Ergebnisse vor/nach Serialisierung; zweiter Prozess liest ohne erneute Fachberechnung; Änderungen einschließlich Dienständerung ohne Revisionswechsel, Bewertungsfenster, Netto-/Jahreszahlungseinstellungen, Profil, Prüfeinstellungen, Tageswechsel, Katalog und Berechnungsversion geben keinen alten Treffer. Unbekannte Resolver sind nicht persistent cachefähig. Fehlende, beschädigte oder langsame Ablage blockiert die App nicht; keine alten Ergebnisse nach Fokus-/Datenbank-/Requestwechsel. Nur erfolgreiche vollständige Ergebnisse werden geschrieben. Cache begrenzt nach Anzahl und Datenmenge; aktueller Monat bevorzugt. Native/visuelle Abnahme erfolgt anschließend auf dem iPhone.

Messvertrag: erster Rechenlauf gegen persistierten Treffer in einem frischen Prozess mit identischen Eingaben und vollständigen Ergebnishashes. Drei Tarif-Fälle, viele Einträge, getrennte Kosten für Schlüsselbildung/SQLite-Lesen und Rechnen. Höchstens zwei Varianten, maximal ein zusätzlicher Nachbesserungsdurchlauf bei messbarem Engpass; keine Änderung an Fachregeln. Synthetische Node-/SQLite-Zeiten sind keine iPhone- oder Frame-Messung. Referenz zur bestehenden nativen API: https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/ und https://docs.expo.dev/versions/v57.0.0/sdk/crypto/.

## Umsetzung und Grenzen

Die bestehenden Inhalts-Schlüssel bleiben erhalten. Damit berücksichtigen Monatswerte ihre Bewertungsfenster, Gehalt/Netto unter anderem Jahreszahlungs- und Netto-Einstellungen sowie die Prüfung ihr Bezugsdatum und die Jugendschutzeinstellung. Hinzu kommen ein SHA-256-Fingerabdruck des vollständigen tatsächlichen Katalogs und die `expo-updates.updateId` des laufenden JavaScript-Updates. Neue Updates werden konservativ neu berechnet. Resolver außerhalb der bestehenden Factory und Umgebungen ohne eindeutige Update-ID benutzen weiterhin die normale Berechnung.

Die Ablage bleibt auf derselben bereits entsperrten SQLite-/SQLCipher-Verbindung. Parametrisierte Abfragen und die bestehende Transaktionswarteschlange schützen Daten und Schreibreihenfolge. Höchstens 72 Ergebniszeilen und 8 MiB Ergebnisdaten bleiben erhalten; ein Eintrag ist auf 1.048.576 Zeichen begrenzt. Der aktuelle Monat wird bevorzugt behalten. Ein winziger zusätzlicher Epocheneintrag sperrt alte Repository-Instanzen nach einer vollständigen Datenwiederherstellung; verspätete Schreibvorgänge können gelöschte Cache-Daten damit nicht zurückbringen. Der bestehende lokale und private Cloud-Wiederherstellungspfad löscht den Cache in derselben Datentransaktion. Sein Nutzdatenformat und seine Fachlogik bleiben unverändert.

Gültige vollständig berechnete Ergebnisse werden erst nach Fertigstellung im Hintergrund gespeichert. Unverfügbare Gehalts-/Regelergebnisse und Gehaltsstände ohne vollständigen Jahreszahlungsvorschlag bleiben wie bisher erneut berechenbar. Cache-Lesefehler, Prüfsummenfehler, ungeeignete Datenstrukturen oder mehr als 150 ms Wartezeit führen zum bestehenden kooperativen Rechenweg. Ein abgelöster oder verlassener Request darf keinen verspäteten Treffer anzeigen oder neue Arbeit starten. Testmonate werden nicht persistent gespeichert. Das erste Berechnen eines noch nicht gespeicherten oder nach einem Update veralteten Ergebnisses bleibt notwendig.

## Messung

Endgültige Variante, je drei Wiederholungen in getrennten Node-Prozessen mit echter SQLite-Datei, SHA-256 und 11.008 Einträgen. Median einschließlich Inhalts-Schlüsselbildung; der Neuberechnungswert endet vor dem anschließenden Speichern. Alle neun vollständigen Ergebnis-Hashes stimmen beim Wiederöffnen überein.

| Tarif | Neuberechnung | Gespeicherter Treffer nach Prozessneustart |
| ----- | ------------: | -----------------------------------------: |
| TV-L  |    1.121,0 ms |                                    24,1 ms |
| TV-UK |    1.112,6 ms |                                    24,0 ms |
| VKA   |    1.295,3 ms |                                    23,9 ms |

Die erste Messreihe lag ebenfalls im Bereich von rund 24 ms pro gespeichertem Treffer; die nachfolgende Epochensperre ist im endgültigen Wert enthalten. Die Messung umfasst Schlüsselbildung, Katalogfingerabdruck, SQLite-Lesen, Prüfsumme und JSON-Decodierung. Nicht enthalten sind App-Start, React, native Crypto-Brücke, SQLCipher und iPhone-Frames. Der Nutzen auf dem iPhone ist nach der Preview-Veröffentlichung gesondert zu prüfen.

## Wiederholung

```powershell
$performanceArtifacts = 'C:\Users\veron\.codex\visualizations\2026\10\27\01a17f09-8819-7f23-9155-f6f974bff1af'
node --require tsx/cjs scripts/benchmark-persisted-analysis.cjs --output-dir (Join-Path $performanceArtifacts 'phase8-benchmark-repeat')
node --require tsx/cjs scripts/benchmark-all-tariffs.cjs --compare (Join-Path $performanceArtifacts 'phase8-baseline')
node --require tsx/cjs scripts/benchmark-all-tariffs.cjs --compare (Join-Path $performanceArtifacts 'phase8-baseline') --holdout
npm.cmd test -- src/features/analysis/persistent-analysis-cache.test.ts src/features/analysis/analysis-salary.test.ts src/features/analysis/monthly-analysis-cache.test.ts src/rules/rule-resolver.test.ts
npm.cmd run test:components -- --runTestsByPath src/features/analysis/persistent-analysis-lifecycle.component.test.tsx src/features/analysis/analysis-month-data.component.test.tsx src/features/analysis/use-prepared-monthly-analysis.component.test.tsx src/features/analysis/use-prepared-analysis-salary.component.test.tsx src/features/analysis/use-monthly-compliance.component.test.tsx src/features/analysis/analysis-rule-coverage.component.test.tsx
$env:VITEST_MAX_WORKERS = '2'
npm.cmd run verify:fast
```

Geräteabnahme: Nach Installation der Preview zunächst die Auswertung fertig laden und etwa eine Sekunde geöffnet lassen. Danach die App vollständig beenden, neu öffnen und denselben Monat aufrufen. Anschließend Dienst-/Einstellungsänderung und Monats-/Jahreswechsel prüfen. Ein Kaltstart direkt nach dem OTA ist noch kein Nachweis für einen bereits gefüllten Cache. Verteilung/Bundlehash und Gerätewirkung werden getrennt dokumentiert.
