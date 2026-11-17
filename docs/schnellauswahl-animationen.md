# Mittige Schnellauswahl mit fünf sichtbaren Plätzen

## Auftrag und Referenz

Ziel nach dem erneuten Gerätefeedback: Die angetippte Vorlage rückt mit ihrer rechts geöffneten Uhrzeit gemeinsam in die Mitte. Beim Abwählen schließt die Uhrzeit; die Vorlage bleibt als mittlerer von fünf Diensten an der neu erreichten Stelle. Kein Rücksprung zum ursprünglichen Anfang. Das luftige LUNA-Aussehen und die bereits tiefer gesetzte iOS-Leiste bleiben erhalten. Die fünf Plätze bestimmen die sichtbare Größe, keine festen Fünferseiten.

Verbindliche aktuelle Referenz: die drei Supershift-Fotos vom 17. November 2026, 05:02, Anhang `98F63163-ED21-422D-AE39-6FD260D04737` (590 × 1280). Foto 1 zeigt fünf vollständige Dienste, ND ganz rechts. Foto 2 zeigt die Gruppe aus ND und Uhrzeit mittig; die äußeren Dienste sind dabei teilweise sichtbar. Foto 3 zeigt nach dem Abwählen ND mittig, mit BR/Tagdienst links und Schule/Urlaub rechts. Die frühere Forderung nach unverändertem linken Anker und seitenweisem Einrasten ist durch dieses Feedback ersetzt. Unverändert entfällt die verspätete zweite Zentrierung nach der Breitenanimation.

## Scope und Grenzen

