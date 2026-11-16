use super::{EditorSection, ProfileEditorSource, ProfileFormError, model};
use crate::{
    input::{javascript_json, profile_form::shape_error},
    pay::families::{Family, profile as family, tvl_tval},
    rules::RuleResolver,
};
use serde_json::{Value, json};
pub(super) fn full_time(
    draft: &Value,
    date: &str,
    resolver: &RuleResolver,
) -> Result<f64, ProfileFormError> {
    let mode = model::text(draft, "salaryMode");
    let sector = model::text(draft, "sector");
    let region = model::text(draft, "tariffRegion");
    let derived = match mode {
        "TVAL_PFLEGE" | "TVL_KR" => tvl_tval::full_time_minutes(
            if mode == "TVL_KR" {
                Family::Tvl
            } else {
                Family::Tval
            },
            date,
            model::text(draft, "tvlUniversityRegion"),
            resolver,
        )?
        .unwrap_or(0) as f64,
        "TVH_KR" => draft["tvhFullTimeWeeklyMinutes"]
            .as_f64()
            .ok_or_else(shape_error)?,
        "TVUK_NURSING" => 2310.0,
        "TVAOED_PFLEGE" => {
            if sector == "BT_K" {
                2310.0
            } else {
                2340.0
            }
        }
        _ => family::tariff_full_time_weekly_minutes(sector, region) as f64,
    };
    Ok(if mode == "TVOED_P" {
        draft["pFullTimeOverride"].as_f64().unwrap_or(derived)
    } else {
        derived
    })
}
fn p_levels(group: &str) -> Value {
    json!(
        (if ["P5", "P6"].contains(&group) {
            1..=6
        } else {
            2..=6
        })
        .collect::<Vec<_>>()
    )
}
fn selected_levels(draft: &Value) -> Value {
    match model::text(draft, "salaryMode") {
        "TVL_KR" => json!(family::tvl_kr_levels_for_group(model::text(
            draft,
            "krPayGroup"
        ))),
        "TVOED_E" => json!(family::e_pay_levels(model::text(draft, "ePayGroup"))),
        _ => p_levels(model::text(draft, "payGroup")),
    }
}
fn same(first: &Value, last: &Value) -> Result<bool, ProfileFormError> {
    Ok(
        javascript_json::stringify(first).map_err(|_| shape_error())?
            == javascript_json::stringify(last).map_err(|_| shape_error())?,
    )
}
pub(super) fn calculate(
    source: &ProfileEditorSource<'_>,
    draft: &Value,
    date: &str,
    resolver: &RuleResolver,
) -> Result<Value, ProfileFormError> {
    let section = source.section;
    let mode = model::text(draft, "salaryMode");
    let full_time = full_time(draft, date, resolver)?;
    let full_time_value: Value = serde_json::from_str(&javascript_json::number_text(full_time))
        .map_err(|_| shape_error())?;
    let selected = selected_levels(draft);
    let (group, values) = match mode {
        "TVH_KR" => (&draft["tvhPayGroup"], json!(family::TVH_KR_GROUPS)),
        "TVUK_NURSING" => (&draft["tvUkPayGroup"], json!(family::TVUK_NURSING_GROUPS)),
        "TVL_KR" => (&draft["krPayGroup"], json!(family::TVL_KR_GROUPS)),
        "TVOED_E" => (&draft["ePayGroup"], json!(family::VKA_E_GROUPS)),
        _ => (&draft["payGroup"], json!(crate::input::profile::GROUPS)),
    };
    let active_levels = match mode {
        "TVH_KR" => json!(family::tvh_kr_levels_for_group(model::text(
            draft,
            "tvhPayGroup"
        ))),
        "TVUK_NURSING" => json!(family::tvuk_levels_for_group(model::text(
            draft,
            "tvUkPayGroup"
        ))),
        _ => selected.clone(),
    };
    let active_level = match mode {
        "TVH_KR" => &draft["tvhPayLevel"],
        "TVUK_NURSING" => &draft["tvUkPayLevel"],
        _ => &draft["payLevel"],
    };
    let title = match section {
        EditorSection::Employment => "Arbeit & Gehalt",
        EditorSection::Model => "Arbeitsmodell",
        EditorSection::Work => {
            if source.from_more {
                "Arbeitszeit & Ort"
            } else {
                "Arbeitszeit"
            }
        }
        EditorSection::Employer => "Arbeitgeber",
        EditorSection::Personal => "Persönliche Angaben",
        EditorSection::Tariff => "Tarif & Gehalt",
    };
    let touched = model::edit_tariff(section)
        && !same(
            &model::tariff_draft(draft),
            &model::tariff_draft(&source.initial),
        )?;
    let dirty = !same(
        &model::whole_draft(section, draft),
        &model::whole_draft(section, &source.initial),
    )?;
    Ok(
        json!({"editWork":model::edit_work(section),"editTariff":model::edit_tariff(section),"editModel":model::edit_model(section),"employment":!matches!(section,EditorSection::Personal|EditorSection::Employer),"pageTitle":title,"fullTimeWeeklyMinutes":full_time_value,"fullTimeHours":javascript_json::number_text(full_time/60.0).replace('.',","),"selectedLevels":selected,"tariffTouched":touched,"dirty":dirty,"isTraining":matches!(mode,"TVAOED_PFLEGE"|"TVAL_PFLEGE"),"activeGroup":group,"groupValues":values,"activeLevels":active_levels,"activeLevel":active_level}),
    )
}
