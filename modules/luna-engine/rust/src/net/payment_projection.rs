//! Move Rust-created source-month claims into a cash month; never reprice them.
use super::payment_schedule::{
    PAYMENT_GROUPS, PaymentGroup, PaymentPreferences, SalaryPerspective, ScheduleError,
    salary_component_payment_month, salary_payment_required_months, salary_payment_sources,
};
use serde::Serialize;
use serde::ser::SerializeStruct;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// Built by the Rust gross provider. No Deserialize implementation is offered.
#[derive(Debug, Clone)]
pub struct SalaryPaymentSource {
    pub(crate) month: String,
    pub(crate) profile: Arc<Value>,
    pub(crate) profile_serialization:
        Option<Arc<crate::employment::profile_view::FullEmploymentProfileView>>,
    pub(crate) shifts: Arc<Vec<Value>>,
    pub(crate) pay: Value,
}
impl Serialize for SalaryPaymentSource {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut value = serializer.serialize_struct("SalaryPaymentSource", 4)?;
        value.serialize_field("month", &self.month)?;
        match &self.profile_serialization {
            Some(profile) => value.serialize_field("profile", profile.as_ref())?,
            None => value.serialize_field("profile", self.profile.as_ref())?,
        }
        value.serialize_field("shifts", self.shifts.as_ref())?;
        value.serialize_field("pay", &self.pay)?;
        value.end()
    }
}
impl SalaryPaymentSource {
    pub fn month(&self) -> &str {
        &self.month
    }
    pub fn profile(&self) -> &Value {
        self.profile_serialization
            .as_ref()
            .map_or(self.profile.as_ref(), |profile| profile.full_value())
    }
    pub fn calculation_profile(&self) -> &Value {
        &self.profile
    }
    pub fn shifts(&self) -> &[Value] {
        &self.shifts
    }
    pub fn pay(&self) -> &Value {
        &self.pay
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentContribution {
    pub group: String,
    pub claim_month: String,
    pub payment_month: Option<String>,
    pub amount_cents: i64,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SalaryPaymentProjection {
    pub month: String,
    pub perspective: SalaryPerspective,
    pub pay: Value,
    pub sources: Vec<SalaryPaymentSource>,
    pub contributions: Vec<PaymentContribution>,
    pub outgoing_contributions: Vec<PaymentContribution>,
    pub issues: Vec<Value>,
    pub warnings: Vec<String>,
    pub available: bool,
}

#[derive(Debug, Clone, Copy)]
pub enum ProjectionError {
    Schedule(ScheduleError),
    MissingSource,
    InvalidSource,
}
impl From<ScheduleError> for ProjectionError {
    fn from(error: ScheduleError) -> Self {
        Self::Schedule(error)
    }
}
impl std::fmt::Display for ProjectionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Schedule(error) => error.fmt(f),
            Self::MissingSource => f.write_str("Die Gehaltsgrundlage des Anspruchsmonats fehlt."),
            Self::InvalidSource => {
                f.write_str("Die Gehaltsgrundlage des Anspruchsmonats ist ungültig.")
            }
        }
    }
}
impl std::error::Error for ProjectionError {}

