import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createBot, type BotOptions, type HytaleBot } from "@hyrhythm/hytale-client";
import type { CustomPagePacket } from "@hyrhythm/hytale-protocol";

export const DEFAULT_EXPECTED_CHART = "debug/test-4k";
export const DEFAULT_EXPECTED_SCORE = 7610;
export const DEFAULT_EXPECTED_MAX_COMBO = 24;
export const SELECTION_PAGE_KEY = "com.hyrhythm.ui.RhythmSongSelectionPage";
export const GAMEPLAY_PAGE_KEY = "com.hyrhythm.ui.RhythmGameplayPage";
export const RESPAWN_PAGE_KEY = "com.hypixel.hytale.server.core.entity.entities.player.pages.RespawnPage";

export type ScenarioName = "connect-only" | "listen-only" | "smoke" | "trace-ui" | "stop" | "close";
export type GameplayInputMode = "command-input" | "ui-packet";

export interface ScenarioOptions extends BotOptions {
  readonly inputMode?: GameplayInputMode;
  readonly outputDir?: string;
  readonly timeoutMs?: number;
  readonly traceDurationMs?: number;
  readonly authoritativeLogDir?: string;
  readonly expectedChart?: string;
  readonly expectedScore?: number;
  readonly expectedMaxCombo?: number;
}

export interface ScenarioResult {
  readonly name: ScenarioName;
  readonly success: boolean;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly assertions: readonly string[];
  readonly outputDir: string | null;
  readonly finalServerMessage: string | null;
}

interface PlannedInput {
  readonly lane: number;
  readonly key: string;
  readonly down: boolean;
  readonly songTimeMillis: number;
}

const GAMEPLAY_PACKET_INPUTS: readonly PlannedInput[] = [
  { lane: 1, key: "D", down: true, songTimeMillis: 1000 },
  { lane: 2, key: "F", down: true, songTimeMillis: 1500 },
  { lane: 3, key: "J", down: true, songTimeMillis: 2000 },
  { lane: 4, key: "K", down: true, songTimeMillis: 3000 },
  { lane: 1, key: "D", down: true, songTimeMillis: 3500 },
  { lane: 2, key: "F", down: true, songTimeMillis: 4500 },
  { lane: 4, key: "K", down: true, songTimeMillis: 5500 },
  { lane: 3, key: "J", down: true, songTimeMillis: 6500 },
  { lane: 1, key: "D", down: true, songTimeMillis: 7500 },
  { lane: 4, key: "K", down: true, songTimeMillis: 8500 },
  { lane: 2, key: "F", down: true, songTimeMillis: 9000 },
  { lane: 3, key: "J", down: true, songTimeMillis: 9500 },
  { lane: 2, key: "F", down: true, songTimeMillis: 10500 },
  { lane: 4, key: "K", down: true, songTimeMillis: 11500 },
  { lane: 1, key: "D", down: true, songTimeMillis: 12500 },
  { lane: 3, key: "J", down: true, songTimeMillis: 13500 },
  { lane: 2, key: "F", down: true, songTimeMillis: 14500 },
  { lane: 4, key: "K", down: true, songTimeMillis: 15500 },
  { lane: 1, key: "D", down: true, songTimeMillis: 16500 },
  { lane: 3, key: "J", down: true, songTimeMillis: 17500 },
  { lane: 2, key: "F", down: true, songTimeMillis: 18500 },
  { lane: 4, key: "K", down: true, songTimeMillis: 19500 },
  { lane: 1, key: "D", down: true, songTimeMillis: 20000 }
] as const;

