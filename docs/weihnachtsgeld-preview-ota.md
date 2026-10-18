# Weihnachtsgeld und vereinfachte Netto-Seite als iOS Preview

Freigabe vom 18.10.2026: Die geprüfte Gehaltsänderung als iOS-OTA ausschließlich
für den Kanal/Branch und die EAS-Umgebung `preview` bereitstellen. Ziel ist die
Abnahme auf dem iPhone. Commit, Push, PR, Merge, nativer Build und Production
gehören nicht zu dieser Freigabe.

Der Kandidat liegt isoliert auf `codex/weihnachtsgeld-preview`. Er übernimmt
den veröffentlichten Quellstand der Preview-Gruppe
`fa46ab60-857e-47af-8950-a4ccae2f4965` einschließlich Eintragsarten,
Auswahlhäkchen und der vorherigen Preview-Vereinfachungen. Darauf werden die
43 geprüften Dateien aus `codex/jahressonderzahlung-netto` angewendet.
Sieben überlappende Dateien wurden so zusammengeführt, dass die vorhandenen
Fehleraktionen, Hinweise auf vorläufiges Netto, Brutto-Teilsummen und
Prüfungsdarstellungen erhalten bleiben. Die Ausgangskopien bleiben unverändert.

Plattform: Expo SDK 57, iOS, interner Preview-Build 41 mit Bundle-ID
`com.pflegeshift.app.internal`. Die Ziel-Runtime ist
`43b795d13a44499e37cc461aa80ce8c239783788`; vor dem Upload muss der tatsächlich
berechnete Fingerprint vollständig mit diesem bestehenden Build übereinstimmen.
Die Runtime-Policy und native Abhängigkeiten werden nicht geändert.

Abnahme vor Veröffentlichung: Typprüfung, Lint, Formatierung, Regeln,
vollständiges `verify:fast`, Vergleich der Quellprüfsummen gegen die bestehende
OTA und Kontrolle des nativen Fingerprints. Nach Veröffentlichung: aktiver
Kanal, Update-Gruppe, iOS, Runtime und das tatsächlich ausgelieferte Bundle
abgleichen. Eine Veröffentlichung bestätigt noch keine sichtbare iPhone-Abnahme.

Auf dem iPhone prüfen: vereinfachte Netto-Angaben, eigene Sonderzahlungskarte,
tariflicher Monat, anpassbarer Vorschlag, Speichern und Monatswechsel,
Bruttoaufteilung, laufendes Netto bei fehlenden Jahreswerten sowie die
Netto-Berechnung nach bestätigten Jahresgrundlagen. Zusatzversorgung der
Sonderzahlung bleibt als fachliche Teilberechnung gekennzeichnet; siehe
[Tarif- und Berechnungsdokumentation](jahressonderzahlung-netto-2026.md).

Prüfnachweise und Veröffentlichungsdaten liegen lokal unter
`artifacts/weihnachtsgeld-preview/`.
