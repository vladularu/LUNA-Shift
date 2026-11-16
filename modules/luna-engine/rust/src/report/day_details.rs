//! Day-detail presentation over private native rows and the existing target cache.
//! This module has no deserializable Ready input and performs no SQL/report job.
use super::{
    computation::{Computation, capture_metrics},
    time_display::format,
};
use crate::{
    EngineError,
    calendar::{
        parse_date,
        presentation::navigation::date_title,
        recurrence::CollationRanks,
        window::{CalendarEntrySource, SortedCalendarWindow},
    },
    credit::{
        context::{DailyCreditContextCache, DailyCreditError},
        prepared::PreparedCreditEntries,
        summary::MetricsError,
    },
    employment::employment_overlay_at,
    input::javascript_json::number_text,
    rules::holidays::holiday_calendar,
    target::{TargetError, TargetStatus},
};
use serde::Serialize;
use serde_json::{Value, json};
use std::sync::Arc;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayDetailsProjection<S = Arc<Vec<Value>>> {
    #[serde(skip)]
    window: Arc<SortedCalendarWindow<S>>,
    title: String,
    holiday: Option<String>,
    summary: Option<Value>,
    notice: Option<Value>,
    entries_caption: String,
    empty: Option<Value>,
}
impl<S: CalendarEntrySource> DayDetailsProjection<S> {
    pub fn source_window(&self) -> &Arc<SortedCalendarWindow<S>> {
        &self.window
    }
    pub fn entry_count(&self) -> u32 {
        self.window.projected_len()
    }
    pub fn rows(&self, offset: u32, limit: u32) -> Result<Vec<Value>, MetricsError> {
        if !(1..=128).contains(&limit) || offset > self.entry_count() {
            return Err(EngineError::InvalidCalendarEntry.into());
        }
        (offset..offset.saturating_add(limit).min(self.entry_count())).map(|index| {
            let entry=self.window.entry(index).ok_or(EngineError::InvalidCalendarEntry)?;
            let row=entry.original();
            let appointment=row["kind"]=="APPOINTMENT";
            let all_day=row["allDay"].as_bool()==Some(true);
            let when=if all_day || (!appointment && row.get("startTime")==Some(&Value::Null)) {
                "Ganztägig".to_owned()
            } else if appointment {
                format!("{}–{}",interpolate(row.get("startTime"))?,interpolate(row.get("endTime"))?)
            } else {
                format!("{}–{} · {} Min. Pause",interpolate(row.get("startTime"))?,interpolate(row.get("endTime"))?,interpolate(row.get("breakMinutes"))?)
            };
            let mut value=json!({"id":row["id"],"kind":row["kind"],"title":entry.get("title"),"when":when,"color":entry.get("color")});
            if appointment {value["symbol"]=json!("T");}
            else if let Some(symbol)=entry.get("symbol") {value["symbol"]=symbol.clone();}
            Ok(value)
        }).collect()
    }
}
pub fn prepare<S: CalendarEntrySource>(
    date: &str,
    window: Arc<SortedCalendarWindow<S>>,
    cache: &mut DailyCreditContextCache<'_>,
    ranks: &CollationRanks,
) -> Result<DayDetailsProjection<S>, MetricsError> {
    parse_date(date)?;
    if window.bounds().start_date != date || window.bounds().end_date != date {
        return Err(EngineError::InvalidCalendarEntry.into());
    }
    let calculated = (|| -> Result<Value, MetricsError> {
        // Only today's original shift references; no copy of full records or
        // appointment recurrence overlays enters daily credit calculation.
        let shifts = (0..window.projected_len())
            .filter_map(|index| window.entry(index))
            .map(|entry| entry.original())
            .filter(|entry| entry["kind"] == "SHIFT")
            .collect();
        let prepared = PreparedCreditEntries::from_refs(shifts)?;
        let credit = cache.summary_prepared(date, &prepared, ranks)?;
        let provisional = if cache
            .profile()
            .get("workingTimeTarget")
            .is_some_and(|value| !value.is_null())
        {
            cache.base_monthly_target(&date[..7], None)?.status == TargetStatus::Provisional
        } else {
            false
        };
        let target = crate::credit::number(&credit.target_minutes)?
            .as_f64()
            .ok_or(EngineError::InvalidDuration)?;
        let actual = crate::credit::number(&credit.actual_minutes)?
            .as_f64()
            .ok_or(EngineError::InvalidDuration)?;
        let balance = crate::credit::number(&credit.balance_minutes)?
            .as_f64()
            .ok_or(EngineError::InvalidDuration)?;
        let invalid = |_| MetricsError::Calculation(EngineError::InvalidDuration);
        Ok(
            json!({"target":format::minutes(target).map_err(invalid)?,"actual":format::minutes(actual).map_err(invalid)?,
            "balance":format::signed(balance).map_err(invalid)?,"negative":balance<0.0,"provisional":provisional}),
        )
    })();
    let (summary, notice) = match capture_metrics(calculated)? {
        Computation::Ready(value) => (Some(value), None),
        Computation::Unavailable { failure, .. } => (
            None,
            Some(json!({"title":"Sollzeit noch offen","failure":failure})),
        ),
    };
    let profile = cache.profile();
    let overlay = employment_overlay_at(profile, date).map_err(DailyCreditError::Employment)?;
    let field = |key| {
        overlay
            .and_then(|value| value.get(key))
            .or_else(|| profile.get(key))
    };
    let state = field("federalState")
        .and_then(Value::as_str)
        .ok_or(TargetError::InvalidInput)?;
    let region = match field("holidayRegion") {
        None | Some(Value::Null) => "NONE",
        Some(value) => value.as_str().ok_or(TargetError::InvalidInput)?,
    };
    let holiday = holiday_calendar(
        parse_date(date)?.year() as i32,
        state,
        region,
        cache.resolver(),
    )
    .map_err(TargetError::Holiday)?
    .entries()
    .iter()
    .find(|item| item.date == date)
    .map(|item| item.name.clone());
    let count = window.projected_len();
    Ok(DayDetailsProjection {
        window,title:date_title(date)?,holiday,summary,notice,entries_caption:format!("{count} an diesem Tag"),
        empty:(count==0).then(||json!({"title":"Noch nichts geplant","message":"Füge einen Dienst, Termin oder eine Abwesenheit hinzu."})),
    })
}
fn interpolate(value: Option<&Value>) -> Result<String, EngineError> {
    Ok(match value {
        None => "undefined".into(),
        Some(Value::Null) => "null".into(),
        Some(Value::String(value)) => value.clone(),
        Some(Value::Bool(value)) => value.to_string(),
        Some(Value::Number(value)) => {
            number_text(value.as_f64().ok_or(EngineError::InvalidDuration)?)
        }
        _ => return Err(EngineError::InvalidCalendarEntry),
    })
}
