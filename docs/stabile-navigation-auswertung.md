# Ruhige Navigation und stabile Auswertung · 03.11.2026

Ziel: Die zwei konkret gefilmten Übergänge korrigieren: nachträgliches Umfärben
der nativen Tab-Leiste nach dem Start sowie Zwischenwerte und Höhenwechsel der
Gehaltskarte beim Zurückkehren in die Auswertung.

Basis: 2.402 hashgeprüfte Quelldateien des veröffentlichten Preview-Updates
`068b9a0c-b36f-4f98-a9d9-b1d1b4825107`, iPhone Build 49, Runtime
`402e757d98ca799660ce5dd15a24bd999cf690eb`. Eigener Branch
`codex/stabile-navigation-auswertung`; Remote-master ist weiterhin `c56c2ff`.
Expo `~57.0.31`, Router `~57.0.29`; Referenzdokumentation SDK 57.

Nicht-Ziele: Änderungen an Logos, App-Icon, Onboarding, endgültiger Karten- oder
Kalendergeometrie, Tarifen, Berechnungsformeln, Datenbank oder nativen Abhängigkeiten.
Die zwei Videos zeigen unterschiedliche Abläufe: kalter Kalenderstart und Rückkehr
über den iOS-App-Umschalter. Die Geräteabnahme beider Korrekturen bleibt erforderlich.

## Paket 1 · Native Navigation

Dateiscope: `src/navigation/app-tabs.native.tsx` und der bestehende Tab-Test.
Der installierte Router unterstützt `unstable_nativeProps`; er reicht `colorScheme`
an den vorhandenen react-native-screens-Tab-Container durch. Dieser Container erhält
von seinem ersten Render an den Modus der LUNA-Palette. Der globale Fenster-Override
und das bestehende stabile Startlogo bleiben davon getrennt.

Abnahme: Hell und Dunkel jeweils auch bei entgegengesetztem iPhone-Systemmodus;
Tab-Material und Symbole erscheinen sofort im LUNA-Modus und ändern sich nach dem
Logo-Fade nicht mehr. Datum, Tab-Aktionen und Systemmodus bleiben funktionsfähig.

## Paket 2 · Vollständige Monatsanzeige

Dateiscope: `src/features/analysis/analysis-screen.tsx` und der bestehende
Integrationstest für Monatsauswertung und echte Regelberechnungen.
Die bestehende Monatsanzeige wird erst mit vollständig vorbereiteter Gehaltsprojektion
freigegeben. Das gilt auch für die Lücke, in der die SQL-Eingaben noch laden und deshalb
noch kein Berechnungsauftrag existiert. Währenddessen hält die vorhandene
`AnalysisMonthTransition` die bisherige vollständige Seite. Eine neue Seite ohne
vollständigen Stand zeigt den Ladezustand; Fehler müssen die Sperre ebenfalls beenden.

Abnahme: Nach Rückkehr bleibt der vollständige Stand desselben Monats sichtbar,
bis die aktuelle Zahlungsprojektion fertig ist. Keine Zwischenanzeige erarbeiteter
Zuschläge als ausgezahlte Zuschläge. Monat, Gehalt, Sonderzahlungen und Netto wechseln
gemeinsam. Keine veralteten Werte eines anderen Monats, keine dauerhafte Sperre bei
einem Fehler. Unterschiedliche Beträge der Karten „Zuschläge erarbeitet“ und „Gehalt“
bleiben fachlich korrekt möglich.

Gezielte Regressionstests und `npm.cmd run verify:fast` müssen bestehen. Für eine
spätere Vorschau werden iOS-Export, Quellstand und Runtime geprüft. Umsetzung ist
freigegeben; Commit, Push, neuer Build und Veröffentlichung dieses neuen Updates
benötigen nach `AGENTS.md` jeweils eine eigene Freigabe.
