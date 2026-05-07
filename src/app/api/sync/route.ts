import { authOptions } from "@/lib/auth";
import { getIntegrationByEmail, integrationPersistenceEnabled } from "@/lib/userIntegrationStore";
import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";

type JobStatus =
  | "Applied"
  | "No Response Yet"
  | "Phone Screen"
  | "OA"
  | "Interviewing 1"
  | "Interviewing 2"
  | "Interviewing 3"
  | "Interviewing 4"
  | "Offer"
  | "Rejected";

const STATUS_PRIORITY: Record<JobStatus, number> = {
  Applied: 1,
  "No Response Yet": 1,
  "Phone Screen": 2,
  OA: 3,
  "Interviewing 1": 4,
  "Interviewing 2": 5,
  "Interviewing 3": 6,
  "Interviewing 4": 7,
  Offer: 8,
  Rejected: 99,
};

const ALLOWED_STATUSES: readonly JobStatus[] = [
  "Applied",
  "No Response Yet",
  "Phone Screen",
  "OA",
  "Interviewing 1",
  "Interviewing 2",
  "Interviewing 3",
  "Interviewing 4",
  "Offer",
  "Rejected",
] as const;

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function extractStatus(subject: string, snippet: string): JobStatus | null {
  const text = normalize(`${subject} ${snippet}`);

  if (
    /(not moving forward|no longer moving forward|unfortunately|regret to inform|rejected|declined|position has been filled)/.test(
      text,
    )
  ) {
    return "Rejected";
  }

  if (/(offer|we d like to offer|congratulations)/.test(text)) {
    return "Offer";
  }

  if (/(interview 4|fourth interview)/.test(text)) return "Interviewing 4";
  if (/(interview 3|third interview|final interview)/.test(text)) return "Interviewing 3";
  if (/(interview 2|second interview|onsite)/.test(text)) return "Interviewing 2";
  if (/(phone screen|screening call|recruiter screen|recruiter call|hiring manager screen)/.test(text)) {
    return "Phone Screen";
  }
  if (/(interview 1|first interview|recruiter screen|phone screen|screening call|schedule an interview)/.test(text)) {
    return "Interviewing 1";
  }

  if (/(online assessment|assessment|coding challenge|hackerrank|codility|codesignal)/.test(text)) {
    return "OA";
  }

  if (/(application received|thanks for applying|thank you for applying|application has been submitted)/.test(text)) {
    return "Applied";
  }

  return null;
}

function getHeaderValue(
  headers: Array<{ name?: string | null; value?: string | null }> | undefined,
  name: string,
): string {
  return (
    headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ??
    ""
  );
}

function toIsoDate(input?: string | null): string | null {
  if (!input) return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function datePlusDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function canonicalStatus(value?: string | null): JobStatus | null {
  const s = normalize(value ?? "");
  if (!s) return null;
  if (s.includes("no response")) return "No Response Yet";
  if (s === "applied") return "Applied";
  if (s.includes("phone screen") || s.includes("recruiter screen")) return "Phone Screen";
  if (s === "oa" || s.includes("assessment")) return "OA";
  if (s.includes("interviewing 1") || s.includes("interview 1") || s.includes("first interview")) return "Interviewing 1";
  if (s.includes("interviewing 2") || s.includes("interview 2") || s.includes("second interview")) return "Interviewing 2";
  if (s.includes("interviewing 3") || s.includes("interview 3") || s.includes("third interview") || s.includes("final interview")) return "Interviewing 3";
  if (s.includes("interviewing 4") || s.includes("interview 4") || s.includes("fourth interview")) return "Interviewing 4";
  if (s === "offer") return "Offer";
  if (s === "rejected" || s === "reject") return "Rejected";
  return null;
}

function parseJourney(journey: string): JobStatus[] {
  return journey
    .split(/->|>|,|\|/g)
    .map((part) => canonicalStatus(part))
    .filter((s): s is JobStatus => Boolean(s));
}

function appendJourney(currentJourney: string, nextStatus: JobStatus): string {
  const stages = parseJourney(currentJourney);
  if (!stages.length) return nextStatus;
  if (stages[stages.length - 1] === nextStatus) return stages.join(", ");
  // Keep repeated stages out to reduce noise.
  if (!stages.includes(nextStatus)) stages.push(nextStatus);
  return stages.join(", ");
}

type GeminiClassification = {
  company?: string;
  status?: JobStatus;
  confidence?: number;
  reason?: string;
};

async function classifyWithGemini(input: {
  subject: string;
  from: string;
  snippet: string;
  currentStatus: string;
  currentJourney: string;
}): Promise<GeminiClassification | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = [
    "Classify a recruiting email update.",
    "Return ONLY JSON with keys: status, confidence, company, reason.",
    `Allowed status values: ${ALLOWED_STATUSES.join(", ")}`,
    "If unsure, set status to null and confidence to 0.",
    "",
    `Current status: ${input.currentStatus}`,
    `Current journey: ${input.currentJourney}`,
    `From: ${input.from}`,
    `Subject: ${input.subject}`,
    `Snippet: ${input.snippet}`,
  ].join("\n");

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1,
          },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        }),
      },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!text) return null;
    const parsed = JSON.parse(text) as {
      company?: string;
      status?: string | null;
      confidence?: number;
      reason?: string;
    };
    const status = parsed.status ? canonicalStatus(parsed.status) : null;
    return {
      company: parsed.company,
      status: status ?? undefined,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      reason: parsed.reason,
    };
  } catch {
    return null;
  }
}

