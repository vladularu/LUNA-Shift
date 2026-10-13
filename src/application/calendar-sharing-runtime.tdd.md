# Kalenderfreigabe: Worker- und Provider-TDD

Stand 12.10.2026. Scope dieses Pakets: `calendar-sharing-runtime.ts`, `calendar-sharing-invite-url.ts`, die reinen Domain-Port-/UI-Verträge und `src/composition/calendar-sharing-provider.tsx`. Die bestehende lokale SQLite-/Auth-/Cloud-Infrastruktur wird über echte Adapter verwendet. Der App-Root und die reine Kalender-Darstellung bleiben Integrationsaufgaben des Hauptagenten.

## Nachgewiesene Journeys

- Optionales Konto; fehlende Cloud-Konfiguration bleibt explizit unverfügbar und liest/publiziert keine lokalen Inhalte.
- Bestätigte Verbindung des eigenen Plans, sichere Vorschau, bewusst ausgewählte Termine, neutrale sensible Abwesenheiten und Tageswechsel.
- Persistente atomare Outbox: Wiederholung nach Netzfehler erhält die Mutation; Bestätigung erst nach Serverantwort. Konflikt pausiert, ausdrückliche Veröffentlichung nimmt nach aktueller Revision wieder auf.
- Leser sehen nur ihr getrenntes Cache-Modell. Andere Geräte veröffentlichen nicht; Testlabor-Daten werden nicht hochgeladen.
- Berechtigungsentzug entfernt Kalender. Netzwerkfehler behalten die zulässige Offline-Ansicht maximal 24 Stunden. Verweigerte Session führt unmittelbar zur erneuten Anmeldung.
- Eigentümer verwalten Mitglieder/Einladungen; Leser verlassen ihre Freigabe. Account-IDs werden für Profil, Erstellung, Annahme, Verlassen und Kontolöschung bei Bestätigung erfasst und an die serverseitige Prüfung weitergegeben.
- Abmelden startet Keychain- und lokale Bereinigung sofort außerhalb einer möglicherweise hängenden Upload-Warteschlange. Alter Netzwerkabschluss aktualisiert weder Cache noch Bestätigung eines anderen Kontos.
- Apple-Löschung unterscheidet frische Freigabe, Abbruch und ausdrücklich bestätigten manuellen Widerruf. Erhalten bleiben eigene lokale Dienste, Einstellungen und Berechnungen.
- Native Composition aktualisiert im Vordergrund alle 15 Sekunden, stoppt im Hintergrund und entfernt Listener/Timer. Abgelaufene sichtbare Snapshots werden synchron vor dem Warten auf Netzwerkarbeit invalidiert.

## RED/GREEN

1. Erste Worker-, URL- und Provider-Tests scheiterten an der fehlenden Implementierung.
2. Der kontrollierte Konto-Wechsel während Apple-Identitätsprüfung reproduzierte einen unzulässigen Löschaufruf. Der unbedingte Epoch-Guard und die servergeprüfte erfasste Konto-ID schließen ihn.
3. Verweigerte Online-Session behielt zuvor fremden Cache. Reproduziert und auf sofortige Cache-/Session-Bereinigung geändert.
4. Verzögerte lokale Bereinigung konnte ein inzwischen neu angemeldetes Konto abmelden. Der Cleanup wurde epochgebunden und danach für durable Löschung sofort statt hinter dem Netzwerkqueue begonnen.
5. Ein hängender Upload blockierte Abmelden: RED mit null gestarteten Auth-Abmeldungen; GREEN startet genau eine unmittelbar und bestätigt den alten Upload nicht.
6. TTL-Prüfung wartete zuvor auf hängende Aktivierung: RED sichtbarer Cache `1` statt `0`; GREEN invalidiert vor jedem Await synchron. Die zwei Testkalender besitzen unterschiedliche IDs; eine frühere ungültige Fixture mit doppelter ID wurde korrigiert und zählt nicht als Verhaltens-RED.
7. Ein Eigentümer-Schalter versprach fälschlich, lokale eigene Dienste auszublenden: RED, dann auf fremde Kalender beschränkt.

Keine Checkpoint-Commits dieses Agenten; Git-Auslieferung bleibt beim Hauptagenten.

## Tatsächliche Prüfungen

```text
npm.cmd test -- src/application/calendar-sharing-runtime.test.ts src/application/calendar-sharing-invite-url.test.ts src/engine/sharing-publication-confirmation.test.ts
```

