use super::{
    super::{
        FinancialError,
        fingerprint::canonical::{CanonicalHash, value_digest},
    },
    input::{Evidence, EvidenceState},
};
use serde_json::Value;
use std::collections::BTreeSet;
#[derive(Clone, Copy)]
pub(super) enum Scope {
    All,
    Month,
    Shift,
}
struct Row {
    key: Option<String>,
    digest: [u8; 32],
}
pub(super) struct EvidenceRows {
    state: EvidenceState,
    scope: Scope,
    rows: Vec<Row>,
}
impl EvidenceRows {
    pub fn new<T>(
        source: &Evidence<T>,
        values: impl for<'a> Fn(&'a T) -> &'a [Value],
        scope: Scope,
    ) -> Result<Self, FinancialError> {
        let rows = source
            .ready()
            .map_or(&[][..], |owner| values(owner.as_ref()));
        let mut digests = Vec::with_capacity(rows.len());
        for row in rows {
            let key = match scope {
                Scope::All => None,
                Scope::Month => Some(
                    row["month"]
                        .as_str()
                        .ok_or_else(|| FinancialError::invalid("Ungültige Monatsbelegquelle."))?
                        .to_owned(),
                ),
                Scope::Shift => Some(
                    row["shiftId"]
                        .as_str()
                        .ok_or_else(|| FinancialError::invalid("Ungültige Dienstbelegquelle."))?
                        .to_owned(),
                ),
            };
            digests.push(Row {
                key,
                digest: value_digest(row, false)?.0,
            });
        }
        Ok(Self {
            state: source.state(),
            scope,
            rows: digests,
        })
    }
    pub fn feed(
        &self,
        hash: &mut CanonicalHash,
        required: bool,
        month: &str,
        shift_ids: &BTreeSet<&str>,
        first: bool,
        optional_month_rows: bool,
    ) {
        let selected = self
            .rows
            .iter()
            .filter(|row| match self.scope {
                Scope::All => true,
                Scope::Month => row.key.as_deref() == Some(month),
                Scope::Shift => row.key.as_deref().is_some_and(|id| shift_ids.contains(id)),
            })
            .take(if first { 1 } else { usize::MAX })
            .collect::<Vec<_>>();
        // Scoped decisions can split returned assessment periods independently of the
        // employment family. Other unrelated failed/empty sources are not dependencies.
        if !required && (!optional_month_rows || selected.is_empty()) {
            hash.null();
            return;
        }
        hash.array(2);
        hash.string(match self.state {
            EvidenceState::NotRequested => "NOT_REQUESTED",
            EvidenceState::Loading => "LOADING",
            EvidenceState::Missing => "MISSING",
            EvidenceState::Failed => "FAILED",
            EvidenceState::Ready => "READY",
        });
        hash.array(selected.len());
        for row in selected {
            hash.bytes(&row.digest);
        }
    }
}
