# TestFlight: aktueller Erststart und vorgemerkte Widgets

## Auftrag vom 19.10.2026

Ziel: Den aktuellen Stand von `master` einschließlich der vorgemerkten Widgetänderungen in einem gemeinsamen iPhone-TestFlight-Build bereitstellen. Die bestehenden Informationen unter TestFlight-Details bleiben erhalten.

Plattform: iOS, Produktions-App `com.lunashift.app`, Kanal `production`.

Basis: `d2c8c3d113743a24f802196504b5e3064e6ede95`, isolierter Branch `codex/testflight-start-widgets`. Expo SDK 57 (`~57.0.22`).

## Arbeitspakete und Dateiscope

1. Native Startprüfung: `app.config.ts` und vorhandene Konfigurationstests. Expo prüft bei jedem Kaltstart und wartet höchstens 8 Sekunden auf ein kompatibles Update. Ein rechtzeitig fertig geladenes Update startet sofort. Danach bleibt die eingebettete beziehungsweise zuletzt geladene Version verfügbar, auch offline. Später abgeschlossene Downloads gelten beim nächsten Kaltstart; während der Nutzung wird kein Neustart ausgelöst.
2. Widgets: die acht vorbereiteten Widgetdateien aus `codex/sharing-widgets-qr`, Einordnung der Synchronisierung innerhalb des bestehenden Sharing-Providers sowie zugehörige Synchronisierungs- und native Pluginprüfungen. Dienstfarben, Personenmarkierung, Ablauf geteilter Daten und Tageslinks erhalten. Die bisherigen vier Widgetansichten bleiben bestehen.
3. Gemeinsame Auslieferung: aktuelle TestFlight-Texte vorab sichern und ihren Inhalt beibehalten; nur die Buildnummer in der Versionszeile aktualisieren. Produktionskonfiguration und Quellmanifest prüfen, einen gemeinsamen nativen iOS-Build erstellen und für TestFlight bereitstellen. Keine App-Store-Veröffentlichung und keine Git-Auslieferung.

Nicht-Ziele: Weitere Sharing-, QR-, Gehalts-, Tarif- oder UI-Änderungen; Änderungen an Testergruppen, Zugangsdaten oder Supabase; OTA für den alten Build. Andere Checkouts bleiben erhalten.

## Abnahme und Grenzen

- `npm.cmd run verify:fast`, relevante Widgettests, native Pluginprüfung, isolierte Widgetlaufzeit und Releaseprüfung erfolgreich.
- Produktions-Bundle-ID, App Group und OTA-Kanal stimmen; aktuelle Funktionen sind eingebettet.
- Frische TestFlight-Installation zeigt den aktuellen Stand beim ersten Öffnen. Ein weiteres kompatibles Update wird bei schnellem Netz beim ersten Start angewendet.
- Offline beziehungsweise bei langsamer Verbindung startet die vorhandene Version nach begrenzter Wartezeit.
- Auf dem iPhone alle vier Widgetansichten, Hell/Dunkel/getönt, geteilte Dienste, Tagesnavigation, Ausblenden/Widerruf und Abmelden prüfen.
- EAS-/Apple-Metadaten und lokale Tests ersetzen diese Geräteabnahme nicht. Downloads über dem Zeitbudget benötigen weiterhin einen späteren Kaltstart.

Dokumentation: [Expo Updates SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/updates/), [Startkonfiguration SDK 57](https://docs.expo.dev/versions/v57.0.0/config/app/#updates), [Widgets SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/widgets/).
