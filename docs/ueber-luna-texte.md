# Texte auf „Über LUNA Shift“

Ziel: kurze, freundliche Texte zur eigenen App; keine Erwähnung anderer Dienstplan-Apps. Die Version zeigt die App-Version ohne technischen SDK-Zusatz. Zielplattform: iPhone, iOS Preview Build 54; Textänderung gilt auch auf den übrigen Plattformen. Expo SDK 57 (`~57.0.32`); Referenz: https://docs.expo.dev/versions/v57.0.0/config/app/.

Nicht-Ziele: Layout, Header, natives Glas, Navigation, Berechnungen und übrige Info-Seiten. Der bestätigte Layoutstand der gezeigten Über-Seite bleibt erhalten. Dateiscope: Info-Screen, ergänzender App-Version-Export, bestehender About-Test, exakte Quellvergleichseinträge und dieses Dokument. Branch: `codex/ueber-luna-texte`.

Abnahme: neue Texte und reine App-Version sichtbar; keine Fremdmarke auf der Über-Seite; native Kopfzeile, Scrollfläche und Zurückbutton erhalten. Verifikation: bestehende Info-/Theme-Komponententests, `npm.cmd run verify:fast`, iOS-Export. Neue Textdarstellung anschließend auf dem iPhone prüfen. Kein Commit, Push, nativer Build oder neue OTA freigegeben.

## Lokale Prüfung

`npm.cmd run verify:fast` ist bestanden: 11141 Logiktests, 2170 Komponententests in 225 Suites und die weiteren Projektprüfungen. Die 26 gezielten Info-/Theme-Tests sind ebenfalls bestanden. iOS-Export erfolgreich; Runtime unverändert `642bfaefe006b4d4d3114c76973debf29b16036d`, alle 34 Assets erhalten. Der Quellvergleich zur zuletzt veröffentlichten Preview zeigt ausschließlich den Info-Screen und den neuen App-Version-Export als geänderte App-Quellen.

Prüfnachweise und Export: `C:/Users/veron/.codex/tmp/ueber-luna-texte/`. Die neue Textfassung wurde noch nicht als OTA veröffentlicht; iPhone-Abnahme dieser Texte steht aus. Das gezeigte Layout der vorigen Preview wurde mit „Super so“ bestätigt.
