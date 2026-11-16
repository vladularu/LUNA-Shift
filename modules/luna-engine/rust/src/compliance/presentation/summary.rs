use super::{facts, legacy, number_text, text};
use serde_json::Value;

pub fn hours(minutes: f64) -> String {
    let scaled = minutes / 60.0 * 100.0;
    let lower = scaled.floor();
    let rounded = if scaled - lower < 0.5 {
        lower
    } else {
        lower + 1.0
    };
    number_text(rounded / 100.0).replacen('.', ",", 1)
}
pub fn limit(minutes: f64) -> String {
    number_text(minutes / 60.0).replacen('.', ",", 1)
}
pub fn duration(minutes: f64) -> String {
    let rest = number_text(minutes % 60.0);
    format!(
        "{}:{} h",
        number_text((minutes / 60.0).floor()),
        if rest.len() < 2 {
            format!("0{rest}")
        } else {
            rest
        }
    )
}
pub(super) fn compensation(facts: &Value) -> String {
    let parts = text(facts, "compensationDeadline")
        .split('-')
        .collect::<Vec<_>>();
    format!(
        "Ausgleich: mindestens {} Std. Ruhezeit bis {}.{}.{}.",
        limit(facts["compensationMinutes"].as_f64().unwrap()),
        parts[2],
        parts[1],
        parts[0]
    )
}
fn night(count: &Value, sequence: &Value) -> String {
    let series = format!(
        "{}{} Nächte in Folge.",
        if sequence["countIsMinimum"] == true {
            "Mindestens "
        } else {
            ""
        },
        number_text(count.as_f64().unwrap())
    );
    let rest = sequence["restMinutes"]
        .as_f64()
        .map(duration)
        .unwrap_or_else(|| "null".into());
    let explanation = match text(sequence,"recoveryStatus") {
        "under24" => format!("Laut deinen Einträgen liegen danach {rest} ohne Arbeitseinsatz. Prüfe, ob mindestens 24 Stunden, möglichst 48 Stunden, zur Erholung möglich sind."),
        "under48" => format!("Laut deinen Einträgen liegen danach {rest} ohne Arbeitseinsatz. 24 Stunden sind erreicht; möglichst 48 Stunden werden empfohlen."),
        "atLeast48" => format!("Laut deinen Einträgen liegen danach {rest} ohne Arbeitseinsatz. Prüfe, ob sich die Nachtserie verkürzen lässt."),
        "open" => "Prüfe, ob sich die Nachtserie verkürzen lässt. Die anschließende Erholungszeit ist noch offen.".into(),
        _ => "Prüfe, ob sich die Nachtserie verkürzen lässt. Die anschließende Erholungszeit ist mit den vorhandenen Angaben nicht beurteilbar.".into(),
    };
    format!("{series} {explanation}")
}
pub fn issue(issue: &Value) -> String {
    if issue.get("facts").is_none() {
        return legacy::summary(issue);
    }
    let Some(facts) = facts::valid(&issue["facts"], text(issue, "rule")) else {
        return text(issue, "description").to_owned();
    };
    let n = |key: &str| facts[key].as_f64().unwrap();
    let whole = |key: &str| number_text(n(key));
    match text(facts, "rule") {
        "ARBZG_5_REST_10H" => format!("Nur {} Std. Ruhezeit.", hours(n("restMinutes"))),
        "ARBZG_5_REST_11H" => format!(
            "Ruhezeit: {} Std. · {}",
            hours(n("restMinutes")),
            compensation(facts)
        ),
        "ARBZG_4_BREAK" => format!(
            "Pause: {} Min. · nötig: {} Min.",
            whole("recordedBreakMinutes"),
            whole("requiredBreakMinutes")
        ),
        "ARBZG_4_INTERRUPTION" => format!(
            "Pausen prüfen: {} Min. zwischen Diensten.",
            whole("interruptionMinutes")
        ),
        "ARBZG_3_MAX_10H" => format!(
            "{} Std. Arbeitszeit · Grenze: {} Std.",
            hours(n("netMinutes")),
            limit(n("maximumMinutes"))
        ),
        "ARBZG_3_OVER_8H" => format!(
            "{} Std. Arbeitszeit · Ausgleich nötig.",
            hours(n("netMinutes"))
        ),
        "ARBZG_4_CONTINUOUS" => "Pausen im Arbeitsblock prüfen.".into(),
        "TIME_PLAUSIBILITY" => "Pause und Dienstzeiten prüfen.".into(),
        "TIME_GROSS_OVER_16H" => format!(
            "{} Std. Dienstzeit · Eingabe prüfen.",
            hours(n("grossMinutes"))
        ),
        "PLANNING_7_DAYS" => format!("{} Arbeitstage in Folge.", whole("count")),
        "PLANNING_NIGHT_SERIES" if facts.get("nightSequence").is_none() => {
            format!("{} Nachtdienste in Folge.", whole("count"))
        }
        "PLANNING_NIGHT_SERIES" | "PLANNING_NIGHT_RECOVERY" => {
            night(&facts["count"], &facts["nightSequence"])
        }
        "PLANNING_LATE_EARLY" => "Ruhezeit eingehalten · Dienstfolge prüfen.".into(),
        "PLANNING_WEEKEND_RECOVERY" => {
            let free = super::weekend_facts::affected(&facts["assessment"])
                .filter_map(|w| w["freeCount"].as_f64())
                .fold(f64::INFINITY, f64::min);
            format!("{} von 4 Wochenenden vollständig frei.", number_text(free))
        }
        _ => text(issue, "description").to_owned(),
    }
}
