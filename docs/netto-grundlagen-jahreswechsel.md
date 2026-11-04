# Netto bei geänderten Grundlagen und am Jahreswechsel

## Auftrag und Abnahme

- Ziel: Die Netto-Schätzung für ein vollständig um einen oder zwei Monate verschobenes Zulagenpaket bleibt bei Änderungen zwischen den Monaten und beim Jahreswechsel verfügbar.
- Plattform: gemeinsame TypeScript-Berechnung; sichtbare Prüfung in der iOS-Preview-App.
- Scope: Zahlungsprognose, Jahreswechsel-Steuerberechnung, Schätzungshinweise in den bestehenden Gehaltsansichten und zugehörige Tests.
- Nicht-Ziele: neue Tarifwerte, ein neuer Steuerrechner für 2027, neue Einstellungen, Teilmonatsabrechnungen, Änderungen an nativen Modulen oder gespeicherten Angaben.
- Abnahme: getrennte ursprüngliche und aktuelle Grundlagen, unveränderte SFN-Nachweise, passende Bruttosumme und einzeln nachvollziehbare Abzüge. Einmalzahlungen und persönliche Netto-Abzüge dürfen nur einmal eingehen. Fehlende oder widersprüchliche Nachweise bleiben gesperrt.
- Geräteabnahme: Beide Ausgangsfälle wurden vom Nutzer auf dem iPhone in der Preview und anschließend in TestFlight-Build 9 bestätigt. Die Abnahme gilt für die beiden Netto-Fälle dieses Auftrags.
- Commit, Push, PR und Merge sind nach der Geräteabnahme ausschließlich für diese Netto-Korrektur freigegeben. Preview- und TestFlight-OTA wurden bereits separat freigegeben und veröffentlicht. Neue Builds oder weitere OTAs sind nicht Teil der Git-Auslieferung.

## Berechnung

Bei gleichjähriger Nachzahlung setzt sich die Schätzung aus dem aktuellen laufenden Grundgehalt und dem Netto-Zuwachs des vollständigen Zulagenpakets im Ursprungsmonat zusammen. Dieser Zuwachs ist die Differenz zweier Abrechnungen desselben Ursprungsmonats, einmal mit und einmal ohne Zulagen. Dadurch werden Wochenstunden, Gehalt, Steuerklasse, Versicherungsdaten und Zusatzversorgung jeweils mit den für ihren Monat gespeicherten Grundlagen berechnet. Gleiche Grundlagen in beiden Monaten sind nicht erforderlich.

SFN-Grenzen und Schichtnachweise bleiben dem tatsächlichen Dienstmonat zugeordnet. Die Sozialversicherung wird mit den ursprünglichen Monatsgrenzen geschätzt. Damit wird keine Arbeitgeberpraxis zur optionalen SV-Zuordnung zum Auszahlungsmonat unterstellt. Die Annahme, dass die marginalen Abzüge mit dem Zulagenpaket einbehalten werden, bleibt eine Auszahlungsschätzung.

Beim Jahreswechsel wird der steuerpflichtige Vorjahresanteil als sonstiger Bezug im Auszahlungsjahr berechnet. Die App kennt nur den Auszahlungsmonat und nimmt für diese Schätzung einen Zufluss zum Monatsende an. Im Januar liegt dieser nach der Drei-Wochen-Grenze. Ein tatsächlicher Zufluss bis zum 21. Januar kann anders abzurechnen sein. Dieser Fall wird nicht als bestätigte Abrechnung ausgegeben.

Das erwartete steuerpflichtige Jahresbrutto wird aus den aktuellen laufenden Monatsbezügen einschließlich einer laufenden Monatszulage hochgerechnet. Frühere gespeicherte Sonderzahlungen desselben Jahres werden hinzugerechnet. Vorhandene explizite Jahresgrundlagen einer Sonderzahlung haben Vorrang. Vorjahreszulagen und eine enthaltene aktuelle Sonderzahlung gehen gemeinsam in die steuerliche Differenzberechnung ein; SV und Zusatzversorgung behalten ihre getrennten Grundlagen.

Für 2027 bleibt die vorhandene Prognose mit 2026-Regeln ausdrücklich vorläufig. Der Jahreswechsel-Hinweis erscheint unmittelbar beim Netto sowie in den Abzugs- und Berechnungsdetails. Er nennt die Annahme zum Monatsende und zur Jahresgrundlage.

