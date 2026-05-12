import { authOptions } from "@/lib/auth";
import { ensureUserSheet } from "@/lib/userSheet";
import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

type JobRow = {
  rowNumber: number;
  company: string;
  jobTitle: string;
  link: string;
  dateApplied: string;
  status: string;
  followUpDate: string;
  journey: string;
};

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
    const hasJobTitle = findHeaderIndex(row, ["Job Title", "Role", "Position"]) >= 0;
    const hasStatus = findHeaderIndex(row, ["Status", "Current Status"]) >= 0;
    if (hasCompany && hasJobTitle && hasStatus) {
      return i;
    }
  }
  return -1;
}

function resolveSpreadsheetId(rawValue: string): string {
  const trimmed = rawValue.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] ?? trimmed;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toYyyyMmDdLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Normalize sheet / UI dates to ISO yyyy-mm-dd (calendar date in local time).
 * Slash dates are interpreted as US-style month/day/year (matches Google Sheets default).
 */
function parseFlexibleDateToIso(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) {
      return `${iso[1]}-${iso[2]}-${iso[3]}`;
    }
  }

  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (slash) {
    const month = Number(slash[1]);
    const day = Number(slash[2]);
    const year = Number(slash[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const dt = new Date(year, month - 1, day);
      if (dt.getFullYear() === year && dt.getMonth() === month - 1 && dt.getDate() === day) {
        return `${year}-${pad2(month)}-${pad2(day)}`;
      }
    }
  }

  const ms = Date.parse(s);
  if (!Number.isNaN(ms)) {
    const dt = new Date(ms);
    if (!Number.isNaN(dt.getTime())) return toYyyyMmDdLocal(dt);
  }

  return null;
}

