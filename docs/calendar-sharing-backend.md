# Kalenderfreigabe-Backend

## Task-Vertrag

Ziel: serverseitig abgesicherte Lesefreigaben eines bewusst veröffentlichten lokalen Dienstplans. Nicht-Ziele: private Vollsynchronisierung, fremde Bearbeitung, Kalenderexport, Tarif-/Nettoänderungen, Deployment in die Regelpaket-Umgebung. Dateiscope: `supabase/`, dieser Bericht und `calendar-sharing-rpc-contract.md`. Plattform: getrennte Supabase/PostgreSQL-Preview-Umgebung, konsumiert von Expo SDK 57 auf iPhone. Abnahme: harte Rechte-, Datenschutz-, Einladung-, Revision- und Löschtests; echte Supabase-/Provider- und Zwei-Geräte-Prüfung bleiben eigene Gates.

## Servergrenzen

Sechs Tabellen im nicht exponierten Schema `luna_sharing` speichern nur Profile, Kalender-Metadaten, Mitglieder, gehashte Einladungen, freigegebene Einträge und kleine Mutationsbelege. Alle Tabellen haben RLS, keine Client-Grants und keine anonymen Zugänge. Lesepolicies erlauben als zusätzliche Absicherung nur Eigentümer/Selbstzugriff, falls später versehentlich ein SELECT-Grant ergänzt wird. Sämtliche App-Zugänge erfolgen über 13 authentifizierte RPCs mit festem leerem `search_path`. Private Helfer besitzen keine Client-Ausführungsrechte.

Die RPCs prüfen die reale Existenz des aktuellen `auth.uid()`-Nutzers. Eigentümeroperationen sperren und überprüfen den Kalender; Empfänger benötigen `ACTIVE`. Einladungsannahme gewährt nur `PENDING`. Keine individuellen Notizen, Orte, Erinnerungen, lokalen Vorlagen-IDs, Stunden-/Tarifprofile, Steuerdaten oder Gehaltspayloads werden akzeptiert. Farben/Symbole und freie Titel sind ausschließlich bestätigte Freigabedarstellung; im Verfügbarkeitsmodus werden alle Einträge neutral erzwungen.

Vollständige Snapshots sind bei maximal 10.000 Einträgen und 8 MiB begrenzt. Je Nutzer höchstens 20 eigene Kalender, je Kalender höchstens 20 gleichzeitig offene Einladungen. Eigentümergeräte sind fest gebunden; andere Geräte dürfen lesen, aber nicht versehentlich den veröffentlichten Snapshot ersetzen. Revisionen werden auf dem Server erhöht. Mutationsbelege sichern identische Wiederholungen und weisen andere Payloads mit demselben Schlüssel ab. Ein vollständiger Snapshot enthält implizite Löschungen; veraltete/falsche Cursor erhalten immer einen kompletten Ersatzsnapshot. Gleiches Revisionssignal liefert `unchanged=true`; es darf keinen Cache löschen.

Einladungstokens bestehen aus 32 kryptographisch zufälligen Bytes, serverseitig ausschließlich SHA-256-gehasht. Sie sind sieben Tage gültig, einmal annahmbar und widerrufbar. Sämtliche Übernahmeaktionen sind POST-RPCs; GET-Vorschauen verändern nichts. Kalender- und Einladungszeilen werden in derselben Reihenfolge gesperrt. Widerruf beendet neue Abrufe; ein offline befindlicher Empfänger kann bereits gesehene Daten behalten, bis der Client wieder Rechte prüft. Client-Cache muss beim Reconnect vor Darstellung überprüft und bei Entzug gelöscht werden.

## TDD und Prüfungen