## Lokaler Prüfnachweis vom 4. November 2026

- Isolierter Branch: `codex/netto-grundlagen-jahreswechsel`, Ausgangsstand `faf836d84bcd4074d62ccdc708f1f7c7a26b02b5` (frisch gegen Remote-master geprüft).
- Expo: `~57.0.31`; Referenz ist die versionierte SDK-57-Dokumentation. Der vorgeschriebene Git-Hook wurde im neuen Checkout eingerichtet.
- Gezielte Zahlungsberechnung: 61 Tests bestanden. Die neuen Fälle reproduzierten vor der Korrektur die bisherigen Sperren.
- Gezielte Gehaltsansichten: 89 Komponententests bestanden, einschließlich der echten Jahreswechsel-Berechnung in Übersicht, Abzugsdetails und Berechnungsgrundlagen.
- `npm.cmd run verify:fast`: vollständig bestanden. 544 Unit-Testdateien mit 10.388 Tests und 193 Komponentensuiten mit 1.823 Tests sowie sämtliche ergänzenden Skriptprüfungen sind grün. Vitest lief mit `VITEST_MAX_WORKERS=2`.
- `git diff --check`: bestanden. Zehn beabsichtigte Dateien, keine Paket- oder Native-Änderungen.
- Vollständiges lokales Prüfprotokoll: `artifacts/netto-grundlagen-jahreswechsel/verify-fast.log` (ignoriertes Arbeitsartefakt).
- Stand nach der Implementierung: Preview-Auslieferung und reale iPhone-Abnahme standen noch aus. Der damalige Prüflauf enthielt keinen Commit, Push, Build oder OTA-Schritt.

## Preview-OTA vom 4. November 2026

Die anschließend ausdrücklich freigegebene iOS-Preview-OTA ist veröffentlicht: [EAS-Update](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/0d4e0344-b669-47ef-a601-d3be5525c580).

- Ziel: bestehender Kanal und Branch `preview`, Environment `preview`, `APP_VARIANT=internal`, Preview-Build 49.
- Update: `01a1a45e-5244-7ed0-b66b-401f2b5ab1c2`; Gruppe: `0d4e0344-b669-47ef-a601-d3be5525c580`.
- Runtime: `402e757d98ca799660ce5dd15a24bd999cf690eb`, direkt gegen den eingebetteten Fingerprint des bestehenden IPA geprüft.
- Ausgangspunkt: aktueller Wallet-Preview-Stand; 2401 andere Dateien blieben bytegleich. Eine Testdatei wurde konfliktfrei zusammengeführt.
- Die integrierte Version hat `verify:fast` vollständig bestanden: 10,394 Unit-Tests und 1,843 Komponententests in 196 Suiten.
- EAS-Metadaten, tatsächlich abrufbares Manifest, Bundle-SHA-256 und alle 34 Assets stimmen mit dem lokalen Export überein. Die beim Export erfassten Quell-Dateien sind unverändert.
- Bundle-SHA-256: `4c5abc9e52743d9553f30ec99ecff53c3f67f7a45e3e33ab1c2fb741adda16ab`.
- Es wurde kein neuer Build erstellt und kein Git-Schritt veröffentlicht. Die Funktionsabnahme der beiden Fälle in Preview wurde anschließend vom Nutzer bestätigt.
- Gerätetest: Preview-App vollständig schließen, öffnen und etwa 15 Sekunden warten, erneut schließen und öffnen. Juli 2026 mit Juni-Zulagen sowie Januar 2027 mit Dezember-Zulagen prüfen.

## TestFlight-OTA vom 4. November 2026

Die Preview-Funktionsabnahme ist bestätigt: „Beide Fälle funktionieren jetzt in der Preview.“ Anschließend wurden die TestFlight-OTA ausdrücklich freigegeben und die installierte Version als Build 9 bestätigt.

