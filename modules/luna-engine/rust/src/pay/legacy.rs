//! Legacy P-table gross calculations. Family dispatch and dated-period orchestration
//! are separate callers; this module never substitutes a legacy tariff for them.
use super::{
    conditions::{ConditionShift, RuleConditions, conditions_match},
    pattern::is_pay_work_shift,
    premium_minutes::{self, ClassifiedMinutes, PremiumError, PremiumRules},
    tariff::{self, TariffError, TariffProfile},
};
use crate::{
    EngineError,
    rules::RuleResolver,
    time::{self, ShiftTime},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Debug)]
pub enum PayError {
    InvalidInput,
    Time(EngineError),
    Tariff(TariffError),
    Premium(PremiumError),
    Rule(String),
}
impl From<EngineError> for PayError {
    fn from(e: EngineError) -> Self {
        Self::Time(e)
    }
}
impl From<TariffError> for PayError {
    fn from(e: TariffError) -> Self {
        Self::Tariff(e)
    }
}
impl From<PremiumError> for PayError {
    fn from(e: PremiumError) -> Self {
        Self::Premium(e)
    }
}
impl std::fmt::Display for PayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidInput => f.write_str("Invalid gross-pay inputs"),
            Self::Time(e) => e.fmt(f),
            Self::Tariff(e) => e.fmt(f),
            Self::Premium(e) => e.fmt(f),
            Self::Rule(e) => f.write_str(e),
        }
    }
}
impl std::error::Error for PayError {}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PremiumRule {
    id: String,
    label: String,
    premium_type: String,
    rate_basis: String,
    reference_step_id: Option<String>,
    percentage_basis_points: f64,
    conditions: RuleConditions,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PremiumLine {
    pub key: String,
    pub label: String,
    pub minutes: i64,
    pub percentage: f64,
    pub hourly_rate: f64,
    pub amount: f64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftPremiumBreakdown {
    pub shift_id: String,
    pub date: String,
    pub net_minutes: f64,
    pub premium_lines: Vec<PremiumLine>,
    pub overtime_base_amount: f64,
    pub overtime_premium_amount: f64,
    pub total_amount: f64,
}
pub(crate) fn round_money(value: f64) -> f64 {
    ((value + f64::EPSILON) * 100.0 + 0.5).floor() / 100.0
}
fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str, PayError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or(PayError::InvalidInput)
}
fn rate_for(
    rule: &PremiumRule,
    profile: &TariffProfile,
    date: &str,
    individual: f64,
    resolver: &RuleResolver,
) -> Result<f64, PayError> {
    if rule.rate_basis == "INDIVIDUAL_HOURLY" {
        return Ok(individual);
    }
    let step = rule.reference_step_id.as_deref().ok_or_else(|| {
        PayError::Rule(format!(
            "Premium rule {} requires a reference step.",
            rule.id
        ))
    })?;
    Ok(tariff::get_hourly_table_amount_for_step(profile, date, step, resolver)?.unwrap_or(0.0))
}

pub fn calculate_shift_for_profile(
    shift: &Value,
    profile: &Value,
    resolver: &RuleResolver,
) -> Result<ShiftPremiumBreakdown, PayError> {
    calculate_shift_from_classified(shift, profile, resolver, None)
}

fn calculate_shift_from_classified(
    shift: &Value,
    profile: &Value,
    resolver: &RuleResolver,
    classified: Option<&ClassifiedMinutes>,
) -> Result<ShiftPremiumBreakdown, PayError> {
    let id = string(shift, "id")?.to_owned();
    let date = string(shift, "date")?;
    let eligible = is_pay_work_shift(shift);
    let raw_tariff = profile.get("tariff").ok_or(PayError::InvalidInput)?;
    let tariff = if raw_tariff.is_null() {
        None
    } else {
        Some(TariffProfile::deserialize(raw_tariff).map_err(|_| PayError::InvalidInput)?)
    };
    let package = tariff::get_tariff_rule_package(date, resolver);
    let net = if eligible {
        time::shift_minutes(
            &ShiftTime::deserialize(shift).map_err(|_| PayError::InvalidInput)?,
            string(profile, "timeZone")?,
        )?
    } else {
        0.0
    };
    let mut output = ShiftPremiumBreakdown {
        shift_id: id,
        date: date.to_owned(),
        net_minutes: net,
        premium_lines: vec![],
        overtime_base_amount: 0.0,
        overtime_premium_amount: 0.0,
        total_amount: 0.0,
    };
    let (Some(tariff), Some(package)) = (tariff, package) else {
        return Ok(output);
    };
    if !eligible {
        return Ok(output);
    }
    let individual = tariff::get_individual_hourly_rate(&tariff, date, resolver)?.unwrap_or(0.0);
    let buckets = match classified {
        Some(buckets) => std::borrow::Cow::Borrowed(buckets),
        None => {
            let span = premium_minutes::span_from_shift(shift, profile)?;
            let classifier = PremiumRules::from_json(package.rules())?;
            std::borrow::Cow::Owned(premium_minutes::count_premium_minutes(
                shift,
                profile,
                &span,
                &classifier,
                resolver,
                None,
            )?)
        }
    };
    let rules: Vec<PremiumRule> = Vec::deserialize(
        package
            .rules()
            .get("premiumRules")
            .ok_or(PayError::InvalidInput)?,
    )
    .map_err(|_| PayError::InvalidInput)?;
    for rule in rules.iter().filter(|r| r.premium_type != "OVERTIME") {
        let minutes = buckets.by_rule_id.get(&rule.id).copied().unwrap_or(0);
        let rate = rate_for(rule, &tariff, date, individual, resolver)?;
        if minutes <= 0 {
            continue;
        }
        let key = match rule.premium_type.as_str() {
            "HOLIDAY_WITH_TIME_OFF" | "HOLIDAY_WITHOUT_TIME_OFF" => "holiday".to_owned(),
            "PRE_HOLIDAY" => "preholiday".to_owned(),
            value => value.to_lowercase(),
        };
        let percentage = rule.percentage_basis_points / 100.0;
        output.premium_lines.push(PremiumLine {
            key,
            label: rule.label.clone(),
            minutes,
            percentage,
            hourly_rate: rate,
            amount: round_money((minutes as f64 / 60.0) * rate * (percentage / 100.0)),
        });
    }
    let overtime = if shift
        .get("tariffOvertimeConfirmed")
        .and_then(Value::as_bool)
        == Some(true)
    {
        shift
            .get("overtimeMinutes")
            .and_then(Value::as_f64)
            .ok_or(PayError::InvalidInput)?
            .min(net)
    } else {
        0.0
    };
    let kind = string(shift, "type")?;
    let holiday_mode = string(shift, "holidayPremiumMode")?;
    let state = string(profile, "federalState")?;
    let overtime_rules: Vec<&PremiumRule> = rules
        .iter()
        .filter(|r| {
            r.premium_type == "OVERTIME"
                && conditions_match(
                    &r.conditions,
                    Some(&tariff),
                    state,
                    date,
                    Some(ConditionShift {
                        shift_type: kind,
                        holiday_premium_mode: holiday_mode,
                    }),
                    None,
                )
        })
        .collect();
    if overtime_rules.len() != 1 {
        return Err(PayError::Rule(format!(
            "Expected one overtime rule for {} on {date}, found {}.",
            tariff.pay_group,
            overtime_rules.len()
        )));
    }
    let rule = overtime_rules[0];
    let rate = rate_for(rule, &tariff, date, individual, resolver)?;
    let base = tariff::get_overtime_base_hourly_rate(package, &tariff, individual)?;
    output.overtime_base_amount = round_money((overtime / 60.0) * base);
    output.overtime_premium_amount =
        round_money((overtime / 60.0) * rate * (rule.percentage_basis_points / 10_000.0));
    output.total_amount = round_money(
        output.premium_lines.iter().map(|l| l.amount).sum::<f64>()
            + output.overtime_base_amount
            + output.overtime_premium_amount,
    );
    Ok(output)
}

pub fn calculate_shift(
    shift: &Value,
    profile: &Value,
    resolver: &RuleResolver,
) -> Result<Value, PayError> {
    let work = crate::employment::employment_profile_at(profile, string(shift, "date")?)
        .map_err(|_| PayError::InvalidInput)?;
    calculate_shift_for_profile(shift, &work, resolver).map(|value| json!(value))
}

/// Prices the captured classifier result, so SFN periods and financial amounts
/// share one minute traversal. This is the existing simple-pay trace contract.
pub fn calculate_shift_premium_trace_for_profile(
    shift: &Value,
    profile: &Value,
    resolver: &RuleResolver,
) -> Result<Value, PayError> {
    let date = string(shift, "date")?;
    let classifier = tariff::get_tariff_rule_package(date, resolver)
        .map(|p| PremiumRules::from_json(p.rules()))
        .transpose()?;
    let trace =
        premium_minutes::premium_minute_trace(shift, profile, classifier.as_ref(), resolver)?;
    let breakdown = calculate_shift_from_classified(shift, profile, resolver, trace.classified())?;
    let mut premiums = Vec::with_capacity(trace.premiums.len());
    for (index, premium) in trace.premiums.iter().enumerate() {
        let mut value = json!({"ruleId":premium.rule_id,"premiumType":premium.premium_type,"periods":premium.periods});
        if let Some(line) = breakdown.premium_lines.get(index) {
            value["line"] = json!(line);
        }
        premiums.push(value);
    }
    Ok(
        json!({"start":trace.start,"end":trace.end,"unpaidBreaks":trace.unpaid_breaks,"breakdown":breakdown,"premiums":premiums}),
    )
}
