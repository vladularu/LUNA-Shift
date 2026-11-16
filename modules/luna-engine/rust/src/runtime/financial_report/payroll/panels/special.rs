use super::*;
fn text(s: impl Into<String>) -> Value {
    with_role(super::text(s), "CAPTION")
}
fn parts(p: Vec<Value>) -> Value {
    with_role(super::parts(p), "CAPTION")
}
pub(super) fn present(pay: &Value) -> Result<Vec<Value>, ReportIssue> {
    let lines = pay
        .get("specialDutyBreakdowns")
        .and_then(optional)
        .map(list)
        .transpose()?
        .unwrap_or_default();
    // A requested detail panel has its own budget. Rejection does not alter
    // calendar/source readiness or imply an empty successful duty list.
    if lines.len() > 2048 {
        return Err(ReportIssue::new("PAYROLL_PANEL_LIMIT"));
    }
    if lines.is_empty() {
        return Ok(vec![card(
            None,
            vec![with_role(
                text("Keine Bereitschaften in diesem Monat."),
                "BODY",
            )],
        )]);
    }
    let mut nodes = vec![with_role(text("Bereitschaften"), "HEADING")];
    for line in lines {
        let date = txt(&line["date"])?;
        let day = date.get(8..10).ok_or_else(failure)?;
        let month = date.get(5..7).ok_or_else(failure)?;
        let header = format!("{day}.{month}. · {}", txt(&line["title"])?);
        nodes.push(with_role(text(&header), "STRONG"));
        let standby = optional(&line["standbyPay"]);
        let callout = optional(&line["calloutPay"]);
        if let Some(base) = optional(&line["baseAmountCents"]) {
            nodes.push(with_role(
                parts(vec![
                    json!(if standby.is_some() {
                        "Auszahlung Bereitschaftsdienst: "
                    } else {
                        "Rufbereitschaftspauschale: "
                    }),
                    euro(number(base)?),
                ]),
                "BODY",
            ))
        } else {
            nodes.push(with_role(text("Betrag noch offen"), "BODY"))
        }
        if standby.is_none()
            && !line["baseAmountCents"].is_null()
            && !line["paidHours"].is_null()
            && !line["hourlyCents"].is_null()
        {
            let hours = number(&line["paidHours"])?;
            let mut values = vec![
                format(hours, false, 0, 4),
                json!(if hours == 1.0 {
                    " Stunde × "
                } else {
                    " Stunden × "
                }),
                euro(number(&line["hourlyCents"])?),
            ];
            if line["source"].as_str().is_some_and(|s| s.contains("TV-UK")) {
                values.push(json!(" × 1,25"))
            }
            nodes.push(parts(values));
        }
        if let Some(s) = standby {
            let mut values = vec![json!(format!(
                "Geleistet: {} Min.",
                js(&s["actualMinutes"])?
            ))];
            if let Some(weighted) = optional(&s["weightedMinutes"]) {
                values.extend([
                    json!(" Für die Vergütung: "),
                    format(number(weighted)?, false, 0, 2),
                    json!(" Min."),
                ])
            }
            nodes.push(parts(values));
            if let Some(hourly) = optional(&s["hourlyCents"]) {
                nodes.push(parts(vec![
                    json!(format!("Entgeltgrundlage: {} · ", js(&s["payGroup"])?)),
                    euro(number(hourly)?),
                    json!("/Std."),
                ]))
            }
            if let Some(base) = optional(&s["baseAmountCents"]) {
                let mut values = vec![json!("Grundbetrag: "), euro(number(base)?)];
                for (key, label) in [
                    ("overtimePremiumCents", "Überstunden"),
                    ("nightPremiumCents", "Nacht"),
                    ("holidayPremiumCents", "Feiertag"),
                    ("sundayPremiumCents", "Sonntag"),
                ] {
                    if let Some(n) = s[key].as_f64().filter(|n| *n > 0.0) {
                        values.extend([json!(format!(" · {label}: ")), euro(n)])
                    }
                }
                nodes.push(parts(values))
            }
            if let Some(credit) = s["timeCreditMinutes"].as_f64().filter(|n| *n > 0.0) {
                let mut values = vec![
                    json!("Geplante Zeitgutschrift: "),
                    format(credit, false, 0, 2),
                    json!(" Min. Als Prognose aus deiner Abgeltung berechnet."),
                ];
                if crate::net::js_truthy(&s["mandatoryRestMinutes"]) {
                    values.extend([
                        json!(" Davon "),
                        format(number(&s["mandatoryRestMinutes"])?, false, 0, 2),
                        json!(" Min. gesundheitlicher Ausgleich."),
                    ])
                }
                nodes.push(parts(values))
            }
        }
        if let Some(c) = callout {
            if c["baseAmountCents"].is_null() || c["overtimePremiumCents"].is_null() {
                nodes.push(with_role(text("Einsatzvergütung noch offen"), "BODY"))
            } else {
                nodes.push(with_role(
                    parts(vec![
                        json!("Einsatzentgelt: "),
                        euro(number(&c["baseAmountCents"])?),
                        json!(" + "),
                        euro(number(&c["overtimePremiumCents"])?),
                        json!(" Überstundenzuschlag"),
                    ]),
                    "BODY",
                ))
            }
            let mut description = format!(
                "Tatsächlich: {} Min. einschließlich Wege.",
                js(&c["actualMinutes"])?
            );
            if !c["paidMinutes"].is_null() {
                description.push_str(&format!(
                    " Tariflich bewertet: {} Min.",
                    js(&c["paidMinutes"])?
                ))
            }
            nodes.push(text(description));
            if let Some(r) = optional(&c["rates"]) {
                nodes.push(parts(vec![
                    json!("Grundentgelt: "),
                    euro(number(&r["baseHourlyCents"])?),
                    json!("/Std. · Zuschlag: "),
                    format(number(&r["premiumBasisPoints"])? / 100.0, false, 0, 3),
                    json!("% von "),
                    euro(number(&r["premiumHourlyCents"])?),
                    json!("/Std."),
                ]))
            }
            if let Some(premium) = c["timePremiumCents"].as_f64().filter(|n| *n > 0.0) {
                nodes.push(parts(vec![
                    json!("Zeitzuschläge der Einsätze: "),
                    euro(premium),
                ]))
            }
            if let Some(credit) = c["timeCreditMinutes"].as_f64().filter(|n| *n > 0.0) {
                let mut values = vec![
                    json!("Geplante Zeitgutschrift: "),
                    format(credit, false, 0, 2),
                    json!(" Min. Zeitzuschläge werden ausgezahlt."),
                ];
                if let Some(rest) = c["mandatoryRestMinutes"].as_f64().filter(|n| *n > 0.0) {
                    values.extend([
                        json!(" Davon "),
                        format(rest, false, 0, 2),
                        json!(" Min. gesundheitlicher Ausgleich."),
                    ])
                }
                nodes.push(parts(values))
            }
        }
        let note = if line["complete"] == true {
            if standby.is_some() {
                "Die Auszahlung ist berechnet. Eine vorgesehene Zeitgutschrift wird getrennt ausgewiesen.".into()
            } else if callout.is_some() {
                "Pauschale und Einsatzgrundentgelt bleiben steuerpflichtig. Zeitzuschläge werden getrennt geprüft. Die Rundung verändert die erfasste Arbeitszeit nicht.".into()
            } else {
                "Pauschale berechnet. Sie wird als steuerpflichtiger Betrag berücksichtigt und erhöht die Arbeitszeit nicht.".into()
            }
        } else {
            list(&line["notes"])?
                .iter()
                .map(txt)
                .collect::<Result<Vec<_>, _>>()?
                .join(" ")
        };
        nodes.push(text(note));
        if crate::net::js_truthy(&line["source"]) {
            nodes.push(text(txt(&line["source"])?))
        }
        nodes.push(json!({"kind":"OPEN_DUTY","accessibilityLabel":format!("Dienst öffnen: {header}"),"date":date,"shiftId":line["shiftId"]}));
    }
    Ok(vec![card(None, nodes)])
}
