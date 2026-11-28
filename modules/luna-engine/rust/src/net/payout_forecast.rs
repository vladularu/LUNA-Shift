//! Earned-month evidence is retained while one cash-month payroll is composed.
use super::automation::{AutomaticSalaryProof, finalize_automatic_salary_net};
use super::gross_evidence::{
    EvidenceNeed, GrossEvidenceProvider, ProofPreparation, forecast_cents,
    prepare_automatic_salary_proof,
};
use super::payment_projection::{
    PaymentContribution, SalaryPaymentProjection, SalaryPaymentSource,
};
use super::payment_schedule::{PAYMENT_GROUPS, SalaryPerspective, add_salary_payment_months};
use super::settings::resolve_net_pay_settings;
use super::{CalculationMode, resolve_calculation_basis};
use crate::rules::RuleResolver;
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::sync::Arc;

pub struct AutomaticPaymentInput<'a> {
    pub month: &'a str,
    pub profile: Arc<Value>,
    pub settings: &'a Value,
    pub projection: &'a SalaryPaymentProjection,
    pub source_settings: &'a [Value],
    pub social_insurance_attribution: Option<&'a str>,
}
#[derive(Debug, Clone, Copy)]
struct Failure;
type Outcome<T> = Result<T, Failure>;
fn money(value: &Value) -> Outcome<i64> {
    forecast_cents(value).map_err(|_| Failure)
}
fn integer(value: &Value) -> Outcome<i64> {
    super::integer_in_range(
        value,
        -crate::money::MAX_SAFE_INTEGER,
        crate::money::MAX_SAFE_INTEGER,
    )
    .ok_or(Failure)
}
fn year_month_difference(from: &str, until: &str) -> Outcome<i32> {
    if !super::valid_month(from) || !super::valid_month(until) {
        return Err(Failure);
    }
    let index = |month: &str| -> Outcome<i32> {
        Ok(month[..4].parse::<i32>().map_err(|_| Failure)? * 12
            + month[5..].parse::<i32>().map_err(|_| Failure)?)
    };
    Ok(index(until)? - index(from)?)
}
fn group_amount(pay: &Value, group: &str) -> Outcome<i64> {
    let allowance = if pay["confirmedAllowance"].is_null() {
        &pay["assessment"]["suggestedAllowance"]
    } else {
        &pay["confirmedAllowance"]
    };
    let monthly = allowance.as_str().ok_or(Failure)?.ends_with("_MONTHLY");
    match group {
        "ABSENCE_PAY" => pay.get("absencePayAmount").map(money).unwrap_or(Ok(0)),
        "BASE" => money(&pay["personalBaseAmount"]),
        "CARE_ALLOWANCE" => money(&pay["careAllowanceAmount"]),
        "TARIFF_ALLOWANCE" => money(&pay["tvoedAllowanceAmount"]),
        "PREMIUMS" => money(&pay["timePremiumAmount"]),
        "MONTHLY_ALLOWANCE" => {
            if monthly {
                money(&pay["allowanceAmount"])
            } else {
                Ok(0)
            }
        }
        "HOURLY_ALLOWANCE" => {
            if monthly {
                Ok(0)
            } else {
                money(&pay["allowanceAmount"])
            }
        }
        "OVERTIME" => money(&pay["overtimeAmount"]),
        "SPECIAL_DUTY" => {
            if pay["specialDutyAmount"].is_null() {
                Ok(0)
            } else {
                money(&pay["specialDutyAmount"])
            }
        }
        _ => Err(Failure),
    }
}
fn rows_for(proof: &AutomaticSalaryProof, groups: &[&str]) -> Outcome<Vec<Value>> {
    let mut ids = BTreeSet::new();
    if groups.contains(&"PREMIUMS") {
        ids.extend(proof.regular_shift_ids().iter().map(String::as_str));
    }
    if groups.contains(&"SPECIAL_DUTY") {
        ids.extend(proof.special_duty_shift_ids().iter().map(String::as_str));
    }
    Ok(proof.classification["shifts"]
        .as_array()
        .ok_or(Failure)?
        .iter()
        .filter(|row| row["shiftId"].as_str().is_some_and(|id| ids.contains(id)))
        .cloned()
        .collect())
}
fn ordinary_settings(settings: &Value, month: &str) -> Outcome<Value> {
    let mut result = settings.clone();
    let payments = settings["automation"]
        .get("annualPayments")
        .and_then(Value::as_array);
    if payments.is_some_and(|payments| {
        payments.iter().any(|payment| {
            payment["payoutMonth"]
                .as_str()
                .is_some_and(|payout| payout.starts_with(&month[..4]))
        })
    }) {
        result["specialCases"] = json!(
            settings["specialCases"]
                .as_array()
                .ok_or(Failure)?
                .iter()
                .filter(|value| *value != "ONE_OFF_PAYMENT")
                .cloned()
                .collect::<Vec<_>>()
        );
    }
    result["automation"]["annualPayments"] = json!([]);
    result["automation"]["additionalNetDeductionCents"] = json!(0);
    Ok(result)
}
fn base_proof(
    proof: &AutomaticSalaryProof,
    pay: &Value,
    settings: &Value,
    include_monthly: bool,
) -> Outcome<AutomaticSalaryProof> {
    let gross = money(&pay["personalBaseAmount"])?
        + money(&pay["careAllowanceAmount"])?
        + money(&pay["tvoedAllowanceAmount"])?
        + integer(&settings["automation"]["additionalRecurringGrossCents"])?
        + if include_monthly {
            group_amount(pay, "MONTHLY_ALLOWANCE")?
        } else {
            0
        };
    let mut result = proof.clone();
    result.classification["shifts"] = json!([]);
    result.classification["paidPremiumCents"] = json!(0);
    result.classification["taxFreeCents"] = json!(0);
    result.classification["socialInsuranceFreeCents"] = json!(0);
    result.classification["amounts"] = json!({"grossCents":gross,"taxableGrossCents":gross,"socialInsuranceGrossCents":gross,"regularMonthlySocialInsuranceGrossCents":proof.regular_gross_cents});
    Ok(result)
}
fn add_difference(base: &Value, added: &Value, removed: &Value, signed: &[&str]) -> Outcome<Value> {
    let mut result = serde_json::Map::new();
    for (key, value) in base.as_object().ok_or(Failure)? {
        let plus = &added[key];
        let minus = &removed[key];
        if !value.is_number() {
            if plus != minus {
                return Err(Failure);
            }
            result.insert(key.clone(), value.clone());
            continue;
        }
        let sum =
            i128::from(integer(value)?) + i128::from(integer(plus)?) - i128::from(integer(minus)?);
        if sum.abs() > i128::from(crate::money::MAX_SAFE_INTEGER)
            || (sum < 0 && !signed.contains(&key.as_str()))
        {
            return Err(Failure);
        }
        result.insert(key.clone(), json!(sum as i64));
    }
    Ok(Value::Object(result))
}
fn add_payroll_difference(base: &Value, added: &Value, removed: &Value) -> Outcome<Value> {
    let has = |pay: &Value| super::js_truthy(&pay["pension"]);
    if has(base) != has(added) || has(base) != has(removed) {
        return Err(Failure);
    }
    let mut pay = base.clone();
    pay["amounts"] = add_difference(
        &base["amounts"],
        &added["amounts"],
        &removed["amounts"],
        &[],
    )?;
    pay["tax"] = add_difference(&base["tax"], &added["tax"], &removed["tax"], &[])?;
    pay["socialInsurance"] = add_difference(
        &base["socialInsurance"],
        &added["socialInsurance"],
        &removed["socialInsurance"],
        &[],
    )?;
    if has(base) {
        let mut pension = add_difference(
            &base["pension"],
            &added["pension"],
            &removed["pension"],
            &["taxableAdjustmentCents", "socialInsuranceAdjustmentCents"],
        )?;
        if pension["scheme"] == "NONE" {
            pension["scheme"] = added["pension"]["scheme"].clone();
        }
        pay["pension"] = pension;
    }
    let net =
        integer(&base["netCents"])? + integer(&added["netCents"])? - integer(&removed["netCents"])?;
    let pension = pay["pension"]["employeeCents"].as_i64().unwrap_or(0);
    let deduction = pay["additionalNetDeductionCents"].as_i64().unwrap_or(0);
    if !(0..=crate::money::MAX_SAFE_INTEGER).contains(&net)
        || net
            != integer(&pay["amounts"]["grossCents"])?
                - integer(&pay["tax"]["totalCents"])?
                - integer(&pay["socialInsurance"]["totalCents"])?
                - pension
                - deduction
    {
        return Err(Failure);
    }
    pay["netCents"] = json!(net);
    Ok(pay)
}
fn available(forecast: &Value) -> bool {
    forecast["result"]["status"] == "available"
}
fn sum_rows(rows: &[Value], field: &str) -> Outcome<i64> {
    rows.iter().map(|row| integer(&row[field])).sum()
}
fn setting_rows(settings: &Value) -> Outcome<&[Value]> {
    match settings.get("annualPayments") {
        None | Some(Value::Null) => Ok(&[]),
        Some(Value::Array(values)) => Ok(values),
        _ => Err(Failure),
    }
}

