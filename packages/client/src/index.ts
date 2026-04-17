import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  FramedPacketDecoder,
  ProtocolError,
  createConnectPacket,
  createDefaultMovementStates,
  encodeFramedPacket,
  formattedMessageToPlainText,
  snapshotCustomPage,
  type AuthGrantPacket,
  type AuthTokenPacket,
  type ChatMessagePacket,
  type ClientMovementPacket,
  type ClientReadyPacket,
  type ClientTeleportPacket,
  type ComponentUpdate,
  type ConnectPacket,
  type CustomPageEventPacket,
  type CustomPagePacket,
  type DecodedPacket,
  type Direction,
  type EntityStatType,
  type EntityStatUpdate,
  type EntityUpdatesPacket,
  type InventorySection,
  type ItemWithAllMetadata,
  type JoinWorldPacket,
  type MovementStates,
  type PingPacket,
  type PongPacket,
  type Position,
  type RequestAssetsPacket,
  type RawPacket,
  type ServerAuthTokenPacket,
  type ServerMessagePacket,
  type SetClientIdPacket,
  type SetPagePacket,
  type StructuredPacket,
  type UpdateEntityStatTypesPacket,
  type UpdatePlayerInventoryPacket,
  type ViewRadiusPacket,
  type WorldSettingsPacket
} from "@hyrhythm/hytale-protocol";

export interface TraceEnableOptions {
  readonly outputDir?: string;
}

export interface BotQuicOptions {
  readonly serverJarPath?: string;
  readonly bridgeSourcePath?: string;
  readonly bridgeClassDir?: string;
  readonly javaPath?: string;
  readonly javacPath?: string;
  readonly readyTimeoutMs?: number;
}

export interface BotAuthOptions {
  readonly domain?: string;
  readonly identityToken?: string;
  readonly sessionToken?: string;
  readonly password?: string;
  readonly scopes?: readonly string[];
}

export interface BotOptions {
  readonly host?: string;
  readonly port?: number;
  readonly username: string;
  readonly uuid?: string;
  readonly language?: string;
  readonly autoConnect?: boolean;
  readonly autoAcknowledgePages?: boolean;
  readonly heartbeatIntervalMs?: number;
  readonly quic?: BotQuicOptions;
  readonly auth?: BotAuthOptions;
}

export interface EntityStatSnapshot {
  readonly statId: number;
  readonly type?: EntityStatType | null;
  readonly value: number;
  readonly lastOp?: EntityStatUpdate["op"];
  readonly predictable?: boolean;
  readonly updatedAt: string;
}

export interface StatValueSnapshot {
  readonly id: number;
  readonly name: string | null;
  readonly value: number | null;
  readonly updatedAt: string | null;
  readonly lastOp?: EntityStatUpdate["op"];
  readonly predictable?: boolean;
}

export interface EntityState {
  readonly id: number;
  position: Position | null;
  bodyOrientation: Direction | null;
  lookOrientation: Direction | null;
  movementStates: MovementStates | null;
  stats: Map<number, EntityStatSnapshot>;
}

export interface InventoryState {
  sortType: UpdatePlayerInventoryPacket["sortType"];
  storage: InventorySection | null;
  armor: InventorySection | null;
  hotbar: InventorySection | null;
  utility: InventorySection | null;
  builderMaterial: InventorySection | null;
  tools: InventorySection | null;
  backpack: InventorySection | null;
}

export interface WorldState {
  readonly entities: Map<number, EntityState>;
  readonly statTypes: Map<number, EntityStatType>;
  readonly inventory: InventoryState;
  worldSettings: WorldSettingsPacket | null;
  viewRadius: number | null;
}

export interface NearbyEntity {
  readonly entity: EntityState;
  readonly distance: number;
}

export interface NearbyEntitySnapshot {
  readonly id: number;
  readonly distance: number;
  readonly position: Position;
  readonly health: number | null;
}

export interface WorldSnapshot {
  readonly clientId: number | null;
  readonly position: Position | null;
  readonly bodyOrientation: Direction | null;
  readonly lookOrientation: Direction | null;
  readonly movementStates: MovementStates | null;
  readonly health: number | null;
  readonly inventory: InventoryState;
  readonly statValues: readonly StatValueSnapshot[];
  readonly entityCount: number;
  readonly statTypeNames: readonly string[];
  readonly nearbyEntities: readonly NearbyEntitySnapshot[];
  readonly worldHeight: number | null;
  readonly viewRadius: number | null;
}

export type BotPlugin = (bot: HytaleBot) => void | Promise<void>;

interface PacketTraceEntry {
  readonly at: string;
  readonly direction: "in" | "out";
  readonly packetName: string;
  readonly packet: unknown;
}

interface ErrorTraceEntry {
  readonly at: string;
  readonly message: string;
  readonly stack: string | null;
}

function timeoutError(label: string, timeoutMs: number): Error {
  return new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
}

const DISCONNECT_GRACE_MS = 1_000;
const DEFAULT_QUIC_READY_TIMEOUT_MS = 10_000;
const BRIDGE_CLASS_NAME = "HytaleQuicStdioBridge";
const DEFAULT_AUTH_SCOPES = ["hytale:client", "hytale:server"] as const;
const ENV_AUTH_DOMAIN = "HYTALE_AUTH_DOMAIN";
const ENV_IDENTITY_TOKEN = "HYTALE_IDENTITY_TOKEN";
const ENV_SESSION_TOKEN = "HYTALE_SESSION_TOKEN";
const ENV_AUTH_PASSWORD = "HYTALE_AUTH_PASSWORD";
const ENV_AUTH_SCOPES = "HYTALE_AUTH_SCOPES";
const ENV_BOT_UUID = "HYTALE_BOT_UUID";