const GAMEPLAY_COMMAND_INPUTS: readonly PlannedInput[] = [
  { lane: 1, key: "D", down: true, songTimeMillis: 1000 },
  { lane: 2, key: "F", down: true, songTimeMillis: 1500 },
  { lane: 3, key: "J", down: true, songTimeMillis: 2000 },
  { lane: 3, key: "J", down: false, songTimeMillis: 2600 },
  { lane: 4, key: "K", down: true, songTimeMillis: 3000 },
  { lane: 1, key: "D", down: true, songTimeMillis: 3500 },
  { lane: 2, key: "F", down: true, songTimeMillis: 4500 },
  { lane: 4, key: "K", down: true, songTimeMillis: 5500 },
  { lane: 3, key: "J", down: true, songTimeMillis: 6500 },
  { lane: 1, key: "D", down: true, songTimeMillis: 7500 },
  { lane: 4, key: "K", down: true, songTimeMillis: 8500 },
  { lane: 2, key: "F", down: true, songTimeMillis: 9000 },
  { lane: 3, key: "J", down: true, songTimeMillis: 9500 },
  { lane: 2, key: "F", down: true, songTimeMillis: 10500 },
  { lane: 4, key: "K", down: true, songTimeMillis: 11500 },
  { lane: 1, key: "D", down: true, songTimeMillis: 12500 },
  { lane: 3, key: "J", down: true, songTimeMillis: 13500 },
  { lane: 2, key: "F", down: true, songTimeMillis: 14500 },
  { lane: 4, key: "K", down: true, songTimeMillis: 15500 },
  { lane: 1, key: "D", down: true, songTimeMillis: 16500 },
  { lane: 3, key: "J", down: true, songTimeMillis: 17500 },
  { lane: 2, key: "F", down: true, songTimeMillis: 18500 },
  { lane: 4, key: "K", down: true, songTimeMillis: 19500 },
  { lane: 1, key: "D", down: true, songTimeMillis: 20000 }
] as const;
const POST_WORLD_JOIN_SETTLE_MS = 1_000;
const SELF_OP_SETTLE_MS = 750;
const DEBUG_COMMAND_SETTLE_MS = 300;
const PAGE_OPEN_ATTEMPT_TIMEOUT_MS = 5_000;
const PAGE_OPEN_RETRY_DELAY_MS = 2_000;
const PAGE_OPEN_MAX_ATTEMPTS = 4;
const RESPAWN_CLEAR_ATTEMPT_TIMEOUT_MS = 2_000;
const SELECTION_CLOSE_SETTLE_MS = 100;
const AUTHORITATIVE_LOG_DISCONNECT_SETTLE_MS = 1_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureOutputDir(outputDir?: string): Promise<string | null> {
  if (!outputDir) {
    return null;
  }
  await mkdir(outputDir, { recursive: true });
  return outputDir;
}

async function findLatestLogFile(logDir: string): Promise<string | null> {
  const entries = await readdir(logDir, { withFileTypes: true });
  let latestPath: string | null = null;
  let latestMtimeMs = -1;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".log")) {
      continue;
    }
    const entryPath = path.join(logDir, entry.name);
    const entryStat = await stat(entryPath);
    if (entryStat.mtimeMs > latestMtimeMs) {
      latestMtimeMs = entryStat.mtimeMs;
      latestPath = entryPath;
    }
  }
  return latestPath;
}

function capturePayload(input: PlannedInput, buffer: string): string {
  return `{"Action":"CaptureKey","@CaptureValue":"${buffer}${input.key}"}`;
}

function makeCommand(input: PlannedInput, effectiveSongTimeMillis: number): string {
  return `/rhythm input ${input.down ? "down" : "up"} ${input.lane} ${effectiveSongTimeMillis}`;
}

async function waitForSetPage(bot: HytaleBot, targetPage: string, timeoutMs: number): Promise<void> {
  const existing = bot.ui.lastSetPage;
  if (existing?.page === targetPage) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const onPage = (page: { page: string }): void => {
      if (page.page !== targetPage) {
        return;
      }
      clearTimeout(timer);
      bot.off("setPage", onPage);
      resolve();
    };
    const timer = setTimeout(() => {
      bot.off("setPage", onPage);
      reject(new Error(`Timed out waiting for setPage=${targetPage}`));
    }, timeoutMs);
    bot.on("setPage", onPage);
  });
}

async function waitForServerMessageIncludingAll(bot: HytaleBot, fragments: readonly string[], timeoutMs: number, label: string): Promise<string> {
  return bot.waitForServerMessageMatching(
    (message) => fragments.every((fragment) => message.includes(fragment)),
    timeoutMs,
    label
  );
}

