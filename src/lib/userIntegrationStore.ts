import { sql } from "@vercel/postgres";

export type UserIntegrationRecord = {
  email: string;
  sheetId: string | null;
  sheetUrl: string | null;
  gmailHistoryId: string | null;
  gmailWatchExpiration: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
};

type UpsertWatchInput = {
  email: string;
  gmailHistoryId?: string | null;
  gmailWatchExpiration?: string | null;
};

let tableReady = false;

function hasDatabaseConfig(): boolean {
  return Boolean(process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL);
}

async function ensureTable(): Promise<void> {
  if (tableReady || !hasDatabaseConfig()) return;

  await sql`
    CREATE TABLE IF NOT EXISTS user_integrations (
      email TEXT PRIMARY KEY,
      sheet_id TEXT,
      sheet_url TEXT,
      gmail_history_id TEXT,
      gmail_watch_expiration TIMESTAMPTZ,
      last_sync_at TIMESTAMPTZ,
      last_sync_status TEXT,
      last_sync_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  tableReady = true;
}

function mapRow(row: Record<string, unknown>): UserIntegrationRecord {
  return {
    email: String(row.email ?? ""),
    sheetId: (row.sheet_id as string | null) ?? null,
    sheetUrl: (row.sheet_url as string | null) ?? null,
    gmailHistoryId: (row.gmail_history_id as string | null) ?? null,
    gmailWatchExpiration: row.gmail_watch_expiration
      ? new Date(String(row.gmail_watch_expiration)).toISOString()
      : null,
    lastSyncAt: row.last_sync_at ? new Date(String(row.last_sync_at)).toISOString() : null,
    lastSyncStatus: (row.last_sync_status as string | null) ?? null,
    lastSyncError: (row.last_sync_error as string | null) ?? null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function upsertWatchMetadata(
  input: UpsertWatchInput,
): Promise<UserIntegrationRecord | null> {
  if (!hasDatabaseConfig()) return null;
  await ensureTable();

  const historyId = input.gmailHistoryId ?? null;
  const expirationIso = input.gmailWatchExpiration
    ? new Date(Number(input.gmailWatchExpiration)).toISOString()
    : null;

  const { rows } = await sql`
    INSERT INTO user_integrations (
      email,
      gmail_history_id,
      gmail_watch_expiration
    )
    VALUES (${input.email}, ${historyId}, ${expirationIso})
    ON CONFLICT (email) DO UPDATE SET
      gmail_history_id = EXCLUDED.gmail_history_id,
      gmail_watch_expiration = EXCLUDED.gmail_watch_expiration,
      updated_at = NOW()
    RETURNING *
  `;

  return rows[0] ? mapRow(rows[0]) : null;
}

export async function getIntegrationByEmail(email: string): Promise<UserIntegrationRecord | null> {
  if (!hasDatabaseConfig()) return null;
  await ensureTable();
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const { rows } = await sql`
    SELECT *
    FROM user_integrations
    WHERE email = ${normalizedEmail}
    LIMIT 1
  `;

  return rows[0] ? mapRow(rows[0]) : null;
}

export async function updateHistoryFromPush(input: {
  email: string;
  gmailHistoryId?: string | null;
}): Promise<UserIntegrationRecord | null> {
  if (!hasDatabaseConfig()) return null;
  await ensureTable();
  const normalizedEmail = input.email.trim().toLowerCase();
  if (!normalizedEmail) return null;
  const historyId = input.gmailHistoryId ?? null;

  const { rows } = await sql`
    UPDATE user_integrations
    SET
      gmail_history_id = COALESCE(${historyId}, gmail_history_id),
      updated_at = NOW()
    WHERE email = ${normalizedEmail}
    RETURNING *
  `;

  return rows[0] ? mapRow(rows[0]) : null;
}

export function integrationPersistenceEnabled(): boolean {
  return hasDatabaseConfig();
}
