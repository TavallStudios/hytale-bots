import { EventEmitter } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
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
  type ChatMessagePacket,
  type ClientMovementPacket,
  type ClientReadyPacket,
  type ClientTeleportPacket,
  type ConnectPacket,
  type CustomPageEventPacket,
  type CustomPagePacket,
  type DecodedPacket,
  type Direction,
  type JoinWorldPacket,
  type MovementStates,
  type PingPacket,
  type PongPacket,
  type Position,
  type RequestAssetsPacket,
  type ServerMessagePacket,
  type SetClientIdPacket,
  type SetPagePacket,
  type StructuredPacket,
  type ViewRadiusPacket,
  type WorldSettingsPacket
} from "@hyrhythm/hytale-protocol";

export interface TraceEnableOptions {
  readonly outputDir?: string;
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

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify(value, (_key, candidate) => typeof candidate === "bigint" ? candidate.toString() : candidate, 2)}\n`,
    "utf8"
  );
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
      await writeJson(path.join(destination, "transcript.json"), {
        bot: this.username,
        host: this.host,
        port: this.port,
        packets: this.packetTrace,
        pages: this.pageTrace,
        serverMessages: this.serverMessages,
        errors: this.errorTrace
      });
    }
  };

  private socket: net.Socket | null = null;
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
    this.uuid = options.uuid;
    this.language = options.language ?? "en";
    this.autoAcknowledgePages = options.autoAcknowledgePages ?? true;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 250;
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
    await new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      let settled = false;
      this.worldJoined = false;
      this.worldActive = false;
      this.clientId = null;
      this.currentPosition = null;
      this.ui.currentPage = null;
      this.ui.lastSetPage = null;
      this.customPageVisible = false;
      this.socket = socket;

      const rejectOnce = (error: unknown): void => {
        if (settled) {
          this.recordError(error);
          return;
        }
        settled = true;
        reject(error);
      };

      socket.once("connect", () => {
        settled = true;
        this.connected = true;
        this.sendPacket(this.connectPacket);
        this.emit("connect");
        resolve();
      });
      socket.on("data", (chunk) => {
        try {
          this.handleChunk(chunk);
        } catch (error) {
          rejectOnce(error);
        }
      });
      socket.on("error", rejectOnce);
      socket.on("close", () => {
        this.connected = false;
        this.worldJoined = false;
        this.worldActive = false;
        this.clientId = null;
        this.currentPosition = null;
        this.ui.currentPage = null;
        this.ui.lastSetPage = null;
        this.customPageVisible = false;
        this.socket = null;
        this.stopHeartbeat();
        this.emit("close");
      });
      socket.connect({ host: this.host, port: this.port });
    });
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      this.socket = null;
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

      socket.once("close", finish);
      socket.once("error", finish);
      const forceCloseTimer = setTimeout(() => {
        if (!socket.destroyed) {
          socket.destroy();
        }
      }, DISCONNECT_GRACE_MS);
      socket.end();
      setImmediate(() => {
        if (socket.destroyed) {
          finish();
        }
      });
    });
    this.socket = null;
  }

  sendPacket(packet: StructuredPacket): void {
    if (!this.socket || !this.connected) {
      throw new ProtocolError(`Cannot send ${packet.name} because the bot is not connected`);
    }
    this.recordPacket("out", packet);
    this.socket.write(encodeFramedPacket(packet, "toServer"));
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
      case "WorldSettings":
        this.handleWorldSettings(packet as WorldSettingsPacket);
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
      case "ServerMessage":
        this.handleServerMessage(packet as ServerMessagePacket);
        return;
      case "Disconnect":
        this.emit("disconnect", packet);
        return;
      default:
        return;
    }
  }

  private handleWorldSettings(_packet: WorldSettingsPacket): void {
    const requestAssets: RequestAssetsPacket = { name: "RequestAssets", assets: [] };
    const viewRadius: ViewRadiusPacket = { name: "ViewRadius", value: 6 };
    this.sendPacket(requestAssets);
    this.sendPacket(viewRadius);
    this.sendPacket({ name: "PlayerOptions", skin: null });
    this.emit("worldSettings");
  }

  private handleJoinWorld(packet: JoinWorldPacket): void {
    this.worldJoined = true;
    const readyPacket: ClientReadyPacket = {
      name: "ClientReady",
      readyForChunks: true,
      readyForGameplay: this.clientId != null
    };
    this.sendPacket(readyPacket);
    this.emit("worldJoin", packet);
  }

  private handleSetClientId(packet: SetClientIdPacket): void {
    this.clientId = packet.clientId;
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

  private handleServerMessage(packet: ServerMessagePacket): void {
    const message = formattedMessageToPlainText(packet.message);
    if (!message) {
      return;
    }
    this.serverMessages.push(message);
    this.emit("serverMessage", message);
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
