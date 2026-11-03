# Neue LUNA-Logos · 03.11.2026

Ziel: Die gelieferten Logos in das bestehende Onboarding und den nativen Startbildschirm
einfügen. Als App-Icon ausschließlich das separate Final-20-Paket verwenden.

Nicht-Ziele: Änderungen an Onboarding-Texten, Abläufen, Fachlogik, Daten, technischen
Identitäten oder dem übrigen App-Design.

Zielplattform: iPhone in Hell- und Dunkelmodus. Die vorhandenen Android- und Web-Icons
werden aus denselben App-Icon-Mastern nachgeführt; reale Android-Gerätetests bleiben offen.

Basis: `origin/master` bei `c56c2ff72442f5c357c3c042f20f2609f80ef8c6`, eigener Branch
`codex/neue-luna-logos`. Das unabhängig geänderte Hauptarbeitsverzeichnis bleibt unberührt.
Expo SDK: `~57.0.31`, Dokumentation ausschließlich SDK 57.

## Arbeitspaket 1 · Onboarding

Dateiscope: `src/features/onboarding/onboarding-brand.tsx`, bestehender Komponententest
und die beiden neuen `logo-horizontal-*.png` unter `assets/brand/lunashift/`.
Die kompakte Logozeile verwendet die transparente Kombination quer mit gelbem Mond;
Hell-/Dunkelmodus wechseln zwischen dunkler und weißer Schrift. Die bisherigen Slogans,
Reihenfolge, Animation und Reduced-Motion-Unterstützung bleiben erhalten.

## Arbeitspaket 2 · Native Assets

Dateiscope: `app.json`, `scripts/generate-brand-assets.mjs`, neun Bilder unter
`assets/images/`, vier Originale für App-Icon und gestapelte Logos unter
`assets/brand/lunashift/` sowie diese Dokumentation und die Markenreferenzen.

iOS: getrennte Hell-/Dunkel-Icons, Tinted aus derselben Final-20-Geometrie.
Android: dasselbe LS als transparenter adaptiver Vordergrund und monochrome Variante.
Splash: transparente Kombination hoch auf den bestehenden hellen/dunklen Hintergründen.
Die konfigurierte Logobreite beträgt 240 Punkte.

## Abnahme

- Beide App-Icon-Dateien stimmen bytegleich mit den 1024-Pixel-Originalen des separaten
  Final-20-Pakets überein; keine Transparenz oder vorgerundeten Außenkanten.
- Onboarding und Splash erhalten das Seitenverhältnis und vollständige Logo.
- Helle/dunkle Darstellung ist lesbar; VoiceOver nennt die Onboarding-Marke einmal.
- Bestehende Onboarding-Tests, Asset-Prüfungen, `verify:fast` und iOS-Export bestehen.
- Offen: Screenshots und Kaltstartprüfung auf einem echten iPhone mit einem neuen
  internen Preview-Build. Browserbilder und Konfiguration ersetzen diese Abnahme nicht.

## Lokaler Prüfstand

- `npm.cmd run verify:fast`: bestanden, Exit 0; 544 Unit-Testdateien mit 10.375 Tests,
  192 Komponentensuiten mit 1.813 Tests sowie sämtliche anschließenden Skriptprüfungen.
- Gezielte Onboarding-Prüfung: beide Suiten mit insgesamt 35 Tests bestanden.
- iOS-Export mit `APP_VARIANT=internal`: bestanden; beide neuen Onboarding-Logos sind
  als Assets enthalten. Dies ist kein signierter nativer Build.
- Öffentliche Expo-Konfiguration für Internal, Production und Design geprüft; alle
  Varianten verwenden die neuen Icon-Pfade und behalten ihre technischen Identitäten.
- Asset-Prüfung: beide App-Icons bytegleich mit den separaten 1024-Pixel-Originalen,
  vollständig deckend; alle neun generierten Dateien bei wiederholtem Lauf bytegleich.
  Der adaptive Android-Vordergrund liegt vollständig innerhalb der sicheren Kreisfläche.
- Separate Asset-Vorschau in `artifacts/brand-20261103/vorschau.html` visuell geprüft.
  Die vollständige App-Webvorschau scheitert an einem SQLite-Web-Worker-Fehler
  (`Worker chunk not found ... expo-sqlite/web/worker.ts`); die Datenbank-Anbindung
  wurde nicht geändert. Native Darstellung und VoiceOver bleiben auf dem iPhone zu prüfen.

Prüfprotokolle: `artifacts/brand-20261103/verify-fast.log`, `export-ios.log`,
`asset-proof.json` und die drei `expo-config-*.json` im separaten Arbeitsstand.

Das Marken-ZIP enthält kein zentrales Inhaltsverzeichnis. Alle 54 vorhandenen lokalen
Einträge waren vollständig; die verwendeten PNGs wurden mit korrekter Länge und ZIP-CRC
wiedergewonnen. Das separate App-Icon-ZIP besteht die normale ZIP-Integritätsprüfung.

Commit, Push, Build, OTA und Veröffentlichung sind nicht freigegeben und wurden nicht
durchgeführt.
