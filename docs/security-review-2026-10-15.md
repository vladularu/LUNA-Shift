# LUNA Sicherheitsnachprüfung vom 15.10.2026

## Auftrag und geprüfter Stand

- Ziel: Strix-Befund CVE-2026-45822 reproduzieren und beheben sowie die offenen Sicherheitsbereiche gezielt prüfen.
- Basis: `origin/master` bei `84d2304`, Branch `codex/luna-security-review`, isolierter Worktree. Der ursprüngliche Strix-Snapshot lag bei `ef3f429` und enthielt die inzwischen vorhandenen Konto- und Kalenderfreigabefunktionen noch nicht.
- Plattform: Expo SDK 57 (`expo ~57.0.22`, `expo-router ~57.0.21`), Schwerpunkt iOS. Kein SDK-Wechsel.
- Dateiscope: Decoder-Rückport mit Manifest, Installations-/Metro-/Prüfintegration, gezielte Regressionstests und dieser Bericht. Keine UI-, Schema- oder Kontodatenänderungen.
- Nicht-Ziele: Produktivsysteme angreifen, Cloud-Konfiguration ändern, reale Zugangsdaten verwenden, Git-Veröffentlichung, EAS-Build, OTA oder Store-Veröffentlichung.
- Abnahme: begrenzte lokale Reproduktion, Tests gegen den tatsächlich vom Router aufgelösten Query-Parser, Integritätskontrollen, Sicherheitsprüfungen und `verify:fast`. iPhone- und Live-Backend-Abnahmen bleiben ausdrücklich separat.

## Reproduzierter Befund und Behebung

