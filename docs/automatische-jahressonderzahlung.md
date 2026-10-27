# Automatische Weihnachtsgeld-Prognose: Preview-Korrektur

## Task-Vertrag

Ziel: Tarifprognose ohne Vorschlagsknopf, Bestätigung oder Speichern; kompakte Gehaltsansicht und nachvollziehbare Reihenfolge der Auswertung.
Nicht-Ziele: Keine Änderung von Tarifanspruch, Regeljahren, Entwurfstarifen, nativen Modulen oder Produktionsveröffentlichung. Kein Commit oder Push.
Plattform: Expo 57.0.22, iOS Preview Build 41, Kanal und Umgebung preview.
Basis: Veröffentlichte Preview-Gruppe eb1c965d-5640-4a53-baa4-14b373655147; alle 1.979 Quelldateien vor Änderung per SHA-256 bestätigt.
Branch: codex/automatische-jahressonderzahlung im vorhandenen isolierten Preview-Worktree.

Arbeitspaket 1: Gemeinsamer abgeleiteter Tarifwert für Gehalt, Monats-/Jahresauswertung und Export; eigener Jahressteuer-/SV-Rechenweg bleibt erhalten.
Arbeitspaket 2: Kompakte Karte mit Betrag und Anpassen, bestehendes Bottom Sheet mit einem Betragsfeld und Speichern. Zusatzangaben eingeklappt. Reihenfolge Komponenten, Weihnachtsgeld, Brutto geschätzt, Netto.
Dateiscope: src/features/salary/{annual-salary-forecast*,use-annual-salary-forecast*,use-automatic-net-pay*,annual-salary-payment-editor*,net-pay-automatic-entry-card*,net-pay-salary-summary*,salary-detail-views*,salary-details-screen*,net-pay-automatic-screen.component.test.tsx}; src/features/analysis/{analysis-screen*,analysis-net-pay-row*,annual-salary-payments*,use-annual-salary-payments*,dashboard-cards*,analysis-rule-coverage.component.test.tsx}; src/features/report-export/report-export.test.ts und report-data.ts; Test-Kontext in src/features/settings/check-settings-screen.component.test.tsx; diese Dokumentation und Aktualisierung der bestehenden Fachnotiz.

## Rechenannahmen und Vorrang

Die belegten 2026-Tarifvorschläge werden im regulären Zahlungsmonat automatisch abgeleitet, ohne einen Datenbankeintrag anzulegen. Grundlage sind die ausgewählte Gehaltsbasis und vorhandene Dienste/Zulagen im Tarifreferenzzeitraum, voller Jahresanspruch und für Netto gleichbleibendes laufendes Entgelt sowie SV seit Januar. Ausführliche Grundlagen sind in den Gehaltsdetails verfügbar. Die Nettoprognose kennzeichnet weiterhin die offene Zusatzversorgung.

Gespeicherte eigene Jahreszahlungen ersetzen die automatische Jahresplanung, einschließlich einer Absage mit 0 Euro. Damit erzeugt eine Verschiebung nach Dezember keine zweite Novemberzahlung. Andere Jahre bleiben unabhängig; bestehende Raten und Abrechnungswerte bleiben erhalten. Bei Verschiebung einer gespeicherten Rate wird der ursprüngliche Monat revisionssicher auf 0 korrigiert. Testdaten, unbekannte Jahre und ungeprüfte Tarifgruppen erzeugen keinen automatischen Betrag.

## Abnahme und Auslieferung

Automatisiert zu prüfen: November ohne Klick/Speichern, Centbetrag im getrennten Netto-Pfad, Monats-/Jahres-/Exportgleichheit, kein Wiederholen in Dezember/Folgejahr, Vorrang manueller Beträge/Nullen, geschlossener kurzer Dialog, Änderungen/Abbrechen, Reihenfolge und erhaltene Fehlernavigation. verify:fast und Release-Check vor Preview-OTA.

Die bestehende Freigabe gilt für iOS-Preview-OTA. iPhone-Sichtprüfung der Korrektur bleibt nach Verteilung offen; die Nutzerfotos bestätigen den vorherigen Stand und begründen diese Änderung. Keine Aussage über eine Geräteabnahme allein anhand von Tests oder EAS-Metadaten.

## Korrektur eigener Altbeträge beim Tarifwechsel (27.10.2026)

Ein im Weihnachtsgeld-Dialog bestätigter eigener Betrag ersetzt weiterhin die dynamische Tarifprognose. Ein eigenes TVöD-P-Weihnachtsgeld darf daher nicht als neu berechneter Ausbildungsbetrag erklärt werden. Die Berechnungsgrundlagen unterscheiden nun gespeicherten Betrag und aktuellen Tarifvergleich. TVA-L Pflege § 16 verwendet 95 Prozent des November-Ausbildungsentgelts ohne Zulagen; TVAöD Pflege § 14 verwendet 90 Prozent des berücksichtigungsfähigen August-Oktober-Entgelts. Beide Primärquellen wurden vor dieser Korrektur erneut gelesen.

Bloßes Öffnen und unverändertes Speichern einer automatischen Prognose legt keinen eigenen Betrag mehr an. Für bereits gespeicherte eigene Beträge gibt es im bestehenden Weihnachtsgeld-Bereich „Automatisch nach Tarif berechnen“. Dieser ausdrückliche Wechsel entfernt nur die eigenen Zahlungsbeträge des gewählten Auszahlungsjahres aus allen vorhandenen Netto-Profilständen. Der vollständige Verlauf wird in einer Transaktion auf konkurrierende Änderungen geprüft; nach Reload entsteht wieder die dynamische Prognose. Andere Jahre und Steuer-/SV-Angaben bleiben erhalten. Es gibt keine automatische Löschung gültiger eigener Beträge oder Nullabsagen beim Tarifwechsel.

Regression des Nutzerfotos: TVA-L Jahr 3, November 2026, Ausbildungsentgelt 1613,00 Euro → 1532,35 Euro Weihnachtsgeld bei vollem Jahresanspruch, statt des früher gespeicherten Betrags 3818,16 Euro. Bei den übrigen auf dem Foto unveränderten Bestandteilen ergäbe dies 3493,31 Euro Brutto. Das individuelle Netto wird neu berechnet; ein Betrag wird ohne die gespeicherten Steuerangaben nicht behauptet. SQLite-Rundlauf, atomarer Rollback, Testlabor-/Konfliktschutz, Backup/Restore, unverändertes Speichern und Monat/Jahr/Export werden gezielt geprüft. Kein Schema-, Backup-, SDK- oder Native-Wechsel. Interne iPhone-Abnahme des neuen Rückkehr-Ablaufs bleibt vor Merge erforderlich.
