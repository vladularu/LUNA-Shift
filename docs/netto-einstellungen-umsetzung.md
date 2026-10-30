# Netto-Einstellungen: Einstieg B, Einstellungsseite A

## Task-Vertrag

- Ziel: Hervorgehobene Netto-Karte direkt unter der Prognose; ein Tap öffnet eine eigene, durchgehend scrollbare Einstellungsseite mit offenen Formularabschnitten.
- Nicht-Ziele: Keine Änderung von Berechnung, Tarifregeln, Profilhistorie, Datenformat, nativer Konfiguration, Abhängigkeiten oder globalem Designsystem.
- Zielplattform: iOS, Abnahme auf dem iPhone; kleine Ansichten, große Schrift, Tastatur sowie Hell- und Dunkelmodus berücksichtigen.
- Umfang: Netto-Einstieg, lokales Netto-Formular und seine Abschnitte, neue Route und Bildschirm, Navigation/Stack-Konfiguration sowie zugehörige Tests. Bei mehr als 15 Dateien wird in getrennte Arbeitspakete geteilt.
- Abnahme: Direkter Einstieg ohne Bereichsübersicht; vier offene Abschnitte; ein Gültigkeitsmonat; gemeinsames Speichern; Schutz ungespeicherter Angaben; korrekte Monatsübergabe und Fortbestand bestehender Validierung.
- Gerätenachweis: Screenshots der Gehaltsseite, Formularanfang und gescrollten Abschnitte sowie Prüfung von Tastatur und Zurückwischen im passenden iOS-Preview-Build.
- Freigabe: Implementierung am 29.10.2026 mit „ja so umsetzen“. Commit, Push, EAS Build, EAS Update und Store-Veröffentlichung sind separat freizugeben.

## Gestaltung

Die erste Seite stammt aus Konzept B: eine hervorgehobene Karte **Netto-Einstellungen** mit Zusammenfassung und **Angaben ansehen & ändern** direkt unter dem Netto-Ergebnis.

Die Einstellungsseite stammt aus Konzept A: **Steuern**, **Familie**, **Versicherung & Vorsorge** und **Weitere Angaben** stehen als offene Abschnitte auf einer Seite. Zutreffende Eingabefelder sind sofort bedienbar. Nur längere Erklärungen lassen sich aufklappen. **Änderungen gelten ab** steht einmal oben; **Änderungen speichern** bleibt erreichbar.

Die bestehende Unterscheidung zwischen Kinderzahl und Kinderfreibetrag, die Kennzeichnung unbekannter Zusatzversorgung sowie die Hinweise für nicht unterstützte Versicherungs- und Beschäftigungsfälle bleiben erhalten. Erste Einrichtung und spätere Änderungen verwenden weiterhin die vorhandenen Gültigkeits- und Speicherroutinen.

## Validierung

- Basis: frisch abgerufenes `origin/master`, Commit `57274497540c3bee1753a99d9c17b47532cec8bc`; Branch `codex/netto-einstellungen`.
- Expo SDK 57 (`expo ~57.0.31`); zur Umsetzung die SDK-57-Dokumentation und die tatsächlich installierten Router-Exporte geprüft.
- Fokussierte Komponentenprüfung: 84/84 Tests erfolgreich. Darunter direkter Einstieg, vier offene Abschnitte, gemeinsames Speichern, Gültigkeitsmonat, Zusatzversorgung, native Abbruchrückfrage und Schreibkonflikte.
- Fokussierte Navigation: 42/42 Tests erfolgreich, einschließlich validierter Monatsroute und Zurückwischen.
- Vollständiges `verify:fast` am 30.10.2026 erfolgreich: 511 Fachtestsuiten mit 9.906 Tests, 166 Komponententestsuiten mit 1.564 Tests, Regelvalidierung, Typprüfung, Lint, Formatierung und alle weiteren Repository-Prüfungen.
- Lokaler iOS-JavaScript-Export mit `APP_VARIANT=internal` erfolgreich: 4.648 Module gebündelt; kein Upload und kein nativer Build. Die technische Bündelprüfung ersetzt keine iPhone-Abnahme.
- Der Änderungsstatus des Hauptcheckouts entspricht weiterhin dem zu Beginn erfassten Status. Der isolierte Scope umfasst 13 Dateien einschließlich Tests und Dokumentation.
- Prüfnachweise liegen lokal unter `artifacts/netto-verify-fast.log`, `artifacts/netto-focused-tests.json` und `artifacts/netto-export-ios.log`.
- Die initiale Implementierung wurde zunächst ohne Veröffentlichungsauftrag geprüft. Die anschließende Preview-Auslieferung und die spätere Freigabe sind unten dokumentiert.

## Preview und Abnahme am 30.10.2026

- Auswahl unverändert: Einstieg aus Konzept B, scrollbare Einstellungsseite aus Konzept A.
- iOS-Preview-OTA: Gruppe `b3a31097-2905-4614-932b-0847bb626ff0`, Update `01a18a20-a443-73b1-bc60-5b509a75ed54`, Kanal/Environment `preview`, `APP_VARIANT=internal`.
- Runtime passend zu Preview Build 44: `b99c3cf0dd56e6b1bb126d195f21c665de57760b`. Manifest, ausgeliefertes Bundle und 52 Asset-Hashes stimmten mit dem lokalen Export überein.
- Die Veröffentlichung erhielt die inzwischen vorhandenen Sonderdienst- und Kalenderänderungen. Der Netto-Scope blieb separat im Branch `codex/netto-einstellungen` mit 13 Dateien.
- Auf der kombinierten Preview-Basis bestanden 85 fokussierte Netto-Tests, 10.031 Unit-Tests nach serieller Wiederholung, 1.621 Komponententests und alle 14 nachgelagerten Gates. Die danach unverändert übernommene Kalender-Version brachte drei bereits dokumentierte Test-Zeitüberschreitungen mit; diese gehören nicht zur Netto-Änderung.
- Nutzerabnahme des Netto-Flows: „ja das passt vorerst.“ Das ist die Preview-Abnahme; konkrete iPhone-/iOS-Versionen und zusätzliche Einzelzustände werden daraus nicht abgeleitet.
- Anschließender ausdrücklicher Auftrag: „commit push pr merge und testflight ota“. Damit sind die Git-Auslieferung über PR und erfolgreiche CI sowie eine kompatible iOS-OTA für den bestehenden TestFlight-Build freigegeben.
- Eine spätere Bestätigung in TestFlight bleibt separat offen. Die Veröffentlichung allein ist keine Geräteabnahme der Beta.
