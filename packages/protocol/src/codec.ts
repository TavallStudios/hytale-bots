import { randomUUID } from "node:crypto";
import {
  CONNECT_LANGUAGE_MAX_BYTES,
  CONNECT_USERNAME_MAX_BYTES,
  DEFAULT_CLIENT_VERSION,
  PROTOCOL_BUILD,
  PROTOCOL_CRC
} from "./constants.js";
import { ProtocolError } from "./errors.js";
import {
  decodeAuthGrantPacket,
  decodeAuthTokenPacket,
  decodeChatMessagePacket,
  decodeClientMovementPacket,
  decodeClientReadyPacket,
  decodeClientTeleportPacket,
  decodeConnectPacket,
  decodeCustomPageEventPacket,
  decodeCustomPagePacket,
  decodeDisconnectPacket,
  decodeJoinWorldPacket,
  decodePingPacket,
  decodePlayerOptionsPacket,
  decodePongPacket,
  decodeRequestAssetsPacket,
  decodeLoadHotbarPacket,
  decodeServerAuthTokenPacket,
  decodeServerMessagePacket,
  decodeSetClientIdPacket,
  decodeSetPagePacket,
  decodeViewRadiusPacket,
  decodeWorldSettingsPacket,
  encodeAuthGrantPacket,
  encodeAuthTokenPacket,
  encodeChatMessagePacket,
  encodeClientMovementPacket,
  encodeClientReadyPacket,
  encodeClientTeleportPacket,
  encodeConnectPacket,
  encodeCustomPageEventPacket,
  encodeCustomPagePacket,
  encodeDisconnectPacket,
  encodeJoinWorldPacket,
  encodePingPacket,
  encodePlayerOptionsPacket,
  encodePongPacket,
  encodeRequestAssetsPacket,
  encodeLoadHotbarPacket,
  encodeServerAuthTokenPacket,
  encodeServerMessagePacket,
  encodeSetClientIdPacket,
  encodeSetPagePacket,
  encodeViewRadiusPacket,
  encodeWorldSettingsPacket
} from "./packets-core.js";
import { decodeEntityUpdatesPacket, decodeUpdateEntityStatTypesPacket, decodeUpdatePlayerInventoryPacket } from "./packets-world.js";
import { assertPacketDirection, getPacketRegistryEntryById, getPacketRegistryEntryByName, type WireDirection } from "./registry.js";
import type { ConnectPacket, DecodedPacket, StructuredPacket } from "./types.js";

const STRUCTURED_PACKET_NAMES = new Set<string>([
  "Connect",
  "AuthGrant",
  "AuthToken",
  "ServerAuthToken",
  "Disconnect",
  "Ping",
  "Pong",
  "RequestAssets",
  "LoadHotbar",
  "WorldSettings",
  "ViewRadius",
  "PlayerOptions",
  "SetClientId",
  "JoinWorld",
  "ClientReady",
  "ClientMovement",
  "ClientTeleport",
  "ChatMessage",
  "SetPage",
  "CustomPage",
  "CustomPageEvent",
  "ServerMessage",
  "UpdateEntityStatTypes",
  "UpdatePlayerInventory",
  "EntityUpdates"
]);

function assertAsciiConnectField(label: string, value: string, maxBytes: number): void {
  if (!/^[\x00-\x7f]*$/.test(value)) {
    throw new ProtocolError(`${label} must be ASCII`);
  }
  const byteLength = Buffer.byteLength(value, "ascii");
  if (byteLength > maxBytes) {
    throw new ProtocolError(`${label} exceeds ${maxBytes} ASCII bytes: ${byteLength}`);
  }
}

export function createConnectPacket(input: Partial<Omit<ConnectPacket, "name">> & Pick<ConnectPacket, "username">): ConnectPacket {
  const language = input.language ?? "en";
  assertAsciiConnectField("Connect.username", input.username, CONNECT_USERNAME_MAX_BYTES);
  assertAsciiConnectField("Connect.language", language, CONNECT_LANGUAGE_MAX_BYTES);
  return {
    name: "Connect",
    protocolCrc: input.protocolCrc ?? PROTOCOL_CRC,
    protocolBuildNumber: input.protocolBuildNumber ?? PROTOCOL_BUILD,
    clientVersion: input.clientVersion ?? DEFAULT_CLIENT_VERSION,
    clientType: input.clientType ?? "Game",
    uuid: input.uuid ?? randomUUID(),
    username: input.username,
    identityToken: input.identityToken ?? null,
    language,
    referralData: input.referralData ?? null,
    referralSource: input.referralSource ?? null
  };
}

