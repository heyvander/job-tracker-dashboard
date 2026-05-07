import { sql } from "@vercel/postgres";

export type UserIntegrationRecord = {
  email: string;
  sheetId: string | null;
  sheetUrl: string | null;
  gmailHistoryId: string | null;
  gmailWatchExpiration: string | null;
  googleAccessToken: string | null;
  googleRefreshToken: string | null;
  googleAccessTokenExpiresAt: string | null;
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
      google_access_token TEXT,
      google_refresh_token TEXT,
      google_access_token_expires_at TIMESTAMPTZ,
      last_sync_at TIMESTAMPTZ,
      last_sync_status TEXT,
      last_sync_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS google_access_token TEXT`;
  await sql`ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS google_refresh_token TEXT`;
  await sql`ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS google_access_token_expires_at TIMESTAMPTZ`;

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
    googleAccessToken: (row.google_access_token as string | null) ?? null,
    googleRefreshToken: (row.google_refresh_token as string | null) ?? null,
    googleAccessTokenExpiresAt: row.google_access_token_expires_at
      ? new Date(String(row.google_access_token_expires_at)).toISOString()
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
  const normalizedEmail = input.email.trim().toLowerCase();
  if (!normalizedEmail) return null;

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
    VALUES (${normalizedEmail}, ${historyId}, ${expirationIso})
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

export async function upsertSheetMetadata(input: {
  email: string;
  sheetId: string;
  sheetUrl?: string | null;
}): Promise<UserIntegrationRecord | null> {
  if (!hasDatabaseConfig()) return null;
  await ensureTable();
  const normalizedEmail = input.email.trim().toLowerCase();
  if (!normalizedEmail) return null;
  const normalizedSheetId = input.sheetId.trim();
  if (!normalizedSheetId) return null;
  const sheetUrl = input.sheetUrl ?? null;

  const { rows } = await sql`
    INSERT INTO user_integrations (
      email,
      sheet_id,
      sheet_url
    )
    VALUES (${normalizedEmail}, ${normalizedSheetId}, ${sheetUrl})
    ON CONFLICT (email) DO UPDATE SET
      sheet_id = EXCLUDED.sheet_id,
      sheet_url = EXCLUDED.sheet_url,
      updated_at = NOW()
    RETURNING *
  `;

  return rows[0] ? mapRow(rows[0]) : null;
}

export async function upsertOAuthTokens(input: {
  email: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  accessTokenExpiresAt?: number | null;
}): Promise<UserIntegrationRecord | null> {
  if (!hasDatabaseConfig()) return null;
  await ensureTable();
  const normalizedEmail = input.email.trim().toLowerCase();
  if (!normalizedEmail) return null;
  const accessToken = input.accessToken ?? null;
  const refreshToken = input.refreshToken ?? null;
  const accessTokenExpiresAt = input.accessTokenExpiresAt
    ? new Date(input.accessTokenExpiresAt).toISOString()
    : null;

  const { rows } = await sql`
    INSERT INTO user_integrations (
      email,
      google_access_token,
      google_refresh_token,
      google_access_token_expires_at
    )
    VALUES (${normalizedEmail}, ${accessToken}, ${refreshToken}, ${accessTokenExpiresAt})
    ON CONFLICT (email) DO UPDATE SET
      google_access_token = COALESCE(EXCLUDED.google_access_token, user_integrations.google_access_token),
      google_refresh_token = COALESCE(EXCLUDED.google_refresh_token, user_integrations.google_refresh_token),
      google_access_token_expires_at = COALESCE(EXCLUDED.google_access_token_expires_at, user_integrations.google_access_token_expires_at),
      updated_at = NOW()
    RETURNING *
  `;

  return rows[0] ? mapRow(rows[0]) : null;
}

export async function updateSyncState(input: {
  email: string;
  gmailHistoryId?: string | null;
  lastSyncStatus: "ok" | "error";
  lastSyncError?: string | null;
}): Promise<UserIntegrationRecord | null> {
  if (!hasDatabaseConfig()) return null;
  await ensureTable();
  const normalizedEmail = input.email.trim().toLowerCase();
  if (!normalizedEmail) return null;
  const historyId = input.gmailHistoryId ?? null;
  const syncError = input.lastSyncError ?? null;

  const { rows } = await sql`
    UPDATE user_integrations
    SET
      gmail_history_id = COALESCE(${historyId}, gmail_history_id),
      last_sync_at = NOW(),
      last_sync_status = ${input.lastSyncStatus},
      last_sync_error = ${syncError},
      updated_at = NOW()
    WHERE email = ${normalizedEmail}
    RETURNING *
  `;

  return rows[0] ? mapRow(rows[0]) : null;
}

export function integrationPersistenceEnabled(): boolean {
  return hasDatabaseConfig();
}
