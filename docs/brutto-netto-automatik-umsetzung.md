# Task-Vertrag: automatische Netto-Prognose

Freigabe: „oke setze um“, 10. Oktober 2026. Umsetzung auf dem vorhandenen Branch `codex/brutto-netto-prototype`; der bereits geprüfte und veröffentlichte Rechnerstand bleibt Ausgangspunkt. Unabhängige Arbeiten im Hauptcheckout werden nicht verändert.

Separate Veröffentlichungsfreigabe: „ota“, 10. Oktober 2026. Die iOS-Preview-OTA der fertigen Automatik wurde veröffentlicht und gegen Build 33 sowie das tatsächlich ausgelieferte Bundle verifiziert. Git-Delivery, neuer nativer Build und Store-Veröffentlichung sind nicht Teil dieser Freigabe.

Ziel: persönliche Netto-Angaben datiert einmal speichern; Gehaltsbestandteile und Zuschläge automatisch übernehmen; denselben Netto-Kern für alle vorhandenen Tarifmodelle verwenden.

Nicht-Ziele: unbekannte Entgeltbestandteile erfinden, unvollständige Tarifentwürfe als vollständige Abrechnung ausgeben, neue native Module, Git-Delivery oder eine weitere Veröffentlichung. Die frühere OTA-Freigabe betraf den damaligen Teststand.

Plattform: iPhone, Expo SDK 57 (`~57.0.22`), lokale SQLCipher-Daten. Die passende SDK-Dokumentation wurde vor Änderungen geprüft. Geräteabnahme und eine etwaige neue Preview-OTA bleiben getrennte Schritte.

## Getrennte Arbeitspakete

1. Profil und Persistenz: versionierte dauerhaft gültige Angaben; bestehende monatliche Profile bewahren; konkurrierende Änderungen und Testlabor sichern. Scope: Netto-Domain, Repository, Profil-Hook und deren Tests.
2. Tarifzeitspuren: Zuschläge an ihre tatsächlich berechneten Intervalle binden, Bruttosummen erhalten. Scope: vorhandene Gehaltsengines und gezielte Tariftests.
3. Gemeinsame Monatsberechnung: Bruttoquellen eindeutig wählen, Grundlohn und Bemessungsgrundlagen ableiten, sämtliche unterstützten Gehaltsmodelle anschließen. Scope: neue Netto-Adapter und Tests.
4. Abrechnungsbestandteile: Ausbildung und belegte Zusatzversorgungsmodelle berücksichtigen; weitere Fälle gezielt kennzeichnen. Scope: Netto-Kern, Zusatzversorgung und Referenztests.
5. Bedienung: automatische Prognose in der Gehaltskarte, einmalige Einrichtung, datierte Änderungen und gezielte Ergänzungsaktionen. Scope: Netto- und Gehaltskomponenten, Navigation und Komponententests.
6. Prüfung: `verify:fast`, fokussierte Tests, Quellen-/Referenzabgleich und dokumentierte verbleibende Grenzen. Reale iPhone-Abnahme folgt auf dem Zielgerät.

Abnahme: ohne wiederholte Bruttoeingabe aktuelle Netto-Prognose; nachvollziehbare Summen und steuer-/SV-freie Zuschläge; fortgeltende persönliche Angaben mit historischer Monatsbindung; keine Zahl aus unbekannten Teilsummen; Bestandstests, Backup und lokale Speicherung bestehen.

## Fortschritt

- Arbeitspakete 1–6 lokal abgeschlossen: fachliche und UI-Prüfungen, vollständiges `verify:fast` und iOS-Bundle bestanden. Die tatsächliche Geräteabnahme ist noch offen.

## Umgesetztes Verhalten

