use crate::remuneration::{
    allowances::model::{SupplementPosition, SupplementResult},
    annual::model::{AnnualPosition, AnnualResult},
    assessment::model::AllowanceAssessment,
    base::model::{BasePosition, MonthlyBase, RemunerationStatus},
    premiums::model::{TimeRemunerationPosition, TimeRemunerationResult},
};
use serde::{
    Serialize, Serializer,
    ser::{SerializeSeq, SerializeStruct},
};
pub struct MonthlyRemuneration<'a> {
    pub month: String,
    pub complete: bool,
    pub status: RemunerationStatus,
    pub known_subtotal_cents: i64,
    pub estimated_gross_cents: Option<i64>,
    pub base: MonthlyBase<'a>,
    pub time_premiums: TimeRemunerationResult<'a>,
    pub allowances: SupplementResult<'a>,
    pub overtime: SupplementResult<'a>,
    pub annual_payments: AnnualResult<'a>,
}
#[derive(Serialize)]
#[serde(untagged)]
pub enum MonthlyPositionRef<'result, 'source> {
    Base(&'result BasePosition<'source>),
    Time(&'result TimeRemunerationPosition<'source>),
    Supplement(&'result SupplementPosition<'source>),
    Annual(&'result AnnualPosition<'source>),
}
impl<'source> MonthlyRemuneration<'source> {
    pub fn positions(&self) -> impl Iterator<Item = MonthlyPositionRef<'_, 'source>> {
        self.base
            .positions
            .iter()
            .map(MonthlyPositionRef::Base)
            .chain(
                self.time_premiums
                    .positions
                    .iter()
                    .map(MonthlyPositionRef::Time),
            )
            .chain(
                self.allowances
                    .positions
                    .iter()
                    .map(MonthlyPositionRef::Supplement),
            )
            .chain(
                self.overtime
                    .positions
                    .iter()
                    .map(MonthlyPositionRef::Supplement),
            )
            .chain(
                self.annual_payments
                    .positions
                    .iter()
                    .map(MonthlyPositionRef::Annual),
            )
    }
}
struct Positions<'result, 'source>(&'result MonthlyRemuneration<'source>);
impl Serialize for Positions<'_, '_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let m = self.0;
        let count = m.base.positions.len()
            + m.time_premiums.positions.len()
            + m.allowances.positions.len()
            + m.overtime.positions.len()
            + m.annual_payments.positions.len();
        let mut seq = serializer.serialize_seq(Some(count))?;
        for position in m.positions() {
            seq.serialize_element(&position)?;
        }
        seq.end()
    }
}
impl Serialize for MonthlyRemuneration<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("MonthlyRemuneration", 11)?;
        s.serialize_field("month", &self.month)?;
        s.serialize_field("complete", &self.complete)?;
        s.serialize_field("status", &self.status)?;
        s.serialize_field("knownSubtotalCents", &self.known_subtotal_cents)?;
        s.serialize_field("estimatedGrossCents", &self.estimated_gross_cents)?;
        s.serialize_field("base", &self.base)?;
        s.serialize_field("timePremiums", &self.time_premiums)?;
        s.serialize_field("allowances", &self.allowances)?;
        s.serialize_field("overtime", &self.overtime)?;
        s.serialize_field("annualPayments", &self.annual_payments)?;
        s.serialize_field("positions", &Positions(self))?;
        s.end()
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssessedMonthlyRemuneration<'a> {
    #[serde(flatten)]
    pub remuneration: MonthlyRemuneration<'a>,
    pub allowance_assessment: AllowanceAssessment<'a>,
}
