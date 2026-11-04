# TestFlight-Release-Schutz

## Referenz und Auftrag

Die wiederhergestellte iOS-TestFlight-OTA für Build 9 wurde am 04.11.2026 am iPhone bestätigt: „Auf iPhone passt das, erledige die restliche Aufgaben wie beschrieben.“

Referenz: Gruppe `ac656e8a-0c56-4e5b-8229-ab34cfe1cdc3`, Update `01a1a4fe-ffeb-7cfd-bb3a-15efac9aa2f2`, Runtime `c223286c3cbf6ce5f7873c6e595d558028d9d8fb`. Das ausgelieferte Bundle hat SHA-256 `a3dadbef8e72eb8d9359d2bd9c33862c06b951e9a4e5a011df28fc01a0cb9c8c`; alle 34 Assets sind bytegleich zur zuvor geprüften TestFlight-Version.

Ziel dieses Pakets ist ein automatischer Schutz vor erneutem Verlust bestehender Funktionen. Es führt keine weitere OTA, keinen Build und keine Änderung von Nutzer- oder Tarifdaten aus.

## Was geprüft wird

- `build-9.accepted.json` enthält die akzeptierte Update-/Build-Identität, Bundle-/Asset-Hashes und 1.168 eingefrorene App-, Asset-, native und Regeldateien einschließlich wichtiger Regressionstests.
- Textdateien werden für Windows/Linux mit LF normalisiert gehasht, Binärdateien bytegenau. Dokumentation, allgemeine Tests und drei nicht ausgelieferte ursprüngliche Marken-JPEGs gehören nicht zum App-Quellvergleich. Die fest aufgelisteten Pflicht-Regressionstests sind ausdrücklich eingeschlossen.
- Neue, geänderte oder entfernte Quellen werden vollständig aufgelistet. Jede erlaubte Abweichung benötigt exakten Pfad, Art, Kandidaten-Hash und eine konkrete Begründung in `build-9.reviewed-changes.json`.
- Eine Freigabe gilt nur für genau diesen Inhalt. Weitere Änderungen derselben Datei, Wildcards, doppelte oder veraltete Einträge sowie entfernte Pflicht-Tests schlagen fehl.
- Die bewusst beibehaltenen master-Änderungen betreffen ausschließlich den bereits gemergten geprüften Regelkatalog samt Historie/Testfixture und den erweiterten bestehenden Runtime-Prüfeinstieg. Abhängigkeiten und vorhandene Nativebasis entsprechen weiterhin Build 9.
- Die Referenz wird nicht automatisch auf den aktuellen Arbeitsstand angehoben, um einen Fehler zu verdecken.

Die CI führt den Quellvergleich und die Release-Prüfungen im bestehenden Job `production-safety` aus. `verify:fast` prüft zusätzlich den Quellstand und die Schutz-/Widget-Vertragstests. Alle sieben bestehenden CI-Gates bleiben erforderlich.

## Feste Funktionsprüfungen

`node scripts/verify-testflight-baseline.mjs --contracts` prüft:

- Widget-Daten in Tages-, Wochen- und Monatsraster: Pastell, Termine, Feiertags-/Sondertagsnamen und Tagesfarben.
- Geteilte Termine getrennt von Diensten; ausgeblendete Termine dürfen keinen Dienst verdrängen.
- Eigene Dienste, mehrere Einträge, Hintergrund, Hell-/Dunkelmodus und Schutz privater Notizen/Orte.
- Die bestehenden Netto-Fälle mit geänderten Monatsgrundlagen und Jahreswechsel.
- Die vorhandenen Netto-UI- und Einladungs-Prüfungen.
- Die isolierte Widget-Runtime inklusive Darstellung und vorhandener Alt-Snapshots.

## Vor einer später freigegebenen OTA

```powershell
node scripts/verify-testflight-baseline.mjs
node scripts/verify-testflight-baseline.mjs --live
node scripts/publish-testflight-ota.mjs --dry-run
```

