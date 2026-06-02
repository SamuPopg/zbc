import { LocalApiStartResponse, ToolConfig } from "./types.js";

type FetchLike = typeof fetch;

const DEFAULT_LOCAL_API_TIMEOUT_MS = 60000;

function localApiTimeoutMs(config: ToolConfig): number {
  if (typeof config.timeoutMs === "number" && config.timeoutMs > 0) {
    return config.timeoutMs;
  }
  return DEFAULT_LOCAL_API_TIMEOUT_MS;
}

async function postLocalApi(
  config: ToolConfig,
  path: string,
  body: Record<string, unknown>,
  fetchImpl: FetchLike
): Promise<unknown> {
  const timeoutMs = localApiTimeoutMs(config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(`${config.localApiBaseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Local API ${path} request timed out after ${timeoutMs}ms`
      );
    }
    const original = error instanceof Error ? error.message : String(error);
    throw new Error(`Local API ${path} request failed: ${original}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`Local API ${path} failed with HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    code?: number;
    msg?: string;
    data?: Record<string, unknown>;
  };

  if (data.code !== 0) {
    if (data.msg) {
      throw new Error(
        `Local API ${path} returned code ${String(data.code)}: ${data.msg}`
      );
    }
    throw new Error(`Local API ${path} returned code ${String(data.code)}`);
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
    ws?: { puppeteer?: string; selenium?: string };
    webdriver?: string;
    marionette_port?: string | number;
  };

  return {
    profileId,
    debugPort: data.debug_port,
    wsPuppeteer: data.ws?.puppeteer,
    webdriver: data.webdriver,
    wsSelenium: data.ws?.selenium,
    marionettePort: data.marionette_port,
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
