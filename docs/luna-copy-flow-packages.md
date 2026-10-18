# LUNA: Texte und Eintragewege

Freigabe vom 15.10.2026: Verbesserungen in kleinen Paketen umsetzen. Zuerst falsche Aussagen und unterschiedliche Eintragewirkungen, danach Texte kürzen. Kein Commit, Push, Build oder OTA.

## Task-Vertrag

- Ziel: konkrete belegte Widersprüche aus dem Textreview korrigieren; dieselbe Eintrageabsicht erhält dieselbe Wirkung; anschließend kurze, freundliche Du-Texte.
- Nicht-Ziele: neue Funktionen, neue Abhängigkeiten, Datenmigrationen, geänderte Tarif- oder Rechtsregeln, native Konfiguration, Veröffentlichung.
- Zielplattform: iPhone; Referenz des Nutzers ist TestFlight Build 5, OTA-Stand und Gerät noch unbekannt.
- Basis: origin/master `84d23045a3525eddee4827f1daa82b806b734dbe`, isolierter Branch `codex/luna-copy-flows`.
- Dateiscope: je Paket höchstens 15 Dateien einschließlich Tests; keine unabhängigen Checkoutänderungen übernehmen.
- Abnahme: fokussierte Verhaltenstests, `npm.cmd run verify:fast`, Scope- und Diffprüfung. iPhone-Screenshots, VoiceOver, Gesten und Zwei-iPhone-Verhalten sind separate offene Abnahme.
- Keine erneute Freigabe vor der Implementierung notwendig: der Reviewplan wurde ausdrücklich zur Umsetzung freigegeben. Commit und sämtliche Veröffentlichungsschritte bleiben ausgeschlossen.

## Reihenfolge

### P1: Sharing-Aussagen und Aktionen

Scope: Sharingübersicht, Einladungsannahme/-versand/-verwaltung, kurze Informationstexte und zugehörige Komponententests; höchstens 15 Dateien.

Akzeptanz: Notizrechte stimmen mit dem Datenschutzhinweis überein; eine Einladung verspricht keine falsche Bestätigung; Onlineübertragung wird vor dem Erstellen klar; PENDING und ACTIVE sind unterscheidbar; destruktive Aktionen nennen ihre Wirkung. Authentifizierung, Rechte und Backend bleiben unverändert.

### P2: Eintragen und Vorlage bearbeiten

Scope: Kalenderauswahl, Quick Add, zugehörige Speicher-/Vorlagenlogik und Verhaltenstests; höchstens 15 Dateien.

Akzeptanz: normale Auswahl entfernt keinen vorhandenen Dienst; beide Einstiege verhalten sich konsistent; Vorlagenbearbeitung erzeugt keinen zusätzlichen Kalendereintrag; eine kombinierte Erstellung/Eintragung ist ausdrücklich benannt. Der erkennbare Planungsmodus darf seine Umschaltfunktion behalten.

### P3: PDF und App mit gleicher Bedeutung

Scope: Berichtsdaten/-ansicht/-PDF, Exportoptionen und zugehörige Tests; höchstens 15 Dateien.

Akzeptanz: fehlende Prüfgrundlagen werden nicht als Befunde mitgezählt; Planungsumfang ist nachvollziehbar; Netto 2027 behält Vorläufigkeit, Regelstand und angemessene Genauigkeit. Keine Änderungen an der Gehaltsrechnung.

### P4: Passender Weg bei fehlenden Nettoangaben

Scope: automatische Nettoprognose, Ergebnis-/Fehlerdaten, Nettoaktionskarte und zugehörige Tests; höchstens 15 Dateien.

Akzeptanz: fehlende Dienstzeiten führen zum betroffenen Dienst, Gehalts-/Steuerangaben zur passenden Einstellung; technische Fehler behaupten keine vom Nutzer lösbare Ursache.

### P5: Kurze Texte in Kalender, Editor und Vorlagen

