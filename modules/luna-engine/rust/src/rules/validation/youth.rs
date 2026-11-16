use super::{ValidationIssue, common::*};
use serde_json::Value;
fn incomplete_exam(exam: &Value) -> bool {
    [
        "releaseRequiredOutsideParticipation",
        "releasePrecedingWrittenFinalWorkday",
        "creditParticipationBreaksNecessaryTravel",
        "creditPrecedingAverageDay",
    ]
    .into_iter()
    .any(|key| exam[key] != true)
}
fn fail(issues: &mut Vec<ValidationIssue>, code: &str, suffix: &str, message: &str) {
    issue(
        issues,
        code,
        format!("/rules/youthProtection{suffix}"),
        message,
    );
}
pub(super) fn issues(package: &Value) -> Vec<ValidationIssue> {
    let mut issues = vec![];
    let body = &package["rules"];
    let rules = body.get("youthProtection");
    let adult = body.get("adultTraining");
    let version = n(package, "engineContractVersion");
    if version >= 9.0 && adult.is_none() {
        issue(
            &mut issues,
            "MISSING_TRAINING_RULES",
            "/rules/adultTraining",
            "Legal contract v9 requires explicit adult training rules.",
        );
    }
    if let Some(adult) = adult {
        if version < 9.0 {
            issue(
                &mut issues,
                "UNSUPPORTED_TRAINING_RULES",
                "/rules/adultTraining",
                "Adult training rules require contract v9.",
            );
        }
        if rules.is_none_or(|youth| adult["minimumAge"] != youth["adultAge"])
            || n(&adult["bbig"]["school"], "blockLessonCount")
                < n(&adult["bbig"]["school"], "protectedDayLessonCount")
        {
            issue(
                &mut issues,
                "INCONSISTENT_TRAINING_RULES",
                "/rules/adultTraining",
                "Adult eligibility or school thresholds are inconsistent.",
            );
        }
        let exam = adult["bbig"].get("exam");
        if version >= 10.0 && exam.is_none() {
            issue(
                &mut issues,
                "MISSING_BBIG_EXAM_RULES",
                "/rules/adultTraining/bbig/exam",
                "Legal contract v10 requires explicit BBiG exam rules.",
            );
        }
        if version < 10.0 && exam.is_some() {
            issue(
                &mut issues,
                "UNSUPPORTED_BBIG_EXAM_RULES",
                "/rules/adultTraining/bbig/exam",
                "BBiG exam rules require legal contract v10.",
            );
        }
        if exam.is_some_and(incomplete_exam) {
            issue(
                &mut issues,
                "INCOMPLETE_BBIG_EXAM_RULES",
                "/rules/adultTraining/bbig/exam",
                "The § 15 BBiG exam contract is incomplete.",
            );
        }
        if version >= 10.0 && adult["pflbg"]["examRelease"] != true {
            issue(
                &mut issues,
                "MISSING_PFLBG_EXAM_RELEASE",
                "/rules/adultTraining/pflbg/examRelease",
                "Legal contract v10 requires explicit PflBG exam release.",
            );
        }
        if version < 10.0 && adult["pflbg"].get("examRelease").is_some() {
            issue(
                &mut issues,
                "UNSUPPORTED_PFLBG_EXAM_RELEASE",
                "/rules/adultTraining/pflbg/examRelease",
                "PflBG exam release requires legal contract v10.",
            );
        }
    }
    let Some(rules) = rules else {
        if version >= 9.0 {
            fail(
                &mut issues,
                "MISSING_YOUTH_RULES",
                "",
                "Legal contract v9 requires youth rules.",
            );
        }
        return issues;
    };
    if version < 9.0 {
        fail(
            &mut issues,
            "UNSUPPORTED_YOUTH_RULES",
            "",
            "Youth rules require legal contract v9.",
        );
    }
    let exam = rules.get("exam");
    if version >= 10.0 && exam.is_none() {
        fail(
            &mut issues,
            "MISSING_YOUTH_EXAM_RULES",
            "/exam",
            "Legal contract v10 requires exam rules.",
        );
    }
    if version < 10.0 && exam.is_some() {
        fail(
            &mut issues,
            "UNSUPPORTED_YOUTH_EXAM_RULES",
            "/exam",
            "Exam rules require legal contract v10.",
        );
    }
    if exam.is_some_and(incomplete_exam) {
        fail(
            &mut issues,
            "INCOMPLETE_YOUTH_EXAM_RULES",
            "/exam",
            "The § 10 exam contract is incomplete.",
        );
    }
    if n(rules, "minimumAge") >= n(rules, "adultAge") {
        fail(
            &mut issues,
            "INVALID_YOUTH_AGES",
            "",
            "Minimum youth age must precede adulthood.",
        );
    }
    let work = &rules["workingTime"];
    let window = &rules["employmentWindow"];
    if n(work, "reducedWeekDailyMinutes") < n(work, "dailyMinutes")
        || n(work, "shiftSpanMinutes") < n(work, "reducedWeekDailyMinutes")
        || n(work, "weeklyMinutes") < n(work, "dailyMinutes")
    {
        fail(
            &mut issues,
            "INVALID_YOUTH_WORK_LIMITS",
            "/workingTime",
            "Youth work duration limits are inconsistent.",
        );
    }
    if n(window, "startMinute") >= n(window, "endMinute")
        || n(window, "multiShiftEndMinute") < n(window, "endMinute")
        || n(window, "multiShiftMinimumAge") < n(rules, "minimumAge")
        || n(window, "multiShiftMinimumAge") >= n(rules, "adultAge")
    {
        fail(
            &mut issues,
            "INVALID_YOUTH_EMPLOYMENT_WINDOW",
            "/employmentWindow",
            "Youth employment windows or age limits are inconsistent.",
        );
    }
    let (mut threshold, mut required) = (-1.0, -1.0);
    for (i, tier) in a(&rules["breaks"]["tiers"]).iter().enumerate() {
        if n(tier, "overMinutes") <= threshold
            || n(tier, "requiredMinutes") < required
            || n(tier, "requiredMinutes") < n(&rules["breaks"], "minimumSegmentMinutes")
        {
            fail(
                &mut issues,
                "INVALID_YOUTH_BREAK_TIERS",
                &format!("/breaks/tiers/{i}"),
                "Youth break thresholds must increase and required breaks must not decrease.",
            );
        }
        threshold = n(tier, "overMinutes");
        required = n(tier, "requiredMinutes");
    }
    for field in ["absoluteFixedHolidays", "shortEveDays"] {
        for (i, date) in a(&rules["daysOff"][field]).iter().enumerate() {
            if format!("2000-{}", date.as_str().unwrap_or(""))
                .parse::<jiff::civil::Date>()
                .is_err()
            {
                fail(
                    &mut issues,
                    "INVALID_YOUTH_CALENDAR_DATE",
                    &format!("/daysOff/{field}/{i}"),
                    "Invalid recurring calendar date.",
                );
            }
        }
    }
    if n(&rules["school"], "blockLessonCount") < n(&rules["school"], "protectedDayLessonCount") {
        fail(
            &mut issues,
            "INVALID_YOUTH_SCHOOL_COUNTS",
            "/school",
            "Block lesson threshold must not be smaller than the protected day threshold.",
        );
    }
    issues
}
