use super::super::TrainingDay;
use serde_json::{Value, json};
use std::collections::BTreeSet;
pub(super) struct Spec {
    pub code: &'static str,
    pub severity: &'static str,
    pub message: String,
    pub section: &'static str,
    pub ids: Vec<String>,
}
impl Spec {
    pub fn new(
        code: &'static str,
        severity: &'static str,
        message: impl Into<String>,
        section: &'static str,
        ids: Vec<String>,
    ) -> Self {
        Self {
            code,
            severity,
            message: message.into(),
            section,
            ids,
        }
    }
}
pub(super) struct Book<'a> {
    pub month: &'a str,
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
    pub fn report<'d, 's>(
        &mut self,
        days: &'d [TrainingDay<'s>],
        mut day: Option<&'d TrainingDay<'s>>,
        date: &str,
        spec: Spec,
    ) {
        let mut date = date.to_owned();
        if let Some(original) = day.filter(|day| {
            !day.adult && (spec.code.starts_with("BLOCK_") || spec.code == "WORK_IN_SCHOOL_BLOCK")
        }) && let Some(target) = days
            .iter()
            .find(|d| d.week == original.week && d.adult && d.date.starts_with(self.month))
        {
            day = Some(target);
            date = target.date.clone();
        }
        if !date.starts_with(self.month)
            || day.is_some_and(|day| !day.adult)
            || !self.keys.insert((date.clone(), spec.code))
        {
            return;
        }
        let basis = day.and_then(|d| d.training["training"]["legalBasis"].as_str());
        let sources = match (day, basis) {
            (Some(d), Some("BBIG")) => {
                let bbig = &d.legal.rules()["adultTraining"]["bbig"];
                if spec.code.starts_with("EXAM") && bbig.get("exam").is_some() {
                    bbig["exam"]["sourceIds"].clone()
                } else {
                    bbig["sourceIds"].clone()
                }
            }
            (Some(d), Some("PFLBG")) => {
                d.legal.rules()["adultTraining"]["pflbg"]["sourceIds"].clone()
            }
            _ => json!([]),
        };
        self.findings.push(json!({"code":spec.code,"severity":spec.severity,"date":date,"message":spec.message,"section":spec.section,"shiftIds":spec.ids,"packageId":day.map(|d|d.legal.package_id.as_str()),"versionId":day.map(|d|d.legal.version_id.as_str()),"sourceIds":sources}));
    }
}
pub(super) fn id(entry: &super::super::YouthEntry) -> String {
    entry.shift()["id"]
        .as_str()
        .expect("native entry id")
        .into()
}