Scope: Dienst-/Vorlagennamen, Speicheraktion, Erinnerungsbezug, Überstundeneinheit und Ortssuche; bei mehr als 15 Dateien weiter teilen.

Akzeptanz: sichtbare Beschriftung und Bedienhilfe versprechen dieselbe Wirkung; Beginn und Ende sind korrekt; eine normale Mitteilung heißt nicht Wecker; keine persönlichen Titel neu auf dem Sperrbildschirm.

### P6: Kurze Texte in Auswertung und Gehalt

Scope: Lade-/Leerzustände, Teiljahressummen, Nettohilfen und Schichtzulage; bei mehr als 15 Dateien weiter teilen.

Akzeptanz: generische Wiederholungen entfallen, technische Begriffe werden verständlich, fachliche Grenzen bleiben erhalten. Regex-abhängige Meldungen bleiben unverändert oder werden gesondert mit Verhaltenstests abgesichert.

### P7: Kurze Texte in Einstellungen und Backup

Scope: Informationstexte, Reset, Datensicherung und gemeinsame Fehlertexte; höchstens 15 Dateien.

Akzeptanz: kürzere Einstiege, konkrete Folgen; unverschlüsselte Sicherungen, Datenersatz, Aufbewahrung und Freigabeumfang bleiben klar. Kein falscher Speichernachweis nach Schließen des Systemdialogs.

### P8a: Einheitliche Navigation und Berufsbezeichnung

Scope: beide Tabvarianten, Vorlagen-Routentitel und Onboardingzusammenfassung; fünf Quelldateien.

Akzeptanz: wiederverwendbare Dienstvorlagen heißen in beiden Tabvarianten „Vorlagen“, im Editor „Dienstvorlage“; der Berufsbereich trägt überall denselben Namen. Keine Routen oder Onboardingschritte ändern.

### P8b: Verständliche Prüfungsangaben

Scope: Arbeitsprofil, Profileditor, Einstellungsübersicht, Prüfungseinstellungen und deren Routentitel; fünf Quelldateien und betroffene bestehende Tests, insgesamt höchstens 15 Dateien.

Akzeptanz: dieselben Angaben heißen „Angaben zur Prüfung“; Fragen bleiben fachlich gleich und verständlich, unbekannte Antworten bleiben unbekannt. Die Einstellung benennt sowohl Prüfung als auch Planungshinweise. Keine Formulare zusammenlegen und keine Prüfregeln ändern.

### P9: Offene Prüfungsangaben und Berechnungsfehler

Scope: Meldungen zu fehlenden Prüfungsangaben, automatische Nettoprognose und betroffene bestehende Testfixtures; höchstens fünf Dateien.

Akzeptanz: fehlende Angaben werden als konkrete Fragen formuliert; Nebenjobs und Grenzen der Prüfung bleiben ausdrücklich genannt. Ein technischer Zuschlagsfehler beschreibt die Auswirkung. Klassifizierung und Zielaktionen verwenden weiterhin dieselben Regelkennungen; keine Rechts-, Gehalts- oder Regex-Logik ändern.

### P10: Speichern mit passendem Symbol

Scope: gemeinsamer Sheet-Footer und Eintrageditor; zwei Dateien.

Akzeptanz: neben „Speichern“ steht ein Häkchen. Andere Footer behalten ihre bisherigen Symbole; Speichern, Gesten und Abbrechen ändern ihr Verhalten nicht.

### P11: Architekturgrenze des Vorlageneditors einhalten

Scope: Vorlageneditor und ein ausgelagerter darstellender Baustein; höchstens drei Dateien.

Akzeptanz: der Editor bleibt unter seinem unveränderten Dateibudget von 839 Zeilen. Darstellung, Eingaben und Speicherverhalten bleiben gleich; bestehende Editor- und Architekturtests bestehen. Keine Budgeterhöhung oder Zeilenkomprimierung.

### P12–P14: freigegebene Ablaufvereinfachungen

