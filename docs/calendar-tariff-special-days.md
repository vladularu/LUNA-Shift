# Tarifliche Sondertage im Kalender

## Auftrag und Abnahme

Ziel: Im bestehenden Monatskalender gesetzliche Feiertage und tarifliche Sondertage unterscheiden, ohne weitere Eingaben. Markierungen stammen ausschließlich aus der zentralen Sollzeit-Engine und dem vorhandenen Berechnungsprofil einschließlich historischer Grenzen. Plattform: iOS-Preview, bestehendes Kartenlayout, Tagesfenster und VoiceOver.

Nicht-Ziele: neue Tarifansprüche, Kalenderneugestaltung, neue Einstellungen, Widgets oder native Änderungen. Dateiscope: Kalender-Feiertagshook, neuer reiner Anzeigeadapter mit Tests, Monatskarte, gemeinsame Monatsfläche, deren Canvas, Prototyp-Einstieg, Tagesfenster-Aufrufer sowie zugehörige Komponententests und diese Dokumentation (maximal 13 Dateien).

Abnahme: 24./31. Dezember im passenden TVöD-K-Profil als tariflicher Sondertag; 25./26. weiterhin ausschließlich gesetzliche Feiertage. Andere/unbekannte Tarife, historische Lücken, deaktivierte Feiertagsanzeige, volle Zellen und Zugänglichkeit prüfen. Keine Änderung von Soll-/Ist-/Gehaltswerten. Fokussierte Tests, verify:fast, iOS-Export, PR-CI und reale iPhone-Abnahme vor Merge.

## Darstellung

Tarifliche Sondertage erhalten vor dem Namen ein offenes Rautensymbol (◇). Im Tagesfenster und für VoiceOver bleibt die vollständige Bezeichnung „tariflicher Sondertag“ erhalten. Die Anzeige nutzt die vorhandene Beschriftungsfläche; bei vollen Zellen bleibt die Bezeichnung über das Tagesfenster und VoiceOver erreichbar. Die Feiertagsanzeige blendet beide Beschriftungsarten gemeinsam aus.

Die Kalenderauflösung hält gesetzliche Feiertage und tarifliche Sondertage in getrennten Maps. Sie übernimmt lediglich bereits berechnete Sondertagspositionen, berechnet keine eigenen Tarifansprüche und schreibt keine Daten. Fehlerhafte oder nicht verfügbare Berechnungsangaben erzeugen einen sichtbaren Verfügbarkeitshinweis statt erfundener Markierungen. Prognosen bleiben Prognosen; eine Markierung bestätigt keine individuelle Freistellung.

## Prüfung

Noch in Arbeit; Geräteabnahme steht aus.
