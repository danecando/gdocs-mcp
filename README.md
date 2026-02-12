# gdocs-mcp

A remote MCP (Model Context Protocol) server for Google Drive & Google Sheets, deployed on Cloudflare Workers. Authenticates via OAuth 2.0 and exposes Google Drive files and spreadsheets as MCP tools and resources.

## Features

- **Google Drive file management** — create, read, update, copy, move, trash, delete, and export files
- **Google Sheets operations** — read/write cell values, manage sheets/tabs, create spreadsheets
- **Full-text search** across Drive with filters for file type, date, and sharing status
- **MCP resource access** — read any Drive file by ID via the `gdrive:///` URI scheme
- **OAuth 2.0 authentication** — Google sign-in handled automatically with token refresh
- **Runs on Cloudflare Workers** — serverless, globally distributed, zero cold starts

## Tools

### Drive — File Operations

| Tool                       | Description                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `gdrive_create_file`       | Create a new file or folder (text content, Google Docs via HTML, Sheets via CSV)        |
| `gdrive_get_file_metadata` | Get detailed metadata for a file or folder                                              |
| `gdrive_update_file`       | Update a file's content and/or metadata                                                 |
| `gdrive_delete_file`       | Permanently delete a file                                                               |
| `gdrive_copy_file`         | Copy a file, optionally to a different folder                                           |
| `gdrive_move_file`         | Move a file to a different folder                                                       |
| `gdrive_trash_file`        | Move a file to the trash (recoverable)                                                  |
| `gdrive_untrash_file`      | Restore a file from the trash                                                           |
| `gdrive_list_files`        | List files with folder, ordering, query, and pagination support                         |
| `gdrive_export_file`       | Export a Google Workspace file (Docs, Sheets, Slides, Drawings) to PDF, DOCX, CSV, etc. |

### Drive — Search

| Tool            | Description                                                                   |
| --------------- | ----------------------------------------------------------------------------- |
| `gdrive_search` | Search files by name or content with optional type, date, and sharing filters |

### Google Sheets

| Tool                         | Description                                           |
| ---------------------------- | ----------------------------------------------------- |
| `gsheets_get_spreadsheet`    | Get spreadsheet structure (sheets/tabs, named ranges) |
| `gsheets_get_values`         | Read cell values from a range (A1 notation)           |
| `gsheets_batch_get_values`   | Read values from multiple ranges in one request       |
| `gsheets_update_values`      | Write values to a range                               |
| `gsheets_append_values`      | Append rows after the last row with content           |
| `gsheets_clear_values`       | Clear cell values in a range (preserves formatting)   |
| `gsheets_add_sheet`          | Add a new sheet/tab to a spreadsheet                  |
| `gsheets_delete_sheet`       | Delete a sheet/tab by its numeric ID                  |
| `gsheets_create_spreadsheet` | Create a new spreadsheet with optional tab names      |

### Resources

| URI Pattern          | Description                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `gdrive:///{fileId}` | Access any Google Drive file by ID. Google Workspace files are auto-exported (Docs → Markdown, Sheets → CSV, etc.) |

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/)
- A [Cloudflare](https://dash.cloudflare.com/) account
- A [Google Cloud](https://console.cloud.google.com/) project with the **Google Drive API** and **Google Sheets API** enabled
- OAuth 2.0 credentials (Client ID and Client Secret) configured with the callback URL `https://<your-worker>.workers.dev/callback`

## Setup

1. **Clone the repository**

   ```sh
   git clone https://github.com/danecando/gdocs-mcp.git
   cd gdocs-mcp
   ```

2. **Install dependencies**

   ```sh
   pnpm install
   ```

3. **Configure secrets**

   Create a `.dev.vars` file for local development:

   ```
   GOOGLE_CLIENT_ID=<your-google-client-id>
   GOOGLE_CLIENT_SECRET=<your-google-client-secret>
   ```

   For production, set these as Wrangler secrets:

   ```sh
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```

4. **Run locally**

   ```sh
   pnpm dev
   ```

5. **Deploy**

   ```sh
   pnpm deploy
   ```

## Connecting an MCP Client

Once deployed (or running locally), point your MCP client at the server URL:

```
https://<your-worker>.workers.dev/mcp
```

The server uses OAuth 2.0 — your MCP client will be redirected to Google for authentication on first connection.

## Tech Stack

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) + [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk) — MCP server SDK
- [agents](https://www.npmjs.com/package/agents) — Cloudflare's MCP agent framework
- [@cloudflare/workers-oauth-provider](https://www.npmjs.com/package/@cloudflare/workers-oauth-provider) — OAuth 2.0 provider
- [Zod](https://zod.dev/) — schema validation
- TypeScript

## License

MIT
