import { describe, expect, it } from "vitest";
import { getConfigPath } from "../src/index.js";

describe("getConfigPath", () => {
  it("defaults to config.local.json without --config", () => {
    expect(getConfigPath([])).toBe("config.local.json");
  });

  it("reads --config path", () => {
    expect(getConfigPath(["--config", "config.test.json"])).toBe(
      "config.test.json"
    );
  });

  it("reads --config=path", () => {
    expect(getConfigPath(["--config=config.test.json"])).toBe(
      "config.test.json"
    );
  });

  it("throws when --config has no value", () => {
    expect(() => getConfigPath(["--config"])).toThrow(
      "--config requires a file path"
    );
  });

  it("throws when --config value is another flag", () => {
    expect(() => getConfigPath(["--config", "--verbose"])).toThrow(
      "--config requires a file path"
    );
  });
});
