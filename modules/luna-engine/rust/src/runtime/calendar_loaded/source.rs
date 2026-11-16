use super::{
    controller::CalendarLoadedPool,
    quota::{RawPermit, SourceCharge},
    rank::{self, Candidates},
    types::*,
};
use crate::calendar::loaded_scope::{RawScopeRows, ScopeLoadCompletion, ScopeLoadFailure};
use std::sync::{Arc, atomic::Ordering};
fn stage(ticket: &CalendarLoadTicket, from: u8, to: u8) -> Result<(), LoadedPoolError> {
    ticket
        .stage
        .compare_exchange(from, to, Ordering::AcqRel, Ordering::Acquire)
        .map(|_| ())
        .map_err(|_| LoadedPoolError::Replay)
}
impl CalendarLoadedPool {
    pub fn reserve_source(
        &self,
        ticket: &CalendarLoadTicket,
    ) -> Result<LoadedRawIntake, LoadedPoolError> {
        self.run(|state| {
            self.check_ticket(state, ticket)?;
            let raw = RawPermit::acquire(&self.raw)?;
            let slot = self.quota.source()?;
            let draft_slot = self.quota.draft()?;
            stage(ticket, 0, 1)?;
            Ok(LoadedRawIntake {
                ticket: ticket.clone(),
                slot,
                draft_slot,
                _raw: raw,
            })
        })
    }
    pub fn prepare_query(
        &self,
        intake: LoadedRawIntake,
        raw: Arc<RawScopeRows>,
    ) -> Result<LoadedQueryDraft, LoadedPoolError> {
        self.run(|state| {
            self.check_ticket(state, &intake.ticket)?;
            stage(&intake.ticket, 1, 2)?;
            let slot = intake.draft_slot;
            let prepared = raw.prepare(&intake.ticket.range)?;
            let candidates = Candidates::new(prepared.collation_candidates(), b"QUERY")?;
            state.charges.push(Arc::new(SourceCharge {
                raw: Arc::downgrade(&raw),
                _slot: intake.slot,
            }));
            Ok(LoadedQueryDraft {
                ticket: intake.ticket,
                prepared,
                candidates,
                slot,
                charges: state.charges.clone(),
            })
        })
    }
    pub fn finish_query(
        &self,
        draft: LoadedQueryDraft,
        raw_ranks: &[u8],
    ) -> Result<LoadedCompletionDraft, LoadedPoolError> {
        self.run(|state| {
            self.check_ticket(state, &draft.ticket)?;
            if draft.ticket.stage.load(Ordering::Acquire) != 2 {
                return Err(LoadedPoolError::Replay);
            }
            let ranks = rank::parse(raw_ranks, &draft.candidates, true, || {
                self.check_ticket(state, &draft.ticket)
            })?;
            let loaded = draft.prepared.finish(&ranks)?;
            let prepared = state
                .scope
                .prepare_completion(draft.ticket.load, Ok(loaded), None)?;
            let candidates = Candidates::new(prepared.collation_candidates(), b"COMPLETION")?;
            // Reuse only the exact native full set under the same ticket and
            // platform identity. Independently ranked subsets are never merged.
            let verified_ranks = (candidates.values == draft.candidates.values).then_some(ranks);
            self.check_ticket(state, &draft.ticket)?;
            stage(&draft.ticket, 2, 3)?;
            Ok(LoadedCompletionDraft {
                ticket: draft.ticket,
                prepared,
                candidates,
                _slot: draft.slot,
                charges: draft.charges,
                success: true,
                verified_ranks,
            })
        })
    }
    pub fn prepare_failure(
        &self,
        ticket: &CalendarLoadTicket,
        failure: ScopeLoadFailure,
    ) -> Result<LoadedCompletionDraft, LoadedPoolError> {
        self.run(|state| {
            self.check_ticket(state, ticket)?;
            let slot = self.quota.draft()?;
            let previous = ticket.stage.load(Ordering::Acquire);
            if previous >= 3 {
                return Err(LoadedPoolError::Replay);
            }
            stage(ticket, previous, 3)?;
            let prepared = state
                .scope
                .prepare_completion(ticket.load, Err(failure), None)?;
            let candidates = Candidates::new(prepared.collation_candidates(), b"COMPLETION")?;
            Ok(LoadedCompletionDraft {
                ticket: ticket.clone(),
                prepared,
                candidates,
                _slot: slot,
                charges: state.charges.clone(),
                success: false,
                verified_ranks: None,
            })
        })
    }
    pub fn finalize(
        &self,
        draft: LoadedCompletionDraft,
        raw_ranks: &[u8],
    ) -> Result<LoadedSnapshot, LoadedPoolError> {
        self.run(|state| {
            self.check_ticket(state, &draft.ticket)?;
            if draft.ticket.stage.load(Ordering::Acquire) != 3 {
                return Err(LoadedPoolError::Replay);
            }
            let ranks = rank::parse(raw_ranks, &draft.candidates, false, || {
                self.check_ticket(state, &draft.ticket)
            })?;
            self.publish(state, draft, &ranks)
        })
    }
    pub fn finalize_cached(
        &self,
        draft: LoadedCompletionDraft,
    ) -> Result<LoadedSnapshot, LoadedPoolError> {
        self.run(|state| {
            self.check_ticket(state, &draft.ticket)?;
            if draft.ticket.stage.load(Ordering::Acquire) != 3 {
                return Err(LoadedPoolError::Replay);
            }
            let ranks = draft
                .verified_ranks
                .as_ref()
                .ok_or(LoadedPoolError::InvalidRanks)?
                .clone();
            self.publish(state, draft, &ranks)
        })
    }
    fn publish(
        &self,
        state: &mut super::controller::OwnerState,
        draft: LoadedCompletionDraft,
        ranks: &crate::calendar::recurrence::CollationRanks,
    ) -> Result<LoadedSnapshot, LoadedPoolError> {
        self.check_ticket(state, &draft.ticket)?;
        stage(&draft.ticket, 3, 4)?;
        let published = state.scope.finish_completion(draft.prepared, ranks)?;
        state.pending.remove(&draft.ticket.load);
        if published == ScopeLoadCompletion::Published {
            state.bump()?;
            if draft.success {
                state.published_token = Some(state.token.clone());
            }
        }
        // A replaced baseline can have died during finish_completion. Do not
        // attach its obsolete reservation to the new output's lifetime.
        state.charges.retain(|source| source.raw.strong_count() > 0);
        let result = self.snapshot_for(state);
        drop(draft.charges);
        Ok(result)
    }
}
