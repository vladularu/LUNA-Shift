use super::resource::{Resource, Witness};
use crate::{
    calendar::window::{CalendarWindowView, WindowOptions, WindowSpec},
    contract::{
        self, ContractError,
        calendar_window::{PageView, WindowSource},
        utility::UtilityGuard,
    },
    runtime::{RegistryError, report::ReportIssue, utility_lease::UtilityFenceError},
};
use serde::Serialize;
use std::{
    fmt,
    io::{self, Write},
    sync::Arc,
};
pub(super) const MAX_DRAFTS: usize = 4;
pub(super) const MAX_READY: usize = 8;
pub(super) const MAX_TOTAL: usize = 16;
pub(super) const MAX_BYTES: u64 = 32 * 1024 * 1024;
pub(super) const MAX_PAGE_BYTES: u64 = 1024 * 1024;
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WindowPoolError {
    Contract(ContractError),
    Registry(RegistryError),
    Fence(UtilityFenceError),
    Stale,
    Busy,
    UnknownResource,
    NotReady,
    AlreadyReady,
    InvalidRanks,
    ResourceLimit,
    OutputLimit,
    InvalidPage,
    SequenceExhausted,
    Poisoned,
}
impl From<ContractError> for WindowPoolError {
    fn from(e: ContractError) -> Self {
        Self::Contract(e)
    }
}
impl From<RegistryError> for WindowPoolError {
    fn from(e: RegistryError) -> Self {
        Self::Registry(e)
    }
}
impl From<UtilityFenceError> for WindowPoolError {
    fn from(e: UtilityFenceError) -> Self {
        Self::Fence(e)
    }
}
impl WindowPoolError {
    pub fn code(&self) -> String {
        match self {
            Self::Contract(e) => {
                return serde_json::to_value(e)
                    .expect("fixed code")
                    .as_str()
                    .expect("code")
                    .to_owned();
            }
            Self::Registry(e) => {
                return serde_json::to_value(e)
                    .expect("fixed code")
                    .as_str()
                    .expect("code")
                    .to_owned();
            }
            Self::Fence(e) => {
                return serde_json::to_value(e)
                    .expect("fixed code")
                    .as_str()
                    .expect("code")
                    .to_owned();
            }
            Self::Stale => "CALENDAR_WINDOW_STALE",
            Self::Busy => "CALENDAR_WINDOW_BUSY",
            Self::UnknownResource => "CALENDAR_WINDOW_UNKNOWN_RESOURCE",
            Self::NotReady => "CALENDAR_WINDOW_NOT_READY",
            Self::AlreadyReady => "CALENDAR_WINDOW_ALREADY_READY",
            Self::InvalidRanks => "CALENDAR_WINDOW_INVALID_RANKS",
            Self::ResourceLimit => "CALENDAR_WINDOW_RESOURCE_LIMIT",
            Self::OutputLimit => "CALENDAR_WINDOW_OUTPUT_LIMIT",
            Self::InvalidPage => "CALENDAR_WINDOW_INVALID_PAGE",
            Self::SequenceExhausted => "SEQUENCE_EXHAUSTED",
            Self::Poisoned => "POISONED",
        }
        .to_owned()
    }
}
impl fmt::Display for WindowPoolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.code())
    }
}
impl std::error::Error for WindowPoolError {}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WindowScope {
    pub guard: UtilityGuard,
    pub source: WindowSource,
    pub spec: WindowSpec,
    pub options: WindowOptions,
    pub locale_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub presentation: Option<contract::calendar_window::NavigationPresentation>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolStats {
    pub drafts: u32,
    pub ready: u32,
    pub retired: u32,
    pub retained_bytes: u64,
    pub source_indices: u32,
    pub preparations: u64,
    pub rank_parses: u64,
}
pub(super) enum Reply {
    Unavailable {
        witness: Arc<Witness>,
        scope: Arc<WindowScope>,
        reason: ReportIssue,
    },
    Prepared(Arc<Resource>),
    Candidates {
        resource: Arc<Resource>,
        start: usize,
        end: usize,
    },
    Ready {
        resource: Arc<Resource>,
        view: Arc<CalendarWindowView>,
    },
    Read {
        resource: Arc<Resource>,
        view: Arc<CalendarWindowView>,
        selector: PageView,
        start: usize,
        end: usize,
        total: usize,
    },
}
pub struct Completion {
    pub(super) reply: Reply,
}
impl fmt::Debug for Completion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("CalendarWindowCompletion")
    }
}
impl Completion {
    pub fn is_current(&self) -> Result<bool, WindowPoolError> {
        let result = match &self.reply {
            Reply::Unavailable { witness, .. } => witness.check(),
            Reply::Prepared(r)
            | Reply::Candidates { resource: r, .. }
            | Reply::Ready { resource: r, .. }
            | Reply::Read { resource: r, .. } => r.check(),
        };
        match result {
            Ok(()) => Ok(true),
            Err(WindowPoolError::Stale) => Ok(false),
            Err(error) => Err(error),
        }
    }
    pub(super) fn check(&self) -> Result<(), WindowPoolError> {
        if self.is_current()? {
            Ok(())
        } else {
            Err(WindowPoolError::Stale)
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Frame<'a, T: Serialize> {
    pub ok: bool,
    pub state: &'static str,
    pub wire_schema_version: u32,
    pub engine_version: &'static str,
    pub calculation_contract_version: &'static str,
    pub scope: &'a WindowScope,
    #[serde(flatten)]
    pub body: T,
}
pub(super) fn frame<'a, T: Serialize>(
    scope: &'a WindowScope,
    state: &'static str,
    body: T,
) -> Frame<'a, T> {
    Frame {
        ok: true,
        state,
        wire_schema_version: contract::SCHEMA_VERSION,
        engine_version: crate::ENGINE_VERSION,
        calculation_contract_version: contract::CONTRACT_VERSION,
        scope,
        body,
    }
}
struct LimitedVec(Vec<u8>);
impl Write for LimitedVec {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.0.len().saturating_add(bytes.len()) as u64 > MAX_PAGE_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::FileTooLarge,
                "calendar page limit",
            ));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
pub(super) fn serialize<T: Serialize>(value: &T) -> Result<Vec<u8>, WindowPoolError> {
    let mut out = LimitedVec(Vec::new());
    serde_json::to_writer(&mut out, value).map_err(|_| WindowPoolError::OutputLimit)?;
    Ok(out.0)
}
