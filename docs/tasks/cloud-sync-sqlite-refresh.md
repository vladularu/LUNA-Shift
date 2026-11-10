# Cloud-Übernahme ohne nativen Neustart

## Task-Vertrag

- Ziel: Nach einer erfolgreichen Cloud-Übernahme alle lokalen Daten- und Darstellungskontexte neu laden, während die bestehende SQLite-Verbindung geöffnet bleibt.
- Nicht-Ziele: Cloud-Merge-Regeln, automatische Dublettenbereinigung, Schema-, Paket- oder native Änderungen; TestFlight-Veröffentlichung oder neue TestFlight-Baseline.
- Plattform: iOS, bestehender Preview-Build 50 auf dem iPhone des Nutzers.
- Dateiscope: Root-Provider-Anordnung, Cloud-Provider, neue React-Refresh-Grenze, gezielte Integrationstests, diese Dokumentation und genaue Kandidaten-Hashes im vorhandenen Release-Schutz.
- Freigabe: bestehende Nutzerfreigaben für Implementierung, Git und Preview; TestFlight bleibt ausdrücklich unverändert.
- Abnahme: erfolgreicher Cloud-Import aktualisiert Kalender und Einstellungen ohne Prozessneustart; unveränderte Folge-Synchronisierung verursacht keine Refresh-Schleife; bestehende Datenbank bleibt nutzbar. Anschließend wiederholte echte iPhone-Synchronisierung, inklusive Hintergrund/Vordergrund und Prüfung von Profil, Foto, Kalenderdarstellung, Auswertung und Widget.

## Befund und Grenzen

Die gelieferten Berichte von TestFlight Build 9 und Preview Build 50 zeigen beide EXC_BAD_ACCESS/SIGSEGV in pthread_mutex_lock auf expo.module.sqlite.AsyncQueue (iOS 27.0.1). Die UUID des authentifizierten Preview-IPA stimmt mit dem Preview-Bericht überein. Eine lokale LLVM-Disassemblierung ordnet dessen Swift-Aufrufer dem Lesen der SQLite-Spaltennamen zu: Spaltenanzahl, Schleife und Aufruf von column_name entsprechen getColumnNames in ExpoSQLite/SQLiteModule.swift.

Der bestehende Cloud-Provider ruft nach Commit und erfolgreichem Abgleich reloadAppAsync auf. Expo SQLite 57.0.4 schließt bei Modulzerstörung zwischengespeicherte Datenbanken und finalisiert Statements; diese Bereinigung ist gegenüber gleichzeitig laufenden Statement-Zugriffen nicht durchgehend gesperrt. Der vollständige Neustart ist deshalb ein konkreter, zur Fehlersignatur passender Auslöser. Die genaue Reihenfolge auf dem betroffenen iPhone ist ohne instrumentierten nativen Lauf weiterhin nicht bewiesen.

Die Korrektur entfernt diesen Neustart ausschließlich aus dem Cloud-Ablauf. Sie ersetzt ihn durch einen React-Refresh unterhalb des bestehenden SecureDatabaseProvider. Sie repariert nicht sämtliche möglichen nativen SQLite-Lebenszyklusfehler. Der separate lokale Backup-Neustart bleibt außerhalb dieses Pakets.

Zusätzliche Dienste im Kalender sind ein eigener Datenbefund: unterschiedliche Datensatz-IDs bleiben beim bestehenden Merge eigenständige Einträge. Ohne die tatsächlichen Datensätze erfolgt keine automatische Löschung oder Zusammenfassung.

Referenzen: [Expo SDK 57 SQLite](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/), [Expo SDK 57 reloadAppAsync](https://docs.expo.dev/versions/v57.0.0/sdk/expo/#reloadappasyncreason).

## Validierung

Die Arbeit ist in zwei getrennte Pakete geteilt:

1. Daten-Refresh: React-Grenze, Root-Anordnung, Cloud-Callback und Router-Integrationstest. Der aktive Kalendermonat bleibt außerhalb der erneuerten Datenkontexte erhalten.
2. Voraussetzung Erinnerungen: generationengebundene Aufträge vor Datenbank-Lesezugriffen und beim Einreihen, Sperre während Cloud-Restore und Abwarten ausschließlich bereits laufender SQL-Schreibzugriffe. Verspätet erzeugte native Erinnerungen werden storniert. Nach Rollback wird die Sperre vor Wiederherstellung der gültigen Erinnerungen gelöst. Keine native Binär- oder Paketänderung.

Beide Pakete müssen gemeinsam geprüft sein, bevor die Preview-Korrektur verteilt wird.

Lokale Prüfungen, CI, Preview-Verteilung und iPhone-Abnahme werden getrennt dokumentiert. Ein grüner JavaScript-Test beweist keine native Absturzfreiheit. Der PR bleibt bis zur Geräteabnahme ein Entwurf.