function normalizeDateField(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return parseFlexibleDateToIso(trimmed) ?? trimmed;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function guessFromHost(urlString: string): { company: string; jobTitle: string } {
  try {
    const url = new URL(urlString);
    const host = url.hostname.replace(/^www\./, "");
    const parts = host.split(".");
    const company = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    const pathPart = url.pathname
      .split("/")
      .filter(Boolean)
      .pop()
      ?.replace(/[-_]+/g, " ");
    return {
      company: cleanText(company).replace(/\b\w/g, (m) => m.toUpperCase()),
      jobTitle: cleanText(pathPart ?? "New Role").replace(/\b\w/g, (m) => m.toUpperCase()),
    };
  } catch {
    return { company: "Unknown Company", jobTitle: "New Role" };
  }
}

async function inferJobFromLink(link: string): Promise<{ company: string; jobTitle: string }> {
  const fallback = guessFromHost(link);
  try {
    const response = await fetch(link, {
      method: "GET",
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (JobTrackerDashboard)",
      },
    });
    if (!response.ok) return fallback;
    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    const ogSiteMatch = html.match(/<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i);
    const rawTitle = decodeHtml(ogTitleMatch?.[1] ?? titleMatch?.[1] ?? "");
    const rawCompany = decodeHtml(ogSiteMatch?.[1] ?? "");

    let jobTitle = cleanText(rawTitle);
    if (jobTitle.includes("|")) jobTitle = cleanText(jobTitle.split("|")[0] ?? jobTitle);
    if (jobTitle.includes(" - ")) jobTitle = cleanText(jobTitle.split(" - ")[0] ?? jobTitle);

    let company = cleanText(rawCompany);
    if (!company && rawTitle.includes("|")) company = cleanText(rawTitle.split("|")[1] ?? "");
    if (!company && rawTitle.includes(" - ")) company = cleanText(rawTitle.split(" - ")[1] ?? "");

    return {
      company: company || fallback.company,
      jobTitle: jobTitle || fallback.jobTitle,
    };
  } catch {
    return fallback;
  }
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });
  const accessToken = (token?.accessToken as string | undefined) ?? session?.accessToken;
  const sessionEmail = session?.user?.email?.trim().toLowerCase() ?? "";
  const tokenEmail = typeof token?.email === "string" ? token.email.trim().toLowerCase() : "";
  const resolvedEmail = sessionEmail || tokenEmail;
  const configuredSheetName = process.env.GOOGLE_SHEETS_TAB;

  if (!accessToken) {
    return NextResponse.json({ error: "Not authenticated with Google" }, { status: 401 });
  }
  const ensuredSheet = await ensureUserSheet({
    accessToken,
    email: resolvedEmail,
    defaultSheetName: configuredSheetName,
  });
  const sheetIdRaw = ensuredSheet.sheetId ?? process.env.GOOGLE_SHEETS_ID;
  if (!sheetIdRaw) {
    return NextResponse.json({ error: "Missing sheet id for this user" }, { status: 500 });
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = resolveSpreadsheetId(sheetIdRaw);

  let sheetName = configuredSheetName;
  if (!sheetName) {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets(properties(title))",
    });
    sheetName = meta.data.sheets?.[0]?.properties?.title ?? "Sheet1";
  }

  const sheet = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:Z`,
  });

  const rows = sheet.data.values ?? [];
  if (!rows.length) {
    return NextResponse.json({ jobs: [] as JobRow[] });
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
    jobTitle: findHeaderIndex(header, ["Job Title", "Role", "Position"]),
    link: findHeaderIndex(header, ["Link", "URL", "Job Link"]),
    dateApplied: findHeaderIndex(header, ["Date Applied", "Applied Date", "Application Date"]),
    status: findHeaderIndex(header, ["Status", "Current Status"]),
    followUpDate: findHeaderIndex(header, [
      "Follow-Up Date",
      "Follow Up Date",
      "Followup Date",
      "Next Follow Up",
      "Next Follow-Up",
    ]),
    journey: findHeaderIndex(header, ["Journey", "Pipeline Path", "Flow", "Application Journey"]),
  };

  const required =
    col.company >= 0 &&
    col.jobTitle >= 0 &&
    col.link >= 0 &&
    col.dateApplied >= 0 &&
    col.status >= 0 &&
    col.followUpDate >= 0;
  if (!required) {
    return NextResponse.json(
      {
        error:
          "Sheet must include Company, Job Title, Link, Date Applied, Status, Follow-Up Date columns.",
        diagnostics: {
          usingSheetTab: sheetName,
          headerRow: header,
        },
      },
      { status: 400 },
    );
  }

  const jobs = rows.slice(headerRowIndex + 1).map((row, idx) => {
    const rawDateApplied = String(row[col.dateApplied] ?? "").trim();
    const rawFollowUp = String(row[col.followUpDate] ?? "").trim();
    return {
      rowNumber: headerRowIndex + 2 + idx,
      company: row[col.company] ?? "",
      jobTitle: row[col.jobTitle] ?? "",
      link: row[col.link] ?? "",
      dateApplied: normalizeDateField(rawDateApplied) || rawDateApplied,
      status: row[col.status] ?? "",
      followUpDate: rawFollowUp ? normalizeDateField(rawFollowUp) || rawFollowUp : "",
      journey: col.journey >= 0 ? row[col.journey] ?? "" : "",
    };
  });

  return NextResponse.json({ jobs });
}

type UpdateBody = {
  rowNumber?: number;
  company?: string;
  jobTitle?: string;
  link?: string;
  dateApplied?: string;
  status?: string;
  followUpDate?: string;
  journey?: string;
};

type CreateBody = {
  preview?: boolean;
  link?: string;
  company?: string;
  jobTitle?: string;
  dateApplied?: string;
  status?: string;
  followUpDate?: string;
  journey?: string;
};

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });
  const accessToken = (token?.accessToken as string | undefined) ?? session?.accessToken;
  const sessionEmail = session?.user?.email?.trim().toLowerCase() ?? "";
  const tokenEmail = typeof token?.email === "string" ? token.email.trim().toLowerCase() : "";
  const resolvedEmail = sessionEmail || tokenEmail;
  const configuredSheetName = process.env.GOOGLE_SHEETS_TAB;

  if (!accessToken) {
    return NextResponse.json({ error: "Not authenticated with Google" }, { status: 401 });
  }
  const ensuredSheet = await ensureUserSheet({
    accessToken,
    email: resolvedEmail,
    defaultSheetName: configuredSheetName,
  });
  const sheetIdRaw = ensuredSheet.sheetId ?? process.env.GOOGLE_SHEETS_ID;
  if (!sheetIdRaw) {
    return NextResponse.json({ error: "Missing sheet id for this user" }, { status: 500 });
  }

  const body = (await request.json()) as CreateBody;
  const preview = Boolean(body.preview);
  const link = body.link?.trim() ?? "";
  if (!link) {
    return NextResponse.json({ error: "Link is required." }, { status: 400 });
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = resolveSpreadsheetId(sheetIdRaw);

  let sheetName = configuredSheetName;
  if (!sheetName) {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets(properties(title))",
    });
    sheetName = meta.data.sheets?.[0]?.properties?.title ?? "Sheet1";
  }

  const sheet = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:Z`,
  });
  const rows = sheet.data.values ?? [];
  const headerRowIndex = findHeaderRowIndex(rows as string[][]);
  if (headerRowIndex < 0) {
    return NextResponse.json({ error: "Could not find header row." }, { status: 400 });
  }
  const header = rows[headerRowIndex];
  const col = {
    company: findHeaderIndex(header, ["Company"]),
    jobTitle: findHeaderIndex(header, ["Job Title", "Role", "Position"]),
    link: findHeaderIndex(header, ["Link", "URL", "Job Link"]),
    dateApplied: findHeaderIndex(header, ["Date Applied", "Applied Date", "Application Date"]),
    status: findHeaderIndex(header, ["Status", "Current Status"]),
    followUpDate: findHeaderIndex(header, [
      "Follow-Up Date",
      "Follow Up Date",
      "Followup Date",
      "Next Follow Up",
      "Next Follow-Up",
    ]),
    journey: findHeaderIndex(header, ["Journey", "Pipeline Path", "Flow", "Application Journey"]),
  };

  const inferred = await inferJobFromLink(link);
  const company = body.company?.trim() || inferred.company;
  const jobTitle = body.jobTitle?.trim() || inferred.jobTitle;
  const dateApplied = normalizeDateField(body.dateApplied?.trim() || todayIsoDate());
  const status = body.status?.trim() || "Applied";
  const followUpDate = body.followUpDate?.trim() ? normalizeDateField(body.followUpDate.trim()) : "";
  const journey = body.journey?.trim() || "Applied";

  if (preview) {
    return NextResponse.json({
      ok: true,
      inferred: { company, jobTitle },
      draft: { link, company, jobTitle, dateApplied, status, followUpDate, journey },
    });
  }

  const maxCol = Math.max(
    col.company,
    col.jobTitle,
    col.link,
    col.dateApplied,
    col.status,
    col.followUpDate,
    col.journey,
  );
  const row = new Array(Math.max(maxCol + 1, 1)).fill("");
  if (col.company >= 0) row[col.company] = company;
  if (col.jobTitle >= 0) row[col.jobTitle] = jobTitle;
  if (col.link >= 0) row[col.link] = link;
  if (col.dateApplied >= 0) row[col.dateApplied] = dateApplied;
  if (col.status >= 0) row[col.status] = status;
  if (col.followUpDate >= 0) row[col.followUpDate] = followUpDate;
  if (col.journey >= 0) row[col.journey] = journey;

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:Z`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [row],
    },
  });

  return NextResponse.json({
    ok: true,
    inferred: { company, jobTitle },
  });
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });
  const accessToken = (token?.accessToken as string | undefined) ?? session?.accessToken;
  const sessionEmail = session?.user?.email?.trim().toLowerCase() ?? "";
  const tokenEmail = typeof token?.email === "string" ? token.email.trim().toLowerCase() : "";
  const resolvedEmail = sessionEmail || tokenEmail;
  const configuredSheetName = process.env.GOOGLE_SHEETS_TAB;

  if (!accessToken) {
    return NextResponse.json({ error: "Not authenticated with Google" }, { status: 401 });
  }
  const ensuredSheet = await ensureUserSheet({
    accessToken,
    email: resolvedEmail,
    defaultSheetName: configuredSheetName,
  });
  const sheetIdRaw = ensuredSheet.sheetId ?? process.env.GOOGLE_SHEETS_ID;
  if (!sheetIdRaw) {
    return NextResponse.json({ error: "Missing sheet id for this user" }, { status: 500 });
  }

  const body = (await request.json()) as UpdateBody;
  const rowNumber = Number(body.rowNumber);
  if (!Number.isFinite(rowNumber) || rowNumber < 2) {
    return NextResponse.json({ error: "Invalid rowNumber" }, { status: 400 });
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = resolveSpreadsheetId(sheetIdRaw);

  let sheetName = configuredSheetName;
  if (!sheetName) {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets(properties(title))",
    });
    sheetName = meta.data.sheets?.[0]?.properties?.title ?? "Sheet1";
  }

  const sheet = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:Z`,
  });

  const rows = sheet.data.values ?? [];
  const headerRowIndex = findHeaderRowIndex(rows as string[][]);
  if (headerRowIndex < 0) {
    return NextResponse.json({ error: "Could not find header row." }, { status: 400 });
  }
  if (rowNumber <= headerRowIndex + 1) {
    return NextResponse.json({ error: "rowNumber points to header row." }, { status: 400 });
  }

  const header = rows[headerRowIndex];
  const col = {
    company: findHeaderIndex(header, ["Company"]),
    jobTitle: findHeaderIndex(header, ["Job Title", "Role", "Position"]),
    link: findHeaderIndex(header, ["Link", "URL", "Job Link"]),
    dateApplied: findHeaderIndex(header, ["Date Applied", "Applied Date", "Application Date"]),
    status: findHeaderIndex(header, ["Status", "Current Status"]),
    followUpDate: findHeaderIndex(header, [
      "Follow-Up Date",
      "Follow Up Date",
      "Followup Date",
      "Next Follow Up",
      "Next Follow-Up",
    ]),
    journey: findHeaderIndex(header, ["Journey", "Pipeline Path", "Flow", "Application Journey"]),
  };

  const normalized = {
    company: body.company ?? "",
    jobTitle: body.jobTitle ?? "",
    link: body.link ?? "",
    dateApplied: normalizeDateField(body.dateApplied ?? ""),
    status: body.status ?? "",
    followUpDate: body.followUpDate?.trim() ? normalizeDateField(body.followUpDate ?? "") : "",
    journey: body.journey ?? "",
  };

  const rowValues = rows[rowNumber - 1] ?? [];
  if (col.company >= 0) rowValues[col.company] = normalized.company.trim();
  if (col.jobTitle >= 0) rowValues[col.jobTitle] = normalized.jobTitle.trim();
  if (col.link >= 0) rowValues[col.link] = normalized.link.trim();
  if (col.dateApplied >= 0) rowValues[col.dateApplied] = normalized.dateApplied.trim();
  if (col.status >= 0) rowValues[col.status] = normalized.status.trim();
  if (col.followUpDate >= 0) rowValues[col.followUpDate] = normalized.followUpDate.trim();
  if (col.journey >= 0) rowValues[col.journey] = normalized.journey.trim();

  const maxCol = Math.max(
    col.company,
    col.jobTitle,
    col.link,
    col.dateApplied,
    col.status,
    col.followUpDate,
    col.journey,
  );
  const finalRow = rowValues.slice(0, Math.max(maxCol + 1, rowValues.length));

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A${rowNumber}:Z${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [finalRow],
    },
  });

  return NextResponse.json({ ok: true });
}

