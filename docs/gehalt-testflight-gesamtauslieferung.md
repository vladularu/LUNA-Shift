# Gehalt, Bereitschaften und Prüfung: gemeinsame Auslieferung

## Auftrag und Umfang

Am 01.11.2026 sind TestFlight-OTA, Commit, Push, PR und Merge ausdrücklich für alle hier erarbeiteten Änderungen freigegeben. Der isolierte Branch `codex/gehalt-testflight-gesamt` basiert auf dem frisch geprüften `origin/master` `d1b13ac788044a7564c673170bf3753547728315`.

Der Stand umfasst die Gehaltsdarstellung mit separaten Karten für erarbeitete Zuschläge und Auszahlung, die klassische Brutto-/Netto-Aufstellung mit Abzügen, den Auszahlungsversatz 0/1/2 Monate, monatsübergreifende Zulagenprüfung, Bereitschafts-/Rufbereitschaftsvergütung im erarbeiteten und ausgezahlten Monat, Netto-Prognose und Vorbereitung im Hintergrund, Zuschlagsfilter mit passender Summe sowie die ruhige Darstellung eingeschränkter Prüfungen, die Pausenbewertung geteilter Dienste und den wieder erreichbaren Dino.

108 freigegebene Änderungsdateien des geprüften Preview-Arbeitsstands werden unverändert übernommen. Zusätzlich bleiben 17 bereits in Production veröffentlichte Dateien für die geprüfte Offline-Tarifbasis und deren Tests erhalten. Diese Pakete überschneiden sich nicht. Der Abgleich bestätigt 2.234 bytegleich bewahrte Nicht-Scope-Dateien der bestehenden Production. Der ursprüngliche Preview-Checkout bleibt unverändert.

## Arbeitspakete und Grenzen

1. Gemeinsamen Quellstand aus Master, bestehender Production-Tarifbasis und vollständigem Preview-Scope zusammensetzen, Abhängigkeiten lokal installieren und fachlich prüfen.
2. Den geprüften Stand für den bestehenden iOS-TestFlight-Build mit Production-Konfiguration exportieren und als OTA veröffentlichen; Runtime, Manifest und CDN-Bytes überprüfen.
3. Denselben Anwendungsstand committen, pushen, per PR liefern und erst nach allen sieben CI-Gates nach Master übernehmen; Head/Base, Dateiliste und Tree-/Blob-Gleichheit bestätigen.

Keine Änderungen an nativen Modulen, Abhängigkeiten, TestFlight-Gruppen, Store-Metadaten oder anderen unabhängigen Arbeitsständen. Die Geräteabnahme bleibt ein gesonderter Nachweis.

## Ausgangsnachweise

- Preview-Gruppe `3f756a9f-6597-4853-81be-38e306593755`, iOS-Update `01a19616-5cac-7f48-9c30-47ca7cee2534`, bestehender interner Build 44, Runtime `b99c3cf0dd56e6b1bb126d195f21c665de57760b`.
- Bestehende Production-Gruppe `3ff2fe52-d628-4ac3-b414-450fc91f5a99`, Update `01a19331-751c-78f1-b213-6f09a1290db5`, bestehender TestFlight-Build 8 `2c6c8695-d965-4c0d-804c-7bc65fd91ec2`, Runtime `ab053760e06bdf85a83f64fc65cfee0aab41fe12`.
- Vor dem Zusammensetzen sind sämtliche 2.300 Dateien des veröffentlichten Production-Quellmanifests mit ihren gespeicherten Hashes abgeglichen. Der Gesamtstand enthält zunächst 2.343 Dateien plus diesen Liefernachweis.
- Technische Nachweise liegen im aufrufenden Preview-Checkout unter `artifacts/gehalt-testflight-delivery/`. Die frühere Preview-Gesamtprüfung war erfolgreich; für den gemeinsamen Stand erfolgen eigene Prüfungen.

## Prüfungen des gemeinsamen Stands

