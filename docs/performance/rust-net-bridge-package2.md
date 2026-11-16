# Paket 2: Netto über die bestehende Rust-Brücke

Auftrag: das Netto-Paket wie Paket 1 umsetzen. Referenz ist die vom Nutzer mit „Ja funktioniert“ bestätigte iOS-Preview-OTA `01a1e10b-a501-7176-ad09-fa10a0f57039`, Quellstand `24aa6e85cc4de91c7b94fa70e779ddd8cce2ed2f5f398f00ad0b08bfc15c5c78`.

## Ziel und Grenzen

Zielplattform ist der vorhandene iPhone-Preview-Build 54 mit Runtime `642bfaefe006b4d4d3114c76973debf29b16036d`, Expo SDK 57. Die vorhandene native Engine berechnet die monatliche automatische Netto-Prognose einschließlich SFN, Steuern und Sozialversicherung aus den fachlichen Rohdaten. TypeScript übernimmt unverändert Datenzugriff, Aufrufsteuerung und Darstellung.

Oberfläche, Texte, Formulare, Navigation, Cloud und SQLite-Schema bleiben beim bestätigten Stand. Keine neue native Engine, keine Abhängigkeiten, keine Datenmigration oder Datenlöschung. Keine Git-Veröffentlichung und keine TestFlight-Veröffentlichung. Eine Preview-OTA wird erst nach bestandenen Prüfungen konkret vorbereitet; die Veröffentlichung bleibt ein eigener Freigabeschritt.

Die Jahresansicht sowie ihre eigenständigen Netto-/Brutto-Jahresrechnungen bleiben Folgepaket. Die bisherigen jährlichen Sonderzahlungs- und Auszahlungsdaten, die die vorhandene Monatsoberfläche benötigt, werden in diesem Paket nicht neu gestaltet. Ihr bisheriger TS-Vorbereitungsteil bleibt erhalten; die eigentliche Netto-Prognose wird im aktivierten Pfad ausschließlich in Rust berechnet. Deshalb ist dieses Paket noch kein vollständiger Port der Gehalts-/Jahrespipeline und verspricht keine bereits gemessene Beschleunigung der gesamten Jahresansicht.

## Getrennte Teilpakete und Dateiscope

1. **Gemeinsame vorhandene Rechenschnittstelle:** `monthly-rust-bridge.ts`, `monthly-rust-source.ts` sowie neue kleine `monthly-rust-finance.ts` und `monthly-rust-net.ts`. Monats-Arbeitszeit/Brutto und Netto teilen dieselbe serialisierte native Aufrufwarteschlange; die bestehende Monatsrechnung behält ihre Schnittstelle und Ergebnisse. Es werden ausschließlich rohe `sections` gelesen, keine nativen Views, Labels oder Layout-Daten. SQL-Projektionen und native Quellen bleiben unverändert.
2. **Bestehende Verbraucher und Cache:** `analysis-salary.ts`, `use-prepared-analysis-salary.ts`, `analysis-month-data.tsx`, `analysis-warmup-runtime.ts`, `analysis-background-preparation.tsx`, `use-automatic-net-pay.ts` und neue kleine Netto-Hooks. Monatskarte, Gehaltsdetails und Hintergrundvorbereitung verwenden denselben vollständigen bestehenden Gehalts-Cache; geänderte Netto-Eingaben oder Engine-Versionen erhalten andere Schlüssel. `premium-details-screen.tsx` darf ausschließlich am bisherigen SFN-Datenanschluss angepasst werden; alle JSX-Ausdrücke müssen bytegleich bleiben. Der deaktivierte Pfad behält das bisherige Verhalten und die Formate.
3. **Prüfungen und Vorbereitung:** gezielte Brücken-/Hook-/Cache-Regressionen, ein echter Rust-WASM-/SQLite-Vergleich, ein eigener Paket-2-Scope-Prüfer, generierter Cache-Vertrag und exakte Einträge im bestehenden Quellreview. Die akzeptierte TestFlight-Baseline und die historischen Paket-1-Prüfer bleiben unverändert. Die nativen Dateien bleiben gegen das Paket-1-Importmanifest gesichert.

Neue Prüfdateien sind auf die Netto-Brücke, deren Integration, einen gezielten PC-Prüflauf und den Paket-Scope beschränkt. Sonstige Bildschirme, Formulare, Anzeigehelfer, Exportansichten, native Dateien und Regelpakete dürfen nicht geändert werden.

`persistent-salary-value.ts` darf ausschließlich einen schmalen Export der vorhandenen Netto-Ergebnisprüfung erhalten. So prüft der neue Adapter dasselbe Datenformat wie der bisherige Gehalts-Cache. Der vorhandene Cache-Typ und die bestehende Datenbank bleiben unverändert; Detailseiten lesen zunächst den vollständigen gespeicherten Gehaltsstand und berechnen eine noch fehlende einzelne Netto-Prognose über die vorhandene Warteschlange.

## Abnahme

- Paket 1 bleibt fachlich und im bestehenden Hook-Verhalten unverändert.
- Rust und bisherige TypeScript-Berechnung liefern dieselben geprüften Netto-Werte und Fehlerzustände; native UI-Ausgaben werden vor dem Adapter entfernt.
- Veraltete Ergebnisse werden bei Eingabewechsel oder Abbruch nicht eingeblendet. Unveränderte Eingaben werden aus dem vorhandenen Cache wiederverwendet.
- Native und sichtbare Monatsaufträge können sich nicht gegenseitig durch Besitzerwechsel entwerten.
- Alle gerenderten JSX-Ausdrücke der betroffenen Dateien bleiben unverändert; die übrige UI bleibt vollständig bytegleich zur Paket-1-Referenz.
- Fachtests, Scope-Schutz, `npm.cmd run verify:fast`, iOS-Export mit aktiviertem Netto-Anschluss und der tatsächliche Build-54-Runtime-Abgleich bestehen.
- Nach einer separat freigegebenen Preview-OTA: bekannte Nettowerte, Details, Neustart und Änderung/Rücknahme einer Dienst-Endzeit auf dem iPhone prüfen. TestFlight bleibt unverändert.