struct Context<'a, 'b, P: ?Sized> {
    input: &'a AutomaticPaymentInput<'a>,
    resolver: &'a RuleResolver,
    provider: &'b mut P,
}
impl<P: GrossEvidenceProvider + ?Sized> Context<'_, '_, P> {
    fn stop(&self, reason: &str, stage: &str) -> Value {
        json!({"sourceMonth":self.input.settings["month"],"result":{"status":"unavailable","stage":stage,"reason":reason}})
    }
    fn prepare(
        &mut self,
        source: &SalaryPaymentSource,
        settings: &Value,
        current: bool,
    ) -> Outcome<ProofPreparation> {
        let profile = if current {
            Arc::clone(&self.input.profile)
        } else {
            Arc::clone(&source.profile)
        };
        let evidence = self
            .provider
            .month_evidence(
                source.month(),
                profile,
                Arc::clone(&source.shifts),
                EvidenceNeed::PayrollTraces,
                self.resolver,
            )
            .map_err(|_| Failure)?;
        Ok(prepare_automatic_salary_proof(
            &evidence,
            settings,
            self.resolver,
        ))
    }
    fn source_adjustment(
        &mut self,
        current: &SalaryPaymentSource,
        current_proof: &AutomaticSalaryProof,
        source: &SalaryPaymentSource,
        lag: i32,
        selected: &[&PaymentContribution],
    ) -> Outcome<Value> {
        let month = self.input.month;
        let settings = self.input.settings;
        let projection = self.input.projection;
        let cross_year = source.month().get(..4) != month.get(..4);
        let resolved = resolve_net_pay_settings(source.month(), self.input.source_settings)
            .map_err(|_| Failure)?;
        let source_settings = &resolved["settings"];
        if source_settings["version"] != 2 || source_settings["automation"].is_null() {
            let mut stop = self.stop(
                &format!(
                    "Für den Anspruchsmonat {} fehlen fortgeltende Netto-Grundlagen.",
                    source.month()
                ),
                "net-pay",
            );
            stop["recovery"] = json!({"kind":"net-settings","month":source.month()});
            return Ok(stop);
        }
        let source_proof = match self.prepare(source, source_settings, false)? {
            ProofPreparation::Available(proof) => proof,
            ProofPreparation::Unavailable(mut forecast) => {
                forecast["sourceMonth"] = settings["month"].clone();
                if forecast["recovery"]["kind"] == "net-settings" {
                    forecast["recovery"] = json!({"kind":"net-settings","month":source.month()});
                }
                return Ok(forecast);
            }
        };
        let expected = add_salary_payment_months(month, lag).map_err(|_| Failure)?;
        if projection
            .outgoing_contributions
            .iter()
            .any(|line| line.payment_month.as_deref() != Some(expected.as_str()))
        {
            return Ok(self.stop("Für uneinheitlich verschobene Zulagen ist diese Netto-Schätzung noch nicht verfügbar.","net-pay"));
        }
        let current_ordinary = ordinary_settings(settings, month)?;
        let source_ordinary = ordinary_settings(source_settings, source.month())?;
        let current_base = finalize_automatic_salary_net(
            month,
            &current_ordinary,
            &base_proof(current_proof, current.pay(), settings, false)?,
        );
        let source_base = finalize_automatic_salary_net(
            source.month(),
            &source_ordinary,
            &base_proof(&source_proof, source.pay(), source_settings, false)?,
        );
        let source_full =
            finalize_automatic_salary_net(source.month(), &source_ordinary, &source_proof);
        if !available(&current_base) {
            return Ok(current_base);
        }
        if !available(&source_base) || !available(&source_full) {
            let mut failure = if !available(&source_base) {
                source_base
            } else {
                source_full
            };
            failure["sourceMonth"] = settings["month"].clone();
            failure["recovery"] = json!({"kind":"net-settings","month":source.month()});
            return Ok(failure);
        }
        let bundle_gross: i64 = selected
            .iter()
            .filter(|line| line.claim_month == source.month())
            .map(|line| line.amount_cents)
            .sum();
        if integer(&source_full["result"]["pay"]["amounts"]["grossCents"])?
            - integer(&source_base["result"]["pay"]["amounts"]["grossCents"])?
            != bundle_gross
        {
            return Ok(self.stop(
                "Das verschobene Zulagenpaket ist nicht vollständig.",
                "net-pay",
            ));
        }
        let mut pay = add_payroll_difference(
            &current_base["result"]["pay"],
            &source_full["result"]["pay"],
            &source_base["result"]["pay"],
        )?;
        let gross = money(&projection.pay["estimatedGrossAmount"])?
            + integer(&settings["automation"]["additionalRecurringGrossCents"])?;
        let mut classification = source_proof.classification.clone();
        classification["calculationBasis"] =
            current_proof.classification["calculationBasis"].clone();
        classification["amounts"] = json!({"grossCents":gross,"taxableGrossCents":gross-integer(&source_proof.classification["taxFreeCents"])? ,"socialInsuranceGrossCents":gross-integer(&source_proof.classification["socialInsuranceFreeCents"])? ,"regularMonthlySocialInsuranceGrossCents":current_proof.regular_gross_cents});
        let mut annual_payment = None;
        if setting_rows(&settings["automation"])?
            .iter()
            .any(|payment| {
                payment["payoutMonth"] == month
                    && payment["grossCents"]
                        .as_i64()
                        .is_some_and(|gross| gross > 0)
            })
        {
            let mut proof = current_proof.clone();
            proof.classification = classification.clone();
            let nominal =
                finalize_automatic_salary_net(month, &ordinary_settings(settings, month)?, &proof);
            let mut with_settings = settings.clone();
            with_settings["automation"]["additionalNetDeductionCents"] = json!(0);
            let with_annual = finalize_automatic_salary_net(month, &with_settings, &proof);
            if !available(&nominal) || !available(&with_annual) {
                return Ok(self.stop("Die Jahreszahlung konnte nicht getrennt von den verzögerten Zulagen berechnet werden.","net-pay"));
            }
            pay = add_payroll_difference(
                &pay,
                &with_annual["result"]["pay"],
                &nominal["result"]["pay"],
            )?;
            annual_payment = with_annual.get("annualPayment").cloned();
        }
        let mut cross_year_estimate = None;
        if cross_year {
            let regular = finalize_automatic_salary_net(
                month,
                &current_ordinary,
                &base_proof(current_proof, current.pay(), settings, true)?,
            );
            if !available(&regular) {
                return Ok(regular);
            }
            // The public tax kernel accepts the exact same raw annual assumptions;
            // only these already-computed marginal payroll endpoints are combined.
            let mut tax_profile = settings["profile"].clone();
            tax_profile["worksInSaxony"] = json!(current_proof.profile["federalState"] == "SN");
            let profile = super::NetPayProfile::parse(&tax_profile).ok_or(Failure)?;
            let prior = integer(&source_full["result"]["pay"]["amounts"]["taxableGrossCents"])?
                - integer(&source_base["result"]["pay"]["amounts"]["taxableGrossCents"])?;
            let included = annual_payment
                .as_ref()
                .filter(|payment| payment["netIncluded"] == true)
                .map(|payment| integer(&payment["grossCents"]))
                .transpose()?
                .unwrap_or(0);
            let basis = super::annual_payment::ArrearsPayrollBasis {
                month,
                rules_year: i16::try_from(integer(
                    &current_base["result"]["pay"]["calculationBasis"]["rulesYear"],
                )?)
                .map_err(|_| Failure)?,
                taxable_gross_cents: integer(
                    &current_base["result"]["pay"]["amounts"]["taxableGrossCents"],
                )?,
            };
            let payments = json!(setting_rows(&settings["automation"])?);
            let estimate = super::annual_payment::estimate_cross_year_arrears_tax_basis(
                basis,
                integer(&regular["result"]["pay"]["amounts"]["taxableGrossCents"])?,
                &profile,
                &payments,
                prior,
                included,
            )
            .map_err(|_| Failure)?;
            let tax = estimate.tax;
            let old_tax = integer(&pay["tax"]["totalCents"])?;
            pay["netCents"] = json!(integer(&pay["netCents"])? + old_tax - tax.total_cents);
            pay["tax"] = serde_json::to_value(tax).map_err(|_| Failure)?;
            cross_year_estimate =
                Some(serde_json::to_value(estimate.estimate).map_err(|_| Failure)?);
        }
        let annual_gross = annual_payment
            .as_ref()
            .filter(|payment| payment["netIncluded"] == true)
            .map(|payment| integer(&payment["grossCents"]))
            .transpose()?
            .unwrap_or(0);
        if integer(&pay["amounts"]["grossCents"])? != gross + annual_gross {
            return Ok(self.stop(
                "Die Netto-Schätzung passt nicht zum Auszahlungsbrutto.",
                "net-pay",
            ));
        }
        let deduction = integer(&settings["automation"]["additionalNetDeductionCents"])?;
        if integer(&pay["netCents"])? < deduction {
            let mut stop = self.stop(
                "Die persönlichen Netto-Abzüge übersteigen die geschätzte Auszahlung.",
                "net-pay",
            );
            stop["recovery"] = json!({"kind":"net-settings"});
            return Ok(stop);
        }
        if deduction > 0 {
            pay["netCents"] = json!(integer(&pay["netCents"])? - deduction);
            pay["additionalNetDeductionCents"] = json!(deduction);
        }
        let mut timing =
            json!({"method":"SOURCE_ADJUSTMENT","sourceMonth":source.month(),"lag":lag});
        if let Some(estimate) = cross_year_estimate {
            timing["crossYearTaxEstimate"] = estimate;
        }
        let mut forecast = json!({"sourceMonth":settings["month"],"basicHourlyPayCents":source_proof.basic_hourly_pay_cents,"regularGrossCents":current_proof.regular_gross_cents,"pensionOmitted":super::js_truthy(&current_base["pensionOmitted"])||super::js_truthy(&source_full["pensionOmitted"]),"payrollTimingEstimate":timing,"result":{"status":"available","classification":classification,"pay":pay}});
        if let Some(payment) = annual_payment {
            forecast["annualPayment"] = payment;
        }
        Ok(forecast)
    }
}