async function waitForAuthoritativeLogLine(logDir: string, fragments: readonly string[], timeoutMs: number, label: string): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const logPath = await findLatestLogFile(logDir);
    if (logPath) {
      const contents = await readFile(logPath, "utf8");
      const matchingLine = contents
        .split(/\r?\n/)
        .find((line) => fragments.every((fragment) => line.includes(fragment)));
      if (matchingLine) {
        return matchingLine;
      }
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label} in ${logDir}`);
}

async function clearRespawnPage(bot: HytaleBot, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (bot.ui.currentPage?.key === RESPAWN_PAGE_KEY) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error("Respawn page did not clear before gameplay interaction");
    }

    bot.sendPageEvent("Data", "{\"Action\":\"Respawn\"}");
    try {
      await waitForSetPage(bot, "None", Math.min(remainingMs, RESPAWN_CLEAR_ATTEMPT_TIMEOUT_MS));
    } catch {
      await delay(Math.min(500, Math.max(0, deadline - Date.now())));
    }
  }
}

async function bootstrapRhythmOperator(bot: HytaleBot): Promise<void> {
  bot.chat("/op self");
  await delay(SELF_OP_SETTLE_MS);
  bot.chat("/rhythm debug on");
  await delay(DEBUG_COMMAND_SETTLE_MS);
}

async function enterRhythmSelection(bot: HytaleBot, timeoutMs: number): Promise<CustomPagePacket> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= PAGE_OPEN_MAX_ATTEMPTS; attempt += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }
    bot.chat("/rhythm ui");
    try {
      return await bot.waitForPage(SELECTION_PAGE_KEY, Math.min(remainingMs, PAGE_OPEN_ATTEMPT_TIMEOUT_MS));
    } catch (error) {
      lastError = error;
      if (attempt === PAGE_OPEN_MAX_ATTEMPTS) {
        break;
      }
      await delay(Math.min(PAGE_OPEN_RETRY_DELAY_MS, Math.max(0, deadline - Date.now())));
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(`Timed out waiting for selection page ${SELECTION_PAGE_KEY}`);
}

async function driveSelection(bot: HytaleBot): Promise<void> {
  bot.sendPageEvent("Data", "{\"Song\":\"debug-song\"}");
  await delay(150);
  bot.sendPageEvent("Data", "{\"Chart\":\"debug/test-4k\"}");
  await delay(150);
  bot.sendPageEvent("Data", "{\"Action\":\"Confirm\"}");
}

async function waitForGameplay(bot: HytaleBot, timeoutMs: number): Promise<CustomPagePacket> {
  bot.chat("/rhythm start");
  return bot.waitForPage(GAMEPLAY_PAGE_KEY, timeoutMs);
}

async function playGameplay(bot: HytaleBot, inputMode: GameplayInputMode): Promise<void> {
  const startedAt = Date.now();
  if (inputMode === "ui-packet") {
    let captureBuffer = "";
    for (const input of GAMEPLAY_PACKET_INPUTS) {
      const waitMs = Math.max(0, input.songTimeMillis - (Date.now() - startedAt));
      await delay(waitMs);
      captureBuffer += input.key;
      bot.sendPageEvent("Data", capturePayload(input, captureBuffer.slice(0, -1)));
    }
    return;
  }

  for (const input of GAMEPLAY_COMMAND_INPUTS) {
    const waitMs = Math.max(0, input.songTimeMillis - 100 - (Date.now() - startedAt));
    await delay(waitMs);
    bot.chat(makeCommand(input, input.songTimeMillis));
  }
}

async function executeScenario(name: ScenarioName, options: ScenarioOptions): Promise<ScenarioResult> {
  const startedAt = new Date().toISOString();
  const outputDir = await ensureOutputDir(options.outputDir);
  const assertions: string[] = [];
  const expectedChart = options.expectedChart ?? DEFAULT_EXPECTED_CHART;
  const authoritativeLogDir = options.authoritativeLogDir;
  const bot = await createBot({
    host: options.host,
    port: options.port,
    username: options.username,
    uuid: options.uuid,
    language: options.language,
    autoAcknowledgePages: options.autoAcknowledgePages,
    heartbeatIntervalMs: options.heartbeatIntervalMs,
    quic: options.quic,
    auth: options.auth
  });

  let finalServerMessage: string | null = null;
  const handleRespawnPage = (page: CustomPagePacket): void => {
    if (page.key !== RESPAWN_PAGE_KEY) {
      return;
    }
    bot.sendPageEvent("Data", "{\"Action\":\"Respawn\"}");
  };

  try {
    bot.on("page", handleRespawnPage);
    if (outputDir) {
      await bot.trace.enable({ outputDir });
    }
    await bot.connect();
    await bot.waitForReady(options.timeoutMs ?? 15_000);
    await bot.waitForWorldActivity(options.timeoutMs ?? 15_000);
    await bot.waitForClientId(5_000).catch(() => null);
    assertions.push("connected");
    assertions.push("world-joined");

    if (name === "connect-only") {
      return {
        name,
        success: true,
        startedAt,
        endedAt: new Date().toISOString(),
        assertions,
        outputDir,
        finalServerMessage
      };
    }

    if (name === "listen-only") {
      await delay(options.traceDurationMs ?? 60_000);
      assertions.push("listen-window-complete");
      return {
        name,
        success: true,
        startedAt,
        endedAt: new Date().toISOString(),
        assertions,
        outputDir,
        finalServerMessage
      };
    }

    await delay(POST_WORLD_JOIN_SETTLE_MS);
    await clearRespawnPage(bot, 10_000);
    await bootstrapRhythmOperator(bot);
    assertions.push("world-settled");

    await enterRhythmSelection(bot, options.timeoutMs ?? 15_000);
    assertions.push("selection-page-opened");

    if (name === "trace-ui") {
      await delay(options.traceDurationMs ?? 60_000);
      assertions.push("trace-window-complete");
      return {
        name,
        success: true,
        startedAt,
        endedAt: new Date().toISOString(),
        assertions,
        outputDir,
        finalServerMessage
      };
    }

    await driveSelection(bot);
    assertions.push("selection-driven");
    await waitForSetPage(bot, "None", options.timeoutMs ?? 15_000);
    await delay(SELECTION_CLOSE_SETTLE_MS);
    assertions.push("selection-confirmed");
    await waitForGameplay(bot, options.timeoutMs ?? 15_000);
    assertions.push("gameplay-page-opened");

    if (name === "smoke") {
      await playGameplay(bot, options.inputMode ?? "command-input");
      const messageRequiredFragments = [`chart=${expectedChart}`];
      const logRequiredFragments = ["gameplay_completed", `playerId=${bot.uuid ?? ""}`, `chartId=${expectedChart}`];
      if (options.expectedScore != null) {
        messageRequiredFragments.push(`score=${options.expectedScore}`);
        logRequiredFragments.push(`score=${options.expectedScore}`);
      }
      if (options.expectedMaxCombo != null) {
        messageRequiredFragments.push(`maxCombo=${options.expectedMaxCombo}`);
        logRequiredFragments.push(`maxCombo=${options.expectedMaxCombo}`);
      }
      if (authoritativeLogDir) {
        await delay(AUTHORITATIVE_LOG_DISCONNECT_SETTLE_MS);
        await bot.disconnect().catch(() => undefined);
        finalServerMessage = await waitForAuthoritativeLogLine(
          authoritativeLogDir,
          logRequiredFragments,
          options.timeoutMs ?? 30_000,
          "authoritative gameplay completion"
        );
      } else {
        finalServerMessage = await waitForServerMessageIncludingAll(
          bot,
          [`phase=ENDED`, ...messageRequiredFragments],
          options.timeoutMs ?? 30_000,
          "authoritative gameplay completion"
        );
      }
      assertions.push("gameplay-completed");
      if (options.expectedScore != null) {
        assertions.push("authoritative-score");
      }
      if (options.expectedMaxCombo != null) {
        assertions.push("authoritative-max-combo");
      }
    }

    if (name === "stop") {
      bot.sendPageEvent("Data", "{\"Request\":\"Stop\"}");
      finalServerMessage = authoritativeLogDir
        ? await waitForAuthoritativeLogLine(
          authoritativeLogDir,
          ["phase=ENDED", `chartId=${expectedChart}`, "finishReason=ui_stop", `playerId=${bot.uuid ?? ""}`],
          options.timeoutMs ?? 15_000,
          "stop completion"
        )
        : await waitForServerMessageIncludingAll(
          bot,
          ["phase=ENDED", `chart=${expectedChart}`, "finish=ui_stop"],
          options.timeoutMs ?? 15_000,
          "stop completion"
        );
      assertions.push("stop-request-completed");
    }

    if (name === "close") {
      bot.sendPageEvent("Data", "{\"Request\":\"Close\"}");
      await waitForSetPage(bot, "None", options.timeoutMs ?? 15_000);
      assertions.push("close-request-dismissed");
      finalServerMessage = await bot.waitForServerMessageMatching(
        (message) =>
          message.includes("phase=PLAYING")
          && message.includes(`chart=${expectedChart}`)
          && (message.includes("gameplay=active") || message.includes("gameplay=idle")),
        options.timeoutMs ?? 15_000,
        "post-close gameplay state"
      );
      assertions.push("gameplay-still-running");
    }

    return {
      name,
      success: true,
      startedAt,
      endedAt: new Date().toISOString(),
      assertions,
      outputDir,
      finalServerMessage
    };
  } finally {
    bot.off("page", handleRespawnPage);
    await bot.trace.flush(outputDir ?? undefined);
    await bot.disconnect().catch(() => undefined);
  }
}

export async function runScenario(name: ScenarioName, options: ScenarioOptions): Promise<ScenarioResult> {
  return executeScenario(name, options);
}

export async function runStopAndClose(options: ScenarioOptions): Promise<readonly ScenarioResult[]> {
  const stopResult = await executeScenario("stop", options);
  const closeResult = await executeScenario("close", options);
  return [stopResult, closeResult];
}
