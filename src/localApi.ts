import { LocalApiStartResponse, ToolConfig } from "./types.js";

type FetchLike = typeof fetch;

async function postLocalApi(
  config: ToolConfig,
  path: string,
  body: Record<string, unknown>,
  fetchImpl: FetchLike
): Promise<unknown> {
  const response = await fetchImpl(`${config.localApiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Local API ${path} failed with HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    code?: number;
    msg?: string;
    data?: Record<string, unknown>;
  };

  if (data.code !== 0) {
    throw new Error(data.msg || `Local API ${path} returned code ${String(data.code)}`);
  }

  return data.data || {};
}

export async function startProfile(
  config: ToolConfig,
  profileId: string,
  fetchImpl: FetchLike = fetch
): Promise<LocalApiStartResponse> {
  const data = (await postLocalApi(
    config,
    "/api/v2/browser-profile/start",
    { profile_id: profileId },
    fetchImpl
  )) as {
    debug_port?: string | number;
    ws?: { puppeteer?: string };
    webdriver?: string;
  };

  return {
    profileId,
    debugPort: data.debug_port,
    wsPuppeteer: data.ws?.puppeteer,
    webdriver: data.webdriver,
    raw: data
  };
}

export async function stopProfile(
  config: ToolConfig,
  profileId: string,
  fetchImpl: FetchLike = fetch
): Promise<void> {
  await postLocalApi(
    config,
    "/api/v2/browser-profile/stop",
    { profile_id: profileId },
    fetchImpl
  );
}