impl<P: GrossEvidenceProvider + ?Sized> Context<'_, '_, P> {
    fn calculate(&mut self) -> Outcome<Value> {
        let input = self.input;
        let month = input.month;
        let settings = input.settings;
        let projection = input.projection;
        if projection.month != month || projection.pay["month"] != month {
            return Ok(self.stop(
                "Die Auszahlungsgrundlagen gehören zu unterschiedlichen Monaten.",
                "sfn",
            ));
        }
        if !projection.available || !projection.issues.is_empty() {
            return Ok(self.stop(
                projection
                    .issues
                    .first()
                    .and_then(|issue| issue["message"].as_str())
                    .unwrap_or("Die vollständigen Auszahlungsgrundlagen fehlen."),
                "sfn",
            ));
        }
        let sources = &projection.sources;
        let mut source_months = BTreeSet::new();
        for source in sources {
            if !source_months.insert(source.month()) || source.pay()["month"] != source.month() {
                return Ok(self.stop(
                    "Die Anspruchsmonate der Auszahlung sind widersprüchlich.",
                    "sfn",
                ));
            }
        }
        let Some(current) = sources.iter().find(|source| source.month() == month) else {
            return Ok(self.stop("Die Gehaltsgrundlage des Auszahlungsmonats fehlt.", "sfn"));
        };
        if projection.perspective == SalaryPerspective::Earned {
            return Ok(super::gross_evidence::calculate_automatic_net_pay_forecast(
                month,
                Arc::clone(&input.profile),
                Arc::clone(&current.shifts),
                settings,
                self.resolver,
                self.provider,
            ));
        }
        let selected: Vec<_> = projection
            .contributions
            .iter()
            .filter(|line| line.payment_month.as_deref() == Some(month))
            .collect();
        let mut seen = BTreeSet::new();
        for line in &selected {
            let source = sources
                .iter()
                .find(|source| source.month() == line.claim_month);
            let key = format!("{}:{}", line.claim_month, line.group);
            let difference = year_month_difference(&line.claim_month, month)?;
            if source.is_none()
                || seen.contains(&key)
                || !(0..=2).contains(&difference)
                || line.amount_cents < 0
                || line.amount_cents > crate::money::MAX_SAFE_INTEGER
                || source
                    .map(|source| group_amount(source.pay(), &line.group))
                    .transpose()?
                    .ok_or(Failure)?
                    != line.amount_cents
            {
                return Ok(self.stop(
                    "Die Auszahlungsbeträge passen nicht zu ihren Anspruchsmonaten.",
                    "sfn",
                ));
            }
            if ["BASE", "CARE_ALLOWANCE", "TARIFF_ALLOWANCE"].contains(&line.group.as_str())
                && difference != 0
            {
                return Ok(self.stop(
                    "Die laufende Gehaltsgrundlage gehört zu einem anderen Monat.",
                    "sfn",
                ));
            }
            seen.insert(key);
        }
        let gross: i64 = selected.iter().map(|line| line.amount_cents).sum();
        let pay = &projection.pay;
        let mut parts = 0;
        for key in [
            "personalBaseAmount",
            "careAllowanceAmount",
            "tvoedAllowanceAmount",
            "timePremiumAmount",
            "allowanceAmount",
            "overtimeAmount",
            "specialDutyAmount",
            "absencePayAmount",
        ] {
            parts +=
                if ["specialDutyAmount", "absencePayAmount"].contains(&key) && pay[key].is_null() {
                    0
                } else {
                    money(&pay[key])?
                };
        }
        if !super::js_truthy(&pay["available"])
            || pay["estimatedGrossAmount"].is_null()
            || pay["personalBaseAmount"].is_null()
            || gross != money(&pay["estimatedGrossAmount"])?
            || parts != gross
        {
            return Ok(self.stop(
                "Die Bestandteile passen nicht zum Auszahlungsbrutto.",
                "sfn",
            ));
        }
        if projection.outgoing_contributions.is_empty()
            && selected
                .iter()
                .all(|line| line.claim_month == month || line.amount_cents == 0)
            && gross == money(&current.pay()["estimatedGrossAmount"])?
        {
            return Ok(super::gross_evidence::calculate_automatic_net_pay_forecast(
                month,
                Arc::clone(&input.profile),
                Arc::clone(&current.shifts),
                settings,
                self.resolver,
                self.provider,
            ));
        }
        let current_proof = match self.prepare(current, settings, true)? {
            ProofPreparation::Available(proof) => proof,
            ProofPreparation::Unavailable(forecast) => return Ok(forecast),
        };
        let outgoing = &projection.outgoing_contributions;
        for line in outgoing {
            let key = format!("{month}:{}", line.group);
            if line.claim_month != month
                || line.group != "ABSENCE_PAY"
                    && !PAYMENT_GROUPS
                        .iter()
                        .any(|group| group.label() == line.group)
                || line.amount_cents <= 0
                || line.amount_cents > crate::money::MAX_SAFE_INTEGER
                || seen.contains(&key)
                || group_amount(current.pay(), &line.group)? != line.amount_cents
                || line.payment_month.as_deref().is_none_or(str::is_empty)
            {
                return Ok(self.stop(
                    "Die verzögerten Ansprüche des Auszahlungsmonats sind widersprüchlich.",
                    "sfn",
                ));
            }
            seen.insert(key);
            let difference =
                year_month_difference(month, line.payment_month.as_deref().ok_or(Failure)?)?;
            if !(1..=2).contains(&difference) {
                return Ok(self.stop(
                    "Für diese Verzögerung fehlen Berechnungsgrundlagen der Sozialversicherung.",
                    "sfn",
                ));
            }
        }
        for label in PAYMENT_GROUPS
            .iter()
            .map(|group| group.label())
            .chain(["ABSENCE_PAY"])
        {
            let included: i64 = selected
                .iter()
                .filter(|line| line.claim_month == month && line.group == label)
                .map(|line| line.amount_cents)
                .sum();
            let excluded: i64 = outgoing
                .iter()
                .filter(|line| line.group == label)
                .map(|line| line.amount_cents)
                .sum();
            if included + excluded != group_amount(current.pay(), label)? {
                return Ok(self.stop(
                    "Die Zuordnung der aktuellen und verzögerten Ansprüche ist unvollständig.",
                    "sfn",
                ));
            }
        }
        let variables: Vec<_> = selected
            .iter()
            .copied()
            .filter(|line| {
                PAYMENT_GROUPS
                    .iter()
                    .any(|group| group.label() == line.group)
            })
            .collect();
        if !selected.iter().any(|line| line.group == "ABSENCE_PAY")
            && !outgoing.iter().any(|line| line.group == "ABSENCE_PAY")
            && variables.len() == PAYMENT_GROUPS.len()
            && variables
                .iter()
                .map(|line| line.group.as_str())
                .collect::<BTreeSet<_>>()
                .len()
                == PAYMENT_GROUPS.len()
            && variables
                .iter()
                .map(|line| line.claim_month.as_str())
                .collect::<BTreeSet<_>>()
                .len()
                == 1
        {
            let source = sources
                .iter()
                .find(|source| source.month() == variables[0].claim_month)
                .ok_or(Failure)?;
            let lag = year_month_difference(source.month(), month)?;
            if source.month() != month && (lag == 1 || lag == 2) {
                return self.source_adjustment(current, &current_proof, source, lag, &selected);
            }
        }
        if outgoing
            .iter()
            .any(|line| line.group == "MONTHLY_ALLOWANCE")
        {
            return Ok(self.stop("Die Sozialversicherung einer verzögerten monatlichen Zulage muss dem Anspruchsmonat zugeordnet werden; diese Netto-Prognose ist noch nicht verfügbar.","sfn"));
        }
        let outgoing_gross: i64 = outgoing.iter().map(|line| line.amount_cents).sum();
        let outgoing_groups: Vec<_> = outgoing.iter().map(|line| line.group.as_str()).collect();
        let outgoing_rows = rows_for(&current_proof, &outgoing_groups)?;
        if outgoing_gross != sum_rows(&outgoing_rows, "socialInsuranceFreeCents")?
            && input.social_insurance_attribution != Some("CASH_VARIABLE")
        {
            return Ok(self.stop("Für beitragspflichtige verzögerte Bezüge fehlt die bestätigte Zuordnung der Sozialversicherung zum Auszahlungsmonat.","sfn"));
        }
        let current_basis = resolve_calculation_basis(month, CalculationMode::Forecast);
        let mut proof_rows = vec![];
        for source in sources {
            let lines: Vec<_> = selected
                .iter()
                .copied()
                .filter(|line| line.claim_month == source.month())
                .collect();
            if !lines.iter().any(|line| line.amount_cents > 0) {
                continue;
            }
            let delayed = source.month() != month;
            let resolved = if delayed {
                resolve_net_pay_settings(source.month(), input.source_settings)
                    .map_err(|_| Failure)?
            } else {
                Value::Null
            };
            let source_settings = if delayed {
                &resolved["settings"]
            } else {
                settings
            };
            if source_settings["automation"].is_null() {
                return Ok(self.stop(
                    &format!(
                        "Für den Anspruchsmonat {} fehlen fortgeltende Netto-Grundlagen.",
                        source.month()
                    ),
                    "sfn",
                ));
            }
            let source_proof = if delayed {
                match self.prepare(source, source_settings, false)? {
                    ProofPreparation::Available(proof) => proof,
                    ProofPreparation::Unavailable(mut forecast) => {
                        forecast["sourceMonth"] = settings["month"].clone();
                        return Ok(forecast);
                    }
                }
            } else {
                current_proof.clone()
            };
            let groups: Vec<_> = lines.iter().map(|line| line.group.as_str()).collect();
            let rows = rows_for(&source_proof, &groups)?;
            if delayed {
                let source_basis = &source_proof.classification["calculationBasis"];
                if current_basis.as_ref().is_none_or(|basis| {
                    source_basis["rulesYear"].as_i64() != Some(i64::from(basis.rules_year))
                }) {
                    return Ok(self.stop("Für die Anspruchs- und Auszahlungsjahre fehlen gemeinsame Berechnungsgrundlagen.","sfn"));
                }
                let employment =
                    crate::employment::capture_employment_profile(&source_proof.profile)
                        .map_err(|_| Failure)?;
                let current_employment =
                    crate::employment::capture_employment_profile(&current_proof.profile)
                        .map_err(|_| Failure)?;
                if employment != current_employment
                    || source_proof.regular_gross_cents != current_proof.regular_gross_cents
                {
                    return Ok(self.stop("Bei geänderten Beschäftigungs- oder laufenden Gehaltsgrundlagen ist die verzögerte Netto-Prognose noch nicht verfügbar.","sfn"));
                }
                if lines
                    .iter()
                    .any(|line| line.group == "MONTHLY_ALLOWANCE" && line.amount_cents > 0)
                {
                    return Ok(self.stop("Die Sozialversicherung einer verzögerten monatlichen Zulage muss dem Anspruchsmonat zugeordnet werden; diese Netto-Prognose ist noch nicht verfügbar.","sfn"));
                }
                let delayed_gross: i64 = lines.iter().map(|line| line.amount_cents).sum();
                let free_gross = sum_rows(&rows, "socialInsuranceFreeCents")?;
                if delayed_gross != free_gross
                    && input.social_insurance_attribution != Some("CASH_VARIABLE")
                {
                    return Ok(self.stop("Für beitragspflichtige verzögerte Bezüge fehlt die bestätigte Zuordnung der Sozialversicherung zum Auszahlungsmonat.","sfn"));
                }
                if delayed_gross != free_gross
                    && (source_settings["automation"]["pensionScheme"]
                        != settings["automation"]["pensionScheme"]
                        || source_settings["automation"].get("pensionEmployeeRateBps")
                            != settings["automation"].get("pensionEmployeeRateBps"))
                {
                    return Ok(self.stop("Bei geänderter Zusatzversorgung ist die verzögerte Netto-Prognose noch nicht verfügbar.","sfn"));
                }
            }
            proof_rows.extend(rows);
        }
        let mut ids = BTreeSet::new();
        if proof_rows
            .iter()
            .any(|row| !ids.insert(row["shiftId"].as_str().unwrap_or("")))
        {
            return Ok(self.stop(
                "Die Diensteinträge der Auszahlung sind nicht eindeutig.",
                "sfn",
            ));
        }
        let tax_free = sum_rows(&proof_rows, "taxFreeCents")?;
        let social_free = sum_rows(&proof_rows, "socialInsuranceFreeCents")?;
        let paid = sum_rows(&proof_rows, "paidPremiumCents")?;
        let total_gross =
            gross + integer(&settings["automation"]["additionalRecurringGrossCents"])?;
        if paid > total_gross || social_free > tax_free || tax_free > total_gross {
            return Ok(self.stop(
                "Die SFN-Nachweise passen nicht zum Auszahlungsbrutto.",
                "sfn",
            ));
        }
        let mut proof = *current_proof;
        proof.classification["calculationBasis"] =
            serde_json::to_value(current_basis.ok_or(Failure)?).map_err(|_| Failure)?;
        proof.classification["shifts"] = json!(proof_rows);
        proof.classification["paidPremiumCents"] = json!(paid);
        proof.classification["taxFreeCents"] = json!(tax_free);
        proof.classification["socialInsuranceFreeCents"] = json!(social_free);
        proof.classification["amounts"] = json!({"grossCents":total_gross,"taxableGrossCents":total_gross-tax_free,"socialInsuranceGrossCents":total_gross-social_free,"regularMonthlySocialInsuranceGrossCents":proof.regular_gross_cents});
        Ok(finalize_automatic_salary_net(month, settings, &proof))
    }
}

