# Korrektur D: Kaltstart und Wiederverwendung

## Auftrag und Grenzen

- Plattform: iOS Preview, Expo SDK 57 (~57.0.31), eigene bereits autorisierte Preview-OTA; Luftig bleibt erhalten.
- Ziel: weniger wiederholte Vorbereitung gleicher Monatsgehälter und Wiederverwendung gültiger Jahres-Netto-Ergebnisse nach Prozessneustarts.
- Nicht-Ziele: andere Finanzformeln, Tarif-/Steuerregeln, Layout, Nutzerdaten-Migration, nativer Build, Production oder TestFlight. Commit und GitHub erst nach Nutzerabnahme.
- Separater Korrekturscope D: zwei bestehende App-Dateien, ein neues Cache-Modul, fokussierte Tests, dieses Dokument und das Quellenregister (unter 15 Dateien). Vorherige offene Pakete B/C bleiben erhalten.

## Umsetzung und Sicherheitskriterien

- Begrenzter, unveränderlicher Monatsspeicher: vollständige wirksame Profil-/Dienst-/Referenzdienst-/Tarifentscheidungs-/Arbeitsmuster-Inhalte und Resolver-Identität. Nur erfolgreiche Berechnungen speichern; keine Änderung von Anwendungseingaben.
- Jahres-Netto in bestehendem lokalen SQLite-Ergebnisspeicher, eigene Periodenkennung. Keine Backup-/Cloud-Synchronisation des abgeleiteten Speichers.
- Wiederverwendung nur bei identischen vollständigen Eingaben, Regelkatalog und OTA-Version. Alle zwölf geordneten Monate, Cent-Beträge, Status, Hinweise und daraus nachgerechnete Summen müssen stimmen.
- Bestehende Größen-/Zeitgrenzen, Prüfsummen, konkurrierende Schreibgenerationen und Datenbank-Epochen bleiben wirksam. Defekte oder fehlende Ergebnisse führen zur normalen Berechnung.
- Eine neue OTA oder tatsächlich geänderte Eingaben können eine Erstberechnung benötigen; danach soll ein unveränderter Neustart das gespeicherte Ergebnis laden.

## Abnahme

- Hell/Dunkel, Luftig: kalter Start, Monatsauswertung, Jahres-Netto öffnen; nach fertiger Berechnung App vollständig beenden und erneut öffnen.
- Gleiche Beträge und Monate, kein erneutes langes Durchrechnen bei unveränderten Eingaben. Jahreswechsel und geänderte Dienste/Netto-Einstellungen müssen aktuelle Werte zeigen.
- Vorherige Korrekturen bleiben prüfbar: App-Umschalter zurückkehren, unveränderte Daten ohne Flackern, stabile Höhe der Netto-Karte.
- Geräteabnahme offen. Automatische Prüfungen und synthetische Laufzeiten ersetzen sie nicht.

## Technischer Liefernachweis (07.11.2026)

- `verify:fast` erfolgreich: 10450 Unit-Tests, 1904 Komponententests und alle ergänzenden Repository-Prüfungen.
- Fokussierte Prüfungen auf Preview und Feature: 82 Finanz-/Cache-Tests, 35 Lebenszyklus-Komponententests und 77 integrierte Gehalt-/Netto-UI-Fälle. Die künstlichen Rechner-Mocks erhalten je Test einen eigenen Resolver; die unterschiedlichen abgenommenen Layout-Erwartungen der Checkouts bleiben erhalten.
- Neustart-Nachweis: neuer Resolver und neuer persistenter Cache lesen ein zuvor berechnetes Jahresergebnis, ohne einen weiteren Berechnungsjob zu planen. Zusätzlich reale SQLite-Lese-/Schreibtests mit neuer Repository-Instanz, Datenänderungen, OTA-/Katalogwechsel, beschädigten Summen und veralteten Schreibversuchen.
- Synthetischer Vergleich: identische Monatswerte und Jahressumme, 1192 statt 897 Vorbereitungsschritte vor/nach der Änderung. Median der Hauptthread-CPU in abwechselnden kalten Node-Prozessen: 1453 ms vorher, 1438 ms nachher. Das belegt weniger wiederholte Vorbereitung, aber keine wesentliche Beschleunigung der gesamten Erstberechnung. Der wesentliche Neustart-Vorteil ist das Überspringen der gültig gespeicherten Jahresberechnung. Keine iPhone-Zeitmessung.
- Korrektur D: zehn Dateien einschließlich Tests, Dokument und Quellenregister; drei App-Dateien und eine erfasste Pflicht-Testdatei gegenüber C. Mit den offenen Änderungen B/C zusammen 28 Dateien. Kein Commit/Push.
- Preview-Quellfingerabdruck: `cc3cb4319875fc33e602c6ed21e31eb53bcdd57bc1f7cdfa2830046c5d4ac7fb`. Vor und nach dem Export identisch, Luftig erhalten.
- Eigene Preview-OTA-Gruppe `3ac1d021-71fa-4ee0-9226-5da31d85cc19`, iOS-Update `01a1b3c9-00f7-77f9-99bb-37fe6b70ea25`.
- Unveränderte native Runtime `402e757d98ca799660ce5dd15a24bd999cf690eb`. Live-Bundle und alle 34 Assets bytegenau zum Export bestätigt. Bundle-SHA256 `fb9edc2b393b3694a720437394f1759b4257501b956e393eb506e8dae0f9b991`.
- Die monatliche vollständige Auszahlungsprognose behält ihre bestehende erneute Prüfung; ein vollständiger persistenter Auszahlungs-Codec gehört nicht zu dieser Korrektur. Monatsgrundlagen werden innerhalb der Laufzeit wiederverwendet; Monatsauswertung und Prüfungen behalten ihren bestehenden persistenten Speicher.
- Geräteabnahme offen: nach Installation der OTA Jahres-Netto einmal fertig berechnen lassen, App vollständig beenden und unverändert neu starten; danach Dienste/Netto-Angaben ändern und auf aktuelle Werte prüfen. Zusätzlich Rückkehr aus dem App-Umschalter und stabile Kartenhöhe in Hell/Dunkel.
- Veröffentlichung nur auf Preview. Commit und GitHub-Abgleich erst nach Nutzerabnahme.

## Geräteabnahme und Git-Freigabe (07.11.2026)

> Ja passt jetzt auch nach dem Neustart in Hell und Dunkel. Die Korrekturen sind abgenommen, bitte committen und mit GitHub abgleichen. Luftig weiterhin beibehalten.

Die Abnahme gilt für die zuvor offenen Korrekturen B/C/D im veröffentlichten iOS-Preview-Update `01a1b3c9-00f7-77f9-99bb-37fe6b70ea25` (Gruppe `3ac1d021-71fa-4ee0-9226-5da31d85cc19`), einschließlich Neustart in Hell und Dunkel. Der Live-Abgleich bestätigt erneut das geprüfte Bundle und alle 34 Assets. Die bisherigen offenen Abnahmevermerke sind damit erledigt.

Git-Lieferumfang: genau die 28 geprüften Dateien. Feature und separate Luftig-Preview werden jeweils committed und auf GitHub gesichert. Übernahme nach `master` erst nach grüner PR-CI mit erneutem Head-/Basis-/Dateiabgleich und anschließendem Baumvergleich. Die separate Preview-Darstellung bleibt erhalten. Diese Git-Freigabe umfasst keine neue OTA, keinen nativen Build und keine TestFlight-Veröffentlichung.
