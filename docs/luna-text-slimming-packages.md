# LUNA: Textabsicherung und Informationsseiten P15–P17

Freigabe: P15–P17 in kleinen Arbeitspaketen umsetzen und die betroffenen Abläufe gründlich testen. Kein Commit, Push, App-Build oder OTA.

## Gemeinsamer Task-Vertrag

- Ziel: Meldungsdarstellung von deutschem Wortlaut entkoppeln, Informationsseiten übersichtlicher machen und tatsächlich sichtbare Tarifhilfen prüfen/kürzen.
- Nicht-Ziele: Rechts- oder Gehaltsregeln, Schwellenwerte, Datenmigrationen, native Konfiguration, neue externe Abhängigkeiten, weitere UX-Experimente oder Veröffentlichung.
- Plattform: iPhone; zuletzt vom Nutzer genannter Stand TestFlight Build 5. Neue Ansichten werden lokal automatisiert geprüft; reale iPhone-Abnahme bleibt separat offen. Kein neuer Laufstand wird verteilt.
- Arbeitskopie: `.worktrees/luna-copy-flows`, Branch `codex/luna-copy-flows`, Basis `84d23045a3525eddee4827f1daa82b806b734dbe`. Die 109 bisherigen geänderten/neuen Dateien wurden vor Beginn per Hash geprüft: kein Drift, nichts gestaged. Andere Checkouts bleiben unberührt.
- Expo: `~57.0.22`; offizielle SDK-57-Dokumentation vor Änderungen geprüft. Keine Versionsänderung.
- Ablauf: read-only analysieren, vorhandene Verhaltenstests auf die neue Spezifikation ausrichten, gezielte Regressionen, Implementierung, unabhängiger Review und gemeinsames `npm.cmd run verify:fast`. Tests seriell; unveränderte Timeouts und Prüfgrenzen.
- Dateiscope: je Paket höchstens 15 Dateien einschließlich Tests. Zentrale Berichte und Befundstatus bearbeitet ausschließlich der übergeordnete Task.

## P15 / AS-14: Meldungsdarstellung absichern

Ziel: Kurzfassungen und Dienstfolgen bleiben stabil, wenn deutsche Beschreibungssätze geändert werden. Vorhandene Rohwerte der Berechnung als optionale, regeltypisierte Fakten durchreichen; keine fachlichen Grenzen oder Bewertungen ändern. Es handelt sich um Metadaten intern berechneter Ergebnisse, nicht um ein neues Persistenz- oder Backupschema.

Scope: `src/domain/types.ts`, neu `src/domain/compliance-issue-facts.ts`, `src/engine/compliance-issue.ts`, `src/engine/compliance.ts`, `src/engine/simple-youth-duty-time.ts`, `src/features/analysis/compliance-issue-summary.ts`, `compliance-timeline.ts`, neu `compliance-issue-legacy.ts` sowie die fünf bestehenden Tests `src/engine/compliance.test.ts`, `simple-youth-duty-time.test.ts`, `src/features/analysis/compliance-issue-summary.test.ts`, `compliance-timeline.test.ts` und `compliance-day-list.component.test.tsx`; maximal 13 Dateien.

Akzeptanz:

- Neue Engine-Ergebnisse verwenden für Kurzfassungen und Dienstfolgen strukturierte Minuten, Fristen, Mindestdauer und Serienzahl. Geänderte deutsche Titel/Beschreibungen ändern diese Angaben nicht.
- Serien bleiben Arbeitstage; mehrere Dienste an einem Tag werden nicht als mehrere Tage gezählt. Bestehende Schutzfälle für fehlende Dienste, Zeiträume, DST und Jahreswechsel bleiben wirksam.
- Schwellenwerte, Severity, IDs, Entscheidungen und vollständige Engine-Beschreibungssätze bleiben unverändert.
- Ergebnisse ohne Fakten behalten ihr bisheriges Verhalten über einen ausdrücklich abgegrenzten Legacy-Adapter. Unbekannte alte Texte bleiben vollständig sichtbar.
- Ungültige Fakten, falsche Regelzuordnung, fehlende Werte oder ungültige Fristen erzeugen keine erfundenen Angaben. Vorhandene gültige Legacy-Fälle und die bisherigen Formatierungsgrenzen bleiben abgesichert.
- Erwachsenen- und Jugendruhezeit sowie Ausbildungs-/Altersübergänge bleiben unverändert bewertet. Vorhandene vollständige Langtexte und Detailwege bleiben erhalten.

