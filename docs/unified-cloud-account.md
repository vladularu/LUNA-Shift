# Gemeinsames LUNA-Konto

Ziel: Ein Konto für privates Cloud-Backup, Gerätesynchronisation und Kalenderfreigaben. Der Ablauf folgt den drei bereitgestellten Referenzbildern und verwendet LUNAs vorhandene Gestaltung.

Nicht-Ziele: E-Mail-/Passwort-Anmeldung, SMTP, Domain, neue native Module, automatische Zusammenlegung verschiedener Apple-/Google-Identitäten, Git-Auslieferung, neuer nativer Build und Store-Veröffentlichung. Das iOS-Preview-OTA wurde nach Abschluss der Implementierung gesondert freigegeben.

Plattform: iOS, bestehender Preview-Build 41. Visuelle Abnahme auf einem echten iPhone steht aus.

Basis: Unveränderte Kopie des veröffentlichten Preview-Quellstands aus `private-cloud-preview-ota`, Basis-Commit `5e7b111f8103d09c6b84e44d5a957c1f68a3d125`. Die übernommenen 174 Dateien liegen im Index; die Änderungen dieses Auftrags bleiben davon als Arbeitskopie-Diff getrennt. Branch `codex/unified-cloud-account`.

Arbeitspaket 1: Konto- und Namensseite, Navigation aus Mehr/Teilen/Cloud/Onboarding, Entfernung der doppelten Kontoverwaltung, Komponentenprüfungen.

Arbeitspaket 2: Namensspeicherung in derselben Auth-Identität und im bestehenden Freigabeprofil, Schutz bei Kontowechsel, fokussierte Auth- und Integrationsprüfungen.

Dateiscope: neue Account-Routen und Account-Feature einschließlich Tests, vorhandene Private-Cloud-Oberfläche/Context/Composition, Sharing-Oberfläche und deren Tests, Settings, Onboarding-Link, Root-Routen sowie `sharing-auth-core.ts` und zugehörige Tests. Keine nativen Konfigurations- oder Backend-Schemaänderungen.

- AC-001: Mehr zeigt „LUNA Cloud → Konto“; Konto in Teilen und Cloud führt auf dieselbe Route. Nach Anmeldung wird dieselbe Identität in beiden Funktionen angezeigt.
- AC-002: Konto zeigt Initialen, Namen, verfügbare Konto-E-Mail, tatsächlichen Sync-Status und den letzten erfolgreichen Abgleich. Sicherungen bleiben erreichbar. Ohne Cloud-Einrichtung wird kein aktiver Sync behauptet.
- AC-003: Anmeldung bietet Apple/Google. E-Mail wird nur angezeigt; Passwort- und E-Mail-Änderung bleiben pausiert. Ohne vorherige Einrichtung für dieses Konto startet die Anmeldung allein keine private Sicherung und keine Freigabe. Eine bestehende Zustimmung zum automatischen Cloud-Abgleich bleibt erhalten.
- AC-004: Name ändern bietet Vor-/Nachname und Fertig, speichert die gemeinsame Identität und das Freigabeprofil. Fehler bleiben sichtbar; die Seite schließt erst nach Erfolg. Kontowechsel/Abmeldung verhindert verspätete UI-Übernahme.
- AC-005: Abmelden betrifft Cloud und Teilen. Löschen verwendet die bestehende geschützte Kontolöschung einschließlich Apple-Ablauf, nach ausdrücklicher Bestätigung mit Hinweis auf Cloud-Sicherungen und Freigaben. Lokale Daten bleiben erhalten.
- AC-006: Namenseingaben bleiben bei großer Schrift und geöffneter Tastatur bedienbar. Gerätebeleg ist für visuelle Abnahme nötig.

Prüfung: fokussierte Auth-/Account-/Sharing-/Cloud-Komponententests, `verify:fast`, zusätzliche Cloud-Sicherheitstests und iOS-Export. Kein Commit, Push oder neuer nativer Build. Gesondert freigegebenes iOS-Preview-OTA siehe unten.

