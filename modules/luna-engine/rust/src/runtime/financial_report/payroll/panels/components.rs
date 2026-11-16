use super::*;
use crate::report::financial::presentation::js_round;
pub(super) fn present(input: &PanelInput<'_>) -> Result<Vec<Value>, ReportIssue> {
    let pay = &input.projection.pay;
    let extra = input
        .settings
        .and_then(|s| s.pointer("/automation/additionalRecurringGrossCents"))
        .map(number)
        .transpose()?
        .unwrap_or(0.0);
    let annual = list(&input.annual["payments"])?
        .iter()
        .filter(|p| p["payoutMonth"] == input.month)
        .try_fold(0.0, |sum, p| {
            Ok::<_, ReportIssue>(sum + number(&p["grossCents"])?)
        })?;
    let gross = optional(&pay["estimatedGrossAmount"])
        .map(number)
        .transpose()?
        .map(|n| js_round(n * 100.0) + extra + annual);
    let hero_parts = gross.map_or_else(|| vec![json!("Nicht verfügbar")], |n| vec![euro(n)]);
    let mut accessibility = vec![json!("Gesamtbrutto: ")];
    accessibility.extend(hero_parts.clone());
    if gross.is_none() {
        accessibility = vec![json!("Gesamtbrutto: Nicht verfügbar")]
    }
    let mut gross_nodes =
        vec![json!({"kind":"HERO","parts":hero_parts,"accessibilityLabel":accessibility})];
    if let Some(caption) = super::super::statement::profile_caption(input.profile) {
        gross_nodes.push(with_role(text(caption), "BODY"))
    }
    let mut output = vec![card(Some("Gesamtbrutto"), gross_nodes)];
    let specials = pay
        .get("specialDutyBreakdowns")
        .filter(|v| !v.is_null())
        .map(list)
        .transpose()?
        .unwrap_or_default();
    let open = specials.iter().any(|v| v["complete"] != true);
    let mut rows = if pay["available"] == true {
        composition(input)?
    } else if open {
        vec![amount(
            "Bereitschaftsvergütung",
            vec![json!("Noch offen")],
            Some("Prüfe die fehlenden Angaben unter Bereitschaften."),
            false,
        )]
    } else {
        vec![with_role(
            text("Für diesen Monat fehlen Tarifdaten."),
            "BODY",
        )]
    };
    if extra > 0.0 {
        rows.push(money_row("Weitere feste monatliche Zulage", extra))
    }
    if annual > 0.0 {
        rows.push(money_row("Jahressonderzahlung", annual))
    }
    output.push(card(Some("Zusammensetzung"), rows));
    if !specials.is_empty() {
        output.push(card(
            Some("Details"),
            vec![nav(
                "Bereitschaften",
                Some(if open {
                    "Angaben noch offen"
                } else {
                    "Beträge und Dienste ansehen"
                }),
            )],
        ))
    }
    let minutes = pay
        .get("nightCompensatoryMinutes")
        .and_then(optional)
        .map(number)
        .transpose()?
        .unwrap_or(0.0);
    if minutes > 0.0 {
        output.push(night(minutes))
    }
    let net = available(input);
    let mut rows = vec![if let Some(n) = net {
        money_row(
            "Abzüge",
            -(number(&n["amounts"]["grossCents"])? - number(&n["netCents"])?),
        )
    } else {
        amount("Abzüge", vec![json!("Nicht verfügbar")], None, false)
    }];
    if let Some(n) = net {
        let payment = input.forecast.and_then(|f| optional(&f["annualPayment"]));
        let omitted = input.forecast.is_some_and(|f| f["pensionOmitted"] == true);
        let label = if payment.is_some_and(|p| !crate::net::js_truthy(&p["netIncluded"])) {
            "Netto ohne Sonderzahlung"
        } else if payment.is_some_and(|p| p["pensionOmitted"] == true) || omitted {
            "Netto vor Zusatzversorgung"
        } else {
            "Voraussichtliches Netto"
        };
        let display = crate::runtime::financial_report::net_display::present(n)?;
        rows.push(amount(
            label,
            vec![format(
                number(&display["euros"])?,
                true,
                display["fractionDigits"].as_u64().ok_or_else(failure)? as u8,
                display["fractionDigits"].as_u64().ok_or_else(failure)? as u8,
            )],
            None,
            true,
        ));
        if let Some(p) = payment {
            rows.push(text(if p["netIncluded"] == true {
                "Jahressonderzahlung enthalten"
            } else {
                "Sonderzahlung nur im Brutto"
            }))
        }
        if let Some(label) = forecast_label(n)? {
            rows.push(text(label))
        }
        if omitted {
            rows.push(text("Zusatzversorgung nicht berücksichtigt"))
        }
    }
    output.push(card(Some("Netto-Berechnung"), rows));
    Ok(output)
}
fn composition(input: &PanelInput<'_>) -> Result<Vec<Value>, ReportIssue> {
    let p = input.profile;
    let pay = &input.projection.pay;
    let base = number(&pay["personalBaseAmount"])?;
    if p["tariff"].is_null() && !p["manualMonthlyGrossCents"].is_null() {
        return Ok(vec![amount(
            "Monatsbrutto",
            vec![format(base, true, 2, 2)],
            None,
            false,
        )]);
    }
    let mut rows = vec![amount(
        if crate::net::js_truthy(&p["nursingTrainingTariff"])
            || crate::net::js_truthy(&p["tvalPflegeTariff"])
        {
            "Ausbildungsentgelt"
        } else {
            "Grundentgelt"
        },
        vec![format(base, true, 2, 2)],
        None,
        false,
    )];
    let premiums = if input
        .projection
        .issues
        .iter()
        .any(|i| i["group"] == "PREMIUMS")
    {
        vec![json!("–")]
    } else {
        vec![format(number(&pay["timePremiumAmount"])?, true, 2, 2)]
    };
    rows.push(amount("Zeitzuschläge", premiums, None, false));
    for (key, label) in [
        ("overtimeAmount", "Überstunden"),
        ("specialDutyAmount", "Bereitschaftsvergütung"),
    ] {
        let n = pay
            .get(key)
            .and_then(optional)
            .map(number)
            .transpose()?
            .unwrap_or(0.0);
        if n > 0.0 {
            rows.push(amount(label, vec![format(n, true, 2, 2)], None, false))
        }
    }
    if number(&pay["allowanceAmount"])? > 0.0 {
        let sources = input
            .projection
            .contributions
            .iter()
            .filter(|c| {
                matches!(c.group.as_str(), "MONTHLY_ALLOWANCE" | "HOURLY_ALLOWANCE")
                    && c.amount_cents > 0
            })
            .map(|c| {
                input
                    .projection
                    .sources
                    .iter()
                    .find(|s| s.month() == c.claim_month)
                    .ok_or_else(failure)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let statuses = sources
            .iter()
            .map(|s| allowance(s.pay()))
            .collect::<Result<std::collections::BTreeSet<_>, _>>()?;
        let label = if statuses.len() > 1 {
            "Schichtzulagen"
        } else {
            super::super::statement::allowance_label(allowance(
                sources.first().map_or(pay, |s| s.pay()),
            )?)?
        };
        let guessed = if sources.is_empty() {
            pay["confirmedAllowance"].is_null()
        } else {
            sources
                .iter()
                .any(|s| s.pay()["confirmedAllowance"].is_null())
        };
        rows.push(amount(
            label,
            vec![format(number(&pay["allowanceAmount"])?, true, 2, 2)],
            guessed.then_some("Geschätzt"),
            false,
        ));
    }
    for (key, label) in [
        ("tvoedAllowanceAmount", "TVöD-Zulage"),
        (
            "careAllowanceAmount",
            if crate::net::js_truthy(&p["tvhKrTariff"]) {
                "Pflegezulage TV-H"
            } else if crate::net::js_truthy(&p["tvUkNursingTariff"]) {
                "Pflegezulage TV-UK"
            } else if crate::net::js_truthy(&p["tvlKrTariff"]) {
                "Pflegezulage TV-L"
            } else {
                "Pflegezulage TVöD-P"
            },
        ),
    ] {
        let n = number(&pay[key])?;
        if n > 0.0 {
            rows.push(amount(label, vec![format(n, true, 2, 2)], None, false))
        }
    }
    Ok(rows)
}
fn allowance(pay: &Value) -> Result<&str, ReportIssue> {
    txt(optional(&pay["confirmedAllowance"]).unwrap_or(&pay["assessment"]["suggestedAllowance"]))
}