Die nächste Freigabe umfasst einen gemeinsamen Editor für die Prüfungsangaben (P12 / OS-10), eine Einladungsaktion in der Übersicht (P13 / OS-08) und einen Bearbeitungsweg pro Vorlage in der Verwaltung (P14 / CE-11). Task-Vertrag, Dateiscope, Abnahmekriterien und Nachweise stehen in [den drei Ablaufpaketen](luna-next-flow-packages.md).

### P15–P17: Meldungsdarstellung und kurze Informationsseiten

Die folgende Freigabe umfasst strukturierte Darstellungsfakten für Kurzfassungen und Dienstfolgen (P15 / AS-14), kurze Informationsübersichten mit aufklappbaren Details (P16 / OS-13) und die Prüfung der Tarifhilfen (P17 / TX-01). P15 und P16 sind umgesetzt. Der ursprüngliche TX-01-Befund ist überholt: Seine langen Quelltexte haben keinen produktiven Anzeigeweg; die tatsächliche Auswahl ist bereits kurz. P17 enthält deshalb gezielte Regressionen und eine Befundkorrektur ohne zusätzliche Produktänderung. Vertrag, Scope und Nachweise stehen in [den Textpaketen](luna-text-slimming-packages.md).

### P18–P20: Gehaltswege, Einstieg und neutrale Erinnerungen

P18 / AS-11 bündelt Gehaltsdetails und erhält Betragsshortcuts, Fallbacks und alte Links. P19 / OS-11 integriert die Begrüßung in die erste Eingabe und erhält vier Seiten mit aufschiebbarem Gehalt und gezielten Korrekturen. P20 / CE-09 verwendet neutrale Erinnerungstexte ohne persönliche Titel, Orte oder Notizen. Der zusätzliche Nachtende-/Vortagsfehler ist in P20b separat korrigiert; P20a enthält die Inhaltsänderung. [Vertrag und vollständige Nachweise](luna-final-flow-packages.md).

### P21–P25: zweite Textüberarbeitung

Die weiteren 30 freigegebenen Reviewpunkte mit 38 Tabellen-IDs sind in zehn kleinen Paketen umgesetzt. T028 heißt ausdrücklich wieder **Wecker**, aktiv **Zum Dienstbeginn**. Eindeutige Netto-Angaben, klare Nicht-berechenbar-Zustände, kürzere Einstiege und weniger Wiederholungen sind integriert; Datenschutzaussagen und geschützte Warnungen bleiben erhalten. [Vertrag, Paketübersicht und vollständige Nachweise](luna-copy-round-two.md).

Der gemeinsame Abschlusslauf ist am 16.10.2026, 00:12 mit Exitstatus 0 bestanden: 8.832 Unit-Tests, 1.178 Komponententests, alle 13 Skriptgruppen sowie Regeln, Typecheck, Lint, Format und Diffprüfung. Alle 129 geänderten/neuen Dateien waren während des erfolgreichen Laufs hashgleich. Danach wurden nur die beiden Berichte ergänzt. Die iPhone-Abnahme steht aus; kein Commit, Push, Build oder OTA.

## Geräteabhängige Ablaufideen

Die ausdrücklich freigegebenen Vereinfachungen bis P25 sind im Code umgesetzt. Ihre iPhone-Abnahme bleibt offen: Orientierung, Rückwege, große Schrift, VoiceOver und echte Benachrichtigungszustellung sind am geänderten Teststand zu prüfen. Weitere Zusammenlegungen oder das Entfernen weiterer Shortcuts benötigen eine eigene Entscheidung anhand realer Aufgaben.

## Nachweise

Die erste Überarbeitung bis P20 ist in 25 getrennte Pakete mit jeweils höchstens 15 Dateien einschließlich Tests gegliedert. Die zweite Textüberarbeitung P21–P25 ergänzt zehn weitere kleine Pakete; ihre Nachweise stehen im verlinkten Bericht. P17 ist eine Prüfung mit Befundkorrektur ohne Produktdateiänderung; P20 ist in Inhalt und Zeitkorrektur getrennt. Gemeinsame Dateien können nacheinander in mehreren Paketen vorkommen.

