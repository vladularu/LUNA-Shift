# Einfache Netto-Prognose

## Task-Vertrag

- Ziel: Einmalige Einrichtung in vier kurzen Schritten (Steuern, Familie, Krankenversicherung, Zusatzversorgung), danach automatische monatliche Netto-Prognose aus der Gehaltsauswertung.
- Nicht-Ziele: Neue Tariftabellen, Steuerprüfung, neue native Abhängigkeiten, Krankenkassenkatalog ohne verifizierte Beitragshistorie, automatische ZVK-Zuordnung allein anhand des Bundeslands.
- Plattform: iPhone, vorhandener Expo-SDK-57-Preview-Build. Installiert: Expo ~57.0.22; Referenz https://docs.expo.dev/versions/v57.0.0/.
- Checkout: `.worktrees/brutto-netto-prototype`, Branch `codex/brutto-netto-prototype`; vorhandene Featurearbeit bleibt erhalten.
- Scope: Einrichtung/Formwerte und Tests, automatische Prognose und Tests, Ergebnis-/Einstiegskarte, Automationsvalidierung samt Historien-/Backup-Test. Keine Datenbankmigration.
- Arbeitspakete: (1) Vier Schritte und optionale Details, vorhandene persönliche Werte erhalten; (2) ausdrücklich gekennzeichnetes Netto vor unbekannter Zusatzversorgung und kompakte Ergebnisanzeige.
- Abnahme: Vier Schritte ohne Pflichtangaben zu steuerlichem Stundenlohn oder steuerfreiem Brutto; Sachsen aus Arbeitsort; sichtbarer GKV-Prognosewert; Kinderstatus getrennt vom Kinderfreibetrag; bekannte Zusatzversorgung bleibt berücksichtigt; unbekannte/andere Kasse wird nicht stillschweigend als keine Versorgung gespeichert; Zuschlagsklassifizierung bleibt unverändert; fortlaufende Speicherung, alte Profile und Backup funktionieren.
- Prüfungen: fokussierte Fach-/Komponententests, `npm.cmd run verify:fast`, iOS-Export. Visuelle iPhone-Abnahme benötigt anschließend Screenshot/Gerätenachweis.
- OTA: anschließend ausdrücklich durch „ota“ freigegeben. Commit, Push, Build und Merge bleiben ohne Freigabe.

## Annahmen und Quellen

Die Standardprognose verwendet laufendes Entgelt, einen vollen bezahlten Monat und geplante Dienste mit mittigen Pausen. Einmalzahlungen sind nicht enthalten. Diese Annahmen werden angezeigt; Sonderfälle bleiben unter optionalen Details erkennbar und werden nicht als unterstützte Standardfälle umgedeutet.

- GKV-Zusatzbeitrag für neue Angaben: amtlicher Prognosewert 2026 von 2,9 %, eigener Satz optional. Vorhandene individuelle Sätze bleiben erhalten. https://www.bundesgesundheitsministerium.de/beitraege
- Steuerfreie SFN-Anteile und SV-freie Anteile bleiben getrennt und folgen der vorhandenen Zeitspur: https://www.gesetze-im-internet.de/estg/__3b.html und https://www.gesetze-im-internet.de/svev/__1.html
- Zusatzversorgung wird nur bei explizit ausgewähltem bekanntem Modell berücksichtigt. Bei unbekannter/anderer Kasse wird das Ergebnis überall als Netto vor Zusatzversorgung gekennzeichnet. https://www.vbl.de/de/vblklassik1
- Kirchensteuer: Ja/Nein und Wohnortgruppe; die Vorauswahl aus dem Arbeitsort wird ausdrücklich als Vorauswahl angezeigt und kann korrigiert werden. Gespeicherte Sätze werden erhalten.
  Quelle: https://verwaltung.bund.de/leistungsverzeichnis/DE/leistung/99102035002000/herausgeber/HH-S1000020010000006138/region/02

## Umsetzung

- Die automatische Ansicht verwendet jetzt `NetPaySetupForm`; der manuelle Detailrechner bleibt erreichbar.
- Schritt 1: Steuerklasse und Kirchensteuer Ja/Nein. Nur bei Kirchensteuer erscheint eine verständliche Wohnortgruppe. Kinderfreibetrag, Steuerfreibetrag und Faktor stehen unter optionalen Details; vorhandene Werte bleiben erhalten.
- Schritt 2: Geburtsdatum, Kinder Ja/Nein, bei Eltern Anzahl unter 25. Erwachsene Kinder und Kinderfreibetrag bleiben getrennt. Sachsen wird aus dem Arbeitsort übernommen, auch bei älteren persönlichen Angaben.
- Schritt 3: Gesetzliche Krankenversicherung mit sichtbar gekennzeichnetem Durchschnittswert 2026. Ein eigener Zusatzbeitrag ist optional; es wird kein ungeprüfter Krankenkassenkatalog eingeführt. Sonderfälle stehen unter Details und werden weiterhin nicht als regulär berechnet.
- Schritt 4: Bekannte Zusatzversorgung, keine, unbekannt oder andere Kasse. Zusätzliche laufende Zulagen/Nettoabzüge stehen unter Details. Die bisher verlangten Bestätigungsfelder entfallen zugunsten sichtbarer Prognoseannahmen beim Speichern.
- Ergebnis: ca. Netto, Gesamtbrutto, davon steuerfreie Zuschläge und gesamte Abzüge. Einzelabzüge und Annahmen sind aufklappbar. Unbekannte/andere Zusatzversorgung wird sowohl hier als auch direkt in der Gehaltsauswertung als Netto vor Zusatzversorgung gekennzeichnet; ihr gespeicherter Status wird nicht in `NONE` umgewandelt.
- Fortlaufende Version-2-Einstellungen, ältere monatliche Angaben, Schreibkonflikte und Backup bleiben erhalten. Keine neue Migration oder native Abhängigkeit.

