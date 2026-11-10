# Cloud-Synchronisierung: unveränderte Abgleiche

## Task-Vertrag

- Ziel: den lokalen Aufwand eines unveränderten privaten Cloud-Abgleichs senken, mit reproduzierbarer Vorher-/Nachher-Messung.
- Nicht-Ziele: UI, Berechnungen, Datenformat, Polling-Intervall, Authentifizierung, Server-RPCs, RLS, Datenbankmigrationen, geteilte Kalender und TestFlight ändern.
- Plattform: iOS / Expo SDK 57; isolierter Node-/SQLite-Benchmark für lokale Arbeit, anschließender Funktionsnachweis in der bestehenden iPhone-Preview.
- Branch: `codex/cloud-sync-performance-20261110`, Ausgangspunkt `62513d06ff2faaaed7c6e9c8975652ad3524a1a5`.
- Dateiscope: privater Cloud-Runtime, dessen Regressionstests, reproduzierbarer Benchmark, diese Dokumentation und expliziter Kandidaten-Quellreview. Maximal sieben Dateien; keine native Integration.
- Freigaben: Umsetzung und Git-/Preview-Schritte aus der bestehenden Freigabe; TestFlight ausdrücklich ausgenommen.

## Baseline und Hypothese

`private_cloud_head` verhindert bereits den erneuten Snapshot-Download bei gleicher Revision. Trotzdem folgen zwei vollständige lokale Captures, zwei Validierungen und der Dreiwege-Merge. Ein Abgleich ohne lokale oder entfernte Änderungen benötigt keine lokale Übernahme: Baseline und Pending-Zustand bleiben bereits korrekt. Eine frische lokale Aufnahme, der Revisionsabgleich, die Dokumentvalidierung und die Konto-/Aktivitätsprüfungen bleiben erforderlich.

Nur wenn der Server-Head dieselbe Revision bestätigt, kein Pending vorliegt und der frische Gerätestand vollständig gleich der Baseline ist, darf dieser Leerlaufpfad genutzt werden. Bei Änderungen, Retry, Konflikten oder fehlender Baseline bleibt der bisherige Pfad erhalten.

## Messplan

- Synthetische, ausschließlich lokale SQLite-Daten mit 0, 1.000 und 5.000 Terminen; keine Konten oder Nutzerdaten.
- Gleiche Eingaben und echtes Capture-/Validierungs-/Repository-Verhalten vor und nach der Änderung. Netzwerk nur als deterministischer, unveränderter Head simuliert.
- Je Fall drei Aufwärmläufe und 15 Messungen; zwei unabhängige Vorher-/Nachher-Läufe.
- Metriken: Median/P95 der lokalen Abgleichdauer, SQLite-Aufrufe, vollständige Captures, Übernahmen, Head-/Read-/Write-Aufrufe und unveränderte gespeicherte Bytes.
- Suchbudget: höchstens zwei Implementierungsvarianten, 30 Minuten Variantensuche, keine Live-Datenänderungen.
- Zeiten sind Windows-/Node-Messwerte und keine iPhone-, Netzwerklatenz- oder allgemeine App-Beschleunigungszusage.

## Abnahmekriterien

1. Unveränderte Abgleiche behalten eine frische Aufnahme und Validierung, benötigen aber keine zweite Aufnahme/Übernahme.
2. Dauerhafte Baseline-/Pending-Daten und alle Nutzerdaten bleiben unverändert.
3. Lokale/entfernte Änderungen, Konfliktbehandlung, Konto-/App-Wechsel, Pending-Retry und fehlende Cloud-Daten bleiben korrekt.
4. Neue Regressionen sind gegen die Baseline zunächst rot; alle privaten Cloud-, Foto-, Backup- und Runtime-Tests sowie `npm.cmd run verify:fast` bestehen danach.
5. Verbesserung ist mit denselben Fixtures wiederholt messbar; keine zeitabhängigen CI-Grenzwerte.
6. TestFlight und dessen akzeptierte Baseline bleiben unverändert. Preview-Geräteabnahme bleibt ein eigener Nachweis.

## Befehle

```powershell
$env:LUNA_CLOUD_BENCHMARK_OUTPUT = '<bericht.json>'
npx vitest run --config scripts/benchmark-private-cloud.config.mts
npx vitest run src/application/private-cloud-runtime.test.ts src/application/private-cloud-performance.test.ts src/infrastructure/database/private-cloud-repository.test.ts src/infrastructure/database/account-photo-repository.test.ts
npm.cmd run verify:fast
```

## Referenzen

- [Expo SDK 57 SQLite](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/)
- [Supabase JavaScript RPC](https://supabase.com/docs/reference/javascript/rpc)

## Messergebnis vom 10. November 2026

Node 24.18.0 unter Windows, echte SQLite-In-Memory-Datenbank. Zwei getrennte Prozesse pro Variante, jeweils drei Aufwärm- und 15 Messläufe. Alle gespeicherten Snapshot-/Baseline-Bytes bleiben identisch.

| Termine | Baseline Median, Lauf 1 / 2 | Optimiert Median, Lauf 1 / 2 | Zeitersparnis |
| ------- | --------------------------- | ---------------------------- | ------------- |
| 0       | 4,11 / 4,23 ms              | 1,91 / 1,82 ms               | 53,5–57,0 %   |
| 1.000   | 158,14 / 161,13 ms          | 53,39 / 53,16 ms             | 66,2–67,0 %   |
| 5.000   | 765,96 / 780,42 ms          | 254,72 / 252,37 ms           | 66,7–67,7 %   |

Pro unverändertem Abgleich sinken die SQL-Leseaufrufe von 59 auf 29, vollständige Datenaufnahmen von zwei auf eine und Übernahmen von einer auf null. Der Server-Head wird weiterhin einmal abgefragt, der frische lokale Stand weiterhin validiert. Vollständige Downloads und Uploads bleiben in beiden Varianten bei null.

Die Optimierung berührt ausschließlich `src/application/private-cloud-runtime.ts`. Die 18 neuen Regressionstests umfassen Leerlauf, echte lokale/entfernte Änderungen, neue Revision ohne Inhaltsänderung, Retry, fehlende Baseline/Head-Unterstützung, ältere Fotodokumente, Validierungsfehler, Konto-/App-Wechsel, überlappende Abgleiche, Listener-Lifecycle sowie gleichzeitige lokale Änderungen. Drei Leerlauf-Regressionen scheiterten vor der Änderung erwartungsgemäß; anschließend bestehen die neuen und die weiteren fokussierten Cloud-/Repository-Regressionen.

Die Messwerte belegen weniger lokale Arbeit pro unverändertem Abgleich. Sie belegen keine kürzere Netzwerklatenz oder generelle Beschleunigung der iPhone-App. Der neue Preview-Gerätenachweis steht aus. TestFlight bleibt ausdrücklich unverändert.