PASS: 40 Worker-, 3 URL- und 2 Snapshot-Signatur-Tests, zusammen 45.

```text
npx.cmd vitest run src/application/calendar-sharing-runtime.test.ts src/application/calendar-sharing-invite-url.test.ts src/engine/sharing-publication-confirmation.test.ts --coverage --coverage.include=src/application/calendar-sharing-runtime.ts --coverage.include=src/application/calendar-sharing-invite-url.ts --coverage.include=src/engine/sharing-publication-confirmation.ts
```

PASS, vorhandene Schwellen nicht geändert. Abdeckung: Statements 91,75 %, Branches 82,91 %, Functions 93,75 %, Lines 95,06 %.

```text
npm.cmd run test:components -- --runTestsByPath src/features/sharing/calendar-sharing.component.test.tsx src/features/sharing/sharing-ui-boundaries.component.test.tsx src/application/calendar-sharing-provider.component.test.tsx
```

PASS: 29 UI- und 3 echte Composition-/Context-Tests, zusammen 32. Keine übersprungenen Fälle beim abschließenden vollständigen gezielten Lauf.

Der eigene Scope wurde mit ESLint und `--max-warnings 0` ohne Warnungen geprüft und mit Prettier formatiert. Die gemeinsame abschließende Typprüfung, volle Verify-Gates, native Build-Abnahme und reale Zwei-iPhone-/Provider-Prüfung gehören dem Gesamtpaket.

## Grenzen und Einrichtung

Tests verwenden injizierte Doubles nur in Testdateien; Produktion enthält keine Fake-Anmeldung, Demo-Mitglieder oder simulierte Upload-Erfolge. Projekt-/Provider-/HTTPS-Einrichtung und echte Zwei-Geräte-Nachweise werden separat geprüft. Ohne absichtlich konfigurierte HTTPS-Einladungsbasis wird das passende interne/design/produktive App-Scheme verwendet. Universal Links und eine gehostete HTTPS-Landingpage benötigen die dafür genehmigte Konfiguration.

Widgets bleiben beim eigenen lokalen Kalender. Der geteilte Leser-Cache wird nicht in eigene Stunden, Lohn, Netto, Zuschläge, Prüfungen oder Exporte eingespeist. Auth-Tokens, private Datenbankinhalte und Serverkonfiguration werden weder angezeigt noch protokolliert.

## Restore-Gate und manuelle Updates

Manuelle Aktualisierungen bestehender Freigaben öffnen vor jeder Veröffentlichung eine frische, ausschließlich lokal vorbereitete Vorschau. `preparePublicationPreview` liest aktuelle Daten und bindet eine einmalige, kontospezifische Bestätigung an Generation, Sichtbarkeit, ausdrücklich ausgewählte Termine, Zeitzone und alle öffentlichen DTO-Felder. Abbrechen veröffentlicht nichts. Die Daten werden im Vorschauzustand nicht automatisch ausgetauscht.

Die Bestätigung verwendet `stageConfirmedSharingPublication` aus dem separat überprüften SQLite-Paket. Es prüft den aktuellen Datenstand in derselben Transaktion, bevor es eine pausierte Bindung wieder einschaltet oder eine Outbox erzeugt. Veränderte Daten oder Einwilligungen verwerfen die Bestätigung; die Oberfläche verlangt eine neue Vorschau. Frühere Sitzungen können Bestätigungen nicht wiederverwenden. Die bewusst bestätigte Erstfreigabe mit laufender Synchronisierung bleibt der eigene bestehende Pfad.

Regressionen wurden vor der Änderung rot ausgeführt: der Update-Button veröffentlichte sofort, lokale Termineinwilligung fehlte im UI-Vertrag, und die frische Prepare-API existierte nicht. Anschließend bestanden die gezielten UI-/Worker-Fälle. Die Projekt-Schwellen bleiben unverändert; DB-Transaktionsprüfungen gehören dem SQLite-Paket, abschließende Gesamtgates dem Hauptagenten.

Zusätzliche integrierte lokale Prüfungen nach dem Restore-Gate: 36 Architekturgrenzen-Tests und 15 SQLite-Tests zu Restore/atomarer Bestätigung bestanden. Eigene Dateien bestehen ESLint und Prettier ohne Warnungen.
