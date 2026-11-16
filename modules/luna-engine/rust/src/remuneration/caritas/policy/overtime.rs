use super::{money, package, sum, working_rules};
use crate::{
    remuneration::{
        base::BaseError,
        caritas::{
            lookup::{care_table, rows, unavailable},
            overtime::source_ids,
            personal_base::text,
            reference::{integer, product},
        },
        context::model::NativePackageValidator,
    },
    rules::RulePackage,
};
use serde_json::{Value, json};
pub fn calculate(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    if !package(pkg, true, validator)? {
        return Ok(unavailable("INVALID_PACKAGE"));
    }
    let Some(policy) = pkg
        .rules()
        .get("caritasOvertimePolicy")
        .filter(|p| !p.is_null())
    else {
        return Ok(unavailable("MISSING_POLICY"));
    };
    let date = text(input, "date");
    if date < text(policy, "validFrom") || date > text(policy, "validTo") {
        return Ok(unavailable("OUTSIDE_VALIDITY"));
    }
    let Some(minutes) = integer(&input["minutes"]).filter(|m| (1..=1440).contains(m)) else {
        return Ok(unavailable("INVALID_MINUTES"));
    };
    if input["classification"] != "CONFIRMED_AVR_OVERTIME" {
        return Ok(unavailable(if input["classification"] == "NOT_OVERTIME" {
            "NOT_OVERTIME"
        } else {
            "CLASSIFICATION_UNCONFIRMED"
        }));
    }
    if !matches!(input["workSettlement"].as_str(), Some("CASH" | "TIME"))
        || !matches!(input["premiumSettlement"].as_str(), Some("CASH" | "TIME"))
    {
        return Ok(unavailable("SETTLEMENT_UNCONFIRMED"));
    }
    let step = text(input, "stepId");
    if step.len() != 1 || !(b'1'..=b'6').contains(&step.as_bytes()[0]) {
        return Ok(unavailable("MISSING_TABLE_VALUE"));
    }
    let variant = text(input, "variantId");
    let region = text(input, "regionId");
    let group = text(input, "groupId");
    let personal = care_table(pkg, date, variant, region, group, step, validator)?;
    if personal["kind"] == "unavailable" {
        return Ok(personal);
    }
    let cap = text(policy, "workPayMaximumStepId")
        .parse::<u8>()
        .map_err(|_| BaseError::InvalidCalculation)?;
    let capped = (step.as_bytes()[0] - b'0').min(cap).to_string();
    let work = if capped == step {
        personal
    } else {
        care_table(pkg, date, variant, region, group, &capped, validator)?
    };
    if work["kind"] == "unavailable" {
        return Ok(work);
    }
    let premium = care_table(
        pkg,
        date,
        variant,
        region,
        group,
        text(policy, "premiumReferenceStepId"),
        validator,
    )?;
    if premium["kind"] == "unavailable" {
        return Ok(premium);
    }
    let rate = rows(policy, "rateBands")
        .iter()
        .find(|r| rows(r, "groupIds").iter().any(|g| g == &work["groupId"]));
    let Some(rate) = rate else {
        return Ok(unavailable("MISSING_RATE"));
    };
    let times = working_rules(pkg, date, variant, region, false);
    if times.len() != 1 {
        return Ok(unavailable("MISSING_WORKING_TIME"));
    }
    let divisor = integer(&times[0]["fullTimeWeeklyMinutes"])
        .zip(integer(&policy["monthlyFactorThousandths"]))
        .and_then(|(a, b)| product(a, b));
    let work_hourly = money(
        integer(&work["monthlyCents"]).and_then(|n| product(n, 60_000)),
        divisor,
    )?;
    let premium_hourly = money(
        integer(&premium["monthlyCents"]).and_then(|n| product(n, 60_000)),
        divisor,
    )?;
    let points = integer(&rate["premiumBasisPoints"]).ok_or(BaseError::InvalidCalculation)?;
    let work_nominal = money(product(work_hourly, minutes), Some(60))?;
    let premium_nominal = money(
        product(premium_hourly, points).and_then(|n| product(n, minutes)),
        Some(600_000),
    )?;
    let work_cash = if input["workSettlement"] == "CASH" {
        work_nominal
    } else {
        0
    };
    let premium_cash = if input["premiumSettlement"] == "CASH" {
        premium_nominal
    } else {
        0
    };
    let positions = json!([{"component":"WORK_HOURS","settlement":input["workSettlement"],"minutes":minutes,"referenceHourlyCents":work_hourly,"percentageBasisPoints":10000,"nominalAmountCents":work_nominal,"cashAmountCents":work_cash},{"component":"OVERTIME_PREMIUM","settlement":input["premiumSettlement"],"minutes":minutes,"referenceHourlyCents":premium_hourly,"percentageBasisPoints":points,"nominalAmountCents":premium_nominal,"cashAmountCents":premium_cash}]);
    let basis_ids = source_ids(&work["sourceIds"], &premium["sourceIds"]);
    Ok(
        json!({"kind":"draft-confirmed-overtime","status":"estimated","cashSubtotalCents":sum([work_cash,premium_cash].into_iter()),"packageId":pkg.package_id,"versionId":pkg.version_id,"date":date,"sourceIds":source_ids(&basis_ids,&policy["sourceIds"]),"positions":positions}),
    )
}
