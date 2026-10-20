# Personenwechsel und geteilte Kalender

- Ziel: Personen sofort lokal ein-/ausblenden; unveränderte Freigaben und unsichtbare Einträge ohne wiederholte teure Kalenderaufbereitung verarbeiten.
- Plattform: iOS, Abnahme auf iPhone 14 Pro Max; gemeinsame TypeScript-Logik bleibt plattformneutral.
- Nicht-Ziele: Start-/Update-Wartezeit, allgemeine Seitennavigation, Design, native Widget-Integration, neue Synchronisierungsrechte.
- Scope: Freigabe-Laufzeit und lokale Sichtbarkeitsverwaltung, stabile Cache-Referenzen, Personenschalter, Kalenderprojektion, zugehörige Unit-/Komponententests und dieses Dokument (unter 15 Dateien).
- Basis: frisch abgerufenes origin/master, b785792; Expo ~57.0.22, Dokumentation SDK 57.
- Abnahme: Sichtbarkeit ändert sich vor Netzwerk-/Speicherabschluss. Schnelle Mehrfachtipps behalten die letzte Auswahl; Speicherfehler kehren zum zuletzt gespeicherten Zustand zurück. Kontowechsel, Widerruf, Ablauf und beschädigte Daten bleiben abgesichert. Tageszuordnung, Sommerzeit, Notizen und Rechte bleiben korrekt. Identische Daten verursachen keine neue Kalenderprojektion; Zeiträume werden vor teuren Zeitzonenoperationen begrenzt.
- Prüfungen: gezielte Regressionen, `npm.cmd run verify:fast`, synthetischer Vorher-/Nachher-Vergleich. Gerätevideo für Personenwechsel bei laufender Synchronisierung und langsamer/offline Verbindung bleibt erforderlich; Rechnerwerte ersetzen keine iPhone-Messung.
- Commit, Push, Merge, Build und OTA sind nicht freigegeben.

## Umsetzung und lokale Messung

- Sichtbarkeit wird unmittelbar im Laufzeitspeicher aktualisiert und unabhängig von der Netzwerkwarteschlange gespeichert. Schreibvorgänge je Kalender bleiben geordnet; ein Fehler setzt nur die noch aktuelle Auswahl auf den zuletzt gespeicherten Stand zurück.
- Ein laufender älterer Datenbanklesevorgang überschreibt die Auswahl nicht. Kontowechsel und Widerruf verwerfen die zugehörigen Vorgänge.
- Der lokale Freigabecache wird vor dem Laden aller eigenen Veröffentlichungseinträge angezeigt. Identische Daten behalten ihre Referenzen; Statusmeldungen allein ändern die sichtbare Kalenderliste nicht.
- Kalenderprojektionen überspringen weit außerhalb des Zeitfensters liegende Einträge vor der Zeitzonenumrechnung. Unveränderte Einträge verwenden ihre vorbereiteten Tages-/Zeitangaben erneut; Ablaufprüfung und aktuelle Metadaten bleiben wirksam.
- Synthetischer Vergleich auf diesem Windows-Rechner, 3.000 Einträge, fünf Wiederholungen: außerhalb des sichtbaren Monats Median 289,15 ms vorher / 0,66 ms nachher; bei erneut aufbereiteten sichtbaren Einträgen 326,74 ms / 2,42 ms. Ergebnisse beider Implementierungen waren identisch.
- Grenze der Messung: Das erste Aufbereiten von 3.000 tatsächlich sichtbaren Einträgen wird dadurch nicht beschleunigt (einzelner Kaltlauf 317,07 ms vorher / 362,75 ms nachher). Die Optimierung vermeidet unnötige und wiederholte Arbeit; sie verlagert keine beliebig große Erstberechnung auf einen anderen Thread. Keine dieser Zahlen ist eine iPhone-Messung.

## Prüfstand

- Alle Prüfungen des `verify:fast`-Ablaufs bestanden: Regelverträge, TypeScript, Lint ohne Warnungen, Prettier, vollständige Testsuite und `git diff --check`.
- Unit-Tests: 8.972 bestanden, 463 Dateien. Komponententests: 1.262 bestanden, 143 Suiten. Alle 14 weiteren Skriptprüfungen aus `test:all` bestanden, einschließlich Freigabesicherheit, Widget-Verträgen und Worklets.
- Ausführungsdetails: Der gestartete Standardaufruf `npm.cmd run verify:fast` wurde beim sehr langsamen Windows-Prozesspool beendet. Dieselben Unit-Tests liefen anschließend mit `--pool=threads --maxWorkers=1`; alle nachfolgenden Skripte wurden unverändert aus `test:all` übernommen. Ein Skripttest konnte in der Sandbox sein temporäres Git-Repository nicht lesen und bestand unverändert außerhalb der Sandbox. Die letzten Codeänderungen wurden zusätzlich erneut auf Typen und Lint geprüft. Keine Grenzwerte oder Tests wurden abgeschwächt.
- Geräteabnahme auf dem iPhone 14 Pro Max bleibt offen. Prüfen: Personenwechsel bei laufender Synchronisierung, schnelle Mehrfachtipps, Offline-Nutzung und gespeicherte Auswahl nach erneutem Öffnen; Ziel ist eine sichtbare Reaktion möglichst unter 100 ms. Für diesen Stand wurde kein Commit, Push, Build oder OTA ausgeführt.
