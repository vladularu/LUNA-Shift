# Sonderdienste – Umsetzungsvertrag

Ziel: Geteilte Dienste, Rufbereitschaft und Bereitschaftsdienst im bestehenden Diensteditor auf dem iPhone offline erfassen. Arbeitszeit, Zeitgutschrift und Geld getrennt ausweisen. Grundlage: Recherche vom 29.10.2026.

Nicht-Ziele: Personaldisposition, rechtliche Freigabe eines Dienstplans, Aktivierung der vorbereiteten Caritas-/DD-/DRK-Tarife, TestFlight-/Store-Veröffentlichung.

Basis: origin/master 88b7b69, Expo SDK 57 (~57.0.31), isolierter Checkout, Branch codex/sonderdienste. Git-Delivery und Preview-OTA sind vom Nutzer ausdrücklich freigegeben.

Arbeitspakete (jeweils separat prüfen):

1. Fachmodell, Validierung und Referenztests: domain/special-duty, engine/special-duty.
2. Persistenz, Migration und Backup: database, Eingabe-/Vorlagentypen.
3. Diensteditor, Vorlagen und Kalenderdarstellung: bestehende Oberflächen, keine globalen Designänderungen.
4. Zeit-/Vergütungsprojektionen, Compliance, Auswertung und Exporte. Offene Tarifwerte sichtbar lassen; keine regulären Zuschläge auf bloße Rufbereitschaft rechnen.
5. Integrationstests, verify:fast, Preview-Kompatibilität und OTA. Anschließend echte iPhone-Abnahme; Metadaten ersetzen diese nicht.

Abnahme: 06–10/16–20 = 8 Stunden; Unterbrechungen unbezahlt. Rufbereitschaft ohne Einsätze nicht als voll geleistete Arbeit zählen; Einsatzstatus ausdrücklich offen/abgeschlossen. Bereitschaftsdienst vollständig für Arbeitsschutz berücksichtigen. Rundung nur für Vergütung. Daten bleiben bei Bearbeiten, Backup und Neustart erhalten. Kopien enthalten keine tatsächlichen Einsätze. Nacht-/Monatsgrenzen und Zeitumstellung prüfen. Unbekannte Stufe oder Tabellenzuordnung ergibt einen offenen Betrag, niemals eine vermeintlich vollständige Nullabrechnung.

Individuelle Vereinbarungen und historische Tabellenzuordnungen können nicht aus der Tarifauswahl allein abgeleitet werden. Deren Fehlen bleibt ein fachlicher Prüfpunkt und wird nicht durch eine Schätzung ersetzt.

## Stand dieser Preview

Die Erfassung aller drei Dienstformen, gemeinsame Vorlagen, SQLite-Migration 35, Backup 22 einschließlich älterer Backups, privater Cloud-Import, Zeitprojektionen, Kalender-/Widgetdaten und Berichte sind integriert. Einsätze bleiben minutengenau; Vorlagen übernehmen keine tatsächlichen Einsätze. Geteilte Dienste erhalten getrennte Zeitintervalle auch für Zuschläge und Netto-Prognosen. Die Teilung allein erzeugt keine tarifliche Schichtzulage. Bei fehlender Bereitschaftsgrundlage und noch offenen Einsätzen bleibt die vollständige Gehaltsschätzung offen. Bereitschafts-Zeitgutschriften werden zunächst getrennt ausgewiesen; die Saldenanbindung folgt in F3. Bestätigte Rufbereitschaft ohne Einsatz und ohne Freizeitumwandlung ergibt null zusätzliche Arbeitszeit. Der Arbeitszeithinweis unterscheidet erfasste Einsätze und unbestätigte arbeitsrechtliche Einordnung.

**Paket F ist noch nicht vollständig implementiert:** F1 und F2a berechnen Rufbereitschaftspauschalen sowie Grundentgelt und Überstundenzuschläge erfasster Einsätze. F2b ergänzt Bereitschaftsdienstentgelte und vereinbarte Freizeitausgleichszeiten auf Grundlage ausdrücklich erfasster Angaben und eigener datierter Tabellen. Bestätigte gewöhnliche Tagdienste können vollständig in Brutto und Netto einfließen. Individuelle Zuordnungen, Monatsnummern und FZA-Verfahren werden nicht automatisch erfunden. Bei auszuzahlenden Nacht-/Sonn-/Feiertagsanteilen bleibt die SFN-/Netto-Behandlung offen; vorgesehene Zeitgutschriften werden noch nicht auf das Zeitkonto gebucht. Diese offenen Punkte gehören zu F3.