| Paket | Dateien | Ergebnis                                                                                               |
| ----- | ------: | ------------------------------------------------------------------------------------------------------ |
| P1    |       8 | Korrekte Sharingaussagen, Rechtezustände und Abschlussaktionen                                         |
| P2    |      10 | Konsistente Eintragung, unabhängige Vorlagenbearbeitung, sichere Wiederholung nach Teilfehler          |
| P3    |       6 | Fehlende Prüfgrundlagen separat; PDF-Prognosestand und Rundung wie in der App                          |
| P4    |       5 | Ursachebezogene Netto-Reparaturwege; kein irreführender Einstellungsweg bei technischen Fehlern        |
| P5a   |      15 | Dienst-/Vorlagenbegriffe, sichtbares Speichern, Überstunden in Minuten und tarifliche Bestätigung      |
| P5b   |      13 | Kurze Erinnerungstexte, korrekter Ende-Bezug und freie Ortseingabe                                     |
| P6a1  |      14 | Verständliche Auswertung, ausdrücklich benannte Brutto-Teilsummen und Kalenderaktion im Leerzustand    |
| P6a2  |       2 | Kurzer Hinweis auf fehlende Zeitgutschriften mit Dynamic-Type-Prüfung                                  |
| P6b   |      12 | Weniger Abkürzungen; verständliche Nettohilfen und Testdatenhinweise                                   |
| P7    |      13 | Backup-/Resetfolgen und Datenschutz erhalten; Diagnosecodes bei Bedarf aufklappbar                     |
| P8a   |       5 | Konsistente Navigation und Berufsbezeichnung                                                           |
| P8b   |       6 | Einheitliche Prüfungsangaben mit ausdrücklichem Nebenjobbezug                                          |
| P9    |       4 | Konkrete Fragen zu fehlenden Angaben und verständlicher Zuschlagsfehler                                |
| P10   |       2 | Passendes Häkchen neben Speichern                                                                      |
| P11   |       2 | Darstellenden Baustein auslagern und unveränderte Architekturgrenze einhalten                          |
| P12   |       7 | Gemeinsamer Frageneditor, Entwurfsschutz und sichere einmalige Speicherung/Navigation                  |
| P13   |       3 | Eine Einladungsaktion in der Übersicht; erste und weitere Einladungen bleiben möglich                  |
| P14   |       4 | Ein Bearbeitungsweg in der Verwaltung; Kalenderauswahl behält Eintragen und Bearbeiten                 |
| P15   |      13 | Kurzfassungen und Dienstfolgen verwenden strukturierte Fakten; sichere Behandlung alter Ergebnisse     |
| P16   |       3 | Kurze Informationsübersichten mit aufklappbaren Details; bisherige Aussagen bleiben erreichbar         |
| P17   |       0 | Überholte Tarifreferenz korrigiert; tatsächliche Auswahl und Hinweiswege mit bestehenden Tests geprüft |
| P18   |       7 | Gehaltswege gebündelt; Betragsshortcuts, Fallbacks, alte Links und acht Tarif-/Monatswege erhalten     |
| P19   |       2 | Vierseitiger Einstieg mit allen Korrekturen; Vorschau, Retry und einmaliger Abschluss abgesichert      |
| P20a  |       2 | Neutrale Erinnerungen ohne persönliche Titel, Orte oder Notizen im SDK-Request                         |
| P20b  |       2 | Nachtende und Vortagsabgleich korrigiert; DST-Verträge und optionale Altangaben erhalten               |

Von 46 ursprünglichen Reviewbefunden sind 45 im Code umgesetzt und einer als überholt korrigiert. Keiner ist mehr teilweise umgesetzt oder zurückgestellt. Das bezeichnet den Quellcodestand und die korrigierte Reviewgrundlage, keine iPhone-Abnahme.