- Die Gehaltskarte zeigt das geschätzte Netto automatisch. Ohne gespeichertes Profil führt **Netto einmal einrichten** zur einmaligen Einrichtung. Es müssen keine Brutto-, Steuerbrutto-, SV-Brutto- oder SFN-Stundensätze abgeschrieben werden.
- Die persönlichen Angaben gelten ab dem gewählten Monat für Folgemonate. Eine spätere Änderung beginnt am ausgewählten Monat; frühere Monate behalten ihre Quelle. Alte monatliche Profile bleiben ausdrücklich monatlich und werden erst durch bewusstes Speichern auf das fortlaufende Modell umgestellt.
- Die vorhandenen acht wählbaren Gehaltsmodelle sind angeschlossen: TVöD-P, TVöD E, TV-L/KR, TV-H/KR, TV-UK, TVAöD Pflege, TVA-L Pflege und ein festes manuelles Monatsgehalt. Beim manuellen Monatsgehalt werden ohne Tarifregeln keine zusätzlichen Dienstzuschläge erfunden.
- Die Bruttoquelle bleibt die vorhandene Gehaltsberechnung. Der Netto-Adapter prüft ihre Bestandteile, Schichtauswertungen und Zuschlagssummen gegen die zusätzlich erzeugten Zeitintervalle. Ändern sich Kalender, Arbeitsprofil, Tarifentscheidungen oder Regelkatalog, wird das Ergebnis neu berechnet.
- Bezahlte Pausen werden im Bargeld-Brutto erhalten, bei der SFN-Arbeit aber ausgeschlossen. Ihre Zuschläge bleiben steuerpflichtig. Nacht-/Tageszuschläge werden nach der vorhandenen gesetzlichen Klassifikation getrennt steuerfrei und SV-frei behandelt; Samstags-/Überstunden- und pauschale Schichtzulagen werden nicht allein aufgrund ihrer Bezeichnung befreit.
- Der automatische SFN-Grundlohn basiert auf festen laufenden Bezügen und vertraglichen Wochenstunden mit dem Faktor 4,35. Variable, nicht vorab bekannte Stunden-Zulagen erhöhen diesen Grundlohn nicht automatisch. Das regelmäßige SV-Einkommen wird von tatsächlichen variablen Zuschlägen des Monats getrennt.
- Reguläre Pflegeausbildung über 325 Euro ist im gemeinsamen Kern berücksichtigt. VBL West, VBL Ost und KZVK Köln verändern Arbeitnehmerabzug, Steuerbrutto und SV-Brutto nach ihrem jeweiligen Modell; weitere monatliche Netto-Abzüge sind optional erfassbar.
- Speicherung bleibt lokal in der vorhandenen SQLCipher-Tabelle. Backup v20 erhält auch fortlaufende Profile. Ein Versionswechsel der Tabellenstruktur ist dafür nicht nötig. Schreibkonflikte werden gegen die gesamte geladene Profilhistorie geprüft; aktive betroffene Testlabor-Monate sperren das Speichern.

## Fachliche und technische Grenzen

Der Stand berechnet reguläres laufendes Monatsentgelt für 2026, volle bezahlte Monate, GKV mit Krankengeld sowie normale RV-/AV-Pflicht. Er ist eine bedingte Prognose aus geplanten Diensten. Tatsächliche Abrechnung und Arbeitgeber-Zahlungszeitpunkt können abweichen.

