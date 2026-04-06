import type {
  ChatType,
  ClientType,
  CustomPageEventType,
  CustomPageLifetime,
  CustomUICommandType,
  CustomUIEventBindingType,
  DisconnectType,
  MaybeBool,
  PageType,
  PongType
} from "./enums.js";
import type { WireDirection } from "./registry.js";

export interface Asset {
  readonly hash: string;
  readonly name: string;
}

export interface HostAddress {
  readonly host: string;
  readonly port: number;
}

export interface Position {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Direction {
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
}

export interface TeleportAck {
  readonly teleportId: number;
}

export interface InstantData {
  readonly seconds: bigint;
  readonly nanos: number;
}

export interface HalfFloatPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Vector3d {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface MovementStates {
  readonly idle: boolean;
  readonly horizontalIdle: boolean;
  readonly jumping: boolean;
  readonly flying: boolean;
  readonly walking: boolean;
  readonly running: boolean;
  readonly sprinting: boolean;
  readonly crouching: boolean;
  readonly forcedCrouching: boolean;
  readonly falling: boolean;
  readonly climbing: boolean;
  readonly inFluid: boolean;
  readonly swimming: boolean;
  readonly swimJumping: boolean;
  readonly onGround: boolean;
  readonly mantling: boolean;
  readonly sliding: boolean;
  readonly mounting: boolean;
  readonly rolling: boolean;
  readonly sitting: boolean;
  readonly gliding: boolean;
  readonly sleeping: boolean;
}

export interface ModelTransform {
  readonly position?: Position | null;
  readonly bodyOrientation?: Direction | null;
  readonly lookOrientation?: Direction | null;
}

export interface StringParamValue {
  readonly kind: "string";
  readonly value?: string | null;
}

export interface BoolParamValue {
  readonly kind: "bool";
  readonly value: boolean;
}

export interface DoubleParamValue {
  readonly kind: "double";
  readonly value: number;
}

export interface IntParamValue {
  readonly kind: "int";
  readonly value: number;
}

export interface LongParamValue {
  readonly kind: "long";
  readonly value: bigint;
}

export type ParamValue = StringParamValue | BoolParamValue | DoubleParamValue | IntParamValue | LongParamValue;

export interface FormattedMessage {
  readonly rawText?: string | null;
  readonly messageId?: string | null;
  readonly children?: readonly FormattedMessage[] | null;
  readonly params?: Readonly<Record<string, ParamValue>> | null;
  readonly messageParams?: Readonly<Record<string, FormattedMessage>> | null;
  readonly color?: string | null;
  readonly bold?: MaybeBool;
  readonly italic?: MaybeBool;
  readonly monospace?: MaybeBool;
  readonly underlined?: MaybeBool;
  readonly link?: string | null;
  readonly markupEnabled?: boolean;
}

export interface CustomUICommand {
  readonly type: CustomUICommandType;
  readonly selector?: string | null;
  readonly data?: string | null;
  readonly text?: string | null;
}

export interface CustomUIEventBinding {
  readonly type: CustomUIEventBindingType;
  readonly selector?: string | null;
  readonly data?: string | null;
  readonly locksInterface: boolean;
}

export interface ConnectPacket {
  readonly name: "Connect";
  readonly protocolCrc: number;
  readonly protocolBuildNumber: number;
  readonly clientVersion: string;
  readonly clientType: ClientType;
  readonly uuid: string;
  readonly username: string;
  readonly identityToken?: string | null;
  readonly language: string;
  readonly referralData?: Buffer | null;
  readonly referralSource?: HostAddress | null;
}

export interface DisconnectPacket {
  readonly name: "Disconnect";
  readonly reason?: string | null;
  readonly type: DisconnectType;
}

export interface PingPacket {
  readonly name: "Ping";
  readonly id: number;
  readonly time?: InstantData | null;
  readonly lastPingValueRaw: number;
  readonly lastPingValueDirect: number;
  readonly lastPingValueTick: number;
}

export interface PongPacket {
  readonly name: "Pong";
  readonly id: number;
  readonly time?: InstantData | null;
  readonly type: PongType;
  readonly packetQueueSize: number;
}

export interface RequestAssetsPacket {
  readonly name: "RequestAssets";
  readonly assets?: readonly Asset[] | null;
}

export interface WorldSettingsPacket {
  readonly name: "WorldSettings";
  readonly worldHeight: number;
  readonly requiredAssets?: readonly Asset[] | null;
}

export interface ViewRadiusPacket {
  readonly name: "ViewRadius";
  readonly value: number;
}

export interface PlayerOptionsPacket {
  readonly name: "PlayerOptions";
  readonly skin?: null;
}

export interface SetClientIdPacket {
  readonly name: "SetClientId";
  readonly clientId: number;
}

export interface JoinWorldPacket {
  readonly name: "JoinWorld";
  readonly clearWorld: boolean;
  readonly fadeInOut: boolean;
  readonly worldUuid: string;
}

export interface ClientReadyPacket {
  readonly name: "ClientReady";
  readonly readyForChunks: boolean;
  readonly readyForGameplay: boolean;
}

export interface ClientMovementPacket {
  readonly name: "ClientMovement";
  readonly movementStates?: MovementStates | null;
  readonly relativePosition?: HalfFloatPosition | null;
  readonly absolutePosition?: Position | null;
  readonly bodyOrientation?: Direction | null;
  readonly lookOrientation?: Direction | null;
  readonly teleportAck?: TeleportAck | null;
  readonly wishMovement?: Position | null;
  readonly velocity?: Vector3d | null;
  readonly mountedTo?: number;
  readonly riderMovementStates?: MovementStates | null;
}

export interface ClientTeleportPacket {
  readonly name: "ClientTeleport";
  readonly teleportId: number;
  readonly modelTransform?: ModelTransform | null;
  readonly resetVelocity: boolean;
}

export interface ChatMessagePacket {
  readonly name: "ChatMessage";
  readonly message?: string | null;
}

export interface SetPagePacket {
  readonly name: "SetPage";
  readonly page: PageType;
  readonly canCloseThroughInteraction: boolean;
}

export interface CustomPagePacket {
  readonly name: "CustomPage";
  readonly key?: string | null;
  readonly isInitial: boolean;
  readonly clear: boolean;
  readonly lifetime: CustomPageLifetime;
  readonly commands?: readonly CustomUICommand[] | null;
  readonly eventBindings?: readonly CustomUIEventBinding[] | null;
}

export interface CustomPageEventPacket {
  readonly name: "CustomPageEvent";
  readonly type: CustomPageEventType;
  readonly data?: string | null;
}

export interface ServerMessagePacket {
  readonly name: "ServerMessage";
  readonly type: ChatType;
  readonly message?: FormattedMessage | null;
}

export interface RawPacket {
  readonly name: string;
  readonly id: number;
  readonly structured: false;
  readonly direction: WireDirection;
  readonly payload: Buffer;
  readonly decodeError?: string;
}

export type StructuredPacket =
  | ConnectPacket
  | DisconnectPacket
  | PingPacket
  | PongPacket
  | RequestAssetsPacket
  | WorldSettingsPacket
  | ViewRadiusPacket
  | PlayerOptionsPacket
  | SetClientIdPacket
  | JoinWorldPacket
  | ClientReadyPacket
  | ClientMovementPacket
  | ClientTeleportPacket
  | ChatMessagePacket
  | SetPagePacket
  | CustomPagePacket
  | CustomPageEventPacket
  | ServerMessagePacket;

export type DecodedPacket = StructuredPacket | RawPacket;
