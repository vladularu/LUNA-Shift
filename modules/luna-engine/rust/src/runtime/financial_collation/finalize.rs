//! Financial namespace adapter over the shared direct-to-native rank parser.
use super::{
    book::{Draft, Ranked},
    model::FinancialPoolError,
};
use crate::runtime::collation_ranks::{self, Namespace, ParseError};
pub(super) fn parse(raw: &[u8], draft: &Draft) -> Result<Ranked, FinancialPoolError> {
    let parsed = collation_ranks::parse(
        raw,
        &draft.owner.index.strings,
        Namespace::Financial,
        || draft.check(),
    )
    .map_err(|error| match error {
        ParseError::InputTooLarge => crate::contract::ContractError::InputTooLarge.into(),
        ParseError::InvalidRanks => FinancialPoolError::InvalidRanks,
        ParseError::Fence(error) => error,
    })?;
    Ok(Ranked {
        ranks: parsed.ranks,
        digest: parsed.digest,
        bytes: parsed.bytes,
    })
}
