//! Pure original analysis-net row projection over an already native forecast.
use crate::runtime::report::ReportIssue;
use serde_json::{Value, json};

fn invalid() -> ReportIssue {
    ReportIssue::new("ANALYSIS_NET_ROW_INVALID")
}

fn year_text(value: &Value) -> Result<String, ReportIssue> {
    let number = value
        .as_f64()
        .filter(|n| n.is_finite())
        .ok_or_else(invalid)?;
    Ok(ryu_js::Buffer::new().format(number).to_owned())
}

pub fn present(month: &str, forecast: Option<&Value>) -> Result<Value, ReportIssue> {
    crate::calendar::month_range(month).map_err(|_| invalid())?;
    let (status, pay) = match forecast {
        None => ("NONE", None),
        Some(value) => match value.pointer("/result/status").and_then(Value::as_str) {
            Some("available") => ("AVAILABLE", Some(&value["result"]["pay"])),
            Some("unavailable") => ("UNAVAILABLE", None),
            _ => return Err(invalid()),
        },
    };
    let annual = forecast
        .and_then(|f| f.get("annualPayment"))
        .filter(|v| crate::net::js_truthy(v));
    let label = if annual.is_some_and(|v| !crate::net::js_truthy(&v["netIncluded"])) {
        "Netto ohne Sonderzahlung"
    } else if annual.is_some_and(|v| crate::net::js_truthy(&v["pensionOmitted"]))
        || (pay.is_some() && forecast.is_some_and(|f| crate::net::js_truthy(&f["pensionOmitted"])))
    {
        "Netto vor Zusatzversorgung"
    } else {
        "Voraussichtliches Netto"
    };
    let amount = pay.map(super::net_display::present).transpose()?;
    let notice = if let Some(pay) = pay {
        let basis = &pay["calculationBasis"];
        if basis["status"] == "PREVIOUS_YEAR_ESTIMATE" {
            Some(format!(
                "{} vorläufig · Abzüge nach Stand {}",
                year_text(&basis["payrollYear"])?,
                year_text(&basis["rulesYear"])?
            ))
        } else {
            None
        }
    } else if let Some(forecast) = forecast {
        Some(
            forecast["result"]["reason"]
                .as_str()
                .ok_or_else(invalid)?
                .to_owned(),
        )
    } else {
        None
    };
    let annual_note = annual.map(|value| {
        if crate::net::js_truthy(&value["netIncluded"]) {
            "Jahressonderzahlung enthalten"
        } else {
            "Sonderzahlung nur im Brutto"
        }
    });
    Ok(
        json!({"month":month,"label":label,"amount":amount,"notice":notice,"annualPaymentNote":annual_note,"forecastStatus":status}),
    )
}
