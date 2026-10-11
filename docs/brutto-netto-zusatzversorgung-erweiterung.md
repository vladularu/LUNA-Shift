# Automatische Netto-Prognose und Zusatzversorgung

Ziel: Den manuellen Rechner einschließlich seiner Einstiege entfernen und die Zusatzversorgung um kommunale und kirchliche Kassen erweitern. Die vorhandene kompakte Übersicht, drei Einrichtungsschritte und gespeicherte Angaben bleiben erhalten.

Plattform: iOS Preview, Expo SDK 57 (~57.0.22). Arbeitsbranch: `codex/brutto-netto-prototype`.

Arbeitspaket 1: Manuelle Route, Formulare, Ergebnisansicht und ausschließlich dafür benötigte Komponenten entfernen. Bestehende `/net-pay?month=...`-Links öffnen weiter die automatische Prognose; ein alter `mode=manual`-Parameter aktiviert keinen manuellen Rechner.

Arbeitspaket 2: Ein zentraler Kassenkatalog, versionierte Beitragsregeln 2026, durchsuchbare Auswahl und Tests für Beitrag, Steuer/SV-Behandlung, Speichern und Backup. Die Kasse wird vom Nutzer gewählt; sie lässt sich nicht eindeutig aus dem Bundesland ableiten. Bei der EZVK wird der arbeitsvertraglich unterschiedliche Eigenanteil optional von der Abrechnung übernommen. Ohne diesen Anteil bleibt die Prognose ausdrücklich vor Zusatzversorgung.

Nicht-Ziele: Neue native Abhängigkeiten, geänderte Steuer- oder SFN-Regeln, Eingriffe in andere Worktrees, Git- oder OTA-Veröffentlichung. 2027 bleibt als vorläufige Berechnung nach den vorhandenen 2026-Grundlagen markiert.

Abnahme: Kein erreichbarer manueller Rechner; vorhandene VBL-/KZVK-Ergebnisse unverändert; neue Kassen berechnen Beiträge und Steuer-/SV-Anpassungen; unbekannte Eigenanteile werden nicht als null angenommen; neue Auswahl überlebt Speichern, Vererbung und Backup. `verify:fast`, gezielte Fach-/Komponententests und visueller Browsercheck; iPhone-Abnahme bleibt separat.

## Quellenstand 11.10.2026