function resolveDefaultBridgeSource(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(moduleDir, "..", "..", "..", "scripts", "HytaleQuicStdioBridge.java"),
    path.resolve(moduleDir, "..", "..", "scripts", "HytaleQuicStdioBridge.java"),
    path.resolve(process.cwd(), "scripts", "HytaleQuicStdioBridge.java"),
    path.resolve(process.cwd(), "packages", "client", "src", "quic", "HytaleQuicStdioBridge.java"),
    path.resolve(process.cwd(), "packages", "client", "scripts", "HytaleQuicStdioBridge.java")
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

interface AuthTokens {
  readonly identityToken: string;
  readonly sessionToken: string;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolveAuthDomainFromToken(identityToken: string | null): string | null {
  if (!identityToken) {
    return null;
  }
  const payload = decodeJwtPayload(identityToken);
  const issuer = typeof payload?.iss === "string" ? payload.iss : null;
  if (!issuer) {
    return null;
  }
  try {
    return new URL(issuer).host;
  } catch {
    return null;
  }
}

function parseAuthScopes(value: string | null | undefined): readonly string[] | null {
  if (!value) {
    return null;
  }
  const scopes = value
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
  return scopes.length > 0 ? scopes : null;
}

function extractServerAudience(serverIdentityToken: string | null): string | null {
  if (!serverIdentityToken) {
    return null;
  }
  const payload = decodeJwtPayload(serverIdentityToken);
  const sub = typeof payload?.sub === "string" ? payload.sub : null;
  if (sub) {
    return sub;
  }
  const aud = payload?.aud;
  if (typeof aud === "string") {
    return aud;
  }
  if (Array.isArray(aud) && typeof aud[0] === "string") {
    return aud[0];
  }
  return null;
}

async function postJson<T>(url: string, body: unknown, sessionToken?: string | null): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json"
  };
  if (sessionToken) {
    headers.Authorization = `Bearer ${sessionToken}`;
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Auth request failed (${response.status}) ${text}`.trim());
  }
  return response.json() as Promise<T>;
}

async function fetchAuthTokens(
  domain: string,
  uuid: string,
  username: string,
  password: string | null,
  scopes: readonly string[]
): Promise<AuthTokens> {
  const url = `https://${domain}/player/token`;
  const payload: Record<string, unknown> = {
    uuid,
    name: username,
    scopes
  };
  if (password) {
    payload.password = password;
  }
  const response = await postJson<Record<string, unknown>>(url, payload);
  const identityToken = (
    response.identityToken ??
    response.IdentityToken ??
    response.identity_token ??
    response.IdentityToken ??
    response.Identity_Token
  ) as string | undefined;
  const sessionToken = (
    response.sessionToken ??
    response.SessionToken ??
    response.session_token ??
    response.Session_Token
  ) as string | undefined;
  if (!identityToken || !sessionToken) {
    throw new Error("Auth response missing identityToken or sessionToken");
  }
  return { identityToken, sessionToken };
}

async function requestServerAuthGrant(
  domain: string,
  identityToken: string,
  sessionToken: string,
  audience: string
): Promise<string> {
  const url = `https://${domain}/server-join/auth-grant`;
  const response = await postJson<Record<string, unknown>>(url, { identityToken, aud: audience }, sessionToken);
  const grant = response.authorizationGrant as string | undefined;
  if (!grant) {
    throw new Error("Auth grant response missing authorizationGrant");
  }
  return grant;
}

async function exchangeAuthGrantForToken(
  domain: string,
  authorizationGrant: string,
  sessionToken: string,
  x509Fingerprint: string
): Promise<string> {
  const url = `https://${domain}/server-join/auth-token`;
  const response = await postJson<Record<string, unknown>>(
    url,
    { authorizationGrant, x509Fingerprint },
    sessionToken
  );
  const token = response.accessToken as string | undefined;
  if (!token) {
    throw new Error("Access token response missing accessToken");
  }
  return token;
}

function resolveDefaultJavaPath(): string {
  return process.platform === "win32" ? "java.exe" : "java";
}

function resolveDefaultJavacPath(): string {
  return process.platform === "win32" ? "javac.exe" : "javac";
}

async function runProcess(command: string, args: readonly string[], label: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${label} failed with exit code ${code ?? "null"}`));
      }
    });
  });
}

async function ensureBridgeCompiled(options: Required<BotQuicOptions>): Promise<string> {
  const serverJarPath = options.serverJarPath;
  const sourcePath = options.bridgeSourcePath;
  const classDir = options.bridgeClassDir;
  const classFile = path.join(classDir, `${BRIDGE_CLASS_NAME}.class`);

  if (!existsSync(serverJarPath)) {
    throw new Error(`Hytale server jar not found at ${serverJarPath}`);
  }
  if (!existsSync(sourcePath)) {
    throw new Error(`QUIC bridge source not found at ${sourcePath}`);
  }

  let compile = true;
  if (existsSync(classFile)) {
    const [sourceStat, classStat] = await Promise.all([stat(sourcePath), stat(classFile)]);
    if (classStat.mtimeMs >= sourceStat.mtimeMs) {
      compile = false;
    }
  }

  if (compile) {
    await mkdir(classDir, { recursive: true });
    await runProcess(options.javacPath, ["-cp", serverJarPath, "-d", classDir, sourcePath], "javac");
  }

  return classDir;
}

async function waitForBridgeReady(
  process: ChildProcessWithoutNullStreams,
  timeoutMs: number
): Promise<string | null> {
  return new Promise<string | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for QUIC bridge after ${timeoutMs}ms`));
    }, timeoutMs);

    const rl = createInterface({ input: process.stderr });
    let fingerprint: string | null = null;
    const onLine = (line: string): void => {
      if (line.includes("QUIC_BRIDGE_CERT_FINGERPRINT")) {
        const match = line.match(/QUIC_BRIDGE_CERT_FINGERPRINT[= ]([A-Za-z0-9_-]+)/);
        if (match?.[1]) {
          fingerprint = match[1];
        }
      }
      if (line.includes("QUIC_BRIDGE_READY")) {
        cleanup();
        resolve(fingerprint);
      }
    };
    const onExit = (code: number | null): void => {
      cleanup();
      reject(new Error(`QUIC bridge exited before ready (code ${code ?? "null"})`));
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    function cleanup(): void {
      clearTimeout(timer);
      rl.off("line", onLine);
      rl.close();
      process.off("exit", onExit);
      process.off("error", onError);
    }

    rl.on("line", onLine);
    process.once("exit", onExit);
    process.once("error", onError);
  });
}

async function startQuicBridge(
  options: Required<BotQuicOptions>,
  host: string,
  port: number
): Promise<{ process: ChildProcessWithoutNullStreams; fingerprint: string | null }> {
  const classDir = await ensureBridgeCompiled(options);
  const classpath = [options.serverJarPath, classDir].join(path.delimiter);
  const child = spawn(options.javaPath, ["-cp", classpath, BRIDGE_CLASS_NAME, host, port.toString()], {
    stdio: ["pipe", "pipe", "pipe"]
  });
  const fingerprint = await waitForBridgeReady(child, options.readyTimeoutMs);
  return { process: child, fingerprint };
}

