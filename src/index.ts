import { loadConfigFromFile } from "./config.js";
import { runFingerprintCompare } from "./runner.js";
import { pathToFileURL } from "node:url";

export function getConfigPath(argv: string[]): string {
  const configWithValue = argv.find((item) => item.startsWith("--config="));
  if (configWithValue) {
    const value = configWithValue.slice("--config=".length);
    if (!value) {
      throw new Error("--config requires a file path");
    }
    return value;
  }

  const index = argv.indexOf("--config");
  if (index >= 0) {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("--config requires a file path");
    }
    return value;
  }

  return "config.local.json";
}

async function main(): Promise<void> {
  const configPath = getConfigPath(process.argv.slice(2));
  const config = await loadConfigFromFile(configPath);
  const result = await runFingerprintCompare(config);

  console.log(`HTML report: ${result.htmlPath}`);
  console.log(`JSON report: ${result.jsonPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