- Die bisherigen Modelle bleiben erhalten: [VBL West/Ost 2026](https://www.vbl.de/de/-/rechengroessen-in-der-zusatzversorgung-2026) und [KZVK Köln 2026](https://www.kzvk.de/fileadmin/downloads/service/rechengroessen/rechengroessen-2026.pdf).
- [BVK Berechnungswerte 2026](https://www.bvk-zusatzversorgung.de/Portals/12/Media/Dokumente/Rechengr%C3%B6%C3%9Fen/Werte_2026_Stand_15.10.25.pdf): AVI Umlage 3,75 %, Zusatzbeitrag 4 %; AVII Beitrag 4,8 %, jeweils ohne tariflichen Eigenanteil.
- [KVBW Berechnungswerte 2026](https://www.kvbw.de/pb/site/KVBW_temp/get/documents_E1646061566/kvbw/Datenquelle_2018/PDF-Dateien/Zusatzversorgung/Berechnungswerte/541-612-16A_Berechnungswerte_2026.pdf): AVI AG-Umlage 5,75 %, AN-Umlage 0,55 %, AG-Kapital 0,65 %; AVII AG 8,1 %, AN 0,4 %.
- [kvw Berechnungswerte 2026](https://www.kvw-muenster.de/media/filer_public/10/66/1066b728-efd5-42ad-9a87-e1ac5e131d1a/berechnungs-_und_grenzwerte_ab_01_01_2026.pdf): AVI AG-Umlage 4,5 %; AVII AG-Umlage 2,5 %, AG-Kapital 4 %, AN-Kapital 0,4 %.
- [Rheinische Zusatzversorgung](https://www.versorgungskassen.de/zusatzversorgung/pflichtversicherung/versicherungspflicht/finanzierung.html): AVI AG-Umlage 4,25 %.
- [KVK Kurhessen-Waldeck](https://www.kvk-kassel.de/de/kvkwiki/umlage-kvk-zusatzrente): AVI AG-Umlage 5,85 %, AN-Umlage 0,65 %.
- [KVBbg Finanzierung](https://kvbbg.de/Zusatzversorgung_Mitglieder_FAQ.html): AG-Umlage 1,1 %, AG-Kapital 2,4 %, AN-Kapital 2,4 % (ATV-K).
- [ZVK Sachsen Meldebeispiele 2026](https://www.kv-sachsen.de/fileadmin/user_upload/Meldebeispiele_2026.pdf): AG-Umlage 1,6 %, AG-Kapital 2,46 %, AN-Kapital 2,4 %.
- [ZVK Thüringen 2026](https://zvk.meinezvk.de/?page_id=163648): AG-Umlage 1,7 %, AG-Kapital 2 %, AN-Kapital 2,4 % (ATV-K).
- [KZVK Dortmund 2026](https://www.kzvk-dortmund.de/arbeitgeber/rechengroessen), [BAT-KF](https://www.kirchenrecht-ekir.de/document/3877/search/850): Kapitalbeitrag 6 %, davon AN 0,75 Prozentpunkte im BAT-KF-Modell.
- [EZVK Finanzierung](https://www.ezvk.de/fuer-arbeitgeber/beteiligung/beitraege-melde-und-zahlungsverkehr): Bestand Darmstadt regulär 6,6 %, Karlsruhe regulär 7 %, Eigenanteil arbeitsvertraglich und bis zur Hälfte des Gesamtbeitrags. Verminderte Beiträge, individuelle Besteuerung/Riester und Entgeltumwandlung sind nicht Teil dieser Standardmodelle.

Sanierungsgeld/Sonderzahlungen des Arbeitgebers werden nicht als Arbeitnehmerabzug angesetzt. Es gilt das monatliche Verteilmodell ohne weitere steuerfreie Versorgungsbeiträge und ohne Riester-Nettomodell. Bestehende Grenzen für besondere Entgelte bleiben erhalten.

## Umsetzung und lokale Abnahme

- Der manuelle Rechner und seine Einstiege sind entfernt. Alte Routenparameter aktivieren ihn nicht erneut. Die monatlichen Bestandsdaten und ihre Backup-Unterstützung bleiben erhalten.
- Die Auswahl umfasst 17 berechenbare Kassenmodelle statt bisher drei, zusätzlich „Keine“, „Weiß ich nicht“ und „Andere Kasse“. Sie ist nach Namen und Region durchsuchbar und bleibt innerhalb des dritten Einrichtungsschritts.
- Bei EZVK Darmstadt/Karlsruhe kann der eigene Beitrag von der Abrechnung angegeben werden. Eine leere Angabe bleibt unbekannt; ausdrücklich 0 ist ein bekannter Eigenanteil. Beim Wechsel zu einem festen Beitragsmodell wird dieser Zusatzwert entfernt.
- `npm.cmd run verify:fast`: erfolgreich. 418 Fachtestsuiten mit 8.317 Tests, 112 Komponententestsuiten mit 861 Tests; zusätzlich die vorgeschriebenen Regel-, Runtime- und Abhängigkeitsprüfungen.
- Beitrag und Steuer-/SV-Wirkung aller neuen Modelle, alte VBL-/KZVK-Referenzen, Vererbung, Speichern und Backup-Wiederherstellung wurden geprüft. Ein Kassenmodell ohne eigenen Abzug kann trotzdem die SV-Basis verändern.
- Browsercheck mit den tatsächlichen App-Komponenten und synthetischen Daten: Suche, KVBW-/BVK-Auswahl, Speicherung, EZVK mit unbekanntem und bekanntem Eigenanteil sowie unmittelbare Netto-Aktualisierung funktionieren. Native Gesten, Animationen und Icons werden in dieser Vorschau ersetzt.
- Quellvergleich zum Aufgabenstart: ausschließlich 27 Dateien dieses Scopes ergänzt/geändert und zehn ausschließlich manuelle Dateien entfernt. Unabhängige Änderungen bleiben erhalten; Graft ist aktualisiert.

Offen sind die Veröffentlichung der neuen Änderung als OTA und die anschließende iPhone-Abnahme. Es wurde kein Commit, Push, Build oder neues OTA ausgeführt. Der Katalog bildet die genannten Standardmodelle ab; abweichende Arbeitgeberverträge und weitere Kassen bleiben separat zu ergänzen.
