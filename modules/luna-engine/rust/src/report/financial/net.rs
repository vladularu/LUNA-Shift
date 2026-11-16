//! Complete earned/cash net preparation and annual salary rows over native facts.
#[path = "net_reuse.rs"]
pub mod reuse;
use super::{FinancialError, annual_salary::annual_salary_forecast, source::FinancialContext};
use crate::net::{
    gross_evidence::calculate_automatic_net_pay_forecast,
    payment_projection::SalaryPaymentProjection,
    payment_schedule::{PaymentPreferences, SalaryPerspective},
    payout_forecast::{AutomaticPaymentInput, calculate_automatic_payment_net_pay_forecast},
    settings::resolve_net_pay_settings,
};
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::VecDeque, sync::Arc};

const MAX_PROJECTION_IDENTITIES: usize = 192;
struct ArcIdentities<T> {
    next: u64,
    values: VecDeque<(Arc<T>, u64)>,
}
impl<T> Default for ArcIdentities<T> {
    fn default() -> Self {
        Self {
            next: 0,
            values: VecDeque::new(),
        }
    }
}
impl<T> ArcIdentities<T> {
    fn token(&mut self, value: &Arc<T>) -> Result<u64, FinancialError> {
        if let Some((_, token)) = self
            .values
            .iter()
            .find(|(candidate, _)| Arc::ptr_eq(candidate, value))
        {
            return Ok(*token);
        }
        self.next = self
            .next
            .checked_add(1)
            .ok_or_else(|| FinancialError::invalid("Ungültiger Prognose-Schlüssel."))?;
        if self.values.len() >= MAX_PROJECTION_IDENTITIES {
            self.values.pop_front();
        }
        self.values.push_back((Arc::clone(value), self.next));
        Ok(self.next)
    }
}
#[derive(Default)]
pub(crate) struct ProjectionKeys {
    profiles: ArcIdentities<Value>,
    plans: ArcIdentities<Vec<Value>>,
}
impl ProjectionKeys {
    fn fingerprint(
        &mut self,
        projection: &SalaryPaymentProjection,
    ) -> Result<String, FinancialError> {
        // Identities are retained while cached and never reused after eviction.
        // Only financial fields enter serialization; raw profiles/plans do not.
        let mut sources = vec![];
        for source in &projection.sources {
            sources.push((
                source.month(),
                self.profiles.token(&source.profile)?,
                self.plans.token(&source.shifts)?,
                source.pay(),
            ));
        }
        key(&(
            &projection.month,
            projection.perspective,
            &projection.pay,
            sources,
            &projection.contributions,
            &projection.outgoing_contributions,
            &projection.issues,
            &projection.warnings,
            projection.available,
        ))
    }
    pub(crate) fn diagnostics(&self) -> Value {
        json!({"profileHandles":self.profiles.values.len(),"planHandles":self.plans.values.len(),"capacity":MAX_PROJECTION_IDENTITIES})
    }
}

pub struct PaymentNetPreparation<'a> {
    pub preferences: &'a PaymentPreferences,
    pub perspective: SalaryPerspective,
    pub source_settings: &'a [Value],
    /// Rust-created projection only; it has no Deserialize implementation.
    pub projection: Option<&'a SalaryPaymentProjection>,
}
fn key(value: &impl Serialize) -> Result<String, FinancialError> {
    Ok(format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(value)
                .map_err(|error| FinancialError::invalid(error.to_string()))?
        )
    ))
}
fn fallback(settings: &Value) -> Value {
    json!({"sourceMonth":settings["month"],"result":{"status":"unavailable","stage":"sfn","reason":"Die vollständige Gehaltsprognose konnte nicht berechnet werden."}})
}
fn store_forecast(context: &mut FinancialContext<'_>, cache_key: String, result: &Value) {
    if context.forecasts.len() >= 64
        && let Some(oldest) = context.forecasts.keys().next().cloned()
    {
        context.forecasts.remove(&oldest);
    }
    context.forecasts.insert(cache_key, result.clone());
}

