import { BACKEND_PROFILE_FIELDS } from "./fingerprintFields.js";
import type { ProfileSettings, RawProfile, ToolConfig } from "./types.js";

type FetchLike = typeof fetch;

interface BackendProfileListBody {
  code?: number;
  msg?: string;
  data?: {
    list?: RawProfile[];
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRandomFingerprintEnabled(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function profileIdFor(profile: RawProfile): string | undefined {
  if (typeof profile.id === "string" && profile.id.length > 0) {
    return profile.id;
  }

  if (typeof profile.profile_id === "string" && profile.profile_id.length > 0) {
    return profile.profile_id;
  }

  return undefined;
}

function orderedSettings(config: ToolConfig, list: RawProfile[]): ProfileSettings[] {
  const byId = new Map<string, ProfileSettings>();
  for (const profile of list) {
    const profileId = profileIdFor(profile);
    if (profileId) {
      byId.set(profileId, flattenProfile(profile));
    }
  }

  return config.profileIds.map((profileId) => {
    const found = byId.get(profileId);
    if (found) {
      return found;
    }

    return {
      profileId,
      settings: {},
      randomFingerprintEnabled: false,
      fetchStatus: "failed",
      error: "profile not returned by settings source"
    };
  });
}

export function flattenProfile(profile: RawProfile): ProfileSettings {
  const fingerprintConfig = isRecord(profile.fingerprint_config)
    ? profile.fingerprint_config
    : {};

  const settings: Record<string, unknown> = {
    ...profile,
    ...fingerprintConfig,
    ipchecker: profile.ipchecker
  };

  delete settings.fingerprint_config;

  return {
    profileId: profileIdFor(profile) ?? "",
    accId: typeof profile.acc_id === "string" ? profile.acc_id : undefined,
    name: typeof profile.name === "string" ? profile.name : undefined,
    settings,
    randomFingerprintEnabled: isRandomFingerprintEnabled(
      profile.switch_random_finger
    ),
    fetchStatus: "ok"
  };
}

export async function fetchProfileSettings(
  config: ToolConfig,
  fetchImpl: FetchLike = fetch
): Promise<ProfileSettings[]> {
  try {
    return orderedSettings(config, await fetchBackendProfiles(config, fetchImpl));
  } catch {
    return orderedSettings(config, await fetchLocalApiProfiles(config, fetchImpl));
  }
}

async function fetchBackendProfiles(
  config: ToolConfig,
  fetchImpl: FetchLike
): Promise<RawProfile[]> {
  const url = new URL(
    `${trimTrailingSlash(config.backendBaseUrl)}/fbcc/user/get-open-user-list`
  );
  url.searchParams.set("_local_api", "adspower");
  url.searchParams.set("ids", config.profileIds.join(","));
  url.searchParams.set("page", "1");
  url.searchParams.set(
    "page_size",
    String(Math.min(config.profileIds.length, 100))
  );
  url.searchParams.set("action", "openfb");
  url.searchParams.set("fields", BACKEND_PROFILE_FIELDS.join(","));

  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      "api-key": config.apiKey,
      "x-client-local-api-version": "2.0"
    }
  });

  if (!response.ok) {
    throw new Error(`backend request failed with HTTP ${response.status}`);
  }

  const body = (await response.json()) as BackendProfileListBody;
  if (body.code !== 0) {
    throw new Error(body.msg || `backend returned code ${String(body.code)}`);
  }

  return body.data?.list ?? [];
}

async function fetchLocalApiProfiles(
  config: ToolConfig,
  fetchImpl: FetchLike
): Promise<RawProfile[]> {
  const response = await fetchImpl(
    `${trimTrailingSlash(config.localApiBaseUrl)}/api/v2/browser-profile/list`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        profile_id: config.profileIds,
        page: 1,
        limit: Math.min(config.profileIds.length, 100)
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Local API profile list failed with HTTP ${response.status}`);
  }

  const body = (await response.json()) as BackendProfileListBody;
  if (body.code !== 0) {
    throw new Error(body.msg || `Local API profile list returned code ${String(body.code)}`);
  }

  return body.data?.list ?? [];
}