Die zuvor zurückgestellten Befunde OS-11, AS-11 und CE-09 sind mit der ausdrücklichen Freigabe für P18–P20 bearbeitet. Erinnerungen enthalten nur neutralen Dienst-/Termin- und Beginn-/Endbezug; persönliche Titel, Orte und Notizen bleiben ausgeschlossen. Die Geräteprüfungen sind weiterhin offen.

Verhaltensänderungen wurden mit betroffenen bestehenden Tests und gezielten Regressionen geprüft. Die neuen Fälle für Eintragen/Mehrfachtippen, Vorlagen-Teilfehler, Freigaben, fehlende Dienstzeiten, Kalenderaktion und Ende-Erinnerung wurden zunächst als Fehler nachgewiesen. Unabhängige Reviews prüften die Pakete; deren konkrete Befunde sind behoben.

Der erste gemeinsame Abschlusslauf für P1–P11 (`npm.cmd run verify:fast`) ist am 15.10.2026 um 19:15 Uhr vollständig bestanden (Exitstatus 0): Regelprüfung, Typecheck, ESLint ohne Warnungen, Prettier, 8.735 Unit-Tests in 450 Dateien, 1.139 Komponententests in 137 Suiten, alle 13 nachfolgenden Skriptprüfungen und Diffprüfung.

Der erste Gesamtlauf fand die Dateigrößengrenze des Vorlageneditors; P11 behebt sie bei unverändertem Grenzwert. Ein weiterer Lauf erkannte, dass die zunächst gemeinsam genutzten Dependencies außerhalb der Arbeitskopie lagen. Sie liegen jetzt physisch lokal vor; Lockfile und Dependency-Versionen wurden nicht geändert. Die Sicherheitsprüfungen wurden vollständig beibehalten. Der App-Quellstand blieb über den erfolgreichen P1–P11-Gesamtlauf in allen 103 geänderten/neuen Dateien unverändert; danach wurde ausschließlich dieser Bericht ergänzt.

Für P12–P14 sind die fokussierten Ablaufprüfungen und unabhängigen Reviews abgeschlossen. Der erste erneute Gesamtlauf bestand alle 8.735 Unit-Tests; drei bestehende Gehaltsformularfälle arbeiteten jedoch nach erfolgreichem Speichern in derselben, in der App bereits geschlossenen Sitzung weiter. Die beiden betroffenen Suiten bestehen mit echten getrennten Sitzungen und unveränderten Payload-/Regionsprüfungen jetzt alle 20 Fälle; auch die unabhängige Nachprüfung ist abgeschlossen.

Der gemeinsame Abschlusslauf für P12–P14 `npm.cmd run verify:fast` ist am 15.10.2026 um 20:59 Uhr vollständig bestanden (Exitstatus 0): Regelprüfung, Typecheck, ESLint ohne Warnungen, Prettier, 8.735 Unit-Tests in 450 Dateien, 1.155 Komponententests in 137 Suiten, alle 13 nachfolgenden Skriptprüfungen und Diffprüfung. Ein unveränderter Kalender-Gestentest hatte im Zwischenlauf einen Timeout und bestand danach isoliert sowie im erfolgreichen Gesamtgate; keine Grenze oder Produktionslogik wurde dafür verändert. Alle 109 geänderten/neuen Dateien blieben über den erfolgreichen Lauf hashgleich; danach wurden nur die beiden Abschlussberichte ergänzt. Einzelheiten stehen in den [Paketnachweisen](luna-next-flow-packages.md).

Der gemeinsame Abschlusslauf nach P15–P17 ist am 15.10.2026 um 21:52 Uhr vollständig bestanden (Exitstatus 0): Regelprüfung, Typecheck, ESLint ohne Warnungen, Prettier, 8.798 Unit-Tests in 450 Dateien, 1.166 Komponententests in 137 Suiten, alle 13 nachfolgenden Skriptprüfungen und Diffprüfung. Die fokussierten Verhaltenstests und unabhängigen Reviews sind ebenfalls abgeschlossen. Alle 122 geänderten/neuen Dateien blieben über diesen Lauf hashgleich; danach wurden nur dieser Bericht und der Bericht P15–P17 ergänzt. Der lokale Graft-Suchindex wurde aktualisiert. Keine Prüfgrenze wurde verändert. Details stehen in den [Textpaketen](luna-text-slimming-packages.md).