## P16 / OS-13: kurze Informationsseiten mit Details bei Bedarf

Scope: `src/features/settings/settings-info-details-screen.tsx`, `settings-info-details-screen.component.test.tsx` und `settings-info-location-disclosure.component.test.tsx`; drei Dateien.

Das vorhandene `InfoDisclosure` bleibt unverändert und wird wiederverwendet. STORAGE zeigt eine kurze Übersicht und drei zunächst geschlossene Themen: „Teilen & Datenschutz“, „Sichern & Löschen“, „Ortssuche & Karten“. CALCULATION bündelt Fachthemen in Aufklappern. „Schätzung statt Abrechnung“ und die zugehörige Grenze bleiben direkt sichtbar. ABOUT-Version und tarifliche Zulagendetails bleiben direkt lesbar.

Akzeptanz:

- Kurze Ausgangsansicht; Themen einzeln öffnen und schließen. Zugängliche Beschriftung und Aufklappzustand bleiben korrekt.
- Alle bestehenden Aussagen zu Freigabeumfang, Notizen, ausgeschlossenen Daten, Onlineübertragung, Aufbewahrung, Widerruf und Löschung bleiben erreichbar.
- Backupgrenzen, Vorlagenbindung, Ortssuche, Kartendienst, Standortfreigabe und Plattformgrenzen bleiben erreichbar.
- Berechnungsgrenzen bleiben klar; Angaben zu allen Jobs und weitere Fachdetails bleiben auffindbar.
- Bestehende Routenziele, ungültige Links, Zurück und Versionsanzeige bleiben erhalten.
- Hinweise vor tatsächlichen Handlungen in Sharing, Backup und Ortssuche unverändert lassen.

## P17 / TX-01: veraltete Reviewreferenz korrigieren

Die read-only-Nachprüfung zeigt: Die lange `supportNote` aus `remuneration-tariff-options.ts` wird nicht produktiv angezeigt. Ihre Aufrufkette endet derzeit in Tests. Die tatsächlich sichtbare Tarifauswahl verwendet bereits kurze Bezeichnungen aus `salary-basis-options.ts`; Auswahl und Validierung bleiben ausdrücklich erforderlich. Berechnungshinweise und Zulagendetails besitzen eigene erreichbare Ansichten.

Scope: keine Produktdatei ändern. Eine neue Aufklappstruktur würde hier zusätzliche Texte einführen. Stattdessen den alten TX-01-Befund nach unabhängiger Prüfung als überholt korrigieren und bestehende Tests für die aktuellen Auswahl-/Hinweiswege ausführen. Keine bestehende Berechnungsunterstützung oder Pflichtangabe entfernen; ungenutzte Tarifmodelle nicht in diesem Paket bereinigen.

## Nachweise und offene Abnahme

- P15: 170/170 Unit-Fälle, 12/12 Fälle der Befundansicht und 17/17 unveränderte Ausbildungs-/Altersübergangsfälle bestanden. Vor der Implementierung waren 66 Unit-Fälle und ein Komponentenfall erwartungsgemäß rot. Der unabhängige Code-/Sicherheitsreview ist ohne konkrete Restbefunde freigegeben. Ein zusätzlicher Tokenvergleich der beiden Erzeuger nach Entfernen ausschließlich der ergänzten Faktenargumente bestätigt unveränderte vorherige Entscheidungen, Schwellen und Langtexte.
- P16: drei Suiten/23 Fälle bestanden; zehn zusätzliche Verhaltenstests. Alle 69 bestehenden Beschreibungssätze aus 38 Absätzen sind erhalten, fünf Tarifblöcke wortgleich. Unabhängiger Code-/Sicherheitsreview ohne Restbefunde. Die Hinweise vor tatsächlichen Handlungen wurden nicht verändert.
- P17: 23/23 bestehende Unit-Fälle, 55/55 Komponentenfälle und vier gezielte Zulagen-Klickfälle bestanden. In der letzten gezielten Auswahl wurden 80 weitere Fälle bewusst nicht ausgeführt; das ist keine Behauptung eines vollständigen Suitenlaufs. Keine Produktdatei und kein Test geändert. TX-01 wird als überholter Befund korrigiert.

