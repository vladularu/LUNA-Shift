use super::facts;
use serde_json::Value;
fn text(value: &Value) -> bool {
    value.as_str().is_some_and(|s| !s.is_empty())
}
fn quantity(value: Option<&Value>) -> bool {
    value.is_none_or(|value| facts::integer(value).is_some())
}
pub fn valid(value: &Value, rule: Option<&str>) -> bool {
    let source = &value["source"];
    let period = &value["period"];
    if !value.is_object()
        || !source.is_object()
        || !period.is_object()
        || !text(&value["tariffLabel"])
        || !text(&value["ruleId"])
        || !matches!(
            value["status"].as_str(),
            Some("REVIEW" | "DEVIATION" | "PENDING" | "UNAVAILABLE")
        )
        || facts::date(&period["from"]).is_none()
        || facts::date(&period["until"]).is_none()
        || period["from"].as_str() > period["until"].as_str()
        || !text(&value["ruleText"])
        || !value["requirements"]
            .as_array()
            .is_some_and(|items| items.iter().all(text))
        || !value.get("recordedDates").is_none_or(|items| {
            items
                .as_array()
                .is_some_and(|items| items.iter().all(|day| facts::date(day).is_some()))
        })
        || !quantity(value.get("count"))
        || !quantity(value.get("limit"))
    {
        return false;
    }
    let policy = crate::compliance::tariff::policy::data();
    let known = |candidate: &Value| {
        !candidate.is_null()
            && ["url", "title", "section", "version"]
                .iter()
                .all(|key| source.get(*key) == candidate.get(*key))
    };
    policy["policies"]
        .as_object()
        .unwrap()
        .values()
        .any(|p| known(&p["source"]) || known(&p["freeSource"]))
        || rule == Some("TARIFF_SCOPE")
            && value["status"] == "UNAVAILABLE"
            && known(&policy["scopeSource"])
}
