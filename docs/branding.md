# LUNA Shift Marken- und Kompatibilitätsvertrag

## Sichtbare Marke

Der Produktname lautet in App, Systemanzeigen, Benachrichtigungen und Dokumentation exakt
`LUNA Shift`. Das Markenpaket vom 03.11.2026 ergänzt die LS-Bildmarke und die Wortmarke
mit gelber Mondsichel. Transparente Varianten mit dunkler beziehungsweise weißer Schrift
decken helle und dunkle Oberflächen ab.

Die Laufzeitbilder werden reproduzierbar mit `npm.cmd run assets` erzeugt. Quellen und
Zuordnung stehen in `assets/brand/lunashift/README.md`. Für App-Icons gilt ausschließlich
das separat gelieferte Final-20-Paket; seine hellen und dunklen Master bleiben bytegleich.

## Beibehaltene technische Identitäten

Diese Werte bleiben zur Update- und Datenkontinuität absichtlich unverändert:

- Expo-Slug und URL-Schema `pflegeshift`
- Android-ID `com.pflegeshift.app` sowie die interne iOS-/Android-ID `com.pflegeshift.app.internal`
- EAS-Projekt-ID und Update-URL
- npm-Paketname `pflegeshift`
- SQLCipher-Dateinamen und SecureStore-Service-Namen
- native Modul-, TypeScript- und Regelkatalog-Bezeichner mit `PflegeShift`
- bestehende Operator-Secret-Pfade unter `%LOCALAPPDATA%\PflegeShift`
- GitHub-Repository-URL bis zu einer separat freigegebenen Repository-Umbenennung

Diese Namen sind keine sichtbare Produktmarke. Sie dürfen nicht ohne einen eigenen Migrations-,
Build- und Rollback-Plan geändert werden.

## iOS-Produktionsidentität vor dem ersten Store-Eintrag

Die iOS-Produktion verwendet `com.lunashift.app`; der sichtbare Name bleibt `LUNA Shift`.
Apple-Registrierung und App-Store-Connect-Anlage werden separat durchgeführt und geprüft.
Die interne Preview-ID, Android, EAS-Projekt, URL-Schema und Datenhaltung bleiben unverändert.
Ein nativer TestFlight-Build ist erforderlich; eine OTA kann die Bundle-ID nicht ändern.
Die neue App übernimmt keine Daten aus der bisherigen App-Sandbox: Übertragung per lokaler
JSON-Sicherung und Wiederherstellung mit anschließendem Neustarttest auf dem iPhone.
Vor einer Apple-Anlage kann die lokale Konfigurationsänderung zurückgenommen werden;
die bestehende Preview-App bleibt als Rückfalloption installiert. Nach einem Build-Upload
ist die Bundle-ID des App-Store-Connect-Eintrags nicht mehr änderbar.
