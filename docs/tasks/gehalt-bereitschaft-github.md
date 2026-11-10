# GitHub-Abgleich: Gehalt und Bereitschaft

Ziel: die im Gespräch umgesetzten Korrekturen für Jahressonderzahlung und unvollständige Bereitschaftsabrechnung als abgegrenzte GitHub-Änderung sichern.

Basis: aktueller `origin/master` af1a8b09c8c81115ccb82bd96fa27924de7adeb4. Der veröffentlichte Preview-Stand bleibt im ursprünglichen Arbeitsverzeichnis erhalten. Frühere unabhängige Layoutanpassungen werden nicht übernommen; die funktionalen Änderungen werden gegen die archivierte Quelle vor den beiden Gehaltskorrekturen abgeglichen.

Freigabe: Nutzer bestätigt den neuen Preview-Ablauf mit „Passt“ und beauftragt „Commit und github Abgleich“. Referenz ist iOS-Preview-Gruppe b328eac7-5cec-43f6-8bad-52db88065af9, Update 01a1c521-5073-7433-bb0d-70daabf877f4, Runtime 402e757d98ca799660ce5dd15a24bd999cf690eb. Diese Rückmeldung bestätigt den neuen Gehaltsablauf; sie ersetzt keine allgemeine TestFlight-Abnahme.

Scope: konkrete Gründe bei fehlender Jahressonderzahlungsprognose, bestehende Korrektureingaben, sichtbare bekannte Gehaltsbestandteile, direkte Dienstprüfung, ausdrücklich ausgewählte atomare Bereitschaftskorrekturen, passende Anspruchs-/Auszahlungsmonate und konsistente PDF-Werte. Tarifregeln, native Konfiguration, sonstige UI-Anpassungen und weitere Veröffentlichungen gehören nicht zum Abgleich.

Abnahme: vollständiges `verify:fast` auf dem GitHub-Kandidaten, gezielte Gehalts-/Editor-/Exportregressionen, exakte Quellfreigaben und unveränderte akzeptierte TestFlight-Baseline. Anschließend Commit, Push des Themenbranches, Pull Request und vollständige CI. Der GitHub-Abgleich schließt den Merge erst nach erfolgreicher CI ein; weitere Veröffentlichungen bleiben separate Schritte.
