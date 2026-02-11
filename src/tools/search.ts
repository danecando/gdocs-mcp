import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient } from "../drive-client.js";
import { z } from "zod";
import { errorResponse, textResponse, formatDriveError, FILE_FIELDS } from "../types.js";

export function registerSearchTools(
  server: McpServer,
  drive: DriveClient,
): void {
  server.tool(
    "gdrive_search",
    "Search for files in Google Drive by name or content. Supports optional filters for file type, date range, and shared status.",
    {
      query: z.string().describe("Search query (searches file names and content)"),
      pageSize: z.number().min(1).max(100).default(20).optional()
        .describe("Number of results to return (1-100, default 20)"),
      fileType: z.enum(["document", "spreadsheet", "presentation", "folder", "pdf", "image", "video", "audio"]).optional()
        .describe("Filter by file type"),
      modifiedAfter: z.string().optional()
        .describe("Only files modified after this date (ISO 8601, e.g. 2024-01-01)"),
      sharedWithMe: z.boolean().optional()
        .describe("If true, only show files shared with you"),
    },
    async (params) => {
      try {
        const escapedQuery = params.query
          .replace(/\\/g, "\\\\")
          .replace(/'/g, "\\'");
        const clauses: string[] = [`fullText contains '${escapedQuery}'`];

        if (params.fileType) {
          const mimeMap: Record<string, string> = {
            document: "application/vnd.google-apps.document",
            spreadsheet: "application/vnd.google-apps.spreadsheet",
            presentation: "application/vnd.google-apps.presentation",
            folder: "application/vnd.google-apps.folder",
            pdf: "application/pdf",
            image: "image/",
            video: "video/",
            audio: "audio/",
          };
          const mime = mimeMap[params.fileType];
          if (mime.endsWith("/")) {
            clauses.push(`mimeType contains '${mime}'`);
          } else {
            clauses.push(`mimeType = '${mime}'`);
          }
        }

        if (params.modifiedAfter) {
          clauses.push(`modifiedTime > '${params.modifiedAfter}'`);
        }

        if (params.sharedWithMe) {
          clauses.push("sharedWithMe = true");
        }

        clauses.push("trashed = false");

        const res = await drive.files.list({
          q: clauses.join(" and "),
          pageSize: params.pageSize ?? 20,
          fields: `files(${FILE_FIELDS})`,
          orderBy: "modifiedTime desc",
        });

        const files = res.data.files ?? [];
        if (files.length === 0) {
          return textResponse(`No files found matching "${params.query}".`);
        }

        const lines = files.map((f: any) => {
          const size = f.size ? ` (${f.size} bytes)` : "";
          return `- ${f.name}${size}\n  ID: ${f.id}\n  Type: ${f.mimeType}\n  Modified: ${f.modifiedTime}`;
        });

        return textResponse(
          `Found ${files.length} file(s):\n\n${lines.join("\n\n")}`,
        );
      } catch (err) {
        return errorResponse(`Search failed: ${formatDriveError(err)}`);
      }
    },
  );
}