Die Referenzfälle unterscheiden TVöD BT-K, BT-B (auch E-Tabelle), TV-L §43, TV-H §43 und TV-UK. TVAöD folgt dem Arbeitgeberbereich; TVA-L erfordert die ausdrückliche §43-Zuordnung. Unbekannte Bereiche werden nicht automatisch gleichgesetzt. Quellen: [TVöD AT §8](https://vka.de/wp-content/uploads/2026/04/250406_TVoeD_Pflege_u_Betreuungseinrichtungen.pdf), [BT-K §§45–46](https://vka.de/wp-content/uploads/2026/04/BT-K_AETV_15_Lesefassung_Stand-01_01_2026.pdf), [BT-B §§45–46](https://vka.de/wp-content/uploads/2026/04/BT-B_AETV_19_Lesefassung_Stand-01_01_2026.pdf), [TV-L §8/§43](https://www.tdl-online.de/fileadmin/downloads/TV-L/260812_TV-L__i.d.F._des_%C3%84TV_Nr._14_VT_neu.pdf), [TV-H §8/§43](https://innen.hessen.de/sites/innen.hessen.de/files/2023-01/tv-h_fassung_aendtv_nr._20_vom_15.10.2021.pdf), [TV-UK §12](https://agu-uniklinika.de/wp-content/uploads/2025/07/01_TV-UK_durchgeschrieben-Fassung-Ae9-vom-03.07.2024.pdf).

Weitere Abnahmegrenzen: Bei der Zeitumstellung nicht eindeutige Eingabezeiten werden mit Korrekturhinweis abgelehnt. Wege werden als unmittelbar vor/nach dem Einsatz liegende Minuten erfasst; unterbrochene Wege benötigen eine spätere Erweiterung. Überstunden am ersten Teil bleiben erhalten, eine gesonderte Überstundenverteilung auf weitere Teile ist offen. Mehrtägige Rufbereitschaft ist bis 14 Tage erfassbar; deren Vergütungsaufteilung ist nicht aktiviert. Die Erfassung wurde inzwischen auf dem iPhone bestätigt; neue Berechnungsschritte benötigen ihre eigene Geräteprüfung.

## Fortsetzung: Abrechnung in getrennten Paketen

F1 verbindet die Rufbereitschaftspauschale mit den datierten Stundenentgelten aller sieben auswählbaren Tarifmodelle. Bei ausdrücklich abgeschlossener Rufbereitschaft ohne Einsatz kann dieser vollständig berechnete Fall in Brutto und Netto einfließen. Unbestätigte Einsätze, Einsatzvergütung, mehrtägige Pauschalen und Bereitschaftsdienste bleiben als konkrete offene Positionen erkennbar. Bekannte Teilbeträge werden getrennt angezeigt und nicht als vollständige Abrechnung ausgegeben.

F2 ergänzt Einsatzvergütung und Bereitschaftsdienst einschließlich eigener Tabellen/Zuordnungen und Freizeitausgleich. F3 verbindet deren Zuschläge mit der SFN-/Netto-Prüfung und den Zeitkonten. Diese Pakete werden nicht durch pauschale Schätzungen ersetzt.

Plattform: iOS Preview, Expo 57. F1-Dateiscope: vorhandene Tarifrechner (zusätzliche Stundenentgelt-Schnittstellen), neue Abrechnungstypen/-engine, Monatsgehalt/Netto-Summen, Zeitkonto-Hinweise, Gehaltsdetailkarte und gezielte Tests. Keine native Änderung, keine neue Persistenzstruktur. Abnahme: 12-Stunden-Grenze, regionale Feiertage, Teilzeit ohne doppelte Kürzung, Tabellenwechsel, TV-UK-Überstundensatz, alle sieben Tarife, keinerlei steuerfreie Behandlung der bloßen Rufbereitschaft und kein vollständiges Ergebnis bei offenen Positionen.

F1 verwendet die bestehenden datierten Entgelttabellen ohne erneute Teilzeitkürzung. Die TV-UK-Pauschale umfasst den Überstundenzuschlag nach §§ 11/12. Bei TVA-L bleibt die ausdrückliche Zuordnung zum Arbeitgeberbereich §43 erforderlich. Eine geschlossene Rufbereitschaft ohne Einsatz erzeugt keine Arbeitszeit; abweichend vereinbarter Freizeitausgleich bleibt offen. Unter zwölf Stunden gelten tatsächliche Stunden (TVöD) beziehungsweise angefangene Stunden (TV-L/TV-H). Pauschalen werden als eigene Bruttokomponente und im PDF dargestellt; der reine Dienstplan-CSV enthält weiterhin keine Gehaltsbeträge. Die vorhandene SFN-Engine behandelt die Pauschale nicht als steuerfreien Zeitzuschlag.

Steuerquelle: [LStH 2026 §3b](https://ao.bundesfinanzministerium.de/lsth/2026/A-Einkommensteuergesetz/II-Einkommen-2-24b/2-Steuerfreie-Einnahmen-3-3c/Paragraf-3b/inhalt.html), ergänzend [LfF-Lohnartenschlüssel 2026, Rufbereitschaftspauschalen](https://www.lff.bayern/media/apjbgspt/2026_04_01_lohnartenschluessel_tv_l_neues-layout.pdf). Ausbildungsgrundlage: TVAöD Pflege §8a und TVA-L Pflege §8 Abs.4.

## Fortsetzung F2a: erfasste Rufbereitschaftseinsätze

Ziel: Grundentgelt und Überstundenzuschlag für erfasste Einsätze zusätzlich zur Pauschale berechnen. Tatsächliche Arbeitsminuten und bezahlte, tariflich gerundete Minuten getrennt zeigen. Weiterhin iOS Preview/Expo 57; bestehende Gehaltskarte, keine neue Eingabestruktur und keine native Änderung.

Arbeitspakete: (1) datierte Überstundensätze der sieben Tarifmodelle und Rundungsfälle, (2) Anbindung an Gehalt/Netto und bestehende Detailkarte/PDF, (3) Referenzfälle, vollständige Prüfung und Preview-Auslieferung. Dateiscope: zusätzliche Schnittstellen in den Tarifrechnern, domain/special-duty-pay, engine/special-duty-callout-pay und -overtime-rate, special-duty-pay/simple-pay, Gehaltskarte/-zusammensetzung, Berichtsbeschriftungen und Tests.

Abnahme: Vor-Ort-Einsätze einzeln mit Wegen runden; Telefonarbeit zusammenfassen; TV-L/TV-H auf volle halbe Stunden, TVöD auf volle Stunden; TV-UK-Dreistundengarantie nur einmal beim kürzesten auswärtigen Einsatz. Grundentgelt mit tariflicher Stufengrenze und Zuschlag mit eigener Bezugsstufe berechnen. Keine doppelte Teilzeitkürzung und keine fiktiven Arbeitsminuten durch Rundung. Bestätigte Tageseinsätze an gewöhnlichen Werktagen ohne weitere Zeitzuschläge können vollständig in die Netto-Prognose einfließen. Bei Nacht-/Wochenend-/Feiertagseinsätzen bleiben zusätzliche Zeitzuschläge und deren SFN-Behandlung ausdrücklich offen; bekannte Einsatzgrundbeträge werden separat gezeigt. Pausen, Tarifwechsel innerhalb eines Einsatzes, mehrtägige Dienste, Monatsgrenzen und Freizeitumwandlung werden nicht durch Annahmen vervollständigt.

F2b (Bereitschaftsdiensttabellen, individuelle Zuordnungen und Freizeitausgleich) und F3 (vollständige Zeitzuschläge/SFN und Zeitkonten) bleiben eigenständige Pakete. Die bisherige Preview ist technisch ausgeliefert; eine Geräteabnahme wird aus „weiter“ nicht abgeleitet.

### Separates Auslieferungspaket: Decoder-Sicherheitskorrektur

Am 29.10.2026 blockiert die CI mit GHSA-qr28-fpjm-wq7f (CVE-2026-118664).
Der bisherige Backport beseitigt die neue quadratische Ersetzungsschleife noch nicht.
Ziel: offiziellen Single-Pass-Fix aus Commit fad01d65b93bd3f2f0dc32dfd8d57a38b57bc608
CommonJS-kompatibel übernehmen; bestehende Plus-Behandlung erhalten.
Dateiscope: Decoder-Manifest, Verifier und Tests sowie Produktionsaudit und dessen Tests.
Keine SDK-, native, UI- oder Tarifänderungen. Ziel bleibt die iOS-Preview-Runtime.
Abnahme: begrenzte Laufzeit über den echten Expo-Query-Parser, Unicode-/Fallback-Regression,
Manipulationsschutz, exakte Audit-Identität, verify:fast, PR-CI und neuer iOS-Export.
Der Audit-Nachweis benötigt die tatsächlich installierte, erneut per Hash geprüfte Datei.
Quelle: https://github.com/advisories/GHSA-qr28-fpjm-wq7f

## Fortsetzung F2b: Bereitschaftsdienst und vereinbarter Zeitausgleich

Ziel: datierte Bereitschaftsdienstentgelte und tarifliche Bewertungszeiten mit einer ausdrücklich erfassten Abrechnungsgrundlage verbinden. Die bekannten Felder Stufe/Abgeltung bleiben bestehen; zusätzliche Angaben erscheinen gesammelt unter Abrechnung und können mit der Vorlage gespeichert werden. Zielplattform: iOS Preview, Expo SDK 57 (~57.0.31).

Getrennte Arbeitspakete: (1) versionierte Abrechnungsgrundlage im vorhandenen JSON, sichere Validierung und Backup-/Cloud-Kompatibilität; (2) eigene datierte Anlagen G/E/D, Bewertung, Geld-/Zeitprojektion und Referenztests; (3) bedarfsabhängige Editorfelder, bestehende Gehaltskarte und Berichte; (4) Gesamtprüfung, unveränderte native Runtime und Preview-Integration. Mehr als 15 Dateien werden erwartet; die Pakete werden nacheinander geprüft.

Nicht-Ziele: automatische Erfindung historischer Eingruppierungen, individuelle Sondervereinbarungen, automatische Buchung oder Bewilligung von Freizeitausgleich, Production/TestFlight. SFN-Einordnung und endgültige Zeitkontenbuchungen bleiben F3.

Dateiscope: domain/special-duty und neue standby-agreement-Typen; vorhandene JSON-Persistenz/Backup-/Cloud-Validatoren; engine/special-duty-pay und neue standby-Tabellen/-engine; Editor- und Gehaltsdetailfelder, Berichtsbeschriftungen sowie deren gezielte Tests. Keine neue native Abhängigkeit oder SQL-Spalte.

Abnahme: alte Dienste unverändert öffnen; neue Grundlage in SQLite, Vorlage, Backup und Cloud erhalten; frühere Apps erhalten für neue Angaben eine neue Backup-Version. Ohne Zuordnung kein fiktiver Nullbetrag. TVöD-P/TVöD-E verwenden getrennte BT-K-/BT-B-Tabellen; TV-L/TV-H erhalten ausdrücklich gewählte alte Bereitschaftsgruppen. Monatsnummer, Regelfall/Sonderfall und FZA-Verfahren nicht schätzen. Teilzeit kürzt Stundenentgelte nicht doppelt. Tatsächliche Arbeitszeit, tariflich gewertete Zeit, Auszahlung und vorgesehene Freizeit getrennt halten. Zeitumstellung, Pausen, Tarif-/Tabellenwechsel und offene Zuschläge prüfen. Vor Veröffentlichung aktuelle Preview einschließlich unabhängiger Änderungen erhalten.

Quellen: BT-K §§45–46 und Anlage G, BT-B §§45–46 und Anlage G (VKA, Stand 01.01.2026); TV-L §43 Nr.5 und Anlage E (TdL, Anlage ab 01.11.2025); TV-H §43 Nr.5 und Anlage D (Hessen, Besitzstände 01.08.2025/01.07.2026); TV-UK §§11–13; TVAöD-Pflege §8a, TVA-L-Pflege §8 Abs.4. Bereitschaftsdienstentgelt ist eine eigene Grundlage, nicht das reguläre Stundenentgelt.

Die bisherige Erfassung aller drei Dienstformen wurde vom Nutzer auf dem iPhone als verständlich und funktionierend bestätigt. Die zusätzliche Einsatzvergütung ist als OTA c795543b-6a1e-4ff6-b800-1038695d203c technisch geprüft; ihre neue Geräteprüfung wird aus dem Fortsetzungsauftrag nicht abgeleitet.
