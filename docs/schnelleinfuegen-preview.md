# Schnelleinfügen: Preview

## Task-Vertrag

- Ziel: Ruhige Platzhalter auf Diensthöhe, Zeiten an der aktiven Vorlage und ein abgestimmter Wechsel von Navigation zu Einfügeleiste.
- Nicht-Ziele: Keine Änderung an Speichern, Entfernen, Tarifberechnung, globalem Design oder nativen Modulen.
- Zielplattform: iOS Preview, bestehender Build 44.
- Dateiscope: Kalenderdarstellung, Vorlagenleiste, zugehörige Komponententests, zwei reine Typkorrekturen für generierte Expo-Typen und diese Notiz; zehn Dateien.
- Freigabe: Umsetzung und Preview-OTA vom Nutzer ausdrücklich freigegeben.
- Abnahme: Große Tages-Tippflächen erhalten; Zeiten aus der tatsächlichen Vorlage; ganztägige Vorlagen ohne erfundene Uhrzeiten; Navigation vollständig verdeckt, bevor die Leiste sichtbar wird; Öffnen und Schließen mit Reduced Motion; Eintragen und Entfernen mehrerer Tage auf dem iPhone.

## Umsetzung

Der gemeinsame Kalender zeigt freie Eintragsplätze unter den Datumsköpfen. Tagesfelder behalten ihre vollständige Tippfläche. Die aktive Vorlage erhält rechts neben Symbol und Namen Beginn und Ende beziehungsweise den Hinweis „Ganztägig“. Die Auswahlleiste berücksichtigt die breitere aktive Vorlage beim Scrollen. Ein synchronisierter Hintergrund verdeckt die Navigation vor dem Einfahren der Leiste und gibt sie beim Schließen anschließend frei.

Die Detailspalte wächst mit der eingestellten Schriftgröße; Vorlagennamen bleiben umbrechbar. Die beim Browserstart generierten Expo-Typen machten zwei Konflikte im unveränderten Ausgangscode sichtbar. `useDataMonth` behandelt die Routensegmente für die Gruppenprüfung als schreibgeschützte Zeichenketten. Der Icon-Adapter reicht seinen bestehenden Style mit dem passenden SVG-View-Typ weiter. Beide Korrekturen ändern ausschließlich die TypeScript-Typisierung.

Die zusätzliche Browserprüfung war durch „Worker chunk not found“ für den Expo-SQLite-Web-Worker blockiert. Der iOS-Export funktioniert. Die visuelle Geräteabnahme bleibt im Preview auf dem iPhone erforderlich.

Expo SDK 57: [Reanimated](https://docs.expo.dev/versions/v57.0.0/sdk/reanimated/), [Updates](https://docs.expo.dev/versions/v57.0.0/sdk/updates/).

## Prüfung

- `npm.cmd run verify:fast`: vollständig bestanden, einschließlich 508 Unit-Testdateien mit 9.838 Tests und 163 Komponenten-Testdateien mit 1.498 Tests sowie sämtlicher zusätzlicher Projektchecks.
- Fokussierte Kalender-/Leistentests und Schriftgrößenprüfung erfolgreich. Geprüft sind tatsächliche Vorlagenzeiten, ganztägige Vorlagen, Nachtdienste, erhaltene Tages-Tippflächen und Auswahl-/Leistenübergänge.
- Die beiden Typkorrekturen erzeugen nach Entfernung der TypeScript-Typen exakt dasselbe JavaScript wie die Ausgangsdateien.
- Interner iOS-Fingerprint stimmt mit Preview Build 44 überein: `b99c3cf0dd56e6b1bb126d195f21c665de57760b`.
- Vollständige lokale Protokolle und Auslieferungsnachweis: `C:/Users/veron/.codex/tmp/quick-entry-audit-20261028/`.
- Die visuelle Abnahme der finalen OTA auf dem iPhone bleibt offen.
