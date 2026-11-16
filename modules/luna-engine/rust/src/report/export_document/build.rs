//! Original export composition over the existing native kernels.
use super::{
    annual,
    model::{ReportDocument, ReportInput},
    profiles,
    rows::{DocumentRows, append_report_data},
    shape,
};
use crate::{
    compliance::{
        annual::AnnualComplianceSource,
        checks,
        dated::{self, PreparedDatedComplianceSource},
        model::ComplianceError,
        profile::ComplianceProfile,
        selection::PreparedComplianceEntries,
    },
    credit::context::{DailyCreditContextCache, DailyCreditError},
    employment::EmploymentError,
    net::{
        annual_payment::validate_annual_salary_payments,
        payment_schedule::{SalaryPerspective, validate_salary_payment_preferences},
        settings::{SettingsError, collect_annual_salary_payments, resolve_net_pay_settings},
    },
    report::{
        computation::Computation,
        financial::{
            FinancialError, FinancialSnapshotInput,
            annual_salary::annual_salary_forecast,
            gross,
            net::{self, AnnualNetPayMonth, PaymentNetPreparation},
            presentation::js_round,
            source::FinancialContext,
        },
        time::TimeReportContext,
    },
    target::PreparedTargetSource,
};
use serde_json::{Value, json};
use std::sync::Arc;
#[derive(Debug)]
pub struct DocumentBuildError {
    name: &'static str,
    message: String,
}
impl DocumentBuildError {
    fn new(name: &'static str, error: impl std::fmt::Display) -> Self {
        Self {
            name,
            message: error.to_string(),
        }
    }
    pub fn source_error_name(&self) -> &'static str {
        self.name
    }
}
impl std::fmt::Display for DocumentBuildError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for DocumentBuildError {}
impl From<FinancialError> for DocumentBuildError {
    fn from(e: FinancialError) -> Self {
        Self::new(
            if e.rule_failure_details().is_some() {
                "RuleResolutionError"
            } else {
                "Error"
            },
            e,
        )
    }
}
impl From<EmploymentError> for DocumentBuildError {
    fn from(e: EmploymentError) -> Self {
        Self::new("Error", e)
    }
}
impl From<SettingsError> for DocumentBuildError {
    fn from(e: SettingsError) -> Self {
        Self::new("NetPayProfileValidationError", e)
    }
}
impl From<DailyCreditError> for DocumentBuildError {
    fn from(e: DailyCreditError) -> Self {
        Self::new(
            if matches!(e, DailyCreditError::Target(_)) {
                "WorkingTimeTargetError"
            } else {
                "Error"
            },
            e,
        )
    }
}
impl From<super::rows::DocumentError> for DocumentBuildError {
    fn from(e: super::rows::DocumentError) -> Self {
        Self::new("Error", e)
    }
}
impl From<crate::report::time::TimeReportError> for DocumentBuildError {
    fn from(e: crate::report::time::TimeReportError) -> Self {
        Self::new(e.source_error_name(), e)
    }
}
impl From<crate::report::export_rows::ReportEntryError> for DocumentBuildError {
    fn from(e: crate::report::export_rows::ReportEntryError) -> Self {
        match e {
            crate::report::export_rows::ReportEntryError::Credit(e) => e.into(),
            e => Self::new("Error", e),
        }
    }
}
impl From<ComplianceError> for DocumentBuildError {
    fn from(e: ComplianceError) -> Self {
        Self::new(e.source_error_name(), e)
    }
}
fn invalid() -> DocumentBuildError {
    DocumentBuildError::new("Error", "Die Berichtsdaten sind ungültig.")
}
fn months(period: &str) -> Result<Vec<String>, DocumentBuildError> {
    if ![4, 7].contains(&period.len()) || !period.as_bytes()[..4].iter().all(u8::is_ascii_digit) {
        return Err(DocumentBuildError::new(
            "Error",
            "Ungültiger Berichtszeitraum.",
        ));
    }
    let year = period[..4].parse::<i32>().map_err(|_| invalid())?;
    if !(1900..=4099).contains(&year) {
        return Err(DocumentBuildError::new(
            "Error",
            "Ungültiger Berichtszeitraum.",
        ));
    }
    if period.len() == 7 {
        crate::calendar::month_range(period)
            .map_err(|e| DocumentBuildError::new("RangeError", e))?;
        Ok(vec![period.into()])
    } else {
        Ok((1..=12).map(|i| format!("{year}-{i:02}")).collect())
    }
}
fn value(v: &impl serde::Serialize) -> Result<Value, DocumentBuildError> {
    serde_json::to_value(v).map_err(|_| invalid())
}
fn strip_traces(v: &mut Value) {
    match v {
        Value::Array(a) => a.iter_mut().for_each(strip_traces),
        Value::Object(o) => {
            o.remove("payrollTrace");
            o.remove("payrollTraces");
            o.values_mut().for_each(strip_traces);
        }
        _ => {}
    }
}
fn add(
    rows: &mut DocumentRows,
    section: &str,
    period: &str,
    record: &str,
    mut data: Value,
) -> Result<(), DocumentBuildError> {
    if section == "Gehaltsprognose" {
        strip_traces(&mut data)
    }
    append_report_data(rows, section, period, record, &data)?;
    Ok(())
}
fn unavailable(reason: impl std::fmt::Display) -> Value {
    json!({"status":"Nicht verfügbar","reason":reason.to_string()})
}
fn gross_value(pay: &Value, annual: i64) -> Value {
    let mut v = pay.clone();
    if v["available"] == true {
        if let Some(g) = v["estimatedGrossAmount"].as_f64() {
            v["estimatedGrossAmount"] = json!(js_round(g * 100.0 + annual as f64) / 100.0);
        }
        if annual != 0 {
            v["annualPaymentAmount"] = json!(annual as f64 / 100.0);
        }
    } else if v.get("knownGrossAmount").is_some() {
        v["knownGrossAmount"] = json!(
            js_round(v["knownGrossAmount"].as_f64().unwrap_or(0.0) * 100.0 + annual as f64) / 100.0
        );
        if annual != 0 {
            v["annualPaymentAmount"] = json!(annual as f64 / 100.0);
        }
        v["status"] = json!("Bekanntes Brutto · Bereitschaft noch offen");
    } else {
        for k in [
            "timePremiumAmount",
            "overtimeAmount",
            "allowanceAmount",
            "tvoedAllowanceAmount",
            "careAllowanceAmount",
        ] {
            v[k] = Value::Null;
        }
        v["status"] = json!("Nicht verfügbar");
    }
    v
}
fn compliance(
    input: &ReportInput<'_>,
    month: &str,
    entries: &PreparedComplianceEntries,
) -> Result<Value, ComplianceError> {
    input
        .resolver
        .resolve_holiday(&format!("{month}-01"))
        .map_err(ComplianceError::Rules)?;
    let selected = entries.select(month, &input.resolver)?;
    let source = PreparedDatedComplianceSource::with_shared_collation(
        selected.into_iter().cloned().collect::<Vec<_>>().into(),
        Arc::clone(&input.collation),
    );
    let mut options =
        json!({"referenceDate":input.reference_date,"youthProtection":input.youth_protection});
    for k in [
        "federalState",
        "holidayRegion",
        "weeklyMinutes",
        "regularRotatingNightWork",
        "sundayHolidayWorkEligible",
        "allEmploymentWorkRecorded",
    ] {
        if let Some(v) = input.profile.get(k) {
            options[k] = v.clone();
        }
    }
    let result = dated::calculate_monthly_compliance_with_basis(
        month,
        &source,
        input.profile["timeZone"]
            .as_str()
            .ok_or(ComplianceError::InvalidInput)?,
        &options,
        input.reference_date,
        &input.resolver,
        ComplianceProfile::from_raw(&input.profile),
    )?;
    let mut value = checks::select_visible_compliance(result.result(), true)
        .map_err(|_| ComplianceError::InvalidInput)?;
    shape::checks(&mut value);
    Ok(value)
}
fn annual_display(mut report: Value, paid: &Value) -> Result<Value, DocumentBuildError> {
    shape::annual(&mut report);
    let mut report = checks::select_annual_check_display(&report, true).map_err(|_| invalid())?;
    for k in ["estimatedGrossAmount", "annualPaymentAmount"] {
        if let Some(v) = paid.get(k) {
            report[k] = v.clone();
        }
    }
    let paid_months = paid["months"].as_array().ok_or_else(invalid)?;
    for (m, p) in report["months"]
        .as_array_mut()
        .ok_or_else(invalid)?
        .iter_mut()
        .zip(paid_months)
    {
        for k in ["estimatedGrossAmount", "annualPaymentAmount"] {
            if let Some(v) = p.get(k) {
                m[k] = v.clone();
            }
        }
    }
    if report["availablePayMonthCount"] == 0 {
        for k in [
            "premiumAmount",
            "overtimeAmount",
            "allowanceAmount",
            "estimatedGrossAmount",
        ] {
            report[k] = Value::Null;
        }
    }
    let complete = report["complianceCoverageComplete"] == true;
    for k in [
        "criticalCount",
        "warningCount",
        "infoCount",
        "prerequisiteCount",
        "scopeCount",
    ] {
        if !complete {
            report[k] = Value::Null;
        } else if report.get(k).is_none() {
            report[k] = json!(0);
        }
    }
    for m in report["months"].as_array_mut().ok_or_else(invalid)? {
        if m["estimatedGrossAmount"].is_null() {
            m["premiumAmount"] = Value::Null;
        }
        for k in [
            "criticalCount",
            "warningCount",
            "infoCount",
            "prerequisiteCount",
            "scopeCount",
        ] {
            if m["complianceComplete"] == false {
                m[k] = Value::Null;
            } else if m.get(k).is_none() {
                m[k] = json!(0);
            }
        }
    }
    report["reason"] = json!(format!(
        "Gehaltsprognose für {} von 12 Monaten verfügbar; die Summe umfasst ausschließlich diese Monate.",
        report["availablePayMonthCount"]
    ));
    Ok(report)
}
pub fn build_report(input: &ReportInput<'_>) -> Result<ReportDocument, DocumentBuildError> {
    build_with_rows(input, DocumentRows::default())
}
/// Same original calculations and failure order; retain only artifact reader
/// fields instead of the full reference/debug document tree.
pub fn build_artifact_document(
    input: &ReportInput<'_>,
) -> Result<ReportDocument, DocumentBuildError> {
    build_with_rows(input, DocumentRows::artifact())
}
fn build_with_rows(
    input: &ReportInput<'_>,
    mut rows: DocumentRows,
) -> Result<ReportDocument, DocumentBuildError> {
    let months = months(input.period)?;
    let year = input.period[..4].parse::<i32>().map_err(|_| invalid())?;
    let annual = months.len() == 12;
    let fin_input = FinancialSnapshotInput {
        profile: &input.profile,
        entries: &input.entries,
        tariff_decisions: input.tariff_decisions,
        work_pattern_settings: input.work_pattern_settings,
        test_months: input.test_months,
    };
    let mut financial = FinancialContext::new(&fin_input, &input.resolver)?;
    let saved_payments = collect_annual_salary_payments(input.net_pay_timeline)?;
    let proposal = annual_salary_forecast(
        year,
        &mut financial,
        saved_payments.as_array().ok_or_else(invalid)?,
    )?;
    let payments = validate_annual_salary_payments(&proposal["payments"])
        .map_err(|e| DocumentBuildError::new("NetPayProfileValidationError", e))?;
    let target = Arc::new(PreparedTargetSource::new(Arc::clone(&input.profile)));
    let mut time = TimeReportContext::with_shared_collation(
        Arc::clone(&input.profile),
        Arc::clone(&target),
        Arc::clone(&input.entries),
        Arc::clone(&input.resolver),
        Arc::clone(&input.collation),
    )?;
    let mut credit = DailyCreditContextCache::with_source(&target, &input.resolver);
    let entries = PreparedComplianceEntries::from_shared(Arc::clone(&input.entries))?;
    add(
        &mut rows,
        "Bericht",
        input.period,
        "Grundlagen",
        json!({"createdAt":input.created_at,"referenceDate":input.reference_date,"testMonths":input.test_months.iter().filter(|m|months.contains(m)).collect::<Vec<_>>(),"youthProtection":input.youth_protection,"reason":"Gehaltsprognose: unverbindliche Brutto-/Nettoschätzung, keine Lohnabrechnung. Bei regulären Diensten setzt die Prognose Pausen ohne Zeitangabe mittig an. Bei Bereitschaftsdiensten können weitere Pausenangaben nötig sein. Automatische Prüfhinweise sind keine Rechtsberatung."}),
    )?;
    add(
        &mut rows,
        "Profil",
        input.period,
        "Berechnungsgrundlagen",
        profiles::metadata(&input.profile, &format!("{}-01", months[0]))?,
    )?;
    add(
        &mut rows,
        "Profil",
        input.period,
        "Arbeitsmuster",
        value(input.work_pattern_settings)?,
    )?;
    if input.profile["employmentTimeline"]
        .as_array()
        .is_some_and(|a| a.iter().any(|e| crate::net::js_truthy(&e["employment"])))
    {
        for month in &months {
            for period in crate::employment::employment_month_boundaries(
                &input.profile,
                month,
                &format!("{month}-31"),
            )? {
                add(
                    &mut rows,
                    "Profil",
                    month,
                    &format!("Beschäftigung ab {}", period.from),
                    profiles::metadata(&input.profile, &period.from)?,
                )?;
            }
        }
    }
    if annual {
        let checks = AnnualComplianceSource::from_shared_entries(
            Arc::clone(&input.entries),
            Arc::clone(&input.profile),
            Arc::clone(&input.resolver),
            Arc::clone(&input.collation),
            input.reference_date.into(),
            input.youth_protection,
        )
        .map_err(|e| DocumentBuildError::new("Error", e))?;
        let (report, gross) = annual::calculate_with_gross(
            year,
            &mut time,
            &mut financial,
            &checks,
            &input.collation,
        )
        .map_err(|e| DocumentBuildError::new("Error", e))?;
        let paid =
            gross::with_annual_salary_payments(&gross, input.net_pay_timeline, Some(&payments))?;
        add(
            &mut rows,
            "Jahresauswertung",
            input.period,
            "Jahresübersicht",
            annual_display(report, &value(&paid)?)?,
        )?;
    }
    let preferences = input
        .salary_payment_preferences
        .map(validate_salary_payment_preferences)
        .transpose()
        .map_err(|e| DocumentBuildError::new("Error", e))?;
    let default_preferences = validate_salary_payment_preferences(
        &json!({"version":1,"periods":[],"reviewedEmptyMonths":[]}),
    )
    .map_err(|e| DocumentBuildError::new("Error", e))?;
    let net_profile = input.net_pay_profile.as_ref().unwrap_or(&input.profile);
    let net_input = FinancialSnapshotInput {
        profile: net_profile,
        ..fin_input
    };
    let mut net_context = None;
    let mut targets = vec![];
    let mut readable = vec![];
    let mut annual_net = vec![];
    for month in months {
        if crate::net::js_truthy(&input.profile["workingTimeTarget"]) {
            targets.push(credit.base_monthly_target(&month, None)?.as_ref().clone());
        }
        let calculation = time.month_shared(&month)?;
        let summary = match calculation.summary() {
            Computation::Ready(v) => {
                let mut v = v.clone();
                shape::summary(&mut v);
                if v["specialDutyNotes"]
                    .as_array()
                    .is_some_and(|a| !a.is_empty())
                {
                    v["balanceMinutes"] = Value::Null;
                    v["status"] = json!("Zeitgutschrift der Bereitschaften noch offen");
                }
                v
            }
            v => {
                let v = value(v)?;
                unavailable(v["error"]["message"].as_str().unwrap_or(""))
            }
        };
        add(&mut rows, "Arbeitszeit", &month, "Monatsübersicht", summary)?;
        let mut stats = calculation.shift_type_analysis().clone();
        shape::shift_stats(&mut stats, false);
        add(&mut rows, "Schichtstatistik", &month, "Verteilung", stats)?;
        let pay = if let Some(p) = &preferences {
            financial
                .salary_projection(&month, p, SalaryPerspective::Payout)
                .map(|p| p.pay)
        } else {
            financial.salary_month(&month).map(|p| p.pay().clone())
        };
        let pay = match pay {
            Ok(v) => Ok(v),
            Err(e) if e.rule_failure_details().is_some() => Err(e),
            Err(e) => return Err(e.into()),
        };
        let saved = resolve_net_pay_settings(&month, input.net_pay_timeline)?;
        let annual_gross = payments
            .iter()
            .find(|p| p.payout_month == month)
            .map_or(0, |p| p.gross_cents);
        let mut gross = match &pay {
            Ok(v) => gross_value(v, annual_gross),
            Err(e) => unavailable(e),
        };
        // The source projection owns an undefined knownGrossAmount property.
        // Its branch test runs before appendReportData renders it as null.
        if preferences.is_some()
            && pay
                .as_ref()
                .is_ok_and(|v| v.get("knownGrossAmount").is_none())
        {
            let object = gross.as_object_mut().ok_or_else(invalid)?;
            let annual_payment = object.shift_remove("annualPaymentAmount");
            let status = object.shift_remove("status");
            object.insert("knownGrossAmount".into(), Value::Null);
            if let Some(payment) = annual_payment {
                object.insert("annualPaymentAmount".into(), payment);
            }
            if let Some(status) = status {
                object.insert("status".into(), status);
            }
        }
        add(
            &mut rows,
            "Gehaltsprognose",
            &month,
            "Bruttoschätzung",
            gross,
        )?;
        if !saved.is_null() {
            append_report_data(
                &mut rows,
                "Netto-Grundlagen",
                &month,
                "Gespeicherte Angaben",
                &saved,
            )?;
        }
        let mut forecast = None;
        if !saved.is_null() {
            let settings = &saved["settings"];
            if annual || (preferences.is_some() && settings["version"] == 2) {
                if settings["version"] == 2 && !input.test_months.contains(&month) {
                    if net_context.is_none() {
                        net_context = Some(FinancialContext::new(&net_input, &input.resolver)?);
                    }
                    let payment = PaymentNetPreparation {
                        preferences: preferences.as_ref().unwrap_or(&default_preferences),
                        perspective: SalaryPerspective::Payout,
                        source_settings: input.net_pay_timeline,
                        projection: None,
                    };
                    forecast = Some(net::prepare_automatic_net_pay(
                        &month,
                        settings,
                        net_context.as_mut().ok_or_else(invalid)?,
                        Some(&payment),
                    ));
                }
            } else if pay.is_ok() {
                let mut settings = settings.clone();
                if crate::net::js_truthy(&settings["automation"]) {
                    settings["automation"]["annualPayments"] = proposal["payments"].clone();
                }
                forecast = Some(net::prepare_automatic_net_pay(
                    &month,
                    &settings,
                    &mut financial,
                    None,
                ));
            }
        }
        if let Some(mut forecast) = forecast {
            shape::forecast(&mut forecast);
            if annual {
                annual_net.push(net::annual_net_pay_month(&month, &forecast)?);
            }
            let unavailable = forecast["result"]["status"] != "available";
            add(
                &mut rows,
                "Netto-Prognose",
                &month,
                "Berechnung und Abzüge",
                forecast,
            )?;
            if unavailable {
                add(
                    &mut rows,
                    "Netto-Prognose",
                    &month,
                    "Ergebnis",
                    json!({"netCents":null}),
                )?;
            }
        } else {
            let test = input.test_months.contains(&month);
            if annual {
                annual_net.push(AnnualNetPayMonth {
                    month: month.clone(),
                    net_cents: None,
                    status: Some(
                        if test {
                            "Im Testmonat gesperrt"
                        } else {
                            "Noch nicht eingerichtet"
                        }
                        .into(),
                    ),
                    notes: vec![],
                    preliminary: false,
                });
            }
            add(
                &mut rows,
                "Netto-Prognose",
                &month,
                "Ergebnis",
                json!({"status":"Nicht verfügbar","netCents":null,"reason":if annual&&test{"Im Testmonat gesperrt"}else if !saved.is_null()&&(!annual||saved["settings"]["version"]==2){"Die Brutto-Berechnungsgrundlagen sind nicht verfügbar."}else{"Für diesen Monat sind keine Netto-Angaben eingerichtet."}}),
            )?;
        }
        add(
            &mut rows,
            "Tarifbestätigung",
            &month,
            "Zulagen",
            input
                .tariff_decisions
                .iter()
                .find(|d| d["month"] == month)
                .cloned()
                .unwrap_or(Value::Null),
        )?;
        match compliance(input, &month, &entries) {
            Ok(mut v) => {
                if v.get("prerequisiteCount").is_none() {
                    v["prerequisiteCount"] = json!(0);
                }
                add(
                    &mut rows,
                    "Auswertung",
                    &month,
                    "Arbeitszeitrecht und Hinweise & Empfehlungen",
                    v,
                )?;
            }
            Err(e) if e.source_error_name() == "RuleResolutionError" => add(
                &mut rows,
                "Auswertung",
                &month,
                "Arbeitszeitprüfung",
                unavailable(e),
            )?,
            Err(e) => return Err(e.into()),
        }
        let mut month_entries = input
            .entries
            .iter()
            .filter(|e| {
                e["deletedAt"].is_null()
                    && e["date"]
                        .as_str()
                        .is_some_and(|d| d.starts_with(&format!("{month}-")))
            })
            .map(|e| {
                let rank = |k: &str| {
                    input
                        .collation
                        .rank(e[k].as_str().unwrap_or(""))
                        .map_err(|e| DocumentBuildError::new("Error", e))
                };
                Ok(((rank("date")?, rank("startTime")?, rank("id")?), e))
            })
            .collect::<Result<Vec<_>, DocumentBuildError>>()?;
        month_entries.sort_by_key(|(key, _)| *key);
        let month_entries = month_entries
            .into_iter()
            .map(|(_, e)| e)
            .collect::<Vec<_>>();
        if month_entries.is_empty() {
            add(
                &mut rows,
                "Kalendereinträge",
                &month,
                "Tagesliste",
                json!({"status":"Keine Einträge"}),
            )?;
        }
        readable.extend(
            crate::report::export_rows::report_entries_from_refs_bounded(
                &month_entries,
                &mut credit,
                &input.collation,
                100_000usize.saturating_sub(readable.len()),
            )?,
        );
        for entry in month_entries {
            append_report_data(
                &mut rows,
                if entry["kind"] == "SHIFT" {
                    "Dienste und Abwesenheiten"
                } else {
                    "Termine"
                },
                &month,
                &format!(
                    "{} · {} · {}",
                    entry["date"].as_str().unwrap_or(""),
                    entry["title"].as_str().unwrap_or(""),
                    entry["id"].as_str().unwrap_or("")
                ),
                entry,
            )?;
        }
    }
    if annual {
        let summary = net::summarize_annual_net_pay(year, annual_net);
        add(
            &mut rows,
            "Jahresauswertung",
            input.period,
            "Netto-Prognose",
            json!({"netCents":summary.net_cents,"availableNetMonthCount":summary.available_month_count,"reason":format!("Netto-Prognose für {} von 12 Monaten verfügbar; die Summe umfasst ausschließlich diese Monate.",summary.available_month_count)}),
        )?;
    }
    Ok(ReportDocument {
        period: input.period.into(),
        created_at: input.created_at.into(),
        rows: rows.into_rows(),
        entries: readable,
        working_time_targets: targets,
    })
}
