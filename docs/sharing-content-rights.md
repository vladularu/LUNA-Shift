# Teilen: Inhalte und Rechte

Ziel: Supershift-Ablauf in LUNA mit Schichten, Terminen und optionalen Notizen; Einladung mit diesen Rechten, anschließend getrennt pro Person änderbar. Neue Einladungen werden direkt angenommen, bleiben 48 Stunden für mehrere Personen nutzbar und zeigen die tatsächliche Anzahl der Beitritte. Ältere Einladungen behalten ihre bisherige Bestätigung und Einmalregel. Notizen sind anfangs aus.

Plattform: iOS, bestehender Expo-SDK-57-Runtime. Keine neuen nativen Module. Kalendergeometrie und Widgets bleiben unverändert.

Arbeitspakete: (1) additive Supabase-Migration und Rechteprüfungen; (2) DTO, SQLite-Consent, Übertragung und Cache; (3) LUNA-Auswahl und nur lesbare Notizen. Scope: Sharing-Domain, Sharing-Projektion/Runtime/Cloud/Repository, Sharing-Screen, geteilter Editor, zugehörige Tests, SQL-Migration und Dokumentation.

Abnahme: Rechte gelten für genau die gewählte Person, auch bei direktem RPC-Aufruf; ältere Clients bekommen unveränderte Antwortformen; reduzierte Rechte erzwingen einen vollständigen Cache-Ersatz; Eigentümer-Revisionsnummer bleibt bei Rechteänderungen stabil; Notizen gelangen nur nach ausdrücklicher Auswahl in die Cloud; Wiederherstellung startet keine Veröffentlichung. Bestehende Sharing-Tests sowie verify:fast müssen bestehen. Visuelle iPhone-Abnahme separat.

Freigabe: Umsetzung einschließlich Server-Erweiterung beauftragt. Commit, Push, OTA und neuer nativer Build sind für dieses Paket noch nicht freigegeben.

Die additive Migration `202610130002_sharing_content_rights.sql` verändert keine alte Migration. V2-Freigaben haben eigene RPCs; V1-Antwortformen bleiben streng kompatibel. Die Inhaltsrevision einer Person erzwingt beim Entziehen von Rechten den vollständigen Ersatz ihres Caches, ohne die Veröffentlichungsrevision des Eigentümers zu verändern. Bei alten untypisierten Einträgen werden beschränkte Inhalte bis zur nächsten Veröffentlichung ausgeblendet.

Neue Links werden ausschließlich auf dem Gerät des ausstellenden Kontos gespeichert, damit Link und QR nach einem App-Neustart wieder geöffnet werden können. Abgelaufene Links werden bereinigt; Konto-Wechsel, Abmeldung und Wiederherstellung entfernen die gespeicherten Einladungsschlüssel. Nach Abmeldung ist ein neuer Link erforderlich, ältere reine Server-Hashes lassen sich nicht in Rohlinks zurückverwandeln. Ein Versand öffnet weiterhin nur einen vom Benutzer zu sendenden Entwurf.

Die Freigabe von Terminen gilt ausdrücklich auch für später eingetragene Termine. Bestehende selektive Terminfreigaben werden bei der bloßen Protokollumstellung nicht auf alle Termine ausgeweitet. Rechte können auf anderen Geräten desselben Eigentümers geändert werden; neue Inhaltsfreigaben werden vom veröffentlichenden Gerät beim nächsten Sync übernommen. Wiederhergestellte Bindungen bleiben bis zur bisherigen ausdrücklichen Bestätigung pausiert.

Auch nach dem manuellen Fortsetzen einer wiederhergestellten Bindung bleiben die Notiz- und Terminfreigaben zurückgesetzt. Früher am Server hinterlegte Rechte dürfen diese lokale Auswahl nicht automatisch erweitern; dafür ist eine neue ausdrückliche Inhaltsauswahl auf dem veröffentlichenden Gerät erforderlich.

Prüfbelege: `artifacts/sharing-content-rights/`. `verify:fast` erfolgreich mit 450 Unit-Dateien / 8.714 Prüfungen, 135 Komponenten-Suiten / 1.095 Prüfungen und 46 Serverprüfungen. Der letzte Abgleich von Konto-Wechsel und Wiederherstellung wurde zusätzlich mit 109 fokussierten Unit-Prüfungen, erneuter Typ-/Lint-Prüfung und einem neuen iOS-Export geprüft. Im Widget-Checkout bestehen Typprüfung sowie 95 fokussierte Sharing-/Restore-/Widget-Prüfungen; die 46 SQL-Prüfungen schließen die vorhandene Echtzeit-Synchronisation ein. Diese Belege ersetzen keine iPhone-Abnahme.

Der Production-Fingerprint entspricht unverändert Build 5: `4a9747e5fdc6a52760d6955a95584cdd1e85607e`. Release-Reihenfolge: bestehende Sharing-Migration bestätigen, additive Echtzeit-Migration `202610130001_sharing_realtime.sql` und Inhaltsrechte-Migration `202610130002_sharing_content_rights.sql` anwenden, V2-Capability prüfen, dann die versiegelte Production-OTA veröffentlichen. Die neue Oberfläche schaltet Inhaltsrechte erst frei, wenn der Server V2 bestätigt. Servermigrationen und OTA sind noch nicht ausgeführt; auch kein Commit, Push oder nativer Build.
