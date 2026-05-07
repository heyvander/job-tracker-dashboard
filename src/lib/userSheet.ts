import { google } from "googleapis";
import { getIntegrationByEmail, integrationPersistenceEnabled, upsertSheetMetadata } from "@/lib/userIntegrationStore";

type EnsureUserSheetInput = {
  accessToken: string;
  email: string;
  defaultSheetName?: string;
};

type EnsureUserSheetResult = {
  sheetId: string | null;
  created: boolean;
};

export async function ensureUserSheet(input: EnsureUserSheetInput): Promise<EnsureUserSheetResult> {
  if (!integrationPersistenceEnabled()) {
    return { sheetId: null, created: false };
  }

  const email = input.email.trim().toLowerCase();
  if (!email) {
    return { sheetId: null, created: false };
  }

  const existing = await getIntegrationByEmail(email);
  if (existing?.sheetId) {
    return { sheetId: existing.sheetId, created: false };
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: input.accessToken });
  const sheets = google.sheets({ version: "v4", auth });
  const tabTitle = input.defaultSheetName?.trim() || "Applications";

  const createdSheet = await sheets.spreadsheets.create({
    requestBody: {
      properties: {
        title: `Job Tracker - ${email}`,
      },
      sheets: [{ properties: { title: tabTitle } }],
    },
  });

  const spreadsheetId = createdSheet.data.spreadsheetId ?? null;
  if (!spreadsheetId) {
    return { sheetId: null, created: false };
  }

  const headers = [
    "Company",
    "Job Title",
    "Link",
    "Date Applied",
    "Status",
    "Follow-Up Date",
    "Journey",
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabTitle}!A1:G1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [headers],
    },
  });

  await upsertSheetMetadata({
    email,
    sheetId: spreadsheetId,
    sheetUrl: createdSheet.data.spreadsheetUrl ?? null,
  });

  return { sheetId: spreadsheetId, created: true };
}
