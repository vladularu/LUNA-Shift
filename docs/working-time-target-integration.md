# Automatische Sollzeit-Prognose in Auswertung und Export

Stand: 25.10.2026. D5 vereinfacht die verbleibenden Beschäftigungsmenüs und ist lokal vollständig geprüft. Die zuletzt veröffentlichte Preview-Fassung ist D4.

## Ergebnis und Ursache

Die Monatsauswertung rief die zentrale Sollzeit-Engine ohne die bereits gespeicherten Arbeitszeitregeln auf. Das zusätzliche Profilformular änderte deshalb die angezeigte Sollzeit nicht. D2 versorgt die bestehenden Berechnungswege jetzt mit einem gemeinsamen, flüchtigen Berechnungsprofil. Das gespeicherte Benutzerprofil und die Gehaltsregeln bleiben davon getrennt.

Der qualifizierte Referenzfall TVöD-K / BT-K, Hessen, 38,5 Stunden, Dezember 2026 ergibt 10.626 Minuten Monatsbasis minus viermal 462 Minuten = **8.778 Minuten / 146:18 Stunden**. Die Voraussetzungen sind im Test ausdrücklich festgelegt: bestätigter regelmäßiger persönlicher 7-Tage-Schichtdienst mit Fünftel-Referenz, bestätigte Freistellung und ausgefallene 462 Minuten am 24./31. Dezember, sowie unabhängig vom Feiertag dienstplanmäßig frei mit anderweitig zu erbringender Wochenarbeitszeit am 25./26. Dezember. ATOSS ist Vergleichswert; Rechtsquellen stehen in [der Quellenprüfung](working-time-target-sources.md).

## Automatik und verbleibende Fragen

- Vorhandene Wochenstunden, Bundesland/Feiertagsregion und Tarifzuordnung werden übernommen.
- Explizit gespeicherte persönliche Arbeitszeitmodelle und deren historische Geltung werden verwendet.
- Neuere datierte Vergütungsprofile liefern Wochenstunden-/Tarifwechsel. Eine später ausdrücklich gespeicherte Arbeitszeitperiode hat gegenüber einem älteren Vergütungssnapshot Vorrang.
- Eine geänderte feste Tagesverteilung wird nicht proportional erfunden: sie bleibt offen.
- Die App berechnet im FORECAST-Modus aus Vertragsdaten, Tarif und Feiertagen. Kalenderdienste und gespeicherte Einzelbestätigungen ändern diese Prognose nicht. Alle Prognosepositionen bleiben entsprechend gekennzeichnet; die strikte Anspruchsrechnung ist weiterhin separat mit expliziten Engine-Kontexten möglich.
- Die vorhandene Sonn-/Feiertagsangabe liefert die Standardverteilung: Ja → wechselndes Siebentagemodell, Nein → feste Montag-bis-Freitag-Referenz, Unbekannt → sichtbar vorläufige unbekannte Verteilung. Das Feld beschreibt ursprünglich rechtliche Erlaubnis, daher ist diese Ableitung eine Prognoseannahme und kein Nachweis des individuellen Dienstplans. Nachtarbeit ist keine Voraussetzung für Siebentagebetrieb.
- Eine ausdrücklich gespeicherte Verteilung hat Vorrang; die Ableitung wird nicht zurückgeschrieben. Datierte Profilgrenzen und historische Lücken bleiben erhalten. Für Bestandsprofile ohne dokumentierte Historie dient das aktuelle Profil sichtbar als Referenz.
- Es gibt keine Tagesabfragen oder Tageskorrekturformulare mehr. Ein undatierter Arbeitsortwechsel braucht weiterhin eine zeitliche Zuordnung im optionalen Verlauf; der Adapter erfindet kein historisches Datum.

## Bedienung

Auswertung → Arbeitszeit öffnet Ergebnis und eine aufklappbare Rechnung. Beschäftigungsdaten sind kompakt zusammengefasst; Änderungen führen zum bestehenden Wochenstunden-/Arbeitsort-/Tarifeditor. Im normalen Ablauf erscheinen keine Tagesfragen. Eine fehlende regionale Feiertagszuordnung oder eine explizite historische Lücke kann eine weitere Angabe erfordern. Kalendereinträge lösen keine Rückfragen zur Prognose aus. Die Verteilung wird angezeigt und aus den vorhandenen Angaben übernommen; die doppelte Arbeitstage-Auswahl entfällt mit D5. Frühere Beschäftigungsänderungen bleiben über ein kurzes Formular erreichbar. Die alte Meldung, die Monatsauswertung verwende diese Angaben noch nicht, entfällt.

## Gemeinsame Berechnungswege

Monatsauswertung, Jahresauswertung einschließlich Cache, Stunden-/Tagesdetails, Kalenderrechnung sowie PDF und CSV verwenden dieselbe zentrale Engine und dasselbe Berechnungsprofil. Der Jahreswert bleibt nicht verfügbar, wenn Teile der expliziten Historie fehlen. Vorläufige Ergebnisse werden als solche angezeigt. PDF kennzeichnet vorläufige Sollwerte; CSV ergänzt die Eintragsliste um eine gekennzeichnete Sollzeitrechnung mit Datum, Abzug, Bedingung und Rechtsgrundlage. Die vorhandenen Eintrags-Spalten bleiben erhalten.

Sollzeitabzüge erzeugen keine Iststunden und ändern keine Gehaltszuschläge. Eine reine Änderung des manuellen Gehaltsbetrags gilt nicht als Wechsel des bestätigten Arbeitszeittarifs. Die bestehende eigenständige Abwesenheitsgutschrift bleibt getrennt; abweichende tarifliche Urlaubs-/Krankheitsbewertungen sind weiterhin Folgeumfang.

## Tarifumfang und Grenzen

Prognose im geprüften Umfang: feste Vertragsverteilung und TVöD-K / BT-K und TVöD-B / BT-B 2026–2027 mit getrennten Regelkennungen und tarifbezogener Monatsreferenz. TVöD-K, Hessen, Dezember 2026, 38,5 Stunden: 146:18 im Siebentagemodell, 154:00 bei fester Montag-bis-Freitag-Verteilung. Individuelle Tagesvoraussetzungen werden nur für die getrennte strikte Anspruchsrechnung benötigt.

VKA E, TV-L/KR, TV-H, TV-UK, TVAöD, TVA-L, Caritas/AVR und DRK erhalten durch D2 **keine** unbestätigten TVöD-K-Sonderregeln. Ohne geprüfte Regeln bleibt eine vorhandene Referenzberechnung ausdrücklich vorläufig. Eigene Vergütung begründet keine erfundenen Tarifansprüche. Einzelheiten zum geprüften Unterstützungsstatus: [Tarifmatrix](working-time-target-analysis.md). Der Prüfzeitraum der spezifischen BT-K-Regeln umfasst 2026 und 2027; Quellen, unabhängige Kontrollwerte und Versionskompatibilität stehen in [der 2027-Prüfung](working-time-target-2027.md). Spätere Jahre und unbekannte Tarifversionen bleiben vorläufig.

Keine Schemaänderung, keine Überschreibung bestehender Profile und keine neue Backup-Version. Unveränderte alte Tagesbindungen werden einmalig transaktional in ein präziseres Vergleichsformat übernommen. Nur tatsächlich unveränderte alte Bindungen werden übernommen; bereits veraltete Belege bleiben offen. Der Testlaborbetrieb schreibt diese Metadaten nicht um. Reine Notiz-/Zuschlagsänderungen entwerten anschließend keine Tagesbestätigung. Explizite historische Lücken werden nicht mit aktuellen Profilangaben gefüllt. Für Bestandsprofile ohne bestätigte Historie bleibt die Berechnung vorläufig; die neue automatische Planung bestätigt keine individuellen Ansprüche und schreibt keine Profile um.

Die [Kalenderkennzeichnung tariflicher Sondertage](calendar-tariff-special-days.md) übernimmt nun die Positionen derselben Engine: offene Raute am Sondertagsnamen, vollständige Bezeichnung im Tagesfenster und für VoiceOver. Gesetzliche Feiertage bleiben davon getrennt. Die Kalenderdarstellung wurde am 26.10.2026 vom Nutzer auf dem iPhone bestätigt und mit PR #313 gemergt. Der BT-B-Adapter nutzt diese vorhandene Darstellung ohne neue Oberfläche.

## Abnahme und Folgeschritte

Die D2-Abschlussprüfung vor dem Gerätefeedback war bestanden: Typecheck, ESLint ohne Warnungen, Formatprüfung und vollständiges verify:fast einschließlich **9.241 Unit-/Integrationstests in 479 Dateien**, **1.419 Komponententests in 154 Suiten** sowie sämtlicher weiterer Skript-/Sicherheitsprüfungen. Unter Windows lief Vitest mit einem temporären seriellen Threadpool; die originale Konfiguration wurde danach bytegenau wiederhergestellt. Das Architektur-Budget wurde unverändert eingehalten.

D2 vor der Korrektur: Der lokale iOS-Export mit APP_VARIANT=internal war erfolgreich. Die damaligen Prüfsummen aller 46 betroffenen Code-/Test-/Konfigurationsdateien sind seit Beginn der finalen Prüfung unverändert. Bundle: entry-73dca8fab4db9a35ce6ea0ea98c0cf30.hbc, SHA-256: 21bed108adfb50376fa771fa7404f6444de37bce1b76e61bc06f9fd8d6403973. Das ist ein lokaler JavaScript-/Asset-Build, kein nativer EAS-Build und kein Gerätenachweis.

Die im Entwicklungsverlauf gefundenen Architektur-/Testannahmen und die Datenbindung bei Notiz-/Zuschlags-/Gehaltsänderungen wurden korrigiert; der vollständige Abschlusslauf erfolgte danach auf dem unveränderten Quellstand. Eine reale iPhone-Abnahme ist noch offen. Dabei zuerst den kurzen Einstieg über Auswertung → Arbeitszeit prüfen, vorhandene Beschäftigungsdaten weiterverwenden und den Dezember-Referenzfall nur mit den tatsächlich festgelegten Voraussetzungen vergleichen. Git-Delivery, OTA, native Builds und Store-Veröffentlichungen sind separate Freigaben.

Danach die weiteren Tariffamilien einzeln anhand ihrer Quellen anbinden. Zusatzurlaub, Ersatzruhe/Freizeitausgleich, Arbeitszeitkonto, Bereitschaft/Rufbereitschaft und abweichende Urlaubs-/Krankheitsbewertung bleiben abgegrenzte Folgeaufgaben; sie sind keine pauschalen Sollzeitabzüge.

## Preview-Veröffentlichung am 24.10.2026

Nach ausdrücklicher Nutzerfreigabe wurde ausschließlich das geprüfte iOS-Bundle veröffentlicht: Kanal, Branch und EAS-Umgebung jeweils preview, APP_VARIANT=internal. Internal Build 43 und die neu ermittelte iOS-Fingerprint stimmen mit Runtime d0daa823a2a0b0965e5a1c7462b2885570aab578 überein.

- Update-Gruppe: 8a80bac6-199c-486a-9e61-90b0dfb45384
- iOS-Update: 01a16f56-9adf-7981-bcb1-16fc9e4ef431
- Veröffentlicht: 24.10.2026, 21:15 Uhr Europe/Berlin
- [EAS-Nachweis](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/8a80bac6-199c-486a-9e61-90b0dfb45384)

Das echte Preview-Manifest liefert diese Update-ID für die Runtime von Build 43 und die interne Bundle-ID aus. Das vom CDN geladene Hermes-Bundle hat denselben SHA-256-Wert wie der finale lokale Export (oben). Die Preview-Cloudkonfiguration ist im Bundle enthalten; alle 46 geprüften Quelldateien sind unverändert. Kein Commit, Push, Merge, nativer Build, TestFlight- oder Production-Release wurde ausgeführt.

Zur Geräteabnahme: interne App öffnen, etwa 15 Sekunden für den Download warten, vollständig schließen und erneut öffnen. Danach Auswertung → Arbeitszeit prüfen. Die technische Bereitstellung bestätigt noch keine erfolgreiche Nutzung auf dem iPhone.

## Dateiscope

Der Feature-Checkout enthält die nachfolgenden Dateien. Bereits vorhandene Detailformulare und Formmodelltests bleiben erhalten. D2 ergänzt Datenversorgung, Rechenintegration, semantische Tagesbindungen und den kurzen normalen Einstieg. Das unveränderte Architektur-Budget bleibt eingehalten.

- docs/working-time-target-integration.md
- docs/working-time-target-profiles.md
- jest.config.js
- src/application/pflegeshift-ports.ts
- src/application/pflegeshift-provider.notification.component.test.tsx
- src/application/pflegeshift-provider.tsx
- src/application/working-time-provider.tsx
- src/composition/create-pflegeshift-ports.ts
- src/composition/pflegeshift-runtime-provider.component.test.tsx
- src/domain/working-time-target.ts
- src/engine/daily-summary.ts
- src/engine/monthly-summary.ts
- src/engine/working-time-automatic-planning.test.ts
- src/engine/working-time-calculation-profile.test.ts
- src/engine/working-time-calculation-profile.ts
- src/engine/working-time-target.ts
- src/features/analysis/analysis-rule-coverage.component.test.tsx
- src/features/analysis/analysis-screen.tsx
- src/features/analysis/annual-core-report.ts
- src/features/analysis/annual-details-screen.tsx
- src/features/analysis/annual-overview.tsx
- src/features/analysis/annual-report-view.component.test.tsx
- src/features/analysis/annual-report.ts
- src/features/analysis/month-overview.tsx
- src/features/analysis/monthly-analysis.ts
- src/features/analysis/rule-computation.tsx
- src/features/analysis/worktime-details-screen.tsx
- src/features/calendar/calendar-metrics.ts
- src/features/calendar/calendar-screen.tsx
- src/features/day-details/day-details-screen.tsx
- src/features/report-export/report-data.ts
- src/features/report-export/report-document.ts
- src/features/report-export/report-entry-data.ts
- src/features/report-export/report-export-button.tsx
- src/features/report-export/report-formats.ts
- src/features/report-export/report-pdf.ts
- src/features/report-export/report-view-data.ts
- src/features/settings/use-working-time-target-settings.ts
- src/features/settings/working-time-profile-navigation.component.test.tsx
- src/features/settings/working-time-profile-screen.component.test.tsx
- src/features/settings/working-time-profile-screen.tsx
- src/features/settings/working-time-target-editor.component.test.tsx
- src/features/settings/working-time-target-editor.tsx
- src/features/settings/working-time-target-form-model.test.ts
- src/features/settings/working-time-target-form-model.ts
- src/features/settings/working-time-target-overview.tsx
- src/features/settings/working-time-target-quick-edit.tsx
- src/infrastructure/database/working-time-target-repository.test.ts
- src/infrastructure/database/working-time-target-repository.ts

