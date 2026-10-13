# Kalenderfreigabe: Oberfläche und TDD-Nachweis

Stand: 12.10.2026. Teilpaket des genehmigten Kalenderfreigabe-Plans. Scope: dieser Feature-Ordner sowie die neuen Routen `app/calendar-sharing.tsx` und `app/sharing-invite.tsx`.

## Anwendungsschnittstelle

`SharingUiProvider` erhält einen echten `SharingController` aus der Anwendungsschicht. `useSharingUiController` liefert ihn an die dünnen Routen. Ohne Provider oder Cloud-Einrichtung zeigen die Routen einen freundlichen Nicht-verfügbar-Zustand. Test-Doubles werden ausschließlich in Tests verwendet.

Die Oberfläche startet weder Login noch Veröffentlichung oder Einladung beim Rendern. Authentifizierung, RPCs, lokale Zuordnung, Cache, OS-Teilen-Menü und Kontolöschung gehören der Anwendungsschicht. Der UI-Vertrag enthält absichtlich keinen Rohfehler, keine E-Mail-Adresse, kein Zugriffstoken und keine Serverkonfiguration.

Termine sind standardmäßig nicht ausgewählt. Auswahl erfolgt ausdrücklich pro Termin und wird als ID-Liste übergeben. Titel erscheinen nur im lokalen Auswahlbereich; der veröffentlichte Termintitel muss von der Anwendung als neutraler Titel projiziert werden. Die Vorschau verwendet ausschließlich deren Freigabeansicht.

Ein Einladungsergebnis wird nur nach einer erfolgreich ausdrücklich angeforderten Annahme angezeigt. Token-Wechsel setzt diesen lokalen Status zurück. Die Route wird nach dem streng validierten Token neu montiert; doppelte oder ungültige Parameter führen zu keiner Annahme. Links werden niemals durch GET oder beim Rendern verbraucht.

## TDD-Verlauf

- Erst neue Journey-Tests und UI-Typvertrag, anschließend erster RED-Lauf: fehlendes `calendar-sharing-screen` (fehlende Implementierung).
- Implementierung: erste GREEN-Abnahme mit 14 Komponentenfällen.
- Erweiterung um Routen, Termin-Einwilligung, Fehler-/Busy-Zustände und Provider-Grenzen: 24 Fälle.
- Zusätzlicher Laufzeit-RED: ein frischer Einladungslink zeigte das vorige Ergebnis. Ergebnis: 1 fehlgeschlagen, 10 bestanden. Danach lokale Ergebnisbindung und Zurücksetzen beim Token-Wechsel implementiert.
- Letzte GREEN-Abnahme: 25 Fälle in zwei Suites bestanden, keine übersprungen.
- Keine Checkpoint-Commits: laut Teilaufgabe bleibt Git-Delivery dem Hauptagenten vorbehalten.

## Prüfungen

```text
npm.cmd run test:components -- --runTestsByPath src/features/sharing/calendar-sharing.component.test.tsx src/features/sharing/sharing-ui-boundaries.component.test.tsx --coverage --collectCoverageFrom=src/features/sharing/*.tsx --coverageThreshold='{}'
```

Ergebnis: PASS, 2 Suites, 25 Tests. Eigener UI-Scope: 89,63 % Statements, 88,05 % Branches, 89,87 % Functions, 92,90 % Lines. Bestehende Projekt-Schwellen wurden nicht geändert; der gezielte Lauf isoliert diese neuen Dateien.

```text
npx.cmd eslint src/features/sharing app/calendar-sharing.tsx app/sharing-invite.tsx --max-warnings 0
```

Ergebnis: Exit 0, keine Warnungen. Eigene Dateien mit Prettier formatiert.

| Garantie                                                                               | Nachweis                                   |
| -------------------------------------------------------------------------------------- | ------------------------------------------ |
| Login bleibt optional, Provider nur durch explizites Drücken                           | `calendar-sharing.component.test.tsx`      |
| Fehlende Cloud-Konfiguration täuscht keinen erfolgreichen Login/Freigabe vor           | beide Suites                               |
| Kalendername, Farbe und Sichtbarkeit werden vor der Freigabe bestätigt                 | `calendar-sharing.component.test.tsx`      |
| Termine werden nur nach ausdrücklicher Auswahl aufgenommen                             | `sharing-ui-boundaries.component.test.tsx` |
| Eigentümer verwalten Anfragen/Zugriff; Leser verlassen oder blenden aus                | `calendar-sharing.component.test.tsx`      |
| Einladung und Widerruf werden ausdrücklich angefordert                                 | `calendar-sharing.component.test.tsx`      |
| Kontolöschung und Abmelden erhalten lokale Daten, destruktive Cloud-Aktionen bestätigt | `calendar-sharing.component.test.tsx`      |
| Einladungsroute verbraucht nichts beim Rendern; ungültige/mehrfache Tokens verworfen   | beide Suites                               |
| Neuer Link übernimmt keinen alten Anfragestatus                                        | `sharing-ui-boundaries.component.test.tsx` |
| Fehler werden kurz sanitisiert, doppelte Login-Anfragen gesperrt                       | `sharing-ui-boundaries.component.test.tsx` |

## Grenzen

Dies beweist die prop-gesteuerte Oberfläche und ihre Interaktion mit dem injizierten Controller. Echte Provider-Anmeldung, Cloud-RLS/Sync, Widgets und Zwei-iPhone-Abnahme sind eigene Integrations-/Geräteprüfungen. Vollständige Typprüfung wurde während paralleler Auth-Implementierung gestartet; nur dort noch unvollständige Dateien meldeten Fehler. Der Hauptagent führt abschließende gemeinsame Typprüfung, Verify und Build aus.

Farben, Flächen, Abstände, Rundungen, Typografie und Textadapter stammen aus dem LUNA-System. Listen sind virtualisiert; die nativen Routen verwenden automatische Inhalts-Safe-Areas. Schriftgröße wird nicht hart begrenzt, Inhalte haben keine feste Zeilenhöhe. Hell/Dunkel, kleine Displays und große Schrift benötigen zusätzlich die reale Geräteabnahme.
