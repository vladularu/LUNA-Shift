type NativeEngineSqlSourceKind = keyof typeof NATIVE_ENGINE_SOURCE_SQL;
// Original storage projections only. Validation, normalization, selection of
// effective profiles and every calculation remain in the native source factory.
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const columns = (value: string) => value.split(",");
const CHUNK_CHARACTERS = 16_000;
function chunks(column: string) {
  // SQLite substr counts code points: <=16,000 characters fit in64KiB UTF-8.
  // Literal NUL must not let SQLite length/substr silently drop a JSON suffix.
  return `json(CASE WHEN instr(${column},char(0))>0 THEN json_array(${column}) ELSE (
    WITH RECURSIVE parts(pos,part) AS (
      SELECT 1,substr(${column},1,${CHUNK_CHARACTERS})
      UNION ALL SELECT pos+${CHUNK_CHARACTERS},substr(${column},pos+${CHUNK_CHARACTERS},${CHUNK_CHARACTERS})
        FROM parts WHERE pos+${CHUNK_CHARACTERS}<=length(${column})
    ) SELECT json_group_array(part) FROM parts) END)`;
}
function object(fields: readonly string[], chunked: readonly string[] = []) {
  return `json_object(${fields
    .flatMap((field) => {
      const column = "t." + quote(field);
      return chunked.includes(field)
        ? [
            `CASE WHEN ${column} IS NULL THEN ${literal(field)} ELSE ${literal(field + "_chunks")} END`,
            `CASE WHEN ${column} IS NULL THEN NULL ELSE ${chunks(column)} END`,
          ]
        : [literal(field), column];
    })
    .join(",")})`;
}
function rows(
  table: string,
  fields: string,
  order: string,
  where = "1",
  chunked: readonly string[] = [],
) {
  return `SELECT ${object(columns(fields), chunked)} AS encoded FROM ${quote(table)} t WHERE ${where} ORDER BY ${order}`;
}
function array(select: string) {
  return `(SELECT json_group_array(json(encoded)) FROM (${select}))`;
}
const SHIFT =
  "special_duty_json,id,date,template_id,title,type,all_day,start_time,end_time,break_minutes,color,symbol,note,notification_json,alarm_enabled,location_json,overtime_minutes,tariff_overtime_confirmed,holiday_premium_mode,revision,created_at,updated_at,deleted_at";
const APPOINTMENT =
  "id,date,title,all_day,start_time,end_time,color,note,recurrence_frequency,recurrence_interval,notification_json,location_json,revision,created_at,updated_at,deleted_at";
const PROFILE =
  "display_name,employer_name,federal_state,holiday_region,weekly_minutes,time_zone,industry,manual_monthly_gross_cents,pay_group,pay_level,tariff_sector,tariff_region,full_time_weekly_minutes,regular_rotating_night_work,sunday_holiday_work_eligible,all_employment_work_recorded,created_at,updated_at";
const SALARY_KEYS = [
  "salary_tval_pflege",
  "simpleSalary.tvhKr",
  "salary_tvuk_nursing",
  "salary_nursing_training",
  "salary_vka_e",
  "salary_tvl_kr",
];
const salary = rows(
  "app_preferences",
  "key,value",
  "t.key",
  `t.key IN (${SALARY_KEYS.map(literal).join(",")})`,
);
const profile = `SELECT json_object('profileRow',json(encoded),'salaryRows',json(${array(salary)})) AS encoded FROM (${rows("user_profile", PROFILE, "t.id", "t.id='singleton'")})`;
const calendar = `SELECT json_object(
  'shiftRows',json(${array(rows("shift_entries", SHIFT, "t.date,t.rowid", "t.deleted_at IS NULL"))}),
  'appointmentRows',json(${array(rows("appointments", APPOINTMENT, "t.date,t.rowid", "t.deleted_at IS NULL"))}),
  'templateRows',json(${array(rows("shift_templates", "id,name,color,symbol", "t.id"))}),
  'platformCollationRanks',json('{}')) AS encoded`;

const training = rows(
  "shift_training_details",
  "shift_id,shift_revision,shift_date,shift_updated_at,time_zone,data_json,revision,updated_at",
  "t.shift_id",
  "1",
  ["data_json"],
);
const draft = (table: string, fields: string, order: string, jsonColumn = "confirmation_json") =>
  rows(table, fields, order, "1", [jsonColumn]);
