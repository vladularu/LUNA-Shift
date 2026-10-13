# Kalenderfreigabe: Apple-/Google-Anmeldung

## Task-Vertrag

Ziel: optionale echte Konten für die Kalenderfreigabe, ohne Änderung der lokalen SQLCipher-Datenbank und ohne Cloud-Anmeldung für die bisherige App-Nutzung.

Nicht-Ziele: Tarif-/Netto-/Steuerberechnung, bestehender Rule-Catalog-Supabase, Cloud-Provisionierung und Veröffentlichung.

Plattform: iOS, Expo SDK 57 (`~57.0.22`); Google-Browseranmeldung auch auf Android vorbereitet. Web-Konten sind in dieser ersten Version ausdrücklich nicht aktiviert.

Scope: ausschließlich `src/infrastructure/auth/` und dieses Dokument. Native Dependencies, App-Konfiguration, UI und Backend werden in getrennten Arbeitspaketen integriert.

Abnahme: echte Provider-Anmeldung, Abbruch ohne fingierte Sitzung, sichere Wiederherstellung und Token-Erneuerung, fremde/mehrdeutige Callbacks ablehnen, keine Secrets in Logs, Logout lässt den lokalen Dienstplan unverändert. Native Provider und Keychain müssen auf einem echten iPhone geprüft werden.

## Integration

`createSharingAuthPort()` liefert die optionale Anmeldung. `getSharingSupabaseClient()` liefert genau einen Client für den separaten persönlichen Backend-Bereich. Ohne gültige Konfiguration bleibt `isConfigured === false`; es wird kein Ersatzkonto angelegt und nicht auf das Rule-Catalog-Projekt zurückgegriffen.

Die Client-Konfiguration benötigt ausschließlich:

- `EXPO_PUBLIC_SHARING_SUPABASE_URL`: HTTPS-Ursprung des separaten Supabase-Projekts für persönliche Kalenderdaten.
- `EXPO_PUBLIC_SHARING_SUPABASE_PUBLISHABLE_KEY`: dessen öffentlicher `sb_publishable_…`-Schlüssel.

Keine `sb_secret_…`-/Service-Role-Schlüssel oder Apple-/Google-Provider-Secrets in App, Expo Public Environment oder Assets einfügen. Privilegierte Schlüssel gehören ausschließlich ins Backend.

Die Expo-Konfiguration benötigt `extra.appVariant` und den passenden zusätzlichen Scheme:

| Variante   | `extra.appVariant` | Auth-Callback                        |
| ---------- | ------------------ | ------------------------------------ |
| Internal   | `internal`         | `lunashift-internal://auth/callback` |
| Design     | `design`           | `lunashift-design://auth/callback`   |
| Production | `production`       | `lunashift://auth/callback`          |

Bestehende Schemes können als Array daneben erhalten bleiben. Der Auth-Adapter prüft, dass das erwartete Scheme tatsächlich registriert ist. Fehlt es, wird die Konto-Anmeldung nicht aktiviert.

## Google

Supabase startet den Google-OAuth-Fluss mit PKCE und `skipBrowserRedirect`. `expo-web-browser` öffnet die native Auth-Sitzung. Supabase prüft den Provider-State und den PKCE-Verifier serverseitig. Zusätzlich trägt der Rückweg eine zufällige `luna_state`-Korrelation; der Client akzeptiert ausschließlich sein Scheme, Host `auth`, Pfad `/callback`, genau einen passenden State und genau einen Code. Token-Fragmente, Fehlerantworten und fremde Auth-Server werden nicht ausgetauscht.

Im separaten Supabase-Projekt Google als Provider aktivieren. In Google Cloud einen OAuth-Web-Client für die von Supabase angegebene HTTPS-Provider-Callback-URL konfigurieren. Die drei App-Rückwege in Supabase zulassen, einschließlich des `luna_state`-Parameters. Eine enge Freigabe wie `lunashift-internal://auth/callback?luna_state=*` ist einem allgemeinen Scheme-Wildcard vorzuziehen. Auf dem Zielgerät den tatsächlich zurückgegebenen URI prüfen. Eine Google-Anmeldung verknüpft keinen externen Google-Kalender.

## Apple

