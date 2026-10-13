import { sharingContentSignature, type SharingSourceContent } from "@/domain/sharing-content";
import type { SQLiteDatabase } from "expo-sqlite";
import type {
  CachedSharedCalendar,
  CloudSharedCalendar,
  LocalSharingBinding,
  SharedCalendarEntry,
  SharedCalendarSnapshot,
  SharingPublication,
} from "@/domain/calendar-sharing";
import type { SharingPublicationConfirmation } from "@/domain/calendar-sharing-ports";
import type { SharingInvitation } from "@/domain/sharing-ui-contract";
import { sharingProjectionSignature } from "@/engine/sharing-publication-confirmation";
import { listCalendarEntries } from "@/infrastructure/database/calendar-entry-repository";
import { withImmediateTransaction } from "@/infrastructure/database/transaction";
import { projectSharingEntries } from "@/engine/sharing-projection";
interface BindingRow {
  content_json: string | null;
  account_id: string;
  calendar_id: string;
  device_id: string;
  device_secret: string;
  name: string;
  color: string;
  visibility: "DETAILS" | "AVAILABILITY";
  appointment_ids_json: string;
  generation: number;
  acknowledged_generation: number;
  server_revision: number;
  enabled: number;
}
const bindingFrom = (r: BindingRow): LocalSharingBinding => ({
  ...(r.content_json && JSON.parse(r.content_json).version === 2
    ? { content: JSON.parse(r.content_json) as SharingSourceContent }
    : {}),
  ...(r.content_json && JSON.parse(r.content_json).consentReset
    ? { requiresContentConsent: true as const }
    : {}),
  accountId: r.account_id,
  calendarId: r.calendar_id,
  deviceId: r.device_id,
  deviceSecret: r.device_secret,
  name: r.name,
  color: r.color,
  visibility: r.visibility,
  selectedAppointmentIds: JSON.parse(r.appointment_ids_json) as string[],
  generation: r.generation,
  acknowledgedGeneration: r.acknowledged_generation,
  serverRevision: r.server_revision,
  enabled: r.enabled === 1,
});
export async function migrateCalendarSharing(
  db: SQLiteDatabase,
  now = new Date().toISOString(),
): Promise<void> {
  await withImmediateTransaction(db, async (tx) => {
    await tx.execAsync(`CREATE TABLE IF NOT EXISTS sharing_active_account(id INTEGER PRIMARY KEY CHECK(id=1),account_id TEXT,last_account_id TEXT);
   INSERT OR IGNORE INTO sharing_active_account(id,account_id,last_account_id) VALUES(1,NULL,NULL);
   CREATE TABLE IF NOT EXISTS sharing_local_bindings(calendar_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,device_id TEXT NOT NULL,device_secret TEXT NOT NULL,name TEXT NOT NULL,color TEXT NOT NULL,visibility TEXT NOT NULL CHECK(visibility IN ('DETAILS','AVAILABILITY')),appointment_ids_json TEXT NOT NULL CHECK(json_valid(appointment_ids_json)),generation INTEGER NOT NULL DEFAULT 1 CHECK(generation>=1),acknowledged_generation INTEGER NOT NULL DEFAULT 0,server_revision INTEGER NOT NULL DEFAULT 0,enabled INTEGER NOT NULL CHECK(enabled IN(0,1)));
   CREATE TABLE IF NOT EXISTS sharing_publication_outbox(calendar_id TEXT PRIMARY KEY REFERENCES sharing_local_bindings(calendar_id) ON DELETE CASCADE,account_id TEXT NOT NULL,mutation_id TEXT NOT NULL,generation INTEGER NOT NULL,expected_revision INTEGER NOT NULL,snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)));
   CREATE TABLE IF NOT EXISTS sharing_entry_ids(calendar_id TEXT NOT NULL REFERENCES sharing_local_bindings(calendar_id) ON DELETE CASCADE,local_key TEXT NOT NULL,public_id TEXT NOT NULL UNIQUE,PRIMARY KEY(calendar_id,local_key));
   CREATE TABLE IF NOT EXISTS sharing_calendar_cache(account_id TEXT NOT NULL,calendar_id TEXT NOT NULL,metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),entries_json TEXT NOT NULL CHECK(json_valid(entries_json)),fetched_at TEXT NOT NULL,visible INTEGER NOT NULL DEFAULT 1 CHECK(visible IN(0,1)),PRIMARY KEY(account_id,calendar_id));`);
    const cacheColumns = await tx.getAllAsync<{ name: string }>(
      "PRAGMA table_info(sharing_calendar_cache)",
    );
    if (!cacheColumns.some((column) => column.name === "local_color"))
      await tx.execAsync("ALTER TABLE sharing_calendar_cache ADD COLUMN local_color TEXT");
    const columns = await tx.getAllAsync<{ name: string }>(
      "PRAGMA table_info(sharing_local_bindings)",
    );
    await tx.execAsync(
      "CREATE TABLE IF NOT EXISTS sharing_issued_invitations(account_id TEXT NOT NULL,invite_id TEXT NOT NULL,calendar_id TEXT NOT NULL,url TEXT NOT NULL,expires_at TEXT NOT NULL,PRIMARY KEY(account_id,invite_id))",
    );
    if (!columns.some((column) => column.name === "content_json"))
      await tx.execAsync(
        "ALTER TABLE sharing_local_bindings ADD COLUMN content_json TEXT CHECK(content_json IS NULL OR json_valid(content_json))",
      );
    await tx.execAsync(
      `CREATE TABLE IF NOT EXISTS sharing_projection_version(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);`,
    );
    const projection = await tx.getFirstAsync<{ version: number }>(
      "SELECT version FROM sharing_projection_version WHERE id=1",
    );
    if (!projection || projection.version < 2) {
      // Existing full shares must send the real service names once after upgrade.
      // Paused and availability-only shares retain their explicit owner settings.
      await tx.runAsync(
        "UPDATE sharing_local_bindings SET generation=generation+1 WHERE enabled=1 AND visibility='DETAILS'",
      );
      await tx.runAsync(
        "INSERT OR REPLACE INTO sharing_projection_version(id,version) VALUES(1,2)",
      );
    }
    await tx.runAsync(
      "INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(33,?)",
      now,
    );
    for (const table of ["shift_entries", "appointments", "shift_templates", "user_profile"])
      for (const operation of ["INSERT", "UPDATE", "DELETE"])
        await tx.execAsync(
          `CREATE TRIGGER IF NOT EXISTS sharing_dirty_${table}_${operation.toLowerCase()} AFTER ${operation} ON ${table} BEGIN UPDATE sharing_local_bindings SET generation=generation+1 WHERE enabled=1 AND account_id=(SELECT account_id FROM sharing_active_account WHERE id=1); END;`,
        );
  });
}
export async function setSharingActiveAccount(
  db: SQLiteDatabase,
  accountId: string | null,
): Promise<void> {
  await withImmediateTransaction(db, async (tx) => {
    const current = await tx.getFirstAsync<{
      account_id: string | null;
      last_account_id: string | null;
    }>("SELECT account_id,last_account_id FROM sharing_active_account WHERE id=1");
    if (
      accountId !== null &&
      current?.last_account_id !== null &&
      current?.last_account_id !== accountId
    )
      await tx.runAsync(
        "UPDATE sharing_local_bindings SET enabled=0 WHERE account_id<>?",
        accountId,
      );
    if (accountId !== null && current?.account_id !== accountId)
      await tx.runAsync(
        "UPDATE sharing_local_bindings SET generation=generation+1 WHERE account_id=? AND enabled=1",
        accountId,
      );
    await tx.runAsync(
      "UPDATE sharing_active_account SET account_id=?,last_account_id=COALESCE(?,last_account_id) WHERE id=1",
      accountId,
      accountId,
    );
    if (accountId === null) await tx.runAsync("DELETE FROM sharing_calendar_cache");
    if (accountId === null) await tx.runAsync("DELETE FROM sharing_issued_invitations");
    else await tx.runAsync("DELETE FROM sharing_issued_invitations WHERE account_id<>?", accountId);
  });
}
export async function bindSharingCalendar(
  db: SQLiteDatabase,
  accountId: string,
  calendar: CloudSharedCalendar,
  deviceSecret: string,
  selectedAppointmentIds: readonly string[],
): Promise<void> {
  if (
    !calendar.isOwner ||
    calendar.ownerId !== accountId ||
    !calendar.deviceId ||
    !/^[0-9a-f]{64}$/.test(deviceSecret)
  )
    throw new Error("SHARE_INVALID_BINDING");
  const deviceId = calendar.deviceId;
  await withImmediateTransaction(db, async (tx) => {
    const active = await tx.getFirstAsync<{ account_id: string | null }>(
      "SELECT account_id FROM sharing_active_account WHERE id=1",
    );
    if (active?.account_id !== accountId) throw new Error("SHARE_ACCOUNT_CHANGED");
    await tx.runAsync("UPDATE sharing_local_bindings SET enabled=0");
    await tx.runAsync(
      `INSERT INTO sharing_local_bindings(calendar_id,account_id,device_id,device_secret,name,color,visibility,appointment_ids_json,server_revision,enabled) VALUES(?,?,?,?,?,?,?,?,?,1)`,
      calendar.id,
      accountId,
      deviceId,
      deviceSecret,
      calendar.name,
      calendar.color,
      calendar.visibility,
      JSON.stringify(selectedAppointmentIds),
      calendar.revision,
    );
  });
}
export async function listSharingBindings(
  db: SQLiteDatabase,
  accountId: string,
): Promise<readonly LocalSharingBinding[]> {
  return (
    await db.getAllAsync<BindingRow>(
      "SELECT * FROM sharing_local_bindings WHERE account_id=?",
      accountId,
    )
  ).map(bindingFrom);
}
export async function stageSharingPublication(
  db: SQLiteDatabase,
  binding: LocalSharingBinding,
  timeZone: string,
  makeId: () => string,
): Promise<SharingPublication | null> {
  return withImmediateTransaction(db, async (tx) => {
    const active = await tx.getFirstAsync<{ account_id: string | null }>(
      "SELECT account_id FROM sharing_active_account WHERE id=1",
    );
    const row = await tx.getFirstAsync<BindingRow>(
      "SELECT * FROM sharing_local_bindings WHERE calendar_id=? AND account_id=?",
      binding.calendarId,
      binding.accountId,
    );
    if (active?.account_id !== binding.accountId || !row || row.enabled !== 1)
      throw new Error("SHARE_ACCOUNT_CHANGED");
    const testLab = await tx.getFirstAsync<{ count: number }>(
      "SELECT count(*) AS count FROM dev_test_backups",
    );
    if (testLab?.count) throw new Error("SHARE_TEST_LAB_ACTIVE");
    const existing = await tx.getFirstAsync<{
      mutation_id: string;
      generation: number;
      expected_revision: number;
      snapshot_json: string;
    }>(
      "SELECT * FROM sharing_publication_outbox WHERE calendar_id=? AND account_id=?",
      binding.calendarId,
      binding.accountId,
    );
    if (existing)
      return {
        accountId: binding.accountId,
        calendarId: binding.calendarId,
        mutationId: existing.mutation_id,
        generation: existing.generation,
        expectedRevision: existing.expected_revision,
        entries: JSON.parse(existing.snapshot_json) as SharedCalendarEntry[],
      };
    if (row.generation <= row.acknowledged_generation) return null;
    const source = await listCalendarEntries(tx);
    return persistSharingPublication(tx, row, source, timeZone, makeId);
  });
}

