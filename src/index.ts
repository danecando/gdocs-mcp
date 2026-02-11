import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DriveClient } from "./drive-client.js";
import GoogleHandler from "./google-handler.js";
import { registerResources } from "./resources.js";
import { registerFileTools } from "./tools/files.js";
import { registerSearchTools } from "./tools/search.js";
import { registerSheetTools } from "./tools/sheets.js";

export type Props = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export class GDriveMCP extends McpAgent<Env, {}, Props> {
  server = new McpServer({
    name: "gdocs-mcp",
    version: "1.0.0",
  });

  async init() {
    if (!this.props) {
      throw new Error("Missing authentication props");
    }

    const drive = new DriveClient({
      accessToken: this.props.accessToken,
      refreshToken: this.props.refreshToken,
      clientId: this.env.GOOGLE_CLIENT_ID,
      clientSecret: this.env.GOOGLE_CLIENT_SECRET,
      expiresAt: this.props.expiresAt,
    });

    registerResources(this.server, drive);
    registerSearchTools(this.server, drive);
    registerFileTools(this.server, drive);
    registerSheetTools(this.server, drive);
  }
}

export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: GDriveMCP.serve("/mcp"),
  defaultHandler: GoogleHandler as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