fn prepared(
    month: &str,
    settings: &Value,
    context: &mut FinancialContext<'_>,
    payment: Option<&PaymentNetPreparation<'_>>,
    scope_key: Option<&str>,
    shared_scope: Option<&[u8; 32]>,
) -> Result<Value, FinancialError> {
    let year = month
        .get(..4)
        .and_then(|year| year.parse::<i32>().ok())
        .ok_or_else(|| FinancialError::invalid("Ungültiger Berichtsmonat."))?;
    let payout = payment.filter(|payment| payment.perspective == SalaryPerspective::Payout);
    let namespace = match scope_key {
        Some(key) => key.to_owned(),
        None => key(&payout.map(|payment| {
            (
                &payment.preferences,
                payment.perspective,
                payment.source_settings,
            )
        }))?,
    };
    let projection_key = payout
        .and_then(|payment| payment.projection)
        .map(|projection| context.projection_keys.fingerprint(projection))
        .transpose()?;
    let cache_key = key(&(month, settings, &namespace, projection_key))?;
    if let Some(cached) = context.forecasts.get(&cache_key) {
        return Ok(cached.clone());
    }
    let profile = Arc::clone(context.calculation_profile());
    let resolver = context.resolver_handle();
    let projection = if let Some(payment) = payout {
        Some(match payment.projection {
            Some(projection) => projection.clone(),
            None => {
                context.salary_projection(month, payment.preferences, SalaryPerspective::Payout)?
            }
        })
    } else {
        None
    };
    // Original preparation builds the current gross before proposing the annual
    // amount. Reusing its cached native evidence preserves that failure order.
    let earned_source = if projection.is_none() {
        Some(context.salary_month(month)?)
    } else {
        None
    };
    let annual = annual_salary_forecast(
        year,
        context,
        settings["automation"]["annualPayments"]
            .as_array()
            .map_or(&[][..], Vec::as_slice),
    )?;
    let mut forecast_settings = settings.clone();
    if crate::net::js_truthy(&settings["automation"]) {
        forecast_settings["automation"]["annualPayments"] = annual["payments"].clone();
    }
    let shared_key = reuse::forecast_key(
        context,
        month,
        &forecast_settings,
        payout,
        projection.as_ref(),
        shared_scope,
    );
    if let Some(value) = context
        .shared_net_cache
        .as_ref()
        .zip(shared_key.as_ref())
        .and_then(|(cache, key)| cache.get(key))
    {
        store_forecast(context, cache_key, value.as_ref());
        return Ok(value.as_ref().clone());
    }
    context.net_passes = context.net_passes.saturating_add(1);
    let result = if let (Some(payment), Some(projection)) = (payout, projection.as_ref()) {
        let request = AutomaticPaymentInput {
            month,
            profile,
            settings: &forecast_settings,
            projection,
            source_settings: payment.source_settings,
            social_insurance_attribution: Some(&payment.preferences.social_insurance_attribution),
        };
        calculate_automatic_payment_net_pay_forecast(
            &request,
            resolver.as_ref(),
            context.payout_provider(),
        )
    } else {
        let source = earned_source.expect("earned native source");
        calculate_automatic_net_pay_forecast(
            month,
            profile,
            Arc::clone(&source.shifts),
            &forecast_settings,
            resolver.as_ref(),
            context.earned_provider(),
        )
    };
    if result["result"]["status"] == "available" {
        store_forecast(context, cache_key, &result);
        if let (Some(cache), Some(shared_key)) = (&context.shared_net_cache, shared_key) {
            cache.insert(shared_key, Arc::new(result.clone()));
        }
    }
    Ok(result)
}

