import { authOptions } from "@/lib/auth";
import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

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
    if (hasCompany && hasJobTitle && hasStatus) return i;
  }
  return -1;
}

function resolveSpreadsheetId(rawValue: string): string {
  const trimmed = rawValue.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] ?? trimmed;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });
  const accessToken = (token?.accessToken as string | undefined) ?? session?.accessToken;
  const sheetIdRaw = process.env.GOOGLE_SHEETS_ID;
  const configuredTab = process.env.GOOGLE_SHEETS_TAB;

  if (!accessToken) {
    return NextResponse.json({ error: "Not authenticated with Google" }, { status: 401 });
  }
  if (!sheetIdRaw) {
    return NextResponse.json({ error: "Missing GOOGLE_SHEETS_ID" }, { status: 500 });
  }

  const spreadsheetId = resolveSpreadsheetId(sheetIdRaw);
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const sheets = google.sheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(title,sheetId))",
  });
  const allTabs = (meta.data.sheets ?? []).map((sheet) => sheet.properties?.title ?? "");

  const tabToUse = configuredTab || allTabs[0] || "Sheet1";
  const values = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabToUse}!A1:Z15`,
  });

  const rows = (values.data.values ?? []) as string[][];
  const headerRowIndex = findHeaderRowIndex(rows);
  const header = headerRowIndex >= 0 ? rows[headerRowIndex] : [];

  return NextResponse.json({
    configuredTab,
    tabUsed: tabToUse,
    allTabs,
    headerRowIndex,
    header,
    columnMatch: {
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
    },
    firstRows: rows,
  });
}
