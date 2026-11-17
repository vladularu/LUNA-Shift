# Supabase-Sicherheitswarnungen

## Auftrag und Abnahme

Ziel: Verbleibende Security-Advisor-Befunde in allen drei Supabase-Projekten prüfen und unnötige Rechte entziehen. Plattform: PostgreSQL/Supabase, ohne UI- oder Native-Änderung. Expo bleibt SDK 57 (`~57.0.32`); Referenz: <https://docs.expo.dev/versions/v57.0.0/>.

Dateiscope: eine SQL-Migration, ein lesendes Prüfskript, Plattform- und Sharing-Sicherheitstests sowie dieses Dokument. Nicht-Ziele: RPC-Architektur umbauen, Warnungen pauschal ausblenden, interne Tabellen direkt freigeben oder OTA/Build veröffentlichen. Branch: `codex/supabase-security-warnings`. Der unabhängige App-Checkout bleibt unberührt.

Abnahme: App-Rollen dürfen den internen Event-Hook nicht ausführen; automatische RLS-Aktivierung muss weiter funktionieren. Alle 31 vorgesehenen Nutzer-RPCs behalten ihre bestehenden Definitionen und Zugriffsschranken. Sharing-, Cloud- und `verify:fast`-Tests müssen bestehen. Live werden Rechte, Event-Trigger, Funktionsdefinitionen und Advisors erneut geprüft.

## Befunde vor der Änderung

| Projekt                                          | Security-Warnungen | Bewertung                                                                                            |
| ------------------------------------------------ | -----------------: | ---------------------------------------------------------------------------------------------------- |
| LUNA Sharing Preview (`flpwvfqywvnvhfkjbcnf`)    |                 33 | Zwei unnötige EXECUTE-Freigaben für `public.rls_auto_enable()`; 31 vorgesehene authentifizierte RPCs |
| Preview-Regelkatalog (`okcxmmekwyuuiqthmydo`)    |                  2 | Dieselben unnötigen Freigaben für `rls_auto_enable()`                                                |
| Production-Regelkatalog (`ajccsftbgsvfmuwirjux`) |                  0 | Data API bleibt deaktiviert                                                                          |

`rls_auto_enable()` ist ein interner `SECURITY DEFINER`-Event-Hook, kein App-Endpunkt. Seine implizite PUBLIC-Ausführbarkeit vererbt sich an `anon` und `authenticated`. Die Migration entzieht nur EXECUTE für diese Rollen. Funktionskörper, Eigentümer, fester `search_path=pg_catalog` und Event-Trigger `ensure_rls` bleiben erhalten. Die Migration ist wiederholbar und überspringt lokale Datenbanken ohne den Supabase-Hook; bei einer unerwarteten gleichnamigen Funktion bricht sie ab.

## Geprüfte, absichtlich privilegierte RPCs

Die 31 weiteren Warnungen entsprechen der bestehenden API: 27 Sharing- und vier private Cloud-Funktionen. Nur `authenticated` erhält EXECUTE; `anon` und PUBLIC erhalten es nicht. Jede Funktion setzt einen leeren `search_path`, enthält kein dynamisches SQL und prüft die echte Nutzer-/Sitzungsidentität direkt oder über geschützte Helfer. Der Live-Abgleich prüft auch Überladungen, nicht nur Namen.

| Funktionengruppe                                                                                                                                                                                                                                                                                         | Zugriffsschutz                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `sharing_capabilities`, `sharing_capabilities_v3`, `sharing_profile_photo_capabilities`                                                                                                                                                                                                                  | Gültiger Nutzer und vorhandene, zum Nutzer gehörende, nicht abgelaufene Sitzung                                       |
| `sharing_save_profile`, `sharing_create_calendar`, `sharing_claim_invite`, `sharing_leave_calendar`, `sharing_delete_account`                                                                                                                                                                            | Sitzung plus erwartete Kontoidentität; Einladungs-, Mitgliedschafts- bzw. Löschregeln                                 |
| `sharing_list_calendars`, `sharing_fetch_calendar`, `sharing_fetch_calendar_v2`, `sharing_fetch_calendar_v3`, `sharing_get_profile_photo`                                                                                                                                                                | Eigentümer oder aktive Mitgliedschaft; freigegebene Inhaltsrechte, Profilfoto nur mit gesonderter Einwilligung        |
| `sharing_publish_calendar`, `sharing_publish_calendar_v2`, `sharing_publish_calendar_v3`                                                                                                                                                                                                                 | Kalendereigentümer, Gerätegeheimnis, Revision, Mutation und begrenzte/validierte Nutzdaten                            |
| `sharing_create_invite`, `sharing_create_invite_v2`, `sharing_create_invite_v3`, `sharing_list_members`, `sharing_list_members_v2`, `sharing_list_members_v3`, `sharing_set_member`, `sharing_set_member_rights`, `sharing_set_member_profile_photo`, `sharing_revoke_invite`, `sharing_delete_calendar` | Eigentümerprüfung; zusätzliche Eingabe-, Status- und Einwilligungsregeln je Operation                                 |
| `private_cloud_head`, `private_cloud_read`, `private_cloud_history`, `private_cloud_write`                                                                                                                                                                                                               | Sitzung und erwartete Kontoidentität; ausschließlich eigene Cloud-Daten, bestätigte E-Mail-Identität soweit vorhanden |