/** Verify consent, resume and stage the checked snapshot atomically; stale previews never resume. */
export async function stageConfirmedSharingPublication(
  db: SQLiteDatabase,
  binding: LocalSharingBinding,
  timeZone: string,
  makeId: () => string,
  confirmation: SharingPublicationConfirmation,
): Promise<SharingPublication> {
  return withImmediateTransaction(db, async (tx) => {
    const active = await tx.getFirstAsync<{ account_id: string | null }>(
      "SELECT account_id FROM sharing_active_account WHERE id=1",
    );
    const row = await tx.getFirstAsync<BindingRow>(
      "SELECT * FROM sharing_local_bindings WHERE calendar_id=? AND account_id=?",
      binding.calendarId,
      binding.accountId,
    );
    if (
      active?.account_id !== binding.accountId ||
      !row ||
      row.device_id !== binding.deviceId ||
      row.device_secret !== binding.deviceSecret
    )
      throw new Error("SHARE_ACCOUNT_CHANGED");
    const testLab = await tx.getFirstAsync<{ count: number }>(
      "SELECT count(*) AS count FROM dev_test_backups",
    );
    if (testLab?.count) throw new Error("SHARE_TEST_LAB_ACTIVE");
    const selected = JSON.parse(row.appointment_ids_json) as string[];
    if (
      !Number.isSafeInteger(row.generation) ||
      row.generation >= Number.MAX_SAFE_INTEGER ||
      row.generation !== confirmation.generation ||
      row.visibility !== confirmation.visibility ||
      sharingContentSignature(bindingFrom(row).content) !==
        sharingContentSignature(confirmation.content) ||
      JSON.stringify(selected) !== JSON.stringify(confirmation.selectedAppointmentIds) ||
      !Number.isSafeInteger(confirmation.serverRevision) ||
      confirmation.serverRevision < 0
    )
      throw new Error("SHARE_PREVIEW_STALE");
    const source = await listCalendarEntries(tx);
    const checkedProjection = projectSharingEntries(source, {
      timeZone,
      visibility: row.visibility,
      content: bindingFrom(row).content,
      selectedAppointmentIds: selected,
      publicId: () => "11111111-1111-4111-8111-111111111111",
    });
    if (sharingProjectionSignature(checkedProjection) !== confirmation.projection)
      throw new Error("SHARE_PREVIEW_STALE");
    const resumed = await tx.runAsync(
      "UPDATE sharing_local_bindings SET enabled=1,generation=generation+1,server_revision=? WHERE calendar_id=? AND account_id=? AND generation=? AND visibility=? AND appointment_ids_json=? AND device_id=? AND device_secret=? AND account_id=(SELECT account_id FROM sharing_active_account WHERE id=1)",
      confirmation.serverRevision,
      row.calendar_id,
      row.account_id,
      row.generation,
      row.visibility,
      row.appointment_ids_json,
      row.device_id,
      row.device_secret,
    );
    if (resumed.changes !== 1) throw new Error("SHARE_PREVIEW_STALE");
    await tx.runAsync(
      "DELETE FROM sharing_publication_outbox WHERE calendar_id=? AND account_id=?",
      row.calendar_id,
      row.account_id,
    );
    return persistSharingPublication(
      tx,
      {
        ...row,
        generation: row.generation + 1,
        server_revision: confirmation.serverRevision,
      },
      source,
      timeZone,
      makeId,
    );
  });
}

