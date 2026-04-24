import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(here, "..");
const defaultSourcePath = resolve(
  workspaceRoot,
  "..",
  "..",
  "hytale-server-patch",
  "decompiled-src",
  "com",
  "hypixel",
  "hytale",
  "protocol",
  "PacketRegistry.java"
);
const defaultOutputPath = resolve(
  workspaceRoot,
  "packages",
  "protocol",
  "generated",
  "packet-registry.json"
);
const helperSourcePath = resolve(workspaceRoot, "scripts", "java", "PacketRegistryDump.java");

function usage() {
  return [
    "Usage: node ./scripts/generate-packet-registry.mjs [options]",
    "",
    "Options:",
    "  --server-jar <path>        Dump packet metadata from a live HytaleServer.jar",
    "  --source-path <path>       Parse packet metadata from a decompiled PacketRegistry.java fallback",
    "  --output <path>            Output path for packet-registry.json",
    "  --help                     Show this help text"
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    serverJarPath: process.env.HYRHYTHM_HYTALE_SERVER_JAR ? resolve(process.env.HYRHYTHM_HYTALE_SERVER_JAR) : null,
    sourcePath: defaultSourcePath,
    outputPath: defaultOutputPath
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--server-jar":
        options.serverJarPath = resolve(argv[++index] ?? "");
        break;
      case "--source-path":
        options.sourcePath = resolve(argv[++index] ?? "");
        break;
      case "--output":
        options.outputPath = resolve(argv[++index] ?? "");
        break;
      case "--help":
      case "-h":
        console.log(usage());
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${token}\n\n${usage()}`);
    }
  }

  return options;
}

async function pathExists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function generateFromSource(sourcePath) {
  const source = await readFile(sourcePath, "utf8");
  const registryPattern = /register\(PacketRegistry\.PacketDirection\.(ToServer|ToClient|Both),\s*NetworkChannel\.([A-Za-z0-9_]+),\s*(\d+),\s*"([^"]+)",\s*([A-Za-z0-9_$.]+)\.class,\s*(\d+),\s*(\d+),\s*(true|false),/g;
  const entries = [];
  for (const match of source.matchAll(registryPattern)) {
    entries.push({
      direction: match[1],
      channel: match[2],
      id: Number(match[3]),
      name: match[4],
      type: match[5],
      fixedBlockSize: Number(match[6]),
      maxSize: Number(match[7]),
      compressed: match[8] === "true"
    });
  }
  if (entries.length === 0) {
    throw new Error(`Failed to parse packet registry from ${sourcePath}`);
  }
  return entries.sort((left, right) => left.id - right.id);
}

async function generateFromJar(serverJarPath) {
  const helperPresent = await pathExists(helperSourcePath);
  if (!helperPresent) {
    throw new Error(`Missing helper source: ${helperSourcePath}`);
  }

  const result = spawnSync(
    "java",
    ["--class-path", serverJarPath, helperSourcePath],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024
    }
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || "<empty stderr>";
    throw new Error(`Live jar packet registry dump failed for ${serverJarPath}: ${stderr}`);
  }
  const stdout = result.stdout?.trim();
  if (!stdout) {
    throw new Error(`Live jar packet registry dump produced no output for ${serverJarPath}`);
  }
  const entries = JSON.parse(stdout);
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`Live jar packet registry dump was empty for ${serverJarPath}`);
  }
  return entries.sort((left, right) => left.id - right.id);
}

const options = parseArgs(process.argv.slice(2));
let entries;
let sourceLabel;

if (options.serverJarPath && await pathExists(options.serverJarPath)) {
  entries = await generateFromJar(options.serverJarPath);
  sourceLabel = `live jar ${options.serverJarPath}`;
} else {
  if (options.serverJarPath) {
    console.warn(`[generate:registry] Falling back because server jar was not found: ${options.serverJarPath}`);
  }
  entries = await generateFromSource(options.sourcePath);
  sourceLabel = `decompiled source ${options.sourcePath}`;
}

await mkdir(dirname(options.outputPath), { recursive: true });
await writeFile(options.outputPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
console.log(`Wrote ${entries.length} packet entries from ${sourceLabel} to ${options.outputPath}`);
