# TVA-L Pflege: eigene Sollzeitreferenz

Stand 27.10.2026. Geprüfte Berechnungsjahre 2026–2027, reguläre Ausbildung in der bestehenden Auswahl. Quellenstand 14.02.2026 ist eine Identität der geprüften Fassung, kein pauschales Inkrafttretensdatum und kein Tarifende.

## Quellen und Verweiskette

- [TdL: TVA-L Pflege, ÄTV 13 vom 14.02.2026](https://www.tdl-online.de/fileadmin/downloads/TV-Ausbildung/TVA-L-Pflege/260804_TVA-L_Pflege_i.d.F._des_%C3%84TV_Nr._13.pdf): § 1 regelt die Ausbildungsgeltung; § 7 Abs. 1 verweist für Auszubildende außerhalb des JArbSchG auf die Arbeitszeitregelungen des Ausbildenden. Die Erlaubnis in Abs. 2 beweist keinen persönlichen Siebentageplan.
- [TdL: Änderungsvertrag 13](https://www.tdl-online.de/fileadmin/downloads/TV-Ausbildung/TVA-L-Pflege/%C3%84TV_Nr._13_zum_TVA-L_Pflege_Homepage.pdf): dessen § 3 enthält gesonderte Änderungen ab 01.01.2027, insbesondere zur Pflegefachassistenz. Sie werden nicht in die reguläre Ausbildung umgedeutet.
- [TdL: TV-L, ÄTV 14 vom 14.02.2026](https://www.tdl-online.de/fileadmin/downloads/TV-L/260812_TV-L__i.d.F._des_%C3%84TV_Nr._14_VT_neu.pdf): allgemeiner § 6 Abs. 3 mit ausgefallenen Stunden; davon getrennt Krankenhausgeltung § 43 Nr. 1 und dessen Nr. 3 Ziff. 2. Bei § 43 sind qualifiziert planfreie Feiertage und Feiertagsarbeit mit gesondertem Ausgleich verschiedene Tatbestände.
- [JArbSchG](https://www.gesetze-im-internet.de/jarbschg/): eigener Schutzumfang; hier keine numerische Minderjährigenprognose.

Es wird eine bedingte Verweisprognose implementiert. Für genau den TVA-L-Ausbildungsfall wurde kein spezielles BAG-Urteil als eigene Anspruchsbestätigung geprüft. Quelle des abgeleiteten Regelobjekts ist TVA-L; die konkrete Arbeitgebernorm bleibt in legalBasis und diesen Quellen nachvollziehbar. Fest vereinbarte Feiertagsausfallzeit verwendet weiterhin die eigenständige gesetzliche Ausfallregel der gemeinsamen Engine.

## Vorhandene Daten und Berechnung

Das einfache TVA-L-Pflege-Profil enthält Ausbildungsjahr und West/Ost. Daraus folgen weder Krankenhausgeltung noch Volljährigkeit. Ohne Arbeitgeberbezug entsteht TVAL_COMMON: begrenzte Verluststundenreferenz, im wechselnden Modell Montag bis Freitag, keine pauschalen Samstags-Fünftel. Die vorhandene aufklappbare Erklärung nennt die offene Arbeitgeberregel. Es gibt keine neue Eingabemaske.

Bestehende datierte Vergütungsdaten mit tvalEmployerScope GENERAL oder SECTION_43 liefern eigene TVAL_GENERAL- oder TVAL_KR-Regeln. Es werden nur CARE, regular, Ausbildungsjahr 1–3 und die bereits unterstützten Regionen WEST_38_5, EAST und EAST_UNIVERSITY_HOSPITAL erkannt. Eine explizite andere Kategorie/Variante/Region/Periode bleibt ungeprüft. Die einfache Auswahl wird nicht um neue Kategorien erweitert.

Persönliche weeklyMinutes, Arbeitsort/Feiertagsregion und Sonn-/Feiertagsantwort führen. Ausbildungsjahr und tarifliche Vollzeitbasis überschreiben keine persönlichen Vertragsminuten. Insbesondere wird aus der Ost-Vollzeitänderung 2027 keine automatische Änderung individueller Stunden erfunden. Feste abweichende Verteilungen bleiben erhalten.

| Hessen, 2310 Wochenminuten |    Referenz ohne Krankenhausbezug / GENERAL |                          Bedingte §-43-Referenz |
| -------------------------- | ------------------------------------------: | ----------------------------------------------: |
| Oktober 2026               |                   22 × 462 = 10164 (169:24) |             (22 − 03.10.) × 462 = 9702 (161:42) |
| November 2026              |                    21 × 462 = 9702 (161:42) |                                   9702 (161:42) |
| Dezember 2026              | (23 − 24./25./31.12.) × 462 = 9240 (154:00) | (23 − 24./25./26./31.12.) × 462 = 8778 (146:18) |
| Dezember 2027              |     (23 − 24./31.12.) × 462 = 9702 (161:42) |     (23 − 24./25./31.12.) × 462 = 9240 (154:00) |

GENERAL verwendet tatsächlich bestätigte ausgefallene Minuten, keinen pauschalen Fünftelanspruch. Die automatische gleichmäßige Referenz ist vorläufig. § 43 verwendet den bereits bestehenden qualifiziert-planfrei-Pfad; Arbeit am Feiertag wird im bestätigten Tatsachenmodus separat behandelt. Die Prognose bleibt unabhängig von einzelnen Diensten, Unterrichtseinträgen und alten Tagesbestätigungen. Rundung und Monats-/Jahres-/Exportgrundlage bleiben zentral.

## Historie, Schutz und Grenzen

Alle Änderungen laufen über bestehende Beschäftigungs-/Vergütungshistorie. Ein ausdrücklicher financial-only-Basisstand wird für die vorläufige Projektion verwendet; er wird nicht rückwirkend als Anspruch bestätigt. Altmarker TVA_L werden nur aus passender gespeicherter Beschäftigung aufgewertet. Abweichende spätere Tarif-/Arbeitgeber-/Stundenwechsel und ursprüngliche Einstellungen bleiben erhalten.

Der vorhandene Jugendschutzschalter, dessen Lade-/Lesefehler und der bestehende Wiederholungsweg werden wiederverwendet. Ein deaktivierter oder fehlender Schalter ist kein Altersnachweis. Bei aktivem Schutz oder noch nicht lesbarer Einstellung gibt es für Ausbildungsperioden keinen Erwachsenen-Sollwert; normale Beschäftigtenperioden bleiben getrennt. Das gilt auch für explizit noch ungeprüfte TVA-L-Auswahlmarker. Der Schalter ist undatiert und belegt keine historische Altersgrenze.

Offen bleiben Minderjährigen-Sollzeit, datierte Alters-/Schutzgeltung, Pflegefachassistenz und andere zusätzliche Ausbildungskategorien, Unterrichts-/Praxis-/Wegezeiten, Zusatzurlaub, FZA-/Kontobuchungen und echte untermonatliche Nettofälle. Soll-abhängige Salden können im Schutzfall fehlen; echte Einträge bleiben bestehen. Keine neue Datenbank-, Backup- oder Native-Version und keine Lohnalgorithmenänderung.

## Prüfung und Auslieferung

Eigene Regressionen für Kalenderwerte, Rundung, Arbeitgeberbezug, finanzielle und Beschäftigungshistorie, spätere Wechsel, unbestätigte Kategorien, Schutzstatus und Berichte. Zusätzlich echte SQL-Save/Reload/Backup- und vorhandene UI-/Provider-Prüfungen. Vollständiges verify:fast und PR-CI sind vor Auslieferung/Integration erforderlich. Interne iOS-Preview und reale iPhone-Abnahme bleiben separate Gates. Keine Beta- oder Production-Veröffentlichung.
