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

Die Erfassung aller drei Dienstformen, gemeinsame Vorlagen, SQLite-Migration 35, Backup 22 einschließlich älterer Backups, privater Cloud-Import, Zeitprojektionen, Kalender-/Widgetdaten und Berichte sind integriert. Einsätze bleiben minutengenau; Vorlagen übernehmen keine tatsächlichen Einsätze. Geteilte Dienste erhalten getrennte Zeitintervalle auch für Zuschläge und Netto-Prognosen. Die Teilung allein erzeugt keine tarifliche Schichtzulage. Bei Bereitschaften bleiben Saldo und vollständige Gehaltsschätzung ausdrücklich offen. Der Arbeitszeithinweis unterscheidet erfasste Einsätze und unbestätigte arbeitsrechtliche Einordnung.

**Paket F ist noch nicht vollständig implementiert:** Die tariflichen Normalfall-Faktoren und Rundungen sind als isolierte, getestete Referenzfunktionen vorhanden. Es gibt noch keine automatische Auszahlung für Rufbereitschaft oder Bereitschaftsdienst. Hierfür fehlen die vollständige Anbindung der Bereitschaftstabellen, datierte individuelle Zuordnungen, Sonderfälle, Zuschläge/Freizeitausgleich sowie SFN- und Netto-Referenzfälle. Die Eingabe einer Stufe aktiviert deshalb keine Geldberechnung. Dies ist eine Erfassungs-Preview, keine vollständige Umsetzung aller Arbeitspakete des Rechercheplans.

Die Referenzfälle unterscheiden TVöD BT-K, BT-B (auch E-Tabelle), TV-L §43, TV-H §43 und TV-UK. TVAöD folgt dem Arbeitgeberbereich; TVA-L erfordert die ausdrückliche §43-Zuordnung. Unbekannte Bereiche werden nicht automatisch gleichgesetzt. Quellen: [TVöD AT §8](https://vka.de/wp-content/uploads/2026/04/250406_TVoeD_Pflege_u_Betreuungseinrichtungen.pdf), [BT-K §§45–46](https://vka.de/wp-content/uploads/2026/04/BT-K_AETV_15_Lesefassung_Stand-01_01_2026.pdf), [BT-B §§45–46](https://vka.de/wp-content/uploads/2026/04/BT-B_AETV_19_Lesefassung_Stand-01_01_2026.pdf), [TV-L §8/§43](https://www.tdl-online.de/fileadmin/downloads/TV-L/260812_TV-L__i.d.F._des_%C3%84TV_Nr._14_VT_neu.pdf), [TV-H §8/§43](https://innen.hessen.de/sites/innen.hessen.de/files/2023-01/tv-h_fassung_aendtv_nr._20_vom_15.10.2021.pdf), [TV-UK §12](https://agu-uniklinika.de/wp-content/uploads/2025/07/01_TV-UK_durchgeschrieben-Fassung-Ae9-vom-03.07.2024.pdf).

Weitere Abnahmegrenzen: Bei der Zeitumstellung nicht eindeutige Eingabezeiten werden mit Korrekturhinweis abgelehnt. Wege werden als unmittelbar vor/nach dem Einsatz liegende Minuten erfasst; unterbrochene Wege benötigen eine spätere Erweiterung. Überstunden am ersten Teil bleiben erhalten, eine gesonderte Überstundenverteilung auf weitere Teile ist offen. Mehrtägige Rufbereitschaft ist bis 14 Tage erfassbar; deren Vergütungsaufteilung ist nicht aktiviert. Die erste echte iPhone-Abnahme steht aus.
