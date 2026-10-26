# Zod: Schutz vor Ressourcenerschöpfung bei Größenbegrenzungen

## Auftrag und Scope

Freigabe: „Ja“ auf die Umsetzung eines zusätzlichen Sicherheits-Arbeitspakets nach dem fehlgeschlagenen CI-Audit von PR #310. Dieser Fix liegt unabhängig auf `codex/zod-audit-hardening`, Basis `ab25991685f29f4787b515b21bf9e96e17e335ef` (`master` am 26.10.2026). Der abgenommene Sollzeit-Branch bleibt bei `064b6b8b99c91d439792736f63d94a7ab91cfb8b` unverändert gesichert.

Zielplattform: Node-Werkzeuge von Expo SDK 57, einschließlich CommonJS, ESM und des veröffentlichten TypeScript-Source-Exports. Vor Änderungen wurde `expo ~57.0.22` geprüft und ausschließlich die [versionierte SDK-57-Dokumentation](https://docs.expo.dev/versions/v57.0.0/) herangezogen. Keine App-/Fachlogik-/UI-Änderung, neue Library, SDK-Migration, native Integration oder Veröffentlichung gehört zu diesem Arbeitspaket.

## Befund und Primärquellen

Das Audit für `064b6b8` blockiert an [GHSA-mrhx-c7xc-m3w5 / CVE-2023-54404](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). Die Lockdatei enthält `zod 3.25.76`; Produktions-Einführer ist `expo 57.0.22 → @expo/cli 57.0.24 → zod ^3.25.76`. Auch die am 26.10.2026 aus der offiziellen npm-Registry geprüfte neuere SDK-57-CLI `57.0.32` verlangt weiterhin `^3.25.76`.

Der [offizielle Fix a0ebf970f2d752e5f58527cd2942ff48be4f46bd](https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd), veröffentlicht mit Zod 4.6.6, prüft führende obere Größenbegrenzungen vor dem Parsen der Elemente. Der npm-Hinweis auf eine Expo-Downgrade-/Majoränderung wird nicht als kompatible Reparatur übernommen. Zod 3.x und das SDK bleiben erhalten; die Änderung wird gezielt rückportiert.

## Reproduktion und Reichweite

40 sichere, kleine Regressionen waren vor dem Patch rot: Root-/v3-, v4- und Mini-API, CommonJS und ESM, synchron und asynchron. Bereits drei ungültige Elemente erzeugten trotz `.max(1)` drei Elementprüfungen und vier Fehler; Maps erzeugten entsprechend Schlüssel- und Wertfehler. Der Nachweis benötigt keine speichererschöpfenden Eingaben.

Der Backport schützt:

- v3: Arrays mit `.max()`/`.length()` und Sets mit `.max()`/`.size()`.
- v4 Classic/Mini/Core: Arrays, Sets und Maps mit führenden nichtnegativen oberen Größen-/Längenchecks. In dieser älteren v4-Version erhalten Maps ihre Begrenzung über `.check(z.maxSize(...))` oder `.check(z.size(...))`.
- Alle sechs Implementierungsdateien: v3 `types.cjs`, `types.js`, `src/v3/types.ts` sowie v4 `core/schemas.cjs`, `core/schemas.js`, `src/v4/core/schemas.ts`.

V4 initialisiert den Basis-Runner in Classic und Mini erneut. Deshalb wird der endgültige Runner verzögert umschlossen. Das erhält die Reihenfolge von Checks/Overwrites und verhindert doppelte Größenfehler. Die veröffentlichte Zod-Version hat keinen eigenen Array-/Map-/Set-Compiler; verschachtelte JIT-Objektpfade delegieren an die geschützten Runner. Regressionen prüfen beide `jitless`-Einstellungen sowie TypeScript-Source-Bedingungen.

Eine obere Begrenzung stoppt übergroße Eingaben vor Element-, Refinement- und asynchronen Element-Callbacks. Gültige Werte, in-range Typprüfungen, Transformationen, exakte Größen, eigene Fehlermeldungen und verschachtelte Fehlerpfade bleiben geprüft. Ein vorgeschalteter expliziter Preprocessor oder ein vor der Größenprüfung angeordneter v4-Overwrite behält seine Bedeutung.

Der Fix ist keine universelle Eingabegrößenbegrenzung. Unbegrenzte Schemas verarbeiten weiterhin ihre Elemente; v3-Maps bekommen keine neue Größen-API. Untere Grenzen und andere Ressourcenrisiken werden nicht als behoben ausgegeben. Diese Eingrenzung folgt dem Verhalten des offiziellen Größen-Guards.

## Integrität und Audit

`postinstall` installiert den Backport über den bereits vorhandenen Härtungs-CLI nach den bestehenden Härtungen. Die bestehenden Kommandostrings in `package.json` bleiben unverändert; die Audit-Policy-Suite importiert zusätzlich das Sicherheits-Testmodul. Zod wird als bereits vorhandene transitive Abhängigkeit auf exakt `3.25.76` fixiert. Die Lockdatei bleibt bytegenau unverändert.

Das Härtungsskript prüft vor jedem Schreiben die genaue Version, eine einzige Lock-Installation, Registry-URL, Archiv-SRI und die tatsächliche Auflösung aller in der Lockdatei genannten Verbraucher. Patchmanifest und Original-/Zielbytes sind mit SHA-256 gebunden. Zusätzlich werden 261 unveränderte ausführbare/Source-/Metadaten-Dateien geprüft; unbekannte Quellen, zusätzliche ausführbare Dateien und aus dem Checkout führende Pfade werden abgewiesen. Vollständig gepatchte Installationen sind idempotent; gemischte oder manipulierte Installationen erfordern eine neue saubere Installation und werden nicht still repariert.

`verify:fast` kontrolliert die installierte Härtung vor den Tests. `audit:production` akzeptiert ausschließlich einen opaken, an den aktuellen Checkout gebundenen und beim Verbrauch erneut verifizierten Integritätsnachweis. Nur das genaue bekannte Advisory mit unveränderter ID, URL, Titel, Schwere, Versionsbereich und erwarteten Installationsknoten gilt dann als **mitigiert**. JSON-Kopien, fremde oder veraltete Nachweise, andere Advisories und weitere Kopien bleiben blockierend; `approved` bleibt leer.

Ein unverändertes rohes `npm audit` meldet die Versionsnummer 3.25.76 weiterhin als betroffen. Das Repository-Gate ignoriert den Fund nicht pauschal, sondern verifiziert den tatsächlich installierten Fix. Die Quellenherkunft und MIT-Lizenz stehen im Manifest und `scripts/zod-hardening.LICENSE`.

## Dateien

- `package.json`: exakte transitive Versionsbindung; bestehende npm-Kommandos bleiben erhalten.
- `scripts/decode-uri-component-hardening.cjs`: bestehender Installations-/Prüf-CLI delegiert zusätzlich an Zod; importierte Decoder-Funktionen bleiben unabhängig.
- `scripts/zod-hardening.mjs`: Installation und Integritätsnachweis.
- `scripts/zod-hardening.patch.json`: geprüfte Kontexte, Vor-/Nachher-Hashes und unveränderte Quellen.
- `scripts/zod-hardening.LICENSE`: ursprüngliche MIT-Lizenz.
- `scripts/zod-hardening.test.mjs`: Reproduktion, API-/Format-/Async-Kompatibilität und Manipulationsschutz.
- `scripts/audit-production.mjs`: ausschließlich nachgewiesene installierte Mitigation auswerten.
- `scripts/audit-production.test.mjs`: falsche Nachweise, Identitäten, Installationsorte und Fremdbefunde abweisen.
- `docs/zod-security-hardening.md`: Entscheidungen und Abnahme.

## Einbindung und Runtime-Kompatibilität

Der erste Entwurf ergänzte drei npm-Kommandostrings. Der unveränderte Expo-Fingerprint-Algorithmus nimmt jedoch sämtliche dieser Strings auf und erzeugte allein deswegen eine neue Runtime. Deshalb verwendet die finale Integration den vorhandenen CLI-Einstieg `decode-uri-component-hardening.cjs` für `apply`/`verify`. Nur bei direkter CLI-Ausführung wird der Zod-Check als separater Node-Prozess ausgeführt; die importierten Decoder-Funktionen und die Decoder-Runtime bleiben unabhängig. Die bestehende Audit-Policy-Datei importiert die zusätzlichen Regressionen. Keine Fingerprint-Regel, Quelle oder Runtime-ID wird manuell ersetzt oder ausgeblendet. Die ursprünglichen npm-Kommandos bleiben byteinhaltlich gleich.

Der zusätzliche CLI-Einstieg erweitert den ursprünglich geplanten Scope von acht auf neun Dateien. Alle Änderungen bleiben im Installations-/Sicherheitswerkzeugpfad; App, UI und native Integration sind nicht betroffen.

## Wartung und Grenzen

Die Versionsbindung und die Byteprüfungen müssen bei einem späteren Expo-/Zod-Update gemeinsam überprüft werden. Eine neue Paketversion wird absichtlich abgewiesen, bis entweder ein kompatibler offizieller Fix eingebunden oder ein neuer Backport geprüft ist. Der Backport kann entfernt werden, sobald alle tatsächlichen Verbraucher eine upstream reparierte Version verwenden und dieselbe Regression-/Integritätsmatrix sowie das Produktionsaudit erfolgreich sind. Ein erzwungener Majorwechsel oder eine Ausnahme nur anhand der Advisory-ID ist kein Ersatz.

Der vollständige iOS-Prebuild-Test (`test:runtime-prebuild`) verlangt laut Prüfskript Linux oder macOS und ein frisches Checkout ohne generiertes `ios/`. Er wird auf diesem Windows-Rechner nicht ausgeführt; die Ausführung bleibt für die Pull-Request-CI erforderlich. Lokaler Export- und Runtime-Vergleich werden gesondert nachgewiesen. Da dieses Arbeitspaket ausschließlich Node-Sicherheitswerkzeuge betrifft, wird daraus keine neue Geräteabnahme einer App-Version abgeleitet.

## Prüfstand und Abnahme am 26.10.2026

| Prüfung                                      | Ergebnis                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Sichere ursprüngliche Größenmatrix           | 40 rot vor dem Patch, 40 grün danach                                                                   |
| Gezielte Zod-/Audit-/Decoder-Integration     | 105 Tests bestanden, 0 Fehler/übersprungene Tests                                                      |
| Finale saubere Installation mit `npm ci`     | Exit 0; Backport wird über den bestehenden Postinstall-CLI angewendet                                  |
| `verify:fast`                                | Exit 0; Typecheck, ESLint, Formatprüfung und sämtliche Tests bestanden                                 |
| Unit-/Engine-Tests                           | 9.114 bestanden in 473 Dateien                                                                         |
| Komponententests                             | 1.378 bestanden in 150 Suiten                                                                          |
| Zusätzliche Node-Tests                       | 293 bestanden; darin 139 Audit-/Härtungsprüfungen                                                      |
| `audit:production` nach finaler Installation | Exit 0; zwei bestehende/installierte Backports verifiziert, kein unbehobenes hohes/kritisches Advisory |
| `release:check`                              | Exit 0                                                                                                 |
| SQLite-Smoke nach finaler Installation       | In-Memory-Abfrage erfolgreich                                                                          |
| iOS-Export mit Preview-Konfiguration         | erfolgreich, keine Veröffentlichung                                                                    |
| iOS-Runtime vor/nach Fix                     | identisch: `d0daa823a2a0b0965e5a1c7462b2885570aab578`                                                  |
| Kontrollierter JavaScript-/Asset-Vergleich   | bytegleicher JavaScript-Export und identische Asset-Metadaten                                          |
| Kontrollierter Hermes-Vergleich              | bytegleich bei identischem Compiler-Eingabepfad                                                        |
| `test:runtime-prebuild`                      | lokal nicht ausgeführt: Linux/macOS erforderlich; PR-CI bleibt offen                                   |

Das vollständige Gate umfasst 10.785 bestandene Tests. Die Windows-Ausführung verwendet vorübergehend einen einzelnen Vitest-Thread; `vitest.config.ts` wurde danach bytegenau auf den Branch-Ausgangsstand zurückgesetzt. Die acht getesteten Implementierungs-/Manifest-/Lizenzdateien wurden vor dem Gate mit SHA-256 eingefroren und danach unverändert geprüft. Nur diese Dokumentation wurde anschließend vervollständigt und erneut formatiert/geprüft.

Die Lockdatei bleibt bei SHA-256 `780ed77aaa977ca8d3be5a19b6f9eb5ccdfff9e053e15e8ca147205e54f1d1bb`. Alle ursprünglichen npm-Kommandostrings, App-Quellen sowie Native-/Fingerprint-Konfigurationen bleiben unverändert.

### Aussagekraft des Exportvergleichs

Der zunächst verwendete rohe Bytecode-SHA-Vergleich schlug trotz erfolgreichem Export und gleicher Runtime fehl: `7597565e987514fa972139a1856c3c6dd100dce0e783015cf0a41e7ca6ef4605` vor dem Fix und `4bf9295f2a4771f908c64670477d9a62927b29d9c70429a553851ce31e409dbc` danach. Der installierte Expo-Serializer `node_modules/@expo/metro-config/build/serializer/exportHermes.js` erzeugt pro Lauf einen Pfad aus `Math.random()` und `Date.now()`. Dieser `expo-bundler-…/index.js`-Pfad ist in der Hermes-Datei enthalten. Rohe Bytecode-Hashes verschiedener Standardexporte werden deshalb nicht als identisch ausgegeben.

Ein zweiter kontrollierter Versuch hat zunächst sämtliche sechs Zod-Dateien auf die manifestverifizierten Originalbytes gesetzt, einen iOS-JavaScript-Export ohne Bytecode erzeugt und im `finally` alle geprüften Reparaturbytes wiederhergestellt. Danach wurde derselbe Export mit dem Fix erzeugt. Beide JavaScript-Dateien sowie ihre Asset-Metadaten sind exakt gleich. Die erneute Kompilierung beider JavaScript-Dateien mit dem installierten Hermes-Compiler, identischen Optionen und identischem Eingabepfad ergibt zusätzlich identische Bytecode-Dateien. Weder Compiler, Runtime noch Fingerprint-Regeln wurden dafür verändert.

- JavaScript-SHA-256: `037760ddc76a658bab4f451a79e92f647f7c447ac8450a0c938b6b08965630c3`.
- Kontrollierter Hermes-SHA-256: `d422ac9bf35ff127ecf4f66278ef2c9f44824682521c70c92705872480efb701`.
- Finale Integritätsprüfung bestätigt wieder alle reparierten installierten Quellen.

Dies belegt die inhaltliche Exportgleichheit innerhalb der getesteten Konfiguration; es ist kein neuer nativer Build und keine neue iPhone-Abnahme. Der ursprüngliche rohe Bytecode-Vergleich bleibt als fehlgeschlagener, durch Metadaten erklärter Versuch dokumentiert.

### Verbleibender Freigabeschritt

Der lokale Fix ist geprüft und auf neun Dateien begrenzt. Commit, Push, separater Pull Request und die anschließende CI sind noch offen. Merge, native Builds und OTA-/Store-Veröffentlichung sind nicht freigegeben. Der abgenommene Sollzeit-Branch wurde durch dieses Arbeitspaket nicht verändert.
