//! Rust-only gross/proof seam. Providers retain one calculation and lazily add
//! time evidence; none of these evidence records can be deserialized from JS.
use super::automation::{AutomaticSalaryProof, finalize_automatic_salary_net};
use super::payment_projection::SalaryPaymentSource;
use super::settings::validate_monthly_net_pay_settings;
use super::sfn::classify_sfn_payroll_2026;
use super::{CalculationMode, integer_in_range};
use crate::pay::trace::PayrollTrace;
use crate::rules::RuleResolver;
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvidenceNeed {
    GrossOnly,
    PayrollTraces,
}
#[derive(Debug, Clone, serde::Serialize)]
pub enum TraceCoverage {
    NotRequested,
    Complete {
        regular_shift_ids: BTreeSet<String>,
        special_duty_shift_ids: BTreeSet<String>,
    },
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct PremiumEvidence {
    pub(crate) shift_id: String,
    pub(crate) payroll: PayrollTrace,
}
#[derive(Debug, Clone)]
pub struct GrossMonthEvidence {
    pub(crate) source: SalaryPaymentSource,
    pub(crate) effective_profile: Arc<Value>,
    pub(crate) employment_periods: Arc<Vec<Value>>,
    pub(crate) projected_regular_shifts: Arc<Vec<Value>>,
    pub(crate) premium_evidence: Vec<PremiumEvidence>,
    pub(crate) special_duty_traces: Vec<Value>,
    pub(crate) coverage: TraceCoverage,
}
impl GrossMonthEvidence {
    pub fn source(&self) -> &SalaryPaymentSource {
        &self.source
    }
    pub fn profile(&self) -> &Value {
        &self.effective_profile
    }
}

#[derive(Debug, Clone, Copy)]
pub struct GrossEvidenceError;
impl std::fmt::Display for GrossEvidenceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(
            "Tarif-, Arbeitszeit- oder Feiertagsdaten konnten nicht vollständig zugeordnet werden.",
        )
    }
}
impl std::error::Error for GrossEvidenceError {}

pub trait GrossEvidenceProvider {
    fn month_evidence(
        &mut self,
        month: &str,
        profile: Arc<Value>,
        shifts: Arc<Vec<Value>>,
        need: EvidenceNeed,
        resolver: &RuleResolver,
    ) -> Result<Arc<GrossMonthEvidence>, GrossEvidenceError>;
}

#[derive(Debug, Clone)]
pub enum ProofPreparation {
    Available(Box<AutomaticSalaryProof>),
    Unavailable(Value),
}
fn unavailable(settings: &Value, reason: &str, recovery: Option<Value>) -> ProofPreparation {
    let mut forecast = json!({"sourceMonth":settings["month"],"result":{"status":"unavailable","stage":"sfn","reason":reason}});
    if let Some(recovery) = recovery {
        forecast["recovery"] = recovery;
    }
    ProofPreparation::Unavailable(forecast)
}
fn fallback(settings: &Value) -> ProofPreparation {
    unavailable(
        settings,
        "Tarif-, Arbeitszeit- oder Feiertagsdaten konnten nicht vollständig zugeordnet werden.",
        None,
    )
}
fn fallback_forecast(settings: &Value) -> Value {
    json!({"sourceMonth":settings["month"],"result":{"status":"unavailable","stage":"sfn","reason":"Tarif-, Arbeitszeit- oder Feiertagsdaten konnten nicht vollständig zugeordnet werden."}})
}

