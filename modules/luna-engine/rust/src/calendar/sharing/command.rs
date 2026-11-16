//! Stateless adapter for the existing bounded Calendar PRESENTATION transport.
use super::*;
use serde::Deserialize;
use serde_json::json;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Binding {
    slot: usize,
    public_id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    entries: Vec<Value>,
    options: Value,
    bindings: Option<Vec<Binding>>,
}
pub(crate) fn execute(kind: &str, raw: &[u8]) -> Result<Value, &'static str> {
    let input: Input = serde_json::from_value(
        crate::contract::bounded_json(raw).map_err(|_| "INVALID_CALENDAR_INPUT")?,
    )
    .map_err(|_| "INVALID_CALENDAR_INPUT")?;
    let draft = match SharingProjectionDraft::prepare(Arc::new(input.entries), &input.options) {
        Ok(v) => v,
        Err(e) => return Ok(json!({"error":e})),
    };
    if kind == "SHARING_CANDIDATES" {
        if input.bindings.is_some() {
            return Err("INVALID_CALENDAR_INPUT");
        }
        let mut identities = Vec::new();
        for offset in (0..draft.identity_candidate_count()).step_by(MAX_PAGE) {
            identities.extend(
                draft
                    .identity_candidates_page(offset, MAX_PAGE)
                    .map_err(|_| "INVALID_CALENDAR_INPUT")?,
            );
        }
        return Ok(
            json!({"candidates":identities,"projectionSlots":draft.projection_candidates().map_err(|_|"INVALID_CALENDAR_INPUT")?.into_iter().map(|c|c.slot).collect::<Vec<_>>()}),
        );
    }
    let bindings = input
        .bindings
        .ok_or("INVALID_CALENDAR_INPUT")?
        .into_iter()
        .map(|v| PublicIdBinding {
            slot: v.slot,
            public_id: v.public_id,
        })
        .collect::<Vec<_>>();
    Ok(match draft.finish(&bindings) {
        Ok(v) => json!({"value":v}),
        Err(e) => json!({"error":e}),
    })
}
