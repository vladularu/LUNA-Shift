use super::model::{ComplianceError, text};
use serde_json::{Value, json};

pub struct IssueSpec<'a> {
    pub severity: &'a str,
    pub kind: &'a str,
    pub rule: &'a str,
    pub title: &'a str,
    pub description: &'a str,
    pub date: Option<&'a str>,
    pub facts: Option<&'a Value>,
}
impl<'a> IssueSpec<'a> {
    pub fn new(
        severity: &'a str,
        kind: &'a str,
        rule: &'a str,
        title: &'a str,
        description: &'a str,
    ) -> Self {
        Self {
            severity,
            kind,
            rule,
            title,
            description,
            date: None,
            facts: None,
        }
    }
    pub fn on_date(mut self, date: &'a str) -> Self {
        self.date = Some(date);
        self
    }
    pub fn with_facts(mut self, facts: &'a Value) -> Self {
        self.facts = Some(facts);
        self
    }
    pub fn from_json(value: &'a Value) -> Result<Self, ComplianceError> {
        Ok(Self {
            severity: text(value, "severity")?,
            kind: text(value, "kind")?,
            rule: text(value, "rule")?,
            title: text(value, "title")?,
            description: text(value, "description")?,
            date: value
                .get("date")
                .map(|value| value.as_str().ok_or(ComplianceError::InvalidInput))
                .transpose()?,
            facts: value.get("facts"),
        })
    }
}
pub fn create_issue<'a>(
    spec: IssueSpec<'_>,
    related: impl IntoIterator<Item = &'a Value>,
) -> Result<Value, ComplianceError> {
    let related: Vec<&Value> = related.into_iter().collect();
    let ids: Vec<&str> = related
        .iter()
        .map(|shift| text(shift, "id"))
        .collect::<Result<_, _>>()?;
    let date = match spec.date {
        Some(date) => date,
        None => related
            .last()
            .map(|shift| text(shift, "date"))
            .transpose()?
            .unwrap_or("0000-00-00"),
    };
    let mut sorted = ids.clone();
    sorted.sort_by(|left, right| left.encode_utf16().cmp(right.encode_utf16()));
    let id = format!("{}:{date}:{}", spec.rule, sorted.join(","));
    let mut issue = json!({"id":id,"severity":spec.severity,"kind":spec.kind,"rule":spec.rule,"title":spec.title,"description":spec.description,"relatedShiftIds":ids,"date":date});
    if let Some(facts) = spec.facts {
        issue
            .as_object_mut()
            .ok_or(ComplianceError::InvalidInput)?
            .insert("facts".into(), facts.clone());
    }
    Ok(issue)
}
pub fn german_quantity(value: f64, capitalize: bool) -> Result<String, ComplianceError> {
    if !value.is_finite() {
        return Err(ComplianceError::InvalidInput);
    }
    let value = if value == 5.0 {
        "fünf".to_owned()
    } else if value == 6.0 {
        "sechs".to_owned()
    } else if value == 7.0 {
        "sieben".to_owned()
    } else if value == 0.0 {
        "0".to_owned()
    } else {
        super::model::number_label(value)?
    };
    if capitalize {
        let mut chars = value.chars();
        let Some(first) = chars.next() else {
            return Ok(value);
        };
        Ok(format!("{}{}", first.to_uppercase(), chars.as_str()))
    } else {
        Ok(value)
    }
}