async function persistSharingPublication(
  tx: SQLiteDatabase,
  row: BindingRow,
  source: Awaited<ReturnType<typeof listCalendarEntries>>,
  timeZone: string,
  makeId: () => string,
): Promise<SharingPublication> {
  const ids = new Map<string, string>();
  for (const entry of source) {
    const key = entry.kind + ":" + entry.id;
    const saved = await tx.getFirstAsync<{ public_id: string }>(
      "SELECT public_id FROM sharing_entry_ids WHERE calendar_id=? AND local_key=?",
      row.calendar_id,
      key,
    );
    const publicId = saved?.public_id ?? makeId();
    if (!saved)
      await tx.runAsync(
        "INSERT INTO sharing_entry_ids(calendar_id,local_key,public_id) VALUES(?,?,?)",
        row.calendar_id,
        key,
        publicId,
      );
    ids.set(key, publicId);
  }
  const entries = projectSharingEntries(source, {
    timeZone,
    visibility: row.visibility,
    content: bindingFrom(row).content,
    selectedAppointmentIds: JSON.parse(row.appointment_ids_json) as string[],
    publicId: (entry) => ids.get(entry.kind + ":" + entry.id)!,
  });
  const mutationId = makeId();
  await tx.runAsync(
    "INSERT INTO sharing_publication_outbox(calendar_id,account_id,mutation_id,generation,expected_revision,snapshot_json) VALUES(?,?,?,?,?,?)",
    row.calendar_id,
    row.account_id,
    mutationId,
    row.generation,
    row.server_revision,
    JSON.stringify(entries),
  );
  return {
    accountId: row.account_id,
    calendarId: row.calendar_id,
    mutationId,
    generation: row.generation,
    expectedRevision: row.server_revision,
    entries,
  };
}
export async function acknowledgeSharingPublication(
  db: SQLiteDatabase,
  publication: SharingPublication,
  revision: number,
): Promise<void> {
  await withImmediateTransaction(db, async (tx) => {
    const deleted = await tx.runAsync(
      "DELETE FROM sharing_publication_outbox WHERE calendar_id=? AND account_id=? AND mutation_id=?",
      publication.calendarId,
      publication.accountId,
      publication.mutationId,
    );
    if (deleted.changes !== 1) return;
    await tx.runAsync(
      "UPDATE sharing_local_bindings SET acknowledged_generation=MAX(acknowledged_generation,?),server_revision=? WHERE calendar_id=? AND account_id=?",
      publication.generation,
      revision,
      publication.calendarId,
      publication.accountId,
    );
  });
}
export async function resumeSharingPublication(
  db: SQLiteDatabase,
  accountId: string,
  calendarId: string,
): Promise<void> {
  await db.runAsync(
    "UPDATE sharing_local_bindings SET enabled=1,generation=generation+1 WHERE calendar_id=? AND account_id=? AND account_id=(SELECT account_id FROM sharing_active_account WHERE id=1)",
    calendarId,
    accountId,
  );
}
export async function clearSharingPublicationConflict(
  db: SQLiteDatabase,
  accountId: string,
  calendarId: string,
  serverRevision: number,
): Promise<void> {
  await withImmediateTransaction(db, async (tx) => {
    await tx.runAsync(
      "DELETE FROM sharing_publication_outbox WHERE calendar_id=? AND account_id=?",
      calendarId,
      accountId,
    );
    await tx.runAsync(
      "UPDATE sharing_local_bindings SET server_revision=?,enabled=0 WHERE calendar_id=? AND account_id=?",
      serverRevision,
      calendarId,
      accountId,
    );
  });
}
export async function cacheSharingSnapshot(
  db: SQLiteDatabase,
  accountId: string,
  snapshot: SharedCalendarSnapshot,
): Promise<void> {
  await withImmediateTransaction(db, async (tx) => {
    const cached = await tx.getFirstAsync<{ entries_json: string; visible: number }>(
      "SELECT entries_json,visible FROM sharing_calendar_cache WHERE account_id=? AND calendar_id=?",
      accountId,
      snapshot.calendar.id,
    );
    if (snapshot.unchanged && !cached) throw new Error("SHARE_CACHE_MISSING");
    await tx.runAsync(
      `INSERT INTO sharing_calendar_cache(account_id,calendar_id,metadata_json,entries_json,fetched_at,visible) VALUES(?,?,?,?,?,?) ON CONFLICT(account_id,calendar_id) DO UPDATE SET metadata_json=excluded.metadata_json,entries_json=excluded.entries_json,fetched_at=excluded.fetched_at`,
      accountId,
      snapshot.calendar.id,
      JSON.stringify(snapshot.calendar),
      snapshot.unchanged ? cached!.entries_json : JSON.stringify(snapshot.entries),
      snapshot.fetchedAt,
      cached?.visible ?? 1,
    );
  });
}
export async function listCachedSharingCalendars(
  db: SQLiteDatabase,
  accountId: string,
): Promise<readonly CachedSharedCalendar[]> {
  return (
    await db.getAllAsync<{
      metadata_json: string;
      entries_json: string;
      fetched_at: string;
      visible: number;
      local_color: string | null;
    }>("SELECT * FROM sharing_calendar_cache WHERE account_id=?", accountId)
  ).map((r) => ({
    accountId,
    calendar: JSON.parse(r.metadata_json) as CloudSharedCalendar,
    entries: JSON.parse(r.entries_json) as SharedCalendarEntry[],
    fetchedAt: r.fetched_at,
    visible: r.visible === 1,
    ...(r.local_color ? { localColor: r.local_color } : {}),
  }));
}
export async function setSharingCalendarColor(
  db: SQLiteDatabase,
  accountId: string,
  calendarId: string,
  color: string,
): Promise<void> {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error("SHARE_INVALID_ARGUMENT");
  await db.runAsync(
    "UPDATE sharing_calendar_cache SET local_color=? WHERE account_id=? AND calendar_id=? AND json_extract(metadata_json,'$.isOwner')=0",
    color,
    accountId,
    calendarId,
  );
}
export async function setSharingCalendarVisible(
  db: SQLiteDatabase,
  accountId: string,
  calendarId: string,
  visible: boolean,
): Promise<void> {
  await db.runAsync(
    "UPDATE sharing_calendar_cache SET visible=? WHERE account_id=? AND calendar_id=?",
    visible ? 1 : 0,
    accountId,
    calendarId,
  );
}
export async function removeSharingCalendar(
  db: SQLiteDatabase,
  accountId: string,
  calendarId: string,
): Promise<void> {
  await withImmediateTransaction(db, async (tx) => {
    await tx.runAsync(
      "DELETE FROM sharing_calendar_cache WHERE account_id=? AND calendar_id=?",
      accountId,
      calendarId,
    );
    await tx.runAsync(
      "DELETE FROM sharing_local_bindings WHERE account_id=? AND calendar_id=?",
      accountId,
      calendarId,
    );
  });
}
export async function forgetSharingAccount(db: SQLiteDatabase, accountId: string): Promise<void> {
  await withImmediateTransaction(db, async (tx) => {
    await tx.runAsync("DELETE FROM sharing_calendar_cache WHERE account_id=?", accountId);
    await tx.runAsync("DELETE FROM sharing_local_bindings WHERE account_id=?", accountId);
    await tx.runAsync(
      "UPDATE sharing_active_account SET account_id=NULL,last_account_id=NULL WHERE id=1",
    );
  });
}

