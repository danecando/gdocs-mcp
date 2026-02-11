import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DriveClient } from "./drive-client.js";
import { EXPORT_MIME_MAP } from "./types.js";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function registerResources(
  server: McpServer,
  drive: DriveClient,
): void {
  server.resource(
    "gdrive-files",
    "gdrive:///{fileId}",
    { description: "Google Drive files accessible by file ID" },
    async (uri) => {
      const fileId = uri.pathname.replace(/^\//, "");

      const file = await drive.files.get({ fileId, fields: "mimeType" });

      if (file.data.mimeType?.startsWith("application/vnd.google-apps")) {
        const exportMimeType =
          EXPORT_MIME_MAP[file.data.mimeType] ?? "text/plain";

        const res = await drive.files.export({
          fileId,
          mimeType: exportMimeType,
        });

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: exportMimeType,
              text: String(res.data),
            },
          ],
        };
      }

      const res = await drive.files.get({ fileId, alt: "media" });
      const mimeType = file.data.mimeType || "application/octet-stream";

      if (mimeType.startsWith("text/") || mimeType === "application/json") {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType,
              text: new TextDecoder().decode(res.data as ArrayBuffer),
            },
          ],
        };
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType,
            blob: arrayBufferToBase64(res.data as ArrayBuffer),
          },
        ],
      };
    },
  );
}
