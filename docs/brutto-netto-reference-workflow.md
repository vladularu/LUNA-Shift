# Netto: Abgleich mit den drei Workflow-Referenzen

## Auftrag und Abnahme

Ziel ist die Darstellung der bereitgestellten Entwurfsansichten in der iPhone-App:
„Meine Netto-Angaben“ startet mit drei kompakten Zeilen; Abschnittsbearbeitung und
Rückweg bleiben im selben Sheet. „Deine Abzüge“ zeigt zuerst Summe und fünf
Hauptposten. „Deine Zeitzuschläge“ zeigt echte Beträge pro Zuschlagsart mit
steuerfreiem und steuerpflichtigem Anteil. Ergänzende Informationen werden erst
auf Anfrage eingeblendet. Alle drei Ansichten haben einen Schließen-Knopf oben.

Bestehende Monatsgültigkeit, Konfliktbehandlung, Ersteinrichtung, Sonderfälle,
vorläufige Jahresprognosen und die direkt aufklappbare Bruttozusammensetzung bleiben
erhalten. Keine Steuerregeländerung, native Abhängigkeit oder Veröffentlichung.
Expo-Version vor Änderungen: ~57.0.22; SDK-57-Dokumentation für Safe-Area geprüft.

## Getrennte Arbeitspakete

1. Berechnungsnachweis: Zuschlagsarten explizit aus allen vorhandenen Tarifspuren
   weiterreichen und die bereits berechnete SFN-Freigrenze centgenau je Art
   aufschlüsseln. Bestehende Gesamtbeträge und Freigrenzen unverändert lassen.
   Umfang: Domain-SFN-Typen, SFN-Klassifikation, gemeinsame Tarifspur, automatische
   Prognose, fünf Tarifspuren und gezielte Klassifikationstests.
2. Darstellung: Angaben-Übersicht und Abschnittsrückweg, kompakte Abzüge,
   Zuschlagstabelle, optionaler Header-Schließen-Knopf im gemeinsamen Sheet.
   Umfang: Entry-Card, Salary-Summary, NetPaySheet, neue Angaben-/Zuschlagsansichten,
   SelectionSheet und betroffene Komponententests.

Abnahmekriterien: keine gestapelten Dialoge; keine sofortige Formular-/Tabansicht
beim Öffnen der Angaben; Zusatzinformationen standardmäßig verborgen; echte
Zuschlagsarten statt aus Beispieldaten übernommener Zahlen; Zeilensummen stimmen
mit den vorhandenen Ergebnissen überein; Speichern, Abbrechen und Monatwechsel
erhalten ihre Verträge; bestehende Sheet-Verbraucher behalten den Standardaufbau.

Verifikation: gezielte Berechnungs-/Komponententests, verify:fast sowie visueller
Browser-Abgleich der echten Komponenten. Die iPhone-Abnahme bleibt anschließend
erforderlich; ein Browserbild ersetzt sie nicht. OTA, Commit, Push und Build
gehören nicht zum Auftrag dieses Korrekturlaufs.
