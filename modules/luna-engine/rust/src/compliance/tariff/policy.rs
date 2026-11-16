//! Pinned source policy text and review bounds, compiled with the native engine.
use serde_json::Value;
use std::sync::OnceLock;
pub(crate) fn data() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_str(include_str!("policies.json"))
            .expect("audited compiled tariff policy constants")
    })
}
pub(super) fn family(family: &str) -> Option<&'static Value> {
    data()["policies"].get(family)
}
pub(super) fn scope_source() -> &'static Value {
    &data()["scopeSource"]
}
pub(super) fn weekly_assumption() -> &'static str {
    data()["weeklyAssumption"]
        .as_str()
        .expect("compiled policy assumption")
}
