import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL =
  "https://www.googleapis.com/oauth2/v2/userinfo";
const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

type HandlerEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

export default {
  async fetch(request: Request, env: HandlerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/authorize") {
      return handleAuthorize(request, env);
    }

    if (url.pathname === "/callback") {
      return handleCallback(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
};

async function handleAuthorize(
  request: Request,
  env: Env & { OAUTH_PROVIDER: OAuthHelpers },
): Promise<Response> {
  const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);

  // Store the parsed MCP auth request in KV so we can retrieve it in callback
  const stateKey = crypto.randomUUID();
  await env.OAUTH_KV.put(
    `google_oauth_state:${stateKey}`,
    JSON.stringify(oauthReq),
    { expirationTtl: 600 },
  );

  const googleUrl = new URL(GOOGLE_AUTH_URL);
  googleUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  googleUrl.searchParams.set(
    "redirect_uri",
    `${new URL(request.url).origin}/callback`,
  );
  googleUrl.searchParams.set("response_type", "code");
  googleUrl.searchParams.set("scope", SCOPES);
  googleUrl.searchParams.set("access_type", "offline");
  googleUrl.searchParams.set("prompt", "consent");
  googleUrl.searchParams.set("state", stateKey);

  return Response.redirect(googleUrl.toString(), 302);
}

async function handleCallback(
  request: Request,
  env: Env & { OAUTH_PROVIDER: OAuthHelpers },
): Promise<Response> {
  const url = new URL(request.url);

  const error = url.searchParams.get("error");
  if (error) {
    const desc = url.searchParams.get("error_description") ?? error;
    return new Response(`Google OAuth error: ${desc}`, { status: 400 });
  }

  const code = url.searchParams.get("code");
  const stateKey = url.searchParams.get("state");

  if (!code || !stateKey) {
    return new Response("Missing code or state parameter", { status: 400 });
  }

  // Retrieve the original MCP auth request
  const stored = await env.OAUTH_KV.get(`google_oauth_state:${stateKey}`);
  if (!stored) {
    return new Response("Invalid or expired OAuth state", { status: 400 });
  }
  await env.OAUTH_KV.delete(`google_oauth_state:${stateKey}`);
  const oauthReq = JSON.parse(stored);

  // Exchange the Google auth code for tokens
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${url.origin}/callback`,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    return new Response(`Google token exchange failed: ${text}`, {
      status: 502,
    });
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  if (!tokens.refresh_token) {
    return new Response(
      "Google did not return a refresh token. Please revoke access at https://myaccount.google.com/permissions and try again.",
      { status: 400 },
    );
  }

  // Get user info so we have a stable userId
  const userRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userRes.ok) {
    return new Response("Failed to fetch Google user info", { status: 502 });
  }

  const userInfo = (await userRes.json()) as {
    id: string;
    email: string;
    name: string;
  };

  // Complete the MCP OAuth flow — props are encrypted and delivered to
  // the McpAgent as this.props on every authenticated request.
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReq,
    userId: userInfo.id,
    metadata: { email: userInfo.email, name: userInfo.name },
    scope: oauthReq.scope,
    props: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    },
  });

  return Response.redirect(redirectTo, 302);
}
