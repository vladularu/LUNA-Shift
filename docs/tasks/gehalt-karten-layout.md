# Gehalt: Kartenreihenfolge und zentrierter Hinweis

Ziel: Unter der Monatsnavigation zuerst Gesamtbrutto, danach die Auswahl des Zulagenmonats und die Zusammensetzung anzeigen. Den Hinweis zur fehlenden Jahressonderzahlung mit LUNAs Seitenabstand zentrieren.

Plattform: iPhone, Expo SDK 57.0.31. Nur Darstellung; Berechnung, Daten, native Integration und bestehende Master-Gestaltung bleiben erhalten.

Dateiscope: `salary-payroll-content.tsx`, `annual-salary-payment-editor.tsx`, optionale Textausrichtung in `net-pay-workflow-controls.tsx`, bestehender Reihenfolgetest in `net-pay-automatic-screen.component.test.tsx`, diese Notiz und vier gezielte Quellhashfreigaben im Review-Manifest.

Preview-Nachweis: iOS-OTA-Gruppe `ec680935-426e-4659-a1ed-6ec4e7a8ecd6`, Update `01a1c56f-aea9-75c2-ac4c-fff7c9b4bacd`, Runtime `402e757d98ca799660ce5dd15a24bd999cf690eb`, Build 49. Der ausgelieferte Hinweis ist im Nutzer-Screenshot zentriert und eingerückt. Die Kartenreihenfolge ist dort nicht sichtbar; der vorhandene Komponententest prüft sie. Keine weitergehende Geräteabnahme wird behauptet.

Git-Abgleich: Am 10.11.2026 ausdrücklich beauftragt. Nur die vier Layout-Deltas aus dem SHA-geprüften OTA-Archiv werden auf aktuellem Master integriert. Unabhängige Preview-Änderungen bleiben im Preview-Checkout erhalten. Prüfung mit gezielten Gehalts-/Netto-/Jahressonderzahlungs-Tests, `verify:fast`, vollständiger PR-CI und abschließendem Quellvergleich.
