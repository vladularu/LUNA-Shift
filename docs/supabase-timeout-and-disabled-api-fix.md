# Sharing-Timeout und deaktivierte Production Data API

## Auftrag und Abnahme

- Ziel: Erst den Sharing-Publisher unter das bestehende Acht-Sekunden-Budget bringen,
  danach die PostgREST-Fehlerschleife im dedizierten Production-Katalogprojekt beenden.
- Plattform: gehostetes PostgreSQL 17; keine App-, UI-, Native-, Runtime- oder OTA-Änderung.
  Der isolierte Checkout basiert auf origin/master dd20bd45, Expo ~57.0.32 / SDK 57.
- Dateiscope: eine neue Sharing-Migration, ihre Rücksetzung und Serverprüfung,
  zwei ausschließlich für Production bestimmte Operationsskripte,
  lokale PostgreSQL-Tests und dieses Dokument.
- Nicht-Ziele: Data API oder Production-Katalogauslieferung aktivieren,
  Zeitlimits erhöhen, RLS- und Besitzprüfungen umgehen, Nutzerkalender verändern.
- Abnahme: 1.000 Einträge unter acht Sekunden; bestehende Sharing-Sicherheitstests grün;
  ungültige Zeitzonen atomar abweisen; Wiederholungen idempotent;
  Serverprobe komplett zurückrollen; Production-Schema leer und ohne App-Rollenrechte;
  frische Production-Logs nach der Korrektur ohne den bisherigen Schemafehler.
- Freigabe: Nutzerauftrag vom 16.11.2026 für beide Backend-Korrekturen.
  Nach erfolgreicher iPhone-Abnahme wurden Commit, Push, Pull Request und Merge
  nach grüner CI ausdrücklich beauftragt.

## Arbeitspaket 1: Sharing

Projekt: flpwvfqywvnvhfkjbcnf, LUNA Sharing Preview.

Der Basis-Publisher wird auch von v2 und v3 aufgerufen. Er scannte bisher für jeden
Eintrag pg_timezone_names. Ein gemessener einzelner Server-Scan benötigte ca. 18 ms;
450 Einträge reichen damit bereits aus, das Acht-Sekunden-Limit zu erreichen.

Die neue Migration lädt die vom selben PostgreSQL-Server anerkannten Zeitzonennamen
einmal pro Veröffentlichung in ein lokales Array. Alle übrigen Prüfungen sowie die
Funktionsidentität, SECURITY DEFINER, der feste search_path und die vorhandenen
EXECUTE-Rechte bleiben bestehen. Alte Migrationen werden nicht nachträglich geändert.

Lokaler Regressionstest mit 1.000 v3-Einträgen: vorher 19.660 ms und fehlgeschlagene
Budgetprüfung, nachher 190–219 ms. Bestehende Sharing-/Cloud-Verträge: 59 Tests grün
vor Ergänzung der zusätzlichen Operationsprüfungen.

Die Serverprüfung in
supabase/operations/sharing-publish-timezone-cache-verification.sql erzeugt zufällige
synthetische Konten, Sessions und Kalender nur innerhalb einer Transaktion. Sie
prüft Veröffentlichung, gespeicherte Inhalte, Wiederholung und ein ungültiges Update
mit 1.000 Einträgen. Alles einschließlich Realtime-Nachrichten wird zurückgerollt.
Das Operationsskript wird auch lokal mit PGlite getestet.

Rückweg: supabase/operations/sharing-publish-timezone-cache-rollback.sql stellt nur
den vorherigen Funktionsrumpf wieder her; damit käme auch dessen Performanceproblem zurück.

## Arbeitspaket 2: Production-Katalog

Projekt: ajccsftbgsvfmuwirjux, PflegeShift Rule Catalog Production.

Das Projekt hat keine öffentlichen Anwendungstabellen, einen leeren Katalog-Bucket
und eine deaktivierte Data API. Die Meldung zum fehlenden Schema
pg_pgrst_no_exposed_schemas ist ein dokumentiertes Supabase-Verhalten bei deaktivierter
Data API. PostgREST läuft weiter und wiederholt dabei erfolglose Schemaabfragen.

Die am 04.11.2026 aktualisierte offizielle Anleitung beschreibt einen Rückweg:
ein reguläres, leeres Schema pgrst_no_exposed_schemas anlegen, die Rolle authenticator
über pgrst.db_schemas ausschließlich darauf verweisen und PostgREST neu laden.
Der reservierte Präfix pg_ wird nicht für eigene Schemas verwendet.

