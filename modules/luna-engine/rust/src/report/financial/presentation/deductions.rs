use super::*;
pub(crate) fn deductions(pay: &Value) -> Value {
    let mut rows = vec![
        json!({"id":"wage-tax","label":"Lohnsteuer","amountCents":pay["tax"]["wageTaxCents"]}),
    ];
    for (key, id, label) in [
        ("solidarityCents", "solidarity", "Solidaritätszuschlag"),
        ("churchTaxCents", "church-tax", "Kirchensteuer"),
    ] {
        if number(&pay["tax"][key]) > 0.0 {
            rows.push(json!({"id":id,"label":label,"amountCents":pay["tax"][key]}));
        }
    }
    for (key, id, label) in [
        ("pensionCents", "pension-insurance", "Rentenversicherung"),
        (
            "unemploymentCents",
            "unemployment-insurance",
            "Arbeitslosenversicherung",
        ),
        ("healthCents", "health-insurance", "Krankenversicherung"),
        ("careCents", "care-insurance", "Pflegeversicherung"),
    ] {
        rows.push(json!({"id":id,"label":label,"amountCents":pay["socialInsurance"][key]}));
    }
    if !pay["pension"].is_null() && pay["pension"]["scheme"] != "NONE" {
        rows.push(json!({"id":"supplementary-pension","label":"Zusatzversorgung","amountCents":pay["pension"]["employeeCents"]}));
    }
    if number(&pay["additionalNetDeductionCents"]) > 0.0 {
        rows.push(json!({"id":"other-net","label":"Weitere Netto-Abzüge","amountCents":pay["additionalNetDeductionCents"]}));
    }
    json!({"totalCents":number(&pay["amounts"]["grossCents"])-number(&pay["netCents"]),"rows":rows})
}
