# Vorbereitete Jahresauswertung

## Auftrag und Abnahme

Ziel: dieselbe vorbereitete Verfügbarkeit wie beim Monatsbericht, mit gemeinsamen laufenden Aufträgen, lokal gespeicherten vollständigen Ergebnissen, korrekter Invalidierung und flüssigeren ersten Rechenschritten. Zielgerät: iPhone 14 Pro Max, Expo SDK 57 (~57.0.31). Maßgeblich: [Expo SQLite SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/).

Nicht-Ziele: Änderungen an Tarif-/Arbeitszeitregeln, Ergebnissen, Netto-Steuerlogik, Darstellung, Navigation, nativer Konfiguration oder Abhängigkeiten. Nach lokaler Validierung folgt die iOS-Preview-OTA im bestehenden freigegebenen Performance-Testablauf. Die Übernahme in TestFlight und Git-Delivery bleiben eigene Schritte.

Pakete:

1. Jahresberechnung in kooperative Abschnitte teilen und vollständige Ergebnisse zwischen Ansichten wiederverwenden.
2. Gemeinsame Hintergrundvorbereitung und dauerhafte Speicherung anschließen.
3. Ergebnisgleichheit, Neustart, Änderungsfolgen, Abbruch, Fehler und Grenzen prüfen.

Scope: Jahres-Hook, Jahresansicht/Details, Jahreskern, vorhandene Schritt-APIs für Zeit und Diensttypen, neue Jahresvorbereitung, gemeinsamer abgeleiteter Ergebniscache und Backup-Löschung dieses Caches, zugehörige Tests und Benchmarks. Keine Nutzerdatenmigration.

Abnahme: vollständige Ergebnisgleichheit zur Basis 70cf49b52afc1e77d507538cab1acad41956ad31; vorbereitete erste Darstellung ohne neue Jahresberechnung; gleiche laufende Arbeit für Hintergrund/Übersicht/Details; geänderte Eingaben und Regelkataloge werden nicht verwechselt; begrenzte Speicher- und Auftragsmengen; Monatsarbeit hat Vorrang. Reale iPhone-Flüssigkeit bleibt nach Bereitstellung separat abzunehmen.

Vor Preview wird der inzwischen abgenommene Kalenderstand aus PR #327 (20ecc9472ebd46bf229d04c958853de1d653da1d) als aktuelle Basis übernommen. Seine 15 Dateien überschneiden sich nicht mit den 23 Jahres-Dateien; deren Hashes bleiben bei der Übernahme unverändert. Die Berechnungsbasis bleibt identisch, und der kombinierte Stand durchläuft erneut `verify:fast`.

## Ablauf

Die zusätzliche Vorbereitung wird erst hinter der bestehenden Start-Barriere geladen. Sie verarbeitet höchstens drei unterschiedliche Jahre aus ausgewählter Auswertung, aktuellem Datum und Kalenderauswahl. Sie läuft nur bei aktiver App und geladenen Daten sowie bekannten Jugendprüfungs-Einstellungen; Testdaten deaktivieren die vorsorgliche Jahresvorbereitung. Änderungen werden 120 ms gesammelt. Monatsaufträge haben höhere Priorität als Jahresvorbereitung. Die sichtbare Jahresansicht übernimmt denselben Auftrag mit höherer Priorität. Ihr Empfänger bleibt erhalten, wenn die vorsorgliche Nutzung endet.

Der exakte Schlüssel enthält ausgewählte Einträge inklusive benötigter Rechts-/Tarifzeiträume, vollständiges Profil, Tarifentscheidungen, Arbeitsmuster, Jahr, Bezugsdatum und Jugendprüfung. Der Regelkatalog ist zusätzlich isoliert. Pro Datenbank-/Cache-Instanz und Regelkatalog werden höchstens sechs vollständige Ergebnisse und die bisherigen 36 Monats-Teilergebnisse im Speicher gehalten. Das zuletzt passende Ergebnis des aktuellen Jahres wird gegen Verdrängung durch entfernte Jahre geschützt.

Der Jahreskern gibt nun innerhalb der Tagesauswertung ab. Sollzeit und Diensttypen verwenden dieselben vorhandenen Generatoren wie die Monatsberechnung; die Zuschlagsvorbereitung wärmt dieselben Dienst-Caches, bevor der unveränderte Monatsrechner sein Ergebnis zusammensetzt. Formeln, Rundung, Rechtsfenster und Ergebnisreihenfolge bleiben gleich. Ein früher Jahreskern erscheint weiterhin vor regelgebundener Arbeit.

Die gespeicherten Basisberichte enthalten keine zusätzlich angewendeten Jahreszahlungen. Aktuelle gespeicherte Zahlungen und der bestehende Sonderzahlungsvorschlag werden weiterhin vom vorhandenen Gehaltsweg genau einmal ergänzt.

## Dauerhafte Ergebnisse und Fehler