Apple läuft nativ über `expo-apple-authentication`. Ein frischer zufälliger Nonce wird mit SHA-256 an Apple übergeben; Supabase erhält den ursprünglichen Nonce mit dem ID-Token und prüft ihn serverseitig. Der zurückgegebene native State muss zum gestarteten Vorgang passen. Abbruch liefert keine neue Sitzung.

Den App-IDs der tatsächlichen Varianten die Sign-in-with-Apple-Capability geben. Die passenden Bundle-IDs im Apple-Provider des separaten Supabase-Projekts registrieren. Expo benötigt das SDK-57-Plugin und `ios.usesAppleSignIn`; dies verlangt einen neuen nativen Build. Das native System-Sign-in-Button-Layout kann über `isSharingAppleSignInAvailable()` an die tatsächliche Verfügbarkeit gekoppelt werden.

Apple liefert den Namen häufig nur bei der ersten Zustimmung. Deshalb speichert der Adapter ihn zunächst verschlüsselt und anschließend als Supabase-Metadatum. Bei fehlgeschlagenem Metadaten-Upload wird der sichere Name beim Wiederherstellen verwendet und der Upload erneut versucht. Namen werden nie innerhalb des Supabase-Auth-Event-Callbacks hochgeladen, um dessen Session-Lock nicht zu blockieren. Fehlender Name ist zulässig; private Relay-Adressen werden nicht als Anzeigename verwendet.

## Sitzungsspeicher und Logout