Der gemeinsame Abschlusslauf nach P18–P20 ist am 15.10.2026 um 22:53 Uhr vollständig bestanden (Exitstatus 0): Regelprüfung, Typecheck, ESLint ohne Warnungen, Prettier, 8.832 Unit-Tests in 450 Dateien, 1.178 Komponententests in 137 Suiten, alle 13 nachfolgenden Skriptprüfungen und Diffprüfung. Vorherige Gate-Befunde betrafen ein optionales Ganztagsfeld und acht noch auf den alten Direktweg ausgerichtete Integrationstests; beide sind mit unabhängiger Nachprüfung behoben, ohne gelockerte Typregeln, Timeouts oder finanzielle Assertions. Alle 126 geänderten/neuen Dateien blieben im erfolgreichen Lauf hashgleich; danach wurden nur dieser Bericht und der Bericht P18–P20 ergänzt. Nichts ist gestaged, der Basiscommit ist unverändert. Details einschließlich bestehender Zeitgrenzen stehen in den [letzten Ablaufpaketen](luna-final-flow-packages.md).

[Prüfprotokoll P18–P20](C:/Users/veron/.codex/visualizations/2026/10/15/01a14034-a8b5-77b2-b0e1-6cfcd4126913/implementation/P18-P20/verify-fast.log) · [18 iPhone-Fälle P18–P20](C:/Users/veron/.codex/visualizations/2026/10/15/01a14034-a8b5-77b2-b0e1-6cfcd4126913/implementation/P18-P20/iPhone-Abnahme.md).

Die Basissammlung, der Status je Befund, Testprotokolle und die 42 ursprünglichen Gerätefälle liegen außerhalb des App-Quellcodes im Gesprächsordner dieser Unterhaltung. Zusätzlich gibt es konkrete iPhone-Prüflisten für die Änderungen. [Prüfprotokoll P15–P17](C:/Users/veron/.codex/visualizations/2026/10/15/01a14034-a8b5-77b2-b0e1-6cfcd4126913/implementation/P15-P17/verify-fast.log), [Prüfprotokoll P12–P14](C:/Users/veron/.codex/visualizations/2026/10/15/01a14034-a8b5-77b2-b0e1-6cfcd4126913/implementation/next-flows/verify-fast.log), [Prüfprotokoll P1–P11](C:/Users/veron/.codex/visualizations/2026/10/15/01a14034-a8b5-77b2-b0e1-6cfcd4126913/implementation/verify-fast.log), [Status je Befund](C:/Users/veron/.codex/visualizations/2026/10/15/01a14034-a8b5-77b2-b0e1-6cfcd4126913/implementation/befundstatus.csv), [iPhone-Abnahme P1–P11](C:/Users/veron/.codex/visualizations/2026/10/15/01a14034-a8b5-77b2-b0e1-6cfcd4126913/implementation/iPhone-Abnahme-neuer-Stand.md), [iPhone-Abnahme P12–P14](C:/Users/veron/.codex/visualizations/2026/10/15/01a14034-a8b5-77b2-b0e1-6cfcd4126913/implementation/iPhone-Abnahme-P12-P14.md), [iPhone-Abnahme P15–P17](C:/Users/veron/.codex/visualizations/2026/10/15/01a14034-a8b5-77b2-b0e1-6cfcd4126913/implementation/P15-P17/iPhone-Abnahme.md).

Keine Geräteabnahme, kein Commit, Push, Build oder OTA ist erfolgt. Der Stand liegt uncommitted im separaten Worktree `.worktrees/luna-copy-flows`, Branch `codex/luna-copy-flows`; das ursprüngliche Arbeitsverzeichnis und der Sicherheitsreview-Worktree bleiben unberührt.
