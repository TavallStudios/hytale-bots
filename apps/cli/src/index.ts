#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BotQuicOptions } from "@hyrhythm/hytale-client";
import { CONNECT_LANGUAGE_MAX_BYTES, CONNECT_USERNAME_MAX_BYTES } from "@hyrhythm/hytale-protocol";
import {
  DEFAULT_EXPECTED_CHART,
  DEFAULT_EXPECTED_MAX_COMBO,
  DEFAULT_EXPECTED_SCORE,
  runScenario,
  runStopAndClose,
  type GameplayInputMode,
  type ScenarioName,
  type ScenarioOptions,
  type ScenarioResult
} from "@hyrhythm/hytale-scenario";

type CliScenarioName = ScenarioName | "stop-close";
type MutableScenarioOptions = {
  host?: string;
  port?: number;
  username: string;
  uuid?: string;
  language?: string;
  autoConnect?: boolean;
  autoAcknowledgePages?: boolean;
  heartbeatIntervalMs?: number;
  quic?: BotQuicOptions;
  auth?: {
    domain?: string;
    identityToken?: string;
    sessionToken?: string;
    password?: string;
    scopes?: readonly string[];
  };
  inputMode?: GameplayInputMode;
  outputDir?: string;
  timeoutMs?: number;
  traceDurationMs?: number;
  authoritativeLogDir?: string;
  expectedChart?: string;
  expectedScore?: number;
  expectedMaxCombo?: number;
};
type MutableQuicOptions = {
  serverJarPath?: string;
  bridgeSourcePath?: string;
  bridgeClassDir?: string;
  javaPath?: string;
  javacPath?: string;
  readyTimeoutMs?: number;
};

interface ParsedArgs {
  readonly command: "scenario";
  readonly scenario: CliScenarioName;
  readonly options: ScenarioOptions;
  readonly json: boolean;
  readonly outputDir: string;
}

function usage(): string {
  return [
    "Usage: hytale-sim scenario <smoke|trace-ui|stop|close|stop-close|connect-only|listen-only> [options]",
    "",
    "Options:",
    "  --host <host>                    Server host (default: 127.0.0.1)",
    "  --port <port>                    Server port (default: 5520)",
    "  --username <name>                Bot username (default: HyRhythmBot)",
    "  --uuid <uuid>                    Stable bot UUID",
    "  --language <code>                Bot language (default: en)",
    "  --auth-domain <host>             Auth domain (ex: auth.sanasol.ws)",
    "  --identity-token <jwt>           Pre-issued identity token",
    "  --session-token <jwt>            Pre-issued session token",
    "  --auth-password <password>       Account password (if required)",
    "  --auth-scopes <csv>              Comma-separated scopes (default: hytale:client,hytale:server)",
    "  --server-jar <path>              HytaleServer.jar for QUIC bridge (or HYTALE_SERVER_JAR)",
    "  --java-path <path>               java executable for QUIC bridge",
    "  --javac-path <path>              javac executable for QUIC bridge",
    "  --bridge-src <path>              QUIC bridge source file",
    "  --bridge-class-dir <path>        QUIC bridge output directory",
    "  --bridge-ready-timeout-ms <ms>   QUIC bridge startup timeout",
    "  --input-mode <command-input|ui-packet>",
    "  --timeout-ms <ms>                Scenario timeout window",
    "  --trace-duration-ms <ms>         Idle/trace duration for long-running scenarios",
    "  --authoritative-log-dir <path>   Read server logs on the same host for final authoritative assertions",
    "  --output-dir <path>              Trace/result directory",
    "  --expected-chart <chart>         Expected chart id for gameplay assertions",
    "  --expected-score <score>         Expected authoritative score",
    "  --expected-max-combo <count>     Expected authoritative max combo",
    "  --json                           Print JSON result",
    "  --no-auto-ack-pages              Disable automatic page acknowledgements"
  ].join("\n");
}