function resolveQuicOptions(options: BotQuicOptions | undefined): Required<BotQuicOptions> {
  const serverJarPath = options?.serverJarPath ?? process.env.HYTALE_SERVER_JAR ?? "";
  if (!serverJarPath) {
    throw new Error("HYTALE_SERVER_JAR is required for QUIC bot connections.");
  }
  return {
    serverJarPath,
    bridgeSourcePath: options?.bridgeSourcePath ?? resolveDefaultBridgeSource(),
    bridgeClassDir: options?.bridgeClassDir ?? path.join(tmpdir(), "hytale-quic-bridge"),
    javaPath: options?.javaPath ?? resolveDefaultJavaPath(),
    javacPath: options?.javacPath ?? resolveDefaultJavacPath(),
    readyTimeoutMs: options?.readyTimeoutMs ?? DEFAULT_QUIC_READY_TIMEOUT_MS
  };
}

async function writeText(filePath: string, value: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

function incrementCount(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function formatTraceTranscript(
  bot: string,
  host: string,
  port: number,
  packetTrace: readonly PacketTraceEntry[],
  pageTrace: readonly unknown[],
  serverMessages: readonly string[],
  errorTrace: readonly ErrorTraceEntry[]
): string {
  const packetCounts = new Map<string, number>();
  for (const entry of packetTrace) {
    incrementCount(packetCounts, `${entry.direction}:${entry.packetName}`);
  }

  const lines: string[] = [
    `generatedAt=${new Date().toISOString()}`,
    `bot=${bot}`,
    `host=${host}`,
    `port=${port}`,
    `packetCount=${packetTrace.length}`,
    `pageCount=${pageTrace.length}`,
    `serverMessageCount=${serverMessages.length}`,
    `errorCount=${errorTrace.length}`,
    "",
    "[packet-counts]"
  ];

  if (packetCounts.size === 0) {
    lines.push("none");
  } else {
    for (const [key, count] of [...packetCounts.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
      lines.push(`${key}=${count}`);
    }
  }

  lines.push("", "[pages]");
  if (pageTrace.length === 0) {
    lines.push("none");
  } else {
    for (const entry of pageTrace) {
      const pageEntry = entry as {
        at?: string;
        snapshot?: {
          key?: string | null;
          selectors?: readonly string[];
        };
      };
      const at = pageEntry.at ?? "unknown";
      const key = pageEntry.snapshot?.key ?? "null";
      const selectors = pageEntry.snapshot?.selectors?.join(",") ?? "";
      lines.push(`${at} key=${key}${selectors ? ` selectors=${selectors}` : ""}`);
    }
  }

  lines.push("", "[server-messages]");
  if (serverMessages.length === 0) {
    lines.push("none");
  } else {
    lines.push(...serverMessages);
  }

  lines.push("", "[errors]");
  if (errorTrace.length === 0) {
    lines.push("none");
  } else {
    for (const entry of errorTrace) {
      lines.push(`${entry.at} ${entry.message}`);
      if (entry.stack) {
        lines.push(entry.stack);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

export class HytaleBot extends EventEmitter {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly uuid?: string;
  readonly language: string;
  readonly autoAcknowledgePages: boolean;
  readonly heartbeatIntervalMs: number;

  readonly ui: {
    currentPage: CustomPagePacket | null;
    lastSetPage: SetPagePacket | null;
  } = {
    currentPage: null,
    lastSetPage: null
  };

  readonly world: WorldState = {
    entities: new Map(),
    statTypes: new Map(),
    inventory: {
      sortType: "Name",
      storage: null,
      armor: null,
      hotbar: null,
      utility: null,
      builderMaterial: null,
      tools: null,
      backpack: null
    },
    worldSettings: null,
    viewRadius: null
  };

  readonly trace = {
    enable: async (options: TraceEnableOptions = {}): Promise<void> => {
      this.traceEnabled = true;
      this.traceOutputDir = options.outputDir ?? null;
    },
    disable: (): void => {
      this.traceEnabled = false;
    },
    flush: async (outputDir?: string): Promise<void> => {
      const destination = outputDir ?? this.traceOutputDir;
      if (!destination) {
        return;
      }
      await writeText(
        path.join(destination, "transcript.txt"),
        formatTraceTranscript(
          this.username,
          this.host,
          this.port,
          this.packetTrace,
          this.pageTrace,
          this.serverMessages,
          this.errorTrace
        )
      );
    }
  };

  private bridgeProcess: ChildProcessWithoutNullStreams | null = null;
  private readonly quicOptions?: BotQuicOptions;
  private authDomain: string | null;
  private identityToken: string | null;
  private sessionToken: string | null;
  private authPassword: string | null;
  private authScopes: readonly string[];
  private clientCertFingerprint: string | null = null;
  private readonly statTypeByName = new Map<string, number>();
  private inventorySeen = false;
  private readonly decoder = new FramedPacketDecoder("toClient");
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private traceEnabled = false;
  private traceOutputDir: string | null = null;
  private readonly packetTrace: PacketTraceEntry[] = [];
  private readonly pageTrace: unknown[] = [];
  private readonly serverMessages: string[] = [];
  private readonly errorTrace: ErrorTraceEntry[] = [];
  private connected = false;
  private worldJoined = false;
  private worldActive = false;
  private currentWorldUuid: string | null = null;
  private connectPacket: ConnectPacket;
  private clientId: number | null = null;
  private currentPosition: Position | null = null;
  private currentBodyOrientation: Direction = { yaw: 0, pitch: 0, roll: 0 };
  private currentLookOrientation: Direction = { yaw: 0, pitch: 0, roll: 0 };
  private customPageVisible = false;

  constructor(options: BotOptions) {
    super();
    this.host = options.host ?? DEFAULT_HOST;
    this.port = options.port ?? DEFAULT_PORT;
    this.username = options.username;
    this.uuid = options.uuid ?? process.env[ENV_BOT_UUID];
    this.language = options.language ?? "en";
    this.autoAcknowledgePages = options.autoAcknowledgePages ?? true;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 250;
    this.quicOptions = options.quic;
    this.identityToken = options.auth?.identityToken ?? process.env[ENV_IDENTITY_TOKEN] ?? null;
    this.sessionToken = options.auth?.sessionToken ?? process.env[ENV_SESSION_TOKEN] ?? null;
    this.authPassword = options.auth?.password ?? process.env[ENV_AUTH_PASSWORD] ?? null;
    this.authScopes = options.auth?.scopes ?? parseAuthScopes(process.env[ENV_AUTH_SCOPES]) ?? DEFAULT_AUTH_SCOPES;
    this.authDomain =
      options.auth?.domain ??
      process.env[ENV_AUTH_DOMAIN] ??
      resolveAuthDomainFromToken(this.identityToken);
    this.connectPacket = createConnectPacket({
      username: this.username,
      uuid: this.uuid,
      language: this.language
    });
  }

  use(plugin: BotPlugin): Promise<void> {
    return Promise.resolve(plugin(this));
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    this.worldJoined = false;
    this.worldActive = false;
    this.currentWorldUuid = null;
    this.clientId = null;
    this.currentPosition = null;
    this.ui.currentPage = null;
    this.ui.lastSetPage = null;
    this.customPageVisible = false;
    this.resetWorldState();

    await this.ensureAuthTokens();
    if (this.identityToken) {
      this.connectPacket = createConnectPacket({
        username: this.username,
        uuid: this.connectPacket.uuid,
        language: this.language,
        identityToken: this.identityToken
      });
    }

    const quicOptions = resolveQuicOptions(this.quicOptions);
    const bridge = await startQuicBridge(quicOptions, this.host, this.port);
    this.bridgeProcess = bridge.process;
    this.clientCertFingerprint = bridge.fingerprint;

    bridge.process.stdout.on("data", (chunk) => {
      try {
        this.handleChunk(chunk);
      } catch (error) {
        this.recordError(error);
      }
    });
    bridge.process.on("error", (error) => {
      this.recordError(error);
    });
    bridge.process.on("exit", () => {
      this.connected = false;
      this.worldJoined = false;
      this.worldActive = false;
      this.currentWorldUuid = null;
      this.clientId = null;
      this.currentPosition = null;
      this.ui.currentPage = null;
      this.ui.lastSetPage = null;
      this.customPageVisible = false;
      this.resetWorldState();
      this.bridgeProcess = null;
      this.clientCertFingerprint = null;
      this.stopHeartbeat();
      this.emit("close");
    });

    this.connected = true;
    this.sendPacket(this.connectPacket);
    this.emit("connect");
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    const bridgeProcess = this.bridgeProcess;
    if (!bridgeProcess || bridgeProcess.killed) {
      this.bridgeProcess = null;
      return;
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(forceCloseTimer);
        resolve();
      };
      bridgeProcess.once("exit", finish);
      bridgeProcess.once("error", finish);
      const forceCloseTimer = setTimeout(() => {
        if (!bridgeProcess.killed) {
          bridgeProcess.kill();
        }
      }, DISCONNECT_GRACE_MS);
      bridgeProcess.stdin.end();
      setImmediate(() => {
        if (bridgeProcess.exitCode != null) {
          finish();
        }
      });
    });
    this.bridgeProcess = null;
  }

  private resetWorldState(): void {
    this.world.entities.clear();
    this.world.statTypes.clear();
    this.statTypeByName.clear();
    this.inventorySeen = false;
    this.world.inventory.sortType = "Name";
    this.world.inventory.storage = null;
    this.world.inventory.armor = null;
    this.world.inventory.hotbar = null;
    this.world.inventory.utility = null;
    this.world.inventory.builderMaterial = null;
    this.world.inventory.tools = null;
    this.world.inventory.backpack = null;
    this.world.worldSettings = null;
    this.world.viewRadius = null;
  }

  private async ensureAuthTokens(): Promise<void> {
    if (this.identityToken) {
      if (!this.authDomain) {
        this.authDomain = resolveAuthDomainFromToken(this.identityToken);
      }
      return;
    }
    if (!this.authDomain) {
      return;
    }
    const tokens = await fetchAuthTokens(
      this.authDomain,
      this.connectPacket.uuid,
      this.username,
      this.authPassword,
      this.authScopes
    );
    this.identityToken = tokens.identityToken;
    this.sessionToken = tokens.sessionToken;
  }

  sendPacket(packet: StructuredPacket): void {
    if (!this.bridgeProcess || !this.connected) {
      throw new ProtocolError(`Cannot send ${packet.name} because the bot is not connected`);
    }
    this.recordPacket("out", packet);
    this.bridgeProcess.stdin.write(encodeFramedPacket(packet, "toServer"));
  }

  chat(message: string): void {
    const packet: ChatMessagePacket = { name: "ChatMessage", message };
    this.sendPacket(packet);
  }

  move(update: Partial<ClientMovementPacket> = {}): void {
    if (update.absolutePosition !== undefined) {
      this.currentPosition = update.absolutePosition ?? null;
    }
    if (update.bodyOrientation) {
      this.currentBodyOrientation = update.bodyOrientation;
    }
    if (update.lookOrientation) {
      this.currentLookOrientation = update.lookOrientation;
    }
    this.sendPacket(this.createMovementPacket(update));
  }

  look(yaw: number, pitch: number, roll = 0): void {
    this.currentBodyOrientation = { yaw, pitch: 0, roll };
    this.currentLookOrientation = { yaw, pitch, roll };
    this.move();
  }

  ackPage(): void {
    this.sendPageEvent("Acknowledge", null);
  }

  sendPageEvent(type: CustomPageEventPacket["type"], data: string | null): void {
    this.sendPacket({
      name: "CustomPageEvent",
      type,
      data
    });
  }

  snapshotPage(): ReturnType<typeof snapshotCustomPage> | null {
    return this.ui.currentPage ? snapshotCustomPage(this.ui.currentPage) : null;
  }

  async waitForPage(key: string, timeoutMs = 10_000): Promise<CustomPagePacket> {
    if (this.ui.currentPage?.key === key) {
      return this.ui.currentPage;
    }
    return this.waitForEvent("page", (page) => page.key === key, timeoutMs);
  }

  async waitForServerMessage(fragment: string, timeoutMs = 10_000): Promise<string> {
    const existing = this.serverMessages.find((message) => message.includes(fragment));
    if (existing) {
      return existing;
    }
    return this.waitForEvent("serverMessage", (message) => message.includes(fragment), timeoutMs);
  }

  async waitForServerMessageMatching(
    predicate: (message: string) => boolean,
    timeoutMs = 10_000,
    label = "serverMessage"
  ): Promise<string> {
    const existing = this.serverMessages.find(predicate);
    if (existing) {
      return existing;
    }
    return this.waitForEvent("serverMessage", predicate, timeoutMs, label);
  }

  getServerMessages(): readonly string[] {
    return [...this.serverMessages];
  }

  async waitForReady(timeoutMs = 15_000): Promise<void> {
    if (this.worldJoined) {
      return;
    }
    await this.waitForEvent("worldJoin", () => true, timeoutMs);
  }

  async waitForClientId(timeoutMs = 10_000): Promise<number> {
    if (this.clientId != null) {
      return this.clientId;
    }
    return this.waitForEvent("clientId", (clientId) => clientId != null, timeoutMs);
  }

  async waitForWorldActivity(timeoutMs = 10_000): Promise<string> {
    if (this.worldActive) {
      return "already-active";
    }
    return this.waitForEvent("worldActivity", (packetName) => typeof packetName === "string" && packetName.length > 0, timeoutMs, "world activity");
  }

  private handleChunk(chunk: Buffer): void {
    const packets = this.decoder.push(chunk);
    packets.forEach((packet) => this.handlePacket(packet));
  }

  private handlePacket(packet: DecodedPacket): void {
    this.recordPacket("in", packet);
    this.emit("packet", packet);
    this.observeWorldActivity(packet);

    switch (packet.name) {
      case "AuthGrant":
        void this.handleAuthGrant(packet as AuthGrantPacket);
        return;
      case "ServerAuthToken":
        this.emit("serverAuthToken", packet as ServerAuthTokenPacket);
        return;
      case "WorldSettings":
        this.handleWorldSettings(packet as WorldSettingsPacket);
        return;
      case "ViewRadius":
        this.handleViewRadius(packet as ViewRadiusPacket);
        return;
      case "SetClientId":
        this.handleSetClientId(packet as SetClientIdPacket);
        return;
      case "JoinWorld":
        this.handleJoinWorld(packet as JoinWorldPacket);
        return;
      case "Ping":
        this.handlePing(packet as PingPacket);
        return;
      case "ClientTeleport":
        this.handleTeleport(packet as ClientTeleportPacket);
        return;
      case "SetPage":
        this.handleSetPage(packet as SetPagePacket);
        return;
      case "CustomPage":
        this.handleCustomPage(packet as CustomPagePacket);
        return;
      case "ChatMessage":
        this.handleChatMessage(packet as ChatMessagePacket);
        return;
      case "ServerMessage":
        this.handleServerMessage(packet as ServerMessagePacket);
        return;
      case "UpdateEntityStatTypes":
        this.handleEntityStatTypes(packet as UpdateEntityStatTypesPacket);
        return;
      case "UpdatePlayerInventory":
        this.handlePlayerInventory(packet as UpdatePlayerInventoryPacket);
        return;
      case "EntityUpdates":
        this.handleEntityUpdates(packet as EntityUpdatesPacket);
        return;
      case "Disconnect":
        this.emit("disconnect", packet);
        return;
      default:
        return;
    }
  }

  private async handleAuthGrant(packet: AuthGrantPacket): Promise<void> {
    try {
      const authorizationGrant = packet.authorizationGrant;
      if (!authorizationGrant) {
        throw new Error("AuthGrant missing authorizationGrant");
      }
      const identityToken = this.identityToken;
      const sessionToken = this.sessionToken;
      if (!identityToken || !sessionToken) {
        throw new Error("Auth requires identityToken and sessionToken");
      }
      const domain = this.authDomain ?? resolveAuthDomainFromToken(identityToken);
      if (!domain) {
        throw new Error("Auth domain not configured and could not be inferred from identity token");
      }
      this.authDomain = domain;
      const serverAudience = extractServerAudience(packet.serverIdentityToken ?? null);
      if (!serverAudience) {
        throw new Error("Server identity token missing audience information");
      }
      const fingerprint = this.clientCertFingerprint;
      if (!fingerprint) {
        throw new Error("Client certificate fingerprint not available for auth exchange");
      }
      const serverAuthorizationGrant = await requestServerAuthGrant(domain, identityToken, sessionToken, serverAudience);
      const accessToken = await exchangeAuthGrantForToken(domain, authorizationGrant, sessionToken, fingerprint);
      const authTokenPacket: AuthTokenPacket = {
        name: "AuthToken",
        accessToken,
        serverAuthorizationGrant
      };
      this.sendPacket(authTokenPacket);
      this.emit("auth", { accessToken, serverAuthorizationGrant });
    } catch (error) {
      this.recordError(error);
    }
  }

  private handleWorldSettings(packet: WorldSettingsPacket): void {
    this.world.worldSettings = packet;
    const requestAssets: RequestAssetsPacket = { name: "RequestAssets", assets: [] };
    const viewRadius: ViewRadiusPacket = { name: "ViewRadius", value: 6 };
    this.world.viewRadius = viewRadius.value;
    this.sendPacket(requestAssets);
    this.sendPacket(viewRadius);
    this.sendPacket({ name: "PlayerOptions", skin: null });
    this.emit("worldSettings");
  }

  private handleViewRadius(packet: ViewRadiusPacket): void {
    this.world.viewRadius = packet.value;
    this.emit("viewRadius", packet);
  }

  private handleJoinWorld(packet: JoinWorldPacket): void {
    const worldChanged = this.currentWorldUuid !== packet.worldUuid;
    if (packet.clearWorld || worldChanged) {
      this.beginWorldTransition(packet);
    }
    this.worldJoined = true;
    this.currentWorldUuid = packet.worldUuid;
    const readyPacket: ClientReadyPacket = {
      name: "ClientReady",
      readyForChunks: true,
      readyForGameplay: this.clientId != null
    };
    this.sendPacket(readyPacket);
    if (this.clientId != null) {
      queueMicrotask(() => {
        if (!this.connected) {
          return;
        }
        this.sendPacket({
          name: "ClientReady",
          readyForChunks: true,
          readyForGameplay: true
        });
      });
    }
    this.emit("worldJoin", packet);
  }

  private beginWorldTransition(packet: JoinWorldPacket): void {
    this.stopHeartbeat();
    this.worldActive = false;
    this.currentPosition = null;
    this.currentBodyOrientation = { yaw: 0, pitch: 0, roll: 0 };
    this.currentLookOrientation = { yaw: 0, pitch: 0, roll: 0 };
    this.customPageVisible = false;
    this.ui.currentPage = null;
    this.ui.lastSetPage = null;
    if (packet.clearWorld) {
      this.resetWorldState();
    }
    this.emit("worldTransition", packet);
  }

  private handleSetClientId(packet: SetClientIdPacket): void {
    this.clientId = packet.clientId;
    if (this.clientId != null && this.currentPosition) {
      const entity = this.getOrCreateEntity(this.clientId);
      if (!entity.position) {
        entity.position = this.currentPosition;
      }
      entity.bodyOrientation = this.currentBodyOrientation;
      entity.lookOrientation = this.currentLookOrientation;
    }
    if (this.worldJoined) {
      const readyPacket: ClientReadyPacket = {
        name: "ClientReady",
        readyForChunks: true,
        readyForGameplay: true
      };
      this.sendPacket(readyPacket);
    }
    this.emit("clientId", this.clientId);
  }

  private handlePing(packet: PingPacket): void {
    const raw: PongPacket = { name: "Pong", id: packet.id, time: packet.time ?? null, type: "Raw", packetQueueSize: 0 };
    const direct: PongPacket = { name: "Pong", id: packet.id, time: packet.time ?? null, type: "Direct", packetQueueSize: 0 };
    const tick: PongPacket = { name: "Pong", id: packet.id, time: packet.time ?? null, type: "Tick", packetQueueSize: 0 };
    this.sendPacket(raw);
    this.sendPacket(direct);
    this.sendPacket(tick);
  }

  private handleTeleport(packet: ClientTeleportPacket): void {
    if (packet.modelTransform?.position) {
      this.currentPosition = packet.modelTransform.position;
    }
    if (packet.modelTransform?.bodyOrientation) {
      this.currentBodyOrientation = packet.modelTransform.bodyOrientation;
    }
    if (packet.modelTransform?.lookOrientation) {
      this.currentLookOrientation = packet.modelTransform.lookOrientation;
    }
    if (this.clientId != null && packet.modelTransform) {
      const entity = this.getOrCreateEntity(this.clientId);
      if (packet.modelTransform.position) {
        entity.position = packet.modelTransform.position;
      }
      if (packet.modelTransform.bodyOrientation) {
        entity.bodyOrientation = packet.modelTransform.bodyOrientation;
      }
      if (packet.modelTransform.lookOrientation) {
        entity.lookOrientation = packet.modelTransform.lookOrientation;
      }
    }
    this.sendPacket(
      this.createMovementPacket({
        teleportAck: { teleportId: packet.teleportId }
      })
    );
    this.startHeartbeat();
    this.emit("teleport", packet);
  }

  private handleSetPage(packet: SetPagePacket): void {
    this.ui.lastSetPage = packet;
    if (this.customPageVisible && packet.page === "None") {
      this.ui.currentPage = null;
      this.customPageVisible = false;
      if (this.autoAcknowledgePages) {
        this.ackPage();
      }
    }
    this.emit("setPage", packet);
  }

  private observeWorldActivity(packet: DecodedPacket): void {
    if (!this.worldJoined) {
      return;
    }

    switch (packet.name) {
      case "SetClientId":
      case "ClientTeleport":
      case "EntityUpdates":
      case "SetGameMode":
      case "CustomPage":
      case "SetPage":
        if (!this.worldActive) {
          this.worldActive = true;
          this.emit("worldActivity", packet.name);
        }
        if (packet.name === "ClientTeleport" || packet.name === "EntityUpdates" || packet.name === "SetGameMode") {
          this.startHeartbeat();
        }
        return;
      default:
        return;
    }
  }

  private handleCustomPage(packet: CustomPagePacket): void {
    this.customPageVisible = true;
    this.ui.currentPage = packet;
    const snapshot = snapshotCustomPage(packet);
    this.pageTrace.push({ at: new Date().toISOString(), snapshot });
    if (this.autoAcknowledgePages) {
      this.ackPage();
    }
    this.emit("page", packet);
  }

  private handleChatMessage(packet: ChatMessagePacket): void {
    const message = typeof packet.message === "string" ? packet.message : "";
    if (!message) {
      return;
    }
    this.serverMessages.push(message);
    this.emit("serverMessage", message);
    this.emit("chatMessage", message);
  }

  private handleServerMessage(packet: ServerMessagePacket | RawPacket): void {
    if ("structured" in packet && packet.structured === false) {
      const decodeHint = packet.decodeError ? `decodeError=${packet.decodeError}` : "raw";
      const message = `[server message ${decodeHint}]`;
      this.serverMessages.push(message);
      this.emit("serverMessage", message);
      return;
    }
    const message = formattedMessageToPlainText((packet as ServerMessagePacket).message);
    if (!message) {
      return;
    }
    this.serverMessages.push(message);
    this.emit("serverMessage", message);
  }

  private handleEntityStatTypes(packet: UpdateEntityStatTypesPacket): void {
    if (packet.type === "Init") {
      this.world.statTypes.clear();
      this.statTypeByName.clear();
    }

    if (packet.types) {
      for (const [rawKey, value] of Object.entries(packet.types)) {
        const key = Number(rawKey);
        if (!Number.isFinite(key)) {
          continue;
        }
        if (packet.type === "Remove") {
          this.world.statTypes.delete(key);
          if (value?.id) {
            const normalized = value.id.trim().toLowerCase();
            this.statTypeByName.delete(normalized);
            const base = normalized.split(/[.:]/).pop();
            if (base && base !== normalized) {
              this.statTypeByName.delete(base);
            }
          }
          continue;
        }
        this.world.statTypes.set(key, value);
        if (value?.id) {
          const normalized = value.id.trim().toLowerCase();
          this.statTypeByName.set(normalized, key);
          const base = normalized.split(/[.:]/).pop();
          if (base && base !== normalized && !this.statTypeByName.has(base)) {
            this.statTypeByName.set(base, key);
          }
        }
      }
    }

    this.emit("entityStatTypes", packet);
  }

  private handlePlayerInventory(packet: UpdatePlayerInventoryPacket): void {
    this.inventorySeen = true;
    this.world.inventory.sortType = packet.sortType;
    this.world.inventory.storage = packet.storage ?? null;
    this.world.inventory.armor = packet.armor ?? null;
    this.world.inventory.hotbar = packet.hotbar ?? null;
    this.world.inventory.utility = packet.utility ?? null;
    this.world.inventory.builderMaterial = packet.builderMaterial ?? null;
    this.world.inventory.tools = packet.tools ?? null;
    this.world.inventory.backpack = packet.backpack ?? null;
    this.emit("inventory", this.world.inventory);
  }

  private handleEntityUpdates(packet: EntityUpdatesPacket): void {
    if (packet.removed) {
      packet.removed.forEach((id) => this.world.entities.delete(id));
    }

    if (!packet.updates) {
      return;
    }

    for (const update of packet.updates) {
      const entity = this.getOrCreateEntity(update.networkId);
      if (update.removed) {
        update.removed.forEach((componentType) => {
          if (componentType === 8) {
            entity.stats.clear();
          }
          if (componentType === 9) {
            entity.position = null;
            entity.bodyOrientation = null;
            entity.lookOrientation = null;
          }
          if (componentType === 10) {
            entity.movementStates = null;
          }
        });
      }

      if (update.updates) {
        for (const component of update.updates) {
          this.applyComponentUpdate(entity, component);
        }
      }

      if (this.clientId != null && update.networkId === this.clientId) {
        this.currentPosition = entity.position ?? this.currentPosition;
        if (entity.bodyOrientation) {
          this.currentBodyOrientation = entity.bodyOrientation;
        }
        if (entity.lookOrientation) {
          this.currentLookOrientation = entity.lookOrientation;
        }
      }

      this.emit("entityUpdate", entity);
    }

    if (packet.partial) {
      this.emit("worldPartial", packet.partialReason ?? "partial entity update");
    }
  }

  private applyComponentUpdate(entity: EntityState, component: ComponentUpdate): void {
    switch (component.kind) {
      case "Transform":
        if (component.transform.position) {
          entity.position = component.transform.position;
        }
        if (component.transform.bodyOrientation) {
          entity.bodyOrientation = component.transform.bodyOrientation;
        }
        if (component.transform.lookOrientation) {
          entity.lookOrientation = component.transform.lookOrientation;
        }
        return;
      case "MovementStates":
        entity.movementStates = component.movementStates;
        return;
      case "EntityStats":
        Object.entries(component.entityStatUpdates).forEach(([rawKey, updates]) => {
          const statId = Number(rawKey);
          if (!Number.isFinite(statId)) {
            return;
          }
          updates.forEach((statUpdate) => this.applyEntityStatUpdate(entity, statId, statUpdate));
        });
        return;
    }
  }

  private applyEntityStatUpdate(entity: EntityState, statId: number, update: EntityStatUpdate): void {
    const type = this.world.statTypes.get(statId) ?? null;
    const existing = entity.stats.get(statId);
    let value = existing?.value ?? type?.value ?? 0;

    switch (update.op) {
      case "Init":
      case "Set":
        value = update.value;
        break;
      case "Add":
        value += update.value;
        break;
      case "Remove":
        entity.stats.delete(statId);
        return;
      case "Reset":
        value = type?.value ?? update.value;
        break;
      case "Minimize":
        value = Math.min(value, update.value);
        break;
      case "Maximize":
        value = Math.max(value, update.value);
        break;
      case "PutModifier":
      case "RemoveModifier":
      default:
        value = update.value;
        break;
    }

    entity.stats.set(statId, {
      statId,
      type,
      value,
      lastOp: update.op,
      predictable: update.predictable,
      updatedAt: new Date().toISOString()
    });
  }

  private getOrCreateEntity(id: number): EntityState {
    const existing = this.world.entities.get(id);
    if (existing) {
      return existing;
    }
    const entity: EntityState = {
      id,
      position: null,
      bodyOrientation: null,
      lookOrientation: null,
      movementStates: null,
      stats: new Map()
    };
    this.world.entities.set(id, entity);
    return entity;
  }

  getClientId(): number | null {
    return this.clientId;
  }

  getPosition(): Position | null {
    return this.currentPosition;
  }

  getSelfEntity(): EntityState | null {
    if (this.clientId == null) {
      return null;
    }
    return this.world.entities.get(this.clientId) ?? null;
  }

  getStatByName(name: string, entityId?: number): number | null {
    const resolvedId = entityId ?? this.clientId ?? null;
    if (resolvedId == null) {
      return null;
    }
    const entity = this.world.entities.get(resolvedId);
    if (!entity) {
      return null;
    }
    const statId = this.resolveStatId(name);
    if (statId == null) {
      return null;
    }
    const entry = entity.stats.get(statId);
    if (entry) {
      return entry.value;
    }
    const statType = this.world.statTypes.get(statId);
    return statType ? statType.value : null;
  }

  getStatSnapshotByName(name: string, entityId?: number): EntityStatSnapshot | null {
    const resolvedId = entityId ?? this.clientId ?? null;
    if (resolvedId == null) {
      return null;
    }
    const entity = this.world.entities.get(resolvedId);
    if (!entity) {
      return null;
    }
    const statId = this.resolveStatId(name);
    if (statId == null) {
      return null;
    }
    return entity.stats.get(statId) ?? null;
  }

  getHealth(entityId?: number): number | null {
    return this.getStatByName("health", entityId);
  }

  getStatValueSnapshots(entityId?: number): StatValueSnapshot[] {
    const resolvedId = entityId ?? this.clientId ?? null;
    if (resolvedId == null) {
      return [];
    }
    const entity = this.world.entities.get(resolvedId);
    if (!entity) {
      return [];
    }
    const results: StatValueSnapshot[] = [];
    for (const [id, type] of this.world.statTypes.entries()) {
      const entry = entity.stats.get(id) ?? null;
      results.push({
        id,
        name: type.id ?? null,
        value: entry?.value ?? type.value ?? null,
        updatedAt: entry?.updatedAt ?? null,
        lastOp: entry?.lastOp,
        predictable: entry?.predictable
      });
    }
    for (const [id, entry] of entity.stats.entries()) {
      if (this.world.statTypes.has(id)) {
        continue;
      }
      results.push({
        id,
        name: entry.type?.id ?? null,
        value: entry.value,
        updatedAt: entry.updatedAt ?? null,
        lastOp: entry.lastOp,
        predictable: entry.predictable
      });
    }
    return results;
  }

  getInventorySnapshot(): InventoryState {
    return this.cloneInventoryState();
  }

  getNearbyEntities(radius = 12, origin?: Position | null, includeSelf = false): NearbyEntity[] {
    const originPosition = origin ?? this.getSelfEntity()?.position ?? this.currentPosition;
    if (!originPosition) {
      return [];
    }
    const results: NearbyEntity[] = [];
    for (const entity of this.world.entities.values()) {
      if (!entity.position) {
        continue;
      }
      if (!includeSelf && this.clientId != null && entity.id === this.clientId) {
        continue;
      }
      const distance = this.distanceBetween(originPosition, entity.position);
      if (distance <= radius) {
        results.push({ entity, distance });
      }
    }
    results.sort((left, right) => left.distance - right.distance);
    return results;
  }

  getWorldSnapshot(nearbyRadius = 12): WorldSnapshot {
    const self = this.getSelfEntity();
    const position = this.currentPosition ?? self?.position ?? null;
    const bodyOrientation = self?.bodyOrientation ?? this.currentBodyOrientation ?? null;
    const lookOrientation = self?.lookOrientation ?? this.currentLookOrientation ?? null;
    const movementStates = self?.movementStates ?? null;
    const nearbyEntities = this.getNearbyEntities(nearbyRadius, position ?? undefined, false).map((entry) => ({
      id: entry.entity.id,
      distance: entry.distance,
      position: entry.entity.position ?? position ?? { x: 0, y: 0, z: 0 },
      health: this.getStatByName("health", entry.entity.id)
    }));
    const statTypeNames = [...this.world.statTypes.values()]
      .map((type) => type.id)
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    return {
      clientId: this.clientId ?? null,
      position,
      bodyOrientation,
      lookOrientation,
      movementStates,
      health: this.getHealth(),
      inventory: this.cloneInventoryState(),
      statValues: this.getStatValueSnapshots(),
      entityCount: this.world.entities.size,
      statTypeNames,
      nearbyEntities,
      worldHeight: this.world.worldSettings?.worldHeight ?? null,
      viewRadius: this.world.viewRadius ?? null
    };
  }

  async waitForSelfEntity(timeoutMs = 20_000): Promise<EntityState> {
    if (this.clientId == null) {
      await this.waitForClientId(timeoutMs);
    }
    const existing = this.getSelfEntity();
    if (existing) {
      return existing;
    }
    return new Promise<EntityState>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(timeoutError("self entity", timeoutMs));
      }, timeoutMs);

      const check = (): void => {
        const entity = this.getSelfEntity();
        if (entity) {
          cleanup();
          resolve(entity);
        }
      };

      const onUpdate = (): void => {
        check();
      };

      const cleanup = (): void => {
        clearTimeout(timer);
        this.off("entityUpdate", onUpdate);
        this.off("teleport", onUpdate);
      };

      this.on("entityUpdate", onUpdate);
      this.on("teleport", onUpdate);
      check();
    });
  }

  async waitForInventory(timeoutMs = 10_000): Promise<InventoryState> {
    if (this.inventorySeen) {
      return this.cloneInventoryState();
    }
    await this.waitForEvent("inventory", () => true, timeoutMs, "inventory");
    return this.cloneInventoryState();
  }

  async waitForStat(name: string, timeoutMs = 10_000, entityId?: number): Promise<number> {
    const existing = this.getStatByName(name, entityId);
    if (existing != null) {
      return existing;
    }
    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(timeoutError(`stat ${name}`, timeoutMs));
      }, timeoutMs);

      const check = (): void => {
        const value = this.getStatByName(name, entityId);
        if (value != null) {
          cleanup();
          resolve(value);
        }
      };

      const onUpdate = (): void => {
        check();
      };

      const cleanup = (): void => {
        clearTimeout(timer);
        this.off("entityUpdate", onUpdate);
        this.off("entityStatTypes", onUpdate);
      };

      this.on("entityUpdate", onUpdate);
      this.on("entityStatTypes", onUpdate);
      check();
    });
  }

  private resolveStatId(name: string): number | null {
    const normalized = name.trim().toLowerCase();
    const direct = this.statTypeByName.get(normalized);
    if (direct != null) {
      return direct;
    }
    for (const [key, id] of this.statTypeByName.entries()) {
      if (key.endsWith(`:${normalized}`) || key.endsWith(`.${normalized}`)) {
        return id;
      }
    }
    for (const [id, type] of this.world.statTypes.entries()) {
      const typeId = type.id?.trim().toLowerCase();
      if (typeId && typeId === normalized) {
        return id;
      }
    }
    return null;
  }

  private cloneInventorySection(section: InventorySection | null): InventorySection | null {
    if (!section) {
      return null;
    }
    const items = section.items ? Object.entries(section.items).reduce<Record<number, ItemWithAllMetadata>>((acc, [rawKey, value]) => {
      const key = Number(rawKey);
      if (!Number.isFinite(key)) {
        return acc;
      }
      acc[key] = { ...value };
      return acc;
    }, {}) : null;
    return {
      capacity: section.capacity,
      items
    };
  }

  private cloneInventoryState(): InventoryState {
    return {
      sortType: this.world.inventory.sortType,
      storage: this.cloneInventorySection(this.world.inventory.storage),
      armor: this.cloneInventorySection(this.world.inventory.armor),
      hotbar: this.cloneInventorySection(this.world.inventory.hotbar),
      utility: this.cloneInventorySection(this.world.inventory.utility),
      builderMaterial: this.cloneInventorySection(this.world.inventory.builderMaterial),
      tools: this.cloneInventorySection(this.world.inventory.tools),
      backpack: this.cloneInventorySection(this.world.inventory.backpack)
    };
  }

  private distanceBetween(left: Position, right: Position): number {
    const dx = left.x - right.x;
    const dy = left.y - right.y;
    const dz = left.z - right.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private createMovementPacket(update: Partial<ClientMovementPacket> = {}): ClientMovementPacket {
    return {
      name: "ClientMovement",
      movementStates: update.movementStates ?? createDefaultMovementStates(),
      relativePosition: update.relativePosition ?? null,
      absolutePosition: update.absolutePosition ?? this.currentPosition,
      bodyOrientation: update.bodyOrientation ?? this.currentBodyOrientation,
      lookOrientation: update.lookOrientation ?? this.currentLookOrientation,
      teleportAck: update.teleportAck ?? null,
      wishMovement: update.wishMovement ?? null,
      velocity: update.velocity ?? null,
      mountedTo: update.mountedTo ?? 0,
      riderMovementStates: update.riderMovementStates ?? null
    };
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      return;
    }
    this.heartbeatTimer = setInterval(() => {
      if (!this.connected) {
        return;
      }
      this.sendPacket(this.createMovementPacket());
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private recordPacket(direction: "in" | "out", packet: unknown): void {
    if (!this.traceEnabled) {
      return;
    }
    this.packetTrace.push({
      at: new Date().toISOString(),
      direction,
      packetName: typeof packet === "object" && packet && "name" in packet ? String((packet as { name: string }).name) : "unknown",
      packet
    });
  }

  private recordError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.errorTrace.push({
      at: new Date().toISOString(),
      message: normalized.message,
      stack: normalized.stack ?? null
    });
    this.emit("protocolError", normalized);
    if (this.listenerCount("error") > 0) {
      this.emit("error", normalized);
    }
  }

  private waitForEvent<T>(eventName: string, predicate: (value: T) => boolean, timeoutMs: number, label = eventName): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(eventName, onEvent as (...args: unknown[]) => void);
        reject(timeoutError(label, timeoutMs));
      }, timeoutMs);

      const onEvent = (value: T): void => {
        if (!predicate(value)) {
          return;
        }
        clearTimeout(timer);
        this.off(eventName, onEvent as (...args: unknown[]) => void);
        resolve(value);
      };

      this.on(eventName, onEvent as (...args: unknown[]) => void);
    });
  }
}

export async function createBot(options: BotOptions): Promise<HytaleBot> {
  const bot = new HytaleBot(options);
  if (options.autoConnect) {
    await bot.connect();
  }
  return bot;
}