Supabase beschreibt solche beabsichtigten Nutzeroperationen ausdrücklich als zulässigen Fall des Advisors: [SECURITY DEFINER für authenticated, Option 3](https://supabase.com/docs/guides/observability/advisors?lint=0029_authenticated_security_definer_function_executable). Das pauschale Entziehen dieser Rechte würde die bestehenden App-Funktionen unterbrechen. Die Warnungen werden deshalb als geprüfte Architekturentscheidung dokumentiert und bleiben im Advisor sichtbar; sie werden nicht global unterdrückt. Neue privilegierte Signaturen müssen den exakt begrenzten Testvertrag erweitern.

Vier zusätzliche INFO-Befunde „RLS enabled, no policy“ betreffen `luna_private_cloud.accounts`, `.mutations`, `.snapshots` und `luna_sharing.invite_joins`. Alle liegen in internen Schemas, haben RLS und keinerlei direkte SELECT/INSERT/UPDATE/DELETE-Rechte für App-Rollen. Der Zugriff erfolgt ausschließlich über geprüfte RPCs. Ohne Policy gilt bewusst Default-Deny; eine freizügige Policy wäre hier eine Verschlechterung.

## Prüfung und Rücknahme

`platform-security.test.mjs` prüft den Rechteentzug samt Wiederholung, unveränderten Hook und weiterhin automatisch geschützte neue Tabellen. Der Sharing-Vertrag erfasst genau die 31 vorgesehenen privilegierten Signaturen und ruft jede mit fehlender, fremder und nicht vorhandener Sitzung auf; jeder Aufruf muss vor Nutzdatenverarbeitung scheitern. Die bestehenden Verhaltenstests decken Kontowechsel, widerrufene/abgelaufene Sitzungen, Eigentümer-/Mitgliedsgrenzen, Einwilligungen, Idempotenz und Cloud-Isolation ab.

Die Live-Prüfung erfolgt mit `supabase/operations/security-warning-verification.sql` und einem erneuten Advisor-Lauf. Die Änderung enthält keine Datenmigration. Eine Wiederherstellung der zuvor impliziten PUBLIC-Ausführbarkeit wäre mit `GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO PUBLIC` möglich, würde aber die behobenen Warnungen wieder öffnen und ist nur bei einem konkret nachgewiesenen Plattformproblem sinnvoll.

## Live-Ergebnis am 17. November 2026

- Sharing: Migration `20261116233508_harden_rls_auto_enable_execute` erfolgreich angewendet. Keine anon- oder authenticated-Freigabe für den internen Hook und keine PUBLIC-Freigabe mehr. `ensure_rls` ist weiterhin aktiviert. Die Definitionen aller 40 geprüften privilegierten Funktionen sind gegenüber der vorherigen Inventur identisch, einschließlich aller 31 App-RPCs.
- Zusätzlich wurden alle 31 App-RPC-Signaturen direkt in der Live-Datenbank als `authenticated` mit einer erfundenen Nutzer-/Sitzungsidentität und typisierten NULL-Argumenten aufgerufen. Jede wurde mit `42501 / SHARE_UNAUTHENTICATED` abgewiesen. Die Prüfung lief in einer anschließend zurückgerollten Transaktion; es wurden keine Testnutzer angelegt.
- Alle zehn internen Anwendungstabellen behalten RLS und verweigern beiden App-Rollen weiterhin direkte CRUD-Rechte.
- Sharing-Advisor nach der Migration: **0 ERROR, 31 WARN, 4 INFO**. Die beiden Hook-Warnungen sind behoben; die verbleibenden 31 RPC-Warnungen und vier Default-Deny-Infos entsprechen dem oben geprüften Modell.
- Preview-Regelkatalog: derselbe Rechteentzug über den angemeldeten Dashboard-SQL-Editor. Funktionshash vor/nach der Änderung `6998ea6b4c2480f5d2e34b5dcf3f8d36`, Event-Trigger weiterhin `O`. Der neu ausgeführte Advisor meldet **0 ERROR, 0 WARN, 0 INFO**.
- Production-Regelkatalog: Advisor neu ausgeführt, weiterhin **0 ERROR, 0 WARN, 0 INFO**; keine Änderung nötig.

Gezielter Testlauf: `npm.cmd run test:sharing-security` bestanden, **63 äußere Tests** einschließlich der isolierten privaten Cloud-, Data-API- und neuen Plattform-Sicherheitstests. Die beiden Plattformtests bestätigen auch die automatische RLS-Aktivierung nach dem Rechteentzug.

Der vollständige `npm.cmd run verify:fast`-Check ist mit Exitcode 0 bestanden: Regelverträge, Typecheck, Lint, Formatierung, 11.096 Unit-Tests, 2.115 Komponententests und sämtliche nachfolgenden Skript-/Sicherheitstests einschließlich `git diff --check`. Ein plattformspezifischer Runtime-Policy-Test ist unter Windows regulär übersprungen. Der erste Check wurde beim Abgleich des lokalen Migration-Zeitstempels mit der Serverversion durch eine gleichzeitige Dateiumbenennung im Formatierungsscan unterbrochen; der vollständige erneute Lauf mit endgültigem Dateinamen ist grün.

Die Live-Korrektur ist bereits aktiv. Die fünf zugehörigen Repository-Dateien werden über `codex/supabase-security-warnings` ausgeliefert; der Merge nach `master` erfolgt erst nach grüner Pull-Request-CI.