export const NATIVE_ENGINE_SOURCE_SQL = {
  CALENDAR_ENTRIES: { select: calendar, single: true },
  WORK_PROFILE: { select: profile, single: true },
  REMUNERATION_PROFILES: {
    select: rows(
      "remuneration_profiles",
      "id,effective_from,data_json,revision,created_at,updated_at",
      "t.effective_from",
    ),
    single: false,
  },
  WORKING_TIME_TARGET: {
    select: rows(
      "working_time_target_settings",
      "id,settings_json,revision,created_at,updated_at",
      "t.id",
      "t.id='singleton'",
      ["settings_json"],
    ),
    single: true,
  },
  WORK_PATTERN_SETTINGS: {
    select: rows(
      "app_preferences",
      "key,value,updated_at",
      "t.key",
      "t.key IN ('tvoed_workplace_coverage','tvoed_assignment')",
    ),
    single: false,
  },
  LEGACY_TARIFF_DECISIONS: {
    select: rows(
      "monthly_tariff_decisions",
      "month,allowance_status,revision,confirmed_at,updated_at",
      "t.month",
    ),
    single: false,
  },
  SCOPED_ALLOWANCE_DECISIONS: {
    select: rows(
      "scoped_allowance_decisions",
      "month,decisions_json,revision,updated_at",
      "t.month",
    ),
    single: false,
  },
  OVERTIME_ALLOCATIONS: {
    select: rows(
      "overtime_allocations",
      "shift_id,shift_revision,time_zone,allocations_json,revision,confirmed_at,updated_at",
      "t.shift_id",
    ),
    single: false,
  },
  PAID_ABSENCES: {
    select: rows(
      "paid_absences",
      "shift_id,shift_revision,shift_date,shift_updated_at,time_zone,paid_minutes,revision,confirmed_at,updated_at",
      "t.shift_id",
    ),
    single: false,
  },
  ACTUAL_ANNUAL_PAYMENTS: {
    select: rows(
      "actual_annual_payments",
      "payment_id,entitlement_year,payment_json,revoked,updated_at",
      "t.entitlement_year,t.payment_id",
      "1",
      ["payment_json"],
    ),
    single: false,
  },
  TARIFF_ANNUAL_CLAIMS: {
    select: rows(
      "tariff_annual_claims",
      "claim_id,entitlement_year,claim_json,actual_payment_json,revoked,revision,updated_at",
      "t.entitlement_year,t.claim_id",
      "1",
      ["claim_json", "actual_payment_json"],
    ),
    single: false,
  },
  TVL_SHIFT_WORK: {
    select: draft(
      "tvl_shift_work",
      "shift_id,profile_effective_from,confirmation_json",
      "t.shift_id,t.profile_effective_from",
    ),
    single: false,
  },
  ANNEX_A_MONTH_CONFIRMATIONS: {
    select: draft("tvoed_annex_a_month_confirmations", "month,confirmation_json", "t.month"),
    single: false,
  },
  ANNEX_A_PREMIUM_FACTS: {
    select: draft("tvoed_annex_a_premium_facts", "month,facts_json", "t.month", "facts_json"),
    single: false,
  },
  ANNEX_A_PAUSE_DETAILS: { select: training, single: false },
  SUE_MONTH_CONFIRMATIONS: {
    select: draft("tvoed_sue_month_confirmations", "month,confirmation_json", "t.month"),
    single: false,
  },
  SUE_ALLOWANCE_CONFIRMATIONS: {
    select: draft("tvoed_sue_allowance_confirmations", "month,confirmation_json", "t.month"),
    single: false,
  },
  TRAINING_PROFILES: {
    select: rows(
      "training_profiles",
      "effective_from,data_json,revision,updated_at",
      "t.effective_from",
      "1",
      ["data_json"],
    ),
    single: false,
  },
  TRAINING_SHIFT_DETAILS: { select: training, single: false },
  YOUTH_PREFERENCE: {
    select: rows("app_preferences", "value", "t.key", "t.key='check_youth_protection'"),
    single: true,
  },
  NET_PAY_SETTINGS_TIMELINE: {
    select: rows(
      "net_pay_profiles",
      "month,settings_json,revision,created_at,updated_at",
      "t.month",
    ),
    single: false,
  },
  SALARY_PAYMENT_PREFERENCES: {
    select: rows("app_preferences", "value", "t.key", "t.key='salary_payment_v1'"),
    single: true,
  },
  CARITAS_MONTH_FACTS: {
    select: draft("caritas_month_facts", "month,facts_json", "t.month", "facts_json"),
    single: false,
  },
  CARITAS_WORK_DAYS: {
    select: draft("caritas_work_days", "shift_id,date,confirmation_json", "t.shift_id,t.date"),
    single: false,
  },
  CARITAS_OVERTIME_CONFIRMATIONS: {
    select: draft("caritas_overtime", "shift_id,confirmation_json", "t.shift_id"),
    single: false,
  },
  DRK_EMPLOYEE_MONTH_CONFIRMATIONS: {
    select: draft("drk_employee_month_confirmations", "month,confirmation_json", "t.month"),
    single: false,
  },
  DRK_TRAINING_MONTH_CONFIRMATIONS: {
    select: draft("drk_training_month_confirmations", "month,confirmation_json", "t.month"),
    single: false,
  },
  TEST_MONTHS: { select: rows("dev_test_backups", "month", "t.month"), single: false },
} as const;
export type { NativeEngineSqlSourceKind };

/** JSON is assembled by SQLite, not parsed and reserialized on the UI thread.
 * Bounds are evaluated before the aggregate value crosses the DB bridge. */
export function nativeEngineSourceQuery(kind: NativeEngineSqlSourceKind) {
  const spec = NATIVE_ENGINE_SOURCE_SQL[kind];
  const value = spec.single
    ? "(SELECT encoded FROM input_rows LIMIT 1)"
    : "(SELECT json_group_array(json(encoded)) FROM input_rows)";
  return `WITH input_rows AS NOT MATERIALIZED (${spec.select}),
    budget AS (SELECT count(*) AS count,coalesce(sum(length(CAST(encoded AS BLOB))),0)+count(*)+2 AS bytes FROM input_rows)
    SELECT count,bytes,CASE WHEN count<=${spec.single ? 1 : 100_000} AND bytes<=? THEN ${value} ELSE NULL END AS json FROM budget`;
}