pub(crate) fn forecast_cents(value: &Value) -> Result<i64, GrossEvidenceError> {
    let number = value.as_f64().ok_or(GrossEvidenceError)?;
    let scaled = number * 100.0;
    let rounded = if scaled.fract() == -0.5 {
        scaled.ceil()
    } else {
        scaled.round()
    };
    if !rounded.is_finite()
        || rounded < 0.0
        || rounded > crate::money::MAX_SAFE_INTEGER as f64
        || (scaled - rounded).abs() > 0.000001
    {
        return Err(GrossEvidenceError);
    }
    Ok(rounded as i64)
}
fn work_shift(shift: &Value) -> bool {
    !super::js_truthy(&shift["specialDuty"])
        && !super::js_truthy(&shift["allDay"])
        && ["EARLY", "LATE", "NIGHT", "DAY", "CUSTOM"]
            .contains(&shift["type"].as_str().unwrap_or(""))
        && !shift["startTime"].is_null()
        && !shift["endTime"].is_null()
}
fn manual(profile: &Value) -> bool {
    !profile["manualMonthlyGrossCents"].is_null()
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
        .all(|key| !super::js_truthy(&profile[key]))
}

fn js_numbers(value: &mut Value) {
    match value {
        Value::Number(number) if number.is_f64() => {
            if let Some(n) = number
                .as_f64()
                .filter(|n| n.fract() == 0.0 && n.abs() <= crate::money::MAX_SAFE_INTEGER as f64)
            {
                *value = json!(n as i64);
            }
        }
        Value::Object(object) => {
            for value in object.values_mut() {
                js_numbers(value);
            }
        }
        Value::Array(array) => {
            for value in array {
                js_numbers(value);
            }
        }
        _ => {}
    }
}
fn same_breakdown(left: &Value, right: &Value) -> bool {
    let mut left = left.clone();
    let mut right = right.clone();
    js_numbers(&mut left);
    js_numbers(&mut right);
    // serde_json preserve_order retains the source JSON.stringify comparison,
    // including the original field order rather than ignoring reordered keys.
    matches!((serde_json::to_string(&left),serde_json::to_string(&right)),(Ok(a),Ok(b))if a==b)
}

