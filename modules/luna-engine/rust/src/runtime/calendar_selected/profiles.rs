use super::*;
use crate::target::InputStatus;
use serde_json::Value;

#[derive(Default)]
pub struct NativeSelectedProfileCache {
    memo: Option<Memo>,
}
struct Key {
    base: Option<Arc<NativeSelectedBase>>,
    history: Arc<NativeSelectedHistory>,
    target_container: Option<Arc<()>>,
    parent_ready: bool,
    target_revision: u64,
    history_status: SelectedStatus,
    youth: Option<bool>,
    youth_status: InputStatus,
}
struct Memo {
    key: Key,
    profile: Option<Arc<Value>>,
    calculation: Option<Arc<Value>>,
}
fn same<T>(a: Option<&Arc<T>>, b: Option<&Arc<T>>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => Arc::ptr_eq(a, b),
        (None, None) => true,
        _ => false,
    }
}
impl Key {
    fn new(
        source: &SelectedControlSnapshot<
            NativeSelectedBase,
            NativeSelectedHistory,
            NativeSelectedTarget,
        >,
        youth: &NativeSelectedYouth,
    ) -> Self {
        Self {
            base: source.base.clone(),
            history: Arc::clone(&source.history),
            target_container: source.loaded_target_identity.clone(),
            parent_ready: source.parent_ready,
            target_revision: source.target_revision,
            history_status: source.history_status,
            youth: youth.value,
            youth_status: youth.status,
        }
    }
    fn matches(&self, other: &Self) -> bool {
        same(self.base.as_ref(), other.base.as_ref())
            && Arc::ptr_eq(&self.history, &other.history)
            && same(
                self.target_container.as_ref(),
                other.target_container.as_ref(),
            )
            && self.parent_ready == other.parent_ready
            && self.target_revision == other.target_revision
            && self.history_status == other.history_status
            && self.youth == other.youth
            && self.youth_status == other.youth_status
    }
}
pub struct NativeSelectedProfileView {
    pub(super) current: Current,
    pub(super) profile: Option<Arc<Value>>,
    pub(super) calculation_profile: Option<Arc<Value>>,
}
impl NativeSelectedProfileView {
    pub fn is_current(&self) -> Result<bool, SelectedSourceError> {
        self.current
            .is_current()
            .map_err(SelectedSourceError::Control)
    }
    pub fn profile(&self) -> Result<Option<&Arc<Value>>, SelectedSourceError> {
        if !self.is_current()? {
            return Err(SelectedSourceError::Stale);
        }
        Ok(self.profile.as_ref())
    }
    pub fn calculation_profile(&self) -> Result<Option<&Arc<Value>>, SelectedSourceError> {
        if !self.is_current()? {
            return Err(SelectedSourceError::Stale);
        }
        Ok(self.calculation_profile.as_ref())
    }
}
impl NativeSelectedProfileCache {
    pub fn observe(
        &mut self,
        source: &SelectedControlSnapshot<
            NativeSelectedBase,
            NativeSelectedHistory,
            NativeSelectedTarget,
        >,
        epoch: i64,
        youth: &NativeSelectedYouth,
    ) -> Result<NativeSelectedProfileView, SelectedSourceError> {
        if !source.is_current()? {
            return Err(SelectedSourceError::Stale);
        }
        if !source.shares_owner(&source.history.owner)
            || !source.shares_owner(&youth.owner)
            || source
                .base
                .as_ref()
                .is_some_and(|v| !source.shares_owner(&v.owner))
            || source
                .target
                .as_ref()
                .is_some_and(|v| !source.shares_owner(&v.owner))
        {
            return Err(SelectedSourceError::ForeignSource);
        }
        let key = Key::new(source, youth);
        if !self
            .memo
            .as_ref()
            .is_some_and(|memo| memo.key.matches(&key))
        {
            let base = source.base.as_ref().and_then(|base| base.profile.as_ref());
            let (profile, calculation) = match base {
                None => (None, None),
                Some(base) => {
                    let history = source.history.history.profiles();
                    let profile = if source.history_status == SelectedStatus::Ready
                        && history
                            .iter()
                            .any(|v| crate::net::js_truthy(&v["employment"]))
                    {
                        Arc::new(
                            crate::input::profile_clock::provider_on_selected_base(
                                base, history, epoch,
                            )
                            .map_err(SelectedSourceError::Input)?,
                        )
                    } else {
                        Arc::clone(base)
                    };
                    let calculation = if let Some(status) = source.calculation_status {
                        let status = match status {
                            SelectedStatus::Loading => InputStatus::Loading,
                            SelectedStatus::Error => InputStatus::Error,
                            SelectedStatus::Ready => InputStatus::Ready,
                        };
                        Arc::new(
                            crate::target::profile::create_working_time_calculation_profile(
                                base,
                                source.target.as_ref().and_then(|v| v.snapshot.as_ref()),
                                history,
                                status,
                                youth.value,
                                youth.status,
                            )
                            .map_err(SelectedSourceError::Target)?,
                        )
                    } else {
                        Arc::clone(base)
                    };
                    (Some(profile), Some(calculation))
                }
            };
            if !source.is_current()? {
                return Err(SelectedSourceError::Stale);
            }
            self.memo = Some(Memo {
                key,
                profile,
                calculation,
            });
        }
        let memo = self.memo.as_ref().ok_or(SelectedSourceError::Unavailable)?;
        Ok(NativeSelectedProfileView {
            current: source.witness(),
            profile: memo.profile.clone(),
            calculation_profile: memo.calculation.clone(),
        })
    }
    /// Called on the native worker when the owning actor is retired.
    pub fn clear(&mut self) {
        self.memo = None;
    }
}
