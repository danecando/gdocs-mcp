import OAuthProvider, {
  GrantType,
  type TokenExchangeCallbackOptions,
} from "@cloudflare/workers-oauth-provider";
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
  userId?: string;
  googleClientId?: string;
  googleClientSecret?: string;
};

type GoogleTokenRefreshResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

async function refreshGoogleAccessToken(
  options: TokenExchangeCallbackOptions,
) {
  const props = options.props as Props;

  if (!props?.refreshToken || !props.googleClientId || !props.googleClientSecret) {
    throw new Error("Missing Google OAuth credentials in grant props");
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: props.googleClientId,
      client_secret: props.googleClientSecret,
      refresh_token: props.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const data = (await tokenRes.json()) as GoogleTokenRefreshResponse;
  if (!tokenRes.ok || !data.access_token || !data.expires_in) {
    const code = data.error ?? "unknown_error";
    const description = data.error_description ?? "Google token refresh failed";
    throw new Error(`${code}: ${description}`);
  }

  const now = Date.now();
  const nextProps: Props = {
    ...props,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? props.refreshToken,
    expiresAt: now + data.expires_in * 1000,
    userId: props.userId ?? options.userId,
  };

  return {
    accessTokenProps: nextProps,
    newProps: nextProps,
    accessTokenTTL: Math.max(60, data.expires_in - 60),
  };
}

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
  accessTokenTTL: 3600,
  tokenExchangeCallback: async (options) => {
    if (options.grantType !== GrantType.REFRESH_TOKEN) {
      return;
    }
    return refreshGoogleAccessToken(options);
  },
});
