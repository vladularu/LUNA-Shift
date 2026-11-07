# Sortieransichten und Bearbeiten-Pfeile

Dienstvorlagen und „Ansicht anpassen“ verwenden im normalen und im Sortiermodus dieselben Zeilen. Typografie, Farben, Symbole, Textspalten und Abstände wechseln dadurch nicht mehr. Die Dienstvorlagen zeigen im normalen Modus rechts einen Chevron zum bestehenden Editor; beim Sortieren erscheint dort der Verschiebegriff. Der sichtbare Sortierhinweis samt Abstand entfällt. Die VoiceOver-Aktionen, Verschiebegesten, Positionen beim Ablegen und die bestehende Speicherung bleiben erhalten.

Die Preview behält Luftig. Die GitHub-Variante behält ihre vorhandenen Kartenränder und Trennlinien; der Sortiermodus übernimmt jeweils die normale Darstellung. Die Fachlogik, gespeicherte Daten, native Konfiguration und Abhängigkeiten sind nicht Teil dieser Änderung.

## Abnahme

Am 7. November 2026 bestätigte der Nutzer die Sortierkorrektur mit „ja das past“. Abgenommene iOS-Preview: Update `01a1b421-f0c8-797f-b232-2ab73dbd7d39`, Gruppe `17b65ab2-f71f-4e82-becd-f4a1374a6165`, Runtime `402e757d98ca799660ce5dd15a24bd999cf690eb`.

Die OTA enthält zusätzlich den bereits veröffentlichten Vorgänger `01a1b40c-66fe-756d-99ce-587f1a31984f` zur ausgeblendeten Planungshinweiskarte. Dessen fünf Quelldateien wurden bytegenau erhalten. Seine Git-Integration und eine eigene Abnahme werden nicht aus dem Feedback zur Sortierkorrektur abgeleitet.

Die vollständige kombinierte Preview-Prüfung bestand mit 10.450 Unit- und 1.907 Komponententests. Die gezielten Regressionen decken identische Zeilen- und Kartenstile beim Umschalten, große Schrift, Bearbeiten über den Chevron und die bisherigen Verschiebe-/Speicherfälle ab. Das ausgelieferte Bundle und alle 34 Assets wurden gegen den geprüften Export verifiziert. Commit und GitHub-Abgleich erfolgen nach der vereinbarten Abnahme. Eine neue OTA oder TestFlight-Veröffentlichung gehört nicht zu diesem Git-Schritt.