/** Called inside the restore transaction, before user rows change; never starts a nested transaction. */
export async function isolateSharingForBackupRestore(db: SQLiteDatabase): Promise<void> {
  const bindingTable = await db.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='sharing_local_bindings'",
  );
  // Older offline-only databases have no sharing state to detach.
  if (bindingTable === null) return;
  const issuedTable = await db.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='sharing_issued_invitations'",
  );
  if (issuedTable) await db.runAsync("DELETE FROM sharing_issued_invitations");
  await db.runAsync("DELETE FROM sharing_publication_outbox");
  await db.runAsync("DELETE FROM sharing_entry_ids");
  await db.runAsync("DELETE FROM sharing_calendar_cache");
  const columns = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(sharing_local_bindings)",
  );
  await db.runAsync(
    columns.some((column) => column.name === "content_json")
      ? "UPDATE sharing_local_bindings SET enabled=0,content_json='{\"consentReset\":true}',appointment_ids_json='[]',generation=generation+1"
      : "UPDATE sharing_local_bindings SET enabled=0,appointment_ids_json='[]',generation=generation+1",
  );
}

/** Changes source consent atomically, invalidating every older queued snapshot. */
export async function configureSharingContent(
  db: SQLiteDatabase,
  accountId: string,
  calendarId: string,
  content: SharingSourceContent,
): Promise<void> {
  if (
    content.version !== 2 ||
    [content.shifts, content.allAppointments, content.notes].some(
      (value) => typeof value !== "boolean",
    )
  )
    throw new Error("SHARE_INVALID_ARGUMENT");
  await withImmediateTransaction(db, async (tx) => {
    const active = await tx.getFirstAsync<{ account_id: string }>(
      "SELECT account_id FROM sharing_active_account WHERE id=1",
    );
    const row = await tx.getFirstAsync<BindingRow>(
      "SELECT * FROM sharing_local_bindings WHERE account_id=? AND calendar_id=?",
      accountId,
      calendarId,
    );
    if (active?.account_id !== accountId || !row) throw new Error("SHARE_ACCOUNT_CHANGED");
    const testLab = await tx.getFirstAsync<{ count: number }>(
      "SELECT count(*) AS count FROM dev_test_backups",
    );
    if (testLab?.count) throw new Error("SHARE_TEST_LAB_ACTIVE");
    if (sharingContentSignature(bindingFrom(row).content) === sharingContentSignature(content))
      return;
    await tx.runAsync(
      "UPDATE sharing_local_bindings SET content_json=?,generation=generation+1 WHERE account_id=? AND calendar_id=?",
      JSON.stringify(content),
      accountId,
      calendarId,
    );
    await tx.runAsync(
      "DELETE FROM sharing_publication_outbox WHERE account_id=? AND calendar_id=?",
      accountId,
      calendarId,
    );
  });
}

