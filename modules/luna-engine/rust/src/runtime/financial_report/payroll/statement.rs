use super::{failure, has_tariff, number, title};
use crate::{
    net::payment_projection::{PaymentContribution, SalaryPaymentProjection},
    report::financial::presentation::{deductions, js_round},
};
use serde_json::{Value, json};
use std::collections::BTreeSet;
fn nullish(value: Option<&Value>) -> Option<&Value> {
    value.filter(|v| !v.is_null())
}
fn value_label(v: &Value) -> String {
    if let Some(s) = v.as_str() {
        s.into()
    } else if let Some(n) = v.as_f64() {
        ryu_js::Buffer::new().format_finite(n).into()
    } else {
        "undefined".into()
    }
}
pub(super) fn profile_caption(p: &Value) -> Option<String> {
    if p["tariff"].is_null() && !p["manualMonthlyGrossCents"].is_null() {
        return Some("Manuell hinterlegt".into());
    }
    for (key, prefix, training) in [
        ("tvalPflegeTariff", "TVA-L Pflege", true),
        ("tvhKrTariff", "TV-H", false),
        ("tvUkNursingTariff", "TV-UK", false),
        ("tvlKrTariff", "TV-L", false),
        ("vkaETariff", "TVöD", false),
        ("nursingTrainingTariff", "TVAöD Pflege", true),
        ("tariff", "TVöD-P", false),
    ] {
        let item = &p[key];
        if !crate::net::js_truthy(item) {
            continue;
        }
        return Some(if training {
            format!(
                "{prefix} · {}. Ausbildungsjahr",
                value_label(&item["trainingYear"])
            )
        } else {
            let group = value_label(&item["payGroup"]);
            format!(
                "{prefix} {} · Stufe {}",
                if key == "tvUkNursingTariff" {
                    group.replacen("PUK", "P-UK", 1)
                } else {
                    group
                },
                value_label(&item["payLevel"])
            )
        });
    }
    None
}
pub(super) fn allowance_label(
    status: &str,
) -> Result<&'static str, crate::runtime::report::ReportIssue> {
    Ok(match status {
        "NONE" => "Schicht-/Wechselschichtzulage",
        "SHIFT_MONTHLY" => "Ständige Schichtzulage",
        "SHIFT_HOURLY" => "Nichtständige Schichtzulage",
        "ALTERNATING_MONTHLY" => "Ständige Wechselschichtzulage",
        "ALTERNATING_HOURLY" => "Nichtständige Wechselschichtzulage",
        _ => return Err(failure()),
    })
}
fn part_label<'a>(
    part: &PaymentContribution,
    projection: &SalaryPaymentProjection,
) -> Result<&'a str, crate::runtime::report::ReportIssue> {
    match part.group.as_str() {
        "MONTHLY_ALLOWANCE" | "HOURLY_ALLOWANCE" => {
            let pay = projection
                .sources
                .iter()
                .find(|s| s.month() == part.claim_month)
                .ok_or_else(failure)?
                .pay();
            allowance_label(
                nullish(pay.get("confirmedAllowance"))
                    .unwrap_or(&pay["assessment"]["suggestedAllowance"])
                    .as_str()
                    .ok_or_else(failure)?,
            )
        }
        "PREMIUMS" => Ok("Zeitzuschläge"),
        "OVERTIME" => Ok("Überstunden"),
        _ => Ok("Bereitschaftsvergütung"),
    }
}
fn open(projection: &SalaryPaymentProjection, part: &PaymentContribution) -> bool {
    projection
        .issues
        .iter()
        .any(|i| i["month"] == part.claim_month && i["group"] == part.group)
}
pub(super) fn present(
    month: &str,
    profile: &Value,
    projection: &SalaryPaymentProjection,
    settings: Option<&Value>,
    annual: &Value,
    forecast: Option<&Value>,
    blocked: bool,
) -> Result<Value, crate::runtime::report::ReportIssue> {
    let pay = &projection.pay;
    let available = forecast
        .filter(|f| f["result"]["status"] == "available")
        .filter(|_| !blocked && pay["available"] == true)
        .map(|f| &f["result"]["pay"]);
    let annual_payment = forecast.and_then(|f| nullish(f.get("annualPayment")));
    let annual_gross = annual["payments"]
        .as_array()
        .ok_or_else(failure)?
        .iter()
        .find(|p| p["payoutMonth"] == month)
        .map(|p| number(&p["grossCents"]))
        .transpose()?
        .unwrap_or(0.0);
    let full_annual = if pay["available"] == true {
        annual_payment
            .and_then(|p| nullish(p.get("grossCents")))
            .map(number)
            .transpose()?
            .unwrap_or(annual_gross)
    } else {
        annual_gross
    };
    let recurring = settings
        .and_then(|s| nullish(s.pointer("/automation/additionalRecurringGrossCents")))
        .map(number)
        .transpose()?
        .unwrap_or(0.0);
    let monthly = nullish(pay.get("estimatedGrossAmount"))
        .or_else(|| nullish(pay.get("knownGrossAmount")))
        .map(number)
        .transpose()?;
    let gross = (if pay["available"] == true {
        annual_payment.and_then(|p| nullish(p.get("totalGrossCents")))
    } else {
        None
    })
    .or_else(|| available.and_then(|p| nullish(p.pointer("/amounts/grossCents"))))
    .map(number)
    .transpose()?
    .or(monthly.map(|n| js_round(n * 100.0) + recurring + full_annual));
    let pension_omitted = forecast.is_some_and(|f| f["pensionOmitted"] == true);
    let net_label = if annual_payment.is_some_and(|p| !crate::net::js_truthy(&p["netIncluded"])) {
        "Netto ohne Jahressonderzahlung"
    } else if pension_omitted {
        "Netto vor Zusatzversorgung"
    } else {
        "Netto geschätzt"
    };
    let base_label = if crate::net::js_truthy(&profile["nursingTrainingTariff"])
        || crate::net::js_truthy(&profile["tvalPflegeTariff"])
    {
        "Ausbildungsentgelt"
    } else if !profile["manualMonthlyGrossCents"].is_null() && !has_tariff(profile) {
        "Monatsbrutto"
    } else {
        "Grundentgelt"
    };
    let mut fixed = vec![
        json!({"label":base_label,"value":nullish(pay.get("personalBaseAmount")).map(number).transpose()?.map(|v|js_round(v*100.0))}),
    ];
    if number(&pay["careAllowanceAmount"])? > 0.0 {
        let label = if crate::net::js_truthy(&profile["tvhKrTariff"]) {
            "Pflegezulage TV-H"
        } else if crate::net::js_truthy(&profile["tvUkNursingTariff"]) {
            "Pflegezulage TV-UK"
        } else if crate::net::js_truthy(&profile["tvlKrTariff"]) {
            "Pflegezulage TV-L"
        } else {
            "Pflegezulage TVöD-P"
        };
        fixed.push(
            json!({"label":label,"value":js_round(number(&pay["careAllowanceAmount"])?*100.0)}),
        );
    }
    if number(&pay["tvoedAllowanceAmount"])? > 0.0 {
        fixed.push(json!({"label":"TVöD-Zulage","value":js_round(number(&pay["tvoedAllowanceAmount"])?*100.0)}));
    }
    if recurring > 0.0 {
        fixed.push(json!({"label":"Weitere feste monatliche Zulage","value":recurring}));
    }
    let parts = projection
        .contributions
        .iter()
        .filter(|p| {
            [
                "PREMIUMS",
                "MONTHLY_ALLOWANCE",
                "HOURLY_ALLOWANCE",
                "OVERTIME",
                "SPECIAL_DUTY",
            ]
            .contains(&p.group.as_str())
        })
        .collect::<Vec<_>>();
    let months = parts
        .iter()
        .map(|p| p.claim_month.as_str())
        .collect::<BTreeSet<_>>();
    let mut groups = vec![];
    for claim_month in months {
        let source = projection
            .sources
            .iter()
            .find(|s| s.month() == claim_month)
            .ok_or_else(failure)?;
        let source_parts = parts
            .iter()
            .copied()
            .filter(|p| p.claim_month == claim_month)
            .collect::<Vec<_>>();
        let visible = source_parts
            .iter()
            .copied()
            .filter(|p| p.amount_cents > 0)
            .collect::<Vec<_>>();
        let opened = source_parts.iter().any(|p| open(projection, p));
        let open_parts = source_parts
            .iter()
            .copied()
            .filter(|p| p.amount_cents == 0 && open(projection, p))
            .collect::<Vec<_>>();
        if visible.is_empty() && !opened {
            continue;
        }
        let rows=visible.iter().map(|p|{let subtitle=if ["MONTHLY_ALLOWANCE","HOURLY_ALLOWANCE"].contains(&p.group.as_str()){Some(if open(projection,p){"Prüfung offen"}else if source.pay()["confirmedAllowance"].is_null(){"Geschätzt"}else{"Monatsangabe gespeichert"})}else{None};Ok(json!({"group":p.group,"label":part_label(p,projection)?,"amountCents":p.amount_cents,"subtitle":subtitle}))}).collect::<Result<Vec<_>,crate::runtime::report::ReportIssue>>()?;
        groups.push(json!({"month":claim_month,"title":format!("Zulagen aus {}",title(claim_month)?),"rows":rows,"openLabel":if open_parts.is_empty(){None}else{Some(if open_parts.len()==1&&open_parts[0].group=="SPECIAL_DUTY"{"Bereitschaftsvergütung"}else{"Weitere Zulagen"})}}));
    }
    let allowance = parts
        .iter()
        .copied()
        .filter(|p| ["MONTHLY_ALLOWANCE", "HOURLY_ALLOWANCE"].contains(&p.group.as_str()))
        .collect::<Vec<_>>();
    let positive = allowance
        .iter()
        .copied()
        .filter(|p| p.amount_cents > 0)
        .collect::<Vec<_>>();
    let months = (if positive.is_empty() {
        &allowance
    } else {
        &positive
    })
    .iter()
    .map(|p| p.claim_month.as_str())
    .collect::<BTreeSet<_>>()
    .into_iter()
    .collect::<Vec<_>>();
    let forecast_label = available
        .filter(|p| p["calculationBasis"]["status"] == "PREVIOUS_YEAR_ESTIMATE")
        .map(|p| {
            format!(
                "{} vorläufig · Abzüge nach Stand {}",
                value_label(&p["calculationBasis"]["payrollYear"]),
                value_label(&p["calculationBasis"]["rulesYear"])
            )
        });
    let timing_label = if available.is_some() {
        forecast
            .map(super::super::net_display::timing_label)
            .transpose()?
            .flatten()
    } else {
        None
    };
    let net_display = available
        .map(super::super::net_display::present)
        .transpose()?;
    Ok(
        json!({"timingLabel":timing_label,"netDisplay":net_display,"availableNet":available.is_some(),"partial":pay["available"]!=true&&pay.get("knownGrossAmount").is_some(),"grossCents":gross,"fullAnnualCents":full_annual,"netLabel":net_label,"netCents":available.map(|p|&p["netCents"]),"fixed":fixed,"variableGroups":groups,"allowanceReview":{"visible":!blocked&&has_tariff(profile),"months":if months.is_empty(){vec![month]}else{months.clone()},"subtitle":if months.len()==1{format!("Anspruch {}",title(months[0])?)}else{"Anspruchsmonat auswählen".into()}},"incompleteDuties":crate::report::financial::annual_salary::incomplete_duties(pay),"deductions":available.map(deductions),"netBeforeAnnualGrossCents":if annual_payment.is_some_and(|p|!crate::net::js_truthy(&p["netIncluded"])){available.map(|p|&p["amounts"]["grossCents"])}else{None},"pensionOmitted":pension_omitted,"annualPensionOmitted":annual_payment.is_some_and(|p|p["pensionOmitted"]==true),"profileCaption":profile_caption(profile),"forecastLabel":forecast_label}),
    )
}
