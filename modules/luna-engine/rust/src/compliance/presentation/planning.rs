use super::{facts, number_text, policy, summary, text, weekend_facts};
use serde_json::{Value, json};

fn free_time(minutes: f64) -> String {
    let hours = (minutes / 60.0).floor();
    let rest = minutes % 60.0;
    let mut result = Vec::new();
    if hours != 0.0 {
        result.push(format!("{} Std.", number_text(hours)));
    }
    if rest != 0.0 {
        result.push(format!("{} Min.", number_text(rest)));
    }
    if result.is_empty() {
        "0 Min.".into()
    } else {
        result.join(" ")
    }
}
pub fn present(issue: &Value, fallback: &str) -> Value {
    let facts = facts::valid(&issue["facts"], text(issue, "rule"));
    let policy = &policy()["planning"];
    if let Some(facts) = facts {
        let rule = text(facts, "rule");
        if matches!(rule, "PLANNING_NIGHT_SERIES" | "PLANNING_NIGHT_RECOVERY")
            && let Some(sequence) = facts.get("nightSequence")
        {
            let minimum = sequence["recoveryStatus"] == "under24";
            let short_recovery = minimum || sequence["recoveryStatus"] == "under48";
            let long_series = rule == "PLANNING_NIGHT_SERIES";
            let count = number_text(facts["count"].as_f64().unwrap());
            let title = if long_series {
                format!(
                    "{}{count} Nächte in Folge",
                    if sequence["countIsMinimum"] == true {
                        "Mindestens "
                    } else {
                        ""
                    }
                )
            } else {
                format!(
                    "Erholung nach {}{count} Nächten",
                    if sequence["countIsMinimum"] == true {
                        "mindestens "
                    } else {
                        ""
                    }
                )
            };
            let rest = sequence["restMinutes"].as_f64();
            let observation = rest
                .map(|minutes| format!("Danach {} frei.", free_time(minutes)))
                .unwrap_or_else(|| {
                    if sequence["recoveryStatus"] == "open" {
                        "Die freie Zeit danach ist noch offen.".into()
                    } else {
                        "Die freie Zeit danach ist noch unklar.".into()
                    }
                });
            let recommendation = if long_series {
                format!(
                    "Empfohlen sind höchstens 3 Nächte in Folge{}.",
                    if short_recovery {
                        format!(
                            " und danach {} Stunden frei",
                            if minimum {
                                "mindestens 24"
                            } else {
                                "möglichst 48"
                            }
                        )
                    } else {
                        String::new()
                    }
                )
            } else {
                format!(
                    "Empfohlen sind {} Stunden freie Zeit.",
                    if minimum {
                        "mindestens 24"
                    } else {
                        "möglichst 48"
                    }
                )
            };
            let sources = if long_series {
                policy["nightSources"].clone()
            } else {
                json!([policy["nightSources"][1]])
            };
            let explanation = rest
                .filter(|_| !long_series)
                .map(|minutes| format!("Bis zum nächsten Dienst sind {} frei.", free_time(minutes)))
                .unwrap_or_else(|| observation.clone());
            return json!({"title":title,"compactTitle":title,"compactSummary":observation,"summary":[observation],"explanation":explanation,"recommendation":recommendation,"recoveryNote":null,"policyNote":"Die Prüfung nutzt deine erfassten Dienstzeiten. Sie sagt nicht, wie erholt du persönlich bist.","scientificNight":true,"sources":sources});
        }
        if rule == "PLANNING_WEEKEND_RECOVERY" {
            let assessment = &facts["assessment"];
            let selected = weekend_facts::affected(assessment).min_by(|a, b| {
                a["freeCount"]
                    .as_f64()
                    .unwrap()
                    .total_cmp(&b["freeCount"].as_f64().unwrap())
                    .then_with(|| text(b, "until").cmp(text(a, "until")))
                    .then_with(|| text(b, "from").cmp(text(a, "from")))
            });
            if let Some(selected) = selected {
                let one = selected["freeCount"].as_f64() == Some(1.0);
                let title = if one {
                    "1 freies Wochenende in 4 Wochen"
                } else {
                    "Kein freies Wochenende in 4 Wochen"
                };
                return json!({"title":title,"compactTitle":title,"compactSummary":"Empfohlen sind mindestens 2 freie Wochenenden.","summary":["Empfohlen sind mindestens 2 freie Wochenenden in 4 Wochen."],"explanation":if one {"In diesem Zeitraum ist 1 Wochenende frei."} else {"In diesem Zeitraum ist kein Wochenende frei."},"recommendation":"Empfohlen sind mindestens 2 freie Wochenenden in 4 Wochen.","recoveryNote":null,"scientificNight":false,"policyNote":"Ein freies Wochenende umfasst Samstag und Sonntag. Gezählt werden vier volle Wochen von Montag bis Sonntag; dies ist keine gesetzliche Mindestgrenze. Unvollständige Zeiträume lösen keinen Befund aus.","sources":[policy["weekendSource"]],"weekendAssessment":assessment,"weekendPeriod":{"from":selected["from"],"until":selected["until"]}});
            }
        }
        if rule == "PLANNING_7_DAYS" {
            let count = number_text(facts["count"].as_f64().unwrap());
            return json!({"title":format!("{count} Diensttage in Folge"),"compactTitle":format!("{count} Diensttage in Folge"),"compactSummary":"Empfohlen: höchstens 5 Diensttage in Folge.","summary":["Empfohlen sind höchstens 5 Diensttage in Folge."],"explanation":format!("Du hast {count} Diensttage in Folge eingetragen."),"recommendation":"Empfohlen sind höchstens 5 Diensttage in Folge.","policyNote":"Gezählt werden Tage, an denen ein Dienst beginnt. Diese Empfehlung ist keine gesetzliche oder tarifliche Grenze.","recoveryNote":null,"scientificNight":false,"sources":[policy["bauaHandbook"]]});
        }
    }
    if issue["rule"] == "PLANNING_LATE_EARLY" {
        let mut source = policy["nightSources"][0].clone();
        source["context"] =
            json!("Empfehlung zu kurzen Vorwärtswechseln zwischen den Schichtarten.");
        let mut output = json!({"title":"Spät- und Frühdienst direkt nacheinander","summary":["Die BGW empfiehlt die Schichtfolge Früh–Spät–Nacht."],"explanation":"Auf den Spätdienst folgt am nächsten Tag ein Frühdienst.","recommendation":"Empfohlen ist die Reihenfolge Früh–Spät–Nacht.","policyNote":"Die freie Zeit zwischen den Diensten wird zusätzlich gesetzlich geprüft.","recoveryNote":null,"scientificNight":false,"sources":[source]});
        if facts.is_some_and(|f| f["rule"] == "PLANNING_LATE_EARLY") {
            output["compactTitle"] = json!("Spät- und Frühdienst direkt nacheinander");
            output["compactSummary"] = json!("Empfohlen: Vorwärtswechsel Früh–Spät–Nacht.");
        }
        return output;
    }
    json!({"title":fallback,"summary":[],"explanation":issue["description"],"recommendation":null,"recoveryNote":null,"scientificNight":false,"sources":[]})
}
pub fn card_summary(issue: &Value, hint: &Value) -> Vec<String> {
    let facts = facts::valid(&issue["facts"], text(issue, "rule"));
    if issue["rule"] == "PLANNING_NIGHT_SERIES" {
        let mut result = vec![format!(
            "Empfohlen: höchstens {} Nächte in Folge.",
            crate::compliance::policy::FIRST_NIGHT_HINT - 1
        )];
        if let Some(sequence) = facts
            .filter(|f| f["rule"] == "PLANNING_NIGHT_SERIES")
            .and_then(|f| f.get("nightSequence"))
            && let Some(rest) = sequence["restMinutes"].as_f64()
            && matches!(text(sequence, "recoveryStatus"), "under24" | "under48")
        {
            result.push(format!("Danach {} frei.", summary::duration(rest)));
        }
        return result;
    }
    if let Some(facts) = facts.filter(|f| f["rule"] == "PLANNING_NIGHT_RECOVERY") {
        return vec![
            if facts["nightSequence"]["recoveryStatus"] == "under24" {
                "Empfohlen: mindestens 24 Stunden freie Zeit."
            } else {
                "Empfohlen: möglichst 48 Stunden freie Zeit."
            }
            .to_owned(),
        ];
    }
    match text(issue, "rule") {
        "PLANNING_7_DAYS" => vec![format!(
            "Empfohlen: höchstens {} Diensttage in Folge.",
            crate::compliance::policy::FIRST_WORK_SERIES_HINT - 1
        )],
        "PLANNING_LATE_EARLY" => vec!["Empfohlen: Vorwärtswechsel Früh–Spät–Nacht.".into()],
        "TIME_GROSS_OVER_16H" => vec!["Dauer und Uhrzeiten prüfen.".into()],
        _ => {
            let values = hint["summary"].as_array().unwrap();
            if values.is_empty() {
                vec!["Einordnung in den Details prüfen.".into()]
            } else {
                values
                    .iter()
                    .map(|v| v.as_str().unwrap().to_owned())
                    .collect()
            }
        }
    }
}
