//! Source-exact service-detail display facts, independent from money preparation.
use crate::{calendar::parse_date, runtime::report::ReportIssue};
use jiff::{
    ToSpan,
    civil::{Date, Time},
};
use serde_json::{Value, json};
fn failure() -> ReportIssue {
    ReportIssue::new("FINANCIAL_SERVICE_DISPLAY_INVALID")
}
fn date_label(raw: &str, weekday: bool) -> Result<String, ReportIssue> {
    let date = parse_date(raw).map_err(|_| failure())?;
    Ok(civil_label(date, weekday))
}
fn civil_label(date: Date, weekday: bool) -> String {
    let short = format!("{:02}.{:02}.", date.day(), date.month());
    if weekday {
        let day = ["Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa.", "So."]
            [date.weekday().to_monday_zero_offset() as usize];
        format!("{day} {short}")
    } else {
        short
    }
}
pub fn row_display(row: &Value) -> Result<Value, ReportIssue> {
    let id = row["id"].as_str().ok_or_else(failure)?;
    let date = row["date"].as_str().ok_or_else(failure)?;
    let premium_hours = row
        .get("premiumLines")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .map(|line| {
            let minutes = line["minutes"]
                .as_f64()
                .filter(|n| n.is_finite())
                .ok_or_else(failure)?;
            let absolute = minutes.abs();
            let hours = ryu_js::Buffer::new()
                .format_finite((absolute / 60.0).floor())
                .to_owned();
            let mut remainder = ryu_js::Buffer::new()
                .format_finite(absolute % 60.0)
                .to_owned();
            if remainder.len() < 2 {
                remainder.insert(0, '0');
            }
            Ok(format!(
                "{}{hours}:{remainder}",
                if minutes < 0.0 { "−" } else { "" }
            ))
        })
        .collect::<Result<Vec<_>, ReportIssue>>()?;
    let special_tax = if !row["specialDuty"].is_null()
        && row["taxableAmountCents"].is_number()
        && row["socialInsuranceLiableAmountCents"].is_number()
    {
        json!({"taxFreeCents":row["tax"]["taxFreeCents"].as_f64().unwrap_or(0.0),"taxableCents":row["taxableAmountCents"],"socialInsuranceFreeCents":row["tax"]["socialInsuranceFreeCents"].as_f64().unwrap_or(0.0),"socialInsuranceLiableCents":row["socialInsuranceLiableAmountCents"]})
    } else {
        Value::Null
    };
    let shift = &row["shift"];
    let (start, end) = (
        shift["startTime"].as_str().filter(|s| !s.is_empty()),
        shift["endTime"].as_str().filter(|s| !s.is_empty()),
    );
    let time = if let (Some(start), Some(end)) = (start, end) {
        let start_time = start.parse::<Time>().map_err(|_| failure())?;
        let end_time = end.parse::<Time>().map_err(|_| failure())?;
        let next_day = end_time <= start_time;
        let day = shift["date"]
            .as_str()
            .ok_or_else(failure)?
            .parse::<Date>()
            .map_err(|_| failure())?;
        let days = (if next_day { 1 } else { 0 }).days();
        // A valid four-digit stored date can end on Temporal's +010000 day.
        // Gregorian month/day/weekday repeat every 400 years; keep that last
        // label representable without narrowing the original next-day rule.
        let (end_civil, year) = match day.checked_add(days) {
            Ok(end) => (end, i32::from(end.year())),
            Err(_) if day.year() == 9999 => {
                let surrogate = Date::new(9599, day.month(), day.day())
                    .map_err(|_| failure())?
                    .checked_add(days)
                    .map_err(|_| failure())?;
                (surrogate, i32::from(surrogate.year()) + 400)
            }
            Err(_) => return Err(failure()),
        };
        let printed_year = if year > 9999 {
            format!("+{year:06}")
        } else {
            format!("{year:04}")
        };
        let end_date = format!(
            "{printed_year}-{:02}-{:02}",
            end_civil.month(),
            end_civil.day()
        );
        let mut end_label = civil_label(end_civil, false);
        if end_date.get(..4) != date.get(..4) {
            end_label.push_str(end_date.get(..4).ok_or_else(failure)?);
        }
        json!({"interval":format!("{start}–{end}"),"endDate":end_date,"nextDay":next_day,"endDateLabel":end_label,"endWeekdayDateLabel":civil_label(end_civil,true)})
    } else {
        json!({"interval":"Ganztägig","endDate":null,"nextDay":false,"endDateLabel":null,"endWeekdayDateLabel":null})
    };
    Ok(
        json!({"id":id,"dateLabel":if date.is_empty(){String::new()}else{date_label(date,false)?},"weekdayDateLabel":if date.is_empty(){"Dienst".to_owned()}else{date_label(date,true)?},"time":time,"specialTax":special_tax,"premiumHours":premium_hours}),
    )
}
pub(crate) struct Metadata {
    forecast: Option<String>,
    night: Value,
}
pub(crate) fn metadata(pay: &Value, net: Option<&Value>) -> Metadata {
    let basis = net
        .filter(|v| v["result"]["status"] == "available")
        .map(|v| &v["result"]["pay"]["calculationBasis"]);
    let forecast = basis
        .filter(|v| v["status"] == "PREVIOUS_YEAR_ESTIMATE")
        .map(|v| {
            format!(
                "{} vorläufig · Abzüge nach Stand {}",
                v["payrollYear"], v["rulesYear"]
            )
        });
    let night = pay
        .get("nightCompensatoryMinutes")
        .filter(|v| !v.is_null())
        .cloned()
        .unwrap_or(json!(0));
    Metadata { forecast, night }
}
pub(crate) fn present(details: &Value, metadata: Metadata) -> Result<Value, ReportIssue> {
    let summary = &details["serviceSummary"];
    let rows = summary["rows"]
        .as_array()
        .ok_or_else(failure)?
        .iter()
        .map(row_display)
        .collect::<Result<Vec<_>, _>>()?;
    let categories = summary["categories"].as_array().ok_or_else(failure)?;
    let special = categories.iter().any(|c| c["key"] == "special-duty");
    let active = summary["activeFilter"].as_str();
    let title = if special && active.is_none() {
        "Zuschläge erarbeitet"
    } else if active == Some("special-duty") {
        "Bereitschaftsvergütung"
    } else {
        "Zeitzuschläge"
    };
    let taxable = summary["totalCents"]
        .as_f64()
        .zip(summary["taxFreeCents"].as_f64())
        .map(|(total, free)| total - free);
    Ok(
        json!({"serviceDisplay":{"forecastLabel":metadata.forecast,"nightCompensatoryMinutes":metadata.night,"rows":rows,"premiumCard":{"title":title,"totalCents":summary["totalCents"],"taxFreeCents":summary["taxFreeCents"],"taxableCents":taxable},"showFilters":categories.len()>1||special}}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn original_forecast_and_nullish_night_metadata_are_preserved() {
        let source: Value = serde_json::from_str(include_str!(
            "../../../../reference/service-display-golden.json"
        ))
        .unwrap();
        for case in source["metadataBoundary"].as_array().unwrap() {
            let input = &case["input"];
            let net = input.get("net").filter(|v| !v.is_null());
            let mut actual = present(
                &json!({"serviceSummary":input["summary"]}),
                metadata(&input["pay"], net),
            )
            .unwrap();
            crate::input::raw_json::normalize_integral_numbers(&mut actual);
            assert_eq!(actual, case["expected"]);
        }
    }
}
