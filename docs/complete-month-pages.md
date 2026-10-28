# Vollständig vorbereitete Monatsseiten

Freigabe am 28.10.2026: nach dem Gerätevergleich mit SuperShift vollständige Monatsansichten früher vorbereiten und Kartenhöhen beim Nachladen stabil halten; Berechnungen unverändert. Danach ausschließlich iOS-Preview-OTA, kein nativer Build, TestFlight, Production oder Git-Delivery. Expo SDK 57 (`~57.0.31`), iPhone 14 Pro Max, Branch `codex/monthly-analysis-performance`.

Vergleichsbasis ist die getestete Preview-Gruppe `bea7870c-20a0-4150-a55c-df7b7ae5b51f`. Die 79 veröffentlichten Quelldateien werden vor Änderungen anhand ihres SHA-256-Manifests verifiziert und als `phase7-baseline/` im bestehenden Performance-Artefaktverzeichnis gesichert. Das bereitgestellte LUNA-Video zeigt beim Dezemberwechsel rund 1,2 Sekunden zwischen neuem Monatskopf und fertigen Gehaltswerten sowie einen nachträglichen Höhenwechsel der Gehaltskarte.

Ziel: Vorbereitungszustände von Stunden, Gehalt/Netto und Prüfung für mehr als den unmittelbar angrenzenden Monat behalten; Einstellungen gemeinsam frisch laden; beim Nachladen dieselben Wertpositionen beibehalten. Nicht-Ziele: neue Tarif-/Steuer-/Prüfregeln, andere Rundung, gekürzte Bewertungsfenster, neue native Module, persistente Datenbank-Caches und Änderungen an der nativen Wischmechanik oder Tab-Perioden.

Der erwartete Scope umfasst mehr als 15 Dateien und wird deshalb in Pakete geteilt: A) gemeinsame Einstellungsquelle und bestehende Monatshooks in dauerhaft gehaltenen Vorbereitungskomponenten mit begrenztem Vorauslauf; B) stabile Gehalts-/Prüfzeilen beim Nachladen; C) Regressionen, reproduzierbare Messung, vollständige Qualitätsprüfung und kompatible Preview-OTA. Dateiscope: Analyse-Seite/-Vorbereitung, ihre vorhandenen Queue-/Gehaltshelfer, optionale Vorbereitungswrapper im Report-Pager, Analyse-Karten und gezielte Tests/Benchmarks/Dokumentation. Andere Report-Pager-Nutzer behalten die bisherigen Vorgaben.

Abnahme: vollständige Ergebnis-Hashes identisch zur Basis; keine alten Zahlen unter einem neuen Monat, keine übernommenen veralteten Netto-Einstellungen nach Fokus-/Datenbank-/Profilwechsel, keine zusätzliche Datenbankabfrage für jede vorbereitete Monatsseite. Die vorbereitende Komponente darf beim Übergang von unsichtbar zu sichtbar nicht neu starten. Verlassen der Analyse storniert ausstehende Arbeit. Fehler und nicht verfügbare Fachberechnungen bleiben erneut prüfbar. Karten zeigen während des Ladens Platzhalter an den späteren Wertepositionen; keine künstlichen Geldbeträge. Fokus-, Datums-, Profil-, Katalog-, Einstellungs- und Dienständerungen müssen weiter invalidieren.

Messung: Vergleich vollständiger Monatsseiten und ihrer Einstellungslesevorgänge vor/nach Umsetzung; 32 Haupt- und 20 Holdout-Tariffälle; Lifecycle- und Kartenregressionen; `npm.cmd run verify:fast`. Höchstens zwei Vorauslauf-/Prioritätsvarianten und zwei Darstellungsvarianten. Synthetische Laufzeiten und Komponententests ersetzen nicht die anschließende Geräteabnahme in Preview.

## Umsetzung

Die Analyse hält regulär fünf Monatsvorbereitungen: den gewählten Monat sowie zwei Monate davor und danach. Nur der bisherige sichtbare Bereich bekommt native Karten. Die zusätzlichen Vorbereitungen haben keinen nativen Seiteninhalt. Beim Übergang vom vorbereiteten Bereich zur sichtbaren Seite bleibt dieselbe Vorbereitungskomponente erhalten. Dies bewahrt auch vollständige Gehaltszustände ohne automatischen Jahreszahlungsvorschlag, die aus fachlichen Gründen nicht im globalen Erfolgscache liegen. Bei laufender Pfeilnavigation kann wie bisher zusätzlich der Zielbereich vorbereitet werden; die native Scroll- und Gestensteuerung bleibt unverändert.

