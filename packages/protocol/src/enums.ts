import { ProtocolError } from "./errors.js";

function enumFromValue<const T extends readonly string[]>(values: T, index: number, name: string): T[number] {
  if (index < 0 || index >= values.length) {
    throw new ProtocolError(`Invalid enum value ${index} for ${name}`);
  }
  return values[index];
}

function enumToValue<const T extends readonly string[]>(values: T, key: T[number], name: string): number {
  const index = values.indexOf(key);
  if (index < 0) {
    throw new ProtocolError(`Unknown ${name} value ${String(key)}`);
  }
  return index;
}

export const CLIENT_TYPES = ["Game", "Editor"] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];
export const readClientType = (value: number): ClientType => enumFromValue(CLIENT_TYPES, value, "ClientType");
export const writeClientType = (value: ClientType): number => enumToValue(CLIENT_TYPES, value, "ClientType");

export const PONG_TYPES = ["Raw", "Direct", "Tick"] as const;
export type PongType = (typeof PONG_TYPES)[number];
export const readPongType = (value: number): PongType => enumFromValue(PONG_TYPES, value, "PongType");
export const writePongType = (value: PongType): number => enumToValue(PONG_TYPES, value, "PongType");

export const CUSTOM_PAGE_EVENT_TYPES = ["Acknowledge", "Data", "Dismiss"] as const;
export type CustomPageEventType = (typeof CUSTOM_PAGE_EVENT_TYPES)[number];
export const readCustomPageEventType = (value: number): CustomPageEventType =>
  enumFromValue(CUSTOM_PAGE_EVENT_TYPES, value, "CustomPageEventType");
export const writeCustomPageEventType = (value: CustomPageEventType): number =>
  enumToValue(CUSTOM_PAGE_EVENT_TYPES, value, "CustomPageEventType");

export const CUSTOM_PAGE_LIFETIMES = ["CantClose", "CanDismiss", "CanDismissOrCloseThroughInteraction"] as const;
export type CustomPageLifetime = (typeof CUSTOM_PAGE_LIFETIMES)[number];
export const readCustomPageLifetime = (value: number): CustomPageLifetime =>
  enumFromValue(CUSTOM_PAGE_LIFETIMES, value, "CustomPageLifetime");
export const writeCustomPageLifetime = (value: CustomPageLifetime): number =>
  enumToValue(CUSTOM_PAGE_LIFETIMES, value, "CustomPageLifetime");

export const CUSTOM_UI_COMMAND_TYPES = ["Append", "AppendInline", "InsertBefore", "InsertBeforeInline", "Remove", "Set", "Clear"] as const;
export type CustomUICommandType = (typeof CUSTOM_UI_COMMAND_TYPES)[number];
export const readCustomUiCommandType = (value: number): CustomUICommandType =>
  enumFromValue(CUSTOM_UI_COMMAND_TYPES, value, "CustomUICommandType");
export const writeCustomUiCommandType = (value: CustomUICommandType): number =>
  enumToValue(CUSTOM_UI_COMMAND_TYPES, value, "CustomUICommandType");

export const CUSTOM_UI_EVENT_BINDING_TYPES = [
  "Activating",
  "RightClicking",
  "DoubleClicking",
  "MouseEntered",
  "MouseExited",
  "ValueChanged",
  "ElementReordered",
  "Validating",
  "Dismissing",
  "FocusGained",
  "FocusLost",
  "KeyDown",
  "MouseButtonReleased",
  "SlotClicking",
  "SlotDoubleClicking",
  "SlotMouseEntered",
  "SlotMouseExited",
  "DragCancelled",
  "Dropped",
  "SlotMouseDragCompleted",
  "SlotMouseDragExited",
  "SlotClickReleaseWhileDragging",
  "SlotClickPressWhileDragging",
  "SelectedTabChanged"
] as const;
export type CustomUIEventBindingType = (typeof CUSTOM_UI_EVENT_BINDING_TYPES)[number];
export const readCustomUiEventBindingType = (value: number): CustomUIEventBindingType =>
  enumFromValue(CUSTOM_UI_EVENT_BINDING_TYPES, value, "CustomUIEventBindingType");
export const writeCustomUiEventBindingType = (value: CustomUIEventBindingType): number =>
  enumToValue(CUSTOM_UI_EVENT_BINDING_TYPES, value, "CustomUIEventBindingType");

export const PAGE_TYPES = ["None", "Bench", "Inventory", "ToolsSettings", "Map", "MachinimaEditor", "ContentCreation", "Custom"] as const;
export type PageType = (typeof PAGE_TYPES)[number];
export const readPageType = (value: number): PageType => enumFromValue(PAGE_TYPES, value, "Page");
export const writePageType = (value: PageType): number => enumToValue(PAGE_TYPES, value, "Page");

