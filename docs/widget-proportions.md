# Einheitliche Widget-Gestaltung

## Auftrag

Die Proportionen des Zweiwochenwidgets gelten jetzt auch für 6 Tage und 4 Wochen. Der kleine Monatskalender übernimmt die Gestaltung als kompaktes Monatsraster. Kalenderfoto, Farben, Theme-Einstellung und Öffnen der Kalenderstartseite bleiben erhalten. Keine Kalenderwochen und keine zusätzlichen Eintragszähler.

## Darstellung

Alle Varianten verwenden 12 pt horizontalen und 10 pt vertikalen Innenrand sowie dezente Wochenendflächen (0,18 Deckkraft im Vollfarbmodus). Dienstwidgets zeigen gleich hohe Reihen, eine ausgerichtete Dienstkarte pro Tag, Tageszahlen mit 14 pt und einer Heute-Markierung von mindestens 28 × 20 pt, 8 pt Abstand zur Karte, Dienstschrift bis 11 pt und Textzeilen bis 13 pt. Die separate Namensfußzeile entfällt in allen Größen; geteilte Dienste bleiben durch den Personenfarbstreifen und VoiceOver erkennbar.

Der kleine Monatskalender muss 28, 35 oder 42 Tageszellen aufnehmen. Er nutzt dieselben Farben, Ränder, Heute-Kapsel und abgerundete Dienstmarkierungen. Tageszahlen passen sich der tatsächlichen Zeilenhöhe an (bis 14 pt); pro Tag gibt es ein 10 × 3 pt großes Farbzeichen. Vollständige Dienstkarten passen nicht in dieses kleine Monatsraster. Titel, Start- und Endzeit sowie die Person bleiben über VoiceOver lesbar.

## Dienstvorrang

Ein eigener eingetragener Dienst hat Vorrang; auch ausdrücklich eingetragenes Frei oder Urlaub zählt als eigener Eintrag. Gelöschte Einträge zählen nicht. Ist ein eigener Dienst über die Anzeigeoption ausgeblendet, wird er nicht durch einen fremden ersetzt.

Nur an Tagen ohne eigenen Dienst erscheint ein geteilter Dienst: der mit dem frühesten Beginn; bei Gleichstand entscheiden Kalender-ID und Eintrags-ID stabil. Ausgeblendete, entfernte und abgelaufene Freigaben bleiben ausgeschlossen. Es gibt keine +1-/+N-Anzeige, keine KW-Anzeige und keine Namensfußzeile. Bei mehreren eigenen Einträgen zeigt die Dienstkarte den ersten nach bestehender Kalendersortierung. Die vollständigen Daten bleiben in der App verfügbar; dort wird die Darstellung nicht geändert.

Diese Regel gilt in den Daten für 6 Tage, 2 Wochen, 4 Wochen und Monat. Native Darstellung und Expo-Fallback bevorzugen eigene Einträge auch beim Lesen älterer gemischter Snapshots. Sämtliche Widget-Tipps öffnen weiterhin die Kalenderstartseite.

## Umfang und Preview

Die Änderungen setzen auf dem gesicherten Quellstand von Preview 42 auf. Die frühere Beschränkung auf das Zweiwochenwidget, KW und Zusatzanzahlen ist durch diesen Folgeauftrag aufgehoben. Die Umsetzung betrifft den nativen Renderer, isolierten Expo-Fallback, Widget-Datenprojektion und zugehörige Tests/Dokumentation. Netto-Funktionen und Kalender in der App bleiben unverändert.

Das Layout ist Teil der kompilierten Widget-Erweiterung und benötigt einen weiteren nativen Preview-Build. Build 42 enthält die vorherige Zweiwochenfassung. Änderungen werden zuerst in Preview am iPhone geprüft; Beta-Übernahme erfolgt gesammelt nach eigener Freigabe. TestFlight-Gruppen, Details und öffentlicher Link werden nicht geändert.

## Abnahme

Automatisch: Vorrangregeln in allen Rastern, mehrere Freigaben, gelöschte und versteckte eigene Dienste, exakter Freigabeablauf, Monate mit 4/5/6 Reihen, native Plugin-Integration und isolierter Expo-Runtime-Test in allen Dienstgrößen/Light/Dark/Tinted. Zusätzlich verify:fast.

Nach freigegebenem Preview-Build am iPhone: alle vier Ansichten mit und ohne Foto, mit eigenem/geteiltem/leerem Tag, Heute-Markierung, Wochenende, lange Dienstnamen, Zeiten, Light/Dark/Tinted und VoiceOver. Keine KW/Zähler; überall Öffnen der Kalenderstartseite. Automatische Tests ersetzen weder Swift-Kompilierung noch diese Sichtabnahme.

Referenz: [Expo Widgets, SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/widgets/).

## Farbabgleich nach Preview 43

Geteilte Dienstkarten verwenden wie die Kalenderansicht `sharedCalendarChipPalette`: gedämpfte, dienstfarbene Schrift auf dem getönten Hintergrund, getrennt für Light und Dark. Die Widget-Datenprojektion hatte zuvor die normale Palette mit neutraler Schrift geliefert. Eigene Dienste behalten ihre bisherige Palette. Personenstreifen und Kalenderfoto bleiben erhalten.

Die Korrektur betrifft nur die übergebenen Farbdaten; der native Renderer von Build 43 liest diese Farben bereits. Bei identischem Runtime-Fingerprint kann sie nach Freigabe per Preview-OTA geprüft werden. Am iPhone den geteilten Dienst mit der App vergleichen (Light/Dark und Foto), einschließlich aktualisierter Widget-Daten. Eine Beta-Veröffentlichung bleibt separat freizugeben.
