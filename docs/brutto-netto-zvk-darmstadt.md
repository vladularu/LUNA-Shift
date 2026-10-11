# Kommunale ZVK Darmstadt ergänzen

## Auftrag und Abnahme

Die veröffentlichte Auswahl enthält die evangelische EZVK (Bestand Darmstadt),
aber nicht die kommunale ZVK Darmstadt. Die beiden kommunalen Abrechnungsverbände
werden als getrennte, berechenbare Modelle ergänzt.

- Plattform: iOS, bestehender automatischer Netto-Workflow, Expo SDK 57.
- Scope: zentraler Kassenkatalog, Beitragsregeln 2026, automatische Beitragsbasis,
  fachliche Referenztests und
  Such-/Speichertest des vorhandenen Formulars, diese Dokumentation.
- Keine zusätzlichen Einrichtungsschritte, native Änderungen, Datenbankmigration,
  Umbenennung vorhandener Speicherkennungen oder Änderungen anderer Kassen.
- Abnahme: Suche nach „Darmstadt“ unterscheidet kommunale ZVK I/II und EZVK;
  beide kommunalen Modelle berechnen automatisch den festen Arbeitnehmeranteil;
  Arbeitgeberbeiträge beeinflussen Steuer-/SV-Bemessung wie bisher; Speicherung,
  Monatsvererbung und Backup funktionieren mit den neuen IDs.
- `verify:fast` und fokussierte Netto-Tests müssen bestehen. Die Web-Vorschau ist
  ein Funktions-/Darstellungsnachweis, die iPhone-Abnahme bleibt gesondert.
- Eine weitere OTA-Veröffentlichung und Git-Auslieferung sind getrennte Freigaben.

## Amtliche Grundlage und Umsetzung

Stand: 11.10.2026. [Berechnungswerte 2026 der kommunalen ZVK Darmstadt](https://www.vk-darmstadt.de/fileadmin/user_upload/Berechnungswerte_2026.pdf):

| Auswahl / gespeicherte ID                       | Arbeitnehmer                           | Arbeitgeber                     | Modellierung                                                                                |
| ----------------------------------------------- | -------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| ZVK Darmstadt · Verband I / `ZVK_DARMSTADT_I`   | 0,50 % Umlage aus Netto                | 5,70 % Umlage                   | § 3 Nr. 56 EStG; Pauschalgrenze 89,48 €/Monat; SV-Hinzurechnung im vorhandenen Umlagemodell |
| ZVK Darmstadt · Verband II / `ZVK_DARMSTADT_II` | 0,40 % kapitalgedeckter Pflichtbeitrag | 6,11 % regulärer Pflichtbeitrag | § 3 Nr. 63 EStG; vorhandene monatliche Steuer-/SV-Freigrenzen und Arbeitgebervorrang        |

Das Sanierungsgeld des Arbeitgebers (Verband I: 1,80 %) und dessen Sonderzuschlag
(Verband II: 0,49 %) sind keine Arbeitnehmerabzüge. Der Sonderzuschlag dient gemäß
[Satzung § 60a Abs. 2, S. 47](https://www.vk-darmstadt.de/fileadmin/user_upload/ZVK_Internet/Dateien/Satzung_ZVK_DA_25-02-11.pdf)
der Kapitalausstattung bzw. Verstärkung der Rechnungsgrundlagen. Seine Einordnung
als Sonderzahlung außerhalb der regulären individuellen Kapitalbeiträge folgt aus
[§ 19 Abs. 1 Satz 1 Nr. 3 Satz 2 EStG](https://www.gesetze-im-internet.de/estg/__19.html)
und den [BMF-Hinweisen 2026, Rn. 19–22](https://usth.bundesfinanzministerium.de/lsth/2026/B-Anhaenge/Anhang-02/III/anhang-2-III.html).
Er verbraucht im Modell daher keine individuellen §-3-Nr.-63-Freigrenzen.
Die Arbeitgeber-Kapitalrate für Verband II ist 6,11 %, nicht 6,60 %.

Die Satzung (§ 62 Abs. 2 Buchst. s, S. 49) nimmt Nacht-, Sonn- und Feiertagszuschläge
vollständig vom zusatzversorgungspflichtigen Entgelt aus. Die automatische
Beitragsbasis beider Darmstadt-Modelle zieht daher zusätzlich die steuerpflichtigen
Teile dieser Zuschläge ab. Ihre Steuer-/SV-Klassifizierung bleibt bestehen;
Samstagszuschläge und feste beitragspflichtige Zulagen bleiben in der ZVK-Basis.
Referenztests decken bezahlte Nachtpausen, Sonntag/Feiertag und Samstag ab.

Die vorhandenen Annahmen (laufendes Monatsentgelt, keine Entgeltumwandlung/Riester,
gleichmäßige monatliche Freigrenzen; vorläufige Folgejahresprognose mit 2026-Regeln)
gelten weiter. Tarif-/arbeitsvertragliche Sondervereinbarungen werden durch diese
Standardmodelle nicht zusätzlich abgedeckt.

## Unabhängige Referenzfälle

Beträge in Euro; Basis ist das zusatzversorgungspflichtige Monatsentgelt.

| Modell / Basis       | Arbeitnehmerabzug | Steuerbrutto-Korrektur | SV-Brutto-Korrektur |
| -------------------- | ----------------: | ---------------------: | ------------------: |
| Verband I / 5.000 €  |             25,00 |                   0,00 |             +215,56 |
| Verband I / 8.000 €  |             40,00 |                 +28,52 |             +386,56 |
| Verband II / 5.000 € |             20,00 |                 −20,00 |              −20,00 |
| Verband II / 7.000 € |             28,00 |                 −28,00 |              +89,70 |

Verband I bei 5.000 €: AG-Umlage 285,00 €, SV-Hinzurechnung
`round(100 × 2,5 / 5,7, 2) − 13,30 = 30,56 €`; zusammen
`285 − 100 + 30,56 = 215,56 €`.
Verband II bei 5.000 €: AG-Kapitalbeitrag 305,50 € und AN-Beitrag 20,00 €
bleiben zusammen unter der monatlichen SV-Grenze 338,00 €.
Der Sonderzuschlag des Arbeitgebers wird weder als Arbeitnehmerabzug noch zur
Freigrenzenbelegung hinzugerechnet.