Referenzen: [Expo Router SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/router/), [Supabase updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser). Namensmetadaten dienen ausschließlich der Anzeige, niemals der Autorisierung.

## Ergebnis am 18. Oktober 2026

Mehr zeigt einen eigenen Abschnitt „LUNA Cloud → Konto“. Konto-Einstieg, Anmeldung aus Teilen und Einladungen sowie Onboarding führen auf dieselbe Kontoseite. Sie zeigt Initialen, Namen, Konto-E-Mail, Cloud-Status und letzten erfolgreichen Abgleich. Sicherungen und Konfliktauflösung bleiben unter „Cloud & Sicherungen“ erreichbar. Der Namenseditor speichert Vor- und Nachname in der vorhandenen Auth-Identität und den vollständigen Anzeigenamen im bestehenden Freigabeprofil. Kalendernamen und Freigaberechte werden dabei nicht geändert.

Die Namensspeicherung umfasst zwei wiederholbare Schritte: Auth-Metadaten und Freigabeprofil. Bei einem Fehler bleibt die Seite offen; erneutes Speichern führt beide Schritte erneut aus. Ein Kontowechsel verhindert verspätete Übernahme in die andere Identität. Die erste Anmeldung und die erneute Anmeldung nach einem Logout benachrichtigen beide Bereiche ausdrücklich nach erfolgreicher Apple-/Google-Anmeldung. Dieser Wiederanmeldefall wurde zunächst als fehlgeschlagener Regressionstest nachgewiesen und anschließend korrigiert.

Abmelden verwendet den vorhandenen Teilen-Ablauf mit sofortiger lokaler Bereinigung; ohne aktiven Teilen-Controller wird die gemeinsame Auth-Sitzung abgemeldet. Löschen verwendet die vorhandene Kontolöschung einschließlich Apple-Ablauf. Die Bestätigung benennt Cloud-Sicherungen und Freigaben und bewahrt lokale Daten.

### Prüfnachweis

- `npm.cmd run verify:fast`: vollständig erfolgreich. 457 Unit-Dateien mit 8.900 Tests; 141 Komponenten-Gruppen mit 1.203 Tests. Endgültiger Lauf mit zwei begrenzten Unit-Workern, Komponenten seriell. Typprüfung, Lint, Formatierung, Regelprüfungen und alle enthaltenen Node-Prüfungen bestanden.
- Zusätzlich 14 private PostgreSQL- und Decoder-Sicherheitstests erfolgreich. Produktions-Audit und Release-Konfigurationsprüfung erfolgreich.
- 87 gezielte Auth-/Namenstests sowie die gezielten Konto-, Mehr-, Teilen- und Cloud-Oberflächentests erfolgreich.
- iOS-Export mit `APP_VARIANT=internal` erfolgreich. Bundle `entry-b96b68b021ceb96a83c1e4f52eba6555.hbc`, 11.741.585 Bytes, SHA-256 `4292d76e1a9f40ae5bcd5682ebfbc49bb81d431d4a21bbf73465f62f2f358fdd`.
- Alle 26 Auftragsdateien blieben während der endgültigen Tests und des Exports unverändert; dieses Dokument wurde danach um die Ergebnisse ergänzt. Keine Änderungen an nativer Konfiguration, Abhängigkeiten oder Backend-Schema. Der Kontextgraph ist aktualisiert.
- Abhängigkeiten wurden mit unveränderter Lockdatei separat installiert und die bestehenden Härtungen geprüft. Eine anfängliche Verknüpfung zum früheren Preview-Verzeichnis wurde entfernt, damit die Sicherheitsprüfungen direkt im neuen Arbeitsverzeichnis bestanden werden.

Beim Abschluss der Implementierung war die neue Oberfläche noch nicht als OTA veröffentlicht. Die anschließende gesonderte OTA-Freigabe und Auslieferung sind unten dokumentiert. Kein neuer nativer Build und keine Git-Auslieferung.

