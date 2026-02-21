const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com/drive/v3";
const UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export class DriveApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "DriveApiError";
  }
}

export interface DriveClientConfig {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  expiresAt?: number;
}

export class DriveClient {
  private currentAccessToken: string;
  private tokenExpiry: number;

  constructor(private config: DriveClientConfig) {
    this.currentAccessToken = config.accessToken;
    this.tokenExpiry = config.expiresAt ?? 0;
  }

  private async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.currentAccessToken && Date.now() < this.tokenExpiry) {
      return this.currentAccessToken;
    }

    if (!this.config.refreshToken) {
      throw new DriveApiError(
        401,
        "Access token expired and no refresh token available",
      );
    }

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      if (res.status === 400 && errorText.includes("invalid_grant")) {
        throw new DriveApiError(
          401,
          `Google refresh token is invalid or revoked (${errorText})`,
        );
      }
      throw new DriveApiError(
        res.status,
        `Token refresh failed: ${errorText}`,
      );
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };
    this.currentAccessToken = data.access_token;
    if (data.refresh_token) {
      this.config.refreshToken = data.refresh_token;
    }
    // Refresh 60s before expiry
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return this.currentAccessToken;
  }

  private async request(
    url: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const makeRequest = async (token: string) => {
      const headers = new Headers(options.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return fetch(url, { ...options, headers });
    };

    let token = await this.getAccessToken();
    let res = await makeRequest(token);

    // If Google reports an auth failure, force a token refresh and retry once.
    if (res.status === 401) {
      token = await this.getAccessToken(true);
      res = await makeRequest(token);
    }

    if (!res.ok) {
      let message: string;
      try {
        const data = (await res.json()) as any;
        message = data?.error?.message ?? res.statusText;
      } catch {
        message = res.statusText;
      }
      throw new DriveApiError(res.status, message);
    }

    return res;
  }

  private apiUrl(
    path: string,
    params?: Record<string, string | undefined>,
  ): string {
    const url = new URL(`${API_BASE}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  private uploadUrl(
    path: string,
    params?: Record<string, string | undefined>,
  ): string {
    const url = new URL(`${UPLOAD_BASE}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  private buildMultipart(
    metadata: any,
    content: string,
    contentType: string,
  ): { body: string; contentType: string } {
    const boundary = "-----gdrive-mcp-boundary";
    const body = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${contentType}`,
      "",
      content,
      `--${boundary}--`,
    ].join("\r\n");
    return { body, contentType: `multipart/related; boundary=${boundary}` };
  }

  // ── Files ──────────────────────────────────────────────────────────

  files = {
    list: async (params: {
      q?: string;
      pageSize?: number;
      fields?: string;
      orderBy?: string;
      pageToken?: string;
    }): Promise<{ data: any }> => {
      const res = await this.request(
        this.apiUrl("/files", {
          q: params.q,
          pageSize: params.pageSize?.toString(),
          fields: params.fields,
          orderBy: params.orderBy,
          pageToken: params.pageToken,
        }),
      );
      return { data: await res.json() };
    },

    get: async (params: {
      fileId: string;
      fields?: string;
      alt?: string;
    }): Promise<{ data: any }> => {
      const res = await this.request(
        this.apiUrl(`/files/${encodeURIComponent(params.fileId)}`, {
          fields: params.fields,
          alt: params.alt,
        }),
      );
      if (params.alt === "media") {
        return { data: await res.arrayBuffer() };
      }
      return { data: await res.json() };
    },

    create: async (params: {
      requestBody?: any;
      media?: { mimeType: string; body: string };
      fields?: string;
    }): Promise<{ data: any }> => {
      if (params.media) {
        const mp = this.buildMultipart(
          params.requestBody ?? {},
          params.media.body,
          params.media.mimeType,
        );
        const res = await this.request(
          this.uploadUrl("/files", {
            uploadType: "multipart",
            fields: params.fields,
          }),
          {
            method: "POST",
            headers: { "Content-Type": mp.contentType },
            body: mp.body,
          },
        );
        return { data: await res.json() };
      }

      // Metadata-only (e.g. folder creation)
      const res = await this.request(
        this.apiUrl("/files", { fields: params.fields }),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params.requestBody ?? {}),
        },
      );
      return { data: await res.json() };
    },

    update: async (params: {
      fileId: string;
      requestBody?: any;
      media?: { mimeType: string; body: string };
      fields?: string;
      addParents?: string;
      removeParents?: string;
    }): Promise<{ data: any }> => {
      const fileId = encodeURIComponent(params.fileId);

      if (params.media) {
        const mp = this.buildMultipart(
          params.requestBody ?? {},
          params.media.body,
          params.media.mimeType,
        );
        const res = await this.request(
          this.uploadUrl(`/files/${fileId}`, {
            uploadType: "multipart",
            fields: params.fields,
            addParents: params.addParents,
            removeParents: params.removeParents,
          }),
          {
            method: "PATCH",
            headers: { "Content-Type": mp.contentType },
            body: mp.body,
          },
        );
        return { data: await res.json() };
      }

      const res = await this.request(
        this.apiUrl(`/files/${fileId}`, {
          fields: params.fields,
          addParents: params.addParents,
          removeParents: params.removeParents,
        }),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params.requestBody ?? {}),
        },
      );
      return { data: await res.json() };
    },

    delete: async (params: { fileId: string }): Promise<{ data: any }> => {
      await this.request(
        this.apiUrl(`/files/${encodeURIComponent(params.fileId)}`),
        { method: "DELETE" },
      );
      return { data: {} };
    },

    copy: async (params: {
      fileId: string;
      requestBody?: any;
      fields?: string;
    }): Promise<{ data: any }> => {
      const res = await this.request(
        this.apiUrl(`/files/${encodeURIComponent(params.fileId)}/copy`, {
          fields: params.fields,
        }),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params.requestBody ?? {}),
        },
      );
      return { data: await res.json() };
    },

    export: async (params: {
      fileId: string;
      mimeType: string;
    }): Promise<{ data: any }> => {
      const res = await this.request(
        this.apiUrl(`/files/${encodeURIComponent(params.fileId)}/export`, {
          mimeType: params.mimeType,
        }),
      );
      return { data: await res.text() };
    },

  };

  // ── Sheets helpers ────────────────────────────────────────────────

  private sheetsUrl(
    path: string,
    params?: Record<string, string | undefined>,
  ): string {
    const url = new URL(`${SHEETS_BASE}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  // ── Spreadsheets ──────────────────────────────────────────────────

  spreadsheets = {
    get: async (
      spreadsheetId: string,
      fields?: string,
    ): Promise<{ data: any }> => {
      const url = new URL(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}`);
      if (fields) url.searchParams.set("fields", fields);
      const res = await this.request(url.toString());
      return { data: await res.json() };
    },

    create: async (
      requestBody: any,
      fields?: string,
    ): Promise<{ data: any }> => {
      const url = this.sheetsUrl("", { fields });
      const res = await this.request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      return { data: await res.json() };
    },

    batchUpdate: async (
      spreadsheetId: string,
      requestBody: any,
    ): Promise<{ data: any }> => {
      const res = await this.request(
        this.sheetsUrl(`/${encodeURIComponent(spreadsheetId)}:batchUpdate`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        },
      );
      return { data: await res.json() };
    },
  };

  // ── Spreadsheet Values ────────────────────────────────────────────

  values = {
    get: async (
      spreadsheetId: string,
      range: string,
      opts?: { valueRenderOption?: string; dateTimeRenderOption?: string },
    ): Promise<{ data: any }> => {
      const res = await this.request(
        this.sheetsUrl(
          `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
          {
            valueRenderOption: opts?.valueRenderOption,
            dateTimeRenderOption: opts?.dateTimeRenderOption,
          },
        ),
      );
      return { data: await res.json() };
    },

    batchGet: async (
      spreadsheetId: string,
      ranges: string[],
      opts?: { valueRenderOption?: string; dateTimeRenderOption?: string },
    ): Promise<{ data: any }> => {
      const url = new URL(
        `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values:batchGet`,
      );
      for (const r of ranges) {
        url.searchParams.append("ranges", r);
      }
      if (opts?.valueRenderOption)
        url.searchParams.set("valueRenderOption", opts.valueRenderOption);
      if (opts?.dateTimeRenderOption)
        url.searchParams.set("dateTimeRenderOption", opts.dateTimeRenderOption);
      const res = await this.request(url.toString());
      return { data: await res.json() };
    },

    update: async (
      spreadsheetId: string,
      range: string,
      values: any[][],
      valueInputOption: string,
    ): Promise<{ data: any }> => {
      const res = await this.request(
        this.sheetsUrl(
          `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
          { valueInputOption },
        ),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ range, values }),
        },
      );
      return { data: await res.json() };
    },

    append: async (
      spreadsheetId: string,
      range: string,
      values: any[][],
      valueInputOption: string,
    ): Promise<{ data: any }> => {
      const res = await this.request(
        this.sheetsUrl(
          `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append`,
          { valueInputOption },
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ range, values }),
        },
      );
      return { data: await res.json() };
    },

    clear: async (
      spreadsheetId: string,
      range: string,
    ): Promise<{ data: any }> => {
      const res = await this.request(
        this.sheetsUrl(
          `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      return { data: await res.json() };
    },

    batchUpdate: async (
      spreadsheetId: string,
      requestBody: any,
    ): Promise<{ data: any }> => {
      const res = await this.request(
        this.sheetsUrl(
          `/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        },
      );
      return { data: await res.json() };
    },
  };
}