- Einmalzahlungen/Jahressonderzahlungen, PKV, Mini-/Midijobs, mehrere Beschäftigungen, Teilmonate, Rentenfälle und besondere Beitragsbefreiungen sind nicht allgemein angeschlossen. Einmalzahlungen dürfen nicht als weitere feste laufende Zulage eingegeben werden. Fehlende Jahres-/Vorabrechnungsdaten werden nicht ergänzt oder geschätzt.
- Bei Arbeitnehmern liegt die unterstützte regelmäßige SV-Basis oberhalb von 2.000 Euro, bei Ausbildung oberhalb von 325 Euro. Diese Prüfung berücksichtigt eine etwaige Zusatzversorgung. Das reale regelmäßige SV-Entgelt kann durch zusätzliche wiederkehrende variable Bezüge höher sein als die verwendete feste Grundlage; solche Grenzfälle bleiben ohne automatische Nettozahl.
- Zusatzversorgung verwendet die monatliche Freibetragsverteilung ohne zusätzliche betriebliche Altersvorsorge oder Riester-Förderung. Andere Kassen sowie besondere hohe Entgelte bleiben gesperrt. KZVK bezeichnet ausdrücklich Köln; andere kirchliche oder kommunale Kassen dürfen nicht damit gleichgesetzt werden. Die weitere feste Zulage muss ein gewöhnlicher laufender, versorgungspflichtiger Entgeltbestandteil sein.
- Monatsübergreifende Dienste benötigen weiterhin eine getrennte Abrechnungszuordnung. Fehlende Schicht-/Pausenzeiten, unbekannte Feiertagsregionen und widersprüchliche Sachsen-Angaben ergeben keine automatische Nettozahl.
- Datierte Caritas-/DRK-Entwürfe und weitere Vergütungsvarianten mit `completeGross: false` bleiben außerhalb der vollständigen automatischen Gehaltsprognose. Dieser Anschluss erweitert alle aktuell wählbaren Gehaltsmodelle; er vervollständigt keine bisher unvollständigen Tarif-Fachmodule.
- Anzahl der Kinder unter 25, Krankenkassen-Zusatzbeitrag und andere persönliche Angaben gelten als gespeicherte Annahmen. Bei Änderungen wird ein neues Profil ab dem betroffenen Monat benötigt. Ohne Geburtsdaten der Kinder lässt sich das Ende eines PV-Kinderabschlags nicht selbständig bestimmen.

## Nachweise

- 29 neue Tarifmatrix-Fälle prüfen sämtliche acht Modelle, Nacht-/Sonntagsarbeit, Pausen, Ausbildung, Fortgeltung, Kalenderänderungen, Zusatzversorgung und genaue Geldsummen. Die bestehende gezielte Tarifreferenz-Suite mit 1.491 Tests besteht ebenfalls.
- Sieben Zusatzversorgungs-/Ausbildungsfälle bestehen, darunter die veröffentlichten VBL-Beispiele West mit 6.500 Euro und Ost mit 5.000 Euro. Die gemeinsame fokussierte Kern-/SFN-Prüfung hat 188 Tests bestanden.
- Die Profil-/Backup-Prüfung hat 88 Tests bestanden. Neue UI-Tests prüfen ausdrücklich die Einrichtung, alte Monatsprofile, automatische Neuberechnung, Bearbeitung ohne veraltete Nettozahl, Schreibkonflikte und Testlabor-Sperren. Hook-Tests prüfen verzögerte Monatsantworten und Wiederherstellung beim erneuten Öffnen.
- Lokaler iOS-/Hermes-Export am finalen Stand erfolgreich: `artifacts/net-pay-automatic-export/`, 2.398 Module, Bundle `entry-fc336cadf0ef9d3000765fdc57347494.hbc`. Protokoll: `artifacts/net-pay-automatic-export.log`. Dieser Export ist kein veröffentlichtes Update und kein Gerätenachweis.
- `npm.cmd run verify:fast` am finalen Stand vollständig erfolgreich, Exitcode 0: Regelverträge, Typprüfung, Lint, Format, 8.071 Unit-/Integrationstests in 414 Dateien, 868 Komponententests in 113 Suiten sowie sämtliche Publisher-/Delivery-/Policy-/Runtime-/Build-Abhängigkeitsprüfungen. Protokoll: `artifacts/net-pay-automatic-verify-fast.log`.
- Im ersten Gesamtlauf schlug ein unveränderter Kalender-Animationstest einmal fehl. Seine sechs Tests bestanden im separaten Lauf; der erneute vollständige Prüflauf bestand anschließend ohne Änderungen an Kalender oder Testanforderungen.

## Quellen der ergänzten Abrechnungsregeln

