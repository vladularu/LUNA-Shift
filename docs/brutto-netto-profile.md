# Monatliches Netto-Profil – Arbeitspaket 3

## Task-Vertrag

- Ziel: vollständige, validierte Netto-Eingaben je Abrechnungsmonat lokal speichern, unverändert laden und in Export/Wiederherstellung erhalten. Frühere Monate werden durch spätere Änderungen nicht überschrieben.
- Nicht-Ziele: UI, automatische Tarif-/SFN-Zuordnung, automatische Übernahme in andere Monate, neue Versicherungs-/Steuerfälle, Veröffentlichung.
- Plattform: bestehende lokale Datenbank, Expo SDK `~57.0.22`, iPhone als späteres Abnahmegerät; keine Änderungen an nativen Modulen oder Verschlüsselungskonfiguration.
- Teilpaket 3a: neue Domain-/Repository-Dateien samt Tests, gemeinsame Profilvalidierung im Netto-Kern, additive Migration 32 und Registrierung. Etwa sieben Code-/Testdateien.
- Teilpaket 3b: Backup v20, Snapshot/Serializer/Validator/Restore und Integrationstests.
- Teilpaket 3c: 15 bestehende Fixture-/Kompatibilitätsdateien für Altformate, Versions- und Migrationszähler. Keine Lockerung der produktiven Altformat-Validierung.
- Abnahme: ungültige/fehlende Werte werden nicht als Standardwerte ergänzt; genaue Monatsbindung, Revisionen, Speicherung/Löschung, unveränderliche Ergebnisse, Migration frisch/von v31/wiederholt, vollständiger Backup-Rundlauf, Altformate ohne erfundene Profile, beschädigte Backups und atomarer Restore sowie `verify:fast` bestehen.
- Geräteabnahme: SQLCipher und der spätere Eingabefluss müssen noch auf dem iPhone geprüft werden. SQLite-Integrationstests ersetzen diesen Nachweis nicht.
- Commit, Push, Build, OTA und Merge: keine Freigabe.

## Modell

Ein Datensatz gilt ausschließlich für seinen Monat. Er enthält die vollständigen Angaben des Netto-Kerns, ausdrücklich bestätigte Sonderfälle und optional den bestimmten SFN-Grundlohn. Ein leeres Sonderfall-Array bestätigt den gewöhnlichen GKV/RV/AV-Fall; bekannte, noch nicht unterstützte Fälle bleiben speicherbar, liefern aber weiterhin keine Nettozahl. Fehlende Felder erhalten keine stillen Vorgaben.

Die monatliche Kinderzahl, Freibeträge, Zusatzbeiträge und Faktorwerte werden nicht unbemerkt fortgeschrieben. Der spätere Nutzerfluss kann das vorige Profil als Vorschlag zeigen; erst die Bestätigung speichert den neuen Monat. Die Speicherung ist von der jährlichen Berechnungsregel getrennt: Ein Profil für 2027 ist speicherbar, die aktuelle 2026-Engine bleibt dafür nicht verfügbar.

Schreibzugriffe verwenden gebundene SQL-Parameter und eine unmittelbare Transaktion. Der zuvor geladene Datensatz wird einschließlich Inhalt, Revision und Zeitstempeln verglichen; zwischenzeitlich geänderte Profile werden nicht überschrieben. Für Monate mit offenem Testlabor-Backup sind Speichern und Löschen gesperrt. Das Testlabor erzeugt/ändert keine Netto-Profile und bewahrt sie beim Kalender-Restore unverändert; sein bestehendes Backupformat wird deshalb nicht erweitert. Diese Grenze wird mit einem Testlauf-Rundlauf geprüft.

Backup v20 enthält die neuen Datensätze im vorhandenen Integritätsnachweis. Altversionen 1–19 bleiben lesbar und enthalten keine Netto-Profile. Beim vollständigen Wiederherstellen werden bestehende Profile atomar durch die Inhalte der Sicherung ersetzt; ein altes Backup hinterlässt daher keine versehentlich weiterverwendeten aktuellen Steuerangaben.

Referenz zur verwendeten Datenbank-API: [Expo SQLite SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/).

## Nachweise

- 83 neue Tests bestehen: 39 Domain-Fälle, zehn SQLite-/Repository-Fälle und 34 Backup-Fälle. Geprüft sind fehlende/ungültige Werte, zukünftige Jahre ohne verfügbare Berechnungsregel, genaue Monatsbindung, unveränderliche Ergebnisse, konkurrierende Änderungen, Speichern/Löschen, beschädigte gespeicherte Daten und eine rückwärts laufende Systemuhr.
- Migration 32 ist für eine neue Installation, den Übergang von Schema 31 und wiederholten Bootstrap geprüft. Ein echter Testlabor-Lauf mit Wiederherstellung bewahrt Netto-Profile und sperrt Änderungen während des offenen Laufs.
- Backup v20 erhält sämtliche Profilangaben und Metadaten. Alle Altversionen 1–19 sind im Wiederherstellungstest enthalten. Manipulierte oder unvollständige Profile werden vor Änderungen zurückgewiesen; ein absichtlich fehlgeschlagener Profilimport rollt die gesamte Wiederherstellung zurück.
- Die breitere Datenbank-/Netto-Prüfung besteht mit 1.236 Tests in 84 Dateien. Bestehende Altformat-Fixtures wurden um das Entfernen des neuen Felds ergänzt; Migration-Fixtures entfernen die neue Tabelle beim simulierten Schema-Rücksprung. Die produktive Validierung bleibt strikt.
- `npm.cmd run verify:fast` besteht vollständig: Regelverträge, Typprüfung, Lint ohne Warnungen, Formatierung, 7.941 Unit-/Integrationstests in 407 Dateien, 808 Komponententests in 108 Suiten und sämtliche Publisher-, Delivery-, Produktions-, Operator-, Inventar-, Sicherheits-, Runtime- und Build-Dependency-Prüfungen. Protokoll: `artifacts/verify-fast-net-pay-profile.log`.
- Der erste Gate-Lauf fand eine fehlende Felddeklaration in einer Altformat-Testfixture. Nach der Korrektur wurde der gesamte Ablauf erneut erfolgreich ausgeführt. `graft build` und die Whitespace-Prüfung der neuen sowie geänderten Dateien sind ebenfalls erfolgreich.
- Noch kein App-Nutzerfluss, keine automatische Tarif-/SFN-Anbindung und keine iPhone-/Hermes-/SQLCipher-Abnahme. Die fachlichen Rechenkerne aus Arbeitspaketen 1 und 2 behalten ihre dokumentierten Grenzen.
