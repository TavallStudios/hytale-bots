import type {
  CalculationType,
  ChatType,
  ClientType,
  CustomPageEventType,
  CustomPageLifetime,
  CustomUICommandType,
  CustomUIEventBindingType,
  DisconnectType,
  EntityPart,
  EntityStatOp,
  EntityStatResetBehavior,
  InteractionState,
  InteractionType,
  MaybeBool,
  ModifierTarget,
  MouseButtonState,
  MouseButtonType,
  PageType,
  PongType,
  SortType,
  UpdateType
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

export interface Vector3f {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Vector2f {
  readonly x: number;
  readonly y: number;
}

export interface BlockPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface BlockRotation {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Color {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
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

export interface Modifier {
  readonly target: ModifierTarget;
  readonly calculationType: CalculationType;
  readonly amount: number;
}

export interface EntityStatUpdate {
  readonly op: EntityStatOp;
  readonly predictable: boolean;
  readonly value: number;
  readonly modifiers?: Readonly<Record<string, Modifier>> | null;
  readonly modifierKey?: string | null;
  readonly modifier?: Modifier | null;
}

export interface EntityStatEffects {
  readonly triggerAtZero: boolean;
  readonly soundEventIndex: number;
  readonly particles?: readonly ModelParticle[] | null;
}

export interface ModelParticle {
  readonly systemId?: string | null;
  readonly scale: number;
  readonly color?: Color | null;
  readonly targetEntityPart: EntityPart;
  readonly targetNodeName?: string | null;
  readonly positionOffset?: Vector3f | null;
  readonly rotationOffset?: Direction | null;
  readonly detachedFromModel: boolean;
}

export interface EntityStatType {
  readonly id?: string | null;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly minValueEffects?: EntityStatEffects | null;
  readonly maxValueEffects?: EntityStatEffects | null;
  readonly resetBehavior: EntityStatResetBehavior;
  readonly hideFromTooltip: boolean;
}

export interface EntityStatsUpdate {
  readonly entityStatUpdates: Readonly<Record<number, readonly EntityStatUpdate[]>>;
}

export interface TransformUpdate {
  readonly kind: "Transform";
  readonly transform: ModelTransform;
}

export interface MovementStatesUpdate {
  readonly kind: "MovementStates";
  readonly movementStates: MovementStates;
}

export interface EntityStatsUpdateComponent {
  readonly kind: "EntityStats";
  readonly entityStatUpdates: Readonly<Record<number, readonly EntityStatUpdate[]>>;
}

export type ComponentUpdate = TransformUpdate | MovementStatesUpdate | EntityStatsUpdateComponent;

export interface EntityUpdate {
  readonly networkId: number;
  readonly removed?: readonly number[] | null;
  readonly updates?: readonly ComponentUpdate[] | null;
}

export interface ItemWithAllMetadata {
  readonly itemId: string;
  readonly quantity: number;
  readonly durability: number;
  readonly maxDurability: number;
  readonly overrideDroppedItemAnimation: boolean;
  readonly metadata?: string | null;
}

export interface InventorySection {
  readonly items?: Readonly<Record<number, ItemWithAllMetadata>> | null;
  readonly capacity: number;
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

export interface AuthGrantPacket {
  readonly name: "AuthGrant";
  readonly authorizationGrant?: string | null;
  readonly serverIdentityToken?: string | null;
}

export interface AuthTokenPacket {
  readonly name: "AuthToken";
  readonly accessToken?: string | null;
  readonly serverAuthorizationGrant?: string | null;
}

export interface ServerAuthTokenPacket {
  readonly name: "ServerAuthToken";
  readonly serverAccessToken?: string | null;
  readonly passwordChallenge?: Buffer | null;
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

export interface LoadHotbarPacket {
  readonly name: "LoadHotbar";
  readonly mode: number;
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

export interface SetActiveSlotPacket {
  readonly name: "SetActiveSlot";
  readonly inventorySectionId: number;
  readonly activeSlot: number;
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

export interface MouseButtonEvent {
  readonly mouseButtonType: MouseButtonType;
  readonly state: MouseButtonState;
  readonly clicks: number;
}

export interface WorldInteraction {
  readonly entityId: number;
  readonly blockPosition?: BlockPosition | null;
  readonly blockRotation?: BlockRotation | null;
}

export interface MouseInteractionPacket {
  readonly name: "MouseInteraction";
  readonly clientTimestamp: bigint;
  readonly activeSlot: number;
  readonly screenPoint?: Vector2f | null;
  readonly mouseButton?: MouseButtonEvent | null;
  readonly worldInteraction?: WorldInteraction | null;
  readonly itemInHandId?: string | null;
  readonly mouseMotion?: null;
}

export interface InteractionChainData {
  readonly entityId: number;
  readonly proxyId: string;
  readonly hitLocation?: Vector3f | null;
  readonly hitDetail?: string | null;
  readonly blockPosition?: BlockPosition | null;
  readonly targetSlot: number;
  readonly hitNormal?: Vector3f | null;
}

export interface SyncInteractionChain {
  readonly activeHotbarSlot: number;
  readonly activeUtilitySlot: number;
  readonly activeToolsSlot: number;
  readonly itemInHandId?: string | null;
  readonly utilityItemId?: string | null;
  readonly toolsItemId?: string | null;
  readonly initial: boolean;
  readonly desync: boolean;
  readonly overrideRootInteraction: number;
  readonly interactionType: InteractionType;
  readonly equipSlot: number;
  readonly chainId: number;
  readonly forkedId?: null;
  readonly data?: InteractionChainData | null;
  readonly state: InteractionState;
  readonly newForks?: readonly SyncInteractionChain[] | null;
  readonly operationBaseIndex: number;
  readonly interactionData?: null;
}

export interface SyncInteractionChainsPacket {
  readonly name: "SyncInteractionChains";
  readonly updates: readonly SyncInteractionChain[];
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

export interface UpdateEntityStatTypesPacket {
  readonly name: "UpdateEntityStatTypes";
  readonly type: UpdateType;
  readonly maxId: number;
  readonly types?: Readonly<Record<number, EntityStatType>> | null;
}

export interface UpdatePlayerInventoryPacket {
  readonly name: "UpdatePlayerInventory";
  readonly storage?: InventorySection | null;
  readonly armor?: InventorySection | null;
  readonly hotbar?: InventorySection | null;
  readonly utility?: InventorySection | null;
  readonly builderMaterial?: InventorySection | null;
  readonly tools?: InventorySection | null;
  readonly backpack?: InventorySection | null;
  readonly sortType: SortType;
}

export interface EntityUpdatesPacket {
  readonly name: "EntityUpdates";
  readonly removed?: readonly number[] | null;
  readonly updates?: readonly EntityUpdate[] | null;
  readonly partial?: boolean;
  readonly partialReason?: string | null;
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
  | AuthGrantPacket
  | AuthTokenPacket
  | ServerAuthTokenPacket
  | DisconnectPacket
  | PingPacket
  | PongPacket
  | RequestAssetsPacket
  | LoadHotbarPacket
  | WorldSettingsPacket
  | ViewRadiusPacket
  | PlayerOptionsPacket
  | SetClientIdPacket
  | SetActiveSlotPacket
  | JoinWorldPacket
  | ClientReadyPacket
  | ClientMovementPacket
  | ClientTeleportPacket
  | ChatMessagePacket
  | MouseInteractionPacket
  | SyncInteractionChainsPacket
  | SetPagePacket
  | CustomPagePacket
  | CustomPageEventPacket
  | ServerMessagePacket
  | UpdateEntityStatTypesPacket
  | UpdatePlayerInventoryPacket
  | EntityUpdatesPacket;

export type DecodedPacket = StructuredPacket | RawPacket;
