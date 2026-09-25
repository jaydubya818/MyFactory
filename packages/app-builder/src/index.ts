import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export { LocalAppPreviewManager } from "./preview.ts";
export type { PreviewSnapshot } from "./preview.ts";

const TEMPLATE_DIR = fileURLToPath(new URL("../../../templates/feedback-hub/", import.meta.url));
const EXCLUDED_DIRECTORIES = new Set([".git", "node_modules", "dist", ".vite", "coverage"]);

export interface ProductBrief {
  name: string;
  description: string;
  audience?: string[];
  goals?: string[];
}

export interface InstantiateAppInput {
  templateId: "feedback-hub";
  taskDirectory: string;
  productBrief: ProductBrief;
  outputName?: string;
}

export interface ManifestFile {
  path: string;
  sha256: string;
  bytes: number;
}

export interface AppBuildResult {
  schemaVersion: 1;
  outputDir: string;
  manifestPath: string;
  createdAt: string;
  template: { id: "feedback-hub"; version: string; sha256: string };
  files: ManifestFile[];
}

export interface AppTemplateSummary {
  id: "feedback-hub";
  name: string;
  version: string;
  description: string;
}

interface TemplateMetadata {
  id: "feedback-hub";
  version: string;
  configPath: string;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function requiredText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const text = value.trim();
  if (!text || text.length > maximum || text.includes("\0")) {
    throw new TypeError(`${label} must contain 1 to ${maximum} characters without NUL bytes`);
  }
  return text;
}

function optionalList(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 20) {
    throw new TypeError(`${label} must be an array of at most 20 strings`);
  }
  return value.map((item, index) => requiredText(item, `${label}[${index}]`, 500));
}

function normalizeBrief(brief: ProductBrief): ProductBrief {
  if (!brief || typeof brief !== "object") throw new TypeError("productBrief is required");
  const audience = optionalList(brief.audience, "audience");
  const goals = optionalList(brief.goals, "goals");
  return {
    name: requiredText(brief.name, "name", 80),
    description: requiredText(brief.description, "description", 10_000),
    ...(audience === undefined ? {} : { audience }),
    ...(goals === undefined ? {} : { goals }),
  };
}

function safeRelativePath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && path === posix.normalize(path) &&
    !path.split("/").some((part) => part === "." || part === ".." || part === "");
}

function readTemplateMetadata(): TemplateMetadata {
  const metadata = JSON.parse(readFileSync(join(TEMPLATE_DIR, "template.json"), "utf8")) as Partial<TemplateMetadata>;
  if (metadata.id !== "feedback-hub" || typeof metadata.version !== "string" ||
      !/^\d+\.\d+\.\d+$/.test(metadata.version) ||
      typeof metadata.configPath !== "string" || !safeRelativePath(metadata.configPath)) {
    throw new Error("feedback-hub template.json is invalid");
  }
  return metadata as TemplateMetadata;
}

/** Lists the bundled starter without creating a task directory or modifying files. */
export function listAppTemplates(): AppTemplateSummary[] {
  const metadata = readTemplateMetadata();
  const config = JSON.parse(readFileSync(join(TEMPLATE_DIR, metadata.configPath), "utf8")) as Record<string, unknown>;
  if (!config || Array.isArray(config) || typeof config !== "object" ||
      typeof config.name !== "string" || typeof config.description !== "string") {
    throw new Error(`Template config must have name and description: ${metadata.configPath}`);
  }
  return [{ id: metadata.id, name: config.name, version: metadata.version, description: config.description }];
}

function templateFiles(): string[] {
  const paths: string[] = [];
  function walk(directory: string, prefix: string): void {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      if (item.isDirectory() && EXCLUDED_DIRECTORIES.has(item.name)) continue;
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      const fullPath = join(directory, item.name);
      const details = lstatSync(fullPath);
      if (details.isSymbolicLink()) throw new Error(`Template contains a symlink: ${path}`);
      if (details.isDirectory()) walk(fullPath, path);
      else if (details.isFile()) paths.push(path);
      else throw new Error(`Template contains an unsupported file: ${path}`);
    }
  }
  walk(TEMPLATE_DIR, "");
  return paths.sort();
}

