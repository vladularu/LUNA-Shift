# Gesammelter Stand als TestFlight-OTA

Auftrag vom 18.10.2026: Alle gespeicherten, weiterhin gültigen LUNA-Änderungen einschließlich der anderen Chats auf die TestFlight-App übertragen. Ziel ist ein OTA für den vorhandenen iOS-Build, ohne frühere Entwürfe über neuere abgenommene Fassungen zu kopieren.

Nicht-Ziele: neuer nativer Build, App-Store-Veröffentlichung, Git-Auslieferung, Änderung von Zugangsdaten oder Aufbewahrungsfristen. Keine Änderungen an persönlichen App-Daten. Der schmutzige Hauptcheckout und die anderen gespeicherten Arbeitsstände bleiben erhalten.

Plattform: Expo SDK 57, TestFlight 0.1.0 (5), Bundle-ID `com.lunashift.app`, Kanal und Branch `production`, EAS-Umgebung `production`, `APP_VARIANT=production`. EAS-Build `1ec474a0-bda0-45eb-89f8-780c94db5632` ist der jüngste fertige Store-Build. Seine Runtime lautet `4a9747e5fdc6a52760d6955a95584cdd1e85607e` und entspricht dem neu berechneten Fingerprint des Gesamtstands aus 145 Bestandteilen.

Arbeitspaket 1: andere Chats und gespeicherte Checkouts ausschließlich lesend abgleichen. 65 registrierte Arbeitsstände wurden inventarisiert; der vollständige Vergleich enthält keine Zugriffsfehler. Dateidifferenzen zu älteren Ständen bedeuten nicht automatisch fehlende Funktionen. Die zuletzt gültigen Nutzerentscheidungen und der aktuelle Hauptstand bestimmen die Fassung.

| Paket                         | Abgleich und enthaltene Fassung                                                                                                                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Texte und Onboarding          | „LUNA-Texte sammeln und prüfen“: veröffentlichte, abgenommene Preview mit kurzen Abläufen, Stunden-/Prozentauswahl, Tarifwahl und einheitlichem Gelb; im Cloud-Gesamtstand weitergeführt.                                                                                            |
| Konto, Cloud, Teilen und Mehr | Aktueller Stand dieses Chats einschließlich automatischem Sync, direkter Mehr-Seite und tatsächlich entfernten Menüs/manuellen Wiederherstellungsfunktionen. Preview-Gruppe `631a40a5-d222-4614-8258-c4c9694a5114` ist vom Nutzer auf dem iPhone bestätigt.                          |
| Widgets und Startlogo         | Am 12.10. gemeinsam vorgemerkt, später über PR #293 (`3651ece`) in den Hauptstand integriert. Build 5 enthält die native Umsetzung; die gelesene TestFlight-Wache dokumentiert die damalige Nutzerabnahme von vier Widgets, Start und Anmeldung. Kein erneuter nativer Einbau nötig. |
| PDF/CSV und Gehaltsansichten  | Gespeicherte Exportarbeit ist in den neueren, geprüften Ansichten enthalten. Das damalige Hindernis des alten Build 33 betrifft den heutigen Build 5 nicht; dessen native Runtime stimmt mit der aktuellen Exportkonfiguration überein.                                              |
| Dialogfarben und Lösch-Haptik | Im Hauptstand über `72fea90` integriert. Aktuell sind `deletionFeedback` in allen drei Löschwegen und die palettenabhängigen Kopf-Farben des Einstellungen-Editors vorhanden.                                                                                                        |
| Dino-Easter-Egg               | Abgenommene Zentrierung aus „Prüfungs-Check-Easter-Egg bauen“, über PR #301 (`5e7b111`) integriert und in der Veröffentlichung erhalten.                                                                                                                                             |
| Tarifpakete                   | „LUNA Shift · Tarifauftrag fortsetzen“ bestätigt die Zusammenführung über PR #287 und das Schließen überholter PRs. Ältere Tarifentwürfe werden nicht erneut über den konsolidierten Hauptstand gelegt.                                                                              |
| Frühere Designs/Versuche      | Rotes Übergangsicon, ältere Onboarding- und Farbvarianten sowie überholte Arbeitskopien bleiben als Sicherung erhalten. Sie ersetzen weder das bestätigte LS-Icon noch die neueren abgenommenen Oberflächen.                                                                         |