Eine gemeinsame, nur lesende Einstellungsquelle lädt die vollständige Netto-Timeline für die Analyse. Jeder Monat benutzt weiterhin den bestehenden `resolveNetPaySettings`-Resolver und dieselbe Zusammenführung der Jahreszahlungen. Normale Monatswechsel führen keine weitere SQL-Abfrage aus. Fokusverlust, Datenbank- oder Profilwechsel verwerfen die vorherige Quelle; verspätete Ergebnisse alter Abfragen werden ignoriert. Die bisherige private Cloud-Übernahme lädt nach Datenersatz die App neu, der Backup-Import benutzt weiterhin seinen bestehenden Reload-Pfad. Es wurde kein dauerhafter Datenbank-Cache eingeführt.

Der sichtbare Monat erhält Vorrang vor vollständigen Nachbardetails; angrenzende Prüfungen und Gehaltsvorbereitungen laufen danach ohne zusätzliche Idle-Pausen. Entferntere Vorbereitungen bleiben nachrangig. Die bestehenden vier Millisekunden beziehungsweise 32 kooperativen Schritte pro Scheduler-Aufruf bleiben erhalten. Ein langer einzelner Fachschritt kann das Budget weiterhin überschreiten.

Die Gehaltsvorbereitung meldet den unverändert berechneten Jahreszahlungs-/Bruttoteil bereits vor Abschluss der Nettorechnung. Diese Zwischenmeldung beendet oder storniert die Nettorechnung nicht. Während des Nachladens stehen Grundgehalt, Zuschläge, Zulagen, Brutto und Netto bereits in ihrer regulären Zeilenstruktur. Offene Werte werden nicht durch erfundene Beträge ersetzt. Der reguläre Sonderzahlungstermin erhält bei fehlendem Betrag die Kennzeichnung „Nicht hinterlegt“, ein explizit gespeicherter Nullbetrag bleibt ein Nullbetrag. Die Prüfung benutzt beim Laden bereits ihre Zeilen für gesetzliche Prüfung und Planungshinweise. Monatsspezifische Layoutreserven berücksichtigen Zeilenumbrüche; größere Schrift darf weiter natürlich wachsen und wird nicht abgeschnitten. Andere Kartenverwender behalten die bisherigen Standardwerte.

## Belege

Die 32 Haupt- und 20 Holdout-Fälle liefern vollständig identische Monats-, Jahreszahlungs-, Netto- und Arbeitszeitprüfungsergebnisse wie die veröffentlichte Basis. 35 bereits geänderte Dateien aus Engine und Gehaltsberechnung sind bytegleich unverändert. Die fachlichen Anweisungen von `analysisSalaryKey`, `readAnalysisSalary` und `prepareAnalysisSalarySteps` stimmen nach Entfernen der einzigen optionalen Fortschrittsmeldung mit der Basis überein. Der native ScrollView-Öffnungsknoten einschließlich Gestenhandlern sowie `commit`, `move` und Anfangsposition sind per Syntaxbaum identisch.

Die Lifecycle-Tests prüfen eine gemeinsame Abfrage für mehrere Monate und Jahreswechsel, keine neue Abfrage bei weiterer Monatsauswahl, frische Einstellungen nach Fokusverlust, Datenbank-/Profilwechsel während einer offenen Abfrage, Fehlerwiederholung, Stornierung bei Fokusverlust, Übernahme eines vorbereiteten 2027-Monats ohne Neustart sowie sofortige Invalidierung bei einer Dienständerung ohne Revisionswechsel. Die Pager-Regression hält eine unsichtbare Vorbereitung bis zur sichtbaren und aktiven Seite mit derselben Instanz. Die Kartenregressionen vergleichen Zeilenpositionen und Layoutreserven vor und nach Fertigstellung. Der Zwischenstand Jahreszahlung/Brutto wird separat auf eine weiterlaufende Nettorechnung geprüft.

Zwei Prioritätsvarianten wurden gemessen. Variante A beschleunigte Nachbarmonate, verzögerte aber den sichtbaren Nettostand um etwa 0,6 Sekunden im Modell und wurde verworfen. Variante B stellt den sichtbaren Monat zuerst fertig und bereitet anschließend vollständige angrenzende Seiten vor. Sie wurde wiederholt gemessen und ausgewählt.