Die Abhängigkeit `expo-router@57.0.21 -> query-string@7.1.3 -> decode-uri-component@0.2.2` ist auch im aktuellen Hauptstand vorhanden. Der Paketmaintainer beschreibt die fehlerhafte Verarbeitung ungültiger Prozentkodierung in [GHSA-vcc3-ghjq-m6fr / CVE-2026-45822](https://github.com/SamVerschueren/decode-uri-component/security/advisories/GHSA-vcc3-ghjq-m6fr).

Ein isolierter Node-Prozess mit dem tatsächlich aufgelösten Query-Parser wurde auf 1.800 ms begrenzt. 50 Wiederholungen von `%ab` benötigten vor der Korrektur etwa 110 ms; bereits 200 und 400 Wiederholungen überschritten das Zeitlimit. Das belegt den Parser-DoS lokal. Ein vollständiger Deep-Link-Angriff auf einem iPhone wurde nicht durchgeführt.

Nach der Korrektur benötigten 200 Wiederholungen etwa 0,8 ms, 400 etwa 0,84 ms und 2.000 etwa 1,47 ms auf diesem Rechner. Die Zeiten sind Messwerte, keine geräteübergreifenden Garantien. Der Regressionstest verarbeitet lange manipulierte Schlüssel und Werte in einem zeitlich begrenzten Kindprozess und prüft zusätzlich Unicode und wiederholte Query-Parameter.

### Kompatibler Rückport

Die korrigierte offizielle Version 0.5.0 ist ein ESM-Paket, während `query-string@7.1.3` einen direkt aufrufbaren CommonJS-Export erwartet. Auch Router 57.0.27 verlangt weiterhin Query String 7. Ein blindes Major-Override oder SDK-Upgrade wurde deshalb vermieden.

`scripts/decode-uri-component-hardening.cjs` übernimmt den begrenzten UTF-8-Decoder aus dem offiziellen Release-Commit [`a12fabaa28303cc8b5b07e93d128f4fc09fc31e5`](https://github.com/SamVerschueren/decode-uri-component/tree/a12fabaa28303cc8b5b07e93d128f4fc09fc31e5). Der bisherige CommonJS-Export und die Pluszeichen-Behandlung bleiben erhalten. Der vollständige MIT-Lizenztext liegt neben dem Rückport.

Kontrollen:

- Das eingecheckte Manifest sowie Original- und Postimage werden per SHA-256 geprüft.
- Nur die exakte, bereits gesperrte npm-Version 0.2.2 mit bekannter Archividentität wird akzeptiert. Unbekannte oder zusätzliche Paketkopien führen zum Fehler.
- Tatsächliche Paketpfade müssen innerhalb des Worktrees liegen. Alle im Lockfile verzeichneten direkten Verbraucher müssen dieselbe korrigierte Datei auflösen.
- `postinstall` wendet die Korrektur idempotent an. `verify:fast`, Produktions-Audit und Metro-Konfiguration lehnen einen fehlenden oder veränderten Rückport ab, auch nach einer Installation mit ignorierten Lifecycle-Skripten.
- Der Lockfile-Versionswert bleibt bewusst 0.2.2: Es wird kein npm-Update vorgetäuscht. Versionsbasierte Scanner können die CVE weiter melden; der wirksame Nachweis ist die geprüfte installierte Postimage mit Verhaltenstest. Es wurde keine Audit-Ausnahme ergänzt und kein bestehendes Gate abgeschwächt.

## Offene Strix-Bereiche: Nachprüfung

Die acht Strix-Lücken enthielten auch fehlende Abdeckungsprotokolle gestoppter Prüfer. Sie entsprechen nicht acht unabhängig gefundenen Schwachstellen. Die folgende Prüfung ersetzt diese fehlenden Quellcode-/Lokalbelege, jedoch keinen Gerätenachweis oder Live-Cloud-Test.

| Bereich                              | Geprüfter Schutz und Ergebnis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Grenze                                                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backup-Import / Deserialisierung     | Größen-, Datei- und MIME-Grenzen vor Import; Versions-/Schema-/Feld- und Referenzprüfung; doppelte IDs und ungültige verschachtelte Daten werden abgelehnt. Kanonischer SHA-256-Prüfwert wird vor Restore geprüft. Validierungstests bestanden. Kein weiterer ausnutzbarer Fehler belegt.                                                                                                                                                                                                                                                                    | Prüfsumme ist Integritätsschutz, kein Echtheitsbeweis gegenüber einem Angreifer, der selbst einen gültigen Export erstellt.                                                                 |
| Restore / Datenverlust               | Echte lokale SQLite-Tests für atomaren Restore, injizierte Schreibfehler und Rollback, Fremdschlüssel, Erhalt interner Daten und Kalenderfreigabe-Zustand. Zusätzlicher Test importiert SQL-Steuerzeichen als Titel/Notiz und bestätigt unveränderte Tabellen.                                                                                                                                                                                                                                                                                               | Native Benachrichtigungen und App-Neustart separat am Gerät prüfen.                                                                                                                         |
| SQL-Injektion                        | AST-Inventar: 468 SQL-Aufrufe in 818 produktiven JS-/TS-Dateien; dynamische Ausdrücke gezielt nachverfolgt. Werte werden gebunden; Strukturteile stammen aus festen Tabellen-/Spaltenlisten, generierten Platzhaltern oder validierten/quotierten Datenbank-Aliasen. Kein bestätigter unkontrollierter Datenfluss in SQL-Code.                                                                                                                                                                                                                               | Inventar plus gezielte Datenflussprüfung, keine Behauptung einer formal vollständigen Analyse.                                                                                              |
| Datenbankverschlüsselung / Schlüssel | 32 kryptografische Zufallsbytes, 64 Hexzeichen, SecureStore mit `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, Schlüssel vor Datenbankzugriff, SQLCipher- und Integritätsprüfung. Fehlender/ungültiger Schlüssel blockiert; keine stille Klartext-Rückfallöffnung. Migrationskopie/WAL/Integrität und Bootstrap-Tests bestanden.                                                                                                                                                                                                                                          | Tatsächliche native Verschlüsselung, Schlüsselzugriff nach Sperren/Neustart und alte iPhone-Migration nicht auf echtem Gerät verifiziert.                                                   |
| Temporäre Backup-Dateien             | Cache-Pfad-Allowlist; Bereinigung in `finally`; expliziter Fehler bei fehlgeschlagener Bereinigung. Die UI weist auf unverschlüsselten, persönlichen Inhalt außerhalb der App hin.                                                                                                                                                                                                                                                                                                                                                                           | Dateisystem-/Share-Sheet-Verhalten am iPhone prüfen. JSON-Exporte sind absichtlich nicht verschlüsselt.                                                                                     |
| Logs / Fehlermeldungen               | Ein direkter Console-Aufruf im App-Quellcode: Entwicklungsdiagnostik mit festem Code und begrenztem Fehlerklassennamen. Keine rohen Meldungen/Stacks/Inhalte; generische Nutzerfehlermeldungen. Tests für Sanitizing und begrenzte Aufbewahrung bestanden.                                                                                                                                                                                                                                                                                                   | Kein Live-Cloud-/Gerätelog ausgelesen.                                                                                                                                                      |
| Geheimnisse / Weiterleitungen        | Musterprüfung produktiver versionierter JS-/TS-Dateien sowie Offline-Gitleaks-Scan von 824 Commits aller lokalen Git-Referenzen (41,19 MB). Sieben redigierte Treffer geprüft: zwei ESZip-Hash-Metadaten in Dokumentation, zwei PEM-Formatprüfungen im Apple-Servercode und drei synthetische Test-Fixtures. Kein echter geheimer Schlüssel nachgewiesen. Backend-Secrets liegen außerhalb des Client-Codes. Administrative Storage- und Logout-Requests enthalten bereits `redirect: "error"`; der frühere Auditbefund ist im aktuellen Hauptstand behoben. | Scanner- und Kontextprüfung, keine Garantie vollständiger Geheimniserkennung. Keine Prüfung unversionierter `.env`-Dateien und keine Aussage über ausgegebene oder rotierte Live-Schlüssel. |
| Anmeldung / Freigaben / Widerruf     | Aktueller Quellcode verwendet PKCE, Apple-Nonce/State, exakte Callback-Prüfungen, SecureStore-Sitzungsspeicherung und Generationenschutz bei Abmeldung. Auth-Tests und 46 lokale PGlite-Tests der versionierten RLS-/RPC-Migrationen bestanden, einschließlich Eigentümer-/Drittbenutzergrenzen, Widerruf und Kontolöschung.                                                                                                                                                                                                                                 | Live-Supabase-Konfiguration, tatsächlicher Migrationsstand, Providerkonfiguration, zwei Geräte und Widerruf über reale Konten bleiben externe Abnahmen.                                     |

## Weitere Paketmeldungen

Der rohe Produktions-Audit meldet 64 Paketknoten: 48 hoch, 16 mittel, keine kritisch. Das sind fünf eindeutige Advisory-Familien, nicht 64 unabhängige LUNA-Lücken:

- `node-forge` und `braces`: die bereits bestehenden, exakt eingegrenzten Rückports werden vom Produktions-Gate erfolgreich verifiziert.
- `decode-uri-component`: in diesem Auftrag reproduziert und durch den geprüften Rückport korrigiert.
- [`uuid`, GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq): mittlere Meldung für v3/v5/v6 mit externen Ausgabepuffern. Der vorliegende Pfad führt unter anderem über Xcode-/Expo-Konfigurationstools; keine betroffene App-API-Nutzung nachgewiesen.
- [`sprintf-js`, GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c): mittlere Meldung für unbeschränkte Präzisionsangaben. Kein vom LUNA-Nutzer kontrollierter Formatstring im App-Quellcode nachgewiesen. Die Paketmeldung bleibt bestehen und ist nicht pauschal als harmlos freigegeben.

Es wurde in den gezielt untersuchten Bereichen kein weiterer ausnutzbarer App-Fehler belegt. Die zwei verbleibenden mittleren Paketmeldungen sind getrennte Wartungspunkte; ein erfolgreicher Produktions-Audit beansprucht keine vollständige Freiheit von Advisories.

## Validierung

- Reproduktion und Rückport: vier dedizierte Tests einschließlich echter Router-Abhängigkeitsauflösung bestanden.
- Backup/Datenbank/Auth/Route/Diagnostik: 94 Testdateien mit 1.199 Tests vor dem zusätzlichen Injektionsfall bestanden; danach der erweiterte Restore-Test mit 18 Fällen separat bestanden.
- Lokale Supabase-/Kalenderfreigabe-Sicherheit: 46 PGlite-Tests bestanden, ohne Produktivkontakte.
- Audit-Policy und Decoder: 19 Node-Tests bestanden.
- `npm run audit:production`: bestanden; bestehende hohe Advisory-Familien nur mit verifiziertem Rückport akzeptiert.
- iOS-/Hermes-Export: bestanden (`npm run export:ios`); kein nativer Build und kein Gerätenachweis.
- Git-Historie: Gitleaks 8.30.1 im vorhandenen Strix-Container, ohne Netzwerk, Repository lesend eingebunden und Bericht vollständig redigiert. 824 Commits, sieben als Nicht-Geheimnisse klassifizierte Treffer. Es wurden keine Scannerregeln oder Ignore-Ausnahmen ergänzt.
- `npm run verify:fast`: vollständig bestanden, einschließlich Regelprüfung, TypeScript, Lint ohne Warnungen, Formatierung, 8.723 Unit-Tests in 450 Dateien, 1.117 Komponententests in 136 Dateien, aller konfigurierten Node-/Operator-/Freigabe-/Widget-/Decoder-Prüfungen und `git diff --check`.
- Abschließender Scope: neun Dateien im isolierten Worktree; keine Änderungen an den unabhängigen Dateien des ursprünglichen Checkouts. Kein Commit, Push oder Release durchgeführt.

## Noch erforderliche externe Nachweise

1. Auf einem nativen iPhone-Build einen manipulierten Link sowie normale Navigation und Anmeldung prüfen.
2. SQLCipher/Schlüsselzugriff, Altinstallation, Sperren/Neustart und Backup-Import samt Cache-Bereinigung am Gerät prüfen.
3. Gegen eine freigegebene Test-Supabase-Umgebung den tatsächlich installierten RLS-/RPC-Stand, Provider und Widerruf mit zwei Konten/Geräten nachweisen.

Diese Nachweise sind offen und werden durch lokale Tests oder Exporte nicht ersetzt. Dieser Auftrag veröffentlicht keinen Build und ändert keine Cloud-Ressourcen.
