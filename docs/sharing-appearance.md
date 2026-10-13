# Sharing-Darstellung

Ziel: Teilen nur über den Kalender-Header; lokale Kalender-Markierungsfarbe, rote Wochenendtage, deutlichere Farbmarkierung und dezent getönte Texte geteilter Dienste; QR zuerst und ausschließlich natives Teilen; kompakte Einladungen und einheitlicher roter Verlassen-Button.

Plattform: iPhone / Expo SDK 57 / bestehende Build-5-Runtime.

Arbeitspakete: (1) Navigation, (2) lokale Farbpräferenz und Kalenderdarstellung, (3) Freigabeansichten. Dateiscope: Sharing-UI, Sharing-Verträge und lokale Repository-/Runtime-Anbindung, Kalender-Chips und Datumstexte, Tabs und Mehr-Eintrag sowie zugehörige Regressionstests.

Abnahme: kein Teilen-Tab oder Mehr-Eintrag; Header bleibt erreichbar; jede empfangene Freigabe hat eine unabhängige Farbe, die Neustart und Snapshot-Updates übersteht; fremde Dienstfarben bleiben original; Markierung 6 px; lesbare getönte Texte; Sa/So in Monat, Nachbarmonat und Jahr rot, Heute-/Auswahlzustand hat Vorrang; feste Kalendergeometrie bleibt erhalten; QR über einem einzelnen Sonstige-Button; kompakte Links behalten Kopieren, Ablauf, Beitritte und Stop; Kalender verlassen ist ein roter Primärbutton mit Bestätigung.

Keine neuen nativen Module, keine Server-Rechteänderung. Bestehende Konten-/Leserechte und Kalendereinträge bleiben erhalten. Technische Tests und Export ersetzen die visuelle iPhone-Abnahme nicht.
