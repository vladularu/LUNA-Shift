# Onboarding und Dienstplanprüfung

## Task-Vertrag

- Ziel: Ein ruhiger Einstieg mit den verfügbaren Gehaltsgrundlagen; offene Prüfangaben werden getrennt von tatsächlichen Auffälligkeiten angezeigt und direkt ergänzbar.
- Nicht-Ziele: Neue Tarife aktivieren, Rechtsregeln oder Nettoformeln verändern, Konten, native Konfiguration, Branding, neue Builds und Store-Veröffentlichungen.
- Plattform: iPhone zuerst, bestehende Expo-SDK-57-Komponenten; Android/Web werden durch die vorhandenen Prüfungen berücksichtigt.
- Basis: `origin/master` bei `94a9561`, eigener Checkout und Branch `codex/onboarding-pruefung`. Der separate Netto-Branch bleibt erhalten.
- Freigabe: lokale Umsetzung und Tests; am 11.10.2026 wurde zusätzlich die iOS-Preview-OTA für Build 33 ausdrücklich freigegeben und veröffentlicht. Commit, Push, PR, Merge, neuer Build und Store-Veröffentlichung sind nicht freigegeben.

## Paket 1a: Prüfzustände

Scope: Anzeigeprojektion in `check-visibility.ts`, Ergebnistypen, Monats-/Jahresübersichten und Prüfdetails sowie ihre fokussierten Tests.

Akzeptanz:

- Offene Bestätigungen und eine unvollständige Zeitbasis erscheinen als eingeschränkte Prüfgrundlage.
- Sie erhöhen nicht den Zähler tatsächlicher Auffälligkeiten.
- Kritische Feststellungen, bekannte negative Antworten zur Zulässigkeit und sonstige rechtliche Hinweise bleiben sichtbar.
- Ohne vollständige Grundlage entsteht keine grüne vollständige Prüfung.
- Monats- und Jahresanzeigen verwenden dieselbe Trennung; Rohberechnung und gespeicherte Angaben bleiben erhalten.

## Paket 1b: Angaben ergänzen

Scope: eigener kurzer Prüfprofil-Fluss, Route, Einstieg aus den Prüfdetails und fokussierte Komponententests.

Akzeptanz:

- Verständliche Fragen mit Ja, Nein und Weiß ich nicht.
- Fragen zu Nachtarbeit, Sonn-/Feiertagsarbeit und Feiertagsregion erscheinen passend zur offenen Grundlage.
- Unbekannt bleibt unbekannt; kein stilles Bestätigen.
- Speichern erhält Gehalt, Tarife, Arbeitszeit und übrige Profilwerte.
- Bestandsprofile können ergänzen, ohne das Onboarding zu wiederholen; späteres Ergänzen bleibt möglich.

## Paket 2a: Gemeinsame Gehaltsgrundlagen

Scope: vorhandene Tarifauswahl und geprüfte Profileingaben für das Onboarding; keine neue Tarifaktivierung.

Akzeptanz: dieselben Tarifoptionen wie in den Einstellungen; nur passende Gruppen, Stufen und Ausbildungsjahre; fehlende Angaben werden nicht geraten.

## Paket 2b: Ruhiges Onboarding

Scope: `src/features/onboarding`, gemeinsam genutzte Gehaltsauswahl und fokussierte Tests.

Akzeptanz: kurze Texte, sichtbarer Fortschritt, Arbeitsort/Arbeitszeit vor der optionalen Gehaltseinrichtung, klare Auswahl Nach Tarif / Eigenes Brutto / Später, kurze Zusammenfassung und Start ohne Konto. Netto bleibt eine Einrichtung bei der Gehaltsfunktion.

## Lokaler Umsetzungsstand

Die vier Pakete sind im eigenen Checkout umgesetzt:

