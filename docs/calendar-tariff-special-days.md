# Tarifliche Sondertage im Kalender

## Auftrag und Abnahme

Ziel: Im bestehenden Monatskalender gesetzliche Feiertage und tarifliche Sondertage unterscheiden, ohne weitere Eingaben. Markierungen stammen ausschließlich aus der zentralen Sollzeit-Engine und dem vorhandenen Berechnungsprofil einschließlich historischer Grenzen. Plattform: iOS-Preview, bestehendes Kartenlayout, Tagesfenster und VoiceOver.

Nicht-Ziele: neue Tarifansprüche, Kalenderneugestaltung, neue Einstellungen, Widgets oder native Änderungen. Dateiscope: Kalender-Feiertagshook, neuer reiner Anzeigeadapter mit Tests, Monatskarte, gemeinsame Monatsfläche, deren Canvas, Prototyp-Einstieg, Tagesfenster-Aufrufer sowie zugehörige Komponententests sowie diese und die bestehende Integrationsdokumentation (maximal 14 Dateien).

Abnahme: 24./31. Dezember im passenden TVöD-K-Profil als tariflicher Sondertag; 25./26. weiterhin ausschließlich gesetzliche Feiertage. Andere/unbekannte Tarife, historische Lücken, deaktivierte Feiertagsanzeige, volle Zellen und Zugänglichkeit prüfen. Keine Änderung von Soll-/Ist-/Gehaltswerten. Fokussierte Tests, verify:fast, iOS-Export, PR-CI und reale iPhone-Abnahme vor Merge.

## Darstellung

Tarifliche Sondertage erhalten vor dem Namen ein offenes Rautensymbol (◇). Im Tagesfenster und für VoiceOver bleibt die vollständige Bezeichnung „tariflicher Sondertag“ erhalten. Die Anzeige nutzt die vorhandene Beschriftungsfläche; bei vollen Zellen bleibt die Bezeichnung über das Tagesfenster und VoiceOver erreichbar. Die Feiertagsanzeige blendet beide Beschriftungsarten gemeinsam aus.

Die Kalenderauflösung hält gesetzliche Feiertage und tarifliche Sondertage in getrennten Maps. Sie übernimmt lediglich bereits berechnete Sondertagspositionen, berechnet keine eigenen Tarifansprüche und schreibt keine Daten. Fehlerhafte oder nicht verfügbare Berechnungsangaben erzeugen einen sichtbaren Verfügbarkeitshinweis statt erfundener Markierungen. Prognosen bleiben Prognosen; eine Markierung bestätigt keine individuelle Freistellung.

## Prüfung

Acht gezielte Adaptertests, 52 betroffene Komponententests und Typecheck bestanden. Geprüft sind unter anderem beide Monatsrenderer, das vorhandene Anzeigeverhalten, zugängliche Tagesnamen, volle Zellen, historische Tarifgrenzen und Fehlerfälle. Der lokale iOS-JavaScript-/Asset-Export mit APP_VARIANT=internal ist erfolgreich; die native Integration wurde nicht geändert.

Vollständiges Qualitätsgate, CI-Nachweise, endgültige Testzahlen und Preview-Lieferstand werden im [zugehörigen PR #313](https://github.com/vladularu/LUNA-Shift/pull/313) und im Abschlussbericht dokumentiert. Die reale iPhone-Abnahme wurde am 26.10.2026 vom Nutzer bestätigt: „Oke funktioniert, weiter du hast alle Freigaben“. Zugeordnet ist die zuvor verifizierte Preview-Gruppe 2b8935fb-173e-495d-ba37-b0176fcfd780; Gerätemodell/Viewport und installierte Update-ID wurden nicht erneut abgelesen. PR #313 wurde daraufhin mit sieben erfolgreichen CI-Gates gemergt (9cfbb51). Diese Abnahme betrifft die Kalenderdarstellung dieser Lieferung, keine späteren Tarifpakete. Export und Komponententests sind kein Gerätenachweis.
