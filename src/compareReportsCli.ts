import { access, readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { ReportData } from "./types.js";
import { buildReportDiff } from "./reportDiff.js";
import { writeReportDiff } from "./reportDiffWriter.js";

export async function resolveReportJsonPath(inputPath: string): Promise<string> {
  const p = resolve(inputPath);
  try {
    await access(p);
  } catch {
    throw new Error(`报告路径不存在，请检查路径是否正确：${inputPath}`);
  }

  const ext = extname(p).toLowerCase();
  if (ext === ".json") {
    return p;
  }
  if (ext === ".html") {
    const jsonPath = p.replace(/\.html$/i, ".json");
    try {
      await access(jsonPath);
    } catch {
      throw new Error(`无法找到 HTML 对应的 JSON 报告：${jsonPath}`);
    }
    return jsonPath;
  }
  return p;
}

export function validateReportStructure(data: unknown): asserts data is ReportData {
  if (!data || typeof data !== "object") {
    throw new Error("报告 JSON 格式不正确：缺少 results[]");
  }
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.results)) {
    throw new Error("报告 JSON 格式不正确：缺少 results[]");
  }
}

export function parseArgs(args: string[]): [string, string] {
  if (args.length !== 2) {
    throw new Error(
      "用法：npm.cmd run compare-reports -- <旧报告.html|json> <新报告.html|json>"
    );
  }
  return [args[0], args[1]];
}

export async function runCompareReportsCli(
  baselinePath: string,
  currentPath: string,
  outputDir: string
): Promise<{ htmlPath: string; jsonPath: string }> {
  const baselineJson = await resolveReportJsonPath(baselinePath);
  const currentJson = await resolveReportJsonPath(currentPath);

  let baselineData: ReportData;
  let currentData: ReportData;

  try {
    const baselineContent = await readFile(baselineJson, "utf8");
    baselineData = JSON.parse(baselineContent);
  } catch {
    throw new Error(`报告 JSON 解析失败，请确认文件是否为有效 JSON：${baselineJson}`);
  }

  try {
    const currentContent = await readFile(currentJson, "utf8");
    currentData = JSON.parse(currentContent);
  } catch {
    throw new Error(`报告 JSON 解析失败，请确认文件是否为有效 JSON：${currentJson}`);
  }

  validateReportStructure(baselineData);
  validateReportStructure(currentData);

  const diffData = buildReportDiff(baselineData, currentData, baselinePath, currentPath);
  const { htmlPath, jsonPath } = await writeReportDiff(diffData, outputDir);

  return { htmlPath, jsonPath };
}

export async function main(argv: string[]): Promise<void> {
  const [baselinePath, currentPath] = parseArgs(argv);

  try {
    const { htmlPath, jsonPath } = await runCompareReportsCli(
      baselinePath,
      currentPath,
      "."
    );
    console.log(`Diff HTML report: ${htmlPath}`);
    console.log(`Diff JSON report: ${jsonPath}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}