SecureStore verwendet `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Versionierte, Unicode-sichere Blöcke mit höchstens 512 UTF-16-Zeichen halten auch Nicht-ASCII-Inhalte unter 2 KB pro native Speicherwert. Sitzungen sind auf 65.536 Zeichen begrenzt. Zwei Slots, ein abschließend geschriebenes Manifest, SHA-256-Prüfung und pro Schlüssel serialisierte Operationen erhalten die alte Sitzung bis ein Refresh vollständig gespeichert wurde. Fehlende/beschädigte/abgebrochene Werte werden geschlossen behandelt und kontrolliert bereinigt.

Supabase-Autorefresh läuft im nativen Vordergrund; Hintergrund/Inactive stoppen ihn. Supabase hält den PKCE-Verifier über denselben geschützten Adapter. Dieser wird nach jedem Browser-Anmeldeversuch bereinigt; nach Logout sind verspätete Session-Writes bis zu einer expliziten neuen Anmeldung blockiert. Logout blockiert sofort neue Session-Writes und entfernt Sitzung/Verifier dauerhaft, bevor eine Server-Anfrage gestartet oder auf sie gewartet wird. Ein nur im Arbeitsspeicher erfasster alter JWT wird anschließend über eine separate `POST /auth/v1/logout?scope=local`-Anfrage mit `redirect: error` widerrufen; Anfrage und Wartezeit sind auf acht Sekunden begrenzt. SDK-Logout wird für diesen nativen Pfad nicht aufgerufen, damit eine spät zurückkehrende Antwort keinen später angemeldeten Account abmeldet. Ein Server-Widerruf wird bei Fehler/Timeout nicht als bestätigt bezeichnet. Bereits laufende Provider-Anmeldungen werden beim Logout invalidiert; ihre spätere Antwort kann weder Credentials austauschen noch das lokale Konto wieder öffnen. Verspätete Auth-Events öffnen einen abgemeldeten Account ebenfalls nicht. Es greift weder auf die SQLCipher-Datenbank noch auf Gehalt, Dienste, Profile der bisherigen lokalen App oder deren Datenbankschlüssel zu.

## Kontolöschung und Apple-Widerruf

Eine normale Supabase-Kontolöschung widerruft nicht automatisch die Apple-Autorisierung. Der Server muss Apple-Tokens über `/auth/revoke` widerrufen, wenn er sie besitzt oder aus einem verfügbaren frischen Autorisierungscode erhalten kann. Apple-Client-Secret, Team-ID und Signierschlüssel bleiben serverseitig.

`prepareAppleAccountDeletion()` prüft zuerst das serverbestätigte aktuelle Apple-Konto. Es liefert ausdrücklich `authorized` mit einem kurzlebigen Code, `cancelled` bei Abbruch oder `manualRevocationRequired` bei widerrufener/nicht vorhandener bzw. nicht verfügbarer Apple-Autorisierung. Die UI muss den manuellen Weg zusätzlich bestätigen lassen; ein Abbruch führt nie zur Löschung. Identitäts-/State-Abweichungen und nicht bestätigte oder übertragene Identitäten bleiben Fehler und lösen keinen manuellen Fallback aus. Ein fehlgeschlagener Credential-State-Lookup versucht zunächst weiterhin eine native Bestätigung. `requestAppleDeletionAuthorizationCode()` bleibt als kompatibler Code-/Abbruch-Helfer erhalten und wirft beim manuellen Pfad ausdrücklich einen Fehler statt `null` zurückzugeben. Der strukturierte Helfer fordert bei gültiger Autorisierung eine frische native Bestätigung an, vergleicht Apple-Identität und State mit dem serverbestätigten aktuellen Konto und gibt den kurzlebigen Code ausschließlich im Arbeitsspeicher zurück. Es meldet den Nutzer nicht in ein möglicherweise anderes Supabase-Konto um. Der Code geht direkt mit der eigenen authentifizierten Löschanforderung zum Server. Der Server muss das Apple-Token-Ergebnis nochmals gegen die Apple-Identität des Kontos prüfen, widerrufen und anschließend Kalenderfreigaben, personenbezogene Cloud-Daten und Auth-Konto löschen. Der Client ruft nach bestätigter Selbstlöschung `forgetSharingAuthProfile(userId)` und Logout auf. Der lokale Dienstplan bleibt erhalten, wie vom produktseitigen Offline-Konzept vorgesehen.

Wenn die Apple-Freigabe bereits widerrufen wurde oder keine Widerrufs-Credentials verfügbar sind, darf dies eine Kontolöschung nicht dauerhaft verhindern. Apples TN3194 verlangt trotzdem die Erfüllung der Löschanforderung. Das Backend braucht dafür einen auf den serverbestätigten eigenen Nutzer begrenzten Weg; kein allgemeiner frei ausführbarer Apple-SQL-Löschpfad. Abbruch der freiwilligen nativen Bestätigung kann den aktuellen Vorgang abbrechen. Provider-Ausfälle und fehlende Tokens sind im operativen Löschprozess nachvollziehbar zu behandeln, ohne Daten in Fehlertexten zu protokollieren.

## Prüfungen und Grenzen

TDD: zuerst fehlende Implementierung als RED; anschließend echte RED-Fälle für UTF-8-Surrogatgrenzen, Prozessabbruch beim Speichern und Offline-Logout. Gezielte Vitest-Prüfungen für Controller, Native-Adapter, Konfiguration, Token-Lifecycle und sicheren Speicher. 84 gezielte Tests bestanden einschließlich strukturierter Apple-Löschung mit Abbruch, REVOKED/NOT_FOUND, Unverfügbarkeit und expliziter Identitätsabweichung. Fokussierte V8-Coverage: 93,05 % Statements, 88,21 % Branches, 92,30 % Functions und 97,24 % Lines; Lint ohne Warnungen und Prettier bestanden. Keine fingierten Produktionskonten oder Live-Provider-Mocks in der App.

Offen bis zur Bereitstellung: separates Supabase-Projekt, Provider-/Redirect-Konfiguration, serverseitiger Apple-Widerruf, reale Apple-/Google-Anmeldung, erster Name/private Relay, Rückkehr aus Browser, Keychain-Wiederherstellung nach App-Neustart und Konto-Widerruf auf zwei Zielgeräten. Komponententests und Exporte belegen keine Provider- oder iPhone-Abnahme. Der manuelle Apple-Widerruf wird gemäß [Apple Support](https://support.apple.com/de-de/102571) über die Apple-Account-Einstellungen erklärt; eine erfolgreiche LUNA-Kontolöschung und ein bestätigter Apple-Widerruf sind getrennte Ergebnisse.

## Quellen

- [Expo SDK 57 AppleAuthentication](https://docs.expo.dev/versions/v57.0.0/sdk/apple-authentication/)
- [Expo SDK 57 WebBrowser](https://docs.expo.dev/versions/v57.0.0/sdk/webbrowser/)
- [Expo SDK 57 SecureStore](https://docs.expo.dev/versions/v57.0.0/sdk/securestore/)
- [Supabase native Deep Links](https://supabase.com/docs/guides/auth/native-mobile-deep-linking)
- [Supabase Apple Provider](https://supabase.com/docs/guides/auth/social-login/auth-apple)
- [Apple TN3194: Account Deletion and Token Revocation](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple)