Arbeitspaket 2: den bereits zusammengeführten und vollständig geprüften Quellstand im bestehenden Checkout auf Branch `codex/testflight-gesamtstand` für Production vorbereiten. Keine neue App-Codeänderung ist erforderlich. Erlaubter neuer Dateiumfang: diese Dokumentation und der Nachtrag zur Geräteabnahme in `docs/funktionen-entfernen.md`; Prüf- und OTA-Nachweise liegen ignoriert unter `.expo/testflight-all-changes/`.

Der vollständige erfolgreiche `verify:fast`-Lauf des unveränderten App-Codes wird per SHA-256 wiederverwendet: 8.905 Unit-Tests, 1.216 Komponententests und 199 Skripttests. Zusätzlich Production-Release-Prüfung, Produktions-Audit, Umgebungsprüfung, erneute EAS-Bündelung und Auslieferungsprüfung ausführen. Es werden keine Tests durch eine andere Implementierung ersetzt oder als neue Geräteabnahme ausgegeben.

Arbeitspaket 3: nach positiven Prüfungen auf `production` für iOS veröffentlichen. Abnahme: Runtime exakt wie Build 5, unveränderter App-Quellstand, passender öffentlicher Cloud-Client ohne Ausgabe von Schlüsselwerten, korrekter Kanal, neue Gruppe als jüngstes Update, HTTP-200-Manifest sowie übereinstimmende Paketprüfsumme von lokalem Export, Manifest und CDN-Download. Die sichtbare Übernahme in der TestFlight-App bleibt anschließend separat nachzuweisen.

Apple-Statusgrenze: Die neue EAS-Abfrage bestätigt den fertigen Store-Build und dessen Production-Kanal. Die zusätzliche App-Store-Connect-Statusabfrage kann mit den vorhandenen API-Zugängen nicht auf die App zugreifen; ein aktueller Apple-Verarbeitungs-/Beta-Status wird deshalb nicht behauptet. Das OTA richtet sich an den bereits installierten Build 5 und benötigt keine neue Submission oder Credential-Änderung.

## Ergebnis am 18.10.2026

Die Production-Release-Konfiguration und `audit:production` sind erfolgreich. Der Audit verifiziert die vorhandenen Backports und meldet keine unbehandelten hohen oder kritischen Advisories. Die Production-Cloud-Konfiguration ist geprüft; der Client-Schlüssel ist ein öffentlicher Anon-/Publishable-Schlüssel. Werte wurden nicht ausgegeben und keine Zugangsdaten verändert.

Der SHA-256-Abgleich bestätigt, dass der gesamte App-Code exakt dem erfolgreichen vollständigen Testlauf entspricht. Nach diesem Lauf änderten sich ausschließlich die zwei ausdrücklich erlaubten Dokumente. Die Produktionsvariantenprüfung und die erneute EAS-Bündelung sind zusätzlich erfolgreich. Ein weiterer vollständiger Testlauf mit identischem Code war nicht erforderlich.

Am **18.10.2026 um 04:54 Uhr (Europe/Berlin)** veröffentlicht:

- Gruppe: `a88450d2-f9e6-462f-bdfa-f9e2a1dca319`.
- iOS-Update: `01a14cef-02af-7032-a707-31afb5f8d2f5`, erstellt `2026-10-18T02:54:54.639Z`.
- Ziel: installierte TestFlight-App 0.1.0 (5), Build `1ec474a0-bda0-45eb-89f8-780c94db5632`, `com.lunashift.app`.
- Kanal, Branch und EAS-Umgebung: `production`; App-Variante `production`.
- Runtime: `4a9747e5fdc6a52760d6955a95584cdd1e85607e`, exakt wie Build 5; kein Override.
- Der aktive Production-Kanal liefert diese neue Gruppe aus. Vorherige Gruppe: `5e737da5-bf04-44fe-aa30-4bf01eca0c55` mit dem bereits abgenommenen zentrierten Dino.
- Update-Endpunkt: HTTP 200 mit der neuen Update-ID, korrekter Runtime, Bundle-ID und Production-Variante.
- Hermes-Bundle `entry-9f7582090e452e049afb083921557dc2.hbc`, 9.518.852 Bytes und 52 begleitende Assets.
- Lokaler Export, Manifest und tatsächlicher CDN-Download stimmen überein: SHA-256 `64ABFD935BE68A41771863C01E40E7DE80110264E7CC5D2353760360E101B852`. Das Paket ist außerdem bytegleich mit dem zuletzt als Preview ausgelieferten Stand dieses Chats.
- Alle 1.964 erfassten Quelldateien blieben während Veröffentlichung und Auslieferungsprüfung unverändert. Erst anschließend wurde dieses Dokument um die Abschlussnachweise ergänzt.

