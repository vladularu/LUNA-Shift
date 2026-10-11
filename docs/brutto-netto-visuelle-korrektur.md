# Netto: Abgleich mit dem freigegebenen Entwurf

Die sechs iPhone-Screenshots vom 10.10.2026 zeigen, dass die veröffentlichte Version den Ablauf übernommen hat, die visuelle Umsetzung aber deutlich vom freigegebenen `netto-workflow.html` abweicht. Grundlage der Korrektur sind dieser Entwurf und die Rückmeldung des Nutzers. Die Gestaltung der bisherigen Version ist nicht abgenommen.

Ziel: die vorhandene Monatsübersicht und drei Einrichtungsschritte näher am Entwurf darstellen. Brutto und Abzüge ohne graue Unterkarten, steuerfreie Zuschläge grün mit dynamischem Anteilsbalken, persönliche Angaben als Zeilen mit getrennten Titel- und Wertzeilen. In der Einrichtung: klar sichtbare Auswahl, Fortschritt, kompakte Versicherungszeile mit „Ändern“, Zusatzversorgung erst nach Öffnen der Auswahl, eine gemeinsame Weiter-/Zurück-Leiste. Abbrechen erfolgt über die Dialog-Schließaktion.

Plattform: iPhone, bestehender Preview-Build. Installiert ist Expo SDK 57 (`~57.0.22`); die [SDK-57-Dokumentation zur Modal-Safe-Area](https://docs.expo.dev/versions/v57.0.0/sdk/safe-area-context/) wurde vor der Änderung verwendet. Safe-Area-Provider und tastatursicherer Scrollbereich bleiben erhalten.

Scope: `net-pay-automatic-entry-card.tsx`, `net-pay-salary-summary.tsx`, `net-pay-setup-form.tsx`, `net-pay-sheet.tsx`, neue lokale `net-pay-workflow-controls.tsx`, zugehörige Komponententests und dieses Dokument. Bestehender Branch `codex/brutto-netto-prototype`; Ausgangsstand aller Dateien in `artifacts/net-pay-visual-fidelity-before.json`. Keine Änderungen an globalen UI-Komponenten, Steuer-/Tarifberechnungen, Persistenz, Abhängigkeiten oder nativer Konfiguration. Commit, Push und neue OTA sind nicht freigegeben.

Abnahme: vorhandene Detailaktionen, drei Schritte, gezieltes Bearbeiten, historische Gültigkeit und gespeicherte erweiterte Angaben erhalten. Unbekannte Zusatzversorgung und vorläufige 2027-Ergebnisse bleiben am Betrag erkennbar. Mindestens 44 Punkte große Trefferflächen; umbrechende Zeilen für größere Schrift. Fokussierte Workflow-Tests und `npm.cmd run verify:fast`; danach separate iPhone-Abnahme anhand neuer Screenshots.

## Visueller Abgleich

| Bereich                   | Vorher auf dem iPhone                                               | Lokale Korrektur                                                                                               |
| ------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Kennzahlen                | Graue Unterkarten für jeden Betrag; „ca.“ ebenso groß wie Netto     | Offene Zahlenzeilen unter dem Netto; kleineres „ca.“; zurückhaltende Trennlinie                                |
| Zuschläge                 | Drei gleich gestaltete graue Felder                                 | Gesamtbetrag in der Kopfzeile, steuerfreier Anteil grün, dynamischer Anteilsbalken und direkte Detailaktion    |
| Auswahl                   | Kleine umrandete Chips mit schwacher Auswahlmarkierung              | Breitere Felder; aktive Antwort mit Akzentrahmen und Akzenttext; ausgewählter Zustand auch für Screenreader    |
| Versicherung              | Zwei sichtbare Beitragsoptionen und sechs Kassenbuttons             | Kompakte Versicherungszeile mit „Ändern“; Kassenoptionen erst nach Öffnen des Auswahlfelds                     |
| Aktionen                  | Weiter, Zurück und Abbrechen als große gestapelte Buttons           | Eine gemeinsame Aktionszeile; Abbrechen über die einzelne Schließaktion im Dialogkopf                          |
| Dialoge und Einstellungen | Doppelte Überschriften; lange Buttontexte und doppelte Monatsangabe | Überschrift folgt dem Schritt; Einstellungen mit getrennten Titel- und Wertzeilen; Gültigkeit knapp formuliert |

Die Anpassungen verwenden bestehende Typografie-, Radius-, Farb- und Abstands-Tokens. Globale UI-Komponenten und das native Projekt bleiben unverändert. Die Dialoganimation berücksichtigt „Bewegung reduzieren“.

Browser-Abgleich mit tatsächlich importierten React-Native-Komponenten und synthetischen Beispieldaten: Ergebnis, Steuer-Auswahl, vollständiger Weg bis Schritt 3, ZVK-Auswahl und unbekannte Zusatzversorgung; hell und dunkel. Für diese isolierte Vorschau wurden unbenutzte native Widgets und Animationen ersetzt. Die Browseransicht belegt weder die native iOS-Sheet-Höhe noch Tastatur, Safe-Area oder Dynamic Type auf dem iPhone. Neue Geräteabnahme und OTA stehen aus.

Die 25 gezielten Workflow-Komponententests bestehen, einschließlich Abbrechen ohne Speichern, erneutem Öffnen bei Schritt 1, Erhalt gespeicherter Angaben und der kompakten Auswahl.

## Technische Prüfung

`npm.cmd run verify:fast` auf dem endgültigen Quellstand erfolgreich: 8.219 Unit-Tests und 887 Komponententests sowie Regel-, Typ-, Lint-, Format-, Operator- und Runtime-Prüfungen bestanden. Zusätzlich 25 gezielte Workflow-Tests erfolgreich. Der lokale Kontextgraph ist aktualisiert.

Gegenüber dem Ausgangsstand sind ausschließlich die acht angegebenen Dateien geändert beziehungsweise ergänzt; unabhängige Änderungen sind erhalten. Die sieben geprüften Quell-/Testdateien stimmen mit ihren gespeicherten SHA-256-Hashes überein. Nachweise: `artifacts/net-pay-visual-fidelity-verification.json`, `artifacts/net-pay-visual-fidelity-verify-fast-final.log`, `artifacts/net-pay-visual-fidelity-focused-final.log`. Keine neue OTA und keine Git-Veröffentlichung; die neue iPhone-Darstellung ist noch nicht abgenommen.