## D3 – Korrektur nach Gerätefeedback vom 24.10.2026

Ziel: automatische tarifabhängige Monatsplanung aus bestehenden Angaben, ohne Feiertags-Aufgabenliste; genaue Einzelkorrekturen bleiben optional. Zwei Arbeitspakete: (1) zentrale Planwertberechnung und Datenableitung, (2) kurzer Einstieg und Regression. Plattform: bestehende interne iOS-App mit Expo 57. Keine native Integration.

Dateiscope: working-time-target-Domain, zentrale Engine, Berechnungsprofil und zugehörige Tests; Sollzeit-Übersicht, bestehender Detail-Editor und Komponententests; CSV-Status und diese Dokumentation. Keine Gehalts-/Zuschlagsregeln, keine Profil-/Backup-Migration. Feature-Branch codex/tarif-sollzeit-profile wird mit dem vorhandenen Stand fortgesetzt. Zu Beginn war keine neue Veröffentlichung oder Git-Delivery freigegeben. Die spätere ausdrückliche Preview-Freigabe und Veröffentlichung sind unten dokumentiert.

Abnahme: Der qualifizierte bestätigte Dezemberfall bleibt 146:18. Ein passendes Arbeitsprofil liefert denselben automatischen Planwert auch ohne Tagesbestätigungen, ausdrücklich als Planung. Bestätigte abweichende Angaben und eingetragene Dienste haben Vorrang; Arbeit am 24./31. erzeugt keinen fiktiven Sollzeitabzug. Kein Sonn-/Feiertagssignal überschreibt eine explizite feste Verteilung oder historische Lücke. Nicht geprüfte Tarife erben keine BT-K-Regeln. Normaler Einstieg: Ergebnis, aufklappbare Rechnung, kompakte Beschäftigungsdaten; keine Liste abzuarbeitender Tage und kein technischer Routentitel.

Fachliche Grenze: Das vorhandene Feld sundayHolidayWorkEligible bedeutet rechtliche Erlaubnis zur Sonn-/Feiertagsarbeit. Es ist ein Indiz für eine automatische Modellannahme, kein bestätigter persönlicher 7-Tage-Schichtplan. Solche Annahmen und gleichmäßig verteilte Sondertags-Referenzstunden bleiben als Planwerte gekennzeichnet und werden niemals als Bestätigung gespeichert. Individuell ausgefallene Stunden nach § 6 Abs. 3 bleiben vom Fünftelbetrag des § 49 Abs. 2 getrennt (BAG 6 AZR 143/16, Rn. 27–28).

### D3 – Prüfungsergebnis und verbleibende Grenzen

Das vollständige verify:fast ist nach der Bereinigung bestanden: Typecheck, ESLint ohne Warnungen, Formatprüfung, 9.254 Unit-/Integrationstests in 480 Dateien, 1.420 Komponententests in 154 Suiten und sämtliche weiteren Repository-Gates. Wie im vorherigen Lauf wurde Vitest unter Windows temporär seriell mit Threads ausgeführt; die originale Konfiguration ist bytegenau wiederhergestellt. Die Prüfsummen aller 47 erfassten Code-/Test-/Konfigurationsdateien sind während Gate und Export unverändert geblieben.

Der lokale iOS-Export in der EAS-Umgebung preview mit APP_VARIANT=internal und vorhandener öffentlicher Cloudkonfiguration ist erfolgreich. Bundle: entry-5320b90875d73dfcc7226d0951e8fccb.hbc. SHA-256: cb11b73ec55c457e35de3a2c2fb2d778a5e1984478a914d3faef2130ab0d7bb5. Für den Export wurde kein nativer EAS-Build gestartet. Das anschließend separat freigegebene Preview-Update ist unten dokumentiert. Eine erneute Abnahme des normalen Ablaufs auf dem iPhone steht noch aus.

| Konstellation                                                                                    | Unabhängige Referenz für den Planwert | Status                                                          |
| ------------------------------------------------------------------------------------------------ | ------------------------------------- | --------------------------------------------------------------- |
| TVöD-K, Hessen, Dezember 2026, 38,5 Stunden, passende wechselnde Verteilung, Tagesangaben fehlen | 177:06 − 4 × 7:42 = 146:18            | Automatische Planung, keine Bestätigung gespeichert             |
| Derselbe Fall mit den vollständig belegten Tagesvoraussetzungen                                  | 146:18                                | Bestätigte Rechnung bleibt unverändert                          |
| Dienst am 24. und 31. Dezember eingetragen                                                       | 177:06 − 2 × 7:42 = 161:42            | Sondertagsarbeit erzeugt keine fiktive Abwesenheit; FZA separat |
| Explizite feste Montag–Freitag-Verteilung, Sondertagsfreistellung als Planwert                   | 177:06 − 3 × 7:42 = 154:00            | Kein zusätzlicher Samstag-Abzug                                 |
| TVöD-K, 20 Stunden, passende wechselnde Verteilung                                               | 23 × 4:00 − 4 × 4:00 = 76:00          | Teilzeit-Planwert                                               |
| Hessen, Juli 2026                                                                                | 23 × 7:42 = 177:06                    | Kein Feiertags-/Sondertagsabzug                                 |
| Hessen, Oktober 2026, passende wechselnde Verteilung                                             | 22 × 7:42 − Samstag 03.10. = 161:42   | Samstagsregel als Planwert                                      |
| Nordrhein-Westfalen, November 2026                                                               | 21 × 7:42 = 161:42                    | Kein zusätzlicher Abzug für Allerheiligen am Sonntag            |

Der normale Einstieg enthält Ergebnis, kompakte Beschäftigung und eine zugeklappte Rechnung. Der native Seitentitel lautet Arbeitszeit. Die Liste Noch offen für und automatische Tages-Prüfaufforderungen entfallen auch im optionalen Verlauf. Tageskorrekturen werden nur auf ausdrücklichen Tipp auf eine Rechnungsposition geöffnet. Vorhandene Dienste haben Vorrang vor veralteten Tagesannahmen. Echte Dienst-/Abwesenheitskonflikte führen zu einem gezielten Kalenderhinweis. Keine neue Profileinstellung und keine Datenmigration.

Gegenüber dem zuletzt veröffentlichten D2-Stand sind elf Dateien betroffen: src/domain/working-time-target.ts; src/engine/working-time-calculation-profile.ts; src/engine/working-time-calculation-profile.test.ts; src/engine/working-time-target.ts; die neue src/engine/working-time-automatic-planning.test.ts; src/features/report-export/report-formats.ts; src/features/settings/working-time-target-overview.tsx; src/features/settings/working-time-profile-screen.tsx; src/features/settings/working-time-profile-screen.component.test.tsx; src/features/settings/working-time-profile-navigation.component.test.tsx; diese Dokumentation.

Die einfache Oberfläche gilt auch für weitere Tariffamilien; zusätzliche Sondertags-/Samstagsregeln wurden ihnen nicht ungeprüft zugeordnet. Die individuelle Prüfung von TVöD-B, TV-L, TV-H, TV-UK und den Ausbildungs-/AVR-/DRK-Modellen bleibt separates Paket C. Ein Signal für erlaubte Sonntagsarbeit ist weiterhin kein bewiesener persönlicher Siebentageplan. Die automatische Verteilung ist daher eine sichtbar angenommene Planung und überschreibt keine explizite Historie oder feste Verteilung. Historische Lücken bleiben nicht verfügbar. Für Regionen, deren Feiertagskatalog den erforderlichen regionalen Vertrag noch nicht unterstützt, wird kein sicherer Wert erfunden; dieser Fall ist ebenfalls getestet. Der konkrete BT-K-Quellenprüfzeitraum bleibt 2026. Die Quellenprüfung für 2027 und weitere Tariffamilien folgt getrennt.

### D3 – Preview-Veröffentlichung

Nach ausdrücklicher Nutzerfreigabe veröffentlicht am 24.10.2026 um 22:06 Uhr Europe/Berlin, ausschließlich für iOS im Kanal, Branch und EAS-Environment preview mit APP_VARIANT=internal.

- Update-Gruppe: 33b0f104-c175-4f63-810e-705875d7bf6f
- iOS-Update: 01a16f85-de23-7425-9043-94673e82e687
- Runtime: d0daa823a2a0b0965e5a1c7462b2885570aab578; frisch gegen Internal Build 43 und lokale iOS-Fingerprint geprüft
- Bundle-SHA-256: cb11b73ec55c457e35de3a2c2fb2d778a5e1984478a914d3faef2130ab0d7bb5
- [EAS-Nachweis](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/33b0f104-c175-4f63-810e-705875d7bf6f)

Das echte Expo-Updates-Manifest liefert diese Update-ID für die interne App und passende Runtime. Das heruntergeladene CDN-Bundle stimmt bytegenau mit dem geprüften lokalen Export überein. Alle 47 erfassten Quelldateien sind unverändert; vorhandene öffentliche Preview-Cloudkonfiguration ist enthalten. Kein Commit, Push, Merge, nativer Build, TestFlight- oder Production-Release wurde ausgeführt.

Geräteprüfung bleibt offen: interne App öffnen, etwa 15 Sekunden für den Download warten, vollständig schließen und erneut öffnen. Danach Auswertung → Arbeitszeit prüfen. Die neue Fassung trägt den Seitentitel Arbeitszeit und zeigt keine automatisch erzeugte Feiertags-Aufgabenliste.

## D4 – Monatsreferenz und vollständiger Wegfall der Tagesabfragen

Auslöser: Geräte-Screenshots nach Preview-Gruppe 33b0f104-c175-4f63-810e-705875d7bf6f zeigen 161:42 und zwei ausgeschlossene Sondertage wegen eingetragener Dienste. Der Nutzer bestätigt erneut, dass der Dezember-Monatsvergleich 146:18 ergeben soll und Tagesfragen zu Dienst/frei überflüssig sind.

Ziel: Im bestehenden automatischen TVöD-K-Siebentage-Modell bleibt die monatliche Fünftel-Referenz auch bei eingetragenen Diensten am 24./31. erhalten. Die Monatsreferenz ist kein festgestellter kumulativer Tagesanspruch. Solche Positionen erhalten eine eigene Referenzregel-ID und bleiben ausdrücklich vorläufig. Einzeltag-Korrekturdialoge werden aus dem gesamten Sollzeitfluss einschließlich Verlauf entfernt; Rechnungspositionen sind reine Anzeige.

Nicht-Ziele: keine neue Vergütungs-, Arbeitszeitkonto- oder Freizeitausgleichsbuchung; keine pauschale Erweiterung auf andere Tariffamilien; keine Änderung an gespeicherten Daten oder Backup-Formaten; kein nativer Eingriff. Zu Beginn waren Git-Delivery und neue Veröffentlichung nicht freigegeben. Die anschließende ausdrückliche Preview-Freigabe gilt nur für das unten dokumentierte Update. Plattform: Internal iOS mit Expo 57. Bestehender Feature-Branch codex/tarif-sollzeit-profile wird fortgesetzt.

Dateiscope (zwei Arbeitspakete): (1) zentrale Engine, Vertragsadapter, Provider und Regeldefinition plus fachliche Regressionen; (2) Sollzeit-Übersicht, Profil-/Verlaufsansicht, Arbeitszeitmodell-Editor, Entfernung der beiden Tagesformulare und zugehörige Komponententests. Dazu diese Abnahmedokumentation und Quellenprüfung. Keine native Integration.

Abnahme: 146:18 als automatische Monatsreferenz für den angegebenen TVöD-K-Fall sowohl ohne Tagesangaben als auch mit Diensten am 24./31.; tatsächliche Minuten und Gehaltsberechnung bleiben identisch. Keine zusätzlichen Iststunden, kein doppelt verbuchter FZA, keine automatische Bestätigung eines Anspruchs. Explizit verneinte Geltung/abweichende feste Verteilung und historische Lücken bleiben geschützt. Nicht anklickbare Tagespositionen; keine Fragen Dienst/frei, Dienstplanstatus, Ausfallstunden oder Nacharbeitspflicht im gesamten erreichbaren Sollzeitfluss. Typecheck, ESLint, fokussierte Regressionen, verify:fast und iOS-Export; iPhone-Abnahme nach separater Preview-Freigabe.