Quelle:
https://supabase.com/kb/troubleshooting/schema-pg_pgrst_no_exposed_schemas-does-not-exist

Operationsskript:
supabase/operations/rule-catalog-production-disabled-api.sql.
Es gehört absichtlich NICHT in die gemeinsamen Sharing-Migrationen. Vorbedingungen
verhindern eine Anwendung auf ein Sharing-Projekt, öffentliche Anwendungstabellen
oder ein nichtleeres Platzhalterschema. Alle Rechte für PUBLIC, anon, authenticated
und service_role werden am leeren Schema entzogen. Andere Rollenparameter bleiben erhalten.

Lokale Tests prüfen Ausführung und Wiederholung, fehlende App-Rollenrechte, leeres
Schema, unveränderten lock_timeout, den Rollback und abgelehnte falsche Zielumgebungen.

Rückweg: supabase/operations/rule-catalog-production-disabled-api-rollback.sql setzt
nur den neuen Rollenparameter zurück und lädt PostgREST neu. Das leere Schema bleibt
ohne Zugriff erhalten. Vor einer später ausdrücklich beauftragten Aktivierung der Data API
muss dieser Override zurückgenommen werden.

## Ausführung und Nachweise

Sharing live angewendet am 16.11.2026 um 23:35:56 MEZ. Die registrierte Migration
20261116223556_sharing_publish_timezone_cache.sql ist im Checkout mit derselben
Versionsnummer abgelegt.

Die Live-Serverprobe veröffentlichte 1.000 Einträge in 195,29 ms und bestätigte Revision 1,
idempotente Wiederholung sowie atomare Abweisung einer ungültigen Zeitzone.
Nach dem abschließenden ROLLBACK blieben keine synthetischen Nutzer zurück.
Die Funktion hat weiterhin exakt die vorherigen EXECUTE-Rechte
(postgres und authenticated) und den leeren search_path. Der Quellstand wurde
vor der Anwendung gegen den gelesenen Live-Rumpf abgeglichen.

Production live angewendet vor 23:39 MEZ. Die anschließende SQL-Kontrolle zeigte:
leeres Schema vorhanden, null Relationen, null Funktionen, keine USAGE-Rechte
für anon oder authenticated, ausschließlich der erwartete pgrst.db_schemas-Override.
Die Dashboard-Einstellung blieb ausdrücklich „Data API is disabled“.
Die frischen Postgres-Fehlerlogs von 23:39:15 bis 23:41:17 MEZ enthielten null Fehler.
Das deckt mehrere der zuvor ungefähr alle 32 Sekunden wiederholten Fehlerversuche ab.
Historische Fehler bleiben im Dashboard erhalten; das Beobachtungsfenster ist keine
Garantie für alle zukünftigen Anfragen.

Prüfungen:

- 11.096 Unit-Tests in 595 Dateien und 2.115 Komponententests in 222 Suites bestanden.
- Regelkatalog-, TypeScript-, Lint- und Formatprüfungen bestanden.
- Der erste vollständige verify:fast-Lauf wurde nur durch fünf EPERM-Fehler beim
  Erstellen von Symlinks in Windows-Sandbox-Testfixtures unterbrochen.
- Die betroffene Audit-Suite bestand danach mit normalen Windows-Dateisystemrechten:
  158 Tests erfolgreich. Alle abgebrochenen Folgestufen wurden ebenfalls erfolgreich
  nachgeholt, einschließlich 61 Sharing-/Cloud-/Operations-Tests. Ein bereits
  plattformbedingt übersprungener Runtime-Test blieb übersprungen.
- Der ursprüngliche verify:fast-Prozess hatte somit Exit 1; die verbleibenden
  erforderlichen Prüfstufen wurden separat mit Exit 0 abgeschlossen.
- Die zwei gezielten Tests für das deaktivierte Data-API-Schema bestanden.
- Lokale und gehostete Serverprobe wurden vollständig zurückgerollt.
- Git-Auslieferung über Branch codex/supabase-sharing-timeout und Pull Request;
  Merge erst nach erfolgreicher Pull-Request-CI.

## iPhone-Abnahme

Der Nutzer hat den bestehenden Sharing-Flow auf zwei iPhones geprüft und bestätigt:
Anlegen, Ändern und Löschen werden jeweils auf das zweite iPhone übertragen.
Damit sind die drei betroffenen Sharing-Aktionen im praktischen Einsatz abgenommen.
Gerätemodell, OS-Version und Build-/OTA-ID wurden bei dieser Rückmeldung nicht angegeben.
