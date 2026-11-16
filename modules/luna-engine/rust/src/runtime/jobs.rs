//! Bounded request-arrival admission and cooperative worker scheduling.
//! Native hosts supply worker threads; Wasm hosts supply a dedicated worker.
use super::{
    CalculationLease, CalculationReservation, JobLane, PublicationPermit, RegistryError,
    SnapshotRegistry,
};
use crate::contract::{CalculationRequest, RequestPriority};
use std::collections::VecDeque;
use std::sync::{
    Arc, Mutex, Weak,
    atomic::{AtomicBool, AtomicU64, Ordering},
};

pub const MAX_PENDING_JOBS: usize = 12;
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FinancialDetailsAdmissionError {
    Pool(super::financial_collation::FinancialPoolError),
    Job(JobError),
}

static JOB_SEQUENCE: AtomicU64 = AtomicU64::new(0);
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobError {
    Capacity,
    Poisoned,
    SequenceExhausted,
    Registry(RegistryError),
}
impl From<RegistryError> for JobError {
    fn from(error: RegistryError) -> Self {
        Self::Registry(error)
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JobId(u64);
impl JobId {
    pub fn value(self) -> u64 {
        self.0
    }
    pub(crate) fn from_wire(value: u64) -> Option<Self> {
        (value > 0 && value <= crate::contract::MAX_SAFE_REVISION).then_some(Self(value))
    }
}
struct Pending {
    id: JobId,
    reservation: CalculationReservation,
    cancelled: Arc<AtomicBool>,
}
struct Running {
    id: JobId,
    priority: RequestPriority,
    cancelled: Arc<AtomicBool>,
}
#[derive(Default)]
struct State {
    pending: VecDeque<Pending>,
    finance: Option<Running>,
    checks: Option<Running>,
}
impl State {
    fn running(&self, lane: JobLane) -> &Option<Running> {
        match lane {
            JobLane::Finance => &self.finance,
            JobLane::Checks => &self.checks,
        }
    }
    fn running_mut(&mut self, lane: JobLane) -> &mut Option<Running> {
        match lane {
            JobLane::Finance => &mut self.finance,
            JobLane::Checks => &mut self.checks,
        }
    }
}
/// Pending work owns only checked snapshot leases, never host-computed results.
/// Admission does not parse source records, calculate, serialize or drop owners.
#[derive(Clone)]
pub struct JobScheduler {
    state: Arc<Mutex<State>>,
    registry: SnapshotRegistry,
}
impl JobScheduler {
    pub fn new(registry: SnapshotRegistry) -> Self {
        Self {
            state: Arc::new(Mutex::new(State::default())),
            registry,
        }
    }
    pub fn admit_financial_details(
        &self,
        request: CalculationRequest,
        pool: &super::financial_collation::FinancialCollationPool,
    ) -> Result<JobId, FinancialDetailsAdmissionError> {
        let proof = pool
            .admission_for_request(&request)
            .map_err(FinancialDetailsAdmissionError::Pool)?;
        self.admit_checked(request, JobLane::Finance, Some(proof))
            .map_err(FinancialDetailsAdmissionError::Job)
    }
    pub fn admit(&self, request: CalculationRequest, lane: JobLane) -> Result<JobId, JobError> {
        self.admit_checked(request, lane, None)
    }
    fn admit_checked(
        &self,
        request: CalculationRequest,
        lane: JobLane,
        proof: Option<Arc<super::financial_collation::FinancialAdmissionProof>>,
    ) -> Result<JobId, JobError> {
        let mut state = self.state.lock().map_err(|_| JobError::Poisoned)?;
        if state.pending.len() >= MAX_PENDING_JOBS {
            return Err(JobError::Capacity);
        }
        let previous = JOB_SEQUENCE
            .try_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
                current
                    .checked_add(1)
                    .filter(|next| *next <= crate::contract::MAX_SAFE_REVISION)
            })
            .map_err(|_| JobError::SequenceExhausted)?;
        let priority = request.priority();
        // The publication reservation is made on arrival, before queueing.
        // A full queue leaves all previously accepted writer slots unchanged.
        let reservation = match proof {
            Some(proof) => self
                .registry
                .reserve_with_financial_details(request, lane, proof)?,
            None => self.registry.reserve(request, lane)?,
        };
        let id = JobId(previous + 1);
        if priority == RequestPriority::Interactive
            && let Some(running) = state
                .running(lane)
                .as_ref()
                .filter(|r| r.priority == RequestPriority::Background)
        {
            running.cancelled.store(true, Ordering::Release);
        }
        state.pending.push_back(Pending {
            id,
            reservation,
            cancelled: Arc::new(AtomicBool::new(false)),
        });
        Ok(id)
    }
    /// Tiny cancellation fence. Owner/input destruction is left to a worker.
    pub fn cancel(&self, id: JobId) -> Result<bool, JobError> {
        let state = self.state.lock().map_err(|_| JobError::Poisoned)?;
        let flag = state
            .pending
            .iter()
            .find(|p| p.id == id)
            .map(|p| &p.cancelled)
            .or_else(|| {
                state
                    .finance
                    .as_ref()
                    .filter(|r| r.id == id)
                    .map(|r| &r.cancelled)
            })
            .or_else(|| {
                state
                    .checks
                    .as_ref()
                    .filter(|r| r.id == id)
                    .map(|r| &r.cancelled)
            });
        Ok(flag.is_some_and(|f| !f.swap(true, Ordering::AcqRel)))
    }
    /// Worker-only: at most one active work item per independent lane. Stale
    /// items are released outside the queue lock, including their final owner.
    pub fn next(&self, lane: JobLane) -> Result<Option<Work>, JobError> {
        self.next_with_skipped(lane).map(|(work, _)| work)
    }
    /// Report discarded handles so a transport can settle every old promise.
    /// One pull examines at most the bounded queue capacity, even under churn.
    pub fn next_with_skipped(&self, lane: JobLane) -> Result<(Option<Work>, Vec<JobId>), JobError> {
        let mut skipped = Vec::new();
        for _ in 0..MAX_PENDING_JOBS {
            let pending = {
                let mut state = self.state.lock().map_err(|_| JobError::Poisoned)?;
                if state.running(lane).is_some() {
                    return Ok((None, skipped));
                }
                let index = state
                    .pending
                    .iter()
                    .position(|p| {
                        p.reservation.lane() == lane
                            && p.reservation.request().priority() == RequestPriority::Interactive
                    })
                    .or_else(|| {
                        state
                            .pending
                            .iter()
                            .position(|p| p.reservation.lane() == lane)
                    });
                let Some(index) = index else {
                    return Ok((None, skipped));
                };
                let pending = state.pending.remove(index).expect("located pending item");
                *state.running_mut(lane) = Some(Running {
                    id: pending.id,
                    priority: pending.reservation.request().priority(),
                    cancelled: pending.cancelled.clone(),
                });
                pending
            };
            let Pending {
                id,
                reservation,
                cancelled,
            } = pending;
            let lease = match self.registry.acquire(reservation) {
                Ok(lease) => lease,
                Err(error) => {
                    let mut state = self.state.lock().map_err(|_| JobError::Poisoned)?;
                    if state.running(lane).as_ref().is_some_and(|r| r.id == id) {
                        *state.running_mut(lane) = None;
                    }
                    drop(state);
                    if error == RegistryError::MissingSnapshot {
                        skipped.push(id);
                        continue;
                    }
                    return Err(error.into());
                }
            };
            let work = Work {
                scheduler: Arc::downgrade(&self.state),
                registry: self.registry.clone(),
                id,
                lease,
                cancelled,
            };
            if work.is_current()? {
                return Ok((Some(work), skipped));
            }
            skipped.push(id);
            drop(work);
        }
        Ok((None, skipped))
    }
    pub fn counts(&self) -> Result<(usize, usize), JobError> {
        let state = self.state.lock().map_err(|_| JobError::Poisoned)?;
        Ok((
            state.pending.len(),
            usize::from(state.finance.is_some()) + usize::from(state.checks.is_some()),
        ))
    }
}
/// Opaque worker ownership. Kernels check `is_current` between bounded units;
/// the final publication permit is separately fenced after all computation.
pub struct Work {
    scheduler: Weak<Mutex<State>>,
    registry: SnapshotRegistry,
    id: JobId,
    lease: CalculationLease,
    cancelled: Arc<AtomicBool>,
}
impl Work {
    pub fn id(&self) -> JobId {
        self.id
    }
    pub fn lease(&self) -> &CalculationLease {
        &self.lease
    }
    pub fn is_current(&self) -> Result<bool, JobError> {
        Ok(!self.cancelled.load(Ordering::Acquire) && self.registry.is_current(&self.lease)?)
    }
    pub fn finish(self) -> Result<Option<PublicationPermit>, JobError> {
        let Some(scheduler) = self.scheduler.upgrade() else {
            return Ok(None);
        };
        let state = scheduler.lock().map_err(|_| JobError::Poisoned)?;
        let owns = state
            .running(self.lease.lane())
            .as_ref()
            .is_some_and(|r| r.id == self.id && !r.cancelled.load(Ordering::Acquire));
        let result = if owns {
            self.registry.complete(&self.lease).map_err(JobError::from)
        } else {
            Ok(None)
        };
        drop(state);
        result
    }
}
impl Drop for Work {
    fn drop(&mut self) {
        if let Some(scheduler) = self.scheduler.upgrade()
            && let Ok(mut state) = scheduler.lock()
        {
            let slot = state.running_mut(self.lease.lane());
            if slot.as_ref().is_some_and(|r| r.id == self.id) {
                *slot = None;
            }
        }
        // The lease and any large final snapshot owner drop after the lock.
    }
}