Nachweise: `.expo/testflight-all-changes/final-proof.json`, `worktree-inventory.json`, `source-proof-after.json`, `fingerprint-preflight.json`, `release-check.log`, `audit-production.log`, `served-proof.json`, `updates-after.json` und `channel-after.json`.

Die OTA-Auslieferung an Build 5 ist bestätigt. Der Nutzer bestätigte am 18.10.2026: „Die OTA ist in TestFlight angekommen, alles funktioniert und sieht gut aus.“ Damit sind die Übernahme sowie die allgemeine funktionale und visuelle Abnahme dieses Gesamtstands auf seinem iPhone bestätigt. Daraus folgt kein gesonderter Nachweis jedes Zwei-Geräte-, Konflikt- oder Kontolöschungsfalls. Für diese OTA wurde kein neuer nativer Build durchgeführt.

## Git-Auslieferung des abgenommenen Gesamtstands

Freigabe am 18.10.2026: „alle änderungen commit push pr und merge“. Ziel ist die vollständige Git-Auslieferung genau des zuvor zusammengeführten und auf TestFlight abgenommenen Stands. Branch `codex/testflight-gesamtstand`, Basis `5e7b111f8103d09c6b84e44d5a957c1f68a3d125`, Checkout `.worktrees/unified-cloud-account`. Plattform: iOS mit Expo SDK 57; automatisierte Plattform-Exporte werden zusätzlich durch die PR-CI geprüft.

Arbeitspaket 1: den vorhandenen Gesamtumfang anhand der vorigen Quellmanifeste abgleichen, TestFlight-Abnahme festhalten und die bereits auf `master` vorhandenen URI-Decoder-Sicherheitsprüfungen in den Paket-Skripten erhalten. Die frühere Zusammenführung hatte deren Aufrufe entfernt; diese Skriptänderung wird vor der Git-Auslieferung vollständig zurückgenommen. Abhängigkeiten und Lockdatei bleiben gleich.

Arbeitspaket 2: die bestehenden Änderungen für Konto, automatische private Cloud, Teilen, Mehr, Texte, Onboarding, Auswertung, Vorlagen und Gehalt einschließlich Tests, Assets, additiver Servermigration und Dokumentation als explizites Dateimanifest einfrieren, lokal prüfen und nur diesen Umfang committen und pushen. Andere Checkouts und überholte Entwürfe bleiben unberührt. Die bereits vorhandenen Arbeitspakete der jeweiligen Funktionsdokumente bilden die fachliche Aufteilung; dies ist keine erneute Implementierung dieser Funktionen.

Arbeitspaket 3: Pull Request gegen `master` erstellen, vollständige PR-CI einschließlich `quality-gates` abwarten, an den geprüften Head gebunden mergen und den gemergten Dateibaum mit dem eingefrorenen Manifest vergleichen. Abnahme: unveränderte App-Quelldateien gegenüber der abgenommenen OTA, erhaltene Sicherheitsprüfungen, erfolgreiche lokale und PR-Gates, exakter Commit-/PR-Umfang und nachgewiesene Master-Parität.

Nicht-Ziele: weitere OTA, neuer nativer Build, Store-Submission, Änderung von Zugangsdaten oder Live-Serverdaten. E-Mail-Anmeldung und eigene Domain bleiben pausiert. Neue Änderungen sind ausschließlich auf die erhaltenen Paket-Skripte und diese Abnahme-/Auslieferungsdokumentation begrenzt; der bestehende Gesamtumfang wird unverändert geliefert. Prüf- und Dateimanifeste liegen ignoriert unter `.expo/git-delivery/`.