type DeleteBody = {
  rowNumber?: number;
};

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });
  const accessToken = (token?.accessToken as string | undefined) ?? session?.accessToken;
  const sessionEmail = session?.user?.email?.trim().toLowerCase() ?? "";
  const tokenEmail = typeof token?.email === "string" ? token.email.trim().toLowerCase() : "";
  const resolvedEmail = sessionEmail || tokenEmail;
  const configuredSheetName = process.env.GOOGLE_SHEETS_TAB;

  if (!accessToken) {
    return NextResponse.json({ error: "Not authenticated with Google" }, { status: 401 });
  }
  const ensuredSheet = await ensureUserSheet({
    accessToken,
    email: resolvedEmail,
    defaultSheetName: configuredSheetName,
  });
  const sheetIdRaw = ensuredSheet.sheetId ?? process.env.GOOGLE_SHEETS_ID;
  if (!sheetIdRaw) {
    return NextResponse.json({ error: "Missing sheet id for this user" }, { status: 500 });
  }

  const body = (await request.json()) as DeleteBody;
  const rowNumber = Number(body.rowNumber);
  if (!Number.isFinite(rowNumber) || rowNumber < 2) {
    return NextResponse.json({ error: "Invalid rowNumber" }, { status: 400 });
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = resolveSpreadsheetId(sheetIdRaw);

  let sheetName = configuredSheetName;
  if (!sheetName) {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets(properties(title))",
    });
    sheetName = meta.data.sheets?.[0]?.properties?.title ?? "Sheet1";
  }

  const sheet = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:Z`,
  });

  const rows = sheet.data.values ?? [];
  const headerRowIndex = findHeaderRowIndex(rows as string[][]);
  if (headerRowIndex < 0) {
    return NextResponse.json({ error: "Could not find header row." }, { status: 400 });
  }
  if (rowNumber <= headerRowIndex + 1) {
    return NextResponse.json({ error: "Cannot delete header row." }, { status: 400 });
  }

  const sheetMeta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });
  const sheetTab = sheetMeta.data.sheets?.find((s) => s.properties?.title === sheetName);
  const numericSheetId = sheetTab?.properties?.sheetId;
  if (numericSheetId === undefined || numericSheetId === null) {
    return NextResponse.json({ error: "Could not resolve sheet tab id." }, { status: 500 });
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: numericSheetId,
              dimension: "ROWS",
              startIndex: rowNumber - 1,
              endIndex: rowNumber,
            },
          },
        },
      ],
    },
  });

  return NextResponse.json({ ok: true });
}
