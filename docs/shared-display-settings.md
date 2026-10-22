# Anzeige geteilter Dienste

Ziel: Geteilte Dienste übernehmen die lokalen Anzeigeeinstellungen Name/Kürzel/Symbol, Startzeit und Gesamtdauer in der App und im Widget. Zielgerät ist das iPhone 14 Pro Max, Expo SDK 57.

Nicht-Ziele: Personenfarben ändern, eigene und fremde Daten zusammenführen, bestehende Berechtigungen oder Einladungen verändern. Die getrennte Auswahl sichtbarer Personen und des eigenen Kalenders bleibt bestehen. Commit, Push und Build sind nicht beauftragt. Am 21.10.2026 hat der Nutzer die Servermigration und anschließend ausschließlich eine iOS-Preview-OTA ausdrücklich freigegeben.

Basis: f819dc0, isolierter Branch codex/shared-display-settings.

Arbeitspaket 1: Gemeinsame Anzeige in Kalender und Widget. Die Widget-Projektion übernimmt auch den Symbolmodus einschließlich der Freigabesymbole. Native Renderer unterstützen diese Werte bereits. Scope: Kalender-Anzeige, Widget-Datenprojektion und zugehörige Tests.

Arbeitspaket 2 (vom Nutzer bestätigt): Pausen werden automatisch Bestandteil geteilter Dienstdetails, ohne zusätzlichen Schalter. Scope: Domain-DTO und Cloud-Port, Freigabeprojektion und Bestätigungssignatur, lokales Repository, Runtime-Cache, Cloud-Adapter, additive Supabase-Migration und zugehörige Tests. V1/V2-Antworten bleiben exakt kompatibel. V3 überträgt breakMinutes (null bedeutet unbekannt). Reine Verfügbarkeit, Termine und ganztägige Einträge übertragen keine Pause.

Vorhandene aktive Detailfreigaben werden einmal automatisch neu veröffentlicht; pausierte Freigaben bleiben pausiert. Bereits wartende Mutationen behalten ihren Payload und ihr RPC-Protokoll, bevor die neue Projektion folgt. Beim ersten V3-Abruf wird ein vorhandener Cache einmal vollständig erneuert. Ältere Einträge ohne Pause zeigen bei Gesamtdauer „–“, bis der Besitzer mit der aktualisierten App synchronisiert; 0 wird nicht unterstellt.

Rollout-Reihenfolge nach Freigabe: zuerst die additive Servermigration, dann eine kompatible iOS-Preview-OTA. Keine Swift-, Plugin-, SDK- oder Konfigurationsänderung. Migration und OTA wurden mit dieser Implementierung nicht live veröffentlicht. Beide beteiligten Apps müssen den neuen Stand verwenden und die Freigabe synchronisieren, damit alte Daten die Pause erhalten.

Abnahme: Alle Kombinationen der Zeit-/Dauereinstellungen sowie Name/Kürzel/Symbol, ganztägige Einträge, Nachtwechsel und Zeitumstellung; App und Widget müssen dieselben Informationen anzeigen. Personenstreifen und Sichtbarkeitsregeln bleiben erhalten. Gezielte Tests und verify:fast nach Abschluss; Sichtabnahme auf dem iPhone nach gesondert freigegebener Preview-Veröffentlichung.

Prüfstand 21.10.2026: Gezielte Anzeige-, Projektions-, Migrations-, Adapter- und Runtime-Tests bestanden. Der vorgeschriebene verify:fast-Lauf bestand Regelvalidierung, Typprüfung, Lint, Formatprüfung, 9.034 Unit-Tests und 1.282 Komponententests. Danach stoppte der Regelkatalog-CLI-Test beim Lesen seines temporären Git-Testprojekts. Derselbe unveränderte Test bestand mit einem kürzeren Windows-Temp-Pfad; alle 14 Skripte ab test:rules-publisher wurden mit diesem Pfad erfolgreich nachgeholt, einschließlich 50 Freigabe-Datenbanktests sowie nativer Widget-Vertragsprüfungen. git diff --check bestanden. Keine Anwendungskorrektur oder Testlockerung für den Umgebungsfehler.

Prüfprotokolle lokal: artifacts/shared-display-verify-fast.log und artifacts/shared-display-verify-rest.log. Es gab keinen einzelnen vollständig grünen verify:fast-Aufruf; alle enthaltenen Prüfungen sind auf dem unveränderten Anwendungsstand erfolgreich abgeschlossen. Live-Supabase-Migration, OTA und physische iPhone-Abnahme stehen aus.
