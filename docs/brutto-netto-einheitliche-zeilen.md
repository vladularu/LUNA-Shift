# Gehalt: einheitliche Zeilen und erreichbare Zulagen

## Ziel und Umfang

Die Rückmeldung vom iPhone zeigt zwei Bedienungsregressionen: Der Dienstnachweis
ist hinter einem Erklärungstext verborgen; die Brutto-Zusammensetzung hat ihre
Klickaktionen verloren. Ziel ist ein direkter Zugang und ein gemeinsames
Zeilenmuster aus dem vorhandenen App-Designsystem.

Plattform: iPhone, bestehender Preview-Build. Expo ~57.0.22; versionierte
SDK-57-Dokumentation geprüft. Umsetzung im bestehenden isolierten Branch
codex/brutto-netto-prototype, damit der bereits veröffentlichte Stand erhalten
bleibt.

Dateiscope: SalaryScreen, AutomaticEntryCard, SalarySummary, PremiumDetails,
neue gemeinsame Betragszeile, bestehende Workflow- und Tarif-UI-Komponententests
und dieses Dokument. Kein Eingriff in Berechnungsregeln, Speicherung oder native Integration.
Commit, Push, Build und OTA benötigen einen gesonderten Auftrag.

## Abnahme

- Einzelne Dienste sind direkt aus der Gehaltsübersicht erreichbar, ohne zuerst
  Erläuterungen zu öffnen; auch die Zuschlagstabelle bietet den Zugang sofort.
- Brutto bleibt direkt aufklappbar. Zeitzuschläge, Schicht-/Wechselschichtzulage,
  TVöD-Zulage und Pflegezulage führen wieder zu den vorhandenen Details.
- Betragszeilen verwenden den vorhandenen RowButton mit einheitlicher
  Typografie, Touchfläche und Pfeil bei einer Aktion; Abzüge verwenden dieselben
  Zeilen. Navigationspfeile und Aufklapppfeile unterscheiden die Aktionen.
- Profilgültigkeit, Monatwechsel, Netto-Einrichtung, SFN-Aufteilung und
  Ergebnis-Caching bleiben erhalten.
- Fokussierte Routing-/Workflow-Tests und verify:fast müssen bestehen; der
  Browser-Abgleich mit echten Komponenten ergänzt die spätere iPhone-Abnahme.
