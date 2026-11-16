//! Native PDF display planning. HTML/CSS and locale encoding remain host UI.
mod calendar;
mod format;
pub mod model;
mod rows;
mod sections;
use super::export_view::model::ReportDocumentRef;
use format::*;
use model::{PdfOptions, PdfPlan};
use serde_json::{Value, json};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PdfError;
impl std::fmt::Display for PdfError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Die PDF-Daten sind ungültig.")
    }
}
impl std::error::Error for PdfError {}
pub fn plan_pdf(
    document: &ReportDocumentRef<'_>,
    options: PdfOptions,
) -> Result<PdfPlan, PdfError> {
    if document.entries.len() > 50_000 {
        return Err(PdfError);
    }
    let view = super::export_view::report_view(document).map_err(|_| PdfError)?;
    let facts = &view.facts;
    let compact = options.layout == model::PdfLayout::Compact;
    let annual = boolean(facts, "annual");
    let annual_table = if annual {
        sections::annual(facts, options.include_salary)?
    } else {
        Value::Null
    };
    let middle = if compact {
        if annual {
            json!({"kind":"ANNUAL","value":annual_table})
        } else {
            json!({"kind":"CALENDAR","value":calendar::month(document.period,document.entries)?})
        }
    } else {
        json!({"kind":"CATEGORIES","value":sections::categories(facts)?})
    };
    let entry_pages = if !compact && !annual {
        rows::pages(document.entries)?
    } else {
        Vec::new()
    };
    let mut pages =
        vec![json!({"kind":"OVERVIEW","subtitle":text(if compact{"KOMPAKT"}else{"STANDARD"})})];
    if !compact {
        if annual {
            pages.push(json!({"kind":"ANNUAL","subtitle":text("MONATSÜBERSICHT")}));
        } else {
            for index in 0..entry_pages.len() {
                pages.push(
                    json!({"kind":"ENTRIES","entryIndex":index,"subtitle":text("DIENSTLISTE")}),
                );
            }
        }
    }
    let total = pages.len();
    for (index, page) in pages.iter_mut().enumerate() {
        page["numberLabel"] = text(&format!("{} / {total}", index + 1));
    }
    let meta = [string(facts, "name"), string(facts, "employer")]
        .into_iter()
        .filter(|v| !v.is_empty())
        .collect::<Vec<_>>()
        .join(" · ");
    Ok(PdfPlan {
        fields: json!({"schemaVersion":1,"title":text(string(facts,"title")),"meta":short(&meta,64),"referenceDate":date(string(facts,"referenceDate")),"testSuffix":text(if boolean(facts,"testData"){" · Testdaten"}else{""}),"pageClass":if compact{"compact"}else{"standard"},"time":sections::time(facts,document.targets)?,"middle":middle,"salary":if options.include_salary{sections::salary(facts,!compact)?}else{Value::Null},"notice":sections::notice(facts)?,"annual":annual_table,"entryPages":entry_pages,"pages":pages}),
    })
}