fn number(value: &Value) -> Result<f64, ProjectionError> {
    value
        .as_f64()
        .filter(|value| value.is_finite())
        .ok_or(ProjectionError::InvalidSource)
}
fn cents(amount: f64) -> Result<i64, ProjectionError> {
    let value = amount * 100.0;
    let rounded = if value.fract() == -0.5 {
        value.ceil()
    } else {
        value.round()
    };
    if !rounded.is_finite() || rounded.abs() > crate::money::MAX_SAFE_INTEGER as f64 {
        return Err(ProjectionError::InvalidSource);
    }
    Ok(rounded as i64)
}
fn euros(cents: i64) -> Value {
    if cents % 100 == 0 {
        json!(cents / 100)
    } else {
        json!(cents as f64 / 100.0)
    }
}
fn monthly_allowance(pay: &Value) -> Result<bool, ProjectionError> {
    let value = if pay["confirmedAllowance"].is_null() {
        &pay["assessment"]["suggestedAllowance"]
    } else {
        &pay["confirmedAllowance"]
    };
    Ok(value
        .as_str()
        .ok_or(ProjectionError::InvalidSource)?
        .ends_with("_MONTHLY"))
}
fn group_amount(source: &SalaryPaymentSource, group: PaymentGroup) -> Result<f64, ProjectionError> {
    let monthly = monthly_allowance(&source.pay)?;
    match group {
        PaymentGroup::Premiums => number(&source.pay["timePremiumAmount"]),
        PaymentGroup::MonthlyAllowance => {
            if monthly {
                number(&source.pay["allowanceAmount"])
            } else {
                Ok(0.0)
            }
        }
        PaymentGroup::HourlyAllowance => {
            if monthly {
                Ok(0.0)
            } else {
                number(&source.pay["allowanceAmount"])
            }
        }
        PaymentGroup::Overtime => number(&source.pay["overtimeAmount"]),
        PaymentGroup::SpecialDuty => {
            if source.pay["specialDutyAmount"].is_null() {
                Ok(0.0)
            } else {
                number(&source.pay["specialDutyAmount"])
            }
        }
    }
}
fn independently_known(source: &SalaryPaymentSource, group: PaymentGroup) -> bool {
    if !source.profile["manualMonthlyGrossCents"].is_null()
        && [
            "tariff",
            "nursingTrainingTariff",
            "vkaETariff",
            "tvlKrTariff",
            "tvhKrTariff",
            "tvUkNursingTariff",
            "tvalPflegeTariff",
        ]
        .iter()
        .all(|key| !super::js_truthy(&source.profile[key]))
    {
        return true;
    }
    if group == PaymentGroup::MonthlyAllowance {
        return source
            .pay
            .get("confirmedAllowance")
            .is_none_or(|value| !value.is_null());
    }
    group == PaymentGroup::HourlyAllowance
        && !source.pay["confirmedAllowance"].is_null()
        && source.pay["confirmedAllowance"]
            .as_str()
            .is_some_and(|value| value == "NONE" || value.ends_with("_MONTHLY"))
}
fn warning(values: &mut Vec<String>, seen: &mut BTreeSet<String>, value: String) {
    if seen.insert(value.clone()) {
        values.push(value);
    }
}