### Veröffentlichtes iOS-Preview-OTA

Nach ausdrücklicher OTA-Freigabe am 18. Oktober 2026 um 02:02 Uhr (Europe/Berlin) für `preview` / `ios` / EAS-Umgebung `preview` veröffentlicht:

- Gruppe: `374ee685-ed56-49b6-a05a-760a1b2ac1dc`.
- iOS-Update: `01a14c51-4220-7854-990f-63daf4f6c94f`.
- Runtime: `43b795d13a44499e37cc461aa80ce8c239783788`, passend zum bestehenden Preview-Build 41 (`a8a35a6d-9d92-46cf-8b24-1afe0d28d245`).
- Vorheriger Preview-Stand: Gruppe `35df2e43-d232-4dcf-9786-e030994856b9`. Dessen enthaltene Oberfläche und Cloud-Funktionen bleiben als Basis erhalten.
- Tatsächlich ausgeliefertes Manifest: HTTP 200 mit obiger Update-ID und Runtime. Der Preview-Zweig führt die neue Gruppe an erster Stelle.
- Veröffentlichtes Hermes-Paket: 9.529.968 Bytes; lokaler EAS-Export, Manifest und tatsächlich vom CDN heruntergeladene Datei haben identische SHA-256-Prüfsumme `20C8114D0EF00805FC07A0AB56FD3F4ED5AA478E9115F1B81523B54FB0BB67EF`.
- Cloud-Ziel vor Veröffentlichung geprüft: `flpwvfqywvnvhfkjbcnf.supabase.co`, öffentliche Client-Konfiguration vorhanden, `APP_VARIANT=internal`. Schlüsselwerte wurden nicht ausgegeben.
- Alle 26 geprüften Auftragsdateien und die kompatible `.gitignore` blieben während der Veröffentlichung unverändert. Dieser Prüfnachweis wurde anschließend ergänzt. Belege liegen unter `.expo/unified-account/ota/`.

Der erste Fingerprint-Abgleich unterschied sich ausschließlich bei den Zeilenenden der `.gitignore`. Die bereits veröffentlichten, inhaltlich identischen Dateibytes wurden wiederhergestellt (SHA-1 `00e497419f1a749bd9e9b031df099fba0afd7f55`). Danach passten alle 145 Fingerprint-Bestandteile und die Runtime zum bestehenden Build. Es wurde keine Runtime erzwungen. Bei späteren Werkzeugläufen, insbesondere einer Normalisierung der Ignore-Datei, muss der Fingerprint erneut verglichen werden.

Die Auslieferung ist bestätigt; sichtbare Übernahme und Verhalten auf echten iPhones bleiben offen. Für die Übernahme: App vollständig schließen, öffnen und ungefähr 15 Sekunden warten, erneut schließen und wieder öffnen.

### Offene Abnahme auf dem iPhone

1. Mehr → Konto und Teilen → Konto: gleiche Identität, gleicher Name und gleiche E-Mail. Screenshots von Mehr und Konto mit tatsächlichem Sync-Status.
2. Name ändern: Vor-/Nachname, Fertig, geöffnete Tastatur und große Schrift prüfen; Screenshot der Eingabeseite. Nach Speichern und Neustart denselben Namen prüfen.
3. Abmelden: lokale Planung bleibt erhalten, Cloud und Teilen sind abgemeldet. Mit demselben Apple- oder Google-Konto erneut anmelden und die vorhandenen Freigaben prüfen.
4. Auf einem zweiten iPhone mit demselben Konto Cloud-Stand und letzten Abgleich prüfen. Private Sicherungen bleiben von den ausdrücklich geteilten Kalenderinhalten getrennt.
5. Kontolöschung einschließlich Apple-Widerruf ausschließlich mit einem dafür angelegten Testkonto praktisch prüfen. Echte Auth-Anmeldung, Namensspeicherung gegen den Live-Dienst und Geräteabnahme wurden in diesem Auftrag nicht ausgeführt.