Wiederholung `phase7-final-comparison.json`, je drei vollständige Monatsseiten mit insgesamt 11.008 Einträgen, davon 10.000 außerhalb der Bewertungsfenster. Der Test simuliert 16 beziehungsweise 80 ms Idle-Verzögerung; das ist eine kontrollierte Modellbedingung, keine iPhone-Messung:

| Tarif / Idle-Modell | Sichtbares Gehalt vollständig vorher → nachher | Nachbargehalt vollständig vorher → nachher |
| ------------------- | ---------------------------------------------: | -----------------------------------------: |
| TV-L / 16 ms        |                               1.760 → 1.799 ms |                           3.240 → 2.263 ms |
| TV-L / 80 ms        |                               1.691 → 1.717 ms |                           3.110 → 2.159 ms |
| TV-UK / 16 ms       |                               1.718 → 1.738 ms |                           3.300 → 2.228 ms |
| TV-UK / 80 ms       |                               1.804 → 2.007 ms |                           3.317 → 2.547 ms |
| VKA / 16 ms         |                               2.039 → 2.078 ms |                           3.645 → 2.592 ms |
| VKA / 80 ms         |                               1.980 → 1.975 ms |                           3.730 → 2.527 ms |

Alle vollständigen Ergebnisse der sechs Drei-Monats-Vergleiche stimmen exakt überein. Die Messung erfasst die vorhandene Rechen-/Scheduler-Pipeline für drei Seiten; die zusätzlichen Vorbereitungsinstanzen und gemeinsamen Einstellungen sind durch die separaten Lifecycle-Tests abgedeckt. React-Commit-Zeiten, SQL-Wartezeit und native iPhone-Frames sind nicht enthalten. Ein nahtloses Geräteergebnis bleibt nach Installation der Preview zu bestätigen. Besonders relevant ist dieselbe Folge wie im Video, einschließlich November → Dezember und Rückkehr zu bereits besuchten Monaten.

## Wiederholung und Preview

Arbeitsverzeichnis: `C:\Users\veron\.codex\worktrees\monthly-analysis-performance\MediShift`. Artefakte: `C:\Users\veron\.codex\visualizations\2026\10\27\01a17f09-8819-7f23-9155-f6f974bff1af`.

```powershell
$performanceArtifacts = 'C:\Users\veron\.codex\visualizations\2026\10\27\01a17f09-8819-7f23-9155-f6f974bff1af'
node --require tsx/cjs scripts/benchmark-analysis-latency.cjs --compare (Join-Path $performanceArtifacts 'phase7-baseline')
node --require tsx/cjs scripts/benchmark-all-tariffs.cjs --compare (Join-Path $performanceArtifacts 'phase7-baseline')
node --require tsx/cjs scripts/benchmark-all-tariffs.cjs --compare (Join-Path $performanceArtifacts 'phase7-baseline') --holdout
npm.cmd run test:components -- --runTestsByPath src/features/analysis/analysis-month-data.component.test.tsx src/features/analysis/dashboard-loading.component.test.tsx src/ui/report-period-pager.component.test.tsx src/features/analysis/use-prepared-analysis-salary.component.test.tsx src/features/analysis/analysis-rule-coverage.component.test.tsx
npm.cmd test -- src/features/analysis/analysis-salary.test.ts src/features/analysis/monthly-analysis-cache.test.ts src/features/analysis/analysis-work-queue.test.ts
node (Join-Path $performanceArtifacts 'phase7-verification-setup.cjs')
node (Join-Path $performanceArtifacts 'phase7-source-gate.cjs')
npm.cmd run verify:fast
node (Join-Path $performanceArtifacts 'phase7-source-gate.cjs') --finalize
$env:APP_VARIANT = 'internal'
npx.cmd --yes eas-cli@latest update --branch preview --platform ios --environment preview --message 'Vollstaendige Monatsvorbereitung und stabile Ladezeilen' --emit-metadata --json
node (Join-Path $performanceArtifacts 'verify-phase7-preview.cjs')
```

Vergleichsdateien: `phase7-complete-neighbours-comparison.json` (verworfene Variante A), `phase7-promoted-comparison.json`, `phase7-final-comparison.json`, `phase7-all-tariffs.json`, `phase7-tariff-holdout.json`, `phase7-source-proof.json`. Die endgültige Gesamtprüfung und Dateihashes stehen in `phase7-source-manifest.json`; Runtime, Manifest und CDN-Bundle werden anschließend in `phase7-preview-verification.json` belegt. Die Geräteabnahme bleibt davon getrennt.