export function encodePacket(packet: StructuredPacket, direction: WireDirection): Buffer {
  const entry = getPacketRegistryEntryByName(packet.name);
  if (!entry) {
    throw new ProtocolError(`Unknown packet type: ${packet.name}`);
  }
  assertPacketDirection(entry, direction);
  const payload = encodeStructuredPacket(packet);
  if (payload.length > entry.maxSize) {
    throw new ProtocolError(`Packet ${packet.name} serialized to ${payload.length} bytes which exceeds ${entry.maxSize}`);
  }
  return payload;
}

export function decodePacket(payload: Buffer, packetId: number, direction: WireDirection): DecodedPacket {
  const entry = getPacketRegistryEntryById(packetId);
  if (!entry) {
    throw new ProtocolError(`Unknown packet id: ${packetId}`);
  }
  assertPacketDirection(entry, direction);
  if (STRUCTURED_PACKET_NAMES.has(entry.name)) {
    try {
      return decodeStructuredPacket(entry.name, payload);
    } catch (error) {
      return {
        name: entry.name,
        id: entry.id,
        structured: false,
        direction,
        payload,
        decodeError: error instanceof Error ? error.message : String(error)
      };
    }
  }
  return {
    name: entry.name,
    id: entry.id,
    structured: false,
    direction,
    payload
  };
}

function decodeStructuredPacket(name: string, payload: Buffer): StructuredPacket {
  switch (name) {
    case "Connect": return decodeConnectPacket(payload);
    case "AuthGrant": return decodeAuthGrantPacket(payload);
    case "AuthToken": return decodeAuthTokenPacket(payload);
    case "ServerAuthToken": return decodeServerAuthTokenPacket(payload);
    case "Disconnect": return decodeDisconnectPacket(payload);
    case "Ping": return decodePingPacket(payload);
    case "Pong": return decodePongPacket(payload);
    case "RequestAssets": return decodeRequestAssetsPacket(payload);
    case "LoadHotbar": return decodeLoadHotbarPacket(payload);
    case "WorldSettings": return decodeWorldSettingsPacket(payload);
    case "ViewRadius": return decodeViewRadiusPacket(payload);
    case "PlayerOptions": return decodePlayerOptionsPacket(payload);
    case "SetClientId": return decodeSetClientIdPacket(payload);
    case "JoinWorld": return decodeJoinWorldPacket(payload);
    case "ClientReady": return decodeClientReadyPacket(payload);
    case "ClientMovement": return decodeClientMovementPacket(payload);
    case "ClientTeleport": return decodeClientTeleportPacket(payload);
    case "ChatMessage": return decodeChatMessagePacket(payload);
    case "SetPage": return decodeSetPagePacket(payload);
    case "CustomPage": return decodeCustomPagePacket(payload);
    case "CustomPageEvent": return decodeCustomPageEventPacket(payload);
    case "ServerMessage": return decodeServerMessagePacket(payload);
    case "UpdateEntityStatTypes": return decodeUpdateEntityStatTypesPacket(payload);
    case "UpdatePlayerInventory": return decodeUpdatePlayerInventoryPacket(payload);
    case "EntityUpdates": return decodeEntityUpdatesPacket(payload);
    default:
      throw new ProtocolError(`Structured decoder missing for ${name}`);
  }
}

function encodeStructuredPacket(packet: StructuredPacket): Buffer {
  switch (packet.name) {
    case "Connect": return encodeConnectPacket(packet);
    case "AuthGrant": return encodeAuthGrantPacket(packet);
    case "AuthToken": return encodeAuthTokenPacket(packet);
    case "ServerAuthToken": return encodeServerAuthTokenPacket(packet);
    case "Disconnect": return encodeDisconnectPacket(packet);
    case "Ping": return encodePingPacket(packet);
    case "Pong": return encodePongPacket(packet);
    case "RequestAssets": return encodeRequestAssetsPacket(packet);
    case "LoadHotbar": return encodeLoadHotbarPacket(packet);
    case "WorldSettings": return encodeWorldSettingsPacket(packet);
    case "ViewRadius": return encodeViewRadiusPacket(packet);
    case "PlayerOptions": return encodePlayerOptionsPacket(packet);
    case "SetClientId": return encodeSetClientIdPacket(packet);
    case "JoinWorld": return encodeJoinWorldPacket(packet);
    case "ClientReady": return encodeClientReadyPacket(packet);
    case "ClientMovement": return encodeClientMovementPacket(packet);
    case "ClientTeleport": return encodeClientTeleportPacket(packet);
    case "ChatMessage": return encodeChatMessagePacket(packet);
    case "SetPage": return encodeSetPagePacket(packet);
    case "CustomPage": return encodeCustomPagePacket(packet);
    case "CustomPageEvent": return encodeCustomPageEventPacket(packet);
    case "ServerMessage": return encodeServerMessagePacket(packet);
    case "UpdateEntityStatTypes":
    case "UpdatePlayerInventory":
    case "EntityUpdates":
      throw new ProtocolError(`Encoding not implemented for ${packet.name}`);
  }
}
