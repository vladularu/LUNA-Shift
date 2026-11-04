# LUNA Shift

Stand: 04.11.2026. Diese Übersicht beschreibt die im aktuellen Master implementierten Funktionen. Die [Roadmap vom 21.09.2026](docs/roadmap.md) ist ein historischer Abschlussstand und bildet spätere Erweiterungen nicht vollständig ab.

LUNA Shift ist ein iPhone-first Dienstplaner für Schichtarbeitende, besonders im Gesundheitswesen. Die App verbindet Kalender, Arbeitszeitauswertung, Gehalts- und Netto-Prognosen sowie optionale Kalenderfreigaben in einer systemadaptiven Oberfläche.

LUNA Shift basiert auf Expo SDK 57, React Native und SQLite. Kalender, lokale Planung und Berechnungen sind ohne Konto nutzbar. Die lokale Datenbank bleibt die Grundlage; optionale Konten, privater Cloud-Abgleich und Kalenderfreigaben übertragen Daten an das konfigurierte Backend (siehe unten). Die optionale Ortssuche und Kartenansicht verwenden auf iOS Apple-Dienste und auf Android den systemseitigen Geocoder sowie Google Maps. Suchtext, Kartenbereich und gespeicherte Koordinaten können dabei an den jeweiligen Anbieter übermittelt werden; LUNA Shift liest keine aktuelle GPS-Position und betreibt kein Standorttracking. Der genaue Vertrag steht in [`docs/location-data-flows.md`](docs/location-data-flows.md).