pub fn prepare_automatic_net_pay(
    month: &str,
    settings: &Value,
    context: &mut FinancialContext<'_>,
    payment: Option<&PaymentNetPreparation<'_>>,
) -> Value {
    prepared(month, settings, context, payment, None, None).unwrap_or_else(|_| fallback(settings))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnualNetPayMonth {
    pub month: String,
    pub net_cents: Option<i64>,
    pub status: Option<String>,
    pub notes: Vec<String>,
    pub preliminary: bool,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnualNetPay {
    pub year: i32,
    pub months: Vec<AnnualNetPayMonth>,
    pub net_cents: Option<i64>,
    pub available_month_count: usize,
    pub notes: Vec<String>,
    pub preliminary: bool,
}
pub fn annual_net_pay_month(
    month: &str,
    forecast: &Value,
) -> Result<AnnualNetPayMonth, FinancialError> {
    if forecast["result"]["status"] != "available" {
        return Ok(AnnualNetPayMonth {
            month: month.into(),
            net_cents: None,
            status: Some(
                forecast["result"]["reason"]
                    .as_str()
                    .ok_or_else(|| FinancialError::invalid("Ungültiger Netto-Status."))?
                    .into(),
            ),
            notes: vec![],
            preliminary: false,
        });
    }
    let pay = &forecast["result"]["pay"];
    let preliminary = pay["calculationBasis"]["status"] == "PREVIOUS_YEAR_ESTIMATE";
    let mut notes = vec![];
    if preliminary {
        notes.push(format!(
            "{} vorläufig · Abzüge nach Stand {}",
            pay["calculationBasis"]["payrollYear"], pay["calculationBasis"]["rulesYear"]
        ));
    }
    let estimate = &forecast["payrollTimingEstimate"]["crossYearTaxEstimate"];
    if !estimate.is_null() {
        notes.push(
            if estimate["annualBasis"] == "PAYROLL" {
                "Jahreswechsel geschätzt · Auszahlung zum Monatsende, mit deinen Jahreswerten."
            } else {
                "Jahreswechsel geschätzt · Auszahlung zum Monatsende, Jahresbrutto hochgerechnet."
            }
            .into(),
        );
    }
    if crate::net::js_truthy(&forecast["pensionOmitted"])
        || crate::net::js_truthy(&forecast["annualPayment"]["pensionOmitted"])
    {
        notes.push("Zusatzversorgung nicht berücksichtigt".into());
    }
    if !forecast["annualPayment"].is_null() {
        notes.push(
            if crate::net::js_truthy(&forecast["annualPayment"]["netIncluded"]) {
                "Jahressonderzahlung enthalten"
            } else {
                "Sonderzahlung nur im Brutto"
            }
            .into(),
        );
    }
    Ok(AnnualNetPayMonth {
        month: month.into(),
        net_cents: Some(
            pay["netCents"]
                .as_i64()
                .ok_or_else(|| FinancialError::invalid("Ungültige Netto-Summe."))?,
        ),
        status: None,
        notes,
        preliminary,
    })
}
pub fn summarize_annual_net_pay(year: i32, months: Vec<AnnualNetPayMonth>) -> AnnualNetPay {
    let available: Vec<_> = months
        .iter()
        .filter(|month| month.net_cents.is_some())
        .collect();
    let net_cents = if available.is_empty() {
        None
    } else {
        Some(available.iter().map(|month| month.net_cents.unwrap()).sum())
    };
    let mut notes = vec![];
    for month in &available {
        for note in &month.notes {
            if !notes.contains(note) {
                notes.push(note.clone());
            }
        }
    }
    let preliminary = available.iter().any(|month| month.preliminary);
    let available_month_count = available.len();
    AnnualNetPay {
        year,
        months,
        net_cents,
        available_month_count,
        notes,
        preliminary,
    }
}

pub fn annual_net_pay(
    year: i32,
    timeline: &[Value],
    preferences: &PaymentPreferences,
    context: &mut FinancialContext<'_>,
    perspective: SalaryPerspective,
) -> Result<AnnualNetPay, FinancialError> {
    if !(1900..=4099).contains(&year) {
        return Err(FinancialError::invalid("Ungültiges Berichtsjahr."));
    }
    let namespace = key(&(year, timeline, preferences, perspective))?;
    if let Some(cached) = context.annual_net.get(&namespace) {
        return Ok(cached.clone());
    }
    // Share an unchanged month's forecast with ordinary month requests. The
    // settings timeline is hashed once for the year, never once per month.
    let month_scope = key(&if perspective == SalaryPerspective::Payout {
        Some((preferences, perspective, timeline))
    } else {
        None
    })?;
    // Large settings timelines are canonically traversed once for the year,
    // independently of local Arc projection identities.
    let shared_scope = if context.shared_net_cache.is_some() {
        reuse::scope_digest(
            (perspective == SalaryPerspective::Payout).then_some((preferences, timeline)),
        )
        .ok()
    } else {
        None
    };
    let mut months = vec![];
    for index in 1..=12 {
        let month = format!("{year}-{index:02}");
        let blocked = context.test_months().contains(&month);
        let selected = if blocked {
            Value::Null
        } else {
            resolve_net_pay_settings(&month, timeline)
                .map_err(|error| FinancialError::invalid(error.to_string()))?
        };
        if blocked || selected["settings"]["version"] != 2 {
            months.push(AnnualNetPayMonth {
                month,
                net_cents: None,
                status: Some(
                    if blocked {
                        "Im Testmonat gesperrt"
                    } else {
                        "Noch nicht eingerichtet"
                    }
                    .into(),
                ),
                notes: vec![],
                preliminary: false,
            });
        } else {
            let payment = PaymentNetPreparation {
                preferences,
                perspective,
                source_settings: timeline,
                projection: None,
            };
            let forecast = prepared(
                &month,
                &selected["settings"],
                context,
                Some(&payment),
                Some(&month_scope),
                shared_scope.as_ref(),
            )
            .unwrap_or_else(|_| fallback(&selected["settings"]));
            months.push(annual_net_pay_month(&month, &forecast)?);
        }
    }
    let result = summarize_annual_net_pay(year, months);
    if result.available_month_count > 0 {
        if context.annual_net.len() >= 12
            && let Some(oldest) = context.annual_net.keys().next().cloned()
        {
            context.annual_net.remove(&oldest);
        }
        context.annual_net.insert(namespace, result.clone());
    }
    Ok(result)
}