- 1a: Bekannte fehlende Prüfgrundlagen erscheinen neutral als „Prüfung eingeschränkt“. Tatsächliche Auffälligkeiten werden weiterhin gezählt und angezeigt, einschließlich kritischer Feststellungen zur Sonn-/Feiertagsarbeit.
- 1b: „Angaben ergänzen“ öffnet passende Fragen einzeln. Ja, Nein und Weiß ich nicht bleiben unterscheidbar; Später verlässt den Ablauf ohne Speichern. Der Einstieg ist auch im Arbeitsprofil erreichbar.
- 2a: Die sieben vorhandenen Tarifoptionen verwenden die bestehenden Gruppen, Stufen und Zeitgrundlagen. Ein Tarifwechsel entfernt unpassende Tarifdetails; die Tarifregion wird bewusst ausgewählt.
- 2b: Willkommen → Berufsbereich → Arbeitszeit und Arbeitsort → Gehalt → Zusammenfassung. Die optionale Gehaltseinrichtung bietet Nach Tarif, Eigenes Brutto und Später. Die vorhandene Gestaltung und der 38,5-Stunden-Startwert bleiben erhalten.

Für die Abnahme wurden die Änderungen konfliktfrei mit dem Netto-Stand `8dec08e` in einem separaten Kandidaten kombiniert: `.worktrees/onboarding-netto-abnahme`, Branch `codex/onboarding-netto-abnahme`. Die gemeinsamen lokalen Tests und der iOS-Export sind bestanden. Der iOS-Fingerprint stimmt mit dem vorhandenen Preview-Build 33 überein. Die OTA ist veröffentlicht und technisch verifiziert; der Gerätenachweis steht aus.

## Verifikation und Geräteabnahme

- Fokussierte Tests je Paket; abschließend `npm.cmd run verify:fast` und `git diff --check`.
- iPhone-Nachweis offen: Neuinstallation und Bestandsprofil, unbekannte Angaben und tatsächliche Auffälligkeiten, alle Gehaltspfade, Hell/Dunkel, große Schrift, VoiceOver, Zurück/Später und Tastatur.
- Ein Browsernachweis oder bestandene Tests ersetzen die iPhone-Abnahme nicht.

Erste lokale Verifikation des Onboarding-Checkouts am 11.10.2026:

- `npm.cmd run verify:fast`: vollständig bestanden mit eigenen, anhand des unveränderten Lockfiles installierten Checkout-Abhängigkeiten.
- 402 Vitest-Dateien / 7.682 Tests, 109 Jest-Suites / 815 Komponententests und 141 Werkzeug-/Richtlinientests bestanden.
- Regelkatalog, Typprüfung, Lint, Formatierung und `git diff --check` bestanden; Graft-Graph aktualisiert.
- Die Änderungen sind uncommittet auf `codex/onboarding-pruefung`; Veröffentlichungsschritte benötigen ihre separate Freigabe.

Abnahmevorbereitung mit Netto am 11.10.2026:

- Im Review wurde ein Absturz beim Speichern einer zuvor unbekannten Feiertagsregion reproduziert und behoben. Acht fokussierte Komponententests sichern den Ergänzungsablauf ab.
- Sieben zusätzliche Tests im kombinierten Kandidaten prüfen den Erhalt aller Tarifprofile und datierter Netto-Angaben nach Prüfangaben-Speicherung und Backup-Wiederherstellung.
- `verify:fast`: 420 Vitest-Dateien / 8.352 Tests, 113 Jest-Suites / 880 Komponententests und 141 Werkzeug-/Richtlinientests bestanden; alle übrigen schnellen Gates ebenfalls grün.
- Interner iOS-Export bestanden; Kandidaten-Fingerprint und Build-33-Fingerprint identisch: `03d174d668f0ea5f757958dccf853632762c554d`.
- Alle Schritte der erweiterten lokalen Prüfung bestanden: Unit-Coverage vollständig mit einem Worker, Komponenten-Coverage, Produktions-Abhängigkeitsaudit, Release-Konfiguration sowie Web-/Android-/iOS-Exporte. Der parallele erste Coverage-Lauf und die unveränderte erfolgreiche Wiederholung sind im [Abnahmeprotokoll](onboarding-pruefung-abnahme.md) dokumentiert. Dort stehen auch Testdaten, neun Geräteprüfschritte und benötigte Screenshots.
- Die freigegebene Preview-OTA ist veröffentlicht: Gruppe `64cf5978-8991-46b1-8bbc-2a4ad68985b4`, Update `01a12906-29d4-7855-a5dc-e6cb631b17b1`. Der aktive Kanal, die Build-33-Runtime und das bytegleiche CDN-Bundle sind verifiziert; der neueste Netto-Stand wurde erhalten.
- iPhone-Abnahme bleibt offen. Die Quelländerungen bleiben uncommittet; die OTA-Freigabe umfasst keine Git-, Build- oder Store-Schritte.
