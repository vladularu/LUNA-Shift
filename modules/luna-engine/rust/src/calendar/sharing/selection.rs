use super::{MAX_PROJECTED, Options, SharingError, required_string};
use serde_json::Value;

pub(super) struct IdentityGroup {
    pub raw_index: usize,
    pub first_slot: usize,
    pub split: bool,
}
pub(super) struct SelectedEntry {
    pub raw_index: usize,
    pub slot: usize,
    pub projected_time: Option<Value>,
    pub title_override: Option<&'static str>,
}

pub(super) fn prepare(
    source: &[Value],
    options: &Options,
) -> Result<(Vec<IdentityGroup>, Vec<SelectedEntry>, usize), SharingError> {
    let mut groups = Vec::with_capacity(source.len());
    let mut selected = Vec::new();
    let mut identity_count = 0usize;
    for (raw_index, entry) in source.iter().enumerate() {
        let kind = required_string(entry, "kind")?;
        if !matches!(kind, "SHIFT" | "APPOINTMENT") {
            return Err(SharingError::invalid());
        }
        let private_id = required_string(entry, "id")?;
        let special = entry
            .get("specialDuty")
            .filter(|d| kind == "SHIFT" && !d.is_null());
        let title_override = special
            .map(|duty| match required_string(duty, "kind")? {
                "SPLIT" => Ok("Geteilter Dienst"),
                "STANDBY" => Ok("Bereitschaftsdienst"),
                "ON_CALL" => Ok("Rufbereitschaft"),
                _ => Err(SharingError::invalid()),
            })
            .transpose()?;
        if let Some(duty) = special
            && (duty
                .get("parts")
                .and_then(Value::as_array)
                .is_none_or(|v| v.len() > 8)
                || duty
                    .get("callouts")
                    .and_then(Value::as_array)
                    .is_none_or(|v| v.len() > 64))
        {
            return Err(SharingError::invalid());
        }
        let split = special.is_some_and(|duty| duty["kind"] == "SPLIT");
        // Only time facts enter the shared duty projector. Large private metadata remains borrowed.
        let projected = if split {
            let mut time = serde_json::Map::new();
            for key in [
                "date",
                "startTime",
                "endTime",
                "breakMinutes",
                "specialDuty",
                "overtimeMinutes",
                "tariffOvertimeConfirmed",
            ] {
                if let Some(value) = entry.get(key) {
                    time.insert(key.into(), value.clone());
                }
            }
            Some(
                crate::credit::duty::project_duty_work(&Value::Object(time))
                    .map_err(|_| SharingError::time())?,
            )
        } else {
            None
        };
        let count = projected.as_ref().map_or(1, Vec::len);
        if count > 0 {
            groups.push(IdentityGroup {
                raw_index,
                first_slot: identity_count,
                split,
            });
        }
        let eligible = entry.get("deletedAt") == Some(&Value::Null)
            && !(kind == "SHIFT" && options.neutral && entry["type"] == "FREE")
            && !(kind == "SHIFT" && options.content.as_ref().is_some_and(|c| !c.shifts))
            && !(kind == "APPOINTMENT"
                && !options.content.as_ref().is_some_and(|c| c.all_appointments)
                && !options.selected.contains(private_id));
        if eligible {
            for part in 0..count {
                if selected.len() <= MAX_PROJECTED {
                    selected.push(SelectedEntry {
                        raw_index,
                        slot: identity_count + part,
                        projected_time: projected.as_ref().map(|parts| parts[part].clone()),
                        title_override,
                    });
                }
            }
        }
        identity_count = identity_count
            .checked_add(count)
            .ok_or_else(SharingError::invalid)?;
    }
    Ok((groups, selected, identity_count))
}

pub(super) fn value<'a>(
    raw: &'a Value,
    selected: &'a SelectedEntry,
    key: &str,
) -> Option<&'a Value> {
    selected
        .projected_time
        .as_ref()
        .and_then(|part| part.get(key))
        .or_else(|| raw.get(key))
}
