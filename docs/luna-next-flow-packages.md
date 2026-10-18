# LUNA: die nächsten drei Ablaufpakete

Freigabe: Punkte 1–3 der Priorisierung umsetzen und die betroffenen Abläufe gründlich testen. Kein Commit, Push, Build oder OTA.

## Gemeinsamer Task-Vertrag

- Ziel: Prüfungsangaben nur in einem Editor bearbeiten; eine Hauptaktion zum Einladen; ein Bearbeitungsweg pro Vorlage in der Verwaltung.
- Nicht-Ziele: Rechts- oder Gehaltsregeln, Datenmigrationen, Backend, Authentifizierung/Rechte, neue Abhängigkeiten, native Konfiguration, weitere Reviewpunkte oder Veröffentlichung.
- Plattform: iPhone; der Nutzer verwendet TestFlight Build 5. Abnahme der neuen Ansichten am Gerät bleibt ein separates offenes Gate.
- Arbeitskopie: `.worktrees/luna-copy-flows`, Branch `codex/luna-copy-flows`, Basis `84d23045a3525eddee4827f1daa82b806b734dbe`. Der vorherige Abschlussstand mit 103 Dateien wurde vor Beginn per Hash abgeglichen und bleibt erhalten.
- Expo: `~57.0.22`; passende SDK-57-Routerdokumentation geprüft. Keine Versionsänderung.
- Ablauf: read-only prüfen, vorhandene Verhaltenstests an die neue Spezifikation anpassen, RED→GREEN, unabhängiger Review, anschließend gemeinsames `npm.cmd run verify:fast`.
- Umfang: drei getrennte Pakete mit jeweils höchstens 15 Dateien einschließlich Tests. Zentrale Dokumentation bearbeitet ausschließlich der übergeordnete Task.
- Zielnachweis: automatisierte Tests am Rechner; spätere iPhone-Screenshots, große Schrift, VoiceOver und Gesten gesondert dokumentieren. Kein App-Build oder OTA zur Beschaffung dieses Nachweises freigegeben.

## P12 / OS-10: gemeinsamer Editor für Prüfungsangaben

Scope: `settings-editor-screen.tsx`, `use-profile-leave-guard.ts`, `check-profile-screen.tsx` und die vier bestehenden Komponententests `work-profile-flow` / `check-profile-screen` / `settings-vka-e` / `settings-nursing-training`; sieben Dateien. Die beiden Gehaltsformulartests wurden nach dem ersten Gesamtlauf ergänzt, um erfolgreiche Speicherung und erneutes Öffnen als getrennte Bearbeitungssitzungen zu prüfen.

Der vorhandene Frageneditor `/check-profile` wird gemeinsam genutzt. Der WORK-Editor ersetzt die drei Auswahlfelder durch einen Einstieg. Bei unverändertem Entwurf erfolgt kein Speichern; bei geändertem Entwurf heißt die Aktion „Speichern & Angaben öffnen“ und wechselt erst nach erfolgreichem Speichern. `replace` entfernt den WORK-Editor, damit kein alter Entwurf später neue Antworten oder Feiertagsangaben überschreibt. Der gemeinsame Frageneditor übernimmt den vorhandenen Schutz vor versehentlichem Verwerfen.

Akzeptanz:

- Die drei booleschen Prüfungsangaben haben genau einen Editor; beide bisherigen Einstiege führen dorthin.
- `true`, `false` und unbekannte Antworten bleiben unterscheidbar; bestehende Angaben und Feiertagsregion gehen nicht verloren.
- Gezielte Fragen aus der Auswertung bleiben möglich; ungültige Links speichern nichts.
- Arbeitsstunden, Arbeitsort und Prüfungsangaben überschreiben einander nicht.
- Unfertige Eingaben werden beim Übergang, Zurückgehen oder Speichern nicht stillschweigend verloren; Fehler und erneutes Speichern sind abgesichert.
- Nach erfolgreicher Speicherung genau einmal navigieren. Erneutes Bearbeiten beginnt in einer neuen Sitzung; Tarifregionen bleiben auch über Speichern und Wiederöffnen erhalten.
- Keine Prüfregel oder Datenstruktur ändern.

## P13 / OS-08: eine Hauptaktion zum Einladen

Scope: `calendar-sharing-screen.tsx`, `calendar-sharing.component.test.tsx`, `sharing-ui-boundaries.component.test.tsx`; drei Dateien.

Akzeptanz:

- In derselben Einladungsübersicht ist genau ein Einstieg „Neue Einladung“ sichtbar; der zusätzliche Header-Plusbutton entfällt.
- Erste und weitere Einladungen bleiben möglich, vorhandene Links bleiben erreichbar.
- Öffnen und Abbrechen erzeugen keinen Kalender oder Link; erst die ausdrückliche Erstellung schreibt Daten.
- Zurück, Fehler/Wiederholen sowie bestehende PENDING-/ACTIVE-Zustände bleiben erhalten.
- Controller, Authentifizierung, Rechte und Backend unverändert lassen.

## P14 / CE-11: ein Bearbeitungsweg in der Vorlagenverwaltung

Scope: `templates-manager-screen.tsx`, `shift-template-list.tsx` und deren zwei vorhandene Komponententestdateien; vier Dateien.

Akzeptanz:

