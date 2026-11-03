# LUNA Shift Markenreferenz

Der sichtbare Produktname lautet exakt `LUNA Shift`. Seit dem Markenpaket vom 03.11.2026
werden die gelieferten LS- und LUNA-Shift-Logos mit gelber Mondsichel verwendet.

Die Originale sind unverändert übernommen:

- `logo-horizontal-light.png` / `logo-horizontal-dark.png`: transparente Kombination quer
  aus `LUNA_Shift_Brand_Paket`, dunkle beziehungsweise weiße Schrift mit gelber Mondsichel;
  für das bestehende kompakte Onboarding.
- `logo-stacked-light.png` / `logo-stacked-dark.png`: transparente Kombination hoch aus
  demselben Markenpaket; für den nativen Startbildschirm.
- `app-icon-final-20-light.png` / `app-icon-final-20-dark.png`: die 1024-Pixel-RGB-Originale
  aus dem **separaten** `LUNA_Shift_AppIcon_Final_20.zip`. Die LS-Geometrie ist dort bereits
  um 20 Prozent vergrößert. Die älteren Icons im Markenpaket werden nicht verwendet.

`npm.cmd run assets` übernimmt die separaten App-Icon-Master bytegleich nach
`assets/images/icon.png` und `icon-dark.png`. Tinted-, Favicon- und Android-Varianten
werden aus diesen Mastern abgeleitet. Android erhält transparente Vordergründe mit
zusätzlichem Platz für Systemmasken. Die Splash-Logos werden proportional verkleinert.
Der Renderer `jimp-compact` stammt aus der im Lockfile fixierten Expo-Bildwerkzeugkette.

Ältere Referenzdateien bleiben als Historie erhalten. App-Icons und nativer Startbildschirm
benötigen einen neuen Preview-Build und eine iPhone-Abnahme; OTA allein ersetzt sie nicht.

Die iOS-Produktion verwendet `com.lunashift.app`. Expo-Slug und URL-Schema `pflegeshift`,
die Android-ID `com.pflegeshift.app`, die interne ID `com.pflegeshift.app.internal` sowie
bestehende Datenbank- und SecureStore-Namen bleiben unverändert. Den getrennten Build- und
Datenübertragungsplan beschreibt `docs/branding.md`.
