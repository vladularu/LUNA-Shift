//! Complete provenance and confidence of original youth findings.
use super::{TrainingDay, TrainingEvent};
use crate::rules::RulePackage;
use serde_json::{Value, json};
use std::collections::BTreeSet;
#[derive(Clone, Copy)]
pub(super) struct Context<'a> {
    pub legal: &'a RulePackage,
    pub facts: &'a Value,
}
impl<'a> Context<'a> {
    pub fn day(day: &TrainingDay<'a>) -> Self {
        Self {
            legal: day.legal,
            facts: day.facts_context,
        }
    }
}
pub(super) struct Prelude<'a> {
    pub context: Option<Context<'a>>,
    pub event: TrainingEvent,
}
pub(super) struct Book<'a> {
    month: &'a str,
    pub findings: Vec<Value>,
    keys: BTreeSet<(String, &'static str)>,
}
impl<'a> Book<'a> {
    pub fn new(month: &'a str) -> Self {
        Self {
            month,
            findings: vec![],
            keys: BTreeSet::new(),
        }
    }
    pub fn report(&mut self, context: Option<Context<'_>>, event: &TrainingEvent) {
        if !event.date.starts_with(self.month)
            || !self.keys.insert((event.date.clone(), event.code))
        {
            return;
        }
        let severity = if event.severity == "WARNING"
            && context.is_some_and(|c| c.facts["otherExceptions"] != false)
        {
            "INCOMPLETE"
        } else {
            event.severity
        };
        let source_ids = context
            .map(|c| {
                let rules = &c.legal.rules()["youthProtection"];
                if event.code.starts_with("EXAM") && rules.get("exam").is_some() {
                    rules["exam"]["sourceIds"].clone()
                } else {
                    rules["sourceIds"].clone()
                }
            })
            .unwrap_or_else(|| json!([]));
        self.findings.push(json!({"date":event.date,"code":event.code,"severity":severity,"message":event.message,"section":event.section,"shiftIds":event.shift_ids,"packageId":context.map(|c|c.legal.package_id.as_str()),"versionId":context.map(|c|c.legal.version_id.as_str()),"sourceIds":source_ids}));
    }
}
pub(super) fn notice<'a>(
    date: &str,
    context: Option<Context<'a>>,
    code: &'static str,
    message: &'static str,
    section: &'static str,
    ids: Vec<String>,
) -> Prelude<'a> {
    Prelude {
        context,
        event: TrainingEvent {
            day_date: date.into(),
            date: date.into(),
            code,
            severity: "INCOMPLETE",
            message: message.into(),
            section,
            shift_ids: ids,
        },
    }
}