- 114 gezielte Fachtests für Auszahlung, Netto, Pausen und erhaltene Tarifbasis bestanden.
- `verify:fast`-Anteil der vollständigen Release-Prüfung erfolgreich: 540 Unit-Dateien mit 10.337 Tests, 187 Komponentensuites mit 1.792 Tests, Skriptprüfungen, Typprüfung, Lint und Formatierung.
- Im anschließenden ersten Coverage-Lauf überschritten fünf aufwendige Jahresberechnungen das unveränderte 5-Sekunden-Limit. Die gleiche Unit-Coverage wurde mit `--maxWorkers=2` erfolgreich wiederholt; keine Testaussage oder Zeitgrenze wurde geändert. Unit-Coverage: 89,76 % Branches und 93,63 % Lines.
- Komponenten-Coverage, Produktionsaudit, Release-Konfiguration und Exporte für Web, Android und iOS bestanden. Der erste `verify:full`-Prozess bleibt mit seinem Coverage-Timeout als Nachweis erhalten; alle ausstehenden Release-Schritte sind im erfolgreichen Fortsetzungslauf dokumentiert.
- Build 8 ist weiterhin der neueste fertige Production-Build. Seine Runtime wurde zusätzlich direkt aus `EXUpdates.bundle/fingerprint` im heruntergeladenen IPA gelesen und mit EAS und lokalem Fingerprint abgeglichen.

## Verifizierte TestFlight-OTA

- Gruppe `a000b2e3-77df-4bb5-8b46-f0609a0ae807`, iOS-Update `01a19645-4c93-792b-9e6a-6c8cf2745851`, veröffentlicht am `2026-11-01T08:41:26.419Z`.
- Ziel: Kanal/Branch/Environment `production`, `APP_VARIANT=production`, Bundle-ID `com.lunashift.app`, bestehender Build 8 und Runtime `ab053760e06bdf85a83f64fc65cfee0aab41fe12`.
- Production-Einstellungen wurden ohne Ausgabe ihrer Werte mit dem laufenden Beta-Bundle abgeglichen. Der Export wurde in dieser Umgebung mit Sourcemaps erstellt und anschließend mit `--skip-bundler` unverändert veröffentlicht.
- Bundle `entry-4b69dea9615e28e79dfbbd7e53f8925e.hbc`, 9.932.496 Bytes, SHA-256 `b262b516e8b56e5a3d4e1aed22de762696784b4695ad891464ab104c6f05b565`.
- Der echte Production-/Runtime-Abruf liefert das neue Manifest. Manifest-Hash und vollständig geladene CDN-Bytes stimmen mit dem lokalen Export überein. Alle 34 benötigten Assets stimmen mit dem Export überein; 18 zuvor mitgelieferte, nun im Bundle nicht mehr referenzierte Icon-Schriftarten entfallen. Die erste strengere Prüfung hatte diese Abweichung gefunden; die Referenzanalyse dokumentiert für jede Schriftart ihren früheren und den jetzt entfallenen Bundle-Verweis.
- Alle 1.983 eingefrorenen Anwendungs-/Konfigurations-/Testquellen und alle 2.337 Dateien des ursprünglichen Arbeitsstands sind unverändert. Die Lieferdokumentation ist vom Anwendungsquellenvergleich ausgenommen.

## Git- und Geräteabnahme

126 Lieferdateien umfassen die 108 Preview-Änderungen, 17 erhaltene Production-Dateien und diesen Nachweis. Dieser Anwendungsstand wird nach der verifizierten OTA committet, gepusht und als PR geliefert. Vor Merge werden alle sieben CI-Gates und Head/Base/Dateiliste geprüft; danach folgt der Tree-/Blob-Abgleich.

Die neue TestFlight-Geräteabnahme ist noch offen. Die technische Veröffentlichung ersetzt sie nicht. Die TestFlight-App vollständig schließen, öffnen und 15 Sekunden warten, erneut schließen/öffnen; danach Gehalt/Netto, erarbeitete Bereitschaftsvergütung und die Prüfung mit Dino auf dem iPhone kontrollieren. Es wurden keine nativen Builds, TestFlight-Gruppen oder Store-Metadaten geändert.
