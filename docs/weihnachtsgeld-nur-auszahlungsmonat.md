# Weihnachtsgeld nur im Auszahlungsmonat

Ziel: Die Gehaltskarte und der Hinweis in den Berechnungsgrundlagen erscheinen nur im aktuell gewählten Auszahlungsmonat. Für den belegten TVöD-Fall ist das November; gespeicherte andere Zahlungsmonate bleiben maßgeblich.
Nicht-Ziele: Keine Änderung von Betrag, Tarifregel, Brutto-/Nettoberechnung oder Speicherung. Keine nativen Änderungen, kein Git-Versand und keine Produktionsveröffentlichung.
Plattform: Expo SDK 57.0.22, iOS Preview Build 41. Ausgangs-OTA: c9f0e94c-73a3-4dd3-80c2-d09bb2cd4549.
Branch: codex/weihnachtsgeld-nur-auszahlungsmonat im bestehenden isolierten Preview-Worktree.
Dateiscope: annual-salary-payment-editor.tsx und dessen Komponententest, salary-details-screen.tsx, net-pay-automatic-screen.component.test.tsx sowie diese Notiz.
Abnahme: Oktober und die anderen Monate außerhalb des Zahlungstermins zeigen keine November-Karte; November zeigt Betrag und Anpassen; verschobene gespeicherte Zahlung erscheint im zugehörigen Monat; Oktober-Grundlagen ohne Weihnachtsgeldhinweis; keine automatische Speicherung oder Rechenänderung. Fokussierte Tests und verify:fast. Nutzerfoto bestätigt den bisherigen Preview-Stand; iPhone-Abnahme dieser Korrektur steht nach Preview-OTA aus.
Die bestehende Freigabe zur iOS-Preview-OTA gilt für diese Folgekorrrektur.
