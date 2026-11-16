use super::*;
use crate::{
    contract::{assembly::SnapshotAssembly, utility::UtilityGuard},
    input::profile_editor::EditorSection,
    runtime::{
        profile_editor_draft::EditorDraftError,
        profile_editor_flow::{ProfileEditorFlow, ProfileFlowError},
        profile_editor_source::{LightProfileContext, LightProfileError},
        write_resource::WriteContextStamp,
    },
};
pub(super) struct Builder {
    pub owner: UtilityOwnerMarker,
    pub request_id: String,
    pub active: AtomicBool,
    pub stamp: WriteContextStamp,
    pub epoch: i64,
    pub source: Mutex<Option<BuilderBody>>,
    pub day_details: Mutex<Option<super::day_details::Opening>>,
}
pub(super) struct BuilderBody {
    pub assembly: SnapshotAssembly,
    pub kind: BuilderKind,
    pub raw_bytes: usize,
}
pub(super) enum BuilderKind {
    Profile {
        section: EditorSection,
        from_more: bool,
    },
    Day(Box<super::day::Opening>),
    DayDetails {
        date: String,
    },
}
pub(super) struct Resource {
    pub owner: UtilityOwnerMarker,
    pub request_id: String,
    pub active: AtomicBool,
    pub data: ResourceData,
}
type ProfileSlot = Mutex<Box<super::profile::ProfileState>>;
pub(super) enum ResourceData {
    DayDetails {
        state: Mutex<Box<super::day_details::DayDetailsState>>,
    },
    Profile {
        source: LightProfileContext,
        state: ProfileSlot,
    },
    Payroll {
        state: Mutex<Box<super::payroll::PayrollState>>,
    },
    Day {
        state: Mutex<Box<super::day::DayState>>,
    },
}
impl Builder {
    pub fn check(&self, g: &UtilityGuard) -> Result<(), FormResourceError> {
        if !self.active.load(Ordering::Acquire)
            || !self
                .owner
                .is_current()
                .map_err(|_| FormResourceError::Poisoned)?
        {
            return Err(FormResourceError::OwnerChanged);
        }
        if self.request_id != g.request_id() || g.draft_revision() != 0 {
            return Err(FormResourceError::StaleResource);
        }
        Ok(())
    }
}
fn unavailable(code: &'static str) -> Value {
    json!({"state":"FORM_UNAVAILABLE","reason":{"code":code}})
}
fn form_error(error: crate::input::profile_form::ProfileFormError) -> Value {
    json!({"state":"FORM_UNAVAILABLE","reason":{"code":"PROFILE_FORM_INVALID"},"error":{"name":error.name(),"message":error.to_string(),"userFacing":error.user_facing_message().is_some()}})
}
pub(super) fn flow_error(error: ProfileFlowError) -> Value {
    match error {
        ProfileFlowError::Form(error) | ProfileFlowError::Draft(EditorDraftError::Form(error)) => {
            form_error(error)
        }
        _ => unavailable("PROFILE_FORM_UNAVAILABLE"),
    }
}
pub(super) fn fact_error(error: crate::runtime::facts::FactError) -> Value {
    use crate::runtime::facts::FactError;
    let detail = match &error {
        FactError::Profile(e) | FactError::Remuneration(e) => Some(
            json!({"name":e.name(),"message":e.message(),"userFacing":e.user_facing_message().is_some()}),
        ),
        _ => None,
    };
    let mut frame = json!({"state":"FORM_UNAVAILABLE","reason":crate::runtime::report::ReportIssue::from(error)});
    if let Some(detail) = detail {
        frame["error"] = detail
    }
    frame
}
impl Resource {
    pub fn profile(&self) -> Result<(&LightProfileContext, &ProfileSlot), FormResourceError> {
        match &self.data {
            ResourceData::Profile { source, state } => Ok((source, state)),
            _ => Err(FormResourceError::InvalidHeader),
        }
    }
    pub fn profile_outcome(&self, id: u64, epoch: i64) -> Result<Value, Value> {
        let rules = crate::runtime::profile_form_facade::resolver()
            .map_err(|_| unavailable("PROFILE_FORM_UNAVAILABLE"))?;
        self.profile()
            .map_err(|_| unavailable("PROFILE_FORM_UNAVAILABLE"))?
            .1
            .lock()
            .map_err(|_| unavailable("PROFILE_FORM_UNAVAILABLE"))?
            .outcome(id, epoch, rules)
            .map_err(|_| unavailable("PROFILE_FORM_UNAVAILABLE"))
    }
    pub fn check(&self, guard: &UtilityGuard) -> Result<(), FormResourceError> {
        if !self.active.load(Ordering::Acquire)
            || self.request_id != guard.request_id()
            || !self
                .owner
                .is_current()
                .map_err(|_| FormResourceError::OwnerChanged)?
        {
            return Err(FormResourceError::OwnerChanged);
        }
        Ok(())
    }
}
pub(super) enum OpenProfile {
    Ready(Box<Resource>),
    Unavailable(Value),
}
pub(super) fn open(builder: &Builder, body: BuilderBody) -> Result<OpenProfile, FormResourceError> {
    let BuilderKind::Profile { section, from_more } = body.kind else {
        return Err(FormResourceError::InvalidHeader);
    };
    let light = match LightProfileContext::prepare(
        builder.owner.clone(),
        builder.stamp.clone(),
        body.assembly,
        builder.epoch,
    ) {
        Ok(light) => light,
        Err(LightProfileError::OwnerChanged) => return Err(FormResourceError::OwnerChanged),
        Err(LightProfileError::Facts(error)) => {
            return Ok(OpenProfile::Unavailable(fact_error(error)));
        }
        Err(LightProfileError::Contract(_)) => {
            return Ok(OpenProfile::Unavailable(unavailable(
                "PROFILE_CLOCK_INVALID",
            )));
        }
        Err(_) => return Err(FormResourceError::InvalidSource),
    };
    let Some(context) = light.context().cloned() else {
        return Ok(OpenProfile::Unavailable(unavailable("PROFILE_MISSING")));
    };
    let rules = match crate::runtime::profile_form_facade::resolver() {
        Ok(r) => r,
        Err(_) => {
            return Ok(OpenProfile::Unavailable(unavailable(
                "PROFILE_FORM_UNAVAILABLE",
            )));
        }
    };
    let flow = ProfileEditorFlow::new(context, section, from_more);
    let draft = match flow.open_editor(builder.epoch, rules) {
        Ok(draft) => draft,
        Err(error) => return Ok(OpenProfile::Unavailable(flow_error(error))),
    };
    Ok(OpenProfile::Ready(Box::new(Resource {
        owner: builder.owner.clone(),
        request_id: builder.request_id.clone(),
        active: AtomicBool::new(true),
        data: ResourceData::Profile {
            state: Mutex::new(Box::new(super::profile::ProfileState::new(
                flow,
                draft,
                light.stamp().clone(),
            ))),
            source: light,
        },
    })))
}
