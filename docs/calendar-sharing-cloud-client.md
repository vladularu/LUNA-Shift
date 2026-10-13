# Cloud-Adapter und sichere Kontolöschung

## Scope und Vertrag

Dieses Paket implementiert den tatsächlichen Supabase-RPC-Adapter (`src/infrastructure/sharing/cloud-sharing-client.ts`) und die Edge Function `sharing-delete-account`. Die lokale SQLite-Veröffentlichung/Outbox, Auth-Provider, UI und SQL-Migrationen gehören zu getrennten Paketen. Expo-Version geprüft: SDK 57, Supabase-JS 2.117.3. Bestehende Tarif-, Zuschlags-, Netto- und Exportberechnungen bleiben außerhalb dieses Pakets.

`createCloudSharingClient(client)` akzeptiert einen echten SupabaseClient bzw. dessen strukturelle `rpc`-/`functions`-Transportschnittstelle und exportiert `CloudSharingClient`. Methoden: `saveProfile`, `createCalendar`, `publish`, `listCalendars`, `fetch`, `createInvite`, `claimInvite`, `listMembers`, `setMember`, `revokeInvite`, `leaveCalendar`, `deleteCalendar`, `deleteAccount`.

Die Konfiguration/Authentifizierung kommt vom vorhandenen `getSharingSupabaseClient()`. Fehlt die öffentliche Sharing-Konfiguration, darf kein Cloud-Adapter/Controller aktiviert werden. Nur `EXPO_PUBLIC_SHARING_SUPABASE_URL` und `EXPO_PUBLIC_SHARING_SUPABASE_PUBLISHABLE_KEY` gehören in die App; niemals Service-Role- oder Apple-P8-Schlüssel.

Erstellung und Veröffentlichung übertragen `p_device_secret` als 64-stelliges Kleinbuchstaben-Hex-Geheimnis zusätzlich zu `p_device_id`. Die App darf dieses Geheimnis nicht in Kalenderantworten, Logs, Einladungen oder fremden Cachezeilen ausgeben. Der Adapter stellt Argumente einzeln zusammen und akzeptiert exakt acht Freigabefelder pro Eintrag. Private zusätzliche Felder werden vor dem Netzwerkzugriff abgewiesen.

Jede untrusted Antwort wird zur Laufzeit geprüft: exakte Objektfelder, UUIDs, sichere Ganzzahlrevisionen, Enumwerte, Farben/Symbole, ISO-Zeitpunkte, Zeitzonen, Listengrenzen, doppelte IDs und erwartete Kalender-/Teilnehmer-IDs. Snapshots müssen die Revision ihrer Metadaten teilen. `unchanged=true` benötigt denselben angefragten Cursor, `reset=false` und eine leere Antwortliste; vollständige Ersatzsnapshots müssen `reset=true` sein. Verfügbarkeit erzwingt neutrale Darstellung. Rückgabewerte werden kopiert und eingefroren. Fehler geben ausschließlich einen bekannten `SharingCloudError.code` aus, keine Serverdetails, Tokens oder Payloads.

## Edge-Function-Löschung

Die App ruft für alle Provider `client.functions.invoke('sharing-delete-account', {body})` auf. Body: erforderliche `expectedAccountId` als UUID der ausdrücklich bestätigten Kontolöschung und optional `appleAuthorizationCode`; keine frei wählbare Ziel-ID und kein Kalender-/Token-Payload. Auth-JWT kommt über den normalen Supabase-Client-Header. Rückgabe:

```ts
{ deleted: true, revocationStatus: 'not_applicable' | 'revoked' | 'manual_required' | 'unconfirmed' }
```

Ablauf:

1. Nur POST und JSON akzeptieren; Header, Body und Code begrenzen, keine unbekannten Felder.
2. Das reale aktuelle GoTrue-Konto mit `auth.getUser(accessToken)` auflösen und vor jeglichem Widerruf/Löschen mit `expectedAccountId` vergleichen. Bei Kontowechsel A → B die Anfrage mit `SHARE_ACCOUNT_MISMATCH` abweisen. Die bestätigte ID ist nur eine Assertion; einzig die authentifizierte aktuelle ID darf Löschziel sein.
3. Mit dem Nutzer-JWT `sharing_list_calendars` aufrufen. Dessen SQL-Actor-Guard prüft die tatsächlich noch bestehende `auth.sessions`-Session, `session_id`, Konto und Sperren. Ein lediglich unexpired, bereits widerrufenes JWT reicht nicht aus.
4. Falls Apple verknüpft ist und ein frischer Code vorliegt: einen kurzlebigen ES256-Client-Secret-JWT aus ausschließlich serverseitigen Apple-Secrets erzeugen; Code bei Apple austauschen; Apple-ID-Token anhand öffentlicher RS256-JWKS-Signatur, Issuer, Audience, Ablauf/Ausgabezeit und **Apple-sub des aktuell authentifizierten Supabase-Kontos** prüfen. Erst danach den zurückgegebenen Refresh-/Access-Token widerrufen. Falsche Signatur, falsche Identität oder falsche Claims blockieren Löschung und Widerruf.
5. Nach dem möglicherweise langsamen Provideraufruf die echte Session erneut prüfen.
6. Ausschließlich die bei GoTrue aufgelöste Nutzer-ID mit Service-Role `auth.admin.deleteUser(user.id, false)` löschen; Kaskaden entfernen eigene Freigaben und Fremdmitgliedschaften. Lokale Dienste, Gehaltsdaten und Einstellungen werden nicht verändert.

Code, ID-/Refresh-/Access-Token und generiertes Apple-Client-Secret bleiben nur für diesen Request im Speicher. Keine Persistenz und kein Logging. Providerrequests gehen ausschließlich an `https://appleid.apple.com`, folgen keinen Redirects und haben pro Versuch fünf Sekunden Timeout. Netzwerkfehler, 429 und 5xx werden innerhalb des Requests höchstens dreimal versucht.

## Apple-Fallback und UI