- Eine Verwaltungszeile öffnet genau einmal den Vorlageneditor mit der Vorlagen-ID und ohne Eintragsdatum.
- Die dort redundante zweite Bearbeitungsaktion entfällt.
- Die Kalenderauswahl behält zwei unterschiedliche Aktionen: Zeile trägt ein, Zusatzaktion bearbeitet die Vorlage.
- P2-Schutz vor doppeltem Eintragen, unbeabsichtigtem Entfernen und Eintragen beim Vorlagenbearbeiten bleibt erhalten.
- Sortierung, Zeilenstil und Speicherlogik unverändert lassen.

## Abschlussnachweise

Fokussierte Nachweise:

- P12: vier Suiten mit 44 Fällen bestanden. Der unabhängige Review fand einen möglichen zweiten Rücksprung nach erfolgreichem Speichern. Drei bestehende Regressionen wurden um den anschließenden Footer-Tipp ergänzt: zunächst 3/3 rot, nach dem Fix 3/3 grün. Beide Footer beachten die Erfolgssperre; Fehler bleiben korrigierbar.
- P12: zwei bestehende Gehaltsformular-Suiten mit 20 Fällen bestehen nach Anpassung an getrennte Bearbeitungssitzungen. Tatsächliche Save-Payloads werden übernommen, anschließend wird der Editor geschlossen und neu geöffnet; alle bisherigen Tarifregions-, Payload- und UI-Prüfungen bleiben erhalten.
- P13: zwei Suiten mit 50 Fällen bestanden; erste/weitere Einladung, Öffnen/Abbrechen ohne Schreiben, bestehende Links, Fehler/Wiederholen und Zurück geprüft.
- P14: fünf Suiten mit 26 Fällen bestanden; Liste, Verwaltung, Kalenderauswahl, Quick Add und Vorlageneditor geprüft.

Der erste Gesamtgate für P12–P14 lief am 15.10.2026 von 20:18 bis 20:30 Uhr: 8.735 Unit-Tests in 450 Dateien bestanden; drei Gehaltsformularfälle in zwei Komponentensuiten fehlgeschlagen, 1.152 Fälle in 135 Suiten bestanden. Sie bearbeiteten nach erfolgreichem Save dieselbe, in der App bereits geschlossene Instanz weiter. Das Testmodell wurde angepasst; keine Produktionssperre oder Prüfgrenze wurde dafür entfernt. Alle 107 geänderten/neuen Dateien blieben während dieses Laufes per Hash unverändert.

Die unabhängigen Code-/Sicherheitsreviews von P12–P14 und die Korrektur des Footer-Befunds sind dokumentiert. Auch die ergänzten Testdateien sind ohne weitere Befunde freigegeben: echte Save-Payloads, getrennte Sitzungen, unveränderte bisherige Assertions und zusätzliche Schreib-/Navigationszähler.

Der abschließende Gesamtgate `npm.cmd run verify:fast` lief am 15.10.2026 von 20:46 bis 20:59 Uhr vollständig erfolgreich durch (Exitstatus 0): Regelprüfung, Typecheck, ESLint ohne Warnungen, Prettier, 8.735 Unit-Tests in 450 Dateien, 1.155 Komponententests in 137 Suiten, alle 13 nachfolgenden Skriptprüfungen und Diffprüfung. Alle 109 geänderten/neuen Dateien waren während dieses Laufes hashgleich. Danach wurden ausschließlich die beiden Abschlussberichte ergänzt.

Ein Zwischenlauf hatte bei einem unveränderten Kalender-Gestentest einen Timeout an der bestehenden 5-Sekunden-Grenze. Dieselbe Datei bestand isoliert alle neun Fälle und anschließend auch im erfolgreichen Gesamtgate. Weder Code noch Timeout wurden dafür geändert. Beide vorherigen Gesamtläufe und ihre Manifeste sind archiviert.

Damit sind OS-10, OS-08 und CE-11 im Code umgesetzt. Der gesamte Befundkatalog steht jetzt bei 40 umgesetzten, einem teilweise umgesetzten und fünf zurückgestellten Punkten; die Geräteabnahme ist darin ausdrücklich nicht enthalten.

Nachweise liegen im Gesprächsordner unter `implementation/P12`, `P13`, `P14` und `next-flows`. [Erfolgreicher Gesamtgate](C:/Users/veron/.codex/visualizations/2026/10/15/01a14034-a8b5-77b2-b0e1-6cfcd4126913/implementation/next-flows/verify-fast.log), [Exitstatus und Zeitstempel](C:/Users/veron/.codex/visualizations/2026/10/15/01a14034-a8b5-77b2-b0e1-6cfcd4126913/implementation/next-flows/verify-fast-result.json), [Reviewprotokoll](C:/Users/veron/.codex/visualizations/2026/10/15/01a14034-a8b5-77b2-b0e1-6cfcd4126913/implementation/next-flows/review-P12-P14.md), [erster Gesamtgate](C:/Users/veron/.codex/visualizations/2026/10/15/01a14034-a8b5-77b2-b0e1-6cfcd4126913/implementation/next-flows/verify-fast.first-failed.log), [Gerätefälle P12–P14](C:/Users/veron/.codex/visualizations/2026/10/15/01a14034-a8b5-77b2-b0e1-6cfcd4126913/implementation/iPhone-Abnahme-P12-P14.md).

Alle 13 neuen Gerätefälle bleiben offen; kein iPhone-Test des neuen lokalen Standes ist erfolgt. Commit, Push, App-Build und OTA bleiben ausgeschlossen. Der bisherige TestFlight-Stand wurde nicht aktualisiert.
