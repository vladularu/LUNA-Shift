# Jahres-Netto: kompakte Übersicht

- Ziel: zusätzlichen Einleitungskasten „Netto-Prognose“ entfernen; Monate ohne berechenbares Netto in der Jahresliste ausschließlich als „Nicht verfügbar“ darstellen. Jahr in der verbleibenden Netto-Karte erhalten.
- Nicht-Ziele: Berechnung, Summen, Monatsabdeckung, Netto-Einstellungen, Monatsdetails, Jahresgehalt, globale Gestaltung oder native Integration ändern.
- Plattform: bestehende iOS-Preview Build 49, Kanal preview, APP_VARIANT=internal. Luftig erhalten.
- Scope: annual-net-pay-view.tsx, bestehender Jahresansichtstest, gezielte Quellenfreigabe und dieses Dokument.
- Expo: ~57.0.31; Referenz https://docs.expo.dev/versions/v57.0.0/.
- Abnahme: kein zusätzlicher Einleitungskasten; fehlende Monate kompakt mit „Nicht verfügbar“, vorhandene Werte unverändert; beide Arten von Monatszeilen öffnen ihre bisherigen Details. Jahr, Teilsumme und Hinweise der Summenkarte bleiben sichtbar. Hell/Dunkel prüfen.
- Prüfung: gezielter Jahresansichtstest und vollständiges verify:fast auf der tatsächlichen Preview-Quelle, identischer Korrekturumfang auf dem Funktionsbranch, iOS-Export und Quellen-/Runtime-/Bytevergleich.
- Freigabe: Korrektur mit eigener Preview-OTA im bestehenden Abnahmeablauf. Kein Commit oder GitHub-Abgleich vor Nutzerabnahme.

Geräteabnahme steht aus.

## Preview-Auslieferung

Die obere Einleitungskarte entfällt. Die verbleibende Summenkarte trägt das Jahr. Nicht berechenbare Monate zeigen nur Nicht verfügbar; ihre ausführlichen Hinweise bleiben in der Monatsansicht erreichbar. Verfügbare Monatswerte und deren Hinweise sowie Summe und Abdeckung bleiben unverändert.

Vollständiges verify:fast auf der Luftig-Preview-Quelle bestanden: 10.419 allgemeine Tests und 1.862 Komponentenfälle. Zusätzlich 14 fokussierte Jahresansichtsfälle auf dem Funktionsstand; Implementierung und Testdatei beider Stände bytegleich. Die Quellenprüfung bestätigt jeweils genau eine geänderte App-Datei gegenüber Paket 5.

- Preview-Gruppe: 6ba159cd-bd92-48b6-9fdd-21c07a2768bd
- Update-ID: 01a1b32e-9517-7be7-87dc-3d6e179cac7c
- Runtime: 402e757d98ca799660ce5dd15a24bd999cf690eb
- Quellfingerprint: 0e56cf51a0c939e1aa8ba9456ae92d383b10f69baf278f90cca343ae130b864a
- Bundle-SHA256: e261ea8f2386f6bc59b1fc4577a26f5ee137c4d990e15cf244a29ec87f2557a5
- Bundle und 34 Assets bytegenau geprüft.

Geräteabnahme in Hell/Dunkel steht aus. Kein Commit, Push oder TestFlight.

## Abnahme am 7. November 2026

Der Nutzer bestätigt den aktuellen Preview-Stand mit „ja passt“. Diese Rückmeldung gehört zu Paket A einschließlich der darin erhaltenen kompakten Jahres-Netto-Ansicht, Preview-Gruppe 25138531-70b1-433a-b4d1-20751a897159, Update 01a1b354-e158-7e24-b90e-09c0eed1f6e5. Die zuvor offene Geräteabnahme dieses Stands ist damit abgeschlossen.

Vor dem Commit wurden die Live-OTA einschließlich Bundle und aller 34 Assets, alle 2.420 Dateien des Kandidatenarchivs sowie die Prüflog-Hashes erneut abgeglichen. Der vereinbarte Ablauf erlaubt jetzt Commit und GitHub-Abgleich dieses Pakets. Die separate Luftig-Quelle wird ebenfalls gesichert; der Feature-Stand wird ausschließlich nach grüner PR-CI integriert. Paket B erhält anschließend eine eigene Preview-OTA und bleibt bis zu seiner Abnahme uncommittet.
