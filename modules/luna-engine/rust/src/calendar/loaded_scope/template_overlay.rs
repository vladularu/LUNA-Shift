use super::{CalendarLoadedScope, ScopeEntries, ScopeEntry, ScopeError};
use serde_json::Value;
use std::sync::Arc;

/// Small projection of an actual native template postimage. No Deserialize and
/// no owner/write capability. Runtime requires its genuine native commit proof.
#[derive(Debug)]
pub struct TemplateDisplay {
    pub(super) id: String,
    pub(super) title: Value,
    pub(super) color: Value,
    pub(super) symbol: Value,
}
impl TemplateDisplay {
    pub fn from_write_row(raw: Arc<Value>) -> Result<Arc<Self>, ScopeError> {
        let value = crate::input::calendar_rows::map_template(&raw)?;
        Self::from_native_template(&value)
    }
    pub(crate) fn from_native_template(value: &Value) -> Result<Arc<Self>, ScopeError> {
        let id = value["id"]
            .as_str()
            .filter(|id| !id.is_empty() && id.encode_utf16().count() <= 256)
            .ok_or(ScopeError::InvalidIntent)?
            .to_owned();
        if ["name", "color", "symbol"]
            .iter()
            .any(|field| !value[*field].is_string())
        {
            return Err(ScopeError::InvalidIntent);
        }
        Ok(Arc::new(Self {
            id,
            title: value["name"].clone(),
            color: value["color"].clone(),
            symbol: value["symbol"].clone(),
        }))
    }
}
impl CalendarLoadedScope {
    pub fn publish_template(&mut self, display: Arc<TemplateDisplay>) {
        // Source Provider maps the live array without sorting it. Unaffected
        // entry identities remain stable; only a small shared overlay changes.
        self.entries = ScopeEntries(Arc::from(
            self.entries
                .entries()
                .iter()
                .map(|entry| {
                    if entry.get("kind").and_then(Value::as_str) == Some("SHIFT")
                        && entry.get("templateId").and_then(Value::as_str)
                            == Some(display.id.as_str())
                    {
                        Arc::new(ScopeEntry {
                            value: Arc::clone(&entry.value),
                            display: Some(Arc::clone(&display)),
                            _raw: entry._raw.clone(),
                        })
                    } else {
                        Arc::clone(entry)
                    }
                })
                .collect::<Vec<_>>(),
        ));
    }
}
