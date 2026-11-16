use super::{
    ExportViewError,
    model::{ReportDocumentRef, ReportRow, ReportView},
};
use crate::input::{form_number, javascript_json::number_text};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

const MONTHS: [&str; 12] = [
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
];
struct Index<'a> {
    values: HashMap<String, &'a str>,
    period: &'a str,
}
impl<'a> Index<'a> {
    fn new(rows: &'a [ReportRow], period: &'a str) -> Self {
        let mut values = HashMap::new();
        for row in rows {
            values
                .entry(format!("{}/{}/{}", row.section, row.period, row.field))
                .or_insert(row.value.as_str());
        }
        Self { values, period }
    }
    fn text(&self, section: &str, field: &str, period: Option<&str>) -> &'a str {
        self.values
            .get(&format!(
                "{}/{}/{}",
                section,
                period.unwrap_or(self.period),
                field
            ))
            .copied()
            .unwrap_or("")
    }
    fn number(&self, section: &str, field: &str, period: Option<&str>) -> Option<f64> {
        let value = self.text(section, field, period);
        if form_number::trim(value).is_empty() {
            return None;
        }
        let value = form_number::number(&value.replacen(',', ".", 1));
        value.is_finite().then_some(value)
    }
}
fn sum(values: impl IntoIterator<Item = Option<f64>>) -> Option<f64> {
    let sum = values
        .into_iter()
        .try_fold(0.0, |total, value| value.map(|value| total + value))?;
    Some(form_number::round(sum * 100.0) / 100.0)
}
fn money(value: Option<f64>, provisional: bool) -> Result<Value, ExportViewError> {
    let Some(value) = value else {
        return Ok(json!("Nicht verfügbar"));
    };
    let value = if provisional {
        form_number::round(value / 10.0) * 10.0
    } else {
        value
    };
    if !value.is_finite() {
        return Err(ExportViewError::InvalidData);
    }
    Ok(
        json!({"euros":value,"fractionDigits":if provisional{0}else{2},"negativeZero":value==0.0&&value.is_sign_negative()}),
    )
}
fn unique(values: impl IntoIterator<Item = String>, separator: &str) -> String {
    let mut seen = HashSet::new();
    let mut ordered = Vec::new();
    for value in values {
        if !value.is_empty() && seen.insert(value.clone()) {
            ordered.push(value);
        }
    }
    ordered.join(separator)
}
fn issue_title(field: &str) -> bool {
    field
        .strip_prefix("issues.")
        .and_then(|v| v.strip_suffix(".title"))
        .is_some_and(|v| !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()))
}
pub(super) fn calculate<'a>(
    document: &'a ReportDocumentRef<'a>,
) -> Result<ReportView<'a>, ExportViewError> {
    let annual = document.period.len() == 4;
    if annual {
        if document.period.bytes().any(|b| !b.is_ascii_digit())
            || document
                .period
                .parse::<u16>()
                .ok()
                .filter(|v| *v > 0)
                .is_none()
        {
            return Err(ExportViewError::InvalidPeriod);
        }
    } else if crate::calendar::month_range(document.period).is_err() {
        return Err(ExportViewError::InvalidPeriod);
    }
    let index = Index::new(document.rows, document.period);
    let periods = if annual {
        (1..=12)
            .map(|month| format!("{}-{month:02}", document.period))
            .collect::<Vec<_>>()
    } else {
        vec![document.period.to_owned()]
    };
    let mut monthly = Vec::new();
    let mut any_provisional = false;
    let mut basis_notes = Vec::new();
    for period in &periods {
        let net = index
            .number("Netto-Prognose", "result.pay.netCents", Some(period))
            .or_else(|| index.number("Netto-Prognose", "netCents", Some(period)));
        let provisional = net.is_some()
            && index.text(
                "Netto-Prognose",
                "result.pay.calculationBasis.status",
                Some(period),
            ) == "PREVIOUS_YEAR_ESTIMATE";
        let payroll_year = index.number(
            "Netto-Prognose",
            "result.pay.calculationBasis.payrollYear",
            Some(period),
        );
        let rules_year = index.number(
            "Netto-Prognose",
            "result.pay.calculationBasis.rulesYear",
            Some(period),
        );
        let basis_note = if provisional {
            Some(
                if let (Some(payroll), Some(rules)) = (payroll_year, rules_year) {
                    format!(
                        "{} vorläufig · Abzüge nach Stand {}",
                        number_text(payroll),
                        number_text(rules)
                    )
                } else {
                    "Netto vorläufig · Abzüge nach Vorjahresstand".into()
                },
            )
        } else {
            None
        };
        if let Some(note) = &basis_note {
            basis_notes.push(note.clone());
        }
        any_provisional |= provisional;
        let has_account = !index
            .text("Arbeitszeit", "timeAccountMinutes", Some(period))
            .is_empty();
        monthly.push(json!({"period":period,"target":index.number("Arbeitszeit","targetMinutes",Some(period)),"hasTimeAccount":has_account,"actual":index.number("Arbeitszeit",if has_account{"timeAccountMinutes"}else{"actualMinutes"},Some(period)),"balance":index.number("Arbeitszeit","balanceMinutes",Some(period)),"gross":index.number("Gehaltsprognose","estimatedGrossAmount",Some(period)),"net":net,"provisional":provisional,"netDisplay":money(net,provisional)?,"netBasisNote":basis_note}));
    }
    let section = if annual {
        "Jahresauswertung"
    } else {
        "Arbeitszeit"
    };
    let complete_time = !annual || index.text(section, "worktimeCoverageComplete", None) != "Nein";
    let categories=[("Dienste","work",false),("Schule / Fortbildung","training",false),("Urlaub","vacation",true),("Krankheit","sick",true)].into_iter().map(|(label,field,credit)|json!({"label":label,"field":field,"credit":credit,"minutes":sum(periods.iter().map(|period|index.number("Arbeitszeit",&format!("{field}.minutes"),Some(period)))),"count":sum(periods.iter().map(|period|index.number("Arbeitszeit",&format!("{field}.entryCount"),Some(period))))})).collect::<Vec<_>>();
    let salary_section = if annual {
        "Jahresauswertung"
    } else {
        "Gehaltsprognose"
    };
    let check_section = if annual {
        "Jahresauswertung"
    } else {
        "Auswertung"
    };
    let warnings = index.number(check_section, "warningCount", None);
    let critical = index.number(check_section, "criticalCount", None);
    let info = index
        .number(check_section, "infoCount", None)
        .unwrap_or(0.0);
    let prerequisites = index
        .number(check_section, "prerequisiteCount", None)
        .unwrap_or(0.0);
    let scope = index
        .number(check_section, "scopeCount", None)
        .unwrap_or(0.0);
    let net = if annual {
        index.number("Jahresauswertung", "netCents", None)
    } else {
        index
            .number("Netto-Prognose", "result.pay.netCents", None)
            .or_else(|| index.number("Netto-Prognose", "netCents", None))
    };
    let issues = document
        .rows
        .iter()
        .filter(|row| {
            row.section == "Auswertung" && row.period == document.period && issue_title(&row.field)
        })
        .take(2)
        .map(|row| {
            let prefix = row
                .field
                .strip_suffix(".title")
                .expect("filtered issue title");
            let date = index.text("Auswertung", &format!("{prefix}.date"), None);
            let kind = index.text("Auswertung", &format!("{prefix}.kind"), None);
            let date = if date.is_empty() {
                String::new()
            } else {
                format!(
                    "{}.{}.: ",
                    date.chars().skip(8).take(2).collect::<String>(),
                    date.chars().skip(5).take(2).collect::<String>()
                )
            };
            format!(
                "{date}{}{}",
                row.value,
                if matches!(kind, "Hinweise & Empfehlungen" | "Dienstfolgen & Erholung") {
                    " (Hinweise & Empfehlungen)"
                } else {
                    ""
                }
            )
        })
        .collect::<Vec<_>>();
    let reference = index.text("Bericht", "referenceDate", None);
    let title = if annual {
        document.period.to_owned()
    } else {
        let month = document.period[5..7]
            .parse::<usize>()
            .map_err(|_| ExportViewError::InvalidPeriod)?;
        format!("{} {}", MONTHS[month - 1], &document.period[..4])
    };
    let note = if annual {
        unique(
            periods.iter().map(|period| {
                index
                    .text("Netto-Prognose", "annualPayment.note", Some(period))
                    .to_owned()
            }),
            " ",
        )
    } else {
        index
            .text("Netto-Prognose", "annualPayment.note", None)
            .to_owned()
    };
    let checks = if let (Some(critical), Some(warnings)) = (critical, warnings) {
        format!(
            "{} kritisch · {} {} · {} {}. Details siehe App.",
            number_text(critical),
            number_text(warnings),
            if warnings == 1.0 {
                "Warnung"
            } else {
                "Warnungen"
            },
            number_text(info),
            if info == 1.0 { "Hinweis" } else { "Hinweise" }
        )
    } else {
        "Prüfung eingeschränkt. Details siehe App.".into()
    };
    let facts = json!({
        "annual":annual,"monthly":monthly,"categories":categories,"title":title,"name":index.text("Profil","displayName",None),"employer":index.text("Profil","employerName",None),
        "referenceDate":if reference.is_empty(){document.created_at.chars().take(10).collect::<String>()}else{reference.to_owned()},
        "target":if complete_time{index.number(section,"targetMinutes",None)}else{None},"actual":if complete_time{index.number(section,"actualMinutes",None)}else{None},
        "hasTimeAccount":!index.text(section,"timeAccountMinutes",None).is_empty(),"timeAccount":if complete_time{index.number(section,"timeAccountMinutes",None)}else{None},"balance":if complete_time{index.number(section,"balanceMinutes",None)}else{None},
        "gross":index.number(salary_section,"estimatedGrossAmount",None).or_else(||index.number(salary_section,"knownGrossAmount",None)),"grossPartial":index.number(salary_section,"knownGrossAmount",None).is_some(),"net":net,"netDisplay":money(net,any_provisional)?,"netBasisNote":unique(basis_notes," · "),
        "base":if annual{None}else{index.number("Gehaltsprognose","personalBaseAmount",None)},
        "allowances":if annual{None}else{sum(["allowanceAmount","tvoedAllowanceAmount","careAllowanceAmount"].into_iter().map(|field|index.number("Gehaltsprognose",field,None)))},
        "premiums":index.number(salary_section,if annual{"premiumAmount"}else{"timePremiumAmount"},None),"overtime":index.number(salary_section,"overtimeAmount",None),"specialDuties":if annual{None}else{index.number("Gehaltsprognose","specialDutyAmount",None)},
        "specialDutyNote":document.rows.iter().filter(|row|row.section=="Gehaltsprognose"&&row.period==document.period&&row.field.starts_with("specialDutyNotes")).map(|row|row.value.as_str()).collect::<Vec<_>>().join(" "),
        "tax":if annual{None}else{sum(["wageTaxCents","solidarityCents","churchTaxCents"].into_iter().map(|field|index.number("Netto-Prognose",&format!("result.pay.tax.{field}"),None)))},
        "insurance":if annual{None}else{index.number("Netto-Prognose","result.pay.socialInsurance.totalCents",None)},"pension":if annual{None}else{index.number("Netto-Prognose","result.pay.pension.employeeCents",None)},
        "pensionOmitted":index.text("Netto-Prognose","result.pay.pensionOmitted",None)=="Ja"||index.text("Netto-Prognose","pensionOmitted",None)=="Ja",
        "annualPaymentAmount":index.number("Gehaltsprognose","annualPaymentAmount",None),"annualPaymentNote":note,
        "netLabel":if !annual&&index.text("Netto-Prognose","annualPayment.netIncluded",None)=="Nein"{"Netto ohne Sonderzahlung"}else if !annual&&index.text("Netto-Prognose","annualPayment.pensionOmitted",None)=="Ja"{"Netto vor Zusatzversorgung der Sonderzahlung"}else{"Netto geschätzt"},
        "payCount":if annual{index.number("Jahresauswertung","availablePayMonthCount",None).unwrap_or(0.0)}else{0.0},"netCount":if annual{index.number("Jahresauswertung","availableNetMonthCount",None).unwrap_or(0.0)}else{0.0},
        "testData":document.rows.iter().any(|row|row.section=="Bericht"&&row.field.starts_with("testMonths.")&&row.value.starts_with(document.period)),"checks":checks,
        "checkPrerequisites":if prerequisites>0.0{Some("Prüfgrundlagen unvollständig. Angaben in der App ergänzen.")}else if scope>0.0{Some("Prüfumfang bei Bereitschaften eingeschränkt. Details siehe App.")}else{None},"issues":issues
    });
    Ok(ReportView {
        facts,
        entries: document.entries,
        targets: document.targets,
    })
}