pub fn calculate_automatic_payment_net_pay_forecast<'a, P: GrossEvidenceProvider + ?Sized>(
    input: &'a AutomaticPaymentInput<'a>,
    resolver: &'a RuleResolver,
    provider: &mut P,
) -> Value {
    let mut context = Context {
        input,
        resolver,
        provider,
    };
    context.calculate().unwrap_or_else(|_| {
        context.stop(
            "Die Anspruchs- und Auszahlungsgrundlagen konnten nicht vollständig zugeordnet werden.",
            "sfn",
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::net::gross_evidence::{GrossEvidenceError, GrossMonthEvidence};
    use crate::net::payment_projection::{ProjectionError, project_salary_payment};
    use std::collections::BTreeMap;

    struct StagePayoutProvider<'a> {
        specs: &'a [Value],
        cache: BTreeMap<String, Arc<GrossMonthEvidence>>,
        priced_months: BTreeSet<String>,
    }
    impl GrossEvidenceProvider for StagePayoutProvider<'_> {
        fn month_evidence(
            &mut self,
            month: &str,
            profile: Arc<Value>,
            shifts: Arc<Vec<Value>>,
            need: EvidenceNeed,
            resolver: &RuleResolver,
        ) -> Result<Arc<GrossMonthEvidence>, GrossEvidenceError> {
            if let Some(evidence) = self.cache.get(month) {
                return Ok(Arc::clone(evidence));
            }
            let spec = self
                .specs
                .iter()
                .find(|spec| spec["month"] == month)
                .ok_or(GrossEvidenceError)?;
            let mut builder = crate::net::gross_evidence::tests::StageProvider {
                input: spec,
                calls: 0,
            };
            let evidence = builder.month_evidence(month, profile, shifts, need, resolver)?;
            assert!(
                self.priced_months.insert(month.into()),
                "each month prices once"
            );
            self.cache.insert(month.into(), Arc::clone(&evidence));
            Ok(evidence)
        }
    }

    #[test]
    fn payout_composition_matches_frozen_source_with_native_evidence() {
        let reference: Value = serde_json::from_str(include_str!(
            "../../../reference/payout-forecast-golden.json"
        ))
        .expect("raw source and payout facts");
        let cases = reference["cases"].as_array().expect("cases");
        assert_eq!(cases.len(), 416);
        let resolver = RuleResolver::bundled().expect("bundled source");
        for case in cases {
            let input = &case["input"];
            let specs = input["sourceSpecs"].as_array().expect("source facts");
            let mut provider = StagePayoutProvider {
                specs,
                cache: BTreeMap::new(),
                priced_months: BTreeSet::new(),
            };
            let preferences = crate::net::payment_schedule::validate_salary_payment_preferences(
                &input["preferences"],
            )
            .expect("preferences");
            let month = input["month"].as_str().expect("month");
            let perspective =
                serde_json::from_value(input["perspective"].clone()).expect("perspective");
            let projection = project_salary_payment(month, perspective, &preferences, |month| {
                let spec = specs
                    .iter()
                    .find(|spec| spec["month"] == month)
                    .ok_or(ProjectionError::MissingSource)?;
                let evidence = provider
                    .month_evidence(
                        month,
                        Arc::new(spec["profile"].clone()),
                        Arc::new(spec["shifts"].as_array().expect("shifts").clone()),
                        EvidenceNeed::PayrollTraces,
                        &resolver,
                    )
                    .map_err(|_| ProjectionError::InvalidSource)?;
                Ok(evidence.source.clone())
            })
            .expect("native projection");
            let history = input["sourceSettings"].as_array().expect("history");
            let selected = match resolve_net_pay_settings(month, history) {
                Ok(selected) => selected,
                Err(error) => {
                    assert_eq!(
                        json!({"$error":error.to_string()}),
                        case["expected"],
                        "{}",
                        case["id"]
                    );
                    continue;
                }
            };
            let request = AutomaticPaymentInput {
                month,
                profile: Arc::new(input["profile"].clone()),
                settings: &selected["settings"],
                projection: &projection,
                source_settings: history,
                social_insurance_attribution: input["socialInsuranceAttribution"].as_str(),
            };
            let actual =
                calculate_automatic_payment_net_pay_forecast(&request, &resolver, &mut provider);
            assert_eq!(actual, case["expected"], "{}", case["id"]);
            assert_eq!(provider.priced_months.len(), provider.cache.len());
        }
    }
}