Die Netto-Korrektur ist als [TestFlight-OTA](https://expo.dev/accounts/vladularu/projects/pflegeshift/updates/45dcdf3b-f802-4625-82e9-f380ce86455e) veröffentlicht.

- Ziel: bestehender Kanal und Branch `production`, Environment `production`, `APP_VARIANT=production`, vorhandenes TestFlight-Build 9.
- Update: `01a1a490-b343-7fa5-9044-2984bfbe1659`; Gruppe: `45dcdf3b-f802-4625-82e9-f380ce86455e`.
- Runtime: `c223286c3cbf6ce5f7873c6e595d558028d9d8fb`, gegen den tatsächlichen eingebetteten IPA-Fingerprint und das aktuelle EAS-Build geprüft.
- Ausgangspunkt: eingebetteter Build-9-Stand; vor Veröffentlichung lieferte dessen Runtime HTTP 204 ohne OTA. Der ältere Production-Gruppenkopf für Build 8 wurde nicht als Build-9-Quellstand verwendet.
- 2.396 andere Dateien des TestFlight-Stands blieben bytegleich. Die acht übernommenen Berechnungs-, Anzeige- und Unit-Testdateien entsprechen exakt der abgenommenen Preview; übernommen wurden ausschließlich die zehn Dateien des Netto-Auftrags.
- `verify:fast`: vollständig bestanden, 10.386 Unit-Tests in 542 Dateien und 1.835 Komponententests in 195 Suiten. `audit:production` ebenfalls bestanden.
- Tatsächliches Production-Manifest HTTP 200, passendes Update und Runtime, Bundle und alle 34 Assets bytegleich mit dem getesteten Export. Quell-Dateien unverändert.
- Bundle-SHA-256: `a3dadbef8e72eb8d9359d2bd9c33862c06b951e9a4e5a011df28fc01a0cb9c8c`.
- Preview bleibt unverändert bei Gruppe `0d4e0344-b669-47ef-a601-d3be5525c580`. Kein neuer Build und keine Git-, Gruppen-, Link- oder Store-Veröffentlichung.
- Geräteabnahme bestätigt am 4. November 2026 durch den Nutzer: „Beide Fälle funktionieren jetzt auch in TestFlight auf Build 9.“ Bestätigt sind Juli 2026 mit Juni-Zulagen bei geänderten Grundlagen sowie Januar 2027 mit Dezember-Zulagen. Beide Netto-Ausgangsfälle sind damit in Preview und TestFlight-Build 9 funktional abgenommen.

## Git-Auslieferung

Nach der bestätigten Funktionsabnahme beider Fälle in Preview und TestFlight-Build 9 sind Commit, Push, PR und Merge nach grüner CI ausdrücklich freigegeben. Der Dateiumfang bleibt bei den zehn Dateien der Netto-Korrektur einschließlich dieses Nachweises. Die neun Berechnungs-, Anzeige- und Testdateien werden gegen den abgenommenen OTA-Quellstand geprüft.

Vor dem Merge müssen die sieben PR-Prüfungen `fast-feedback`, `coverage`, `production-safety`, `export-web`, `export-android`, `export-ios` und `quality-gates` erfolgreich sein. Git-Auslieferungsnachweise werden getrennt von den bereits abgeschlossenen OTA- und Geräteprüfungen geführt.

## Fachliche Quellen

- [BMF, R 39b.5 Absatz 4 LStR 2026](https://ao.bundesfinanzministerium.de/lsth/2026/A-Einkommensteuergesetz/VI-Steuererhebung-36-47/2-Steuerabzug-vom-Arbeitslohn-Lohnsteuer-38-42g/Paragraf-39b/r-39b-5.html): Zuordnung laufender Nachzahlungen zum ursprünglichen Lohnzahlungszeitraum.
- [BMF, R 39b.2 LStR 2026](https://ao.bundesfinanzministerium.de/lsth/2026/A-Einkommensteuergesetz/VI-Steuererhebung-36-47/2-Steuerabzug-vom-Arbeitslohn-Lohnsteuer-38-42g/Paragraf-39b/inhalt.html): Abgrenzung laufender Arbeitslohn und sonstiger Bezug; Drei-Wochen-Grenze beim Jahreswechsel.
- [DRV, Beitragsberechnung zeitversetzt gezahlter Arbeitsentgeltbestandteile](https://rvrecht.deutsche-rentenversicherung.de/SharedDocs/rvRecht/01_GRA_SGB/04_SGB_IV/pp_0001_25/p_0014/gra_sgb004_p_0014_beitragsberechnung.html): grundsätzliche Zuordnung zum Entstehungszeitraum und Voraussetzungen der alternativen Zuordnung.
