use super::*;
use std::{collections::BTreeSet, sync::atomic::Ordering};

struct LoadedTarget<T> {
    revision: u64,
    status: SelectedStatus,
    value: Option<Arc<T>>,
}
/// An internal control model, not a selected-ready source or write permission.
pub struct NativeSelectedLifecycle<B, H, T> {
    owner: UtilityOwnerMarker,
    core: Arc<()>,
    publication: Arc<AtomicU64>,
    mounted: bool,
    parent_ready: bool,
    base: Option<Arc<B>>,
    history: Arc<H>,
    history_status: SelectedStatus,
    history_revision: u64,
    history_sequence: u64,
    history_active: Option<u64>,
    writer_sequence: u64,
    writers: BTreeSet<u64>,
    target_available: bool,
    target_revision: u64,
    target_activation: u64,
    target_active: Option<u64>,
    target_loaded: Option<LoadedTarget<T>>,
    target_container: Option<Arc<()>>,
}
pub struct SelectedReads {
    pub target: Option<SelectedTargetRead>,
    pub history: Option<SelectedHistoryRead>,
}
pub struct SelectedControlSnapshot<B, H, T> {
    current: Current,
    pub parent_ready: bool,
    pub base: Option<Arc<B>>,
    pub history: Arc<H>,
    pub history_status: SelectedStatus,
    pub history_revision: u64,
    pub pending_history_writes: usize,
    pub target_revision: u64,
    pub loaded_target_revision: Option<u64>,
    pub loaded_target_status: Option<SelectedStatus>,
    /// Original `loaded` object identity also changes for NULL/error snapshots.
    pub loaded_target_identity: Option<Arc<()>>,
    pub target: Option<Arc<T>>,
    pub calculation_status: Option<SelectedStatus>,
}
impl<B, H, T> SelectedControlSnapshot<B, H, T> {
    pub(super) fn shares_owner(&self, owner: &UtilityOwnerMarker) -> bool {
        self.current.owner.shares_owner(owner)
    }
    pub(super) fn witness(&self) -> Current {
        self.current.clone()
    }
    pub fn is_current(&self) -> Result<bool, SelectedControlError> {
        self.current.is_current()
    }
}
impl<B, H, T> NativeSelectedLifecycle<B, H, T> {
    pub fn new(
        owner: UtilityOwnerMarker,
        empty_history: Arc<H>,
        target_available: bool,
    ) -> Result<(Self, SelectedHistoryRead), SelectedControlError> {
        check_owner(&owner)?;
        let mut state = Self {
            owner,
            core: Arc::new(()),
            publication: Arc::new(AtomicU64::new(0)),
            mounted: true,
            parent_ready: false,
            base: None,
            history: empty_history,
            history_status: SelectedStatus::Loading,
            history_revision: 0,
            history_sequence: 0,
            history_active: None,
            writer_sequence: 0,
            writers: BTreeSet::new(),
            target_available,
            target_revision: 0,
            target_activation: 0,
            target_active: None,
            target_loaded: None,
            target_container: None,
        };
        let read = state
            .reload_history()?
            .ok_or(SelectedControlError::Replay)?;
        Ok((state, read))
    }
    fn check(&self) -> Result<(), SelectedControlError> {
        check_owner(&self.owner)?;
        if self.mounted {
            Ok(())
        } else {
            Err(SelectedControlError::Closed)
        }
    }
    fn close(&mut self) {
        self.mounted = false;
        // Dropping this unique strong identity also invalidates snapshots if a
        // publication counter itself is exhausted and cannot be advanced.
        self.core = Arc::new(());
        self.target_active = None;
        self.history_active = None;
    }
    fn advance(&mut self, value: u64) -> Result<u64, SelectedControlError> {
        match value.checked_add(1) {
            Some(value) => Ok(value),
            None => {
                self.close();
                Err(SelectedControlError::SequenceExhausted)
            }
        }
    }
    fn bump(&mut self) -> Result<(), SelectedControlError> {
        if self
            .publication
            .try_update(Ordering::AcqRel, Ordering::Acquire, |v| v.checked_add(1))
            .is_err()
        {
            self.close();
            return Err(SelectedControlError::SequenceExhausted);
        }
        Ok(())
    }
    fn ticket(
        &self,
        core: &Weak<()>,
        owner: &UtilityOwnerMarker,
    ) -> Result<(), SelectedControlError> {
        self.check()?;
        if Weak::ptr_eq(core, &Arc::downgrade(&self.core)) && owner.shares_owner(&self.owner) {
            Ok(())
        } else {
            Err(SelectedControlError::ForeignTicket)
        }
    }
    fn start_target(&mut self) -> Result<Option<SelectedTargetRead>, SelectedControlError> {
        if !self.parent_ready || !self.target_available {
            return Ok(None);
        }
        self.target_activation = self.advance(self.target_activation)?;
        self.target_active = Some(self.target_activation);
        Ok(Some(SelectedTargetRead {
            core: Arc::downgrade(&self.core),
            owner: self.owner.clone(),
            activation: self.target_activation,
            revision: self.target_revision,
        }))
    }
    /// Called only with the existing native loader's state; no host readiness DTO is admitted.
    pub fn parent_ready(
        &mut self,
        ready: bool,
    ) -> Result<Option<SelectedTargetRead>, SelectedControlError> {
        self.check()?;
        if self.parent_ready == ready {
            return Ok(None);
        }
        self.bump()?;
        self.parent_ready = ready;
        self.target_active = None;
        self.start_target()
    }
    /// Source attachment/IO admission must precede this control transition in its consumer.
    pub fn full_snapshot(
        &mut self,
        base: Option<Arc<B>>,
    ) -> Result<SelectedReads, SelectedControlError> {
        self.check()?;
        self.bump()?;
        self.base = base;
        self.history_revision = self.advance(self.history_revision)?;
        self.history_sequence = self.advance(self.history_sequence)?; // original effect cleanup
        self.history_active = None;
        let history = self.reload_history()?;
        let target = self.parent_ready(true)?;
        Ok(SelectedReads { target, history })
    }
    /// Policy only. The later consumer requires a genuine committed profile-write proof.
    pub fn profile_written(
        &mut self,
        base: Option<Arc<B>>,
    ) -> Result<Option<SelectedHistoryRead>, SelectedControlError> {
        self.check()?;
        self.bump()?;
        self.base = base;
        self.history_revision = self.advance(self.history_revision)?;
        self.history_sequence = self.advance(self.history_sequence)?;
        self.history_active = None;
        self.reload_history()
    }
    pub fn refresh_target(&mut self) -> Result<Option<SelectedTargetRead>, SelectedControlError> {
        self.check()?;
        self.bump()?;
        self.target_revision = self.advance(self.target_revision)?;
        self.target_active = None;
        self.start_target()
    }
    pub fn resolve_target(
        &mut self,
        ticket: SelectedTargetRead,
        value: Option<Arc<T>>,
    ) -> Result<bool, SelectedControlError> {
        self.finish_target(ticket, SelectedStatus::Ready, value)
    }
    pub fn reject_target(
        &mut self,
        ticket: SelectedTargetRead,
    ) -> Result<bool, SelectedControlError> {
        self.finish_target(ticket, SelectedStatus::Error, None)
    }
    /// Check before parsing a child raw body; completion repeats this check.
    pub fn accepts_target(
        &self,
        ticket: &SelectedTargetRead,
    ) -> Result<bool, SelectedControlError> {
        self.ticket(&ticket.core, &ticket.owner)?;
        Ok(
            self.target_active == Some(ticket.activation)
                && self.target_revision == ticket.revision,
        )
    }
    fn finish_target(
        &mut self,
        ticket: SelectedTargetRead,
        status: SelectedStatus,
        value: Option<Arc<T>>,
    ) -> Result<bool, SelectedControlError> {
        if !self.accepts_target(&ticket)? {
            return Ok(false);
        }
        self.bump()?;
        self.target_active = None;
        self.target_loaded = Some(LoadedTarget {
            revision: ticket.revision,
            status,
            value,
        });
        self.target_container = Some(Arc::new(()));
        Ok(true)
    }
    pub fn reload_history(&mut self) -> Result<Option<SelectedHistoryRead>, SelectedControlError> {
        self.check()?;
        self.bump()?;
        self.history_sequence = self.advance(self.history_sequence)?;
        self.history_active = None;
        self.history_status = SelectedStatus::Loading;
        if !self.writers.is_empty() {
            return Ok(None);
        }
        self.history_active = Some(self.history_sequence);
        Ok(Some(SelectedHistoryRead {
            core: Arc::downgrade(&self.core),
            owner: self.owner.clone(),
            sequence: self.history_sequence,
            load_revision: self.history_revision,
        }))
    }
    pub fn resolve_history(
        &mut self,
        ticket: SelectedHistoryRead,
        value: Arc<H>,
    ) -> Result<bool, SelectedControlError> {
        self.finish_history(ticket, SelectedStatus::Ready, Some(value))
    }
    pub fn reject_history(
        &mut self,
        ticket: SelectedHistoryRead,
    ) -> Result<bool, SelectedControlError> {
        self.finish_history(ticket, SelectedStatus::Error, None)
    }
    /// Check before parsing a child raw body; completion repeats this check.
    pub fn accepts_history(
        &self,
        ticket: &SelectedHistoryRead,
    ) -> Result<bool, SelectedControlError> {
        self.ticket(&ticket.core, &ticket.owner)?;
        Ok(self.history_active == Some(ticket.sequence)
            && self.history_revision == ticket.load_revision)
    }
    fn finish_history(
        &mut self,
        ticket: SelectedHistoryRead,
        status: SelectedStatus,
        value: Option<Arc<H>>,
    ) -> Result<bool, SelectedControlError> {
        if !self.accepts_history(&ticket)? {
            return Ok(false);
        }
        self.bump()?;
        self.history_active = None;
        self.history_status = status;
        if let Some(value) = value {
            self.history = value;
        }
        Ok(true)
    }
    pub fn begin_history_write(&mut self) -> Result<SelectedHistoryWrite, SelectedControlError> {
        self.check()?;
        if self.writers.len() >= 32 {
            return Err(SelectedControlError::Capacity);
        }
        self.bump()?;
        self.writer_sequence = self.advance(self.writer_sequence)?;
        self.history_sequence = self.advance(self.history_sequence)?;
        self.history_active = None;
        self.history_status = SelectedStatus::Loading;
        self.writers.insert(self.writer_sequence);
        Ok(SelectedHistoryWrite {
            core: Arc::downgrade(&self.core),
            owner: self.owner.clone(),
            id: self.writer_sequence,
        })
    }
    /// Both successful and failed SQL writes run the original final readback rule.
    pub fn finish_history_write(
        &mut self,
        ticket: SelectedHistoryWrite,
    ) -> Result<Option<SelectedHistoryRead>, SelectedControlError> {
        self.ticket(&ticket.core, &ticket.owner)?;
        if !self.writers.remove(&ticket.id) {
            return Err(SelectedControlError::Replay);
        }
        self.bump()?;
        if self.writers.is_empty() {
            self.reload_history()
        } else {
            Ok(None)
        }
    }
    pub fn unmount(&mut self) -> Result<(), SelectedControlError> {
        self.check()?;
        self.bump()?;
        self.close();
        Ok(())
    }
    pub fn snapshot(&self) -> Result<SelectedControlSnapshot<B, H, T>, SelectedControlError> {
        self.check()?;
        let loaded_target_revision = self.target_loaded.as_ref().map(|loaded| loaded.revision);
        let loaded_target_status = self.target_loaded.as_ref().map(|loaded| loaded.status);
        let calculation_status = if !self.parent_ready
            || loaded_target_revision != Some(self.target_revision)
            || self.history_status == SelectedStatus::Loading
        {
            SelectedStatus::Loading
        } else if loaded_target_status == Some(SelectedStatus::Error)
            || self.history_status == SelectedStatus::Error
        {
            SelectedStatus::Error
        } else {
            SelectedStatus::Ready
        };
        Ok(SelectedControlSnapshot {
            current: Current {
                core: Arc::downgrade(&self.core),
                owner: self.owner.clone(),
                revision: Arc::downgrade(&self.publication),
                expected_revision: self.publication.load(Ordering::Acquire),
            },
            parent_ready: self.parent_ready,
            base: self.base.clone(),
            history: Arc::clone(&self.history),
            history_status: self.history_status,
            history_revision: self.history_revision,
            pending_history_writes: self.writers.len(),
            target_revision: self.target_revision,
            loaded_target_revision,
            loaded_target_status,
            loaded_target_identity: self.target_container.clone(),
            target: self
                .target_loaded
                .as_ref()
                .and_then(|loaded| loaded.value.clone()),
            calculation_status: (self.base.is_some() && self.target_available)
                .then_some(calculation_status),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{contract::OwnerIdentity, runtime::SnapshotRegistry};

    #[test]
    fn exhausted_counters_cannot_leave_a_publishable_partial_transition() {
        let registry = SnapshotRegistry::default();
        registry
            .reset_for_owner(&OwnerIdentity::new("selected-exhaustion", 1).unwrap())
            .unwrap();
        for target in [false, true] {
            let (mut state, _) = NativeSelectedLifecycle::<(), (), ()>::new(
                registry.utility_owner_marker().unwrap(),
                Arc::new(()),
                true,
            )
            .unwrap();
            if target {
                state.target_activation = u64::MAX;
            } else {
                state.history_sequence = u64::MAX;
            }
            let before = state.snapshot().unwrap();
            let result = if target {
                state.parent_ready(true).map(|_| ())
            } else {
                state.reload_history().map(|_| ())
            };
            assert_eq!(result, Err(SelectedControlError::SequenceExhausted));
            assert!(!before.is_current().unwrap());
            assert!(matches!(
                state.snapshot(),
                Err(SelectedControlError::Closed)
            ));
        }
    }
}