1. RED: `supabase/tests/sharing-security.test.mjs` erstellt PostgreSQL-Rollen und einen minimalen `auth.uid()`-Stub. Die Tests schlugen zunächst wegen der fehlenden Migration fehl (`artifacts/calendar-sharing-backend/red.log`, Exit 1).
2. Implementierung: `supabase/migrations/202610120001_calendar_sharing.sql`.
3. GREEN: 19 Tests mit tatsächlichem PostgreSQL-WASM/PGlite 0.5.9 und pgcrypto bestehen (`artifacts/calendar-sharing-backend/green-expanded.log`, Exit 0). Prüfungen: ACL/RLS, anonym/fehlendes Konto, Definer-Suchpfad, Eigentümer/Gerät, private/unbekannte Felder, Bounds, Duplikate, Revision/Idempotenz, leere Snapshots/Cursor-Recovery, Einladungsdauer/-hash/-wiederholung, Freigabe nur nach Bestätigung, Leser-Schreibverbote, Entzug/Austritt, Kaskaden, alte JWTs nach Kontolöschung sowie Nachtdienst/DST.
4. `supabase/tests/calendar-sharing.pgtap.sql` ist eine transaktionale zusätzliche Supabase-Prüfung mit zurückgerollten Fixture-Konten. Sie wurde anschließend in LUNA Sharing Preview ausgeführt: 41 Prüfungen bestanden, die Fixture-Konten wurden durch Rollback entfernt. PGlite ersetzt weder GoTrue/PostgREST/JWT-Prüfung noch Mehrverbindungs-Concurrency-/Produktions-Provider-Tests.

Reproduktion ohne App-Abhängigkeitsänderung:

```powershell
npm.cmd install --prefix artifacts/calendar-sharing-backend/runtime --ignore-scripts --no-audit --save-exact @electric-sql/pglite@0.5.9
node --test supabase/tests/sharing-security.test.mjs
```

Die separate Testabhängigkeit wird nicht in die App eingebunden. Das Hauptprojekt und sein Lockfile bleiben durch dieses Backend-Paket unberührt.

## Vor Einrichtung/Build zu prüfen

- Neue Cloud-Preview-Umgebung in Frankfurt, getrennt von Regelpaketen und Production; Migration erst nach eindeutigem Zielabgleich anwenden.
- Google-/Apple-Provider und genaue interne Redirects konfigurieren; keine privilegierten Schlüssel in der App. Anonyme Auth-Accounts sind nicht für diese Funktion einzurichten.
- Vor aktivierter Apple-Kontolöschung Provider-Token serverseitig widerrufen. Die SQL-RPC löscht nur das eigene Auth-Konto und Cloud-Kaskaden; sie ersetzt den Apple-Widerruf nicht. Provider-Sessions und Refresh-Token-Kaskaden gegen echtes GoTrue prüfen.
- PostgREST-RPC-Aufrufe serverseitig nur POST erlauben. Insbesondere auch vermeintlich lesende RPCs prüfen das authentifizierte Konto; Link-GETs dürfen keine Übernahme-RPCs auslösen.
- Netzwerk-/Gateway-Rate-Limits und Payloadgröße ergänzen; keine Tokens oder Freigabeinhalte in Request-, SQL-Statement- oder Analytics-Logs aufnehmen.
- Regelmäßige Bereinigung abgelaufener/widerrufener Einladungshashes vorsehen. Mutationsbelege müssen solange erhalten bleiben, wie Offline-Retries möglich sind; keine zeitbasierte Löschung ohne Client-Reconciliation.
- Einladungsdomain und Universal Links, Backup/Löschkonzept, AVV/Datenschutzerklärung und Wiederherstellung separat operationalisieren.
- Echte Tests mit Eigentümer und Empfänger: zwei Konten/Geräte, Token-Erneuerung, Auth-Abbruch, Konto-/Gerätewechsel, Offline-Entzug, verspätete Uploads, parallele Claim-/Revoke-/Delete-Requests.

Der anfängliche lokale Paketstand wurde am 12.10.2026 ausschließlich in der separat freigegebenen LUNA Sharing Preview eingerichtet. Den aktuellen Betriebsstand und verbleibende Geräteprüfungen dokumentiert `calendar-sharing-preview-operations.md`. Keine Store-Veröffentlichung.