/** Account-scoped invitation secrets are cleared on signout and restore. */
export async function rememberSharingInvitation(
  db: SQLiteDatabase,
  accountId: string,
  invitation: SharingInvitation,
): Promise<void> {
  await withImmediateTransaction(db, async (tx) => {
    const active = await tx.getFirstAsync<{ account_id: string }>(
      "SELECT account_id FROM sharing_active_account WHERE id=1",
    );
    if (active?.account_id !== accountId) throw new Error("SHARE_ACCOUNT_CHANGED");
    await tx.runAsync(
      "INSERT OR REPLACE INTO sharing_issued_invitations(account_id,invite_id,calendar_id,url,expires_at) VALUES(?,?,?,?,?)",
      accountId,
      invitation.id,
      invitation.calendarId,
      invitation.url,
      invitation.expiresAt,
    );
  });
}
export async function listSharingInvitations(
  db: SQLiteDatabase,
  accountId: string,
): Promise<readonly SharingInvitation[]> {
  await db.runAsync(
    "DELETE FROM sharing_issued_invitations WHERE expires_at<=?",
    new Date().toISOString(),
  );
  const rows = await db.getAllAsync<{
    invite_id: string;
    calendar_id: string;
    url: string;
    expires_at: string;
  }>(
    "SELECT * FROM sharing_issued_invitations WHERE account_id=? AND account_id=(SELECT account_id FROM sharing_active_account WHERE id=1)",
    accountId,
  );
  return rows.map((row) => ({
    id: row.invite_id,
    calendarId: row.calendar_id,
    url: row.url,
    expiresAt: row.expires_at,
  }));
}
