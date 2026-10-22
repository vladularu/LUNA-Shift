# Auswertung: native Seitenwechsel wie in der Bildschirmaufnahme

Referenz: ScreenRecording_10-21-2026 18-25-12_1.mp4, 6,23 Sekunden, iPhone 14 Pro Max. Die Aufnahme zeigt „Tarif & Gehalt → Stufe“ sowie das langsame native Zurückwischen: Vordergrund und vorherige Seite bleiben gleichzeitig sichtbar; Kopfzeile und untere Zurückleiste bewegen sich mit. Der vorhandene Ablauf verwendet router.push(profileSelectionRoute(...)) und den nativen Expo-Router-Stack.

Ziel: Monats-/Jahreswechsel der Auswertung und Monatswechsel in Gehalt einschließlich Bestandteile verwenden ebenfalls echte native Seiten. Zurückwischen erfolgt über dieselbe iOS-Navigation wie in der Referenz. Die zuvor eingeführte zusätzliche Monats-Schiebeanimation entfällt. Bereits berechnete vorherige Seiten bleiben beim Zurückwischen erhalten. Der Kalender-Heute-Tipp und der Rücksprung zum aktuellen Monat/Jahr bleiben erhalten; der zuletzt aktive Monats-/Jahresmodus wird beim Tab-Rücksprung berücksichtigt.

Plattform: iOS, iPhone 14 Pro Max, Expo SDK 57 (~57.0.22). Native Stack und Gestenpakete sind bereits vorhanden. Keine Änderung an nativen Paketen, Plugins oder Konfiguration.

Arbeitspaket 1: eigener Zeitraum-Route innerhalb des bestehenden Auswertungs-Stacks, getrennte Navigationszustände pro Seite und korrekte Wiederherstellung beim nativen Zurückgehen. Dateiscope: neuer app/(tabs)/(analysis)/period.tsx, bestehendes Stack-Layout, src/navigation/routes.ts, analysis-period-navigation.ts und zugehörige Tests; neuer Auswertungs-Navigationshook.

Arbeitspaket 2: Auswertung an die native Navigation anschließen, zusätzliche Reanimated-Seitenanimation entfernen und konkurrierende Rechtswisch-Behandlung entfernen. Betroffen: analysis-screen.tsx, analysis-month-transition.tsx, analysis-period-swipe.tsx, neuer analysis-scene.tsx samt Tests. AnalysisScene hält auch Jahresberichte hinter einer geöffneten Unterseite sichtbar, während die ausgeblendete Seite ihre Berechnungen pausiert. Die Links-Geste darf weiterhin eine nächste Seite öffnen; die rechte Zurückgeste gehört vollständig dem nativen Stack.

Arbeitspaket 3: Gehalt und Bestandteile verwenden denselben router.push-Ablauf für Monatswechsel; vorherige Berichte werden im Hintergrund eingefroren. Betroffen: salary-screen.tsx, salary-details-screen.tsx, horizontal-back-gesture.ts und zugehörige Tests. Andere Auswertungs-Unterseiten verwenden bereits native Push-Routen; die Suche nach allen moveMonth/moveYear/setParams-Stellen ergab keine weiteren betroffenen fachlichen Auswertungs-Wechsel.

Nicht-Ziele: Berechnungsformeln, neue Servermigrationen, Widgets, Kalendergesten, Änderungen an der im Video gezeigten Referenz oder an globalen nativen Tab-Animationen. Ausgangspunkt ist die exakt geprüfte Preview-OTA aed46c66-ba5b-4b99-949e-7a286fb67ffc mit 2.010 Quelldateien. Unabhängige Arbeitsstände bleiben erhalten.

Abnahme: native Push-Routen statt lokaler Monatsmutation; stufenloses natives Zurückwischen samt Abbruch; korrekte sichtbare Monate/Jahre und Erhalt des Unterbereichs; keine doppelten Schiebeanimationen; kein Hintergrund-Reset des sichtbaren Verlaufs; korrekter aktueller Zeitraum je Monats-/Jahresmodus beim Tab-Tipp. Fokussierte Tests und verify:fast. Die visuellen Eigenschaften und die native Interaktion bleiben bis zum erneuten iPhone-Test offen.

Implementierung dieser Nachkorrektur ist beauftragt. Commit, Push, nativer Build und eine weitere OTA sind hierfür noch nicht gesondert freigegeben.
