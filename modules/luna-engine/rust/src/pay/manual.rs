use crate::{EngineError, calendar::month_range};
use serde_json::{Value, json};

pub fn create_manual_monthly_pay_estimate(month: &str, cents: i64) -> Result<Value, EngineError> {
    month_range(month)?;
    if !(0..=9_007_199_254_740_991).contains(&cents) {
        return Err(EngineError::InvalidMoney);
    }
    let amount = cents as f64 / 100.0;
    Ok(
        json!({"month":month,"tariffLabel":"Manuell hinterlegt","available":true,"fullTimeTableAmount":null,"personalBaseAmount":amount,"shiftBreakdowns":[],"timePremiumAmount":0,"overtimeAmount":0,"allowanceAmount":0,"tvoedAllowanceAmount":0,"careAllowanceAmount":0,"estimatedGrossAmount":amount,"assessment":{"shiftWork":"NOT_DETECTED","alternatingShiftWork":"NOT_DETECTED","suggestedAllowance":"NONE","evidence":[],"criteria":[],"requiresConfirmation":false},"confirmedAllowance":null}),
    )
}
