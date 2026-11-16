//! Exact historical producer wording; unfamiliar text is retained verbatim.
use super::text;
use serde_json::{Value, json};

fn number(value: &str, decimal: bool) -> bool {
    let mut separator = false;
    let mut digit = false;
    for byte in value.bytes() {
        if byte.is_ascii_digit() {
            digit = true;
        } else if decimal && digit && !separator && matches!(byte, b'.' | b',') {
            separator = true;
            digit = false;
        } else {
            return false;
        }
    }
    digit
}
fn anchored(text: &str) -> &str {
    // The original expressions do not enable multiline matching.
    text
}
fn capture<'a>(value: &'a str, prefix: &str, suffix: &str, decimal: bool) -> Option<&'a str> {
    let raw = anchored(value).strip_prefix(prefix)?.strip_suffix(suffix)?;
    number(raw, decimal).then_some(raw)
}
fn hours(value: &str) -> String {
    let value = value.replacen('.', ",", 1);
    value.strip_suffix(",0").unwrap_or(&value).to_owned()
}
pub(super) fn count(issue: &Value) -> Option<f64> {
    let suffix = match text(issue, "rule") {
        "PLANNING_7_DAYS" => " aufeinanderfolgende Arbeitstage wurden erkannt.",
        "PLANNING_NIGHT_SERIES" => " aufeinanderfolgende Nachtdienste wurden erkannt.",
        _ => return None,
    };
    capture(text(issue, "description"), "", suffix, false)?
        .parse()
        .ok()
}
pub(super) fn summary(issue: &Value) -> String {
    let value = text(issue, "description");
    let matched = match text(issue,"rule") {
        "ARBZG_5_REST_10H" => {
            let body = anchored(value);
            // The optional shortening amount is any decimal, not only ten.
            let short = body.find(" Damit wird auch die für Krankenhäuser und Pflegeeinrichtungen mögliche Verkürzung auf ").and_then(|index| {
                let rest = &body[index+" Damit wird auch die für Krankenhäuser und Pflegeeinrichtungen mögliche Verkürzung auf ".len()..];
                rest.strip_suffix(" Stunden unterschritten.").filter(|n| number(n,true)).map(|_| &body[..index])
            }).unwrap_or(body);
            capture(short,"Zwischen den Diensten liegen nur "," h Ruhezeit.",true).map(|n| format!("Nur {} Std. Ruhezeit.",hours(n)))
        }
        "ARBZG_5_REST_11H" => (|| {
            let value = anchored(value).strip_prefix("Die Ruhezeit beträgt ")?;
            let (rest, tail) = value.split_once(" h. In den eingetragenen Diensten wurde bis ")?;
            if !number(rest,true) { return None; }
            let (deadline, amount) = tail.split_once(" keine noch unbenutzte Ruhezeit von mindestens ")?;
            if deadline.is_empty() || deadline.contains(['\n','\r','\u{2028}','\u{2029}']) { return None; }
            let amount = amount.strip_suffix(" Stunden als Ausgleich erkannt.")?;
            number(amount,true).then(|| format!("Ruhezeit: {} Std. · Ausgleich: mindestens {} Std. Ruhezeit bis {deadline}.",hours(rest),hours(amount)))
        })(),
        "ARBZG_4_BREAK" => (|| {
            let value = anchored(value).strip_prefix("Erfasst sind ")?;
            let (recorded, required) = value.split_once(" Minuten Pause; erforderlich sind mindestens ")?;
            let required = required.strip_suffix(" Minuten.")?;
            (number(recorded,false) && number(required,false)).then(|| format!("Pause: {recorded} Min. · nötig: {required} Min."))
        })(),
        "ARBZG_4_INTERRUPTION" => capture(value,""," Minuten zwischen Diensten könnten die fehlende Pause abdecken. Bitte die tatsächliche Pausenlage prüfen.",false).map(|n| format!("Pausen prüfen: {n} Min. zwischen Diensten.")),
        "ARBZG_3_MAX_10H" => (|| {
            let (net, limit) = anchored(value).split_once(" h Nettoarbeitszeit überschreiten die ")?;
            let limit = limit.strip_suffix("-Stunden-Grenze.")?;
            (number(net,true) && number(limit,true)).then(|| format!("{} Std. Arbeitszeit · Grenze: {} Std.",hours(net),hours(limit)))
        })(),
        "ARBZG_3_OVER_8H" => capture(value,""," h Nettoarbeitszeit erfordern einen zulässigen Ausgleichszeitraum.",true).map(|n| format!("{} Std. Arbeitszeit · Ausgleich nötig.",hours(n))),
        "ARBZG_4_CONTINUOUS" => anchored(value).strip_prefix("Ein zusammenhängender Arbeitsblock überschreitet ").and_then(|v|v.strip_suffix(" Stunden ohne dokumentierte Ruhepause.")).filter(|v| !v.is_empty() && !v.contains(['\n','\r','\u{2028}','\u{2029}'])).map(|_| "Pausen im Arbeitsblock prüfen.".to_owned()),
        "TIME_PLAUSIBILITY" => (value == "Die eingetragene Pause ist länger als die gesamte Brutto-Dienstzeit.").then(|| "Pause und Dienstzeiten prüfen.".into()),
        "TIME_GROSS_OVER_16H" => capture(value,"Die Brutto-Dienstzeit beträgt "," h und sollte auf einen Eingabefehler geprüft werden.",true).map(|n| format!("{} Std. Dienstzeit · Eingabe prüfen.",hours(n))),
        "PLANNING_7_DAYS" => capture(value,""," aufeinanderfolgende Arbeitstage wurden erkannt.",false).map(|n|format!("{n} Arbeitstage in Folge.")),
        "PLANNING_NIGHT_SERIES" => capture(value,""," aufeinanderfolgende Nachtdienste wurden erkannt.",false).map(|n|format!("{n} Nachtdienste in Folge.")),
        "PLANNING_LATE_EARLY" => (value == "Die gesetzliche Ruhezeit ist eingehalten; die kurze Vorwärtsrotation sollte dennoch geprüft werden.").then(|| "Ruhezeit eingehalten · Dienstfolge prüfen.".into()),
        _ => None,
    };
    matched.unwrap_or_else(|| value.to_owned())
}
pub(super) fn rest(issue: &Value, summary: &str) -> Value {
    let mut title = text(issue, "title").to_owned();
    let mut note = summary.to_owned();
    match text(issue,"rule") {
        "ARBZG_5_REST_10H" if summary != text(issue,"description") => {
            if let Some(minimum) = capture(&title,"Ruhezeit unter "," Stunden",true) { note = format!("Mindestens {} Std. Ruhezeit nötig.",minimum.replacen('.',",",1)); }
            title = "Ruhezeit zu kurz".into();
        }
        "ARBZG_5_REST_11H" if summary != text(issue,"description") => {
            if let Some(tail) = summary.strip_prefix("Ruhezeit: ").and_then(|s|s.split_once(" Std. · ")).map(|(_,tail)|tail) { note = tail.to_owned(); }
        }
        "JARBSCHG_13_REST" if anchored(text(issue,"description")).strip_prefix("Zwischen diesen Arbeitstagen liegen ").and_then(|s|s.strip_suffix(" Stunden. Jugendliche brauchen mindestens 12 zusammenhängende Stunden Freizeit (§ 13).")).is_some_and(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit() || b == b',') ) => { note = "Jugendliche brauchen mindestens 12 Std. Ruhezeit.".into(); }
        _ => (),
    }
    json!({"title":title,"note":note})
}
