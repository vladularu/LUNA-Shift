# Bereitschaft: Gehalt prüfen

Ziel: Ein unvollständig abgerechneter Sonderdienst lässt bekannte Gehaltsbestandteile sichtbar. Ein kompakter Prüfhinweis führt direkt zum betroffenen Dienst und dessen Abrechnungsfeldern.

Plattform: bestehende Expo-SDK-57-App, iPhone zuerst. Keine native Änderung, keine neuen Abrechnungsregeln, keine automatische Tarifumstellung, keine Freigabe für Git- oder OTA-Auslieferung aus diesem Auftrag.

Die Änderung wird wegen des Dateiumfangs in drei Arbeitspakete geteilt:

1. Fachlogik und Export: bekannter Teilbetrag bei unvollständigen Sonderdiensten, korrekte Zuordnung zu Anspruchs-/Auszahlungsmonaten; vollständiges Netto und Jahressonderzahlung bleiben an vollständige Grundlagen gebunden.
2. Korrektur: direkter Editor-Einstieg; ausdrückliche gemeinsame Übernahme auf ausgewählte passende Bereitschaften desselben Beschäftigungszeitraums. Zeiten, Pausen, Einsätze und individuelle Dienstnummer bleiben erhalten. Gemeinsames Speichern ist atomar und revisionsgesichert.
3. Darstellung: vorhandene LUNA-Karten, Aktionszeilen und Auswahl-Sheets; „Bekanntes Brutto“ und konkrete Hinweise statt einer gesperrten gesamten Gehaltskarte.

Dateiscope: Gehaltsmodell/-berechnung und zugehörige Tests; Salary-/Analysis-/Export-Verbraucher; bestehender Tageseditor, Navigation und Persistenzport für atomare Korrekturen; explizite Quellfreigaben im bestehenden Review-Manifest. Unabhängige Änderungen bleiben unangetastet.

Abnahme: Regression mit gespeichertem TVöD-Dienst im TV-L-Profil; sichere Teilbeträge einschließlich versetzter Auszahlung; kein vollständiges Netto/keine vollständige Jahressonderzahlung aus Teilbeträgen; direkter Dienstlink; Auswahl und atomare Übernahme mit unveränderten Dienstdaten; aufgabenspezifische Tests und verify:fast. Visuelle iPhone-Abnahme bleibt separat.

Quelle: exakte veröffentlichte Preview, Gruppe 436aa83f-60e8-4b9a-b7d2-38cebb318fce; 1202 Quelldateien vor Änderung, Digest 3ecbc1badebd4b8900a67b6075268ca5171534459dd79bb935b1064ab2662e3c. Branch codex/bereitschaft-gehalt-pruefen.