## Validierung

- Fokussierte Fachtests: 148 bestanden (inklusive SFN, bekannter/unbekannter Zusatzversorgung und Backup).
- Fokussierte Oberflächentests: 38 bestanden; der vollständige Lauf prüft zusätzlich die abschließende Kürzung der Annahmenansicht.
- Vollständige Fach-/Integrationstests: 8.113 Tests in 415 Dateien bestanden.
- Typprüfung und Lint auf dem endgültigen Quellstand: bestanden, Log `artifacts/net-pay-simple-final-static.log`.
- Endgültiger lokaler iOS-Export mit `APP_VARIANT=internal`: bestanden. Log `artifacts/net-pay-simple-ios-final-export.log`, Bundle `entry-c1add7a865c18a4435f54603620435e9.hbc`, SHA256 `971c91742cd87b7317bc13c6c5805e1118defc44abc25ba51759345345f73766`.
- `npm.cmd run verify:fast`: bestanden, Exit 0. Einschließlich 8.113 Fach-/Integrationstests, 876 Oberflächentests in 115 Suiten sowie aller übrigen Projektprüfungen. Log `artifacts/net-pay-simple-verify-fast.log`.
- Die 13 betroffenen Quell-/Testdateien stimmen mit dem endgültigen geprüften Quellstand überein; Hashmanifest `artifacts/net-pay-simple-final-source-hashes.json`. Diese Änderung umfasst zusätzlich dieses Dokument, insgesamt 14 Dateien.
- Visuelle iPhone-Abnahme: ausstehend. Kein Geräte- oder Screenshotnachweis für diese Einrichtung vorhanden; lokaler Export ersetzt diesen Nachweis nicht.
- Kein Commit/Push, kein neuer Build und keine Store-Veröffentlichung ausgeführt. Die separat freigegebene Preview-OTA ist unten dokumentiert.

## Preview-OTA

Freigabe: „ota“. Veröffentlichung am 10. Oktober 2026 um 03:03:02 Uhr MESZ, Nachricht `Brutto-Netto: einfache Prognose in vier Schritten`.

- Gruppe: `9a9dd838-ef67-4ec3-a59f-0fa5fa53a171`.
- iOS-Update: `01a12355-b579-7e17-b456-cbc3fc2221c5`.
- [EAS-Dashboard](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/9a9dd838-ef67-4ec3-a59f-0fa5fa53a171).
- Kanal/Branch/Umgebung: `preview` / `preview` / `preview`; App `com.pflegeshift.app.internal`.
- Kompatibel mit Preview-Build 33 (`8deae8f8-679b-4284-978a-a07f74fa6719`), SDK 57, vollständiger Fingerprint mit 95 Quellen: `03d174d668f0ea5f757958dccf853632762c554d`.
- Der unpausierte Preview-Kanal liefert das neue Manifest mit dieser OTA-ID und Runtime aus.
- Das heruntergeladene Hermes-Bundle stimmt bytegenau mit dem lokalen EAS-Preview-Export überein: 6.756.548 Bytes, SHA256 `a73573bb4e1b136ec3d752fe0d0105f89f068fcce1a9734f5f0490f476d7aac5`. Der Manifest-Hash wurde ebenfalls geprüft. Der EAS-Export erzeugt zusätzlich eine Source Map; sein Hermes-Bundle ist daher separat vom vorigen lokalen Export dokumentiert.
- Nachweise: `artifacts/net-pay-simple-ota-fingerprint-summary.json`, `artifacts/net-pay-simple-ota-release-check.log`, `artifacts/net-pay-simple-ota-publish.json`, `artifacts/net-pay-simple-ota-channel-summary.json` und `artifacts/net-pay-simple-ota-publication-verification.json`.

Zum Testen LUNA Shift Internal vollständig schließen, mit Internetverbindung öffnen und etwa 15 Sekunden warten, anschließend nochmals vollständig schließen und öffnen. In der Gehaltsauswertung die Netto-Prognose öffnen. Bei bereits gespeicherten Angaben ist das Ergebnis direkt verfügbar; über „Angaben ab diesem Monat ändern“ lässt sich die Einrichtung mit vier Schritten prüfen. Die sichtbare Übernahme auf dem iPhone und ein Screenshotnachweis stehen noch aus.