- [BMF Lohnsteuer-Handbuch 2026, § 3b](https://lsth.bundesfinanzministerium.de/lsth/2026/A-Einkommensteuergesetz/II-Einkommen-2-24b/2-Steuerfreie-Einnahmen-3-3c/Paragraf-3b/inhalt.html): Zusammensetzung des Grundlohns und regelmäßige Monatsarbeitszeit.
- [§ 20 SGB IV](https://www.gesetze-im-internet.de/sgb_4/__20.html): Ausbildung ist vom Übergangsbereich ausgenommen; die besondere Arbeitgebertragung gilt bis 325 Euro.
- [VBL, Versicherungsrecht VBLklassik 2026](https://www.vbl.de/documents/411829/445309/Versicherungsrecht_VBLklassik_Schulungsunterlage_2026.pdf/ba86b853-8b23-d10a-ab89-d334f80dbedd?download=true&t=1769498368463&version=1.2): Beiträge, monatliche Freibetragsverteilung und SV-Hinzurechnung; unabhängige Referenzbeispiele für West und Ost.
- [VBL, zusatzversorgungspflichtiges Entgelt 2026](https://www.vbl.de/documents/411829/411898/ZVE_2026.pdf/5e800375-96f7-195d-49d7-61c3cfab056f?download=true&t=1775032886512&version=1.0): Entgeltbasis vor Steuerfreiheit des Arbeitnehmer-Eigenbeitrags und besondere ausgeschlossene Bestandteile.
- [KZVK Köln, Arbeitnehmer-Eigenbeteiligung](https://www.kzvk.de/arbeitgeber/betriebsrente/arbeitnehmer-eigenbeteiligung), [Beiträge](https://www.kzvk.de/versicherte/betriebsrente/beitrag) und [Satzung](https://www.kzvk.de/fileadmin/downloads/die-kzvk/satzung/satzung-kzvk.pdf): Beitragssätze für 2026, Kapitaldeckung und Entgeltgrundlage.

## Noch erforderliche iPhone-Abnahme

Die Automatik ist als iOS-Preview-OTA veröffentlicht: Gruppe `2c5322e6-8b1b-4e1e-aba9-04b6ccf7159c`, Update `01a12314-99e7-76a7-b674-8634ad8ee9db`, 10. Oktober 2026 um 01:51:55 Uhr MESZ. Der vollständige Fingerprint mit 95 Quellen entspricht Preview-Build 33: `03d174d668f0ea5f757958dccf853632762c554d`. Kanal, Branch und Umgebung sind `preview`, die App-Kennung lautet `com.pflegeshift.app.internal`.

Der Export unter der tatsächlichen EAS-Preview-Umgebung ist erfolgreich. Die vom Update-Endpunkt ausgelieferte OTA-ID und das heruntergeladene Hermes-Bundle stimmen mit dem lokalen Export überein, SHA-256 `00a2f793b4e2abc1ce0d1423e81bc61b78da0c8b818bff4cf5015579e1ea0a13`. Nachweise: `artifacts/net-pay-automatic-fingerprint-summary.json`, `artifacts/net-pay-automatic-export-eas.log`, `artifacts/net-pay-automatic-channel-summary.json` und `artifacts/net-pay-automatic-publication-verification.json`. Testablauf und Veröffentlichungsdaten stehen in [brutto-netto-automatik-preview-test.md](brutto-netto-automatik-preview-test.md).

Auf dem iPhone prüfen: einmalige Einrichtung und Neustart; Folgemonat ohne erneute Eingaben; datierte Änderung mit unverändertem Vormonat; wechselnde Tarifprofile und Dienstzeiten; große Schrift, VoiceOver, Tastatur/Scrollen; Zusatzversorgungs-Aufschlüsselung; verständliche gesperrte Fälle; Rückweg zur Gehaltskarte. Screenshots mit sichtbarem Build-/Update-Stand und ein Neustartnachweis sind noch offen.
