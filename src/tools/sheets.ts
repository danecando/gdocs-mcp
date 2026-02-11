import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient } from "../drive-client.js";
import { z } from "zod";
import { errorResponse, textResponse, formatDriveError } from "../types.js";

export function registerSheetTools(
  server: McpServer,
  drive: DriveClient,
): void {
  // --- gsheets_get_spreadsheet ---
  server.tool(
    "gsheets_get_spreadsheet",
    "Get spreadsheet structure including title, sheets/tabs (with IDs, names, row/column counts), and named ranges.",
    {
      spreadsheetId: z.string().describe("The spreadsheet ID"),
    },
    async (params) => {
      try {
        const res = await drive.spreadsheets.get(
          params.spreadsheetId,
          "spreadsheetId,properties.title,sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount))),namedRanges",
        );

        const data = res.data;
        const lines: string[] = [
          `Title: ${data.properties?.title ?? "Untitled"}`,
          `Spreadsheet ID: ${data.spreadsheetId}`,
          "",
          "=== Sheets ===",
        ];

        const sheets = data.sheets ?? [];
        for (const sheet of sheets) {
          const p = sheet.properties;
          const grid = p?.gridProperties;
          lines.push(
            `- "${p?.title}" (ID: ${p?.sheetId}, index: ${p?.index})`,
            `  Rows: ${grid?.rowCount ?? "?"}, Columns: ${grid?.columnCount ?? "?"}`,
          );
        }

        if (data.namedRanges && data.namedRanges.length > 0) {
          lines.push("", "=== Named Ranges ===");
          for (const nr of data.namedRanges) {
            lines.push(`- ${nr.name} (ID: ${nr.namedRangeId})`);
          }
        }

        return textResponse(lines.join("\n"));
      } catch (err) {
        return errorResponse(
          `Failed to get spreadsheet: ${formatDriveError(err)}`,
        );
      }
    },
  );

  // --- gsheets_get_values ---
  server.tool(
    "gsheets_get_values",
    "Read cell values from a spreadsheet range using A1 notation (e.g. 'Sheet1!A1:D10', 'A1:B5'). Returns values formatted as a table.",
    {
      spreadsheetId: z.string().describe("The spreadsheet ID"),
      range: z
        .string()
        .describe("A1 notation range, e.g. 'Sheet1!A1:D10' or 'A:C'"),
    },
    async (params) => {
      try {
        const res = await drive.values.get(
          params.spreadsheetId,
          params.range,
        );

        const rows: any[][] = res.data.values ?? [];
        if (rows.length === 0) {
          return textResponse(`Range ${res.data.range ?? params.range}: (empty)`);
        }

        const table = rows
          .map((row, i) => `${i + 1}\t| ${row.join("\t| ")}`)
          .join("\n");
        return textResponse(
          `Range: ${res.data.range ?? params.range} (${rows.length} rows)\n\n${table}`,
        );
      } catch (err) {
        return errorResponse(
          `Failed to get values: ${formatDriveError(err)}`,
        );
      }
    },
  );

  // --- gsheets_batch_get_values ---
  server.tool(
    "gsheets_batch_get_values",
    "Read values from multiple ranges in a single request. More efficient than multiple individual reads.",
    {
      spreadsheetId: z.string().describe("The spreadsheet ID"),
      ranges: z
        .array(z.string())
        .min(1)
        .describe("Array of A1 notation ranges to read"),
    },
    async (params) => {
      try {
        const res = await drive.values.batchGet(
          params.spreadsheetId,
          params.ranges,
        );

        const valueRanges = res.data.valueRanges ?? [];
        const sections: string[] = [];

        for (const vr of valueRanges) {
          const rows: any[][] = vr.values ?? [];
          if (rows.length === 0) {
            sections.push(`=== ${vr.range} === (empty)`);
          } else {
            const table = rows
              .map((row: any[], i: number) => `${i + 1}\t| ${row.join("\t| ")}`)
              .join("\n");
            sections.push(`=== ${vr.range} === (${rows.length} rows)\n${table}`);
          }
        }

        return textResponse(sections.join("\n\n"));
      } catch (err) {
        return errorResponse(
          `Failed to batch get values: ${formatDriveError(err)}`,
        );
      }
    },
  );

  // --- gsheets_update_values ---
  server.tool(
    "gsheets_update_values",
    "Write a 2D array of values to a spreadsheet range. Overwrites existing data in the range.",
    {
      spreadsheetId: z.string().describe("The spreadsheet ID"),
      range: z
        .string()
        .describe("A1 notation range to write to, e.g. 'Sheet1!A1:C3'"),
      values: z
        .array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
        .describe("2D array of values (rows of cells)"),
      valueInputOption: z
        .enum(["RAW", "USER_ENTERED"])
        .default("USER_ENTERED")
        .describe(
          "How to interpret input: RAW (stored as-is) or USER_ENTERED (parsed as if typed into the UI, e.g. formulas and formatting are applied)",
        ),
    },
    async (params) => {
      try {
        const res = await drive.values.update(
          params.spreadsheetId,
          params.range,
          params.values,
          params.valueInputOption,
        );

        return textResponse(
          `Updated ${res.data.updatedRange ?? params.range}\nCells updated: ${res.data.updatedCells ?? "N/A"}\nRows: ${res.data.updatedRows ?? "N/A"}, Columns: ${res.data.updatedColumns ?? "N/A"}`,
        );
      } catch (err) {
        return errorResponse(
          `Failed to update values: ${formatDriveError(err)}`,
        );
      }
    },
  );

  // --- gsheets_append_values ---
  server.tool(
    "gsheets_append_values",
    "Append rows of data after the last row with content in a sheet. Useful for adding new entries without knowing the exact next row.",
    {
      spreadsheetId: z.string().describe("The spreadsheet ID"),
      range: z
        .string()
        .describe(
          "A1 notation range indicating the sheet/table to append to, e.g. 'Sheet1!A:E' or 'Sheet1'",
        ),
      values: z
        .array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
        .describe("2D array of rows to append"),
      valueInputOption: z
        .enum(["RAW", "USER_ENTERED"])
        .default("USER_ENTERED")
        .describe(
          "How to interpret input: RAW (stored as-is) or USER_ENTERED (parsed as if typed into the UI)",
        ),
    },
    async (params) => {
      try {
        const res = await drive.values.append(
          params.spreadsheetId,
          params.range,
          params.values,
          params.valueInputOption,
        );

        const updates = res.data.updates;
        return textResponse(
          `Appended to ${updates?.updatedRange ?? params.range}\nRows added: ${updates?.updatedRows ?? "N/A"}\nCells updated: ${updates?.updatedCells ?? "N/A"}`,
        );
      } catch (err) {
        return errorResponse(
          `Failed to append values: ${formatDriveError(err)}`,
        );
      }
    },
  );

  // --- gsheets_clear_values ---
  server.tool(
    "gsheets_clear_values",
    "Clear all cell values in a range. Formatting is preserved; only values are removed.",
    {
      spreadsheetId: z.string().describe("The spreadsheet ID"),
      range: z
        .string()
        .describe("A1 notation range to clear, e.g. 'Sheet1!A1:D10'"),
    },
    async (params) => {
      try {
        const res = await drive.values.clear(
          params.spreadsheetId,
          params.range,
        );
        return textResponse(
          `Cleared range: ${res.data.clearedRange ?? params.range}`,
        );
      } catch (err) {
        return errorResponse(
          `Failed to clear values: ${formatDriveError(err)}`,
        );
      }
    },
  );

  // --- gsheets_add_sheet ---
  server.tool(
    "gsheets_add_sheet",
    "Add a new sheet (tab) to an existing spreadsheet.",
    {
      spreadsheetId: z.string().describe("The spreadsheet ID"),
      title: z.string().describe("Name for the new sheet tab"),
    },
    async (params) => {
      try {
        const res = await drive.spreadsheets.batchUpdate(
          params.spreadsheetId,
          {
            requests: [
              { addSheet: { properties: { title: params.title } } },
            ],
          },
        );

        const reply = res.data.replies?.[0]?.addSheet?.properties;
        return textResponse(
          `Added sheet: "${reply?.title ?? params.title}"\nSheet ID: ${reply?.sheetId ?? "N/A"}\nIndex: ${reply?.index ?? "N/A"}`,
        );
      } catch (err) {
        return errorResponse(
          `Failed to add sheet: ${formatDriveError(err)}`,
        );
      }
    },
  );

  // --- gsheets_delete_sheet ---
  server.tool(
    "gsheets_delete_sheet",
    "Delete a sheet (tab) from a spreadsheet by its numeric sheet ID. Use gsheets_get_spreadsheet to find sheet IDs.",
    {
      spreadsheetId: z.string().describe("The spreadsheet ID"),
      sheetId: z
        .number()
        .describe(
          "Numeric sheet ID to delete (from gsheets_get_spreadsheet, not the sheet name)",
        ),
    },
    async (params) => {
      try {
        await drive.spreadsheets.batchUpdate(params.spreadsheetId, {
          requests: [{ deleteSheet: { sheetId: params.sheetId } }],
        });
        return textResponse(
          `Deleted sheet with ID ${params.sheetId} from spreadsheet ${params.spreadsheetId}.`,
        );
      } catch (err) {
        return errorResponse(
          `Failed to delete sheet: ${formatDriveError(err)}`,
        );
      }
    },
  );

  // --- gsheets_create_spreadsheet ---
  server.tool(
    "gsheets_create_spreadsheet",
    "Create a new Google Sheets spreadsheet. Optionally specify sheet/tab names to include.",
    {
      title: z.string().describe("Title for the new spreadsheet"),
      sheetNames: z
        .array(z.string())
        .optional()
        .describe(
          "Optional list of sheet/tab names to create. Defaults to a single 'Sheet1'.",
        ),
    },
    async (params) => {
      try {
        const requestBody: any = {
          properties: { title: params.title },
        };

        if (params.sheetNames && params.sheetNames.length > 0) {
          requestBody.sheets = params.sheetNames.map(
            (name: string, index: number) => ({
              properties: { title: name, index },
            }),
          );
        }

        const res = await drive.spreadsheets.create(
          requestBody,
          "spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title)",
        );

        const data = res.data;
        const sheets = (data.sheets ?? [])
          .map(
            (s: any) =>
              `- "${s.properties?.title}" (ID: ${s.properties?.sheetId})`,
          )
          .join("\n");

        return textResponse(
          `Created spreadsheet: "${data.properties?.title}"\nID: ${data.spreadsheetId}\nURL: ${data.spreadsheetUrl}\n\nSheets:\n${sheets}`,
        );
      } catch (err) {
        return errorResponse(
          `Failed to create spreadsheet: ${formatDriveError(err)}`,
        );
      }
    },
  );
}