Die abgeleitete Cache-Tabelle v2 erlaubt zusätzlich Jahresergebnisse. Die alte ausschließlich abgeleitete v1-Tabelle wird beim Initialisieren entfernt; Nutzer-Migrationen, Backups und Sync bleiben getrennt. Lokale/Cloud-Wiederherstellung löscht beide Cache-Versionen atomar. Alte Repository-Instanzen können nach Wiederherstellung wegen des Epochentokens nicht zurückschreiben.

Gespeicherte Ergebnisse gelten nur für genau dieselbe Bundle-ID, denselben serialisierten Regelkatalog und dieselben Eingabewerte. SHA-256, Formprüfung, 150-ms-Lookupgrenze sowie vorhandene Grenzen von 72 Zeilen, 8 MiB gesamt und 1 MiB pro Ergebnis bleiben bestehen. Die Schichtverteilung wird explizit als Map serialisiert und wiederhergestellt. Abgeschlossene Berichte mit vollständiger Zeit-/Prüfungsabdeckung und zwölf Monatsergebnissen dürfen dauerhaft gespeichert werden. Gehalt darf für null bis zwölf Monate verfügbar sein: Die erklärte Anzahl muss genau zu den vorhandenen Monatsbeträgen passen; nicht abgedeckte Monate behalten ihren Null-Wert und die sichtbare Teilabdeckung. Fehlende Zeit-/Prüfungsabdeckung, fehlende Monate, widersprüchliche Zähler und noch laufende Kernberichte erhalten keinen dauerhaften Erfolgseintrag.

Der Geräte-Neustarttest deckte eine zu enge Speicherbedingung auf: Ein vollständig durchgerechnetes Jahr mit regulär acht verfügbaren Gehaltsmonaten wurde wie ein unfertiger Bericht behandelt. Ein echter Acht-Monats-Katalog reproduziert den Fehler. Persistenz- und Komponententests verlangen jetzt nach neuen Cache-/Kataloginstanzen dasselbe vollständige Ergebnis inklusive fehlender Gehaltsmonate und einen ersten sichtbaren Bericht ohne erneute Jahresberechnung. Berechnung und Teilabdeckungs-Hinweise werden nicht geändert.

Fehlgeschlagene Arbeit wird nicht als Erfolg behalten. Ein neues gleiches Vorbereitungsereignis kann sie erneut versuchen. Eine langsame/defekte optionale Speicherung blockiert die normale Berechnung nicht. Neue Schreibansprüche gewinnen auch dann, wenn ein alter Hash oder SQL-Auftrag später fertig wird. Optionales Vorbereitungsversagen bleibt durch eine eigene Fehlergrenze von der Navigation getrennt.

## Messverfahren und Grenzen

Maximal zwei Varianten: Basis und gemeinsame, vorbereitete Variante. Vier dichte Pläne für TV-L, TV-UK, VKA und eigene Vergütung; separate Holdout-Fälle für TV-H, TVAL, TVAöD, TVöD-P, leeres Jahr und eigene Vergütung mit Nacht-, Abwesenheits-, gelöschten und jahresübergreifenden Einträgen sowie Jugendprüfung. Verglichen werden vollständige Ergebnis-Hashes bei Erstberechnung, erneutem Öffnen mit frisch geladenen Objekten, Bearbeitung und Rückkehr zu den ursprünglichen Eingaben.

Erste Messung dichter Pläne am Rechner: erneutes Öffnen vorher 1,8–4,1 s, vorbereitet 6,5–7,6 ms einschließlich Eingabeauswahl und Schlüssel. Längster Generator-Schritt vorher 201–446 ms, nachher 12–22 ms. Die gesamte erstmalige Vorbereitung kann durch Aufteilung mehr CPU-Zeit brauchen (TV-L etwa 2,5 auf 2,8 s); sie fällt vor dem Öffnen an. Das bedeutet keine garantierte sofortige erste Auswertung, wenn die Vorbereitung noch nicht fertig ist. Werte sind synthetische Node-CPU-Messungen ohne SQLite-/Bridge-/React-/Idle-Wartezeiten oder iPhone-Frames.

Reproduzierbar:

```powershell
node --require tsx/cjs scripts/benchmark-annual-analysis.cjs --compare <basis-quellverzeichnis>
node --require tsx/cjs scripts/benchmark-annual-analysis.cjs --compare <basis-quellverzeichnis> --holdout
npx.cmd vitest run src/features/analysis/annual-analysis.test.ts src/features/analysis/annual-analysis-warmup.test.ts src/features/analysis/persistent-analysis-cache.test.ts src/features/analysis/annual-core-report.test.ts --maxWorkers=1
npx.cmd jest --runInBand --runTestsByPath src/features/analysis/annual-analysis-background.component.test.tsx src/features/analysis/use-simple-annual-report.component.test.tsx src/features/analysis/analysis-warmup-provider.component.test.tsx
npm.cmd run verify:fast
```

Rollback: diese Implementierung zurücknehmen. Die abgeleiteten Cache-Zeilen sind entbehrlich; Nutzer- und Gehaltsdaten werden nicht geändert.
