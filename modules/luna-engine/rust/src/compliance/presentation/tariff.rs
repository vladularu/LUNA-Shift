use super::{facts::integer, policy, text};
use serde_json::{Value, json};
use std::collections::BTreeSet;

pub fn present(input: &Value) -> Value {
    let evidence = &input["evidence"];
    let policy = &policy()["tariff"];
    let rule = text(evidence, "ruleId");
    let sunday = rule == "TARIFF_FREE_SUNDAY";
    let week = rule == "TARIFF_WEEK_DAYS";
    let free_days = rule == "TARIFF_FREE_DAYS";
    let unavailable = evidence["status"] == "UNAVAILABLE"
        || rule == "TARIFF_SCOPE"
        || evidence["source"]["url"] == policy["scopeUrl"];
    let count = integer(&evidence["count"]).filter(|n| *n > 0 && *n <= if week { 7 } else { 14 });
    let requirements = evidence["requirements"].as_array().unwrap();
    let translations = policy["translations"].as_array().unwrap();
    let translate = |value: &Value| {
        translations
            .iter()
            .find(|row| row[0] == *value)
            .map(|row| &row[1])
    };
    let mut seen = BTreeSet::new();
    let constraints = requirements
        .iter()
        .filter_map(&translate)
        .flat_map(|values| values.as_array().unwrap())
        .filter(|value| seen.insert(value.as_str().unwrap()))
        .filter(|constraint| {
            (unavailable || **constraint != policy["scope"])
                && !(!unavailable && (sunday || free_days) && **constraint == policy["fortnight"])
                && !(week && **constraint == policy["regularWork"])
                && !(sunday && **constraint == policy["unrecordedFree"])
        })
        .cloned()
        .collect::<Vec<_>>();
    let original = requirements
        .iter()
        .filter(|r| translate(r).is_none())
        .cloned()
        .collect::<Vec<_>>();
    let description = text(input, "description");
    let mut output = if unavailable {
        let summary = requirements
            .iter()
            .find(|requirement| {
                policy["unavailableCauses"]
                    .as_array()
                    .unwrap()
                    .contains(requirement)
            })
            .and_then(translate)
            .and_then(|values| values.as_array())
            .and_then(|v| v.first())
            .unwrap_or(&policy["insufficient"]);
        json!({"title":"Tarifprüfung eingeschränkt","summary":summary,"limitation":"Gesetzliche Prüfungen bleiben davon unabhängig.","status":"unavailable","constraints":constraints,"originalRequirements":original})
    } else {
        let title = if sunday && count == Some(2) {
            "2 Sonntage hintereinander mit Dienst".into()
        } else if let Some(count) = count.filter(|_| week) {
            format!("{count} Diensttage in einer Kalenderwoche")
        } else if let Some(count) = count.filter(|_| free_days) {
            format!("{count} Tage mit Dienst in zwei Wochen")
        } else if crate::input::trim_javascript(text(input, "title")).is_empty() {
            "Tarifhinweis".into()
        } else {
            crate::input::trim_javascript(text(input, "title")).to_owned()
        };
        let average = evidence["source"]["url"] == policy["tvukUrl"];
        let summary = if sunday {
            format!(
                "{} auf einen Sonntag fallen.",
                if constraints.contains(&policy["regularSundays"]) {
                    "Bei regelmäßiger Sonn- und Feiertagsarbeit soll von zwei freien Tagen innerhalb von zwei Wochen einer"
                } else {
                    "Von zwei freien Tagen innerhalb von zwei Wochen soll einer"
                }
            )
        } else if week {
            format!(
                "Der Tarif sieht {}fünf Arbeitstage vor, bei betrieblichen Gründen auch sechs.",
                if average { "durchschnittlich " } else { "" }
            )
        } else if free_days {
            format!(
                "Bei regelmäßiger Sonn- und Feiertagsarbeit sind in zwei Wochen zwei {}freie Tage vorgesehen.",
                if average { "zusammenhängende " } else { "" }
            )
        } else {
            "Für diesen Zeitraum ist ein Tarifhinweis hinterlegt.".into()
        };
        let limitation = if sunday || free_days {
            policy["fortnight"].clone()
        } else if week {
            policy["weeklyAssumption"].clone()
        } else {
            json!("Für eine genauere Aussage reichen die verfügbaren Tarifangaben nicht aus.")
        };
        let status = match text(evidence, "status") {
            "PENDING" => "planned",
            "DEVIATION" => "deviation",
            _ => "observation",
        };
        json!({"title":title,"summary":summary,"limitation":limitation,"status":status,"constraints":constraints,"originalRequirements":original})
    };
    if !crate::input::trim_javascript(description).is_empty() {
        output["originalDescription"] = json!(description);
    }
    output
}
