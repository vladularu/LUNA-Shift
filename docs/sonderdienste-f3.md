# Sonderdienste F3: Zuschläge, Netto und Zeitkonto

Ziel: Bereitschaftsdienst und Einsätze während der Rufbereitschaft mit ihren gesonderten Zeitzuschlägen in die vorhandene lokale SFN-/Netto-Prognose aufnehmen und bestätigte Zeitgutschriften im geplanten Zeitkonto berücksichtigen. Grundlage bleibt die abgenommene kompakte Gehaltsansicht mit Einzelheiten unter Gehaltsbestandteile → Bereitschaften.

Plattform: iPhone Preview, Expo SDK 57 (~57.0.31), Dokumentation https://docs.expo.dev/versions/v57.0.0/. Branch codex/sonderdienste-sfn-zeitkonto, zunächst von master 4de7875, vor der Git-Lieferung auf master d5304b7 mit dem inzwischen gemergten modernen Diensteditor aktualisiert. Bestehende Freigabe für Implementierung und Preview-OTA; keine TestFlight-/Production-Veröffentlichung in diesem Auftrag.

## Arbeitspakete

1. Vorhandene datierte Tarifrechner und SFN-Klassifikation verbinden: tatsächliche Einsatzzeiträume einschließlich erforderlicher Wege, gesonderte Nacht-/Sonn-/Feiertagszuschläge, steuerpflichtige Pauschalen und Überstunden. Bereitschaftsdienst verwendet für die SFN-Grenzen den regelmäßigen Grundlohn; die tarifliche Bewertung wird nicht als steuerlicher Grundlohn eingesetzt.
2. Zeitkonto als reproduzierbare Projektion der gespeicherten Dienstangaben: tatsächliche Arbeitszeit bleibt für Arbeitsschutz und Anwesenheitsauswertung vollständig erhalten. Auszahlung und Zeitgutschrift werden getrennt behandelt. Idempotenz, Änderung, Löschen/Wiederherstellung, Monatszuordnung und unbekannte Angaben prüfen.
3. Vorhandene Detailansichten und Berichte ergänzen, ohne neue große Gehaltskarten. Ausgewählte Abgeltung verständlich erklären; lokale Gates, vollständige PR-CI, aktuelle gemeinsame Preview erhalten und OTA/Runtime/Bundle technisch prüfen. Anschließend eigene iPhone-Abnahme.
4. Für echte Bereitschaftspausen optional den Beginn erfassen. Sonderdienst-JSON v3, lokale Sicherung v24 und Testdaten-Sicherung v18 sichern die Angabe; ältere Formate bleiben lesbar. Eine neue Angabe darf unter einer älteren Versionskennung nicht unbemerkt verloren gehen. SQLite-Schema 35 und native Integration bleiben unverändert. Speichern, Wiederherstellen, Cloud-Dokumentvalidierung, Vorlagen und Zeitumstellung getrennt prüfen.

Erwartet sind mehr als 15 Dateien über Fachlogik, abgeleitete Typen, Tests und wenige vorhandene Ansichten. Die Pakete werden nacheinander geprüft. Keine native Integration, neue Abhängigkeit oder Buchungstabelle. Die gespeicherten Dienstangaben bleiben die einzige Quelle der Prognose. Cloud-Prüfungen betreffen den lokalen Dokumentvertrag; sie ersetzen keinen Test gegen ein Live-Backend.

## Abnahmekriterien und Grenzen

