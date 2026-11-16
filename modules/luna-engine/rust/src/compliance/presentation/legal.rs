use super::{facts, number_text, policy, summary, text};
use serde_json::{Value, json};

pub fn present(issue: &Value) -> Value {
    let rule = text(issue, "rule");
    let facts = facts::valid(&issue["facts"], rule);
    let number = |key: &str| facts.unwrap()[key].as_f64().unwrap();
    let duration = |key: &str| summary::duration(number(key));
    let description = match facts.map(|v| text(v, "rule")) {
        Some("ARBZG_3_MAX_10H") => format!(
            "Erfasst: {} netto · Prüfmaßstab: {}.",
            duration("netMinutes"),
            duration("maximumMinutes")
        ),
        Some("ARBZG_3_OVER_8H") => format!(
            "Erfasst: {} netto. Ausgleich prüfen.",
            duration("netMinutes")
        ),
        Some("ARBZG_4_BREAK") => format!(
            "Erfasst: {} Min. Pause · Prüfmaßstab: {} Min.",
            number_text(number("recordedBreakMinutes")),
            number_text(number("requiredBreakMinutes"))
        ),
        Some("ARBZG_4_INTERRUPTION") => format!(
            "{} Min. Unterbrechung. Tatsächliche Pausenlage prüfen.",
            number_text(number("interruptionMinutes"))
        ),
        Some("ARBZG_4_CONTINUOUS") => format!(
            "Prüfmaßstab: höchstens {} ohne Pause.",
            duration("maximumContinuousMinutes")
        ),
        Some("ARBZG_5_REST_10H" | "JARBSCHG_13_REST") => format!(
            "Erfasst: {} Ruhezeit · Prüfmaßstab: {}.",
            duration("restMinutes"),
            duration("minimumRestMinutes")
        ),
        Some("ARBZG_5_REST_11H") => format!(
            "Erfasst: {} Ruhezeit. Ausgleich prüfen.",
            duration("restMinutes")
        ),
        Some("TIME_PLAUSIBILITY") => format!(
            "{} Min. Pause bei {} Min. Dienstspanne. Zeitangaben prüfen.",
            number_text(number("breakMinutes")),
            number_text(number("grossMinutes"))
        ),
        _ if matches!(rule, "DATA_DUPLICATE" | "SHIFT_OVERLAP") => "Zeitangaben prüfen.".into(),
        _ => "Einordnung in den Details prüfen.".into(),
    };
    let policy = &policy()["legal"];
    let sources = policy["sourceRules"].get(rule).cloned().unwrap_or_else(|| {
        if policy["youthSections"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r == rule)
        {
            policy["sourceRules"]["JARBSCHG_13_REST"].clone()
        } else {
            json!([])
        }
    });
    json!({"summary":description,"sources":sources})
}
