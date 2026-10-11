# Netto: durchgehender UI-/UX-Ablauf

## Auftrag

Den gesamten Netto-Ablauf übersichtlich, intuitiv, einfach und hochwertig gestalten.
Referenz sind die iPhone-Rückmeldungen dieser Unterhaltung und die vorhandene
App-Gestaltung. Zielplattform: iPhone; Expo ~57.0.22, SDK-57-Dokumentation geprüft.
Arbeitsbranch: codex/brutto-netto-prototype, bestehender isolierter Checkout.

## Arbeitspakete

1. Monatsüberblick und Nachweise: Netto als visuelle Priorität, ruhige Brutto-/Abzug-
   Übersicht, direkt erreichbare Dienste und Zulagen, gleich aufgebaute Detailköpfe.
   Tatsächlich enthaltene Abzugsposten sofort anzeigen; Grundlagen nach Bedarf.
2. Einrichtung und persönliche Angaben: drei kurze Einrichtungsschritte; bestehende
   Angaben in einem Formular mit drei aufklappbaren Abschnitten. Abschnittswechsel
   erhält ungespeicherte Werte. Eine Speicheraktion führt zurück zum Ergebnis.
3. Prüfung: Routing, gemeinsame Speicherung, Abbrechen, Gültigkeit, Fehlereingaben,
   Sonderfälle und Zukunftsprognosen absichern; echte Komponenten im Browser prüfen.

Erlaubter Dateiscope: net-pay-automatic-entry-card.tsx, net-pay-salary-summary.tsx,
net-pay-premium-details.tsx, net-pay-workflow-controls.tsx,
net-pay-settings-overview.tsx, net-pay-setup-form.tsx, die beiden zugehörigen
Komponententestdateien und dieses Dokument. Falls eine gemeinsame Detailkopf-
Komponente erforderlich wird, gehört sie ebenfalls zum UI-Paket.

Berechnungsregeln, Gehalt, SFN-Klassifikation, Speicherung, Datenmigrationen,
Abhängigkeiten, native Konfiguration und andere App-Bereiche bleiben unverändert.
Keine Git-Veröffentlichung, neue OTA oder neuer Build in diesem Auftrag.

## Abnahme

- Gleiche Abstände, Farben, Schrift- und Auswahlmuster im gesamten Ablauf.
- Ergebnis, Brutto, Abzüge und Zuschlagsaufteilung sind ohne Fachwissen verständlich.
- Dienste und tarifliche Zulagen bleiben direkt erreichbar.
- Einrichtung bleibt bei drei Schritten, mit nur relevanten Pflichtfeldern.
- Persönliche Angaben öffnen ohne Unterseiten oder weitere Dialoge; aufklappbare
  Abschnitte behalten sämtliche Änderungen bis zum gemeinsamen Speichern.
- Schließen verwirft ungespeicherte Änderungen; Speichern ist gegen Doppeltaps
  gesperrt. Fehlereingaben führen zum zuständigen Abschnitt.
- Positive Abzugsposten sind sichtbar; versteckte Nullbeträge verändern keine Summe.
- Große Schrift, schmale Breite, Hell/Dunkel und Touchflächen werden geprüft.
- verify:fast und gezielte Tests bestehen. Browsernachweis ersetzt keine iPhone-Abnahme.

## Korrektur: kompakte Angaben im Designsystem

Referenz: die drei Browserbilder mit Steuer-, Familien- und Versicherungsangaben.
Ziel: weniger verschachtelte Flächen und Rahmen, ein ruhiges Formular im Stil des
Arbeitsprofils. Plattform: iPhone, zusätzliche Browservorschau mit echten Komponenten.
Scope dieser Korrektur: net-pay-settings-overview.tsx,
net-pay-workflow-controls.tsx, net-pay-setup-form.tsx und dieses Dokument.

- Die drei Abschnitte bilden eine gemeinsame Liste mit CardSeparator und RowButton.
- Eine Auswahl bekommt die dezente Hervorhebung des appweiten SegmentedButton;
  die zusätzliche farbige Auswahlwanne entfällt. Touchflächen bleiben mindestens 44.
- Eingabefelder übernehmen Field ohne eigene Farb-/Rahmenüberschreibung.
- Die Krankenversicherungsübersicht benötigt keine zusätzliche farbige Karte.
- Speicherung, Gültigkeit, Sonderfälle, Berechnungen und Navigation bleiben gleich.
- Bestehende Workflowtests und verify:fast müssen bestehen; Browserprüfung umfasst
  Hell/Dunkel, schmale Breite und große Schrift. iPhone-Abnahme bleibt separat.
