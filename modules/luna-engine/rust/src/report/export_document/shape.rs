//! Object-spread insertion order in the original report return objects. Numeric
//! results remain untouched; raw profile and calendar property order is retained.
use serde_json::Value;
pub(super) fn order(value: &mut Value, keys: &[&str]) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    let mut source = std::mem::take(object);
    for &key in keys {
        if let Some(v) = source.shift_remove(key) {
            object.insert(key.into(), v);
        }
    }
    object.extend(source);
}
pub(super) fn summary(value: &mut Value) {
    order(
        value,
        &[
            "month",
            "specialDutyNotes",
            "timeAccountMinutes",
            "specialDutyTimeCredits",
            "targetMinutes",
            "targetCalculation",
            "actualMinutes",
            "balanceMinutes",
            "overlapMinutes",
            "work",
            "training",
            "vacation",
            "sick",
            "free",
        ],
    );
    if let Some(adjustments) = value["targetCalculation"]["adjustments"].as_array_mut() {
        for item in adjustments {
            order(
                item,
                &[
                    "date",
                    "kind",
                    "label",
                    "ruleId",
                    "legalBasis",
                    "sourceUrl",
                    "condition",
                    "status",
                    "minutes",
                ],
            );
        }
    }
}
pub(super) fn shift_stats(value: &mut Value, annual: bool) {
    order(
        value,
        if annual {
            &[
                "groups",
                "appearances",
                "items",
                "totalCount",
                "totalMinutes",
            ]
        } else {
            &[
                "items",
                "groups",
                "appearances",
                "totalCount",
                "totalMinutes",
            ]
        },
    );
}
pub(super) fn checks(value: &mut Value) {
    if let Some(weekends) = value.get_mut("weekendAssessment") {
        order(
            weekends,
            &[
                "policyVersion",
                "month",
                "weekends",
                "totalCount",
                "freeCount",
                "occupiedCount",
                "unknownCount",
                "windows",
            ],
        );
        if let Some(windows) = weekends["windows"].as_array_mut() {
            for w in windows {
                order(
                    w,
                    &[
                        "from",
                        "until",
                        "weekends",
                        "freeCount",
                        "occupiedCount",
                        "unknownCount",
                        "assessmentComplete",
                    ],
                );
            }
        }
    }
}
pub(super) fn annual(value: &mut Value) {
    if let Some(pairs) = value["distribution"].as_array() {
        let mut map = serde_json::Map::new();
        for p in pairs {
            if let Some(key) = p[0].as_str() {
                map.insert(key.into(), p[1].clone());
            }
        }
        value["distribution"] = Value::Object(map);
    }
    if value.get("targetStatus").is_none() {
        value["targetStatus"] = Value::Null;
    }
    order(
        value,
        &[
            "year",
            "shiftTypeAnalysis",
            "months",
            "targetMinutes",
            "actualMinutes",
            "balanceMinutes",
            "workMinutes",
            "trainingMinutes",
            "vacationDays",
            "sickDays",
            "freeDays",
            "entryCount",
            "activeMonthCount",
            "availablePayMonthCount",
            "estimatedGrossAmount",
            "premiumAmount",
            "overtimeAmount",
            "allowanceAmount",
            "criticalCount",
            "warningCount",
            "distribution",
            "worktimeCoverageComplete",
            "complianceCoverageComplete",
            "salarySource",
            "targetStatus",
            "timeAccountMinutes",
        ],
    );
    shift_stats(&mut value["shiftTypeAnalysis"], true);
    if let Some(months) = value["months"].as_array_mut() {
        for m in months {
            if m.get("targetStatus").is_none() {
                m["targetStatus"] = Value::Null;
            }
            order(
                m,
                &[
                    "month",
                    "entryCount",
                    "targetMinutes",
                    "actualMinutes",
                    "balanceMinutes",
                    "estimatedGrossAmount",
                    "timePremiumAmount",
                    "premiumAmount",
                    "criticalCount",
                    "warningCount",
                    "complianceComplete",
                    "trainingTimeDays",
                    "targetStatus",
                    "timeAccountMinutes",
                    "infoCount",
                    "prerequisiteCount",
                    "tariffPrerequisiteCount",
                    "scopeCount",
                    "checkCounts",
                ],
            );
        }
    }
}
pub(super) fn forecast(value: &mut Value) {
    if let Some(amounts) = value
        .get_mut("result")
        .and_then(|v| v.get_mut("pay"))
        .and_then(|v| v.get_mut("amounts"))
    {
        order(
            amounts,
            &[
                "grossCents",
                "taxableGrossCents",
                "socialInsuranceGrossCents",
                "regularMonthlySocialInsuranceGrossCents",
            ],
        );
    }
}