export const CHAT_TYPES = ["Chat"] as const;
export type ChatType = (typeof CHAT_TYPES)[number];
export const readChatType = (value: number): ChatType => enumFromValue(CHAT_TYPES, value, "ChatType");
export const writeChatType = (value: ChatType): number => enumToValue(CHAT_TYPES, value, "ChatType");

export const MAYBE_BOOL_VALUES = ["Null", "False", "True"] as const;
export type MaybeBool = (typeof MAYBE_BOOL_VALUES)[number];
export const readMaybeBool = (value: number): MaybeBool => enumFromValue(MAYBE_BOOL_VALUES, value, "MaybeBool");
export const writeMaybeBool = (value: MaybeBool): number => enumToValue(MAYBE_BOOL_VALUES, value, "MaybeBool");

export const DISCONNECT_TYPES = ["Disconnect", "Crash"] as const;
export type DisconnectType = (typeof DISCONNECT_TYPES)[number];
export const readDisconnectType = (value: number): DisconnectType => enumFromValue(DISCONNECT_TYPES, value, "DisconnectType");
export const writeDisconnectType = (value: DisconnectType): number => enumToValue(DISCONNECT_TYPES, value, "DisconnectType");

export const SORT_TYPES = ["Name", "Type", "Rarity"] as const;
export type SortType = (typeof SORT_TYPES)[number];
export const readSortType = (value: number): SortType => enumFromValue(SORT_TYPES, value, "SortType");
export const writeSortType = (value: SortType): number => enumToValue(SORT_TYPES, value, "SortType");

export const UPDATE_TYPES = ["Init", "AddOrUpdate", "Remove"] as const;
export type UpdateType = (typeof UPDATE_TYPES)[number];
export const readUpdateType = (value: number): UpdateType => enumFromValue(UPDATE_TYPES, value, "UpdateType");
export const writeUpdateType = (value: UpdateType): number => enumToValue(UPDATE_TYPES, value, "UpdateType");

export const ENTITY_STAT_OPS = [
  "Init",
  "Remove",
  "PutModifier",
  "RemoveModifier",
  "Add",
  "Set",
  "Minimize",
  "Maximize",
  "Reset"
] as const;
export type EntityStatOp = (typeof ENTITY_STAT_OPS)[number];
export const readEntityStatOp = (value: number): EntityStatOp => enumFromValue(ENTITY_STAT_OPS, value, "EntityStatOp");
export const writeEntityStatOp = (value: EntityStatOp): number => enumToValue(ENTITY_STAT_OPS, value, "EntityStatOp");

export const MODIFIER_TARGETS = ["Min", "Max"] as const;
export type ModifierTarget = (typeof MODIFIER_TARGETS)[number];
export const readModifierTarget = (value: number): ModifierTarget => enumFromValue(MODIFIER_TARGETS, value, "ModifierTarget");
export const writeModifierTarget = (value: ModifierTarget): number => enumToValue(MODIFIER_TARGETS, value, "ModifierTarget");

export const CALCULATION_TYPES = ["Additive", "Multiplicative"] as const;
export type CalculationType = (typeof CALCULATION_TYPES)[number];
export const readCalculationType = (value: number): CalculationType => enumFromValue(CALCULATION_TYPES, value, "CalculationType");
export const writeCalculationType = (value: CalculationType): number => enumToValue(CALCULATION_TYPES, value, "CalculationType");

export const ENTITY_STAT_RESET_BEHAVIORS = ["InitialValue", "MaxValue"] as const;
export type EntityStatResetBehavior = (typeof ENTITY_STAT_RESET_BEHAVIORS)[number];
export const readEntityStatResetBehavior = (value: number): EntityStatResetBehavior =>
  enumFromValue(ENTITY_STAT_RESET_BEHAVIORS, value, "EntityStatResetBehavior");
export const writeEntityStatResetBehavior = (value: EntityStatResetBehavior): number =>
  enumToValue(ENTITY_STAT_RESET_BEHAVIORS, value, "EntityStatResetBehavior");

export const ENTITY_PARTS = ["Self", "Entity", "PrimaryItem", "SecondaryItem"] as const;
export type EntityPart = (typeof ENTITY_PARTS)[number];
export const readEntityPart = (value: number): EntityPart => enumFromValue(ENTITY_PARTS, value, "EntityPart");
export const writeEntityPart = (value: EntityPart): number => enumToValue(ENTITY_PARTS, value, "EntityPart");