Apples TN3194 verlangt auch dann Kontolöschung, wenn kein Code oder Token mehr verfügbar ist. Daher löscht ein ausdrücklich bestätigter, aktuell authentifizierter Nutzer weiterhin ausschließlich sein eigenes Konto. Ohne Code bzw. bei `invalid_grant` lautet die Antwort `manual_required`. Ein Apple-Ausfall oder erfolgloser Widerruf lautet `unconfirmed`; dies behauptet keinen erfolgten Providerwiderruf. Die App muss sich nach Erfolg abmelden, die Auth-Secrets entfernen und bei beiden Statuswerten einen Hinweis geben, den LUNA-Zugriff zusätzlich unter „Mit Apple anmelden“ im Apple-Konto zu beenden. Sie darf eine bereits erfolgreiche Kontolöschung nicht anschließend als fehlgeschlagen melden. [Apple TN3194](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple), [Apple TN3107](https://developer.apple.com/documentation/technotes/tn3107-resolving-sign-in-with-apple-response-errors)

Ein gültiger, aber einem anderen Apple-Konto zugehöriger Code ist **kein** Fallback: die Anfrage wird mit `SHARE_APPLE_IDENTITY_MISMATCH` abgewiesen. Auch vor/nach Provideraufruf widerrufene Supabase-Sessions führen zu Abbruch. GoTrue-/SQL-/Admin-Ausfälle liefern stabile Fehler und verursachen keine unerlaubte Fremdlöschung.

## Deployment-Konfiguration

Deployment erst nach genehmigter eigener Cloud-Preview-Umgebung und Live-Rechteprüfung. Kein Deployment erfolgte in diesem Arbeitspaket. Function-Name exakt: `sharing-delete-account`.

Standard-Supabase-Secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (ausschließlich Function-Runtime). Apple-Secrets: `SHARING_APPLE_TEAM_ID`, `SHARING_APPLE_KEY_ID`, `SHARING_APPLE_CLIENT_ID`, `SHARING_APPLE_PRIVATE_KEY` (PKCS8-P8, echte oder escaped Zeilenumbrüche). `SHARING_APPLE_CLIENT_ID` muss dem für diesen Preview-Build registrierten App-/Services-ID-Audience entsprechen. Preview und Production dürfen keine Secrets, Redirects oder Projekte vermischen.

Die Gateway-JWT-Prüfung für diesen authentifizierten Endpunkt eingeschaltet lassen (`verify_jwt = true`). Zusätzlich wird das reale Konto und seine Session im Handler geprüft; es werden keine neuen Auth-REST-/Tabellengrants benötigt. Die Funktionen dürfen weder anonym noch über GET-Klicks Kontolöschung auslösen. [Supabase Edge-Auth](https://supabase.com/docs/guides/functions/auth)

## Prüfungen

- TDD RED vor Implementierung: fehlender Adapter/Handler/Apple-Service (`artifacts/calendar-sharing-backend/cloud-red.log` und `apple-red.log`, Exit 1).
- GREEN: 47 gezielte Vitest-Tests bestehen (`interval-bound-green.log`, Exit 0): genaue RPC-Argumente, geheime Gerätebindung, DTO-/Privatsphäre-Negativfälle, Cachecursor, Mitglieder/Einladungen, sichere Fehlermeldungen, reine Selbstlöschung, alte Session trotz `getUser`, Sessionentzug während Austausch, Apple-Fallbacks und echte ES256-/RS256-Kryptographie einschließlich negativer Identitäts-/Signaturfälle.
- Gezieltes ESLint für `src/infrastructure/sharing` bestanden.
- Tatsächlicher Deno 2.9.6-Check des Function-Bootstraps samt gepinntem SDK-Import bestanden (`edge-deno-check.log`, Exit 0). Deno-Binärdatei/Cache ausschließlich unter Testartefakten; App-Abhängigkeiten nicht geändert.
- Vollständige Root-Typprüfung wird im Integrationspaket erneut ausgeführt; erster Lauf fand einen dortigen SQLite-Bind-Fehler und einen inzwischen korrigierten absichtlich falschen Test-Payload.

Offen: echter GoTrue-/PostgREST-Sessionentzug, Provider-Einrichtung und Apple-Code-/Widerruf auf dem Zielgerät, parallele reale Sessions und Kontolöschung, Live-Function-Deployment und Zwei-iPhone-Abnahme. Mock-, PostgreSQL-WASM- und Deno-Checks belegen diese Schritte nicht.

## Bindung an die bestätigte Kontoauswahl

`cloud.deleteAccount(expectedAccountId, appleAuthorizationCode?)` ist die verbindliche Signatur. Die UI hält die bei der Bestätigung erfasste Nutzer-ID bis zum Request fest. Ein Wechsel der SDK-Session darf diese ID nicht ersetzen. Fehlende/falsche UUIDs werden vor jeder Cloud-Aktion abgewiesen; eine andere real authentifizierte Nutzer-ID verursacht `SHARE_ACCOUNT_MISMATCH`. RED für den bisher akzeptierten fehlenden Konto-Bezug und GREEN für den A/B-Wechsel liegen unter `artifacts/calendar-sharing-backend/delete-binding-*.log`. Zusätzliche Adaptertests erhalten ausschließlich die bekannten Codes `SHARE_RATE_LIMIT` und `SHARE_PROVIDER_REVOKE_REQUIRED`, niemals deren private Details.

## Actor-Bindung für neue Objekte und Austritt

Folgende API-Signaturen verlangen die bei der Nutzeraktion erfasste Konto-ID:

- `saveProfile(expectedAccountId, displayName)`
- `createCalendar({ expectedAccountId, id, deviceId, deviceSecret, name, color, visibility })`
- `claimInvite(expectedAccountId, token, displayName)`
- `leaveCalendar(expectedAccountId, calendarId)`

Jede RPC erhält `p_expected_actor_id`. Der Server vergleicht diese Assertion mit dem real authentifizierten Actor, bevor er Profile schreibt, neue Eigentümerkalender anlegt, eine einmalige Einladung verbraucht oder eine Mitgliedschaft verlässt. Besitzer-/Empfänger-IDs kommen weiterhin ausschließlich vom serverseitig authentifizierten Konto. Kontoänderungen nach einer Bestätigung dürfen niemals eine neue Assertion erzeugen. Der Client validiert außerdem die Rückgabe von `saveProfile.userId` und `createCalendar.ownerId` gegen das erwartete Konto. Fehlende/malformed Assertions werden bereits vor dem Netzwerkzugriff abgewiesen. Actor-/Leave-RED und finale42-Tests-GREEN liegen unter `artifacts/calendar-sharing-backend/actor-binding-*.log` und `leave-binding-red.log`.

## Zeitliche Größe eines Eintrags

Upload und Abruf akzeptieren ausschließlich positive Intervalle von höchstens 48 tatsächlich verstrichenen Stunden. Die Grenze gilt gleichermaßen für Ganztags- und zeitlich angegebene Einträge. Verglichen werden `Temporal.Instant`-Zeitpunkte; dadurch bleibt ein 25-Stunden-Tag beim Herbst-DST-Wechsel korrekt darstellbar. Ein Intervall von 48 Stunden plus einer Mikrosekunde wird abgewiesen. Die passende SQL-Grenze wird im separaten Sicherheits-Paket durchgesetzt. RED/GREEN belegen Vorabablehnung des Uploads sowie Ablehnung untrusted Antworten (`interval-bound-*.log`).

## Edge-Import und ESZip-Größengrenze

Der Edge-Bootstrap verwendet ausschließlich diesen versionsgepinnten vorgebündelten SDK-Import:

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3?bundle&target=deno";
```

App-Imports und npm-Abhängigkeiten bleiben unverändert. Der direkte Edge-npm-Import zog neun vollständig ausgepackte Pakete mit 8.081.664Bytes bzw. 7.526.861Bytes selbst nach Inhalts-Deduplizierung. Supabases ESZip-VFS packt die aufgelösten Packageverzeichnisse rekursiv als opaque Daten ein. Das überschreitet die dokumentierte 5 MB-Grenze des serverseitigen Management-API-/Dashboard-Bundlers. Der generische Deployment 500 benannte seine Ursache nicht; die Größenüberschreitung ist ein unabhängig reproduzierbarer Packaging-Befund. [Supabase Bundlegröße](https://supabase.com/docs/guides/troubleshooting/edge-function-bundle-size-issues), [Supabase VFS](https://github.com/supabase/edge-runtime/blob/main/crates/deno_facade/eszip/vfs.rs)

Der ESM-Kandidat besitzt 0 npm-VFS-Pakete; der komplette Deno-Importgraph einschließlich Typdeklarationen hat 2.305.352Bytes, das isolierte JavaScriptbundle 813.037Bytes. Das tatsächliche SDK-ESM-Modul (`https://esm.sh/@supabase/supabase-js@2.117.3/deno/supabase-js.bundle.mjs`) ist 227.553Bytes groß; beobachteter SHA256: `215B50E7A1DE607CFA5D492E5C06DD30815E70E045FFA8BDE301CB9EEECB3470`.

Zusätzlich zum neueren Deno-Check wurde die aktuell in der öffentlichen Edge-Runtime-Quelle benannte Deno-Version 2.1.4 aus dem offiziellen Deno-Release bezogen und gegen dessen offiziellen SHA256 geprüft. Typecheck und tatsächlicher SDK-Import mit `getUser`, Session-RPC und `admin.deleteUser` gegen ausschließlich lokale Mock-Requests bestehen auch dort. Netz- und Env-Zugriff waren im Methodentest verweigert. Artefakte liegen unter `artifacts/calendar-sharing-backend/deploy-diagnosis/`; Bootstrap-Packaging-RED/GREEN schützt den Import vor erneutem npm-VFS-Wachstum. [Supabase Runtimeversion](https://github.com/supabase/edge-runtime/blob/main/deno/Cargo.toml), [Deno2.1.4](https://github.com/denoland/deno/releases/tag/v2.1.4)

Dies beweist lokale Kompatibilität und Größe, keinen erfolgten Cloud-Deploy. Der reale geprüfte Endpunkt muss separat bereitgestellt und mit einem Testkonto geprüft werden; Stub-/Ersatzendpunkte werden nicht veröffentlicht.

Der tatsächliche reparierte Bootstrap wurde außerdem in Deno 2.1.4 importiert und ausgeführt: ausschließlich kontrollierte lokale Mock-Umgebung/Requests, kein Portlistener, kein Env-/Netzzugriff. Seine echten SDK-Methoden führten vor der Selbstlöschung beide Session-RPCs aus; ein anschließend gewechselter authentifizierter Actor wurde mit 403 abgewiesen, bevor Session-RPC oder Admin-Löschung stattfinden. Nachweis: `real-bootstrap-deno214-test.log`, Exit 0. Zusätzlich bestehen 49 Cloud-/Kryptographie-/Packaging-Tests; kein Cloud-Deploy wurde von diesem Diagnosepaket vorgenommen.
