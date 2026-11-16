//! Small source-bound selectors and native proof locators, never ready evidence.
use super::ContractError;
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FinancialCollationLocator {
    token: u64,
    digest: String,
    locale_key: String,
}
impl FinancialCollationLocator {
    pub fn token(&self) -> u64 {
        self.token
    }
    pub fn digest(&self) -> &str {
        &self.digest
    }
    pub fn locale_key(&self) -> &str {
        &self.locale_key
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FinancialDetailsIntent {
    #[serde(deserialize_with = "filter_present")]
    filter: Option<String>,
    include_special_duty_pay: bool,
    collation: FinancialCollationLocator,
}
fn filter_present<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(d)
}
pub(super) fn optional<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<FinancialDetailsIntent>, D::Error> {
    FinancialDetailsIntent::deserialize(d).map(Some)
}
impl FinancialDetailsIntent {
    pub fn filter(&self) -> Option<&str> {
        self.filter.as_deref()
    }
    pub fn include_special_duty_pay(&self) -> bool {
        self.include_special_duty_pay
    }
    pub fn collation(&self) -> &FinancialCollationLocator {
        &self.collation
    }
    pub(super) fn validate(&self) -> Result<(), ContractError> {
        if self.filter.as_ref().is_some_and(|f| f.len() > 128)
            || self.collation.token == 0
            || self.collation.token > super::MAX_SAFE_REVISION
            || self.collation.locale_key.is_empty()
            || self.collation.locale_key.len() > 512
            || self.collation.locale_key.chars().any(char::is_control)
        {
            return Err(ContractError::InvalidRequest);
        }
        super::digest(&self.collation.digest)
    }
}

/// Public result metadata omits backend-private proof locators. Input serialization
/// remains complete for admission, and old requests keep their original bytes.
pub(crate) fn serialize_public_request<S: serde::Serializer>(
    request: &super::CalculationRequest,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeMap;
    if request.checks_details.is_some() {
        return super::checks_details::serialize_public_request(request, serializer);
    }
    if request.export_report.is_some() {
        return super::export_report::serialize_public_request(request, serializer);
    }
    let Some(details) = request.financial_details.as_ref() else {
        return request.serialize(serializer);
    };
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PublicIntent<'a> {
        filter: Option<&'a str>,
        include_special_duty_pay: bool,
    }
    let mut map = serializer.serialize_map(Some(6))?;
    map.serialize_entry("guard", &request.guard)?;
    map.serialize_entry("periods", &request.periods)?;
    map.serialize_entry("sections", &request.sections)?;
    map.serialize_entry("perspective", &request.perspective)?;
    map.serialize_entry("priority", &request.priority)?;
    map.serialize_entry(
        "financialDetails",
        &PublicIntent {
            filter: details.filter(),
            include_special_duty_pay: details.include_special_duty_pay(),
        },
    )?;
    map.end()
}