function writeGeneratedFile(directory: string, path: string, bytes: Buffer, mode = 0o644): ManifestFile {
  const destination = join(directory, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes, { mode });
  chmodSync(destination, mode);
  return { path, sha256: sha256(bytes), bytes: bytes.length };
}

function outputExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Instantiates one immutable starter into a new direct child of taskDirectory. */
export function instantiateApp(input: InstantiateAppInput): AppBuildResult {
  if (!input || input.templateId !== "feedback-hub") {
    throw new TypeError("Only the feedback-hub template is available");
  }
  if (typeof input.taskDirectory !== "string" || !isAbsolute(input.taskDirectory) || input.taskDirectory.includes("\0")) {
    throw new TypeError("taskDirectory must be an absolute path without NUL bytes");
  }
  const taskDirectoryStat = lstatSync(input.taskDirectory);
  if (!taskDirectoryStat.isDirectory() || taskDirectoryStat.isSymbolicLink()) {
    throw new TypeError("taskDirectory must be an existing directory, not a symlink");
  }
  const taskDirectory = realpathSync(input.taskDirectory);
  const templateDirectory = realpathSync(TEMPLATE_DIR);
  const templateRelativeToTask = relative(templateDirectory, taskDirectory);
  if (templateRelativeToTask === "" ||
      (templateRelativeToTask !== ".." && !templateRelativeToTask.startsWith(`..${sep}`) &&
       !isAbsolute(templateRelativeToTask))) {
    throw new Error("taskDirectory must be outside the template source");
  }
  const outputName = input.outputName ?? "feedback-hub";
  if (typeof outputName !== "string" || !/^[a-z0-9][a-z0-9-]{0,49}$/.test(outputName)) {
    throw new TypeError("outputName must be a lowercase directory name up to 50 characters");
  }
  const outputDir = join(taskDirectory, outputName);
  if (outputExists(outputDir)) throw new Error(`Output already exists: ${outputDir}`);
  const brief = normalizeBrief(input.productBrief);
  const metadata = readTemplateMetadata();
  const sourceFiles = templateFiles();
  if (!sourceFiles.includes(metadata.configPath)) {
    throw new Error(`Template config is missing: ${metadata.configPath}`);
  }
  if (sourceFiles.includes("product-brief.json") || sourceFiles.includes("build-manifest.json")) {
    throw new Error("Template collides with generated files");
  }
  const stage = mkdtempSync(join(taskDirectory, ".app-builder-"));
  try {
    const files: ManifestFile[] = [];
    const templateHash = createHash("sha256");
    for (const path of sourceFiles) {
      const source = join(TEMPLATE_DIR, path);
      const sourceBytes = readFileSync(source);
      templateHash.update(`${path}\0${sourceBytes.length}\0`).update(sourceBytes);
      let bytes = sourceBytes;
      if (path === metadata.configPath) {
        const config = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
        if (!config || Array.isArray(config) || typeof config !== "object" ||
            typeof config.name !== "string" || typeof config.description !== "string") {
          throw new Error(`Template config must have name and description: ${path}`);
        }
        bytes = Buffer.from(`${JSON.stringify({ ...config, name: brief.name, description: brief.description }, null, 2)}\n`);
      }
      files.push(writeGeneratedFile(stage, path, bytes, lstatSync(source).mode & 0o777));
    }
    const briefBytes = Buffer.from(`${JSON.stringify(brief, null, 2)}\n`);
    files.push(writeGeneratedFile(stage, "product-brief.json", briefBytes));
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const result: AppBuildResult = {
      schemaVersion: 1,
      outputDir,
      manifestPath: join(outputDir, "build-manifest.json"),
      createdAt: new Date().toISOString(),
      template: { id: metadata.id, version: metadata.version, sha256: templateHash.digest("hex") },
      files,
    };
    writeFileSync(join(stage, "build-manifest.json"), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o644 });
    try {
      mkdirSync(outputDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`Output already exists: ${outputDir}`);
      }
      throw error;
    }
    try {
      renameSync(stage, outputDir);
    } catch (error) {
      if (readdirSync(outputDir).length === 0) rmdirSync(outputDir);
      throw error;
    }
    return result;
  } finally {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
  }
}