function isScenarioName(value: string): value is CliScenarioName {
  return ["smoke", "trace-ui", "stop", "close", "stop-close", "connect-only", "listen-only"].includes(value);
}

function makeDefaultOutputDir(scenario: CliScenarioName): string {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join("");
  return path.resolve(process.cwd(), ".runs", `${scenario}-${stamp}`);
}

function parseInteger(name: string, value: string | undefined): number {
  if (value == null) {
    throw new Error(`Missing value for ${name}`);
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Expected integer for ${name}, received ${value}`);
  }
  return parsed;
}

function parseInputMode(value: string | undefined): GameplayInputMode {
  if (value === "command-input" || value === "ui-packet") {
    return value;
  }
  throw new Error(`Unsupported input mode: ${value}`);
}

function assertAsciiOption(name: string, value: string, maxBytes: number): void {
  if (!/^[\x00-\x7f]*$/.test(value)) {
    throw new Error(`${name} must be ASCII`);
  }
  const byteLength = Buffer.byteLength(value, "ascii");
  if (byteLength > maxBytes) {
    throw new Error(`${name} exceeds ${maxBytes} ASCII bytes: ${byteLength}`);
  }
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  if (argv.length < 2 || argv[0] !== "scenario" || !isScenarioName(argv[1])) {
    throw new Error(usage());
  }

  const scenario = argv[1];
  const options: MutableScenarioOptions = {
    host: "127.0.0.1",
    port: 5520,
    username: "HyRhythmBot",
    language: "en",
    inputMode: "command-input",
    autoAcknowledgePages: true,
    expectedChart: DEFAULT_EXPECTED_CHART,
    expectedScore: scenario === "smoke" ? DEFAULT_EXPECTED_SCORE : undefined,
    expectedMaxCombo: scenario === "smoke" ? DEFAULT_EXPECTED_MAX_COMBO : undefined
  };

  const quicOptions: MutableQuicOptions = {};
  let quicTouched = false;

  let json = false;
  let outputDir = makeDefaultOutputDir(scenario);

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--host":
        options.host = argv[++index] ?? options.host;
        break;
      case "--port":
        options.port = parseInteger("--port", argv[++index]);
        break;
      case "--username":
        options.username = argv[++index] ?? options.username;
        break;
      case "--uuid":
        options.uuid = argv[++index] ?? options.uuid;
        break;
      case "--language":
        options.language = argv[++index] ?? options.language;
        break;
      case "--auth-domain":
        options.auth = { ...options.auth, domain: argv[++index] ?? options.auth?.domain };
        break;
      case "--identity-token":
        options.auth = { ...options.auth, identityToken: argv[++index] ?? options.auth?.identityToken };
        break;
      case "--session-token":
        options.auth = { ...options.auth, sessionToken: argv[++index] ?? options.auth?.sessionToken };
        break;
      case "--auth-password":
        options.auth = { ...options.auth, password: argv[++index] ?? options.auth?.password };
        break;
      case "--auth-scopes": {
        const raw = argv[++index] ?? "";
        const scopes = raw
          .split(",")
          .map((value) => value.trim())
          .filter((value) => value.length > 0);
        options.auth = { ...options.auth, scopes };
        break;
      }
      case "--server-jar":
        quicOptions.serverJarPath = path.resolve(argv[++index] ?? "");
        quicTouched = true;
        break;
      case "--java-path":
        quicOptions.javaPath = path.resolve(argv[++index] ?? "");
        quicTouched = true;
        break;
      case "--javac-path":
        quicOptions.javacPath = path.resolve(argv[++index] ?? "");
        quicTouched = true;
        break;
      case "--bridge-src":
        quicOptions.bridgeSourcePath = path.resolve(argv[++index] ?? "");
        quicTouched = true;
        break;
      case "--bridge-class-dir":
        quicOptions.bridgeClassDir = path.resolve(argv[++index] ?? "");
        quicTouched = true;
        break;
      case "--bridge-ready-timeout-ms":
        quicOptions.readyTimeoutMs = parseInteger("--bridge-ready-timeout-ms", argv[++index]);
        quicTouched = true;
        break;
      case "--input-mode":
        options.inputMode = parseInputMode(argv[++index]);
        break;
      case "--timeout-ms":
        options.timeoutMs = parseInteger("--timeout-ms", argv[++index]);
        break;
      case "--trace-duration-ms":
        options.traceDurationMs = parseInteger("--trace-duration-ms", argv[++index]);
        break;
      case "--authoritative-log-dir":
        options.authoritativeLogDir = path.resolve(argv[++index] ?? "");
        break;
      case "--output-dir":
        outputDir = path.resolve(argv[++index] ?? outputDir);
        break;
      case "--expected-chart":
        options.expectedChart = argv[++index] ?? options.expectedChart;
        break;
      case "--expected-score":
        options.expectedScore = parseInteger("--expected-score", argv[++index]);
        break;
      case "--expected-max-combo":
        options.expectedMaxCombo = parseInteger("--expected-max-combo", argv[++index]);
        break;
      case "--json":
        json = true;
        break;
      case "--no-auto-ack-pages":
        options.autoAcknowledgePages = false;
        break;
      case "-h":
      case "--help":
        throw new Error(usage());
      default:
        throw new Error(`Unknown argument: ${token}\n\n${usage()}`);
    }
  }

  if (quicTouched) {
    options.quic = quicOptions as BotQuicOptions;
  }

  assertAsciiOption("--username", options.username, CONNECT_USERNAME_MAX_BYTES);
  assertAsciiOption("--language", options.language ?? "en", CONNECT_LANGUAGE_MAX_BYTES);

  return {
    command: "scenario",
    scenario,
    options,
    json,
    outputDir
  };
}

async function writeResult(outputDir: string, result: ScenarioResult | readonly ScenarioResult[]): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const entries = Array.isArray(result) ? result : [result];
  const lines: string[] = [`generatedAt=${new Date().toISOString()}`];
  for (const entry of entries) {
    lines.push("");
    lines.push(`[scenario:${entry.name}]`);
    lines.push(`success=${entry.success}`);
    lines.push(`startedAt=${entry.startedAt}`);
    lines.push(`endedAt=${entry.endedAt}`);
    lines.push(`assertions=${entry.assertions.join(",")}`);
    lines.push(`outputDir=${entry.outputDir ?? ""}`);
    lines.push(`finalServerMessage=${entry.finalServerMessage ?? ""}`);
  }
  await writeFile(path.join(outputDir, "scenario-result.txt"), `${lines.join("\n")}\n`, "utf8");
}

function printResult(result: ScenarioResult | readonly ScenarioResult[], json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const entries = Array.isArray(result) ? result : [result];
  entries.forEach((entry) => {
    console.log(`[scenario] ${entry.name} success=${entry.success} assertions=${entry.assertions.join(",")}`);
    if (entry.finalServerMessage) {
      console.log(`[scenario] ${entry.name} final=${entry.finalServerMessage}`);
    }
  });

  const singleResult: ScenarioResult | null = Array.isArray(result) ? null : (result as ScenarioResult);
  if (singleResult?.outputDir) {
    console.log(`[scenario] outputDir=${singleResult.outputDir}`);
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(usage());
    return;
  }
  const parsed = parseArgs(process.argv.slice(2));
  const scenarioOptions: ScenarioOptions = {
    ...parsed.options,
    outputDir: parsed.outputDir
  };

  const result = parsed.scenario === "stop-close"
    ? await runStopAndClose(scenarioOptions)
    : await runScenario(parsed.scenario, scenarioOptions);

  await writeResult(parsed.outputDir, result);
  printResult(result, parsed.json);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