Erneute Quellenprüfung: [BAG 6 AZR 286/12](https://www.bundesarbeitsgericht.de/entscheidung/6-azr-286-12/) trennt in Rn. 38 die Fälle Freistellung, Arbeitsleistung mit entsprechendem FZA und planmäßig frei; der dort entschiedene Sollzeitabzug betrifft planmäßig freie Tage. Rn. 41 beschreibt zusätzliche bezahlte Freizeit für alle Beschäftigten. Daraus folgt weder ein zwingender universeller Fünftel-Abzug bei Arbeit noch dessen zwingende Ausbuchung aus jeder betrieblichen Monatsreferenz. Die bisherige App hatte die konservative Tagesanspruchsprüfung auf die bereits als Planwert gekennzeichnete Monatsreferenz übertragen. D4 trennt diese Berechnungszwecke: automatische Monatsreferenz mit eigener Kennzeichnung versus unveränderte strikte Anspruchsrechnung. Die vom Nutzer genannte ATOSS-Zahl ist eine externe Monatsreferenz, keine Rechtsquelle und keine generelle Feststellung des FZA-Umfangs oder seiner Buchungsperiode.

### D4 – Präzisierung durch den Nutzer während der Untersuchung

Die ausdrücklich gewünschte Ausgabe ist die Prognose der Sollzeit aus bereits erfragten Beschäftigungsdaten. Sie ist unabhängig von Diensteinträgen. Diese Klarstellung ersetzt den zuvor diskutierten Ansatz einer einzelnen Ausnahme nur für Arbeit an den Sondertagen.

Die App verwendet deshalb einen expliziten FORECAST-Modus derselben zentralen Engine. Dieser berechnet aus datierten Vertragsdaten, Arbeitszeitverteilung und geprüften Tarifregeln, ignoriert jedoch Diensteinträge und gespeicherte Tagesanspruchsbestätigungen. Die bisherige strikte Tagesanspruchsrechnung bleibt als ROSTER-Modus für explizite Engine-Kontexte erhalten. Alle App-Prognosen bleiben als Prognose gekennzeichnet; keine Anspruchsbestätigung wird dadurch erfunden. Bestehende Tagesbelege werden nicht gelöscht oder überschrieben.

Erlaubte Datenableitung: Sonn-/Feiertagsarbeit im bestehenden Profil liefert bei fehlender persönlicher Verteilung automatisch die wechselnde Siebentage-Referenz als Prognoseannahme. Explizit gespeicherte feste Verteilungen, ausdrücklich verneinte Voraussetzungen und datierte Profilgrenzen haben weiterhin Vorrang. Keine erneute Modellbestätigung ist für den Standardfall nötig.

Der erweiterte Umfang wird in zwei getrennten Arbeitspaketen umgesetzt: A – Modus, Engine, Vertragsadapter, Provider und fachliche Regressionen; B – Entfernung beider Tagesformulare und aller erreichbaren Tagesaktionen sowie UI-Regressionen. Zusammen voraussichtlich 16 Dateien einschließlich Quellen- und Abnahmedokumentation, keine native Integration. Gehalt, tatsächliche Stunden und Zeitkontobuchungen bleiben unverändert.

### D4 – Ergänzung: Tagesklinik ohne Sonn- und Feiertagsarbeit

Die vorhandene Antwort wird für die Prognose in beide Richtungen verwendet: `true` → wechselnde Fünftageverteilung im Siebentagebetrieb; `false` → feste Montag-bis-Freitag-Referenz; `null` → Verteilung bleibt unbekannt und sichtbar vorläufig. Eine ausdrücklich datierte Verteilung hat Vorrang. Bei ungleich durch fünf teilbaren Wochenminuten erhält Freitag den ganzzahligen Rest, entsprechend der vorhandenen Modellbearbeitung. Für TVöD-K, Hessen, 38:30 Wochenstunden im Dezember 2026 ergeben sich so **146:18** im Siebentagemodell und **154:00** im festen Montag-bis-Freitag-Modell. Keine dieser Prognosen benötigt einzelne Dienste oder Tagesbestätigungen.

### D4 – Abschluss und Abnahmegrenzen (25.10.2026)

Ursache des weiterhin falschen Werts 161:42: Die App-Prognose verwendete eingetragene Dienste als Beleg gegen den Sondertagsabzug. Damit wurden individuelle Tagesansprüche und die vom Nutzer gewünschte Monatsprognose vermischt. Der Vertragsadapter liefert jetzt explizit FORECAST an dieselbe zentrale Engine. Dieser Modus ignoriert Kalendereinträge und Tagesbestätigungen vollständig; die strikte ROSTER-Rechnung bleibt unverändert für explizite Engine-Kontexte bestehen. Die Prognose erzeugt keine Iststunden oder FZA-Buchungen und bestätigt keine Tagesansprüche.

| TVöD-K / BT-K 2026, Hessen, 38,5 Stunden              | Unabhängige Kalender-/Vergleichsreferenz                      | Ergebnis   |
| ----------------------------------------------------- | ------------------------------------------------------------- | ---------- |
| Dezember, wechselnde fünf Tage im Siebentagebetrieb   | 23 × 7:42 − 24./25./26./31.12., je 7:42; ATOSS-Vergleichswert | **146:18** |
| Dezember, keine Sonn-/Feiertagsarbeit, Montag–Freitag | 23 × 7:42 − 24./25./31.12., je 7:42; kein Samstagsabzug       | **154:00** |
| Dezember, sieben Tage, 20 Wochenstunden               | 23 × 4:00 − vier Referenztage × 4:00                          | **76:00**  |
| Juli, keine Feiertage in Hessen                       | 23 × 7:42                                                     | **177:06** |
| Oktober, sieben Tage                                  | 22 × 7:42 − Samstag 03.10., 7:42                              | **161:42** |
| Oktober, Montag–Freitag                               | 22 × 7:42; 03.10. liegt außerhalb der Verteilung              | **169:24** |

Die Dezemberprognose bleibt bei leerem Kalender, Diensten an allen vier Tagen, Mitternachtsdiensten, freien Tagen, widersprüchlichen Kalendereinträgen und alten Tagesbestätigungen gleich. Gesondert getestet sind Teilzeit, datierte Wochenstunden-/Tarifwechsel, historische Grenzen, Bundesländer, Sonntagfeiertage, unbekannte Modelle und nicht geprüfte Tarifstände. Die gemeinsame Integrationsprüfung umfasst Monatsauswertung, tägliche Kalenderrechnung, Jahresauswertung einschließlich Cache sowie PDF-/CSV-Daten. Tatsächliche Stunden und Gehaltsberechnung bleiben gleich.

Die Tagesaktionen wurden vollständig aus der aufgeklappten Rechnung und dem optionalen Beschäftigungsverlauf entfernt. Beide bisherigen Tagesformulare entfallen. Alte Datensätze, Schema und Backups bleiben erhalten; die optionale datierte Beschäftigungsbearbeitung und eine ausdrückliche Modellabweichung bleiben möglich. Kalenderänderungen laden die Vertragsprognose nicht mehr neu und machen sie nicht vorübergehend unverfügbar. Es ist keine zusätzliche Profileingabe im vorhandenen Standardfall nötig.

Das vollständige `npm.cmd run verify:fast` ist bestanden: Typecheck, ESLint ohne Warnungen, Formatprüfung, **9.260 Unit-/Integrationstests in 480 Dateien**, **1.419 Komponententests in 154 Suiten** und alle weiteren Repository-Gates. Vitest lief unter Windows temporär seriell mit Threads; die originale Konfiguration wurde bytegenau wiederhergestellt. Alle **48** erfassten Code-/Test-/Konfigurationsdateien sind während Gate und Export unverändert geblieben.

Der lokale iOS-Export mit vorhandener öffentlicher Preview-Konfiguration und `APP_VARIANT=internal` ist bestanden. Bundle: `entry-e8f3f058fb599392075ac6e869f43be5.hbc`. SHA-256: `a2361927e7eef41a8e2eeee0a036850785839ad5d7610624dab55d5a7fe9e087`. Kein nativer EAS-Build wurde gestartet. D4 wurde anschließend nach ausdrücklicher Freigabe als Preview-Update veröffentlicht; die Prüfung auf dem echten iPhone bleibt erforderlich (Nachweis unten). Keine neue Commit-/Push-/Merge-/TestFlight-/Production-Aktion wurde ausgeführt.

Der geprüfte BT-K-Regelumfang bleibt 2026. Andere Tariffamilien erhalten keine TVöD-K-Sonderabzüge; deren verifizierte Erweiterung bleibt Paket C. Fehlende regionale Katalogunterstützung und explizite historische Lücken bleiben sichtbar nicht verfügbar. Die Prognose ist keine Abrechnung individueller Ausfallstunden, Freizeitausgleichsansprüche oder betrieblicher Arbeitszeitkonten.

Geänderte Dateien gegenüber D3 (14 Code-/Testdateien plus diese Dokumentation):

- `src/application/pflegeshift-provider.notification.component.test.tsx`
- `src/application/working-time-provider.tsx`
- `src/domain/working-time-target.ts`
- `src/engine/working-time-automatic-planning.test.ts`
- `src/engine/working-time-calculation-profile.test.ts`
- `src/engine/working-time-calculation-profile.ts`
- `src/engine/working-time-target-rules.ts`
- `src/engine/working-time-target.ts`
- `src/features/settings/working-time-profile-screen.component.test.tsx`
- `src/features/settings/working-time-profile-screen.tsx`
- `src/features/settings/working-time-target-editor.component.test.tsx`
- `src/features/settings/working-time-target-editor.tsx`
- `src/features/settings/working-time-target-overview.tsx`
- `src/features/settings/working-time-target-quick-edit.tsx`

### D4 – Preview-Veröffentlichung

Nach ausdrücklicher Nutzerfreigabe veröffentlicht am 25.10.26, 00:14:44 Europe/Berlin, ausschließlich für iOS im Kanal, Branch und EAS-Environment preview mit APP_VARIANT=internal.

- Update-Gruppe: 843f4224-ddac-4651-a01a-85b57c5f4fad
- iOS-Update: 01a16ffb-066d-7c0a-8f88-0ad2273ba7e4
- Runtime: d0daa823a2a0b0965e5a1c7462b2885570aab578, frisch gegen Internal Build 43 und lokale Runtime geprüft
- Bundle-SHA-256: a2361927e7eef41a8e2eeee0a036850785839ad5d7610624dab55d5a7fe9e087
- [EAS-Nachweis](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/843f4224-ddac-4651-a01a-85b57c5f4fad)

Der veröffentlichte Export ist bytegenau das zuvor getestete lokale Bundle. Die unabhängige aktuelle Preview-Liste führt D4 als neuestes Update. Das echte Expo-Updates-Manifest liefert die neue Update-ID für die interne App mit passender Runtime. Der CDN-Download stimmt per SHA-256 mit dem lokalen Export überein; die erforderlichen Asset-Request-Header wurden berücksichtigt. Alle 48 erfassten Quelldateien sind unverändert, und die vorhandene öffentliche Preview-Cloudkonfiguration ist im Bundle enthalten. Kein Commit, Push, Merge, nativer Build, TestFlight- oder Production-Release wurde ausgeführt.

Geräteabnahme bleibt offen: LUNA Shift Internal vollständig schließen, öffnen, etwa 15 Sekunden für den Download warten, vollständig schließen und erneut öffnen. Danach Auswertung → Arbeitszeit → Dezember 2026 prüfen: Der passende TVöD-K-/Hessen-/38,5-Stunden-Siebentagefall soll 146:18 anzeigen, mit vier Referenzabzügen und ohne Tagesabfragen. Die feste Montag-bis-Freitag-Prognose ergibt 154:00.

## D5 – Keine zweite 5-/7-Tage-Abfrage (25.10.2026)

Auslöser: Nach D4 zeigt das Gerätefeedback weiterhin die optionale Arbeitstage-Auswahl und den alten Beschäftigungsassistenten mit Verteilungs-, Monatsbasis- und BT-K-Bestätigungen. Diese Oberfläche ist für die bereits automatisch abgeleitete Prognose redundant.

Ziel: Die separate Modellfrage und ihre Einstiege vollständig entfernen. Im Beschäftigungsverlauf bleibt ein einziges kurzes Formular für tatsächliche datierte Änderungen: Gültigkeit, Wochenstunden und Arbeitsort; optionale Eintritts-/Austrittsgrenzen bleiben aufklappbar. Tarif und Standardverteilung werden aus vorhandenen Angaben übernommen, bestehende individuelle Verteilungen und verneinte Voraussetzungen erhalten. Individuelle feste Tagesstunden sind ausschließlich dann relevant, wenn eine bereits gespeicherte abweichende Verteilung bei geänderten Wochenstunden sonst widersprüchlich würde.

Nicht-Ziele: keine Änderung der Sollzeit- oder Gehaltsformeln, keine neue Tarifregel, keine Datenbereinigung oder Migration, kein nativer Eingriff. Plattform: Internal iOS, Expo 57. Bestehender Feature-Branch codex/tarif-sollzeit-profile. Keine neue Veröffentlichung und kein Git-Delivery freigegeben.

Dateiscope: Sollzeit-Übersicht, Profil-/Verlaufsansicht, Entfernung des Modellfrage-Components, kurzer Beschäftigungseditor und zugehörige drei Komponententestdateien; Wiederverwendung der vorhandenen Modellableitung über einen Export im Vertragsadapter; diese Dokumentation (höchstens zehn Dateien).

Abnahme: Im gesamten erreichbaren Sollzeitfluss keine 5-/7-Tage-Auswahl, Monatsbasis- oder BT-K-Bestätigungsfrage und kein mehrstufiger Assistent. Ein Standardprofil berechnet weiterhin 146:18 beziehungsweise 154:00 ohne neue Eingabe. Öffnen und Abbrechen schreiben keine Daten; Bearbeitung bewahrt historische Perioden, Modelle, Tariffassungen, Tagesdaten und Beschäftigungsgrenzen. Typecheck, ESLint, relevante Komponenten-/Fachtests, verify:fast und lokaler iOS-Export. Sichtprüfung nach separat freizugebendem Preview-Update bleibt erforderlich.

### D5 – Prüfungsergebnis und Geräteabnahme

Die separate Modellseite ist einschließlich Component und aller Produktionsreferenzen entfernt. Die aufgeklappte Beschäftigung zeigt die übernommene Verteilung als Text; ein einziger Link führt ins bestehende Arbeitsprofil. Der zweite Einstellungsweg für Wochenstunden, Tarif und 5-/7-Tage-Verteilung entfällt. Ein optionaler Beschäftigungsverlauf bleibt für tatsächliche frühere Änderungen erhalten.

Der alte Assistent mit „Noch offene Angaben“, Monatsbasis-, Verteilungs-, Tarifwahl- und BT-K-Bestätigungen ist durch ein kurzes Formular ersetzt. Neue Perioden verwenden dieselbe Modellableitung wie die zentrale Prognose; der Adapter exportiert dazu lediglich seine bestehende Funktion. Seine Berechnungslogik bleibt unverändert. Bestehende Modelle, Tariffassungen, ausdrückliche Verneinungen, Tagesdaten und Beschäftigungsgrenzen werden bewahrt. Eine gespeicherte unbekannte Verteilung wird beim unveränderten Bearbeiten nicht zurückgeschrieben. Bei geänderten Wochenstunden passt sich eine bestehende Standard-Montag-bis-Freitag-Verteilung automatisch an. Nur eine bereits gespeicherte individuelle Verteilung außerhalb dieses Standards benötigt bei einer geänderten Stundensumme passende Tagesstunden.

Die fokussierte Prüfung besteht mit **66 fachlichen Tests** und **34 Komponententests**. Das vollständige `npm.cmd run verify:fast` besteht mit Typecheck, ESLint ohne Warnungen, Formatprüfung, **9.260 Unit-/Integrationstests in 480 Dateien**, **1.422 Komponententests in 154 Suiten** und allen weiteren Repository-Gates. Die temporäre serielle Vitest-Konfiguration wurde bytegenau wiederhergestellt. Keine Berechnungsformel wurde geändert; die Dezember-Referenzen bleiben 146:18 und 154:00 für die dokumentierten Modelle.

Der lokale iOS-Export mit Preview-Konfiguration und `APP_VARIANT=internal` ist bestanden. Bundle: `entry-506325b473b539b6193e0337b4f71689.hbc`. SHA-256: `bf7236e021a960f4457f666052774fde3fc3a3c6ea0c2eb8fac51e8049ae4b6b`. Alle **47** erfassten Code-/Test-/Konfigurationsdateien sind während Gate und Export unverändert geblieben; das entfernte Modell-Component bleibt entfernt.

D5 ist noch nicht veröffentlicht. Keine neue Git-Delivery, EAS-Build-, Update-, TestFlight- oder Production-Aktion wurde ausgeführt. Die Sichtprüfung auf dem iPhone erfolgt nach gesondert freizugebender Preview-Veröffentlichung. Zu prüfen sind beide Einstiege über Auswertung und Mehr: keine separate Arbeitstage-Auswahl, keine Verteilungs-/BT-K-Bestätigungen im Verlauf, unveränderte Sollzeit-Prognose.

Geänderte Dateien gegenüber D4 (acht Code-/Testdateien einschließlich einer entfernten Datei, dazu diese Dokumentation):

- `src/engine/working-time-calculation-profile.ts`
- `src/features/settings/working-time-profile-navigation.component.test.tsx`
- `src/features/settings/working-time-profile-screen.component.test.tsx`
- `src/features/settings/working-time-profile-screen.tsx`
- `src/features/settings/working-time-target-editor.component.test.tsx`
- `src/features/settings/working-time-target-editor.tsx`
- `src/features/settings/working-time-target-overview.tsx`
- Entfernt: `src/features/settings/working-time-target-quick-edit.tsx`

## D6 – Gültigkeit in vorhandenen Profilformularen (25.10.2026)

Nutzerfreigabe: Datierte Änderungen in bestehenden Einstellungen; zusätzliche Sollzeit-/Beschäftigungsverwaltung entfernen, Berechnungsaufschlüsselung erhalten.

Ziel: Wochenstunden, Arbeitsort, Tarif/Gruppe/Stufe und bestehende Prüfungsangaben über ihren Gültigkeitszeitpunkt speichern. Ersteinrichtung ohne Datum gilt als bisherige Grundlage; spätere Änderungen sind mit heutigem Datum vorbelegt. Frühere Korrekturen sind ausdrücklich wählbar. Sonntags-/Feiertagsangabe bleibt einzige Quelle für die Standardverteilung.

Nicht-Ziele: keine neuen Tarifansprüche, keine native Integration, keine Löschung alter individueller Zeitmodelle/Tagesnachweise, keine Änderung der Netto-Historie, keine Veröffentlichung/Git-Delivery. Plattform: Expo SDK 57, iOS Internal; bestehender isolierter Branch codex/tarif-sollzeit-profile.

Arbeitspakete und Scope:

1. Datierung: bestehende remuneration_profiles-Historie um validierte Beschäftigungsgrundlagen im versionierten JSON erweitern; atomarer Schreibweg, Konkurrenzschutz, Altformat/Backup-Kompatibilität und zukünftige Ereignisse. Domain, Datenbank/Profile-Ports und gezielte Integrationstests.
2. Bedienung: Gültig ab in vorhandenen Arbeitszeit-/Tarif-/Prüfungsformularen; zusätzliche Sollzeit-Editoren/Einstiege entfernen. Berechnungsseite bleibt aufklappbare Erklärung. Komponenten und Navigationstests.
3. Berechnung: gemeinsame zeitbezogene Profilauflösung für Sollzeit, Gehaltsprognose, Kalender, Auswertungen/Export und Prüfung. Historische Werte bleiben vor dem Änderungsdatum erhalten; keine kalendertagesbezogenen Bestätigungen. Fachliche Regressionen einschließlich Dezember 2026, Teilzeit, Stufenwechsel, Bundeslandwechsel, zukünftiger Änderung und Backup.

Abnahme: keine zusätzliche 5-/7-Tage- oder Beschäftigungsverwaltung; keine Schreibvorgänge beim Öffnen/Abbrechen. Neuer Wochenstunden-/Tarifwert ändert keine davor liegenden Monate. Zukünftige Änderungen wirken erst ab Datum, bestehende geplante Stufenwechsel bleiben erhalten. Dokumentierte TVöD-K-Referenz 146:18 bleibt. Typecheck, ESLint, fokussierte Tests, verify:fast und lokaler iOS-Export; echte iPhone-Sichtprüfung nach gesondert freizugebender Verteilung offen.

### D6 – Entscheidungen und fachliche Grenzen

Die vorhandene Tabelle `remuneration_profiles` speichert die Beschäftigungsgrundlagen gemeinsam mit der bisherigen Vergütungsstruktur in einem validierten JSON-Umschlag (`profileVersion: 1`). Die bisherigen Vergütungsdaten-Versionen 1–8 und alte flache Datensätze bleiben lesbar. Keine neue Tabelle, kein destruktiver Schemawechsel. Der vorhandene Backup-Validator prüft denselben Decoder; Wiederherstellung wird per Integrationstest geprüft. Ältere App-Versionen können den neuen Umschlag nicht bearbeiten und müssen ihn ablehnen.

Neue Änderungen verwenden einen expliziten Gültigkeitstag. Eine erstmalige Ergänzung unbekannter Angaben kann ohne Datum die bisherige Grundlage ergänzen. Die ausdrückliche Korrektur verwendet ausschließlich die Felder des geöffneten bestehenden Formulars. Zeiträume vor einer neuen Änderung werden nicht mit heutigen Werten neu interpretiert. Der Speicherweg prüft Profilstand und vollständige Historie innerhalb einer unmittelbaren Transaktion. Änderungen werden feldweise in bestehende zukünftige Ereignisse übernommen, bis ein solches Ereignis dieses Feld selbst ändert; ein geplanter Stufenwechsel überlebt dadurch eine vorgezogene Teilzeitänderung. Historie und aktuelle Profilansicht werden atomar geschrieben. Neue Datensätze werden beim Öffnen oder Abbrechen nicht angelegt.

Die zusätzliche Beschäftigungsseite und das separate Sollzeitformular sind entfernt. Auswertung → Arbeitszeit zeigt Prognose und aufklappbare Herleitung; „Sollzeitberechnung“ in den vorhandenen Profileinstiegen führt ebenfalls dorthin. „Gültig ab“ wird unmittelbar in Arbeitszeit/Ort, Tarif/Gehalt und dem bestehenden Prüfungsformular ergänzt. Identitätsangaben wie Name und Arbeitgeber behalten ihren bisherigen einfachen Speicherweg. Eine vorhandene zukünftige Änderung wird im Datumsbereich angezeigt.

Standardmodelle verwenden die vorhandene Sonn-/Feiertagsangabe. Die Berechnung bleibt eine Prognose; tatsächliche Diensttage, individuelle Anspruchsnachweise und Freizeitausgleich werden weiterhin getrennt behandelt. Gespeicherte individuelle Modelle, ausdrückliche Geltungsbereichsverneinungen und historische Lücken bleiben erhalten. Eine echte Änderung einer individuellen abweichenden Tagesverteilung ist mit dem vereinfachten Standardformular nicht abgedeckt und darf nicht still in eine Standardwoche umgewandelt werden.

Die monatliche Brutto-Prognose verwendet die jeweils datierten bestehenden Tarifrechner. Feste Monatsbestandteile werden bei einem Wechsel im Monat nach Kalendertagen aufgeteilt und je Bestandteil auf Cent gerundet; tatsächlich berechnete Zuschläge werden ihrem Zeitraum zugeordnet. Für TVöD stützt sich die Aufteilung auf [TVöD-AT § 24 Abs. 2–4, VKA-Fassung 2025](https://vka.de/wp-content/uploads/2026/04/250406_TVoeD_Verwaltung.pdf). Gleiche Monatsbeträge werden vor der Aufteilung zusammengefasst, damit eine reine Prüfungsangabe keine Rundungsdifferenz beim Gehalt verursacht. Die Tarifbeträge und Zuschlagsregeln selbst bleiben unverändert. Neue Sollzeit-Sonderansprüche für andere Tarifverträge werden durch D6 nicht aktiviert.

Die Netto-Prognose weist Beschäftigungsänderungen innerhalb eines Monats sichtbar als noch nicht verfügbar aus: Der automatische SFN-/Netto-Weg benötigt dort eine eigene Aufteilung der Stundenbasis. Bei einem Wechsel der Tarif-/Entgeltgruppenbasis im Kalenderjahr bleibt die Jahressonderzahlungs-Prognose manuell zu prüfen; es wird kein pauschaler Anspruch über einen Tarifwechsel hinweg angenommen. Bestehende Netto-Gültigkeiten werden nicht geändert. Reale Dienständerungen oder korrigierte Regeln können Prüfungen weiterhin neu bewerten; geschützt werden die zeitlich richtigen Eingangsangaben. Die rechtlichen Prüfungen behalten ihren vollständigen Betrachtungszeitraum einschließlich Ruhezeiten über Monats-/Profilgrenzen hinweg.

Granularität der bestehenden Profile ist ein Kalendertag. Monatsprognosen und Sollzeitwechsel werden tagesbezogen aufgelöst. Änderungen von Tarif/Arbeitsort während eines über Mitternacht laufenden Dienstes benötigen gesonderte Prüfung der bestehenden Zuschlagsrechner; aus der vereinfachten Datierung wird kein stundenweiser Vertragswechsel abgeleitet.

### D6 – Abschließende Prüfung und Geräteabnahme

`npm.cmd run verify:fast` ist vollständig bestanden: Typecheck, ESLint ohne Warnungen, Formatprüfung, **9.289 Unit-/Integrationstests in 481 Dateien**, **1.403 Komponententests in 153 Suiten** und alle weiteren Repository-Gates für Tarif-/Regelveröffentlichung, Sicherheits-, Runtime-, Abhängigkeits-, Kalender- und Widget-Verträge. Die vorübergehende serielle Vitest-Konfiguration wurde bytegenau wiederhergestellt. Die **83** erfassten Code-/Test-/Konfigurationsdateien sind während des abschließenden Laufs unverändert geblieben; die entfernten Editor-Dateien bleiben entfernt.

Zusätzliche Abnahmefälle: unveränderte Juni-Werte nach einer Teilzeitänderung ab Juli; zukünftig wirksame Gehaltsstufe erst ab Datum; Beibehaltung dieser Stufe bei einer vorgezogenen Stundenänderung; Erhalt ausdrücklich geplanter späterer Wochenstunden; Erhalt inzwischen wirksam gewordener Angaben bei einem länger geöffneten Formular; Konkurrenzschutz; Altformat-/Backup-Roundtrip; bestehende Gehaltskonflikte; datierte Prüfungsangaben und Ruhezeiten über die Profilgrenze. Für jede auswählbare Gehaltsfamilie wurde die Erhaltung früherer Monatsgrundlagen geprüft.

TVöD-K/Hessen/38,5 Stunden/wechselnde Tage: Dezember 2026 bleibt **146:18** (8.778 Minuten), feste Montag-bis-Freitag-Verteilung **154:00** (9.240 Minuten). Die tagesbezogene Teilzeitänderung von 38,5 auf 19,25 Stunden ab 16.12.2026 ergibt unabhängig geprüft **115:30** (6.930 Minuten) in Monatsauswertung, Jahresauswertung und Export. Die Prognose verlangt keine Dienstplanbestätigungen an einzelnen Feiertagen.

Im Gesamttest gefundene Probleme wurden vor der Abnahme korrigiert: Die Datenerfassung im Formular validiert keine reparierbaren Altangaben während des Renderns. Ungültige Datumsentwürfe wie 31.02.2026 bleiben in TV-L und TVA-L bearbeitbar und werden beim Speichern mit einer verständlichen Meldung abgewiesen. Die Vollzeit-Anzeige verwendet nur ein gültiges Referenzdatum; ein ungültiger Entwurf wird niemals gespeichert. Sieben ältere Erwartungen, die das nun ausdrücklich gewünschte Gültigkeitsfeld ausgeschlossen hatten, wurden durch positive Prüfungen des vorhandenen Formulars ersetzt. Die Architektur-Längenbudgets bleiben unverändert; SQL-Schreibdetails und die datierte Prüfungsorchestrierung sind in kleine gemeinsame Module ausgelagert.

Lokaler iOS-Export mit Preview-Konfiguration und `APP_VARIANT=internal`: **bestanden**. Bundle: `_expo/static/js/ios/entry-1c966f16289efda866b562dc4572d0a8.hbc`. SHA-256: `7092e55812d649305184af14434522924869784c746891f7b8ec0c374267160e`.

Nach ausdrücklicher Freigabe am 25.10.2026 wurde D6 ausschließlich als iOS-Preview-OTA für die Internal-App Build 43 veröffentlicht (02:02 Uhr Europe/Berlin). Update-Gruppe: [`335853f0-2ce7-41c4-9cde-1432f54de31b`](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/335853f0-2ce7-41c4-9cde-1432f54de31b). iOS-Update-ID: `01a1705d-4702-74b5-9fe5-847ed87fdb64`. Kanal, Branch und Environment: `preview`; Variante: `internal`; Bundle-ID: `com.pflegeshift.app.internal`; Runtime: `d0daa823a2a0b0965e5a1c7462b2885570aab578`. Der bereits getestete Export wurde mit `--skip-bundler` unverändert veröffentlicht. Aktuelle Kanalanbindung, neueste Preview-Gruppe, ausgeliefertes Manifest und heruntergeladenes CDN-Bundle stimmen mit dem lokalen Export überein (SHA-256 wie oben); alle 83 erfassten Quelldateien sind unverändert. Kein Commit, Push, Merge, nativer Build, TestFlight- oder Production-Schritt. Die echte iPhone-Sichtprüfung bleibt offen.

Auf dem iPhone nach vollständigem Schließen, Öffnen und etwa 15 Sekunden Wartezeit sowie erneutem vollständigem Schließen und Öffnen zu prüfen:

1. Auswertung → Arbeitszeit → Dezember 2026: Ergebnis und aufklappbare Herleitung; keine separate Beschäftigungsverwaltung, Modell- oder Tagesabfragen. Im passenden Referenzprofil 146:18 und vier Referenzabzüge.
2. Vorhandene Einstellungen → Arbeitszeit/Ort oder Tarif/Gehalt: Gültig ab direkt im bisherigen Formular. Öffnen/Abbrechen erzeugt keinen neuen Zeitraum. Eine neue Änderung ist mit dem heutigen Datum vorbelegt; eine Ersteinrichtung kann den bisherigen Zeitraum ohne Datum verwenden.
3. Eine Wochenstunden- oder Stufenänderung ab einem späteren Datum: frühere Monate behalten die alten Angaben; geplante Änderungen bleiben erhalten. Die Netto-Prognose weist einen untermonatigen Wechsel weiterhin als offene Einschränkung aus.
4. TV-L/TVA-L: Datum 31.02.2026 eingeben und speichern. Die Ansicht bleibt offen, zeigt die Datumsfehlermeldung und speichert nichts.

### D6 – Geänderter Dateiscope gegenüber D5

51 Code-/Testdateien, zwei entfernte UI-Dateien und diese Dokumentation:

- `src/application/working-time-provider.tsx`
- `src/composition/create-profile-ports.ts`
- `src/composition/create-simple-profile-ports.ts`
- `src/domain/employment-history.ts`
- `src/domain/remuneration-profile.ts`
- `src/domain/types.ts`
- `src/engine/compliance-sunday-holiday-rest.ts`
- `src/engine/compliance.ts`
- `src/engine/daily-summary.ts`
- `src/engine/dated-compliance.ts`
- `src/engine/holidays.ts`
- `src/engine/net-pay-automatic-forecast.ts`
- `src/engine/remuneration-premiums.ts`
- `src/engine/simple-pay.ts`
- `src/engine/working-time-calculation-profile.test.ts`
- `src/engine/working-time-calculation-profile.ts`
- `src/features/analysis/annual-core-report.ts`
- `src/features/analysis/annual-report.ts`
- `src/features/analysis/monthly-analysis.ts`
- `src/features/analysis/use-monthly-compliance.ts`
- `src/features/calendar/calendar-holidays.tsx`
- `src/features/day-details/day-details-screen.tsx`
- `src/features/day-editor/saved-shift-compliance.ts`
- `src/features/report-export/report-data.ts`
- `src/features/salary/annual-salary-proposal.ts`
- `src/features/salary/salary-month-input.ts`
- `src/features/settings/check-profile-screen.component.test.tsx`
- `src/features/settings/check-profile-screen.tsx`
- `src/features/settings/profile-validity.tsx`
- `src/features/settings/settings-editor-screen.tsx`
- `src/features/settings/settings-nursing-training.component.test.tsx`
- `src/features/settings/settings-screen.component.test.tsx`
- `src/features/settings/settings-screen.tsx`
- `src/features/settings/settings-tval-pflege.component.test.tsx`
- `src/features/settings/settings-tvh-kr.component.test.tsx`
- `src/features/settings/settings-tvl-kr.component.test.tsx`
- `src/features/settings/settings-tvuk-nursing.component.test.tsx`
- `src/features/settings/settings-vka-e.component.test.tsx`
- `src/features/settings/work-profile-flow.component.test.tsx`
- `src/features/settings/work-profile-screen.component.test.tsx`
- `src/features/settings/work-profile-screen.tsx`
- `src/features/settings/working-time-profile-navigation.component.test.tsx`
- `src/features/settings/working-time-profile-screen.component.test.tsx`
- `src/features/settings/working-time-profile-screen.tsx`
- `src/features/settings/working-time-target-overview.tsx`
- `src/infrastructure/database/employment-profile-repository.test.ts`
- `src/infrastructure/database/employment-profile-repository.ts`
- `src/infrastructure/database/profile-repository.ts`
- `src/infrastructure/database/profile-write.ts`
- `src/infrastructure/database/remuneration-profile-repository.ts`
- `src/infrastructure/database/simple-app-profile.ts`
- Entfernt: `src/features/settings/working-time-target-editor.component.test.tsx`
- Entfernt: `src/features/settings/working-time-target-editor.tsx`

## D7 – Einfache Gültigkeit und datiertes Schichtmodell (26.10.2026)

Geräterückmeldung: Die Sollzeitberechnung funktioniert. Die bisherige Datumseingabe ist verwirrend, der redundante Menüpunkt in Mehr ist noch vorhanden und die Schichtmodellfragen haben keinen Zeitbezug.

Ziel: dieselbe klare Auswahl „Gesamter Zeitraum“ / „Ab Datum“ in den bestehenden Arbeitszeit-, Tarif-, Prüfungs- und Schichtmodellformularen; Datum über die vorhandene native Datumsauswahl. Separate Sollzeit-Menüpunkte aus Mehr und Arbeitsprofil entfernen. Die Herleitung bleibt in Auswertung → Arbeitszeit. Zielplattform: iOS, Internal Build 43; Geräteabnahme nach eigener Preview-Freigabe.

Nicht-Ziele: neue Sollzeit- oder Tarifansprüche, neue Profilverwaltung, native Änderungen, Veröffentlichung oder Git-Delivery. Die bestätigte Dezember-Prognose bleibt erhalten.

Arbeitspakete: A – Gültigkeitsbedienung und Menüs einschließlich aller bestehenden Formularwege und Komponententests. B – Schichtmodell in denselben Beschäftigungs-/Vergütungsverlauf integrieren; alte Präferenzen und Backups weiter lesen, frühere Monate sowie spätere Änderungen schützen, Schätzungen/Exporte zeitlich auflösen. C – Regressionen, verify:fast, iOS-Export und dokumentierte Geräteprüfung. Keine neue Tabelle oder zweite Sollzeit-Engine.

Abnahme: Auswahl und Datum passen eindeutig zur gespeicherten Wirkung; Öffnen/Abbrechen schreibt nichts; Änderungen ab Datum lassen frühere Berechnungsgrundlagen unverändert; Schichtmodelländerungen werden datiert und im richtigen Zeitraum berücksichtigt; Sollzeitberechnung ist nur noch aus der Auswertung erreichbar.

### D7 – Implementierung und Grenzen

Die gemeinsame Karte „Änderung gilt für“ bietet zwei sichtbare Optionen. „Gesamter Zeitraum“ berichtigt die bisherige Grundlage und erhält gezielt gespeicherte spätere Änderungen. „Ab Datum“ zeigt eine native Kalenderauswahl; frühere Berechnungsgrundlagen bleiben erhalten. Ohne bereits datierte Beschäftigungsänderung ist der gesamte Zeitraum vorbelegt; bei vorhandenem datierten Verlauf ist eine neue Änderung ab heute vorbelegt. Der gewählte Kalenderwert wird als Tagesdatum gespeichert, nicht als UTC-Zeitstempel. Auf Web bleibt eine validierte Datumseingabe verfügbar. Die bisherige Umschaltzeile und das leere Datumsfeld im Gesamtzeitraum entfallen. Die bestehenden Formulare behalten ihren bisherigen Speichern-/Abbrechen-Ablauf.

„Sollzeitberechnung“ wurde aus Mehr und dem Arbeitsprofil entfernt. Die zentrale Berechnung und ihre aufklappbare Erklärung bleiben unter Auswertung → Arbeitszeit. Es gibt keine neue Sollzeitverwaltung.

Das Schichtmodell wird mit denselben Gültigkeitsregeln in `remuneration_profiles` geführt. Der JSON-Umschlag `profileVersion: 2` ergänzt die bisherigen 16 Beschäftigungsfelder um `workPattern` (Arbeitsbereich rund um die Uhr und dauerhafte/gelegentliche Zuordnung). Version 1 und alte flache Vergütungsdaten bleiben lesbar; neue Version-2-Daten werden einschließlich Schichtmodell strikt validiert. Beim ersten datierten Schreiben werden vorhandene alte Schichtmodell-Präferenzen als bisherige Grundlage aufgenommen. Die alten Präferenzen bleiben für historische Altformate erhalten; sie werden durch künftige Änderungen nicht überschrieben. Keine neue Tabelle, keine SQL-Migration, keine neue Abhängigkeit. Ältere App-Versionen ohne Version-2-Decoder können diese neuen Profil-Umschläge nicht lesen; eine Wiederherstellung solcher Backups benötigt eine passende oder neuere App-Version.

Änderungen werden weiterhin atomar mit Profil-/Verlaufskonkurrenzschutz und auf die bearbeiteten Felder begrenzt gespeichert. Vorhandene spätere Stunden-/Stufenwechsel bleiben erhalten; geänderte Schichtantworten werden bis zu einer ausdrücklich abweichenden späteren Antwort weitergeführt. Monats-Brutto und die datierte Schichtzulagenbewertung verwenden die jeweils gültigen Antworten. Die vollständigen Beobachtungszeiträume für Nachtschichten bleiben erhalten. Die Zusammenfassung in Mehr liest die aktuelle datierte Profilprojektion auch nach einem App-Neustart.

Die tariflichen Anspruchsregeln selbst werden nicht erweitert. Die Sollzeit-Prognose verwendet weiterhin die vorhandene Sonn-/Feiertagsarbeit-Angabe für die Arbeitszeitverteilung. Ein 24/7-Arbeitsbereich und ein dauerhafter Schichteinsatz ersetzen keine weiteren tariflichen Voraussetzungen für eine Zulage. Die bereits dokumentierten Einschränkungen der Netto-Prognose bei untermonatigen Beschäftigungswechseln bleiben bestehen.

Zusätzliche Regressionen: Kalenderauswahl statt freier Datumsentwürfe im bestehenden TV-L-/TVA-L-Formular; Umschalten vom gewählten Datum zurück zum Gesamtzeitraum; kein Schreiben beim Öffnen oder Wählen; Datierung im Schichtmodell mit begrenztem Feldscope; Altpräferenzen, zukünftiger Wechsel, späterer Stundenwechsel, spätere ausdrückliche Modelländerung, strikter Backup-/Restore-Roundtrip und vorheriger Version-1-Umschlag. Ein ausdrücklich ab 16.07. geltender Modellwechsel wird in der datierten Zulagenbewertung in 01.–15.07. und 16.–31.07. getrennt. Der vorherige Juni-Wert mit tatsächlichen Diensten bleibt gleich. Ein eigener Starttest verwendet einen noch undatierten Hauptprofildatensatz und alte unbekannte Präferenzen; die Anzeige muss trotzdem den im Verlauf gültigen Schichtstand verwenden.

### D7 – Dateiscope gegenüber dem veröffentlichten D6

Paket A: 15 UI-/Komponententestdateien. Paket B: neun Fach-/Persistenz-/Provider-/Testdateien. Dazu diese Dokumentation.

- `src/application/dated-work-pattern.ts`
- `src/application/pflegeshift-provider.tsx`
- `src/composition/pflegeshift-runtime-provider.component.test.tsx`
- `src/domain/employment-history.ts`
- `src/domain/types.ts`
- `src/engine/remuneration-assessment.ts`
- `src/engine/simple-pay.ts`
- `src/features/analysis/analysis-rule-coverage.component.test.tsx`
- `src/features/analysis/tariff-assessment-screen.tsx`
- `src/features/settings/profile-date-field.tsx`
- `src/features/settings/profile-validity.tsx`
- `src/features/settings/settings-nursing-training.component.test.tsx`
- `src/features/settings/settings-screen.component.test.tsx`
- `src/features/settings/settings-screen.tsx`
- `src/features/settings/settings-tval-pflege.component.test.tsx`
- `src/features/settings/settings-tvh-kr.component.test.tsx`
- `src/features/settings/settings-tvl-kr.component.test.tsx`
- `src/features/settings/settings-tvuk-nursing.component.test.tsx`
- `src/features/settings/settings-vka-e.component.test.tsx`
- `src/features/settings/work-profile-flow.component.test.tsx`
- `src/features/settings/work-profile-screen.component.test.tsx`
- `src/features/settings/work-profile-screen.tsx`
- `src/infrastructure/database/employment-profile-repository.test.ts`
- `src/infrastructure/database/employment-profile-repository.ts`

### D7 – Abschließende Prüfung und Geräteabnahme

`npm.cmd run verify:fast`: vollständig bestanden. Typecheck, ESLint ohne Warnungen und Formatprüfung sind bestanden. **9.295 Unit-/Integrationstests in 481 Dateien** sowie **1.405 Komponententests in 153 Suiten** sind bestanden. Die weiteren Regel-, Sicherheits-, Runtime-, Abhängigkeits-, Kalender-, Widget- und Decoder-Gates sind bestanden. Der Provider bleibt innerhalb des unveränderten Architektur-Längenbudgets; die datierte Anzeigeprojektion ist in einen kleinen gemeinsamen Hook ausgelagert. Die serielle Vitest-Testkonfiguration wurde bytegenau zurückgesetzt. Alle **87** erfassten Code-/Test-/Konfigurationsdateien sind unverändert geblieben.

Lokaler iOS-Export mit `APP_VARIANT=internal` und Preview-Konfiguration: **bestanden**. Runtime `d0daa823a2a0b0965e5a1c7462b2885570aab578` passt zur bestehenden Internal-App Build 43. Bundle: `_expo/static/js/ios/entry-b8526b4e28176f145bf89f9e80b8e505.hbc`. SHA-256: `d3d26810bbb9b73ecc6537568a1374dec71dffb6dea1059e4b3c3cd21544629c`. Der lokale Export wurde nach ausdrücklicher Freigabe unverändert als iOS-Preview-Update veröffentlicht; Nachweis siehe unten. Ein nativer Build wurde nicht gestartet. Die vorhandene Datumsauswahl wird entsprechend der [Expo-SDK-57-Dokumentation](https://docs.expo.dev/versions/v57.0.0/sdk/date-time-picker/) genutzt.

D6-Geräterückmeldung vom 26.10.2026: Der Nutzer bestätigt die funktionierende Sollzeitberechnung; die verbliebenen Einstellungswege sind nicht abgenommen. D7 ist lokal geprüft und im Preview-Kanal veröffentlicht. Die Sicht-/Funktionsprüfung auf dem iPhone steht noch aus:

1. Mehr → Arbeit: kein Sollzeit-Menüpunkt. Auch im Arbeitsprofil kein zweiter Sollzeit-Einstieg; Auswertung → Arbeitszeit zeigt weiterhin Ergebnis und Herleitung.
2. Arbeitszeit & Ort, Tarif & Gehalt und Angaben zur Prüfung: sichtbare Wahl Gesamtzeitraum/Ab Datum, Kalenderauswahl nur bei Datum; Speichern wirkt im gewählten Zeitraum, Abbrechen schreibt nichts.
3. Schichtmodell: dieselbe Gültigkeitswahl; eine Änderung ab einem späteren Datum lässt frühere Monate unverändert. Nach App-Neustart stimmt die Zusammenfassung in Mehr mit dem aktuell gültigen Schichtmodell überein.
4. Im passenden Referenzprofil bleibt Dezember 2026 bei 146:18. Die bestehenden untermonatigen Netto-Grenzen sind weiterhin sichtbar.

### D7 – Verifizierte Preview-Veröffentlichung (26.10.2026)

Nach ausdrücklicher Freigabe wurde der geprüfte Export mit `--skip-bundler` ausschließlich für iOS/Preview/Internal veröffentlicht. Zeitpunkt: `2026-10-26T07:05:34.159Z`. Update-Gruppe: [`2468932c-854d-4735-ba37-6057d2d548a6`](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/2468932c-854d-4735-ba37-6057d2d548a6). iOS-Update-ID: `01a17707-5ecf-7dcf-b1b9-c310f6fbf44b`. Kanal, Branch und Environment: `preview`; Variante: `internal`; Bundle-ID: `com.pflegeshift.app.internal`; Ziel: bestehender Internal Build 43 mit Runtime `d0daa823a2a0b0965e5a1c7462b2885570aab578`.

Die neueste Preview-Gruppe und ihre Kanalanbindung stimmen mit der Veröffentlichung überein. Das tatsächlich ausgelieferte Expo-Updates-Manifest verweist auf diese Update-ID; Manifest-Prüfsumme und mit den gelieferten Asset-Headern heruntergeladenes CDN-Bundle stimmen mit dem lokalen Bundle überein (SHA-256 `d3d26810bbb9b73ecc6537568a1374dec71dffb6dea1059e4b3c3cd21544629c`). Alle 87 eingefrorenen Code-/Test-/Konfigurationsdateien sind unverändert. Die vorherige Preview-Gruppe war D6 `335853f0-2ce7-41c4-9cde-1432f54de31b`; es wurde kein zwischenzeitlich fremder Preview-Stand überschrieben.

Geräteabnahme: offen. Die Internal-App vollständig schließen, öffnen und etwa 15 Sekunden warten; anschließend erneut vollständig schließen und öffnen. Danach die oben aufgeführten D7-Abnahmefälle auf dem iPhone prüfen. Keine Git-Delivery, kein EAS Build und keine TestFlight-/Production-Veröffentlichung.

## D8 – Gesamtzeitraum und gemeinsamer Zeitraum im Prüfungsfluss (26.10.2026)

Geräterückmeldung: „Gesamter Zeitraum“ wirkt nicht wie erwartet; „Fertig“ macht den Speichervorgang nicht klar und die Fragen zur Prüfung verlangen erneut eine Gültigkeitsauswahl.

Ziel: tatsächliche Berichtigung der ausgewählten Felder für bisherige und aktuelle Beschäftigungsstände, Erhalt ausdrücklich geplanter späterer Änderungen, eindeutiger Speicherbutton sowie Übernahme des bereits ausgewählten Zeitraums in die Prüfungsfragen. iOS/Internal ist das Zielgerät.

Paket A – Speichern und Navigation: Button „Speichern“; ausgewählten Zeitraum beim Übergang weitergeben; die Prüfungsfragen zeigen keine zweite Datumsmaske. Direkt geöffnete Prüfungsfragen übernehmen den vorhandenen aktuell gültigen Beschäftigungszeitraum; ohne datierten Verlauf ergänzen sie die allgemeine Profilgrundlage. Ungültige Datumslinks werden abgewiesen. Paket B – fachliche Korrektur: alte Sollzeitprofile dürfen ausdrückliche Gesamtzeitraum-Korrekturen nicht überstimmen; vorhandene Profile/Backups bleiben lesbar und benutzerdefinierte Wochentagsverteilungen werden nicht erfunden. Paket C – Integrationstests, verify:fast, iOS-Export und spätere Geräteabnahme.

Nicht-Ziele: neue Tarifansprüche, neue Einstellungen, native Änderungen, automatische Veröffentlichung, Git-Delivery. Bestehender Feature-Branch wird fortgesetzt; unabhängige Arbeitsverzeichnisse bleiben unberührt.

Abnahme: 30 Stunden/Woche mit Gesamtzeitraum wirken nach Speichern und Neustart auch bei vorhandenen alten 38,5-Stunden-Sollzeitprofilen; der TVöD-K-Dezemberfall ergibt dann 114:00 statt 146:18. Ein explizit später geplanter 35-Stunden-Stand bleibt erhalten. Die Prüfungsantworten übernehmen „all“ oder das ausgewählte Datum aus Arbeitszeit & Ort, ohne weitere Zeitraumabfrage.

### D8 – Ursache und Umsetzung

Der Fehler wurde zuerst mit zwei fehlgeschlagenen Regressionen nachgestellt: (1) Eine auf 30 Wochenstunden berichtigte Baseline blieb gegenüber alten 38,5-Stunden-Sollzeitperioden wirkungslos; (2) die bisherige Weitergabe brach an einem abweichenden vergangenen Beschäftigungsstand ab. Die Tests lagen vor der Fachkorrektur rot vor.

Eine ausdrücklich gewählte Gesamtzeitraum-Korrektur berichtigt die ausgewählten Felder jetzt auch in den bis heute gültigen Beschäftigungsständen. Abweichende tatsächlich geplante spätere Änderungen bleiben erhalten. Die Feldauswahl wird im bestehenden Vergütungs-/Beschäftigungsverlauf als `employmentOverrides` (Feldname → Tag der ausdrücklichen Korrektur) im JSON-Umschlag `profileVersion: 3` gespeichert. Dadurch können alte redundante Sollzeit-Stundenwerte diese ausdrücklich korrigierte Quelle nicht wieder verdecken. Auch eine bereits gespeicherte, aber verdeckte 30-Stunden-Basis lässt sich durch Speichern korrigieren, ohne den Wert erneut ändern zu müssen.

Die Versionen 1 und 2 sowie alte flache Vergütungsdaten bleiben lesbar; Version 3 validiert die zulässigen Feldnamen und die zugehörigen ISO-Korrekturtage strikt. Die Kennzeichnung bleibt bei späteren Vergütungseinträgen und im validierten Backup-/Restore-Roundtrip erhalten. Keine neue Tabelle oder SQL-Migration; eine ältere App ohne Version-3-Decoder kann diese neuen Umschläge nicht lesen. Die Kennzeichnung wird nur bei ausdrücklich gespeicherter Gesamtzeitraum-Korrektur geschrieben.

Die Sollzeit-Projektion respektiert diese Herkunft für Wochenstunden und ausdrücklich korrigierte Angaben zur Sonn-/Feiertagsarbeit. Ein früher bestätigtes Standardmodell Mo–Fr bleibt bei einer bloßen Stundenkorrektur erhalten; eine ausdrücklich korrigierte Sonntagsangabe kann für die Prognose auf wechselnde Tage umstellen. Individuelle Wochentagsverteilungen werden nicht pauschal neu verteilt. Ein reiner Gehaltsbetrag ersetzt keinen bestätigten Arbeitszeittarif; dieser Schutz wurde zusätzlich als Regression abgesichert. Tarifliche Anspruchsregeln und geleistete Stunden werden nicht verändert.

Der bisherige Button „Fertig“ heißt im bestehenden Editor „Speichern“. Der Übergang zu den Prüfungsfragen übergibt den bereits gewählten Zeitraum als validierten Routenparameter (`all` oder ISO-Tagesdatum). Die Fragen zeigen keine zusätzliche Zeitraumauswahl mehr. Direkt geöffnete Prüfungsfragen verwenden den aktuell gültigen vorhandenen Beschäftigungszeitraum; ohne datierten Verlauf wird die allgemeine Profilgrundlage ergänzt. Ein ungültiger Zeitraum-Link öffnet keinen speicherbaren Editor.

Referenzen: 30 Stunden, Hessen, passendes TVöD-K-Modell, Dezember 2026: 23 Referenztage × 360 Minuten minus vier Referenztage = **6.840 Minuten / 114:00**. Bei weiterhin 38,5 Stunden bleibt die bekannte Referenz **8.778 Minuten / 146:18**. Ein festes Mo–Fr-Modell mit 30 Stunden ergibt im entsprechenden Sondertagsfall **7.200 Minuten / 120:00**; eine ausdrücklich korrigierte Sonntagsangabe stellt den passenden Prognosefall auf 114:00 um. Kalender-/Monatskern, Jahresauswertung und Export werden gegen dieselbe 30-Stunden-Referenz geprüft.

### D8 – Dateiscope gegenüber D7

- `src/domain/employment-history.ts`
- `src/domain/remuneration-profile.ts`
- `src/domain/types.ts`
- `src/engine/working-time-calculation-profile.test.ts`
- `src/engine/working-time-calculation-profile.ts`
- `src/features/settings/check-profile-screen.component.test.tsx`
- `src/features/settings/check-profile-screen.tsx`
- `src/features/settings/profile-validity.tsx`
- `src/features/settings/settings-editor-screen.tsx`
- `src/features/settings/work-profile-flow.component.test.tsx`
- `src/infrastructure/database/employment-profile-repository.test.ts`
- `src/infrastructure/database/employment-profile-repository.ts`
- `src/infrastructure/database/remuneration-profile-repository.ts`

### D8 – Ergänzende Abnahmefälle

Abweichende spätere Stunden-/Modellwechsel aus alten Sollzeitprofilen werden mit dem zum Korrekturtag gültigen alten Grundstand verglichen und bleiben erhalten. Der erste alte Eintrag ist die damalige Einrichtung; weitere tatsächlich abweichende spätere Werte bleiben geschützt. Der Korrekturtag wird pro Feld gespeichert, damit eine spätere reine Gehaltsänderung diesen Schutz nicht verschiebt und der Jahreswechsel keine vergangenen Ergebnisse verändert. Ein alter geplanter 35-Stunden-Stand für Dezember ergibt weiterhin 133:00, auch bei späterer Betrachtung im Folgejahr. Ein alter geplanter Wechsel auf feste Mo–Fr-Tage bleibt erhalten, während eine korrigierte unveränderte Wochenbasis weitergetragen wird.

Eine ausdrücklich gewählte neue Datumsangabe kann mit „Speichern“ auch bei unveränderten sichtbaren Werten einen datierten Stand festhalten. So lässt sich eine alte spätere Sollzeitvorgabe über das vorhandene Formular ersetzen. Eine bloß voreingestellte Datumsangabe oder das Öffnen/Abbrechen erzeugt keinen Zeitraum. Die bisherigen Änderungen an tatsächlich bearbeiteten Feldern und der Schutz nicht bearbeiteter späterer Werte bleiben erhalten. Die Prüfungsfragen verwenden den gewählten gemeinsamen Zeitraum weiter.

Gezielte Abnahme des endgültigen Verhaltens: 122 Unit-/Integrationstests in vier betroffenen Kern-/Persistenz-/Backup-Suiten sowie 50 Komponententests in den beiden Einstellungsfluss-Suiten bestanden. Der ergänzte Fall „Datum speichern, ohne Stunden erneut zu ändern“ und der Schutz alter künftiger Vorgaben sind enthalten.

### D8 – Abschließende Prüfung und Geräteabnahme

`npm.cmd run verify:fast`: vollständig bestanden. Typecheck, ESLint ohne Warnungen und Formatprüfung sind bestanden. **9.308 Unit-/Integrationstests in 481 Dateien** sowie **1.413 Komponententests in 153 Suiten** sind bestanden. Die weiteren Regel-, Sicherheits-, Runtime-, Abhängigkeits-, Kalender-, Widget- und Decoder-Gates sind bestanden. Die serielle Vitest-Testkonfiguration wurde bytegenau zurückgesetzt. Alle **87** erfassten Code-/Test-/Konfigurationsdateien stimmen nach Prüfung und Export weiterhin mit dem eingefrorenen Stand überein; D8 umfasst die oben genannten 13 Code-/Testdateien und diese Dokumentation.

Der abschließende lokale iOS-Export mit `APP_VARIANT=internal` und Preview-Konfiguration ist bestanden. Runtime `d0daa823a2a0b0965e5a1c7462b2885570aab578` passt zur bestehenden Internal-App Build 43. Bundle: `_expo/static/js/ios/entry-a78074d137e660cd0d03e441dbe64b52.hbc`. SHA-256: `471149f96e1e7145a28fce345b96830d3d0f85e406bdde37ac794eb21d54629d`. Der frühere lokale D8-Zwischenexport ist überholt und darf nicht veröffentlicht werden. SDK-Basis ist weiterhin Expo `~57.0.22` und die [versionierte SDK-57-Dokumentation](https://docs.expo.dev/versions/v57.0.0/).

Die Nachweise liegen lokal unter `%TEMP%` als `luna-d8-verify-fast-final-gate.log`, `luna-d8-export-ios-final.log`, `luna-d8-final-source.json`, `luna-d8-ios-export-receipt.json` und `luna-d8-acceptance.json`. Eine Veröffentlichung von D8 ist nicht erfolgt; sie benötigt eine eigene ausdrückliche Preview-Freigabe. Kein nativer Build und keine Git-Delivery. Export und Tests ersetzen keine Abnahme auf dem iPhone.

Geräteprüfung nach einer gesondert freigegebenen Preview-Veröffentlichung:

1. Arbeitszeit & Ort: vorhandene 30 Stunden stehen lassen, „Gesamter Zeitraum“ wählen und „Speichern“ drücken. Bereits gespeicherte, bisher durch alte Sollzeitprofile verdeckte Werte müssen ohne erneutes Ändern der Stunden wirken und nach App-Neustart bestehen bleiben. Im passenden TVöD-K-Fall zeigt Dezember 2026 dann 114:00; mit 38,5 Stunden bleibt die Referenz 146:18.
2. Eine bereits geplante spätere Stundenänderung bleibt erhalten. Eine ausdrücklich gewählte neue Datumsangabe lässt sich auch bei unveränderten sichtbaren Stunden speichern; frühere Beschäftigungsstände bleiben dabei unverändert.
3. „Speichern & Angaben öffnen“ übernimmt den gewählten Gesamtzeitraum oder das ausgewählte Datum. Die Prüfungsfragen enthalten keine zweite Gültigkeitskarte. Direkt geöffnete Prüfungsfragen ergänzen den bestehenden aktuell gültigen Zeitraum.
4. Zurück/Abbrechen und unverändertes Öffnen schreiben keine neuen Beschäftigungsstände. Die Sollzeit-Herleitung bleibt in Auswertung → Arbeitszeit; es erscheint kein neuer Sollzeit-Menüpunkt in Mehr.

### D8 – Verifizierte Preview-Veröffentlichung (26.10.2026)

Nach eigener ausdrücklicher Nutzerfreigabe wurde der abschließend geprüfte Export unverändert mit `--skip-bundler` ausschließlich für iOS/Preview/Internal veröffentlicht. Zeitpunkt: `2026-10-26T09:02:14.497Z`. Update-Gruppe: [`e60f147d-8e9c-44aa-9bea-6e8a27a1b2ed`](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/e60f147d-8e9c-44aa-9bea-6e8a27a1b2ed). iOS-Update-ID: `01a17772-2fe1-76a2-bb53-7248b77f7ca4`. Kanal, Branch und Environment: `preview`; Variante: `internal`; Bundle-ID: `com.pflegeshift.app.internal`. Ziel ist der bestehende Internal Build 43 mit Runtime `d0daa823a2a0b0965e5a1c7462b2885570aab578`; Build und Runtime wurden vor Veröffentlichung frisch abgeglichen.

Die neueste Preview-Gruppe und die unveränderte eindeutige Kanalanbindung wurden nach Veröffentlichung geprüft. Das tatsächlich ausgelieferte Expo-Updates-Manifest verweist auf diese Update-ID. Manifest-Prüfsumme und das mit den gelieferten Asset-Headern heruntergeladene CDN-Bundle stimmen mit dem abschließenden lokalen Export überein (SHA-256 `471149f96e1e7145a28fce345b96830d3d0f85e406bdde37ac794eb21d54629d`). Alle 87 eingefrorenen Code-/Test-/Konfigurationsdateien sind unverändert. Vorheriger Preview-Stand war D7 `2468932c-854d-4735-ba37-6057d2d548a6`; kein fremder Zwischenstand wurde ersetzt.

Lokale Nachweise: `luna-d8-preview-preflight-receipt.json`, `luna-d8-preview-update.json`, `luna-d8-preview-verification.json`, die Listen-/Kanaldateien vor und nach Veröffentlichung sowie die ergänzte `luna-d8-acceptance.json` unter `%TEMP%`. Geräteabnahme bleibt offen. Die Internal-App vollständig schließen, öffnen und etwa 15 Sekunden warten, anschließend wieder vollständig schließen und öffnen. Danach insbesondere vorhandene Stunden stehen lassen und „Gesamter Zeitraum“ → „Speichern“ prüfen; die Prüfungsfragen dürfen keine zweite Gültigkeitsmaske zeigen. Keine Git-Delivery, kein nativer Build und keine TestFlight-/Production-Veröffentlichung.

## D9 – Gemeinsamer Speicherablauf und Netto-Regression (26.10.2026)

Nutzerfreigabe: „Oke setzte um“ für den recherchierten gemeinsamen Beschäftigungsablauf und die gesonderte Korrektur der Netto-Sperre. Die Recherche und der Klickentwurf liegen im aufgabeneigenen Visualisierungsordner als `employment-workflow-research.md` und `employment-save-flow.html`. Die Umsetzung setzt keine neue Veröffentlichungsfreigabe voraus; Git-Delivery, OTA und native Builds bleiben separat.

### D9 – Task-Vertrag und Pakete

Zielplattform: bestehende iOS-Internal-App Build 43. Expo-Version vor Änderungen geprüft: `~57.0.22`, Referenz die versionierte SDK-57-Dokumentation. Der bestehende aufgabeneigene Branch `codex/tarif-sollzeit-profile` wird fortgesetzt. Remote-Standardbranch frisch geprüft: `master`, Revision `ab25991685f29f4787b515b21bf9e96e17e335ef`. Keine unabhängigen Änderungen im Hauptcheckout bearbeitet. Ein Snapshot aller 91 bereits veränderten/unversionierten Pfade wurde vor D9 in `%TEMP%/luna-d9-before` und `luna-d9-before.json` angelegt.

Paket A: identische Berechnungsgrundlagen in der bestehenden Brutto-/Netto-Berechnung über Datumsgrenzen hinweg zusammenfassen; tatsächliche Änderungen weiterhin erkennen. Paket B: bestehender Editor, gemeinsamer Entwurf, Zeitraumwahl beim Speichern, gezielter historischer Korrekturweg und gegen Nebenläufigkeit geschütztes Rückgängig. Paket C: tarifübergreifende Regressionen, Komponententests, verify:fast, iOS-Export und dokumentierte spätere Geräteabnahme.

Nicht-Ziele: weitere Tarifansprüche, neue Steuer-/SV-Teilmonatsberechnung, neue native Integration, neue Datenbanktabellen, automatische Bereinigung echter historischer Wechsel, Git-Delivery oder Veröffentlichung.

### D9 – Gemeinsamer Editor

Mehr bietet einen gemeinsamen Einstieg „Arbeit & Gehalt“ für Arbeitszeit/Ort, Tarif/Stufe und Arbeitsmodell. Der vorhandene Tarifeditor und seine Prüfungen werden wiederverwendet; alle Eingaben bleiben ein Entwurf. Die vorhandenen Auswahlseiten schreiben nichts. Der separate Assistent „Angaben zur Prüfung“ und die vorab sichtbare Gültigkeitskarte entfallen. Bestehende Arbeitsprofil-Links öffnen denselben Editor. Alte Prüfungs-/Recovery-Links bleiben validiert und öffnen die passenden Modell- bzw. Arbeitsortfelder. Regionale Feiertagsangaben sind auch aus diesem Recovery-Pfad erreichbar. Die Schichtzulagen-Auswertung verweist zum Bearbeiten auf dieselben Felder und speichert keine Beschäftigungsantworten zwischendurch. Monatliche individuelle Zulagenentscheidungen bleiben ein eigenständiger Vorgang.

Erst „Änderungen speichern“ öffnet die vorhandene LUNA-Auswahlsheet-Komponente mit „Seit wann gelten diese Angaben?“. Die betroffenen Werte werden vorher/nachher gezeigt. „Ab einem Datum“ verlangt eine sichtbare Datumsauswahl; es wird kein stilles heutiges Datum übernommen. „Für den gesamten Zeitraum“ ist eine ausdrückliche Berichtigung der bearbeiteten Felder. Geplante spätere Änderungen bleiben geschützt und werden bei einer Berichtigung konkret genannt. Zurück aus dem Dialog erhält den Entwurf. Erst die abschließende Aktion schreibt Werte und Gültigkeit atomar; die Seite bleibt danach mit Rückmeldung erreichbar.

Ohne semantische Feldänderung wird nichts geschrieben. Unterschiedliche JSON-Schlüsselreihenfolge zählt nicht als Änderung. Ein unveränderter bereits geplanter Wert erzeugt keinen zusätzlichen Zeitraum und erhöht keine Revision. Die erste tatsächlich unkonfigurierte Einrichtung ohne Verlauf, Gehaltsgrundlage oder bereits beantwortete Modellfragen ergänzt die allgemeine Grundlage ohne zusätzliche Zeitraumfrage. Eine bestehende Gehaltsgrundlage wird dabei für alle acht auswählbaren Familien erkannt, nicht nur für TVöD-P. Identitätsangaben behalten ihren bestehenden eigenen Formularweg ohne Beschäftigungsdatierung.

Bei datumsabhängiger tariflicher Vollzeit erfolgt die abschließende Prüfung gegen das gewählte Datum. Ein heute unpassender, historisch aber gültiger Vollzeitwert verhindert deshalb nicht bereits vor der Datumsauswahl eine historische Berichtigung. Unberührte Gehaltsgrundlagen werden aus dem Profil übernommen; eine reine Modellkorrektur ergänzt keine Tarif-Standardwerte und löst keine neue Prüfung unberührter historischer Stundenwerte aus. Stunden- und Tarifänderungen behalten ihre abschließende Vollzeitprüfung.

Die vorhandene Sonn-/Feiertagsangabe behält ihre fachliche Bedeutung; rechtliche Zulässigkeit wird durch eine bloße Umbenennung nicht zur tatsächlichen regelmäßigen Verteilung erklärt. Die bestehenden Prognose-/Tarifregeln werden nicht erweitert. Vorhandene alte Schichtmodell-Präferenzen werden im aktuellen Profilkontext angezeigt, ohne sie allein beim Öffnen neu zu speichern.

### D9 – Verlauf und Rückgängig

Ein optional aufklappbarer Änderungsverlauf zeigt vorhandene datierte Beschäftigungsstände. „Angaben ab … berichtigen“ lädt den gewählten Stand in denselben Editor. Sein Datum ist sichtbar und bei der abschließenden Zeitraumwahl vorbelegt. Die Nebenläufigkeitsprüfung bezieht sich weiterhin auf das aktuelle vollständige Profil und den gesamten Verlauf. Das erlaubt insbesondere eine gezielte Berichtigung eines früher versehentlich abweichenden Abschnitts, wenn die heutigen Werte bereits wieder stimmen. Echte A→B→A-Verläufe werden nicht automatisch gelöscht.

„Letzte Änderung rückgängig“ stellt die Inhalte des vorherigen Verlaufs innerhalb einer Transaktion wieder her. Es erzeugt keinen neuen entgegengesetzten Beschäftigungswechsel. Vollständiger Verlaufsschlüssel, Profilzeitstempel und gespeicherte Beschäftigungsgrundlagen werden vor der Wiederherstellung verglichen. Spätere Änderungen verhindern ein veraltetes Rückgängig. Erhaltene Verlaufseinträge bekommen fortgeschriebene Revisionen. Unabhängige Namens-/Arbeitgeberangaben bleiben erhalten, auch bei gleichen Zeitstempeln. Das Angebot bezieht sich auf die letzte Änderung der geöffneten Editorsitzung; ältere Fehler lassen sich über den sichtbaren Verlauf berichtigen.

Kein SQL-Schemawechsel, keine neue Backup-Version. Der bestehende Profil-Umschlag Version 3 wird weiterverwendet; der interne Restore-Auftrag wird nicht im Backup gespeichert. Alte Profilformate bleiben lesbar. Backup-/Restore nach Rückgängig ist als Integrationstest enthalten.

### D9 – Netto-Ursache und Korrektur

Der bisherige Netto-Guard sperrte bereits bei mehr als einer Datumsgrenze im Monat. Solche Grenzen blieben auch nach einer Berichtigung mit wieder identischen Beschäftigungsdaten bestehen. Die Ursache wurde gegen den ursprünglichen D8-Guard erneut nachgestellt: zehn neue Gleichheitsregressionen scheitern dort; die beiden Schutzfälle für tatsächliche Änderungen bestehen. Das aktuelle D9-Modul wurde anschließend bytegenau wiederhergestellt.

`payrollEmploymentPeriods()` fasst benachbarte Abschnitte nur bei identischen Beschäftigungs- und vollständigen Vergütungsgrundlagen zusammen. Speicheridentität, Revisionsnummern, Zeitstempel und Herkunftskennzeichnungen lösen für sich keine finanzielle Änderung aus. Eigene Vergütungskonfigurationen und tarifliche Zusatzangaben sind Teil des Vergleichs. Die gespeicherte Historie wird nicht verändert; andere Prüfungen behalten ihre eigene zeitliche Auflösung. Brutto und Netto verwenden dieselbe Normalisierung, damit auch die Brutto-Basis nicht unnötig in Teilabschnitte zerlegt wird.

Regressionen vergleichen alle acht auswählbaren Gehaltsmodelle mit der unveränderten Berechnung ohne künstliche Datumsgrenze. Ein eigener Oktober-2026-Fall prüft den gemeldeten Auslöser. Ein echter Stunden- oder Stufenwechsel bleibt gesperrt; auch A→B→A wird erkannt. Eine fachlich noch nicht unterstützte echte untermonatige Netto-Berechnung wird nicht durch Mittelung oder einen aktuellen Profilwert ersetzt. Der konkrete iPhone-Datenbestand ist nicht eingesehen worden.

### D9 – Abnahmefälle

- Unverändert öffnen, schließen oder einen Entwurf wieder auf den Ausgangswert stellen: kein Speichern und keine Datumsfrage.
- Stunden, Stufe und Modellantwort gemeinsam bearbeiten: ein Speicherauftrag, ein gewählter Zeitraum.
- Dialog zurück: Entwurf bleibt erhalten; doppelte Bestätigung während des Speicherns schreibt nur einmal.
- Datum wählen: frühere Grundlagen unverändert; Gesamtzeitraum: nur die bearbeiteten Felder berichtigen, geplante spätere Änderungen erhalten.
- Historischen Abschnitt gezielt berichtigen; ursprüngliche Datumsgrenzen bleiben gespeichert, äquivalente Netto-Grundlagen werden wieder berechenbar.
- Rückgängig, Neustart/Reload und Backup-Roundtrip; spätere fremde Änderungen werden nicht überschrieben.
- Alle acht Gehaltsmodelle, Oktober-2026-Regression, Dezember-2026-Sollzeitreferenz sowie echte untermonatige Wechsel.

### D9 – Geänderter Dateiscope

Die folgenden 33 Quell-/Testdateien wurden gegenüber dem vor D9 gesicherten Stand bearbeitet oder neu angelegt. Zusätzlich wurde dieses Integrationsdokument ergänzt. Der frühere Sollzeit-Feature-Scope bleibt im Worktree erhalten und ist nicht vollständig Bestandteil dieser D9-Differenz.

- `src/application/dated-work-pattern.ts`
- `src/application/pflegeshift-provider.tsx`
- `src/domain/types.ts`
- `src/engine/net-pay-automatic-forecast.test.ts`
- `src/engine/net-pay-automatic-forecast.ts`
- `src/engine/simple-pay.ts`
- `src/features/analysis/analysis-rule-coverage.component.test.tsx`
- `src/features/analysis/tariff-assessment-screen.tsx`
- `src/features/settings/check-profile-screen.component.test.tsx`
- `src/features/settings/check-profile-screen.tsx`
- `src/features/settings/settings-choice-test-helpers.tsx`
- `src/features/settings/settings-editor-screen.tsx`
- `src/features/settings/settings-editor-theme.component.test.tsx`
- `src/features/settings/settings-nursing-training.component.test.tsx`
- `src/features/settings/settings-pay-group.component.test.tsx`
- `src/features/settings/settings-screen.component.test.tsx`
- `src/features/settings/settings-screen.tsx`
- `src/features/settings/settings-tval-pflege.component.test.tsx`
- `src/features/settings/settings-tvh-kr.component.test.tsx`
- `src/features/settings/settings-tvl-kr.component.test.tsx`
- `src/features/settings/settings-tvuk-nursing.component.test.tsx`
- `src/features/settings/settings-vka-e.component.test.tsx`
- `src/features/settings/work-profile-flow.component.test.tsx`
- `src/features/settings/work-profile-screen.component.test.tsx`
- `src/features/settings/work-profile-screen.tsx`
- `src/navigation/routes.ts`
- `src/engine/payroll-employment-periods.ts`
- `src/features/settings/employment-change.ts`
- `src/features/settings/employment-model-fields.tsx`
- `src/features/settings/profile-validity.tsx`
- `src/features/settings/working-time-target-overview.tsx`
- `src/infrastructure/database/employment-profile-repository.test.ts`
- `src/infrastructure/database/employment-profile-repository.ts`

### D9 – Abschließende Verifikation

- `verify:fast`: erfolgreich, Exit 0. Enthält aktuelle Regelverträge, Typecheck, ESLint ohne Warnungen, globale Formatprüfung, vollständige Tests und `git diff --check`.
- Unit-/Integrationstests: **9.326 Tests in 481 Dateien bestanden**.
- Oberflächentests: **1.386 Tests in 153 Suites bestanden**. Assistenten-/Zwischenspeicher-Tests wurden durch Tests des gemeinsamen Entwurfs ersetzt; die Tarif- und Betragsassertionen bleiben Bestandteil der jeweiligen Familien-Suites.
- Weitere Repository-Gates: Regel-Publisher/-Delivery/-Preflight/-Provisionierung/-Trust/-Operator, Tarifinventar, Audit-/Runtime-Policy, Build-Abhängigkeiten, Kalender-Worklets, Sharing-Sicherheit, native Widget-Verträge und Decoder-Härtung erfolgreich. Die Widget-Vertragsprüfung ist kein nativer Build.
- Gezielte D9-Prüfungen zusätzlich: 36 Architekturtests; 39 Speicherablauf-/Provider-Komponententests. Die Refactoring-Grenze des zentralen Providers bleibt unverändert eingehalten.
- Windows-Testlauf seriell mit einem Vitest-Thread ausgeführt. Die temporäre Testkonfiguration wurde im `finally` bytegenau zurückgesetzt; keine Änderung an `vitest.config.ts` verbleibt.
- Dateiabgleich: **95 Quell-/Test-/Konfigurationsdateien** stimmen nach QA und Export mit dem eingefrorenen SHA-256-Manifest überein. Gegenüber dem D9-Eingangssnapshot sind ausschließlich die oben genannten 33 Dateien und dieses Dokument verändert.

Der iOS-Export mit Preview-Umgebung und `APP_VARIANT=internal` ist erfolgreich. Bundle-Identifier `com.pflegeshift.app.internal`; Runtime **`d0daa823a2a0b0965e5a1c7462b2885570aab578`**, passend zu Internal Build 43. Die vorhandene öffentliche Preview-Sync-Konfiguration ist im Bundle nachgewiesen; Werte werden nicht dokumentiert.

- Bundle: `_expo/static/js/ios/entry-b23f73c9f09c82ed00a3af051e02a0cf.hbc`
- SHA-256: `a9b09920e0f07c15dbdd317c13ad6e07f1e004b97ba2a3511eb859ae5887680e`
- Nachweise unter `%TEMP%`: `luna-d9-verify-fast-complete.log`, `luna-d9-net-red-proof.log`, `luna-d9-source-audit.json`, `luna-d9-ios-export-receipt.json`, `luna-d9-acceptance.json`.

**Status am Ende der Implementierung:** D9 war vor der gesonderten Veröffentlichungsfreigabe noch nicht per OTA veröffentlicht. Kein Commit/Push/Merge, kein nativer Build und keine TestFlight-/Production-Auslieferung. Ein Export ersetzt keine iPhone-Abnahme. Nach gesonderter Preview-OTA-Freigabe sind auf dem iPhone insbesondere Mehr → Arbeit & Gehalt, gemeinsame Stunden-/Modell-/Stufenänderung, Zeitraumwahl erst beim Speichern, Rückgängig sowie Oktober/Dezember 2026 zu prüfen. Der konkrete historische iPhone-Datenbestand bleibt ungeprüft; ein darin tatsächlich abweichender Abschnitt kann über den Änderungsverlauf berichtigt werden.

### D9 – Separat freigegebene Preview-Veröffentlichung (26.10.2026)

Nutzerfreigabe: „Ja“ auf die konkrete Frage nach einer ausschließlichen Preview-OTA für Internal Build 43. Auslieferung nur für `preview` / `ios`, Environment `preview`, `APP_VARIANT=internal`. Das bereits getestete Bundle wurde mit `--skip-bundler --input-dir dist/ios` unverändert übernommen. Kein Git-Delivery, kein neuer nativer Build und keine Production-/TestFlight-Veröffentlichung.

- Veröffentlicht: `2026-10-26T12:49:17.648Z`.
- Update-Gruppe: `c7ad6460-7794-46dc-ba5e-e59fd4b981a9`.
- iOS-Update: `01a17842-0f50-786b-83aa-b42a83c8b738`.
- Vorherige Preview-Gruppe: `e60f147d-8e9c-44aa-9bea-6e8a27a1b2ed`.
- Runtime identisch mit Internal Build 43: `d0daa823a2a0b0965e5a1c7462b2885570aab578`.
- Das ausgelieferte Manifest nennt exakt die neue Update-ID. Deklarierter Manifest-Hash, tatsächlich geladenes CDN-Bundle und lokaler getesteter Export stimmen überein: SHA-256 `a9b09920e0f07c15dbdd317c13ad6e07f1e004b97ba2a3511eb859ae5887680e`.
- Alle 95 eingefrorenen Quell-/Test-/Konfigurationsdateien stimmen weiter überein. `update:list` zeigt D9 als neuesten iOS-Preview-Stand; Kanalzuordnung und veröffentlichtes Environment sind geprüft.
- Nachweise unter `%TEMP%`: `luna-d9-preview-preflight-receipt.json`, `luna-d9-preview-update.json`, `luna-d9-preview-list-after.json`, `luna-d9-preview-channel-after.json`, `luna-d9-preview-verification.json`.

[Expo-Update](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/c7ad6460-7794-46dc-ba5e-e59fd4b981a9). Geräteabnahme weiterhin offen: Internal-App vollständig schließen, öffnen und etwa 15 Sekunden warten, erneut schließen und öffnen. Prüfe dann Mehr → Arbeit & Gehalt, die Zeitraumwahl erst nach „Änderungen speichern“, Rückgängig sowie die Oktober-/Dezember-Auswertung. Die technischen Auslieferungsnachweise bestätigen keine sichtbare Übernahme auf dem iPhone.

## D10 – Doppelten Einstieg zu persönlichen Angaben entfernen (26.10.2026)

Auftrag: „Diese Seite ist unnötig“ mit Screenshot der über Arbeit & Gehalt erreichbaren Seite Persönliche Angaben. Ziel ist, den zusätzlichen Abzweig aus dem gemeinsamen Beschäftigungsablauf zu entfernen. Plattform: iOS Internal Build 43. Fortsetzung im bestehenden Feature-Worktree/Branch; Expo vor Änderung erneut als `~57.0.22` geprüft. Nicht-Ziele: Änderungen an Konto-/Arbeitgeber-Speicherung, Vergütungs-/Sollzeitlogik, Datierung, nativer Integration oder Veröffentlichung.

Die exhaustive Aufrufsuche zeigt genau einen regulären Einstieg: den zusätzlichen Eintrag Name & Arbeitgeber am Ende von Arbeit & Gehalt. Dieser Eintrag und sein nun unbenutzter Routenimport wurden entfernt. Arbeitgeber bleibt direkt unter Mehr erreichbar; der Kontobereich behält seine vorhandene Namensbearbeitung. Die bestehende Verarbeitung älterer direkter PERSONAL-Links bleibt zur Kompatibilität erhalten, ist aber nicht mehr als zusätzliches Untermenü im Beschäftigungseditor angeboten. Keine gespeicherten Namen oder Arbeitgeberdaten werden verändert.

Dateiscope gegenüber D9:

- `src/features/settings/settings-editor-screen.tsx`: zusätzlichen Abzweig entfernt.
- `src/features/settings/work-profile-flow.component.test.tsx`: bestehenden gemeinsamen Entwurfs-/Speicherablauf um die Prüfung des fehlenden zusätzlichen Eintrags ergänzt.
- `docs/working-time-target-integration.md`: Auftrag und Ergebnisse dokumentiert.

Die gezielten Komponentenprüfungen des gemeinsamen Entwurfs, Mehr-Menüs und Kontobereichs sind bestanden: **40 Tests in 3 Suites**.

- `verify:fast`: erfolgreich, Exit 0; Typecheck, ESLint ohne Warnungen, Formatprüfung, Regelverträge, sämtliche weiteren Repository-Gates und `git diff --check` bestanden.
- Unit-/Integrationstests: **9.326 Tests in 481 Dateien bestanden**.
- Oberflächentests: **1.386 Tests in 153 Suites bestanden**.
- Windows-Lauf mit einem Vitest-Thread; temporäre Testkonfiguration bytegenau zurückgesetzt.
- Alle 95 Quell-/Test-/Konfigurationsdateien nach QA und Export mit dem eingefrorenen D10-Manifest abgeglichen. Gegenüber D9 genau die beiden oben genannten Quell-/Testdateien und dieses Dokument verändert.
- iOS-Export mit Preview-Umgebung und `APP_VARIANT=internal` erfolgreich; Bundle-Identifier `com.pflegeshift.app.internal` und Runtime `d0daa823a2a0b0965e5a1c7462b2885570aab578`, kompatibel mit Internal Build 43.
- Bundle: `_expo/static/js/ios/entry-685556fb599176d002f0d81f65e4a518.hbc`.
- SHA-256: `08cafb496a3b1af1240dece6aaa37dea4666565dd620cc0f77a1034f38805bfc`.

Nachweise unter `%TEMP%`: `luna-d10-contract.json`, `luna-d10-focused.log`, `luna-d10-verify-fast.log`, `luna-d10-final-source.json`, `luna-d10-source-audit.json`, `luna-d10-ios-export-receipt.json`, `luna-d10-acceptance.json`.

**Status vor der gesonderten Veröffentlichungsfreigabe:** D10 war noch nicht veröffentlicht. Die Freigabe für D9 wurde nicht auf D10 übertragen. Kein Commit/Push/Merge, kein nativer Build und keine TestFlight-/Production-Auslieferung. Geräteabnahme folgt erst nach Bereitstellung: In Mehr → Arbeit & Gehalt fehlt der zusätzliche Eintrag Name & Arbeitgeber; der reguläre Arbeitgeber-Zugang unter Mehr und die bestehende Namensbearbeitung im Kontobereich sind erreichbar.

### D10 – Separat freigegebene Preview-Veröffentlichung (26.10.2026)

Nutzerfreigabe: „Ja“ auf die Frage, diese Korrektur ebenfalls ausschließlich im Preview-Kanal zu veröffentlichen. Auslieferung nur für `preview` / `ios`, Environment `preview`, `APP_VARIANT=internal`; unverändertes geprüftes Bundle mit `--skip-bundler --input-dir dist/ios` übernommen. Kein Git-Delivery, kein nativer Build und keine Production-/TestFlight-Veröffentlichung.

- Veröffentlicht: `2026-10-26T13:14:25.319Z`.
- Update-Gruppe: `cc2fb3dd-a2d2-44d8-a157-b74e2e80987d`.
- iOS-Update: `01a17859-10a7-7ef4-a8bd-3c7753056d8b`.
- Vorherige Preview-Gruppe: `c7ad6460-7794-46dc-ba5e-e59fd4b981a9`.
- Runtime identisch mit Internal Build 43: `d0daa823a2a0b0965e5a1c7462b2885570aab578`.
- Das tatsächlich ausgelieferte Manifest nennt die neue Update-ID. Manifest-Hash, geladenes CDN-Bundle und lokaler getesteter Export stimmen überein: SHA-256 `08cafb496a3b1af1240dece6aaa37dea4666565dd620cc0f77a1034f38805bfc`.
- Alle 95 eingefrorenen Quell-/Test-/Konfigurationsdateien stimmen weiterhin überein. Neuester iOS-Preview-Stand, Kanalzuordnung und veröffentlichtes Environment sind bestätigt.
- Nachweise unter `%TEMP%`: `luna-d10-preview-preflight-receipt.json`, `luna-d10-preview-update.json`, `luna-d10-preview-list-after.json`, `luna-d10-preview-channel-after.json`, `luna-d10-preview-verification.json`.

[Expo-Update](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/cc2fb3dd-a2d2-44d8-a157-b74e2e80987d). Geräteabnahme offen: Internal-App vollständig schließen, öffnen und etwa 15 Sekunden warten, erneut schließen und öffnen. Prüfe unter Mehr → Arbeit & Gehalt, dass der zusätzliche Eintrag Name & Arbeitgeber fehlt. Der technische Auslieferungsnachweis bestätigt keine sichtbare Übernahme auf dem iPhone.

### D10 – Geräteabnahme durch den Nutzer (26.10.2026)

Nutzerbestätigung: **„Ja funktioniert die Abnahme“**, als Antwort auf die unmittelbar vorausgehende Checkliste. Dokumentiert um `2026-10-26T13:39:45Z`. Bestätigt ist der aktuelle Preview-Ablauf auf dem iPhone:

- Der zusätzliche Eintrag Name & Arbeitgeber fehlt in Arbeit & Gehalt.
- Die Zeitraumwahl erscheint erst beim Speichern; der gemeinsame Entwurf bleibt der maßgebliche Ablauf.
- Die Oktober-Nettoanzeige funktioniert.

Die Bestätigung wird dem zuletzt veröffentlichten D10-Update `01a17859-10a7-7ef4-a8bd-3c7753056d8b`, Gruppe `cc2fb3dd-a2d2-44d8-a157-b74e2e80987d`, mit geprüftem Bundle-Hash `08cafb496a3b1af1240dece6aaa37dea4666565dd620cc0f77a1034f38805bfc` zugeordnet. Ziel war Internal Build 43; Buildnummer und Gerätemodell wurden bei dieser Rückmeldung nicht erneut am Gerät abgelesen. Die Abnahme gilt für die genannten Bedien- und Anzeigefälle. Eine neue Prüfung einzelner Netto-Eurobeträge oder zusätzlicher Tarifkonstellationen wurde damit nicht behauptet.

Diese Abnahme deckt den gemeinsamen D9-Beschäftigungsablauf im D10-Nachfolgebundle mit ab und aktualisiert die früheren offenen Gerätestatus für diesen Ablauf. Die technischen D9-Auslieferungsnachweise bleiben Nachweise ihrer damaligen Version.

Nächster Schritt: den abgenommenen Feature-Stand nach gesonderter Git-Freigabe im bestehenden Draft-Pull-Request aktualisieren und dessen CI abwarten. Diese Geräteabnahme allein erteilt keine Commit-/Push-/Merge-, weitere OTA-, native Build- oder TestFlight-Freigabe.

## BT-B-Anbindung

Die vorhandene Auswahl Pflege / BT-B wird im aktuellen und datierten Berechnungsprofil wiederverwendet. Ein alter eindeutiger BT-B-Marker wird nur für die Berechnung erkannt; gespeicherte Kontexte bleiben unverändert. Mehrdeutige historische Marker bleiben offen. Für Hessen mit vertraglich 39 Stunden ergibt die Prognose Dezember 2026 148:12 und Dezember 2027 156:00 Stunden im passenden Siebentagemodell. TVöD-K mit 38,5 Stunden bleibt im Dezember 2026 bei 146:18. Eine eigene bestätigte Tagesberechnung benötigt weiter explizite Voraussetzungen. [Quellen, Bedingungen und Prüfplan](working-time-target-b.md).

## TV-L/KR-Anbindung 2026–2027

Der eigene §-43-Adapter nutzt dieselbe Engine und die vorhandene aktuelle bzw. datierte KR-/SECTION_43-Auswahl. Sein Feiertagstatbestand unterscheidet sich von BT-K/BT-B: Bestätigte Feiertagsarbeit erzeugt keinen pauschalen Fünftelabzug, sondern einen Hinweis auf getrennten Ausgleich. Qualifiziert planmäßig frei mit anderweitig zu erfüllender Wochenzeit kann die Fünftelminderung auslösen. Grundlage sind die TdL-Fassung vom 14.02.2026 und BAG 6 AZR 465/15, jeweils mit eigenen Regelkennungen.

Die automatische FORECAST-Rechnung bleibt unabhängig von eingetragenen Diensten. Ihr TV-L-Planwert ist ausdrücklich eine bedingte Planfrei-Referenz; der kurze Vorbehalt ersetzt den bisherigen allgemeinen Erklärungstext innerhalb derselben aufklappbaren Aufschlüsselung und erscheint auch einmal im Monats-/Jahres-PDF. Neue Menüs, Tagesfragen oder Profilfelder entstehen nicht. Die konkrete iPhone-Abnahme dieses Textes ist ein eigener Nachweis vor Merge; ältere Rückmeldungen werden nicht übernommen.

Keine Migration oder automatische Änderung individueller Vertragsstunden. Die 2027 geänderte Vollzeitbasis Universitätskliniken Ost wird nicht ungefragt als individuelle Stundenänderung interpretiert. Bekannte eindeutige historische SECTION_43-Marker werden nur zur Berechnung erkannt; mehrdeutige TV_L-Marker bleiben offen. Ein älterer aktiver Feiertagskatalog ohne Regionalvertrag bleibt in BY/SN/TH ausdrücklich unzureichend. [Quellen, unabhängige Referenzen, Tests und Grenzen](working-time-target-tvl.md).