/// The provider computes each requested source from raw Rust profile/shift facts.
/// It is an internal Rust callback; the wire accepts no precomputed source pay.
pub fn project_salary_payment<F>(
    month: &str,
    perspective: SalaryPerspective,
    preferences: &PaymentPreferences,
    mut provider: F,
) -> Result<SalaryPaymentProjection, ProjectionError>
where
    F: FnMut(&str) -> Result<SalaryPaymentSource, ProjectionError>,
{
    let sources = salary_payment_required_months(month, preferences, perspective)?
        .iter()
        .map(|month| provider(month))
        .collect::<Result<Vec<_>, _>>()?;
    let by_month: BTreeMap<_, _> = sources
        .iter()
        .map(|source| (source.month.as_str(), source))
        .collect();
    let current = by_month
        .get(month)
        .copied()
        .ok_or(ProjectionError::MissingSource)?;
    let same_month = perspective == SalaryPerspective::Payout
        && sources.len() == 1
        && PAYMENT_GROUPS
            .into_iter()
            .map(|group| salary_component_payment_month(preferences, month, group))
            .collect::<Result<Vec<_>, _>>()?
            .iter()
            .all(|target| target.as_deref() == Some(month));
    let mut outgoing = vec![];
    if perspective == SalaryPerspective::Payout {
        for group in PAYMENT_GROUPS {
            let target = salary_component_payment_month(preferences, month, group)?;
            let amount = cents(group_amount(current, group)?)?;
            if target.as_deref() != Some(month) && amount > 0 {
                outgoing.push(PaymentContribution {
                    group: group.label().into(),
                    claim_month: month.into(),
                    payment_month: target,
                    amount_cents: amount,
                });
            }
        }
    }
    let base = if current.pay["personalBaseAmount"].is_null() {
        0.0
    } else {
        number(&current.pay["personalBaseAmount"])?
    };
    let mut contributions = vec![
        PaymentContribution {
            group: "BASE".into(),
            claim_month: month.into(),
            payment_month: Some(month.into()),
            amount_cents: cents(base)?,
        },
        PaymentContribution {
            group: "CARE_ALLOWANCE".into(),
            claim_month: month.into(),
            payment_month: Some(month.into()),
            amount_cents: cents(number(&current.pay["careAllowanceAmount"])?)?,
        },
        PaymentContribution {
            group: "TARIFF_ALLOWANCE".into(),
            claim_month: month.into(),
            payment_month: Some(month.into()),
            amount_cents: cents(number(&current.pay["tvoedAllowanceAmount"])?)?,
        },
    ];
    let mut issues = vec![];
    let mut warnings = vec![];
    let mut seen = BTreeSet::new();
    warning(&mut warnings,&mut seen,"Gehaltsbeträge sind Prognosen. Prüfe die Ansprüche und Auszahlungsmonate anhand deiner Abrechnung.".into());
    if (!super::js_truthy(&current.pay["available"])
        && current.pay.get("knownGrossAmount").is_none())
        || current.pay["personalBaseAmount"].is_null()
    {
        issues.push(json!({"kind":"UNAVAILABLE","month":month,"message":format!("Die Gehaltsgrundlage für {month} fehlt. Prüfe deine Gehaltsangaben.")}));
    }
    for group in PAYMENT_GROUPS {
        let plan = if perspective == SalaryPerspective::Earned {
            super::payment_schedule::PaymentSources {
                months: vec![month.into()],
                unresolved_months: vec![],
            }
        } else {
            salary_payment_sources(preferences, month, group)?
        };
        for unresolved in plan.unresolved_months {
            issues.push(json!({"kind":"UNCONFIGURED","month":unresolved,"group":group,"message":format!("Der Auszahlungszeitpunkt für Ansprüche aus {unresolved} fehlt. Richte die Auszahlungsmonate ein.")}));
        }
        for claim in plan.months {
            let source = by_month
                .get(claim.as_str())
                .copied()
                .ok_or(ProjectionError::MissingSource)?;
            let target = salary_component_payment_month(preferences, &claim, group)?;
            contributions.push(PaymentContribution {
                group: group.label().into(),
                claim_month: claim.clone(),
                payment_month: target.clone(),
                amount_cents: cents(group_amount(source, group)?)?,
            });
            if perspective == SalaryPerspective::Earned && target.is_none() {
                warning(&mut warnings,&mut seen,"Der Auszahlungszeitpunkt ist noch nicht eingerichtet. Die Ansicht zeigt den Anspruchsmonat.".into());
            }
            let partial = source.pay.get("knownGrossAmount").is_some();
            if !super::js_truthy(&source.pay["available"])
                && (!partial || group == PaymentGroup::SpecialDuty)
            {
                issues.push(json!({"kind":"UNAVAILABLE","month":claim,"group":group,"message":if partial {format!("Für Bereitschaften aus {claim} fehlen noch Abrechnungsangaben.")} else {format!("Ansprüche aus {claim} konnten nicht vollständig berechnet werden. Prüfe die Gehaltsangaben und Dienste dieses Monats.")}}));
            }
            if !same_month
                && (claim.as_str() < month || group == PaymentGroup::MonthlyAllowance)
                && source.shifts.is_empty()
                && !preferences.reviewed_empty_months.contains(&claim)
                && !independently_known(source, group)
            {
                issues.push(json!({"kind":"MISSING_MONTH","month":claim,"group":group,"message":format!("Für {claim} fehlen Dienste. Ergänze den Monat oder bestätige ausdrücklich, dass keine Dienste vorliegen.")}));
            }
            if !same_month
                && [
                    PaymentGroup::MonthlyAllowance,
                    PaymentGroup::HourlyAllowance,
                ]
                .contains(&group)
                && source.pay["confirmedAllowance"].is_null()
                && super::js_truthy(&source.pay["assessment"]["requiresConfirmation"])
                && source.pay["assessment"]["criteria"]
                    .as_array()
                    .is_some_and(|criteria| {
                        criteria
                            .iter()
                            .any(|criterion| criterion["state"] == "OPEN")
                    })
                && !independently_known(source, group)
            {
                issues.push(json!({"kind":"UNAVAILABLE","month":claim,"group":group,"message":format!("Für die Zulage aus {claim} fehlen erforderliche Angaben. Prüfe den Zulagenanspruch und deine Schichtmodell-Angaben.")}));
            }
            if source.pay["confirmedAllowance"].is_null()
                && number(&source.pay["allowanceAmount"])? != 0.0
            {
                warning(
                    &mut warnings,
                    &mut seen,
                    format!(
                        "Die Zulage für {claim} ist ein Vorschlag. Prüfe den Anspruch für diesen Monat."
                    ),
                );
            }
            if let Some(note) = source.pay["assessment"]["estimateNote"]
                .as_str()
                .filter(|note| !note.is_empty())
            {
                warning(&mut warnings, &mut seen, note.into());
            }
        }
    }
    let sum = |groups: &[&str]| {
        contributions
            .iter()
            .filter(|part| groups.contains(&part.group.as_str()))
            .map(|part| part.amount_cents)
            .sum::<i64>()
    };
    let selected = |groups: &[&str]| {
        sources
            .iter()
            .filter(|source| {
                contributions.iter().any(|part| {
                    part.claim_month == source.month && groups.contains(&part.group.as_str())
                })
            })
            .collect::<Vec<_>>()
    };
    let special = selected(&["SPECIAL_DUTY"]);
    let available = issues.is_empty();
    let known_gross = if !available
        && issues.iter().all(|issue| {
            issue["kind"] == "UNAVAILABLE"
                && issue["group"] == "SPECIAL_DUTY"
                && issue["month"]
                    .as_str()
                    .and_then(|month| by_month.get(month))
                    .is_some_and(|source| source.pay.get("knownGrossAmount").is_some())
        }) {
        Some(
            contributions
                .iter()
                .map(|part| part.amount_cents)
                .sum::<i64>(),
        )
    } else {
        None
    };
    let mut pay = current.pay.clone();
    let object = pay.as_object_mut().ok_or(ProjectionError::InvalidSource)?;
    object.insert("available".into(), json!(available));
    if let Some(known) = known_gross {
        object.insert("knownGrossAmount".into(), euros(known));
    } else {
        object.remove("knownGrossAmount");
    }
    object.insert(
        "shiftBreakdowns".into(),
        json!(
            selected(&["PREMIUMS", "OVERTIME"])
                .iter()
                .flat_map(|source| source.pay["shiftBreakdowns"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .cloned())
                .collect::<Vec<_>>()
        ),
    );
    object.insert("timePremiumAmount".into(), euros(sum(&["PREMIUMS"])));
    object.insert("overtimeAmount".into(), euros(sum(&["OVERTIME"])));
    object.insert(
        "allowanceAmount".into(),
        euros(sum(&["MONTHLY_ALLOWANCE", "HOURLY_ALLOWANCE"])),
    );
    if current.pay.get("specialDutyAmount").is_some()
        || special
            .iter()
            .any(|source| source.pay.get("specialDutyAmount").is_some())
    {
        object.insert("specialDutyAmount".into(), euros(sum(&["SPECIAL_DUTY"])));
    }
    if current.pay.get("specialDutyBreakdowns").is_some()
        || special
            .iter()
            .any(|source| source.pay.get("specialDutyBreakdowns").is_some())
    {
        object.insert(
            "specialDutyBreakdowns".into(),
            json!(
                special
                    .iter()
                    .flat_map(|source| source.pay["specialDutyBreakdowns"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .cloned())
                    .collect::<Vec<_>>()
            ),
        );
    }
    if current.pay.get("specialDutyNotes").is_some()
        || special
            .iter()
            .any(|source| source.pay.get("specialDutyNotes").is_some())
    {
        let mut notes = vec![];
        let mut seen = BTreeSet::new();
        for note in special.iter().flat_map(|source| {
            source.pay["specialDutyNotes"]
                .as_array()
                .into_iter()
                .flatten()
        }) {
            let text = note.as_str().ok_or(ProjectionError::InvalidSource)?;
            if seen.insert(text) {
                notes.push(text);
            }
        }
        object.insert("specialDutyNotes".into(), json!(notes));
    }
    object.insert(
        "estimatedGrossAmount".into(),
        if available {
            euros(
                contributions
                    .iter()
                    .map(|part| part.amount_cents)
                    .sum::<i64>(),
            )
        } else {
            Value::Null
        },
    );
    Ok(SalaryPaymentProjection {
        month: month.into(),
        perspective,
        pay,
        sources,
        contributions,
        outgoing_contributions: outgoing,
        issues,
        warnings,
        available,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // JSON numeric representation (1 versus 1.0) is immaterial after JS parses
    // the native response; cent values and missing/null fields remain exact.
    fn canonical_numbers(value: &mut Value) {
        match value {
            Value::Number(number) if number.is_f64() => {
                let numeric = number.as_f64().expect("finite fixture number");
                if numeric.fract() == 0.0 && numeric.abs() <= crate::money::MAX_SAFE_INTEGER as f64
                {
                    *value = json!(numeric as i64);
                }
            }
            Value::Array(values) => {
                for value in values {
                    canonical_numbers(value);
                }
            }
            Value::Object(values) => {
                for value in values.values_mut() {
                    canonical_numbers(value);
                }
            }
            _ => {}
        }
    }

    #[test]
    fn source_component_projection_matches_frozen_ts_without_wire_computed_sources() {
        let reference: Value = serde_json::from_str(include_str!(
            "../../../reference/payment-projection-golden.json"
        ))
        .expect("projection facts");
        let cases = reference["cases"].as_array().expect("cases");
        assert_eq!(cases.len(), 288);
        for case in cases {
            let input = &case["input"];
            let preferences = super::super::payment_schedule::validate_salary_payment_preferences(
                &input["preferences"],
            )
            .expect("preferences");
            let perspective =
                serde_json::from_value(input["perspective"].clone()).expect("perspective");
            let result = project_salary_payment(
                input["month"].as_str().expect("month"),
                perspective,
                &preferences,
                |month| {
                    let spec = input["sources"]
                        .as_array()
                        .expect("source facts")
                        .iter()
                        .find(|source| source["month"] == month)
                        .ok_or(ProjectionError::MissingSource)?;
                    let mut pay = crate::pay::manual::create_manual_monthly_pay_estimate(
                        month,
                        spec["baseGrossCents"].as_i64().expect("base cents"),
                    )
                    .map_err(|_| ProjectionError::InvalidSource)?;
                    for (key, value) in spec["overrides"]
                        .as_object()
                        .expect("test-only component overrides")
                    {
                        pay[key] = value.clone();
                    }
                    for key in spec["removePayKeys"]
                        .as_array()
                        .expect("optional field removals")
                    {
                        pay.as_object_mut()
                            .expect("pay")
                            .remove(key.as_str().expect("key"));
                    }
                    Ok(SalaryPaymentSource {
                        month: month.into(),
                        profile: Arc::new(spec["profile"].clone()),
                        profile_serialization: None,
                        shifts: Arc::new(spec["shifts"].as_array().expect("shifts").clone()),
                        pay,
                    })
                },
            );
            let mut actual = match result {
                Ok(value) => serde_json::to_value(value).expect("projection"),
                Err(error) => json!({"$error":error.to_string()}),
            };
            let mut expected = case["expected"].clone();
            canonical_numbers(&mut actual);
            canonical_numbers(&mut expected);
            assert_eq!(actual, expected, "{}", case["id"]);
        }
    }
}