Der gemeinsame Abschlusslauf `npm.cmd run verify:fast` ist am 15.10.2026 um 21:52 Uhr vollständig bestanden (Exitstatus 0): Regelprüfung, Typecheck, ESLint ohne Warnungen, Prettier, 8.798 Unit-Tests in 450 Dateien, 1.166 Komponententests in 137 Suiten, alle 13 nachfolgenden Skriptprüfungen und Diffprüfung. Alle 122 geänderten/neuen Dateien blieben über diesen Lauf hashgleich; danach wurden ausschließlich die beiden Abschlussberichte ergänzt. Nichts ist gestaged, der Basiscommit ist unverändert. Das erste fokussierte Typecheck-Fehlerprotokoll bleibt korrekt als Initialfehler archiviert; der erfolgreiche Gesamtgate bestätigt den finalen Stand unabhängig davon.

Von 46 Reviewbefunden sind damit 42 im Code umgesetzt, einer als überholt korrigiert und drei zurückgestellt. Kein Befund ist mehr teilweise umgesetzt. Offen bleiben OS-11 (Onboardingschritte), AS-11 (Detailnavigation) und CE-09 (Erinnerungskontext und Datenschutzentscheidung); diese gehören nicht zu P15–P17. Die Korrektur von TX-01 wird nicht als neue Produktänderung gezählt.

Der unabhängige Review bestätigt: Fakten bleiben optionale Darstellungsmetadaten; Serien zählen deduplizierte Kalendertage, Fristen bleiben Datum ohne Zeitzonenwechsel. Ungültige vorhandene Fakten nutzen keinen Regex-Rückgriff. Trainingswrapper erhalten die Findings. Interne Berichtszeilen erhalten zusätzliche `facts.*`-Werte; die bestehenden PDF-Ansichten lesen weiterhin ihre expliziten Feldpfade, CSV die Eintragsfelder. Keine neue Persistenz oder externer Exportpfad.

Nachweise im Gesprächsordner: [Gesamtprüflauf](C:/Users/veron/.codex/visualizations/2026/10/15/01a14034-a8b5-77b2-b0e1-6cfcd4126913/implementation/P15-P17/verify-fast.log), [Abschlussstatus](C:/Users/veron/.codex/visualizations/2026/10/15/01a14034-a8b5-77b2-b0e1-6cfcd4126913/implementation/P15-P17/verify-fast-result.json), [Hashabgleich](C:/Users/veron/.codex/visualizations/2026/10/15/01a14034-a8b5-77b2-b0e1-6cfcd4126913/implementation/P15-P17/verified-source-evidence.json), [Reviewprotokoll](C:/Users/veron/.codex/visualizations/2026/10/15/01a14034-a8b5-77b2-b0e1-6cfcd4126913/implementation/P15-P17/review.md), [P17-Befundkorrektur und Auswahltests](C:/Users/veron/.codex/visualizations/2026/10/15/01a14034-a8b5-77b2-b0e1-6cfcd4126913/implementation/P15-P17/P17/verification.md), [iPhone-Fälle](C:/Users/veron/.codex/visualizations/2026/10/15/01a14034-a8b5-77b2-b0e1-6cfcd4126913/implementation/P15-P17/iPhone-Abnahme.md).

Alle 15 neuen iPhone-Fälle sind offen und nicht durchgeführt. Kein Commit, Push, App-Build oder OTA; TestFlight Build 5 wurde nicht aktualisiert.
