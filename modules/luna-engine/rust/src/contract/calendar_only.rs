//! Deserializable locators are not native source/admission proofs.
use crate::contract::{ContractError, MAX_SAFE_REVISION, OwnerIdentity};
use serde::{Deserialize, Serialize};
macro_rules! identity {
    ($name:ident,$tag:ident,$variant:ident,$digest:ident) => {
        #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        pub struct $name {
            kind: $tag,
            owner_scope: String,
            owner_epoch: u64,
            source_revision: u64,
            $digest: String,
        }
        #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
        #[serde(rename_all = "SCREAMING_SNAKE_CASE")]
        enum $tag {
            $variant,
        }
        impl $name {
            pub(crate) fn new(
                owner: &OwnerIdentity,
                source_revision: u64,
                digest: &str,
            ) -> Result<Self, ContractError> {
                let result = Self {
                    kind: $tag::$variant,
                    owner_scope: owner.scope().into(),
                    owner_epoch: owner.epoch(),
                    source_revision,
                    $digest: digest.into(),
                };
                result.validate()?;
                Ok(result)
            }
            pub fn validate(&self) -> Result<(), ContractError> {
                OwnerIdentity::new(&self.owner_scope, self.owner_epoch)?;
                if self.source_revision > MAX_SAFE_REVISION {
                    return Err(ContractError::InvalidRevision);
                }
                if self.$digest.len() == 64
                    && self
                        .$digest
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                {
                    Ok(())
                } else {
                    Err(ContractError::InvalidDigest)
                }
            }
            pub fn owner_scope(&self) -> &str {
                &self.owner_scope
            }
            pub fn owner_epoch(&self) -> u64 {
                self.owner_epoch
            }
            pub fn source_revision(&self) -> u64 {
                self.source_revision
            }
            pub fn digest(&self) -> &str {
                &self.$digest
            }
        }
    };
}
identity!(CalendarRowIdentity, RowKind, CalendarRows, source_digest);
identity!(
    CalendarClockIdentity,
    ClockKind,
    CalendarClock,
    source_clock_key
);
