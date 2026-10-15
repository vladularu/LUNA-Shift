# Bestätigte Dino-Darstellung als TestFlight-OTA

Auftrag: Den vom Nutzer auf dem iPhone bestätigten Pixel-Dino sowie die zentrierte
Anordnung von Dino, Texten und geöffnetem Spiel mit Punktestand in der TestFlight-App
bereitstellen. Freigabe: „Bring das bitte auch als OTA für die TestFlight-App.“

Plattform: iOS, LUNA Shift 0.1.0 (5), Production-Kanal, bestehende Runtime
4a9747e5fdc6a52760d6955a95584cdd1e85607e. Expo ~57.0.22, versionierte Dokumentation:
https://docs.expo.dev/versions/v57.0.0/sdk/updates/.

Basis: bisheriger TestFlight-Stand 95f949e im isolierten Branch
codex/dino-testflight-ota, zuletzt ausgelieferte Gruppe
5ccced7e-471c-4e32-a24b-8b0b5af480c5. Der Nutzer hatte Spiel, Beschleunigung und
Rekordspeicherung bereits in TestFlight bestätigt. Die neue gemeinsame Zentrierung
ist in der Preview-Gruppe f66a75a5-0d64-449f-8aff-3520d6261a61 bestätigt.

Scope: vier vorhandene Render-/Komponententestdateien und diese Notiz. Sämtliche
zehn Feature-Dateien entsprechen anschließend bytegenau der bestätigten Preview.
Die bestehende Production-Basis mit Sharing, QR, Kalender und Icons bleibt erhalten.
Keine Änderung an Spiel-Engine, gespeichertem Fortschritt, Datenbankschema,
Abhängigkeiten, nativer Integration oder App-Konfiguration. Keine Git- oder
Store-Veröffentlichung und kein neuer nativer Build.

Abnahme: gezielte Tests und verify:fast auf der Production-Basis, Release-Prüfung,
exakte Runtime-Kompatibilität, Production-iOS-Export mit Quellenabgleich,
unveränderter Production-Kanal vor Veröffentlichung und echtes Client-Manifest
mit identischem ausgeliefertem Bundle. Die neue Darstellung bestätigt der Nutzer
abschließend auch in TestFlight. Die Preview-Abnahme ersetzt diese Prüfung nicht.

Nachweise: .expo/dino-centered-testflight-ota/.

## Prüfung und Veröffentlichung

- 22 fokussierte Komponententests auf der Production-Basis bestanden.
- Vollständiges verify:fast ohne Fehler bestanden, Exitcode 0: 8.739 Unit-Tests
  in 452 Dateien, 1.128 Komponententests in 137 Suites sowie alle weiteren
  Repository-Gates. Für diesen Production-Durchlauf war keine Wiederholung nötig.
- Release-Konfiguration und iOS-Export bestanden. Alle 145 nativen
  Fingerprint-Quellen sind kompatibel zur Build-5-Runtime 4a9747e5fdc6a52760d6955a95584cdd1e85607e.
- Zehn Feature-Dateien entsprechen bytegenau der vom Nutzer auf dem iPhone
  bestätigten Preview-Gruppe f66a75a5-0d64-449f-8aff-3520d6261a61 und blieben
  während Prüfung und Export unverändert. Zehn produktive Quellen wurden im
  Export-Source-Map abgeglichen, einschließlich der erhaltenen Navigation-,
  Sharing-, Kalender- und Symbol-Dateien der Production-Basis.
- Production-Kanal unmittelbar vor Veröffentlichung weiterhin auf der erwarteten
  Vorgängergruppe 5ccced7e-471c-4e32-a24b-8b0b5af480c5.
- Veröffentlicht am 16.10.2026, 00:35:42 (Europe/Berlin), ausschließlich iOS / production,
  APP_VARIANT=production, Umgebung production. API-Zeitstempel: 2026-10-15T22:35:42.183Z.
- Update-Gruppe: 5e737da5-bf04-44fe-aa30-4bf01eca0c55; iOS-Update: 01a141b4-fae7-71ae-9eae-0d3d496f8642.
- Echte Client-Anfrage für Production mit Build-5-Runtime erhält dieses Update.
  Ausgeliefertes Bundle stimmt bytegenau mit dem geprüften Export überein:
  9413400 Bytes, SHA-256 b246d6902077f85eb1d036bf1a424defe265f16035a15ff749a0796c7f4364cd.
- Neue Sichtabnahme in der TestFlight-App ausstehend. Die vorherige Spiel- und
  Rekord-Abnahme in TestFlight sowie die neue Preview-Sichtabnahme sind bestätigt.

Zum Laden LUNA Shift aus TestFlight vollständig schließen, öffnen und ungefähr
15 Sekunden warten, nochmals schließen und öffnen. Auswertung → Prüfung zeigt
jetzt den Dino. Doppeltippen öffnet das ebenfalls zentrierte Spiel. Der bisherige
lokale TestFlight-Rekord bleibt erhalten.

[OTA im EAS-Dashboard](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/5e737da5-bf04-44fe-aa30-4bf01eca0c55)
