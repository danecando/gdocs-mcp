import { DriveApiError } from "./drive-client.js";

/** Default fields returned for file metadata queries */
export const FILE_FIELDS =
  "id, name, mimeType, modifiedTime, size, parents, webViewLink, description, trashed, createdTime";

/** Fields for detailed single-file metadata */
export const FILE_FIELDS_FULL =
  "id, name, mimeType, modifiedTime, size, parents, webViewLink, description, trashed, createdTime, owners, shared, capabilities, starred";

/** Google Workspace MIME types and their preferred export targets */
export const EXPORT_MIME_MAP: Record<string, string> = {
  "application/vnd.google-apps.document": "text/markdown",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.drawing": "image/png",
};

/** Supported export formats for gdrive_export_file */
export const EXPORT_FORMATS: Record<string, Record<string, string>> = {
  "application/vnd.google-apps.document": {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    txt: "text/plain",
    html: "text/html",
    markdown: "text/markdown",
    md: "text/markdown",
    epub: "application/epub+zip",
    rtf: "application/rtf",
    odt: "application/vnd.oasis.opendocument.text",
  },
  "application/vnd.google-apps.spreadsheet": {
    pdf: "application/pdf",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    csv: "text/csv",
    tsv: "text/tab-separated-values",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    html: "text/html",
  },
  "application/vnd.google-apps.presentation": {
    pdf: "application/pdf",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain",
    odp: "application/vnd.oasis.opendocument.presentation",
  },
  "application/vnd.google-apps.drawing": {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    svg: "image/svg+xml",
  },
};

/** Helper to format error responses for MCP tool handlers */
export function errorResponse(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

/** Helper to format success text responses */
export function textResponse(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

/** Extract a user-friendly error message from a Drive API error */
export function formatDriveError(err: unknown): string {
  if (err instanceof DriveApiError) {
    switch (err.status) {
      case 401:
        return `Authentication expired. Please check your credentials. (${err.message})`;
      case 403:
        return `Permission denied. You don't have access to this resource. (${err.message})`;
      case 404:
        return `Not found. The file or resource does not exist or you don't have access. (${err.message})`;
      case 400:
        return `Bad request: ${err.message}`;
      default:
        return err.message;
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
