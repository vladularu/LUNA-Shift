# LUNA: bestätigter Einstieg, Preview-OTA

Grundlage ist der bestätigte Entwurf 04 vom 16.10.2026. Freigegeben sind die Umsetzung und danach ein iOS-OTA für `preview`. Git-Veröffentlichung, native Builds und Production/TestFlight sind nicht freigegeben.

## Arbeitspakete

1. **Einstieg:** Bildmarke aus den Originalreferenzen für Hell und Dunkel, separat gesetzter App-Name, ohne Hintergrundkachel. Slogan exakt: „Schichtdienst ist kompliziert genug. Dein Dienstplan sollte es nicht sein.“ Kurze Einblendungen und Auswahlrückmeldungen, bei reduzierter Bewegung ohne Animation.
2. **Arbeitszeit:** Prozent und Wochenstunden sofort sichtbar. Slider bleibt erhalten; 50/75/80/100 Prozent können direkt gewählt werden. Bei einer gültigen Prozentangabe erhält ein Wechsel der Vollzeitbasis den Prozentwert. Stunden außerhalb des Sliderbereichs werden durch den Basiswechsel nicht abgeschnitten. Arbeitsort und tatsächliche regionale Feiertagsauswahl bleiben erforderlich.
3. **Gehalt und Zusammenfassung:** „Nach Tarif“ öffnet direkt die visuelle Auswahl. Alle sieben bestehenden Tarife bleiben verfügbar, mit ihren bisherigen Gruppen, Stufen, Ausbildungsjahren, Regionen und Prüfregeln. Manuelles Brutto und Überspringen bleiben möglich. Die Zusammenfassung folgt der Eingabereihenfolge; jede beschriftete Zeile ist vollständig antippbar. Übernehmen prüft und übernimmt die Korrektur, Zurück verwirft den Bearbeitungsentwurf. Speichersperre, Fehler/Retry und Testmodus ohne Speicherung bleiben erhalten.

## Technik und Scope

Expo ~57.0.22 / React Native 0.86.3. Die vorhandenen React-Native-Mischmodi und SVG-Masken stellen die unveränderten Logo-Originale passend zum Modus dar. Dafür sind keine neue native Bibliothek, Berechtigung oder Konfigurationsänderung nötig. Der globale App-Look, Kalender, Tageseditor, sichtbare Informationen und „Wecker“ sind nicht Teil dieser Änderung.

Die Tarifauswahl verwendet die bestehenden Optionen und fachlichen Helfer. VKA und TdL sind als Arbeitgeberverbände bezeichnet; ihre offiziellen Logos werden nicht als eigene Logos der Tarifverträge ausgegeben. TV-H und TV-UK tragen neutrale Textkürzel.

Logoquellen: vom Nutzer bereitgestellte Referenzen 2 und 5, unverändert kopiert. VKA: <https://vka.de/wp-content/themes/vka/public/build/assets/logo-CMkTT5-c.svg>. TdL: <https://www.tdl-online.de/typo3temp/assets/_processed_/e/0/csm_logo_33327bde9d.png>.

## Prüfung und Auslieferung

Fokussierte Tests decken alle Tarifwege, manuelles Gehalt, Überspringen, Stunden und Feiertagsregionen, Rücknavigation, Zusammenfassungsänderungen, Speicherfehler, Wiederholen und den Modus ohne Speicherung ab. Zusätzlich werden Typprüfung, das vollständige `verify:fast`, Release-Konfiguration, reale App-Webansichten und der iOS-Export geprüft.

Die Preview-Runtime muss mit dem vorhandenen internen Build übereinstimmen. Das OTA ersetzt das gesamte JavaScript-Bundle; deshalb bleibt der zuvor veröffentlichte Preview-Quellstand mit allen bisherigen Text- und Ablaufkorrekturen erhalten. Die geprüften Quellen werden vor/nach Tests, Export und Veröffentlichung gehasht.

Die finale Geräteabnahme erfolgt anschließend auf dem iPhone: Einstieg in Hell/Dunkel, Schriftvergrößerung, reduzierte Bewegung, Slider ziehen, Tarif/Gehalt/Überspringen sowie Korrekturen in der Zusammenfassung. Automatisierte Tests und ein erfolgreicher OTA-Upload ersetzen diesen Nachweis nicht.