> **Veröffentlichungsstand:** LUNA Shift befindet sich in der iOS-TestFlight-Beta. Der am 04.11.2026 auf dem iPhone bestätigte Build-9-/OTA-Stand wird durch den [TestFlight-Release-Schutz](docs/testflight-release-schutz.md) abgesichert. Ein Merge auf Master ist keine automatische Auslieferung oder Geräteabnahme. Android bleibt bis zur gesonderten technischen und realen Geräteabnahme pausiert; der Web-Export ersetzt keinen nativen iPhone-Build.
>
> Der alte Tag [`v0.1.0-beta.1`](https://github.com/vladularu/PflegeShift/releases/tag/v0.1.0-beta.1) gehört zu MediShift und ist wegen anderer App- und Datenbank-IDs keine aktuelle Installations- oder Migrationsbasis.

Die sichtbare Marke und die absichtlich beibehaltenen technischen Kompatibilitätsnamen sind in [`docs/branding.md`](docs/branding.md) dokumentiert.

## Bereits implementierte Funktionen

### Kalender

- Monats- und Jahresansicht ohne dauerhaft eingeblendete Kalenderwochen
- vertikaler Monatswechsel und direkter Sprung zum heutigen Datum
- Dienste und Abwesenheiten als kompakte Farbbalken, Termine als Punkt mit Kurztext
- gesetzliche Feiertage nach Arbeitsort und getrennt dargestellte tarifliche Sondertage
- Tagesdetails mit Soll-, Ist- und Saldostunden
- Schnelleingabe für vorhandene Dienstvorlagen, Urlaub, Krank und Frei
- Stempelmodus zum Eintragen desselben Dienstes an mehreren Tagen
- Terminserien, lokale Erinnerungen sowie optionale Orts- und Kartenangaben
- eigene Dienstvorlagen, Farben, Symbole und Kalenderhintergründe
- geteilte Dienste, Bereitschaftsdienst und Rufbereitschaft mit erfassten Einsätzen
- native Zeitwahl; aktuelle Geräteabnahme auf iOS

### Auswertung

- Monats- und Jahresauswertung
- Soll-, erfasste Arbeits- und Saldostunden; bei Sonderdiensten getrennte bewertete Zeitkontoprognose
- nachvollziehbare Sollzeit aus Arbeitsprofil, Arbeitsort und unterstützten Tarif-/Sondertagsregeln
- Dienstverteilung
- Arbeitszeit- und Planungshinweise
- automatische Empfehlung für Schicht- und Wechselschichtzulagen
- manuelle Bestätigung der tatsächlich anzuwendenden Zulage
- Monats- und Jahresberichte als PDF und CSV; Berichte sind keine Datensicherung

### Gehalt und Netto

- monatliche Brutto- und Netto-Prognose mit aufgeschlüsselten Gehaltsbestandteilen und Abzügen
- datierte Arbeits-, Gehalts- und Netto-Angaben für historische und geplante Änderungen
- Tabellenentgelt, tarifabhängige Zulagen, Zeitzuschläge, bestätigte Überstunden und Jahressonderzahlung im unterstützten Umfang
- getrennte Darstellung erarbeiteter Zuschläge und erwarteter Auszahlung
- einstellbarer Auszahlungsversatz von 0, 1 oder 2 Monaten für variable Bestandteile; Herkunftsmonate bleiben nachvollziehbar
- steuerpflichtige und begünstigte Zuschlagsanteile sowie persönliche Steuer-, Versicherungs- und Zusatzversorgungsangaben
- offene oder fehlende Berechnungsgrundlagen werden gekennzeichnet

Die reguläre Gehaltsauswahl bietet sieben Tarifmodelle:

| Modell               | Bereich                                        |
| -------------------- | ---------------------------------------------- |
| TVöD-P               | Pflege; TVöD-Bereich BT-K/BT-B berücksichtigen |
| TVöD VKA · E-Tabelle | kommunaler öffentlicher Dienst                 |
| TV-L Pflege          | Pflege im Länderbereich                        |
| TV-H Pflege          | Hessen                                         |
| TV-UK Pflege         | Baden-Württemberg                              |
| TVAöD Pflege         | Ausbildung                                     |
| TVA-L Pflege         | Ausbildung im Länderbereich                    |

Alternativ lässt sich ein Monatsbrutto selbst eintragen. Eine auswählbare Tabelle bedeutet keine vollständige Umsetzung aller tariflichen Ansprüche. Berechnungen hängen von Tarifbereich, Zeitraum und vollständigen persönlichen Angaben ab; weitere Regelpakete im Repository sind nicht automatisch produktiv verfügbar.

### Bereitschaftsdienst und Rufbereitschaft

- Bereitschaftszeiten, Einsätze und erforderliche Wegezeiten erfassen
- tarifabhängige Pauschalen, Einsatzvergütung, Bereitschaftsbewertung und gesonderte Zeitzuschläge prognostizieren
- Auszahlung und bestätigten Freizeitausgleich unterscheiden; tatsächliche Arbeitszeit bleibt getrennt von bewerteter Kontozeit
- fehlende Vereinbarungen, unbestätigte Einsätze und nicht unterstützte Abrechnungsfälle ausdrücklich offenlassen

Die geprüften Sonderdienstregeln sind auf 2026 begrenzt. Insbesondere mehrtägige beziehungsweise monatsübergreifende Rufbereitschaft wird nicht pauschal vollständig abgerechnet. Details und Grenzen: [Sonderdienste](docs/sonderdienste-f3.md).

### Konto und Kalenderfreigaben

- optionale Anmeldung mit Apple oder Google, abhängig von Plattform und eingerichteter Anbieterfreigabe
- eigene Kalender per Einladung beziehungsweise QR-Code lesend freigeben und Zugriffe verwalten oder widerrufen
- Dienste und Termine nach gewählten Inhaltsrechten teilen; Notizen sind standardmäßig nicht freigegeben
- Profilbilder nur nach ausdrücklicher Einwilligung je Empfänger teilen; sonst Initialen anzeigen
- eigene und empfangene Kalender getrennt ein-/ausblenden und Personen farblich zuordnen
- fremde Kalender verändern weder eigene Arbeitszeit noch eigene Gehaltsberechnung

Kalenderfreigaben sind keine gemeinsame Bearbeitung und keine Synchronisation mit Apple Kalender oder Google Kalender.

### iPhone-Widgets und Darstellung

- native Kalenderwidgets mit Tages-, Wochen- und Monatsdarstellungen
- eigene und freigegebene Dienste sowie Termine, Feiertags-/Sondertagsnamen und Kalenderfarben
- Kalenderhintergrund und Hell-/Dunkelmodus; ein Tipp öffnet den Kalender
- Widgets übernehmen keine privaten Notizen oder Ortsangaben

Widgets benötigen einen passenden nativen iOS-Build. Ihre Aktualisierung unterliegt zusätzlich der iOS-Widget-Laufzeit.

### Einstellungen

- Arbeitsort, Wochenarbeitszeit und datierte Arbeits-/Gehaltsgrundlagen
- Verwaltung und Sortierung der Dienstvorlagen
- Themes, Hell-/Dunkelmodus und Kalenderdarstellung
- lokale Datenverwaltung und JSON-Sicherung/Wiederherstellung

## Experimentell oder vorläufig

- **Privater Cloud-Abgleich:** implementiert, einschließlich automatischem Abgleich nach Anmeldung, Sicherungsständen und Konfliktbehandlung. Die dokumentierten realen Zwei-Geräte-/Offline-Prüfungen sind noch nicht vollständig abgeschlossen. Der Abgleich läuft auf geeigneten Seiten der aktiven iOS-App; dauerhafte Hintergrundsynchronisation wird nicht zugesagt. Siehe [Cloud-Ablauf](docs/cloud-account-simplification.md).
- **Netto-Prognose 2027:** ausdrücklich vorläufige Fortschreibung der geprüften Abzugsgrundlagen von 2026. Fehlende oder abgelaufene Tariftabellen werden dadurch nicht ersetzt. Siehe [Berechnungsgrenzen 2027](docs/brutto-netto-vorlaeufig-2027.md).
- **Testlabor:** internes Entwicklungswerkzeug; kein regulärer Nutzerbetrieb (siehe unten).

## Geplante oder zurückgestellte Erweiterungen

- weitere Geräte- und Plattformabnahmen, insbesondere Android
- E-Mail-/Passwort-Anmeldung: vorbereitet, aber deaktiviert; Versand-/Recovery-Einrichtung pausiert
- externe Kalender-Synchronisation und automatische Dienstrotationen: mögliche spätere Erweiterungen ohne zugesagten Veröffentlichungstermin

Eine verbindliche Lohnabrechnung oder automatische rechtliche Anspruchsentscheidung gehört nicht zum Funktionsumfang.

## Fachliche Grundlagen

- Dienste über Mitternacht und Zeitumstellungen werden zeitzonensicher berechnet.
- Termine zählen nicht als Arbeitszeit.
- Feiertage werden bundeslandbezogen berücksichtigt; kommunale Sonderregelungen sind nicht vollständig abgedeckt.
- Abwesenheiten werden entsprechend der hinterlegten Wochenarbeitszeit angerechnet.
- Die Schichtzulagen-Erkennung wertet Dienstwechsel und qualifizierende Nachtdienste aus. Eine manuell bestätigte Monatsentscheidung hat Vorrang.
- Gehaltswerte sind Schätzungen und ersetzen weder Lohnabrechnung noch tarifliche oder rechtliche Prüfung.

## Datenhaltung und Datenschutz

LUNA Shift speichert Profileinstellungen, Dienstvorlagen, Einträge und Monatsentscheidungen in einer lokal mit SQLCipher verschlüsselten SQLite-Datenbank. Der Schlüssel liegt im nativen SecureStore. Änderungen verwenden Revisionen und Soft-Delete, damit Datensätze konsistent aktualisiert werden können.

Ohne Anmeldung bleiben die persönlichen Planungsdaten lokal. Nach optionaler Anmeldung kann der private Cloud-Abgleich automatisch starten und persönliche Sicherungsdaten einschließlich Arbeits-/Gehalts-/Netto-Angaben und Kalenderfoto übertragen. Bei widersprüchlichen Daten oder einem Kontowechsel ist eine Auswahl erforderlich. Abmelden beendet Cloud-Abgleich und Teilen auf diesem Gerät; eigene lokale Daten bleiben erhalten.

Private Cloud-Sicherungen und Kalenderfreigaben sind getrennte Datenwege: Empfänger erhalten nur die freigegebenen Kalenderinhalte, keine privaten Gehalts- oder Steuerprofile. Notizen und Profilbilder benötigen eigene Freigaben. Die lokale SQLCipher-Verschlüsselung ist keine Zusage einer Ende-zu-Ende-Verschlüsselung der Cloud-Daten.

JSON-Sicherungen und exportierte Berichte sind separate Dateien und entsprechend vertraulich zu behandeln. Ältere Clients können neuere Sicherungsformate sicher ablehnen; App-, Datenbank- und Sicherungsversionen dürfen nicht beliebig ausgetauscht werden. Details: [Datenaufbewahrung](docs/data-retention.md) und [Freigaberechte](docs/sharing-content-rights.md).

## Entwicklung starten

Voraussetzungen:

- Node.js und npm
- Android Studio für einen lokalen Android-Native-Build oder Xcode für einen lokalen iOS-Native-Build
- alternativ ein eingerichtetes Expo-/EAS-Konto für interne Geräte-Builds

```powershell
npm.cmd install
npm.cmd run workflow:setup
npm.cmd run web
```

Expo Go wird nicht unterstützt, weil es nicht mit der projektspezifischen SQLCipher-Konfiguration gebaut ist. Native Entwicklung und Abnahme müssen in einem eigenen nativen Build erfolgen.

Lokalen Native-Build starten. Android bleibt bis zur erneuten technischen und realen Geräteabnahme pausiert:

```powershell
npx.cmd expo run:android
# auf macOS:
npx.cmd expo run:ios
```

Auf Windows wird der iOS-Build über EAS erzeugt. Das EAS-Projekt ist bereits verknüpft; vor einem freigegebenen Build werden Konto, Projekt und Zugangsdaten geprüft.

Die generierten Verzeichnisse `android/` und `ios/` sind lokale Buildartefakte und werden nicht committed.

## Qualitätssicherung

```powershell
npm.cmd run verify:fast
# vor Release-Kandidaten oder größeren Integrationen:
npm.cmd run verify:full
```

Die Tests decken unter anderem Kalender- und Feiertagslogik, Monatswechsel, Schnelleingabe, Abwesenheiten, Nachtarbeit, TVöD-Zulagen, Gehaltsaggregation, ArbZG-Hinweise sowie SQLite-Migrationen und CRUD-Lebenszyklen ab.

Aufgaben werden über kurzlebige `codex/<thema>`-Branches und Pull Requests bearbeitet. Scope, Gates und Geräteabnahme sind in der [Workflow-Dokumentation](WORKFLOW.md) festgelegt.

## Release-Kandidat

Die lokale Release-Konfiguration trennt zwei sichere Wege:

- `preview`: intern installierbare iOS-Builds; das vorhandene Android-Profil bleibt für die spätere Wiederaufnahme erhalten
- `production`: Store-Builds mit automatisch erhöhten Buildnummern; Android bleibt bis zur ausdrücklichen Wiederaufnahme pausiert

Vor einem ausdrücklich freigegebenen signierten Build werden die bestehende Projektverknüpfung und das Expo-Konto geprüft:

```powershell
npx.cmd eas-cli@latest whoami
npx.cmd eas-cli@latest build --platform ios --profile preview
```

Expo-, Apple- und Google-Zugangsdaten gehören nicht ins Repository. TestFlight-, Play-Console-, Datenschutz- und Store-Metadaten werden außerhalb des Quellcodes gepflegt.

Die vollständige Abnahme steht in der [Release-Checkliste](docs/release-checklist.md). Für TestFlight gelten zusätzlich der [Release-Schutz](docs/testflight-release-schutz.md), die passende native Runtime und eine gesonderte Veröffentlichungsfreigabe. Gewöhnliche Dokumentation ist vom eingefrorenen App-Quellvergleich ausgenommen; reine README-Änderungen benötigen keine OTA und keinen neuen nativen Build.

## Testlabor

Das interne Testlabor erzeugt reproduzierbare Testmonate und ist ausschließlich in Entwicklungs- und internen Preview-Builds verfügbar:

1. Tab **Mehr** öffnen.
2. Die obere grüne LUNA-Shift-Karte fünf Sekunden gedrückt halten.
3. Unter **Intern** das **Testlabor** öffnen.

Verfügbar sind unter anderem normale Rotation, zuschlagsreiche Monate, Compliance-Fälle und UI-Stresstests. Testläufe sichern vorhandene Monatsdaten und können anschließend wiederhergestellt oder übernommen werden.

## Projektstruktur

```text
app/                         Expo-Router-Routen und Tab-Stacks
src/application/             Provider und reaktiver App-Zustand
src/domain/                  Typen und Eingabevalidierung
src/engine/                  Kalender-, Arbeitszeit-, TVöD- und Gehaltslogik
src/features/                Kalender, Auswertung, Gehalt, Editoren und Einstellungen
src/infrastructure/database/ SQLCipher-Start, SQLite-Migrationen und getrennte Repositories
src/navigation/              Tabs und typisierte Routenziele
src/theme/                   semantische Farben und Schichtdarstellung
src/ui/                      wiederverwendbare Design- und Formkomponenten
scripts/                     reproduzierbare Markenassets
```

## Technischer Stand

- Expo SDK 57
- Expo Router mit nativen Tabs auf iOS und Android
- React Native New Architecture und React Compiler
- SQLite als lokale Datenquelle
- SQLCipher und SecureStore für lokale Verschlüsselung
- Vitest mit Coverage-Schwellen sowie Jest/RNTL für Komponententests
- statischer Web-Export
