# Onboarding für Krankenhauspflege · 03.11.2026

Ziel: Die überflüssige Frage „Wo arbeitest du?“ samt allgemeiner Berufsauswahl entfernen.
LUNA richtet sich an Pflegepersonal im Krankenhaus. Neue Profile erhalten deshalb den
bestehenden Berufsbereich `HEALTHCARE` automatisch.

Neuer Ablauf: Arbeitszeit und Bundesland → Gehalt → Prüfen und starten. Das neue Logo
bleibt am Einstieg sichtbar. Tarifwahl, manuelles Brutto und „Später einrichten“ bleiben
verfügbar; ein Krankenhaus legt noch keinen einzelnen Tarifvertrag fest.

Nicht-Ziele: Neue Tarife, geänderte Gehaltsberechnung, automatische Tarifzuordnung,
Migration oder Änderung vorhandener Profile, weitere Einstellungen und native Assets.

Zielplattform: iPhone; funktionale Prüfung in Komponenten, visuelle Abnahme im internen
Preview auf dem echten iPhone weiterhin erforderlich. Expo SDK `~57.0.31`.

Arbeitsstand: bestehender Branch `codex/neue-luna-logos`, Basis `c56c2ff`. Die bereits
umgesetzten Logos bleiben erhalten; das unabhängige Hauptarbeitsverzeichnis bleibt unberührt.

Dateiscope: `onboarding-screen.tsx` und sein Komponententest im Onboarding-Verzeichnis,
Entfernung von `onboarding-industry.tsx`, Übernahme des weiter benötigten Häkchens nach
`onboarding-check.tsx` sowie diese Dokumentation.

Abnahmekriterien:

- Einstieg direkt bei „Wie viel arbeitest du?“, Fortschritt 1/3 bis 3/3, kein Branchenauswahl-
  oder Berufsbereich-Bearbeitungsschritt mehr.
- Arbeitszeit, Bundesland und Feiertagsregion werden weiterhin geprüft; Bearbeiten und
  Zurück erhalten den Entwurf, Gehalt bleibt optional.
- Neu angelegte Profile speichern `HEALTHCARE`; Preview und bestehende Profile werden
  nicht überschrieben.
- Gezielte Onboarding-Tests und `npm.cmd run verify:fast` bestehen.

Commit, Push, Build, OTA und Veröffentlichung benötigen weiterhin getrennte Freigaben.

## Lokaler Prüfstand

- Gezielte Onboarding- und Logo-Prüfung: 2 Suiten mit 34 Tests bestanden.
- `npm.cmd run verify:fast`: Exit 0; 544 Unit-Testdateien mit 10.375 Tests,
  192 Komponentensuiten mit 1.812 Tests und alle anschließenden Skriptprüfungen bestanden.
- TypeScript, Lint, Formatierung und `git diff --check`: bestanden.
- Protokoll: `artifacts/onboarding-krankenhaus-20261103/verify-fast.log`.
- Offen: Sicht- und Bedienprüfung des neuen Einstiegs auf dem echten iPhone im internen
  Preview. Tests ersetzen die visuelle Geräteabnahme nicht.

Es wurden kein Commit, Push, Build oder OTA und keine Veröffentlichung ausgeführt.