function resolveSpreadsheetId(rawValue: string): string {
  const trimmed = rawValue.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] ?? trimmed;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findHeaderIndex(header: string[], names: string[]): number {
  const normalizedHeader = header.map((cell) => normalizeHeader(cell ?? ""));
  for (const name of names) {
    const idx = normalizedHeader.indexOf(normalizeHeader(name));
    if (idx >= 0) return idx;
  }
  return -1;
}

function findHeaderRowIndex(rows: string[][]): number {
  const searchLimit = Math.min(rows.length, 15);
  for (let i = 0; i < searchLimit; i += 1) {
    const row = rows[i] ?? [];
    const hasCompany = findHeaderIndex(row, ["Company"]) >= 0;
    const hasStatus = findHeaderIndex(row, ["Status", "Current Status"]) >= 0;
    const hasFollowUp =
      findHeaderIndex(row, [
        "Follow-Up Date",
        "Follow Up Date",
        "Followup Date",
        "Next Follow Up",
        "Next Follow-Up",
      ]) >= 0;
    if (hasCompany && hasStatus && hasFollowUp) {
      return i;
    }
  }
  return -1;
}

async function accessTokenFromRefreshToken(refreshToken: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });
  const internalSecret = request.headers.get("x-sync-webhook-secret");
  const internalUserEmail = request.headers.get("x-sync-user-email")?.trim().toLowerCase() ?? "";
  const expectedSecret = process.env.SYNC_WEBHOOK_SECRET;
  const isInternalPush = Boolean(expectedSecret && internalSecret === expectedSecret);
  const persistenceEnabled = integrationPersistenceEnabled();
  const sessionEmail = session?.user?.email?.trim().toLowerCase() ?? "";
  const tokenEmail = typeof token?.email === "string" ? token.email.trim().toLowerCase() : "";
  const resolvedEmail = internalUserEmail || sessionEmail || tokenEmail;

  let accessToken = (token?.accessToken as string | undefined) ?? session?.accessToken;
  if (!accessToken && isInternalPush) {
    const refreshToken = process.env.SYNC_REFRESH_TOKEN;
    if (refreshToken) {
      accessToken = (await accessTokenFromRefreshToken(refreshToken)) ?? undefined;
    }
  }
  const integration =
    persistenceEnabled && resolvedEmail ? await getIntegrationByEmail(resolvedEmail) : null;
  const sheetIdRaw = integration?.sheetId ?? process.env.GOOGLE_SHEETS_ID;
  const configuredSheetName = process.env.GOOGLE_SHEETS_TAB;

  if (!accessToken) {
    return NextResponse.json(
      {
        error: "Not authenticated with Google",
        diagnostics: {
          hasSession: Boolean(session),
          hasSessionAccessToken: Boolean(session?.accessToken),
          hasJwtToken: Boolean(token),
          hasJwtAccessToken: Boolean(token?.accessToken),
          isInternalPush,
          hasSyncRefreshToken: Boolean(process.env.SYNC_REFRESH_TOKEN),
        },
      },
      { status: 401 },
    );
  }

  if (!sheetIdRaw) {
    return NextResponse.json(
      {
        error: "Missing sheet id for user (and GOOGLE_SHEETS_ID fallback not configured)",
        diagnostics: {
          resolvedEmail: resolvedEmail || null,
          persistenceEnabled,
          hasIntegrationSheetId: Boolean(integration?.sheetId),
          hasGlobalSheetId: Boolean(process.env.GOOGLE_SHEETS_ID),
        },
      },
      { status: 500 },
    );
  }
  const sheetId = resolveSpreadsheetId(sheetIdRaw);

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const gmail = google.gmail({ version: "v1", auth });
  const sheets = google.sheets({ version: "v4", auth });

  let sheetName = configuredSheetName;
  if (!sheetName) {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      fields: "sheets(properties(title))",
    });
    sheetName = meta.data.sheets?.[0]?.properties?.title ?? "Sheet1";
  }

  const range = `${sheetName}!A:Z`;
  const sheet = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
  });

  const rows = sheet.data.values ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ updated: 0, scanned: 0, details: [] });
  }

  const headerRowIndex = findHeaderRowIndex(rows as string[][]);
  if (headerRowIndex < 0) {
    return NextResponse.json(
      {
        error: "Could not find header row in the first 15 rows.",
        diagnostics: {
          usingSheetTab: sheetName,
        },
      },
      { status: 400 },
    );
  }

  const header = rows[headerRowIndex];
  const col = {
    company: findHeaderIndex(header, ["Company"]),
    status: findHeaderIndex(header, ["Status", "Current Status"]),
    journey: findHeaderIndex(header, ["Journey", "Pipeline Path", "Flow", "Application Journey"]),
    followUp: findHeaderIndex(header, [
      "Follow-Up Date",
      "Follow Up Date",
      "Followup Date",
      "Next Follow Up",
      "Next Follow-Up",
    ]),
  };

  if (col.company === -1 || col.status === -1 || col.followUp === -1) {
    return NextResponse.json(
      { error: "Sheet must include Company, Status, Follow-Up Date columns." },
      { status: 400 },
    );
  }

  const companyToRow = new Map<string, { rowNumber: number; status: string; journey: string; rowValues: string[] }>();
  rows.slice(headerRowIndex + 1).forEach((row, idx) => {
    const companyName = normalize(row[col.company] ?? "");
    if (!companyName) return;
    companyToRow.set(companyName, {
      rowNumber: idx + headerRowIndex + 2,
      status: row[col.status] ?? "",
      journey: col.journey >= 0 ? row[col.journey] ?? "" : "",
      rowValues: [...row],
    });
  });

  const gmailList = await gmail.users.messages.list({
    userId: "me",
    maxResults: 50,
    q: 'newer_than:180d (subject:(application OR interview OR assessment OR offer OR update) OR from:(greenhouse.io OR lever.co OR workday.com OR smartrecruiters.com OR taleo.net OR icims.com))',
  });

  const messageIds = gmailList.data.messages?.map((message) => message.id).filter(Boolean) as
    | string[]
    | undefined;

  if (!messageIds?.length) {
    return NextResponse.json({ updated: 0, scanned: 0, details: [] });
  }

  const updates: Array<{
    company: string;
    rowNumber: number;
    newStatus: JobStatus;
    previousStatus: string;
  }> = [];

  for (const messageId of messageIds) {
    const message = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "metadata",
      metadataHeaders: ["Subject", "From", "Date"],
    });

    const headers = message.data.payload?.headers;
    const subject = getHeaderValue(headers, "Subject");
    const from = getHeaderValue(headers, "From");
    const messageDate = toIsoDate(getHeaderValue(headers, "Date"));
    const snippet = message.data.snippet ?? "";

    const normalizedFrom = normalize(from);
    let matchedCompany = "";
    let matched = companyToRow.get(normalize(subject));

    if (!matched) {
      for (const [companyKey, rowInfo] of companyToRow.entries()) {
        if (
          normalizedFrom.includes(companyKey) ||
          normalize(subject).includes(companyKey) ||
          normalize(snippet).includes(companyKey)
        ) {
          matchedCompany = companyKey;
          matched = rowInfo;
          break;
        }
      }
    }

    if (!matched) continue;
    const gemini = await classifyWithGemini({
      subject,
      from,
      snippet,
      currentStatus: matched.status ?? "",
      currentJourney: matched.journey ?? "",
    });
    const llmStatus = gemini?.confidence && gemini.confidence >= 0.65 ? gemini.status ?? null : null;
    const detectedStatus = llmStatus ?? extractStatus(subject, snippet);
    if (!detectedStatus) continue;
    const companyKey = matchedCompany || normalize(subject);
    const previous = canonicalStatus(matched.status) ?? (matched.status as JobStatus | string);
    const previousPriority = STATUS_PRIORITY[previous as JobStatus] ?? 0;
    const nextPriority = STATUS_PRIORITY[detectedStatus];

    if (nextPriority < previousPriority) continue;

    const existing = updates.find((update) => update.rowNumber === matched.rowNumber);
    if (existing) {
      if (STATUS_PRIORITY[existing.newStatus] < nextPriority) {
        existing.newStatus = detectedStatus;
      }
      continue;
    }

    updates.push({
      company: companyKey || "(matched)",
      rowNumber: matched.rowNumber,
      newStatus: detectedStatus,
      previousStatus: matched.status,
    });

    const nextFollowUp =
      detectedStatus === "Rejected" || detectedStatus === "Offer"
        ? ""
        : messageDate ?? datePlusDays(7);

    const nextJourney = appendJourney(matched.journey, detectedStatus);
    const rowValues = [...matched.rowValues];
    rowValues[col.status] = detectedStatus;
    rowValues[col.followUp] = nextFollowUp;
    if (col.journey >= 0) rowValues[col.journey] = nextJourney;

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${sheetName}!A${matched.rowNumber}:Z${matched.rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [rowValues],
      },
    });

    matched.status = detectedStatus;
    matched.journey = nextJourney;
    matched.rowValues = rowValues;
  }

  return NextResponse.json({
    updated: updates.length,
    scanned: messageIds.length,
    details: updates,
  });
}
