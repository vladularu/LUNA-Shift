//! Small editable payroll drafts. These are never calculation evidence or Ready facts.
use super::{InputError, form_number, net_form, trim_javascript};
use crate::net::annual_payment::{
    validate_annual_salary_payment_values, validate_annual_salary_payments,
};
use crate::net::payment_schedule::{PaymentPreferences, set_salary_payment_lag};
use crate::report::financial::annual_salary::{annual_payout_months, salary_annual_family};
use net_form::{DecimalScale, InitialNetSettings};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

fn error(message: impl Into<String>) -> InputError {
    InputError::user_facing_source(message, "Error")
}
fn shape_error() -> InputError {
    error("Die Formularfelder sind unvollständig oder ungültig.")
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnnualYearValues {
    annual_taxable_gross: String,
    health_assessed: String,
    pension_assessed: String,
    social_insurance_days: String,
}
impl AnnualYearValues {
    fn texts(&self) -> [&str; 4] {
        [
            &self.annual_taxable_gross,
            &self.health_assessed,
            &self.pension_assessed,
            &self.social_insurance_days,
        ]
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnnualUserDraft {
    payout: String,
    gross: String,
    forecast: bool,
    payroll: bool,
    year_values: AnnualYearValues,
}
impl AnnualUserDraft {
    pub fn try_from_raw(raw: &Value) -> Result<Self, InputError> {
        let draft: Self = serde_json::from_value(raw.clone()).map_err(|_| shape_error())?;
        if [&draft.payout, &draft.gross]
            .into_iter()
            .map(String::as_str)
            .chain(draft.year_values.texts())
            .any(|text| text.len() > 4096)
        {
            return Err(shape_error());
        }
        Ok(draft)
    }
}

/// Constructed inside Rust from the current validated settings and native annual
/// display inputs. It has no Deserialize or host-supplied Ready flag.
#[derive(Debug)]
pub struct AnnualEditorSeed {
    month: String,
    initial_payout: String,
    initial: Option<Value>,
    automatic: bool,
    form: AnnualUserDraft,
}
impl AnnualEditorSeed {
    pub fn new(
        month: &str,
        profile: &Value,
        settings: &InitialNetSettings,
        forecast_payments: &Value,
        automatic: bool,
    ) -> Result<Self, InputError> {
        if !crate::net::settings::valid_settings_month(month) {
            return Err(shape_error());
        }
        // The source may append one automatic current-year payment to the
        // maximum120 saved records. The stored-settings limit stays120.
        let forecast_array = forecast_payments
            .as_array()
            .filter(|payments| payments.len() <= 121)
            .ok_or_else(|| error("Die Sonderzahlungen sind ungültig."))?;
        for payment in forecast_array {
            validate_annual_salary_payments(&json!([payment]))
                .map_err(|failure| error(failure.to_string()))?;
        }
        let saved = settings.settings()["automation"]["annualPayments"]
            .as_array()
            .map_or(&[][..], Vec::as_slice);
        let visible = if forecast_array.is_empty() {
            saved
        } else {
            forecast_array
        };
        let year_prefix = format!("{}-", &month[..4]);
        let initial = visible
            .iter()
            .find(|payment| payment["payoutMonth"] == month)
            .or_else(|| {
                visible.iter().find(|payment| {
                    payment["payoutMonth"]
                        .as_str()
                        .is_some_and(|value| value.starts_with(&year_prefix))
                })
            })
            .cloned();
        let initial_payout = if let Some(value) = initial.as_ref() {
            value["payoutMonth"]
                .as_str()
                .ok_or_else(shape_error)?
                .to_owned()
        } else {
            annual_payout_months(
                salary_annual_family(profile),
                month[..4].parse().map_err(|_| shape_error())?,
            )
            .map_err(|failure| error(failure.to_string()))?
            .into_iter()
            .next()
            .unwrap_or_else(|| month.to_owned())
        };
        let basis = initial.as_ref().map(|payment| &payment["netBasis"]);
        let payroll = basis.is_some_and(|value| value["kind"] == "PAYROLL");
        let amount_text = |field: &str| -> Result<String, InputError> {
            if payroll {
                Ok(net_form::display_decimal(
                    basis
                        .and_then(|value| value[field].as_f64())
                        .ok_or_else(shape_error)?,
                    100.0,
                ))
            } else {
                Ok(String::new())
            }
        };
        let form = AnnualUserDraft {
            payout: initial_payout.clone(),
            gross: initial
                .as_ref()
                .map(|payment| {
                    payment["grossCents"]
                        .as_f64()
                        .map(|amount| net_form::display_decimal(amount, 100.0))
                        .ok_or_else(shape_error)
                })
                .transpose()?
                .unwrap_or_default(),
            forecast: initial.is_none()
                || basis.is_some_and(|value| value["kind"] == "CONSTANT_PAY"),
            payroll,
            year_values: AnnualYearValues {
                annual_taxable_gross: amount_text("annualTaxableGrossCents")?,
                health_assessed: amount_text("healthAssessedCents")?,
                pension_assessed: amount_text("pensionAssessedCents")?,
                social_insurance_days: if payroll {
                    basis
                        .and_then(|value| value["socialInsuranceDays"].as_f64())
                        .ok_or_else(shape_error)?
                        .to_string()
                } else {
                    String::new()
                },
            },
        };
        Ok(Self {
            month: month.to_owned(),
            initial_payout,
            initial,
            automatic,
            form,
        })
    }
    pub fn value(&self) -> Value {
        json!({"initialPayout":self.initial_payout,"initial":self.initial,"form":self.form})
    }
    pub fn form(&self) -> &AnnualUserDraft {
        &self.form
    }
    pub fn initial(&self) -> Option<&Value> {
        self.initial.as_ref()
    }
    pub fn initial_payout(&self) -> &str {
        &self.initial_payout
    }
}

/// None means the original editor closes without a write. All returned settings
/// are validated user drafts; they are not a salary/net calculation result.
pub fn prepare_annual_save(
    seed: &AnnualEditorSeed,
    settings: &InitialNetSettings,
    draft: &AnnualUserDraft,
    locked: bool,
) -> Result<Option<InitialNetSettings>, InputError> {
    let settings = settings.settings();
    if locked || !crate::net::js_truthy(&settings["automation"]) {
        return Ok(None);
    }
    if trim_javascript(&draft.gross).is_empty() {
        return Err(error(
            "Bitte einen Bruttobetrag eintragen. Keine Zahlung? Trage 0 ein.",
        ));
    }
    if draft.payroll
        && draft
            .year_values
            .texts()
            .iter()
            .any(|text| trim_javascript(text).is_empty())
    {
        return Err(error(
            "Bitte die Jahreswerte vollständig eintragen. Nullwerte als 0 eingeben.",
        ));
    }
    let cents = net_form::parse_decimal(&draft.gross, DecimalScale::Cents, "die Sonderzahlung")?;
    if seed.automatic
        && seed.initial.as_ref().is_some_and(|initial| {
            initial["payoutMonth"] == draft.payout && initial["grossCents"] == cents
        })
        && !draft.payroll
        && draft.forecast
    {
        return Ok(None);
    }
    let payments = settings["automation"]["annualPayments"]
        .as_array()
        .map_or(&[][..], Vec::as_slice);
    let previous = payments
        .iter()
        .find(|payment| payment["payoutMonth"] == draft.payout);
    let moved = payments.iter().find(|payment| {
        payment["payoutMonth"] == seed.initial_payout && draft.payout != seed.initial_payout
    });
    let mut next: Vec<Value> = payments
        .iter()
        .filter(|payment| {
            payment["payoutMonth"] != draft.payout
                && moved.is_none_or(|moved| !std::ptr::eq(*payment, moved))
        })
        .cloned()
        .collect();
    if let Some(moved) = moved {
        let mut value = moved.clone();
        value["revision"] = json!(moved["revision"].as_i64().ok_or_else(shape_error)? + 1);
        value["grossCents"] = json!(0);
        next.push(value);
    }
    let basis = if draft.payroll {
        json!({
            "kind":"PAYROLL",
            "annualTaxableGrossCents":net_form::parse_decimal(&draft.year_values.annual_taxable_gross,DecimalScale::Cents,"das Jahressteuerbrutto")?,
            "healthAssessedCents":net_form::parse_decimal(&draft.year_values.health_assessed,DecimalScale::Cents,"die bisherige KV-/PV-Beitragsgrundlage")?,
            "pensionAssessedCents":net_form::parse_decimal(&draft.year_values.pension_assessed,DecimalScale::Cents,"die bisherige RV-/AV-Beitragsgrundlage")?,
            "socialInsuranceDays":form_number::number(&draft.year_values.social_insurance_days)
        })
    } else if draft.forecast {
        json!({"kind":"CONSTANT_PAY"})
    } else {
        Value::Null
    };
    next.push(json!({
        "revision":previous.and_then(|payment|payment["revision"].as_i64()).unwrap_or(0)+1,
        "payoutMonth":draft.payout,"grossCents":cents,"netBasis":basis
    }));
    let next = validate_annual_salary_payment_values(&json!(next))
        .map_err(|failure| error(failure.to_string()))?;
    let mut value = settings.clone();
    value["month"] = json!(seed.month);
    value["specialCases"] = json!(
        settings["specialCases"]
            .as_array()
            .ok_or_else(shape_error)?
            .iter()
            .filter(|special| **special != "ONE_OFF_PAYMENT")
            .collect::<Vec<_>>()
    );
    value["automation"]["annualPayments"] = next;
    InitialNetSettings::try_from_raw(&value).map(Some)
}

pub fn reset_annual_settings(
    year: i32,
    settings: &[InitialNetSettings],
) -> Result<Vec<Value>, InputError> {
    if !(1900..=4099).contains(&year) {
        return Err(error("Ungültiges Auszahlungsjahr."));
    }
    let prefix = format!("{year}-");
    let mut changed = Vec::new();
    for settings in settings {
        let source = settings.settings();
        let Some(payments) = source["automation"]["annualPayments"].as_array() else {
            continue;
        };
        let in_year = |payment: &Value| {
            payment["payoutMonth"]
                .as_str()
                .is_some_and(|month| month.starts_with(&prefix))
        };
        if !payments.iter().any(in_year) {
            continue;
        }
        let mut next = source.clone();
        next["automation"]["annualPayments"] = json!(
            payments
                .iter()
                .filter(|payment| !in_year(payment))
                .collect::<Vec<_>>()
        );
        changed.push(InitialNetSettings::try_from_raw(&next)?.settings().clone());
    }
    Ok(changed)
}

pub fn prepare_timing(
    preferences: &PaymentPreferences,
    month: &str,
    choice: &str,
) -> Result<PaymentPreferences, InputError> {
    let lag = match choice {
        "0" => 0,
        "1" => 1,
        "2" => 2,
        _ => return Err(shape_error()),
    };
    set_salary_payment_lag(preferences, month, lag).map_err(|failure| error(failure.to_string()))
}
