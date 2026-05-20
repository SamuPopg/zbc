import { loadConfigFromFile } from "./config.js";
import { runFingerprintCompare } from "./runner.js";

function getConfigPath(argv: string[]): string {
  const index = argv.indexOf("--config");
  if (index >= 0 && argv[index + 1]) {
    return argv[index + 1];
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
