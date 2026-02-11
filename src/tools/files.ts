import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient } from "../drive-client.js";
import { z } from "zod";
import {
  errorResponse,
  textResponse,
  formatDriveError,
  FILE_FIELDS,
  FILE_FIELDS_FULL,
  EXPORT_FORMATS,
} from "../types.js";

export function registerFileTools(
  server: McpServer,
  drive: DriveClient,
): void {
  // --- gdrive_create_file ---
  server.tool(
    "gdrive_create_file",
    "Create a new file or folder in Google Drive. For folders, set mimeType to 'application/vnd.google-apps.folder'. For Google Docs, set mimeType to 'application/vnd.google-apps.document' and provide HTML content. Text content only (no binary uploads).",
    {
      name: z.string().describe("File or folder name"),
      mimeType: z.string().optional()
        .describe("MIME type. Use 'application/vnd.google-apps.folder' for folders, 'application/vnd.google-apps.document' for Docs, etc."),
      content: z.string().optional()
        .describe("Text content for the file. For Google Docs, provide HTML. For Sheets, provide CSV."),
      parentId: z.string().optional()
        .describe("Parent folder ID. Omit to create in root."),
      description: z.string().optional()
        .describe("File description"),
    },
    async (params) => {
      try {
        const requestBody: any = {
          name: params.name,
        };
        if (params.mimeType) requestBody.mimeType = params.mimeType;
        if (params.parentId) requestBody.parents = [params.parentId];
        if (params.description) requestBody.description = params.description;

        let media: { mimeType: string; body: string } | undefined;
        if (params.content) {
          let uploadMime = "text/plain";
          if (params.mimeType === "application/vnd.google-apps.document") {
            uploadMime = "text/html";
          } else if (params.mimeType === "application/vnd.google-apps.spreadsheet") {
            uploadMime = "text/csv";
          } else if (params.mimeType) {
            uploadMime = params.mimeType;
          }
          media = {
            mimeType: uploadMime,
            body: params.content,
          };
        }

        const res = await drive.files.create({
          requestBody,
          media,
          fields: FILE_FIELDS,
        });

        return textResponse(
          `Created ${res.data.mimeType === "application/vnd.google-apps.folder" ? "folder" : "file"}: "${res.data.name}"\nID: ${res.data.id}\nType: ${res.data.mimeType}\nLink: ${res.data.webViewLink ?? "N/A"}`,
        );
      } catch (err) {
        return errorResponse(`Failed to create file: ${formatDriveError(err)}`);
      }
    },
  );

  // --- gdrive_get_file_metadata ---
  server.tool(
    "gdrive_get_file_metadata",
    "Get detailed metadata for a file or folder, including name, size, parents, timestamps, sharing status, and web link.",
    {
      fileId: z.string().describe("The file ID"),
    },
    async (params) => {
      try {
        const res = await drive.files.get({
          fileId: params.fileId,
          fields: FILE_FIELDS_FULL,
        });
        const f = res.data;
        const lines = [
          `Name: ${f.name}`,
          `ID: ${f.id}`,
          `Type: ${f.mimeType}`,
          `Size: ${f.size ?? "N/A"} bytes`,
          `Created: ${f.createdTime}`,
          `Modified: ${f.modifiedTime}`,
          `Parents: ${f.parents?.join(", ") ?? "root"}`,
          `Description: ${f.description ?? ""}`,
          `Trashed: ${f.trashed}`,
          `Shared: ${f.shared}`,
          `Starred: ${f.starred}`,
          `Link: ${f.webViewLink ?? "N/A"}`,
        ];
        if (f.owners) {
          lines.push(`Owners: ${f.owners.map((o: any) => o.displayName ?? o.emailAddress).join(", ")}`);
        }
        return textResponse(lines.join("\n"));
      } catch (err) {
        return errorResponse(`Failed to get metadata: ${formatDriveError(err)}`);
      }
    },
  );

  // --- gdrive_update_file ---
  server.tool(
    "gdrive_update_file",
    "Update a file's content and/or metadata. Can rename, change description, or replace text content. Text content only.",
    {
      fileId: z.string().describe("The file ID to update"),
      name: z.string().optional().describe("New file name"),
      description: z.string().optional().describe("New description"),
      content: z.string().optional().describe("New text content (replaces existing content)"),
      mimeType: z.string().optional().describe("MIME type for the content upload"),
    },
    async (params) => {
      try {
        const requestBody: any = {};
        if (params.name) requestBody.name = params.name;
        if (params.description !== undefined)
          requestBody.description = params.description;

        let media: { mimeType: string; body: string } | undefined;
        if (params.content) {
          media = {
            mimeType: params.mimeType ?? "text/plain",
            body: params.content,
          };
        }

        const res = await drive.files.update({
          fileId: params.fileId,
          requestBody,
          media,
          fields: FILE_FIELDS,
        });

        return textResponse(
          `Updated file: "${res.data.name}"\nID: ${res.data.id}\nModified: ${res.data.modifiedTime}`,
        );
      } catch (err) {
        return errorResponse(`Failed to update file: ${formatDriveError(err)}`);
      }
    },
  );

  // --- gdrive_delete_file ---
  server.tool(
    "gdrive_delete_file",
    "Permanently delete a file. This is irreversible. Consider using gdrive_trash_file instead for recoverable deletion.",
    {
      fileId: z.string().describe("The file ID to permanently delete"),
    },
    async (params) => {
      try {
        await drive.files.delete({ fileId: params.fileId });
        return textResponse(`File ${params.fileId} permanently deleted.`);
      } catch (err) {
        return errorResponse(`Failed to delete file: ${formatDriveError(err)}`);
      }
    },
  );

  // --- gdrive_copy_file ---
  server.tool(
    "gdrive_copy_file",
    "Create a copy of a file. Optionally give the copy a new name or place it in a different folder.",
    {
      fileId: z.string().describe("The file ID to copy"),
      name: z.string().optional().describe("Name for the copy (defaults to 'Copy of <original>')"),
      parentId: z.string().optional().describe("Parent folder ID for the copy"),
    },
    async (params) => {
      try {
        const requestBody: any = {};
        if (params.name) requestBody.name = params.name;
        if (params.parentId) requestBody.parents = [params.parentId];

        const res = await drive.files.copy({
          fileId: params.fileId,
          requestBody,
          fields: FILE_FIELDS,
        });

        return textResponse(
          `Copied to: "${res.data.name}"\nNew ID: ${res.data.id}\nType: ${res.data.mimeType}`,
        );
      } catch (err) {
        return errorResponse(`Failed to copy file: ${formatDriveError(err)}`);
      }
    },
  );

  // --- gdrive_move_file ---
  server.tool(
    "gdrive_move_file",
    "Move a file to a different folder.",
    {
      fileId: z.string().describe("The file ID to move"),
      newParentId: z.string().describe("The destination folder ID"),
    },
    async (params) => {
      try {
        // Get current parents
        const file = await drive.files.get({
          fileId: params.fileId,
          fields: "parents",
        });
        const previousParents = file.data.parents?.join(",") ?? "";

        const res = await drive.files.update({
          fileId: params.fileId,
          addParents: params.newParentId,
          removeParents: previousParents,
          fields: FILE_FIELDS,
        });

        return textResponse(
          `Moved "${res.data.name}" to folder ${params.newParentId}.\nID: ${res.data.id}`,
        );
      } catch (err) {
        return errorResponse(`Failed to move file: ${formatDriveError(err)}`);
      }
    },
  );

  // --- gdrive_trash_file ---
  server.tool(
    "gdrive_trash_file",
    "Move a file to the trash. The file can be restored later with gdrive_untrash_file.",
    {
      fileId: z.string().describe("The file ID to trash"),
    },
    async (params) => {
      try {
        const res = await drive.files.update({
          fileId: params.fileId,
          requestBody: { trashed: true },
          fields: FILE_FIELDS,
        });
        return textResponse(
          `Moved "${res.data.name}" to trash.\nID: ${res.data.id}`,
        );
      } catch (err) {
        return errorResponse(`Failed to trash file: ${formatDriveError(err)}`);
      }
    },
  );

  // --- gdrive_untrash_file ---
  server.tool(
    "gdrive_untrash_file",
    "Restore a file from the trash.",
    {
      fileId: z.string().describe("The file ID to restore from trash"),
    },
    async (params) => {
      try {
        const res = await drive.files.update({
          fileId: params.fileId,
          requestBody: { trashed: false },
          fields: FILE_FIELDS,
        });
        return textResponse(
          `Restored "${res.data.name}" from trash.\nID: ${res.data.id}`,
        );
      } catch (err) {
        return errorResponse(`Failed to untrash file: ${formatDriveError(err)}`);
      }
    },
  );

  // --- gdrive_list_files ---
  server.tool(
    "gdrive_list_files",
    "List files in Google Drive. Supports filtering by folder, ordering, custom queries, and pagination.",
    {
      folderId: z.string().optional()
        .describe("List files in this folder (ID). Omit to list from all of Drive."),
      pageSize: z.number().min(1).max(100).default(20).optional()
        .describe("Number of results (1-100, default 20)"),
      orderBy: z.string().optional()
        .describe("Sort order, e.g. 'modifiedTime desc', 'name', 'createdTime desc'"),
      query: z.string().optional()
        .describe("Custom Drive API query (q parameter), e.g. \"mimeType='application/pdf'\""),
      pageToken: z.string().optional()
        .describe("Page token for retrieving subsequent pages"),
      includeTrash: z.boolean().optional()
        .describe("If true, include trashed files in results"),
    },
    async (params) => {
      try {
        const clauses: string[] = [];
        if (params.folderId) {
          clauses.push(`'${params.folderId}' in parents`);
        }
        if (params.query) {
          clauses.push(params.query);
        }
        if (!params.includeTrash) {
          clauses.push("trashed = false");
        }

        const res = await drive.files.list({
          q: clauses.length > 0 ? clauses.join(" and ") : undefined,
          pageSize: params.pageSize ?? 20,
          orderBy: params.orderBy ?? "modifiedTime desc",
          pageToken: params.pageToken,
          fields: `nextPageToken, files(${FILE_FIELDS})`,
        });

        const files = res.data.files ?? [];
        if (files.length === 0) {
          return textResponse("No files found.");
        }

        const lines = files.map((f: any) => {
          const size = f.size ? ` (${f.size} bytes)` : "";
          const trashed = f.trashed ? " [TRASHED]" : "";
          return `- ${f.name}${size}${trashed}\n  ID: ${f.id}\n  Type: ${f.mimeType}\n  Modified: ${f.modifiedTime}`;
        });

        let result = `Files (${files.length}):\n\n${lines.join("\n\n")}`;
        if (res.data.nextPageToken) {
          result += `\n\nMore results available. Use pageToken: "${res.data.nextPageToken}"`;
        }
        return textResponse(result);
      } catch (err) {
        return errorResponse(`Failed to list files: ${formatDriveError(err)}`);
      }
    },
  );

  // --- gdrive_export_file ---
  server.tool(
    "gdrive_export_file",
    "Export a Google Workspace file (Doc, Sheet, Slide, Drawing) to a different format. Supported formats vary by file type: Docs (pdf, docx, txt, html, markdown, epub, rtf, odt), Sheets (pdf, xlsx, csv, tsv, ods, html), Slides (pdf, pptx, txt, odp), Drawings (pdf, png, jpg, svg).",
    {
      fileId: z.string().describe("The Google Workspace file ID to export"),
      format: z.string().describe("Export format (e.g. 'pdf', 'docx', 'csv', 'txt', 'html', 'markdown', 'png')"),
    },
    async (params) => {
      try {
        // Get file mime type first
        const file = await drive.files.get({
          fileId: params.fileId,
          fields: "mimeType, name",
        });

        const mimeType = file.data.mimeType ?? "";
        const formats = EXPORT_FORMATS[mimeType];
        if (!formats) {
          return errorResponse(
            `File type "${mimeType}" is not a Google Workspace file and cannot be exported. Only Docs, Sheets, Slides, and Drawings support export.`,
          );
        }

        const exportMime = formats[params.format.toLowerCase()];
        if (!exportMime) {
          return errorResponse(
            `Format "${params.format}" is not supported for ${mimeType}. Supported formats: ${Object.keys(formats).join(", ")}`,
          );
        }

        const res = await drive.files.export({
          fileId: params.fileId,
          mimeType: exportMime,
        });

        return textResponse(
          `Exported "${file.data.name}" as ${params.format}:\n\n${String(res.data)}`,
        );
      } catch (err) {
        return errorResponse(`Failed to export file: ${formatDriveError(err)}`);
      }
    },
  );

}
