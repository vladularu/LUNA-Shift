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

## Preview-OTA vom 28.10.2026

- [Veröffentlichte Preview](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/6cb951e8-f8cd-498e-92fd-e744284c3901), iOS, Environment und Kanal `preview`, `APP_VARIANT=internal`.
- Code-Commit: `8399a3f3533231d7caa86401b004afefe41164c4`. Der ausgelieferte Quellstand stimmt mit dem gesicherten Manifest überein.
- Update-ID: `01a183bc-2a2b-7676-b881-5cc8b4e203dd`; Runtime passt zu Build 44.
- Der echte Preview-Kanal liefert dieses Update. Manifest und CDN-Bundle antworten mit HTTP 200; das ausgelieferte Bundle ist bytegleich zum lokalen Export und entspricht dem Manifest-Hash.
- Bundle SHA-256: `5f7982b8cfc9929e669d8b910753867d3f5ce46929aab0e0f4f168d4e8da44ab`.
- Geräteabnahme: Preview vollständig schließen, öffnen und rund 15 Sekunden warten, erneut schließen und öffnen. Anschließend Vorlagenauswahl, Uhrzeiten, mehrere Einträge, erneutes Antippen zum Entfernen und den Leistenwechsel prüfen.
