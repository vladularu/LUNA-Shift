use super::*;
pub(super) fn present(input: &PanelInput<'_>) -> Result<Vec<Value>, ReportIssue> {
    present_values(
        input.month,
        &input.projection.pay,
        input.annual,
        input.forecast,
    )
}
pub(super) fn present_values(
    month: &str,
    source_pay: &Value,
    annual: &Value,
    forecast: Option<&Value>,
) -> Result<Vec<Value>, ReportIssue> {
    let mut output = vec![];
    let proposal = optional(&annual["proposal"]).filter(|_| {
        annual["payments"]
            .as_array()
            .is_some_and(|p| p.iter().any(|p| p["payoutMonth"] == month))
    });
    let payment = forecast.and_then(|f| optional(&f["annualPayment"]));
    if proposal.is_some() || payment.is_some() {
        let mut nodes = vec![];
        if let Some(p) = proposal {
            if annual["automatic"] == true {
                nodes.push(text(format!(
                    "{} % aus {}. {}",
                    ryu_js::Buffer::new().format_finite(number(&p["rateBasisPoints"])? / 100.0),
                    list(&p["referenceMonths"])?
                        .iter()
                        .map(txt)
                        .collect::<Result<Vec<_>, _>>()?
                        .join(", "),
                    txt(&p["note"])?
                )))
            } else {
                nodes.push(parts(vec![json!("Für die Berechnung gilt dein gespeicherter eigener Betrag. Die aktuelle automatische Tarifprognose beträgt "),euro(number(&p["grossCents"])?),json!(".")]))
            }
        }
        if let Some(p) = payment {
            nodes.push(text(txt(&p["note"])?))
        }
        output.push(card(Some("Jahressonderzahlung"), nodes))
    }
    if let Some(pay) = forecast
        .filter(|f| f["result"]["status"] == "available")
        .map(|f| &f["result"]["pay"])
    {
        let mut nodes = vec![
            money_row(
                "Steuerbrutto",
                number(&pay["amounts"]["taxableGrossCents"])?,
            ),
            money_row(
                "Brutto für Sozialversicherung",
                number(&pay["amounts"]["socialInsuranceGrossCents"])?,
            ),
        ];
        if let Some(label) = forecast_label(pay)? {
            nodes.push(text(label))
        }
        nodes.push(text("Krankenversicherung einschließlich Zusatzbeitrag. Geschätzte Abzüge · Die tatsächliche Auszahlung kann abweichen."));
        if let Some(t) = forecast.and_then(|f| optional(&f["payrollTimingEstimate"])) {
            nodes.push(text(format!("Zulagen aus {} nachberechnet. Abzüge mit der Auszahlung angenommen; frühere Einbehalte sind nicht bekannt.",super::super::title(txt(&t["sourceMonth"])?)?)));
        }
        if let Some(label) = forecast
            .map(crate::runtime::financial_report::net_display::timing_label)
            .transpose()?
            .flatten()
        {
            nodes.push(text(label))
        }
        if forecast.is_some_and(|f| f["pensionOmitted"] == true) {
            nodes.push(text("Beiträge zur Zusatzversorgung und ihre Auswirkungen auf Steuern und Sozialversicherung fehlen noch."))
        }
        output.push(card(None, nodes));
    }
    if let Some(c) = forecast
        .filter(|f| f["result"]["status"] == "available")
        .and_then(|f| optional(&f["result"]["classification"]))
    {
        output.push(card(None,vec![text("Die Aufteilung nutzt deine geplanten Zeiten. Nacht-, Sonn- und Feiertagszuschläge können steuerfrei sein. Samstagszuschläge, bezahlte Pausen und Beträge über den Grenzen bleiben steuerpflichtig."),parts(vec![json!("Sozialversicherungsfrei: "),euro(number(&c["socialInsuranceFreeCents"])?),json!(". Dafür gelten eigene Höchstgrenzen.")])]));
    }
    let minutes = source_pay
        .get("nightCompensatoryMinutes")
        .and_then(optional)
        .map(number)
        .transpose()?
        .unwrap_or(0.0);
    if minutes > 0.0 {
        output.push(card(None, vec![night(minutes)]))
    }
    output.push(card(
        None,
        vec![nav("Grundlagen zu Gehalt und Zuschlägen", None)],
    ));
    Ok(output)
}
