import { readFile } from "node:fs/promises";
import { ToolConfig } from "./types.js";

type EnvLike = Record<string, string | undefined>;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function requireString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

export function loadConfigFromObject(
  source: Record<string, unknown>,
  env: EnvLike = process.env
): ToolConfig {
  const sourceApiKey =
    typeof source.apiKey === "string" ? source.apiKey.trim() : "";
  const envApiKey =
    typeof env.ADSPOWER_API_KEY === "string" ? env.ADSPOWER_API_KEY.trim() : "";
  const apiKey = sourceApiKey !== "" ? sourceApiKey : envApiKey;

  if (!apiKey) {
    throw new Error("apiKey is required");
  }

  const profileIds = source.profileIds;
  if (!Array.isArray(profileIds) || profileIds.length === 0) {
    throw new Error("profileIds must contain at least one profile id");
  }

  const cleanedProfileIds = profileIds.map((item) => {
    if (typeof item !== "string" || item.trim() === "") {
      throw new Error("profileIds must only contain non-empty strings");
    }
    return item.trim();
  });

  return {
    backendBaseUrl: trimTrailingSlash(requireString(source, "backendBaseUrl")),
    localApiBaseUrl: trimTrailingSlash(requireString(source, "localApiBaseUrl")),
    apiKey,
    browserScanUrl: requireString(source, "browserScanUrl"),
    profileIds: cleanedProfileIds,
    closeAfterRun:
      typeof source.closeAfterRun === "boolean" ? source.closeAfterRun : true,
    runMode: "sequential",
    timeoutMs:
      typeof source.timeoutMs === "number" && source.timeoutMs > 0
        ? source.timeoutMs
        : 60000,
    outputDir:
      typeof source.outputDir === "string" && source.outputDir.trim() !== ""
        ? source.outputDir.trim()
        : "reports"
  };
}

export async function loadConfigFromFile(path: string): Promise<ToolConfig> {
  const text = await readFile(path, "utf8");
  const parsed = JSON.parse(text) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("config file must contain a JSON object");
  }
  return loadConfigFromObject(parsed as Record<string, unknown>);
}