Der Dry-Run lädt die EAS-Production-Umgebung, prüft die Pflichtfälle und berechnet den tatsächlichen Fingerprint. Er exportiert und veröffentlicht keine OTA.

Eine Veröffentlichung ist erst nach der bereits vorgeschriebenen Preview-Abnahme desselben App-/Asset-Quellstands und ausdrücklicher TestFlight-OTA-Freigabe zulässig:

```powershell
node scripts/publish-testflight-ota.mjs --publish --message "Kurze konkrete Beschreibung"
```

Der Einstiegspunkt:

1. Bindet den Plan an die akzeptierte Baseline, die explizit geprüften Änderungen und einen vollständigen eingefrorenen Kandidaten-Quellstand.
2. Prüft den aktuellen Production-Vorgänger live einschließlich Update-ID, Runtime, Bundle- und allen Asset-Hashes.
3. Prüft Production-Konfiguration, Pflichtfälle und tatsächlichen Build-9-Fingerprint ohne Überschreibung.
4. Exportiert nur iOS und kontrolliert Quellstand, Vorgänger, Exportmetadaten, Bundle und Assets erneut vor dem Upload.
5. Veröffentlicht das bereits geprüfte Bundle und verifiziert anschließend die tatsächlich gelieferten Bytes.
6. Speichert Plan und Ergebnis unter `artifacts/testflight-release/<id>/`. Technische Auslieferung bleibt bis zum zugeordneten iPhone-Nachweis als Geräteabnahme offen.

Unbekannte Optionen, Runtime-/Kanal-Overrides, fehlende Umgebung, ein anderer Live-Vorgänger oder zwischenzeitlich veränderte Dateien blockieren den Ablauf. Nach einem Fehler nach der Veröffentlichung muss zuerst der Serverstand geprüft werden; nicht ungeprüft erneut veröffentlichen.

## Neue Referenz nach Geräteabnahme

Eine Bestätigung einzelner Funktionen reicht nicht aus, die gesamte neue OTA als abgenommen zu markieren. Der Nachweis muss zur Update-ID und zum `sourceDigest` aus Plan/Ergebnis gehören und die vier Flows zuordnen:

```json
{
  "status": "accepted",
  "build": 9,
  "updateId": "<veröffentlichte Update-ID>",
  "sourceDigest": "<sourceDigest aus plan.json>",
  "date": "2026-11-04",
  "quote": "<tatsächliche Nutzerbestätigung>",
  "flows": {
    "calendar": "passed",
    "widgets": "passed",
    "netPay": "passed",
    "invitation": "passed"
  }
}
```

Nach tatsächlich vorliegender Abnahme:

```powershell
node scripts/accept-testflight-baseline.mjs --plan artifacts/testflight-release/<id>/plan.json --result artifacts/testflight-release/<id>/result.json --evidence artifacts/testflight-release/<id>/device-acceptance.json
```

Der Befehl prüft den Veröffentlichungsnachweis, den unveränderten eingefrorenen Quellstand, vollständige Geräteabnahme und die aktuell ausgelieferte OTA. Erst danach schreibt er die neue Baseline und leert die überholten Einzelabweichungen. Die Baseline-Änderung braucht weiterhin die normale Git-Freigabe, PR und CI.

Für eine neue native Build-/Runtime-Linie ist eine eigene ausdrücklich freigegebene Migration der Referenz erforderlich; die Build-9-Runtime darf nicht erzwungen werden.

## Verifikation dieses Pakets

Die Tests des Schutzes simulieren unter anderem fehlende/abgeänderte Quellen, entfernte und zurückgesetzte Tests, ungültige Einzel-Freigaben, einen anderen Server-Vorgänger, falsche Runtime, veränderte Exportbytes und unvollständige Geräteabnahme. Eine Gegenprobe am zuvor fehlerhaften master wird im lokalen Auslieferungsnachweis dokumentiert. Die tatsächlich veröffentlichte, inzwischen akzeptierte OTA bleibt unverändert.