Basis: bereits abgenommener und nach GitHub gelieferter Commit `6703c37a`. Lokaler Branch `codex/schnellauswahl-animationen`. Expo SDK 57 (`~57.0.32`), React Native 0.86.3, Reanimated 4.5.1. Referenzen: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/reanimated/) und [ScrollView 0.86](https://reactnative.dev/docs/0.86/scrollview).

Dateiscope: `calendar-layout.ts` samt Test; `quick-entry-action-strip.tsx` samt neuem Komponententest und kleinem Raster-Helfer samt Test; `quick-planner-dock.tsx` samt bestehendem Test; genaue Kandidaten-Hashes im TestFlight-Quellvergleich, die verkleinerte Altlastenliste in `design-token-usage.test.ts` und diese Notiz. Elf Dateien. Keine Änderungen an Farben, Rundungen, Badge-/Schriftgrößen, Dienstpersistenz, Widget-Zurückstellung, Berechnungen, nativen Modulen oder Abhängigkeiten. Die bestehende Aufklapp-/Einblendbewegung der Kachel bleibt erhalten.

Ein vollständiger Platz ist ein Fünftel der tatsächlich gemessenen Leistenbreite. Die Zeitspalte belegt im Normalfall einen Platz; bei größerer Systemschrift entsprechend ganze zusätzliche Plätze. Die native Leiste kann mit einem Wisch beliebig viele Einträge zurücklegen und rastet pro Eintrag ein. Anfang und zugeklappte Ruheposition zeigen fünf vollständige Dienste, sofern mindestens fünf vorhanden sind. Bei zentrierter geöffneter Gruppe sind Randanschnitte wie in Foto 2 ausdrücklich Teil der neuen Referenz.

Beim Auswählen wird die gemeinsame Mitte von Dienst und Zeitspalte mit genau einem animierten Scrollauftrag angesteuert. Beim Abwählen wird die Mitte des Dienstes allein angesteuert. Bei fünf Plätzen bedeutet die Referenz für den fünften Dienst: Öffnen um 2,5 Plätze nach links, Schließen um einen halben Platz zurück; die neue zugeklappte Position liegt damit zwei Plätze weiter als der Start. Am tatsächlichen Listenanfang/-ende wird auf die vorhandenen Inhalte begrenzt. Hat der Nutzer inzwischen selbst gewischt, wird beim Abwählen nicht zur alten Auswahl zurückzentriert. Rasche Auswahlwechsel verwenden absolute Zielpositionen und sammeln keine Versätze an.

Die Inhaltsbreite reserviert nur den maximal nötigen Platz für die Zeitspalte, ohne Auffüllen auf Fünferseiten. Dadurch muss iOS beim Einklappen nicht den aktuellen Scrollversatz wegen schrumpfender Inhalte korrigieren. Nur einzelne Positionen mit tatsächlichem Inhalt sind Rastpunkte; ungenutzter Platz am Ende wird schon beim Loslassen beziehungsweise am Ende einer Bewegung begrenzt. Eine Größenänderung erhält die erreichte Eintragsposition oder die ausgewählte Mitte und wartet auf die neuen Inhaltsmaße. Die bereits veröffentlichte iOS-Absenkung um vier logische Punkte bleibt unverändert; ebenso Höhe, Breite, Rundung und Tippflächen.

## Abnahme und Lieferung

- Genau eine Zentrierung der geöffneten Gruppe und eine der zugeklappten Vorlage; kein zusätzlicher zeitgesteuerter Scrollauftrag.
- Bildfolge 1 → 2 → 3 wird geometrisch nachvollzogen; beim Abwählen kein Rücksprung zum Anfang. Manuelles Wischen hebt die automatische Bindung an die Auswahl auf.
- Fünf sichtbare Rasterplätze; Wischen über einzelne Einträge statt Fünferseiten. Offene Randanschnitte entsprechen Foto 2. Alle Vorlagen bleiben erreichbar.
- Rasche Auswahlwechsel, erster/letzter Dienst, Größenänderungen, größere Systemschrift und reduzierte Bewegung bleiben bedienbar.
- Leisten- und Schließen-Ziel bleiben erreichbar; iOS-Absenkung vier Punkte, keine globale Safe-Area- oder Android/Web-Verschiebung.
- Gezielte Tests und `npm.cmd run verify:fast`; anschließend echte iPhone-Abnahme der Positionen und Bewegung.

Ausgangspunkt war die Preview-OTA `01a1e776-bef9-7d16-9429-d0a2516e1028`, deren Bewegung der Nutzer als besser, aber noch nicht passend bewertet hat. Die Korrektur wurde anschließend ausdrücklich als Preview-OTA freigegeben und veröffentlicht.

Abgenommen ist die Internal-/Preview-OTA `01a1e86b-846b-7e07-a503-fea5e906cfa4`, Gruppe [`f6e854f4-003c-4057-b866-d1ae18ea2afa`](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/f6e854f4-003c-4057-b866-d1ae18ea2afa), für iOS Build 54 mit Runtime `642bfaefe006b4d4d3114c76973debf29b16036d`. Am 17. November 2026 bestätigte der Nutzer nach der Veröffentlichung: „Wunderbar Chat so wie gewünscht gute Arbeit“. Diese Geräteabnahme bezieht sich auf die hier beschriebene Schnellauswahl und ihre Bewegung.

`verify:fast` bestand mit 11.131 Funktions- und 2.143 Komponententests; die gezielten Prüfungen bestanden mit 39 Geometrie-/Designprüfungen und 44 Komponentenprüfungen. Der ausgelieferte iOS-Bundle-Hash ist `0996eee9111cd7053b08cb75baf781cc289d1db5a69e5c02f418dc568b66e112`; alle 34 Assets wurden gegen den Export geprüft. Der abgenommene App-/Asset-Quellstand hat den Digest `a865591662290da803f4cfc8f9afb905e3cf320f10b2696a519b0204fcc3c18b`.

Mit derselben Rückmeldung wurden Commit, Push, Pull Request und Merge nach erfolgreicher CI ausdrücklich freigegeben. Die Git-Lieferung umfasst zusätzlich den bereits akzeptierten Performance-Commit `6703c37a`. Der App-/Testcode bleibt gegenüber der Geräteabnahme unverändert; ergänzt werden diese Abnahmedokumentation und die zugehörigen Review-Begründungen. Eine neue OTA, ein nativer Build oder eine TestFlight-Veröffentlichung gehören nicht zu dieser Git-Lieferung. Die akzeptierte TestFlight-Baseline bleibt unverändert.