fn prepare(
    evidence: &GrossMonthEvidence,
    settings: &Value,
    resolver: &RuleResolver,
) -> Result<ProofPreparation, GrossEvidenceError> {
    let month = evidence.source.month();
    let profile = evidence.profile();
    let pay = evidence.source.pay();
    if evidence.employment_periods.len() > 1 {
        return Ok(unavailable(
            settings,
            "Für Beschäftigungsänderungen innerhalb eines Monats ist die Netto-Prognose noch nicht verfügbar.",
            None,
        ));
    }
    validate_monthly_net_pay_settings(settings).map_err(|_| GrossEvidenceError)?;
    if settings["version"] != 2 || settings["automation"].is_null() {
        return Ok(unavailable(
            settings,
            "Richte deine Netto-Angaben ein.",
            Some(json!({"kind":"net-settings"})),
        ));
    }
    if settings["month"].as_str().ok_or(GrossEvidenceError)? > month || pay["month"] != month {
        return Ok(unavailable(
            settings,
            "Die Berechnungsgrundlagen gehören zu unterschiedlichen Monaten.",
            None,
        ));
    }
    if super::js_truthy(&profile["salaryBasisConflict"]) {
        return Ok(unavailable(
            settings,
            "Prüfe deine Gehaltsangaben.",
            Some(json!({"kind":"profile","section":"TARIFF"})),
        ));
    }
    if profile["timeZone"] != "Europe/Berlin" {
        return Ok(unavailable(
            settings,
            "Für diese Zeitzone ist keine Netto-Prognose verfügbar.",
            None,
        ));
    }
    let Some(weekly) =
        integer_in_range(&profile["weeklyMinutes"], 1, crate::money::MAX_SAFE_INTEGER)
    else {
        return Ok(unavailable(
            settings,
            "Deine Wochenarbeitszeit fehlt.",
            Some(json!({"kind":"profile","section":"WORK"})),
        ));
    };
    let prefix = format!("{month}-");
    let shifts: Vec<_> = evidence
        .projected_regular_shifts
        .iter()
        .filter(|shift| {
            shift.get("deletedAt") == Some(&Value::Null)
                && shift["date"]
                    .as_str()
                    .is_some_and(|date| date.starts_with(&prefix))
        })
        .collect();
    if let Some(incomplete) = shifts.iter().find(|shift| {
        ["EARLY", "LATE", "NIGHT", "DAY", "CUSTOM"].contains(&shift["type"].as_str().unwrap_or(""))
            && !work_shift(shift)
    }) {
        return Ok(unavailable(
            settings,
            "Prüfe die Zeiten dieses Dienstes.",
            Some(json!({"kind":"entry","date":incomplete["date"],"entryId":incomplete["id"]})),
        ));
    }
    if !super::js_truthy(&pay["available"])
        || pay["personalBaseAmount"].is_null()
        || pay["estimatedGrossAmount"].is_null()
    {
        return Ok(unavailable(
            settings,
            "Die vollständige Brutto-Gehaltsprognose fehlt.",
            None,
        ));
    }
    let zero = json!(0);
    let components = [
        pay.get("absencePayAmount").unwrap_or(&zero),
        pay.get("specialDutyAmount")
            .filter(|v| !v.is_null())
            .unwrap_or(&zero),
        &pay["personalBaseAmount"],
        &pay["timePremiumAmount"],
        &pay["overtimeAmount"],
        &pay["allowanceAmount"],
        &pay["tvoedAllowanceAmount"],
        &pay["careAllowanceAmount"],
    ];
    let mut component_total = 0;
    for component in components {
        component_total += forecast_cents(component)?;
    }
    if component_total != forecast_cents(&pay["estimatedGrossAmount"])? {
        return Ok(unavailable(
            settings,
            "Die Bestandteile passen nicht zum Gesamtbrutto.",
            None,
        ));
    }
    let automation = &settings["automation"];
    let allowance = if pay["confirmedAllowance"].is_null() {
        pay["assessment"]["suggestedAllowance"].as_str()
    } else {
        pay["confirmedAllowance"].as_str()
    }
    .ok_or(GrossEvidenceError)?;
    let regular_gross = forecast_cents(&pay["personalBaseAmount"])?
        + forecast_cents(&pay["careAllowanceAmount"])?
        + forecast_cents(&pay["tvoedAllowanceAmount"])?
        + if allowance.ends_with("_MONTHLY") {
            forecast_cents(&pay["allowanceAmount"])?
        } else {
            0
        }
        + automation["additionalRecurringGrossCents"]
            .as_i64()
            .ok_or(GrossEvidenceError)?;
    let n = i128::from(regular_gross) * 6000;
    let d = i128::from(weekly) * 435;
    let basic_hourly = i64::try_from((2 * n + d) / (2 * d)).map_err(|_| GrossEvidenceError)?;
    let work: Vec<_> = shifts
        .into_iter()
        .filter(|shift| work_shift(shift))
        .collect();
    let manual = manual(profile);
    let breakdowns = pay["shiftBreakdowns"]
        .as_array()
        .ok_or(GrossEvidenceError)?;
    if !manual && work.len() != breakdowns.len() {
        return Ok(unavailable(
            settings,
            "Die Dienstzeiten passen nicht zur Gehaltsprognose.",
            None,
        ));
    }
    let expected: BTreeSet<String> = if manual {
        BTreeSet::new()
    } else {
        work.iter()
            .map(|shift| {
                shift["id"]
                    .as_str()
                    .map(str::to_owned)
                    .ok_or(GrossEvidenceError)
            })
            .collect::<Result<_, _>>()?
    };
    let (covered_regular, covered_special) = match &evidence.coverage {
        TraceCoverage::Complete {
            regular_shift_ids,
            special_duty_shift_ids,
        } => (regular_shift_ids, special_duty_shift_ids),
        TraceCoverage::NotRequested => return Err(GrossEvidenceError),
    };
    if covered_regular != &expected {
        return Err(GrossEvidenceError);
    }
    let mut traces = vec![];
    for shift in if manual { vec![] } else { work } {
        let pause = integer_in_range(&shift["breakMinutes"], 0, crate::money::MAX_SAFE_INTEGER);
        if pause.is_none() {
            return Ok(unavailable(
                settings,
                "Prüfe Arbeitszeit und Pause dieses Dienstes.",
                Some(json!({"kind":"entry","date":shift["date"],"entryId":shift["id"]})),
            ));
        }
        let timed: crate::time::ShiftTime =
            serde_json::from_value(shift.clone()).map_err(|_| GrossEvidenceError)?;
        let bounds =
            crate::time::shift_bounds(&timed, "Europe/Berlin").map_err(|_| GrossEvidenceError)?;
        let Some(bounds) = bounds else {
            return Ok(unavailable(
                settings,
                "Prüfe Arbeitszeit und Pause dieses Dienstes.",
                Some(json!({"kind":"entry","date":shift["date"],"entryId":shift["id"]})),
            ));
        };
        if pause.is_none_or(|pause| pause >= bounds.gross_minutes) {
            return Ok(unavailable(
                settings,
                "Prüfe Arbeitszeit und Pause dieses Dienstes.",
                Some(json!({"kind":"entry","date":shift["date"],"entryId":shift["id"]})),
            ));
        }
        let id = shift["id"].as_str().ok_or(GrossEvidenceError)?;
        let premium = evidence
            .premium_evidence
            .iter()
            .find(|premium| premium.shift_id == id)
            .ok_or(GrossEvidenceError)?;
        let recorded = breakdowns
            .iter()
            .find(|breakdown| breakdown["shiftId"] == id);
        if recorded.is_none_or(|recorded| !same_breakdown(recorded, &premium.payroll.breakdown)) {
            return Ok(unavailable(
                settings,
                "Die Zuschläge konnten nicht vollständig berechnet werden.",
                None,
            ));
        }
        traces.push(premium.payroll.trace.clone());
    }
    let paid = traces
        .iter()
        .map(|trace| {
            trace["payments"]
                .as_array()
                .ok_or(GrossEvidenceError)
                .and_then(|payments| {
                    payments
                        .iter()
                        .map(|payment| payment["amountCents"].as_i64().ok_or(GrossEvidenceError))
                        .sum::<Result<i64, _>>()
                })
        })
        .sum::<Result<i64, _>>()?;
    if paid != forecast_cents(&pay["timePremiumAmount"])? {
        return Ok(unavailable(
            settings,
            "Die Zuschlagssummen passen nicht zum Brutto.",
            None,
        ));
    }
    let regular_shift_ids = traces
        .iter()
        .map(|trace| {
            trace["id"]
                .as_str()
                .map(str::to_owned)
                .ok_or(GrossEvidenceError)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let special_ids: BTreeSet<String> = evidence
        .special_duty_traces
        .iter()
        .map(|trace| {
            trace["id"]
                .as_str()
                .map(str::to_owned)
                .ok_or(GrossEvidenceError)
        })
        .collect::<Result<_, _>>()?;
    if &special_ids != covered_special {
        return Err(GrossEvidenceError);
    }
    let special_duty_shift_ids = evidence
        .special_duty_traces
        .iter()
        .map(|trace| {
            trace["id"]
                .as_str()
                .map(str::to_owned)
                .ok_or(GrossEvidenceError)
        })
        .collect::<Result<Vec<_>, _>>()?;
    traces.extend(evidence.special_duty_traces.iter().cloned());
    let payroll = json!({"month":month,"completeGross":true,"grossCents":forecast_cents(&pay["estimatedGrossAmount"])?+automation["additionalRecurringGrossCents"].as_i64().ok_or(GrossEvidenceError)?,"regularMonthlySocialInsuranceGrossCents":regular_gross,"basicHourlyPayCents":basic_hourly,"workplace":{"federalState":profile["federalState"],"holidayRegion":profile["holidayRegion"]},"workEvidence":"PLANNED","monthAttribution":"SHIFT_START","shifts":traces});
    let classification = classify_sfn_payroll_2026(&payroll, resolver, CalculationMode::Forecast)
        .map_err(|_| GrossEvidenceError)?;
    if classification["status"] != "available" {
        return Ok(unavailable(
            settings,
            classification["reason"]
                .as_str()
                .ok_or(GrossEvidenceError)?,
            None,
        ));
    }
    Ok(ProofPreparation::Available(Box::new(
        AutomaticSalaryProof {
            profile: Arc::clone(&evidence.effective_profile),
            classification,
            basic_hourly_pay_cents: basic_hourly,
            regular_gross_cents: regular_gross,
            regular_shift_ids,
            special_duty_shift_ids,
        },
    )))
}

pub fn prepare_automatic_salary_proof(
    evidence: &GrossMonthEvidence,
    settings: &Value,
    resolver: &RuleResolver,
) -> ProofPreparation {
    prepare(evidence, settings, resolver).unwrap_or_else(|_| fallback(settings))
}
pub fn calculate_automatic_net_pay_forecast<P: GrossEvidenceProvider + ?Sized>(
    month: &str,
    profile: Arc<Value>,
    shifts: Arc<Vec<Value>>,
    settings: &Value,
    resolver: &RuleResolver,
    provider: &mut P,
) -> Value {
    let evidence = provider.month_evidence(
        month,
        profile,
        shifts,
        EvidenceNeed::PayrollTraces,
        resolver,
    );
    match evidence.map(|evidence| {
        if evidence.source.month() != month {
            unavailable(
                settings,
                "Die Berechnungsgrundlagen gehören zu unterschiedlichen Monaten.",
                None,
            )
        } else {
            prepare_automatic_salary_proof(&evidence, settings, resolver)
        }
    }) {
        Ok(ProofPreparation::Available(proof)) => {
            finalize_automatic_salary_net(month, settings, &proof)
        }
        Ok(ProofPreparation::Unavailable(forecast)) => forecast,
        Err(_) => fallback_forecast(settings),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::pay::trace::{TariffPayrollOptions, tariff_payroll_trace};

    pub(crate) struct StageProvider<'a> {
        pub(crate) input: &'a Value,
        pub(crate) calls: usize,
    }
    impl GrossEvidenceProvider for StageProvider<'_> {
        fn month_evidence(
            &mut self,
            month: &str,
            profile: Arc<Value>,
            shifts: Arc<Vec<Value>>,
            need: EvidenceNeed,
            resolver: &RuleResolver,
        ) -> Result<Arc<GrossMonthEvidence>, GrossEvidenceError> {
            self.calls += 1;
            let effective_profile = Arc::new(
                crate::employment::employment_profile_at(&profile, &format!("{month}-01"))
                    .map_err(|_| GrossEvidenceError)?,
            );
            let periods = crate::pay::periods::payroll_employment_periods(
                &profile,
                month,
                &format!("{month}-31"),
            )
            .map_err(|_| GrossEvidenceError)?;
            let periods = match periods {
                Value::Array(periods) => Arc::new(periods),
                _ => return Err(GrossEvidenceError),
            };
            let mut pay = crate::pay::manual::create_manual_monthly_pay_estimate(
                month,
                self.input["baseGrossCents"]
                    .as_i64()
                    .ok_or(GrossEvidenceError)?,
            )
            .map_err(|_| GrossEvidenceError)?;
            let mut premiums = vec![];
            if self.input["priceTraces"] == true {
                for shift in shifts.iter().filter(|shift| {
                    shift.get("deletedAt") == Some(&Value::Null)
                        && shift["date"]
                            .as_str()
                            .is_some_and(|date| date.starts_with(&format!("{month}-")))
                }) {
                    let payroll = tariff_payroll_trace(
                        shift,
                        &effective_profile,
                        &TariffPayrollOptions::default(),
                        resolver,
                    )
                    .map_err(|_| GrossEvidenceError)?;
                    premiums.push(PremiumEvidence {
                        shift_id: shift["id"].as_str().ok_or(GrossEvidenceError)?.into(),
                        payroll,
                    });
                }
                let mut time_premiums = 0.0;
                let mut overtime = 0.0;
                for premium in &premiums {
                    for line in premium.payroll.breakdown["premiumLines"]
                        .as_array()
                        .ok_or(GrossEvidenceError)?
                    {
                        time_premiums += line["amount"].as_f64().ok_or(GrossEvidenceError)?;
                    }
                    overtime += premium.payroll.breakdown["overtimeBaseAmount"]
                        .as_f64()
                        .ok_or(GrossEvidenceError)?
                        + premium.payroll.breakdown["overtimePremiumAmount"]
                            .as_f64()
                            .ok_or(GrossEvidenceError)?;
                }
                pay["shiftBreakdowns"] = json!(
                    premiums
                        .iter()
                        .map(|premium| premium.payroll.breakdown.clone())
                        .collect::<Vec<_>>()
                );
                pay["timePremiumAmount"] = json!(time_premiums);
                pay["overtimeAmount"] = json!(overtime);
                pay["estimatedGrossAmount"] = json!(
                    pay["personalBaseAmount"]
                        .as_f64()
                        .ok_or(GrossEvidenceError)?
                        + time_premiums
                        + overtime
                );
            }
            if let Some(overrides) = self.input["payOverrides"].as_object() {
                for (key, value) in overrides {
                    pay[key] = value.clone();
                }
            }
            if self.input["corruptRecorded"] == true && !premiums.is_empty() {
                let total = pay["shiftBreakdowns"][0]["totalAmount"]
                    .as_f64()
                    .ok_or(GrossEvidenceError)?;
                pay["shiftBreakdowns"][0]["totalAmount"] = json!(total + 1.0);
            }
            let covered = premiums
                .iter()
                .map(|premium| premium.shift_id.clone())
                .collect();
            let coverage = if need == EvidenceNeed::PayrollTraces {
                TraceCoverage::Complete {
                    regular_shift_ids: covered,
                    special_duty_shift_ids: BTreeSet::new(),
                }
            } else {
                TraceCoverage::NotRequested
            };
            Ok(Arc::new(GrossMonthEvidence {
                source: SalaryPaymentSource {
                    month: month.into(),
                    profile: Arc::clone(&profile),
                    profile_serialization: None,
                    shifts: Arc::clone(&shifts),
                    pay,
                },
                effective_profile,
                employment_periods: periods,
                projected_regular_shifts: shifts,
                premium_evidence: premiums,
                special_duty_traces: vec![],
                coverage,
            }))
        }
    }

    #[test]
    fn full_proof_checks_match_source_using_rust_created_gross_and_time_evidence() {
        let reference: Value =
            serde_json::from_str(include_str!("../../../reference/gross-proof-golden.json"))
                .expect("proofrawfacts");
        let resolver = RuleResolver::bundled().expect("bundledsource");
        let cases = reference["cases"].as_array().expect("cases");
        assert_eq!(cases.len(), 87);
        for case in cases {
            let input = &case["input"];
            let profile = Arc::new(input["profile"].clone());
            let shifts = Arc::new(input["shifts"].as_array().expect("rawshifts").clone());
            let mut provider = StageProvider { input, calls: 0 };
            let actual = calculate_automatic_net_pay_forecast(
                input["month"].as_str().expect("month"),
                Arc::clone(&profile),
                Arc::clone(&shifts),
                &input["settings"],
                &resolver,
                &mut provider,
            );
            assert_eq!(actual, case["expected"], "{}", case["id"]);
            assert_eq!(provider.calls, 1);
            let evidence = provider
                .month_evidence(
                    input["month"].as_str().expect("month"),
                    Arc::clone(&profile),
                    Arc::clone(&shifts),
                    EvidenceNeed::GrossOnly,
                    &resolver,
                )
                .expect("stageevidence");
            assert!(Arc::ptr_eq(&shifts, &evidence.projected_regular_shifts));
            assert!(Arc::ptr_eq(&shifts, &evidence.source.shifts));
            assert!(Arc::ptr_eq(&profile, &evidence.source.profile));
        }
    }
}
