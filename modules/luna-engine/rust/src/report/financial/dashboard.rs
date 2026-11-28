//! Native financial dashboard props; never a deserializable ready-money wire.
use serde_json::Value;
pub struct DashboardInput<'a> {
    pub month: &'a str,
    pub profile: &'a Value,
    pub pay: Option<&'a Value>,
    pub projection: Option<&'a Value>,
    pub annual_payments: Option<&'a [Value]>,
    pub annual_issue: Option<&'a Value>,
    pub additional_recurring_gross_cents: f64,
    pub projection_pending: bool,
    pub salary_loading: bool,
    pub salary_error: Option<&'a str>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DashboardError;
impl std::fmt::Display for DashboardError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("MONTHLY_DASHBOARD_INVALID")
    }
}
impl std::error::Error for DashboardError {}

fn number(value: Option<&Value>) -> Result<Option<f64>, DashboardError> {
    value
        .filter(|v| !v.is_null())
        .map(|v| v.as_f64().filter(|n| n.is_finite()).ok_or(DashboardError))
        .transpose()
}
fn required_number(value: Option<&Value>) -> Result<f64, DashboardError> {
    number(value)?.ok_or(DashboardError)
}
fn available(pay: &Value) -> bool {
    crate::net::js_truthy(&pay["available"])
}
fn copy_field(out: &mut serde_json::Map<String, Value>, key: &str, value: Option<&Value>) {
    if let Some(v) = value {
        out.insert(key.into(), v.clone());
    }
}
fn nullish(value: Option<&Value>) -> Option<&Value> {
    value.filter(|v| !v.is_null())
}
/// Source-identical payment timing policy. Months originate in native projections.
pub fn payment_hint(projection: &Value) -> Result<Option<String>, DashboardError> {
    use std::collections::BTreeSet;
    let parts = projection["contributions"]
        .as_array()
        .ok_or(DashboardError)?;
    let mut missing = BTreeSet::new();
    for issue in projection
        .get("issues")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if issue["kind"] == "MISSING_MONTH" {
            missing.insert(issue["month"].as_str().ok_or(DashboardError)?);
        }
    }
    let title = |months: &BTreeSet<&str>| -> Result<String, DashboardError> {
        months
            .iter()
            .map(|m| crate::runtime::target_ui::month_title(m).map_err(|_| DashboardError))
            .collect::<Result<Vec<_>, _>>()
            .map(|v| v.join(" und "))
    };
    if !missing.is_empty() {
        return Ok(Some(format!("Zulagen für {} noch offen", title(&missing)?)));
    }
    let month = projection["month"].as_str().ok_or(DashboardError)?;
    let mut older = BTreeSet::new();
    let mut partial = false;
    for part in parts {
        if ![
            "PREMIUMS",
            "MONTHLY_ALLOWANCE",
            "HOURLY_ALLOWANCE",
            "OVERTIME",
            "SPECIAL_DUTY",
            "ABSENCE_PAY",
        ]
        .iter()
        .any(|g| part["group"] == *g)
            || part["paymentMonth"] != month
            || required_number(part.get("amountCents"))? <= 0.0
        {
            continue;
        }
        let claim = part["claimMonth"].as_str().ok_or(DashboardError)?;
        if claim < month {
            older.insert(claim);
        } else if claim == month {
            partial = true;
        }
    }
    if older.is_empty() {
        Ok(None)
    } else {
        Ok(Some(format!(
            "Zulagen {}aus {}",
            if partial { "teilweise " } else { "" },
            title(&older)?
        )))
    }
}
pub fn present(input: &DashboardInput<'_>) -> Result<Value, DashboardError> {
    use serde_json::{Map, json};
    let profile = input.profile.as_object().ok_or(DashboardError)?;
    let selectors = [
        "nursingTrainingTariff",
        "vkaETariff",
        "tvlKrTariff",
        "tvUkNursingTariff",
        "tvhKrTariff",
        "tvalPflegeTariff",
    ];
    let manual = profile.get("tariff") == Some(&Value::Null)
        && selectors.iter().all(|k| nullish(profile.get(*k)).is_none())
        && nullish(profile.get("manualMonthlyGrossCents")).is_some();
    let salary_ready = profile.get("tariff") != Some(&Value::Null)
        || selectors.iter().any(|k| nullish(profile.get(*k)).is_some())
        || nullish(profile.get("manualMonthlyGrossCents")).is_some();
    let recurring = input.additional_recurring_gross_cents;
    if !recurring.is_finite() {
        return Err(DashboardError);
    }
    let estimate = if input.projection_pending {
        None
    } else {
        input
            .projection
            .map(|p| &p["pay"])
            .or(input.pay)
            .filter(|p| available(p) || p.get("knownGrossAmount").is_some())
    };
    let hint = input.projection.map(payment_hint).transpose()?.flatten();
    let monthly = number(estimate.and_then(|p| {
        nullish(p.get("estimatedGrossAmount")).or_else(|| p.get("knownGrossAmount"))
    }))?;
    let annual = input
        .annual_payments
        .and_then(|ps| ps.iter().find(|p| p["payoutMonth"] == input.month));
    let annual_cents = number(annual.and_then(|p| p.get("grossCents")))?.unwrap_or(0.0);
    let annual_gross = annual_cents / 100.0;
    let mut premium = Map::new();
    premium.insert("month".into(), json!(input.month));
    let earned_available = input.pay.is_some_and(available);
    if earned_available {
        copy_field(
            &mut premium,
            "amount",
            input.pay.and_then(|p| p.get("timePremiumAmount")),
        );
        copy_field(
            &mut premium,
            "specialDutyAmount",
            input.pay.and_then(|p| p.get("specialDutyAmount")),
        );
    } else {
        premium.insert("amount".into(), Value::Null);
        premium.insert("specialDutyAmount".into(), json!(0));
    }
    if !salary_ready {
        premium.insert("status".into(), json!("Tarif hinterlegen"));
    } else if !earned_available {
        premium.insert("status".into(), json!("Nicht verfügbar"));
    }
    let error = input.salary_error.filter(|s| !s.is_empty());
    let mut pay = Map::new();
    pay.insert("reserveLoadingSpace".into(), json!(true));
    let status = if !salary_ready {
        Some("Gehalt einrichten")
    } else if input.projection_pending {
        Some("Wird berechnet …")
    } else if error.is_some() || estimate.is_none() {
        Some("Nicht verfügbar")
    } else {
        None
    };
    if let Some(status) = status {
        pay.insert("status".into(), json!(status));
    }
    pay.insert(
        "loading".into(),
        json!(input.salary_loading && estimate.is_some() && error.is_none()),
    );
    if let Some(estimate) = estimate {
        match estimate.get("personalBaseAmount") {
            None => {}
            Some(Value::Null) => {
                pay.insert("base".into(), Value::Null);
            }
            Some(value) => {
                pay.insert(
                    "base".into(),
                    json!(
                        required_number(Some(value))?
                            + if manual { recurring / 100.0 } else { 0.0 }
                    ),
                );
            }
        }
        copy_field(&mut pay, "premiums", estimate.get("timePremiumAmount"));
        copy_field(&mut pay, "overtime", estimate.get("overtimeAmount"));
        let allowances = required_number(estimate.get("allowanceAmount"))?
            + required_number(estimate.get("tvoedAllowanceAmount"))?
            + required_number(estimate.get("careAllowanceAmount"))?
            + number(estimate.get("absencePayAmount"))?.unwrap_or(0.0)
            + number(estimate.get("specialDutyAmount"))?.unwrap_or(0.0)
            + if manual { 0.0 } else { recurring / 100.0 };
        pay.insert("allowances".into(), json!(allowances));
    }
    pay.insert(
        "partial".into(),
        json!(estimate.is_some_and(|p| p.get("knownGrossAmount").is_some())),
    );
    pay.insert(
        "duties".into(),
        json!(
            estimate
                .map(super::annual_salary::incomplete_duties)
                .unwrap_or_default()
        ),
    );
    let gross = monthly.map(|monthly| {
        super::presentation::js_round(monthly * 100.0 + annual_gross * 100.0 + recurring) / 100.0
    });
    if gross.is_some_and(|v| !v.is_finite()) {
        return Err(DashboardError);
    }
    pay.insert("gross".into(), json!(gross));
    pay.insert("annualPayments".into(), json!(annual_gross));
    copy_field(&mut pay, "annualIssue", input.annual_issue);
    if let Some(payments) = input.annual_payments {
        pay.insert(
            "annualPaymentPresent".into(),
            json!(payments.iter().any(|p| p["payoutMonth"] == input.month)),
        );
    }
    let year = input
        .month
        .get(..4)
        .and_then(|y| y.parse().ok())
        .ok_or(DashboardError)?;
    let expected = super::annual_salary::annual_payout_months(
        super::annual_salary::salary_annual_family(input.profile),
        year,
    )
    .map_err(|_| DashboardError)?
    .iter()
    .any(|m| m == input.month);
    pay.insert("annualPaymentExpected".into(), json!(expected));
    pay.insert("manual".into(), json!(manual));
    let caption = error.unwrap_or({
        if !salary_ready {
            "Tarif oder Monatsbrutto hinterlegen"
        } else if let Some(hint) = hint.as_deref() {
            hint
        } else if manual {
            "Manuell hinterlegtes Monatsbrutto"
        } else {
            "Unverbindliche Schätzung"
        }
    });
    pay.insert("caption".into(), json!(caption));
    Ok(json!({"manualSalary":manual,"salaryReady":salary_ready,"premium":premium,"pay":pay}))
}
