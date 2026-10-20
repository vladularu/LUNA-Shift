# Löschen im Tages-Popup

## Auftrag und Scope

- Referenz: `ScreenRecording_10-20-2026 23-18-14_1.mp4`, 0–8 Sekunden.
- Ziel: Eigene Dienste und Termine im Kalender-Popup nach links wischen, die rote Löschaktion öffnen und am Popup bestätigen oder abbrechen. Das Popup bleibt nach dem Löschen geöffnet.
- Plattform: iOS/iPhone. Android und Web nutzen denselben Code, ohne Geräteabnahme.
- Basis: `origin/master` bei `48cf562b23e3eea1a06d36929a4c5a1311c992aa`; Branch `codex/calendar-delete-behavior` in einem separaten Worktree.
- Dateiscope: Kalender-Screen, Tages-Popup, Wischzeile, Bestätigung, Lösch-Hook, Popup-Komponententests und diese Notiz (sieben Dateien).
- Nicht-Ziele: Änderungen am Tageseditor, Datenbankschema, Synchronisationsprotokoll, Sammellöschen oder fremden Kalendern.
- Freigabe: lokale Implementierung und Prüfung. Commit, Push, Build und OTA sind nicht beauftragt.

## Verhalten und Abnahmekriterien

1. Nach links wischen legt „Löschen“ frei. Auch vollständiges Wischen löscht nicht direkt. Höchstens eine Zeile ist geöffnet.
2. „Löschen“ zeigt eine Bestätigung am Popup mit „Abbrechen“ und „Löschen“. Wenn oberhalb kein Platz bleibt, wird sie unterhalb beziehungsweise innerhalb der verfügbaren Bildschirmhöhe positioniert.
3. Abbrechen und Tippen außerhalb schließen zuerst die Bestätigung beziehungsweise die geöffnete Wischaktion. Ein einfacher Tap auf eine geöffnete Zeile öffnet nicht versehentlich den Editor.
4. Erst die Bestätigung ruft den bestehenden `removeEntry`-Pfad auf. Doppelte Bestätigungen sind gesperrt, auch innerhalb desselben Frames. Ein Fehler bleibt sichtbar und erlaubt einen erneuten Versuch.
5. Die erfolgreiche Speicherung aktualisiert die Einträge über den bestehenden Provider. Das Popup bleibt einschließlich der Hinzufügen-Aktionen offen, auch wenn der letzte eigene Eintrag gelöscht wurde. Die vorhandene dezente Lösch-Haptik wird verwendet.
6. Fremde geteilte Einträge bleiben ohne Löschgeste und Löschaktion. Bei geänderter Revision oder extern entferntem Ziel verfällt eine offene Bestätigung.
7. Langer Druck sowie die VoiceOver-Aktion „Löschen“ öffnen dieselbe Bestätigung. Währenddessen ist der übrige Popup-Inhalt für VoiceOver ausgeblendet.

## Technische Grundlage und Prüfung

`package.json` der Umsetzungsbasis verwendet Expo `~57.0.22`. Die vorhandene Gestenbibliothek wird gemäß [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/gesture-handler/) verwendet; neue Pakete oder native Konfiguration sind nicht nötig. Die API von `ReanimatedSwipeable` wurde zusätzlich mit den installierten Typen abgeglichen.

Die Komponententests prüfen Öffnen, Bestätigen, Abbruch, leeres Popup nach Provider-Aktualisierung, Termine, Fehler und Wiederholung, Doppelbestätigung, Revisionwechsel, Fokusverlust, eine einzelne geöffnete Zeile und schreibgeschützte geteilte Einträge. Der Testadapter liefert die nativen Swipeable-Ereignisse; er beweist keine native Gestenerkennung.

Lokales Prüfergebnis am 20.10.2026:

- 19 gezielte Popup-Tests erfolgreich, einschließlich sechs neuer Verhaltenstests.
- Typprüfung, Lint, Formatierung, Regelprüfung und `git diff --check` erfolgreich.
- 463 Vitest-Dateien mit 8.975 erfolgreichen Tests.
- Im vollständigen Komponentenlauf: 142 erfolgreiche Dateien, 1.265 erfolgreiche Tests; ein bestehender Test in `calendar-stable-pager.component.test.tsx` überschritt das Zeitlimit von fünf Sekunden. Die Datei bestand anschließend unverändert einzeln mit allen neun Tests; der betroffene Test benötigte dabei 3.345 ms. Keine Anpassung von Testlimits oder Pager-Code.
- Alle 14 durch den Abbruch übersprungenen Prüfskripte anschließend separat erfolgreich, einschließlich Sharing-Sicherheit, Worklets, Widgets, Runtime und Abhängigkeiten.
- `verify:fast` als einzelner Gesamtlauf endete wegen dieses Timeouts mit Fehlerstatus. Die erfolgreichen Einzelwiederholungen sind kein durchgehend grüner Gesamtlauf und keine PR-CI.

Offene Geräteabnahme: iPhone mit Hell-/Dunkelmodus, oberster/unterster Kalenderwoche, größerer Schrift, mehreren Einträgen und VoiceOver. Referenzvideo und Implementierung müssen nach separat freigegebener Verteilung verglichen werden. Kein eigener iPhone-Nachweis, keine Auslieferung in dieser Aufgabe.

## Preview-Abnahme und Lieferung am 21.10.2026

- Der kombinierte Preview-Kandidat enthält die bereits veröffentlichten Netto- und Kalenderoptimierungen sowie die sieben Dateien dieser Funktion. `verify:fast` bestand vollständig mit 8.997 Unit-Tests, 1.278 Komponententests und allen weiteren Prüfskripten.
- Preview Build 43, Update `01a15b56-9361-72a6-8e6c-366ba75e00e2`, Gruppe `ac974025-db17-4a58-bd04-1959e639de87`: Manifest und heruntergeladenes Paket stimmten mit dem geprüften Export überein.
- Der Nutzer bestätigt nach dem iPhone-Test: „Hab es getestet, passt so.“ Diese Rückmeldung nimmt den getesteten Löschablauf ab; sie ist kein gesonderter Nachweis für jede Kombination aus Gerät, Schriftgröße und Bedienungshilfe.
- Danach ausdrücklich freigegeben: Commit, Push, PR, Merge nach erfolgreicher CI und anschließend TestFlight mit den gesammelten Änderungen. Die TestFlight-Buildbeschreibung enthält ausschließlich stichpunktartige Änderungen.