- Sieben auswählbare Tarifmodelle sowie TVöD BT-B getrennt prüfen; keine Übernahme eines fremden Tarifbereichs.
- Pauschalen, Grundentgelt und Überstundenzuschlag werden nicht zu steuerfreien SFN-Zuschlägen umetikettiert. Die vorhandenen Grenzen für Steuer- und Sozialversicherungsfreiheit bleiben getrennt.
- Zuschläge der Rufbereitschaft verwenden tatsächliche Einsatz-/Wegezeiten; Rundungen der Überstundenvergütung erfinden keine Zuschlagsminuten (BAG 10 AZR 937/13, unter Bezugnahme auf 6 AZR 259/08).
- Bereitschaftsdienst: gesonderte Zuschläge können begünstigt sein, auch bei faktorisierter Grundvergütung. Feiertagsbedingte Erhöhung einer einheitlichen Bewertung ist keine nachträglich erfundene gesonderte SFN-Zahlung.
- Eine nicht zeitlich verortete Pause wird nur projiziert, wenn ihre Lage an der Zuschlags-/Steuerzuordnung nichts ändert. Anderenfalls bleibt die Zuordnung ausdrücklich offen.
- Bestätigter Freizeitausgleich ist eine geplante Zeitgutschrift, keine externe Arbeitgeberbuchung. Keine gleichzeitige Auszahlung und Zeitgutschrift derselben Komponente. Tatsächliche Arbeitszeit bleibt davon getrennt.
- Nicht unterstützte mehrtägige/monatsübergreifende Abrechnungen, fehlende betriebliche Vereinbarungen und unbekannte Grundlagen bleiben offen; keine stillschweigenden Nullbeträge. Geprüfter Regelzeitraum bleibt 2026.
- Neue Pausenangaben benötigen einen aktuellen Client. Ältere Apps sollen eine Sicherung oder einen Cloud-Stand mit diesen Angaben sicher ablehnen, statt Daten zu verlieren.

## Prüfstand

Vor der Aktualisierung der Branch-Basis bestand verify:fast vollständig. Auf dem gemeinsamen Preview-Stand bestanden zusätzlich 350 gezielte Fachtests und 112 UI-Tests in sieben Suites sowie Typprüfung, Lint und Formatierung. Der vorläufige iOS-Export bestätigte die unveränderte interne Runtime b99c3cf0dd56e6b1bb126d195f21c665de57760b (Preview-Build 44).

Nach der Aktualisierung auf den modernen Editor wurde die Monatsübersicht des Jahresberichts ergänzt: auch 337,5 Kontominuten erscheinen dort als 5:37:30 h. Jahresproben bestätigen getrennt 450 erfasste Minuten, 337,5 Kontominuten und einen offenen Saldo bei unbekannter Vereinbarung. Die abschließende Gesamtprüfung und Preview-Auslieferung werden unter artifacts/sonderdienste-f3 dokumentiert. Die neue iPhone-Abnahme steht aus; frühere Abnahmen bestätigen nur den jeweils geprüften Eingabe- bzw. Gehaltsfluss. Keine Live-Supabase-Prüfung und kein nativer Build in diesem Paket.

## Rechtsquellen

- [§3b EStG](https://www.gesetze-im-internet.de/estg/__3b.html) und [§1 SvEV](https://www.gesetze-im-internet.de/svev/__1.html).
- [BFH 11.04.2024 – VI R 1/22](https://www.bundesfinanzhof.de/en/entscheidungen/entscheidungen-online/decision-detail/STRE202410106/): regelmäßiger Grundlohn als SFN-Bezugsgröße auch bei Bereitschaftsdienst.
- [LStH 2026 §3b](https://esth.bundesfinanzministerium.de/lsth/2026/A-Einkommensteuergesetz/II-Einkommen-2-24b/2-Steuerfreie-Einnahmen-3-3c/Paragraf-3b/paragraf-3b.html): gesonderte Zuschläge, Bereitschaft, Reisezeiten und tatsächliche Arbeitsleistung.
- [BAG 10 AZR 937/13](https://www.bundesarbeitsgericht.de/entscheidung/10-azr-937-13/): erforderliche Wegezeiten und tatsächliche Zuschlagszeit, Abgrenzung zu fiktiven Rundungszeiten.
- Datierte Tarifquellen und bestätigte individuelle Bereitschaftsgrundlagen aus [Sonderdienst-Umsetzung](sonderdienste-umsetzung.md), insbesondere TVöD §8/§10 und BT-K/BT-B §§45–46, TV-L/TV-H §8/§43 sowie TV-UK §§11–12. Keine neue ungeprüfte Tariftabelle.
