import { BufferWriter, readBooleanByte, readFixedAsciiString, readInt16LE, readInt32LE, readUInt8, readUuid, readVarInt, readVarString, writeFixedAsciiString, writeUuid, writeVarInt, writeVarString } from "./binary.js";
import { readChatType, readClientType, readDisconnectType, readPageType, readPongType, writeChatType, writeClientType, writeDisconnectType, writePageType, writePongType } from "./enums.js";
import { ProtocolError } from "./errors.js";
import { formattedMessageToPlainText, readFormattedMessage, writeFormattedMessage } from "./model/formatted.js";
import { decodeCustomPageEventPacket, decodeCustomPagePacket, encodeCustomPageEventPacket, encodeCustomPagePacket, snapshotCustomPage } from "./model/ui.js";
import {
  createDefaultMovementStates,
  readAsset,
  readDirection,
  readHalfFloatPosition,
  readHostAddress,
  readInstantData,
  readModelTransform,
  readMovementStates,
  readPosition,
  readTeleportAck,
  readVector3d,
  writeAsset,
  writeDirection,
  writeHalfFloatPosition,
  writeHostAddress,
  writeInstantData,
  writeModelTransform,
  writeMovementStates,
  writePosition,
  writeTeleportAck,
  writeVector3d
} from "./model/primitives.js";
import type {
  AuthGrantPacket,
  AuthTokenPacket,
  ChatMessagePacket,
  ClientMovementPacket,
  ClientReadyPacket,
  ClientTeleportPacket,
  ConnectPacket,
  CustomPageEventPacket,
  CustomPagePacket,
  DisconnectPacket,
  JoinWorldPacket,
  PingPacket,
  PlayerOptionsPacket,
  PongPacket,
  RequestAssetsPacket,
  ServerAuthTokenPacket,
  ServerMessagePacket,
  SetClientIdPacket,
  SetPagePacket,
  ViewRadiusPacket,
  WorldSettingsPacket
} from "./types.js";

export function decodeConnectPacket(buffer: Buffer): ConnectPacket {
  const nullBits = readUInt8(buffer, 0);
  const variableBase = 66;
  const username = readVarString(buffer, variableBase + readInt32LE(buffer, 46), "ascii");
  const language = readVarString(buffer, variableBase + readInt32LE(buffer, 54), "ascii");
  let identityToken: string | null = null;
  if ((nullBits & 1) !== 0) {
    identityToken = readVarString(buffer, variableBase + readInt32LE(buffer, 50), "utf8").value;
  }
  let referralData: Buffer | null = null;
  if ((nullBits & 2) !== 0) {
    const start = variableBase + readInt32LE(buffer, 58);
    const length = readVarInt(buffer, start);
    referralData = buffer.subarray(start + length.bytesRead, start + length.bytesRead + length.value);
  }
  let referralSource = null;
  if ((nullBits & 4) !== 0) {
    referralSource = readHostAddress(buffer, variableBase + readInt32LE(buffer, 62)).value;
  }
  return {
    name: "Connect",
    protocolCrc: readInt32LE(buffer, 1),
    protocolBuildNumber: readInt32LE(buffer, 5),
    clientVersion: readFixedAsciiString(buffer, 9, 20),
    clientType: readClientType(readUInt8(buffer, 29)),
    uuid: readUuid(buffer, 30),
    username: username.value,
    identityToken,
    language: language.value,
    referralData,
    referralSource
  };
}

export function encodeConnectPacket(packet: ConnectPacket): Buffer {
  const writer = new BufferWriter(128);
  const nullBits = (packet.identityToken != null ? 1 : 0) | (packet.referralData != null ? 2 : 0) | (packet.referralSource != null ? 4 : 0);
  writer.writeUInt8(nullBits);
  writer.writeInt32LE(packet.protocolCrc);
  writer.writeInt32LE(packet.protocolBuildNumber);
  writeFixedAsciiString(writer, packet.clientVersion, 20);
  writer.writeUInt8(writeClientType(packet.clientType));
  writeUuid(writer, packet.uuid);
  const usernameOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const identityOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const languageOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const referralDataOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const referralSourceOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const variableBase = writer.offset;
  writer.setInt32LE(usernameOffsetSlot, writer.offset - variableBase);
  writeVarString(writer, packet.username, 16, "ascii");
  if (packet.identityToken != null) {
    writer.setInt32LE(identityOffsetSlot, writer.offset - variableBase);
    writeVarString(writer, packet.identityToken, 8192, "utf8");
  } else {
    writer.setInt32LE(identityOffsetSlot, -1);
  }
  writer.setInt32LE(languageOffsetSlot, writer.offset - variableBase);
  writeVarString(writer, packet.language, 16, "ascii");
  if (packet.referralData != null) {
    writer.setInt32LE(referralDataOffsetSlot, writer.offset - variableBase);
    writeVarInt(writer, packet.referralData.length);
    writer.writeBytes(packet.referralData);
  } else {
    writer.setInt32LE(referralDataOffsetSlot, -1);
  }
  if (packet.referralSource != null) {
    writer.setInt32LE(referralSourceOffsetSlot, writer.offset - variableBase);
    writeHostAddress(writer, packet.referralSource);
  } else {
    writer.setInt32LE(referralSourceOffsetSlot, -1);
  }
  return writer.toBuffer();
}

export function decodeAuthGrantPacket(buffer: Buffer): AuthGrantPacket {
  const nullBits = readUInt8(buffer, 0);
  let authorizationGrant: string | null = null;
  if ((nullBits & 1) !== 0) {
    authorizationGrant = readVarString(buffer, 9 + readInt32LE(buffer, 1), "utf8").value;
  }
  let serverIdentityToken: string | null = null;
  if ((nullBits & 2) !== 0) {
    serverIdentityToken = readVarString(buffer, 9 + readInt32LE(buffer, 5), "utf8").value;
  }
  return {
    name: "AuthGrant",
    authorizationGrant,
    serverIdentityToken
  };
}

export function encodeAuthGrantPacket(packet: AuthGrantPacket): Buffer {
  const writer = new BufferWriter(64);
  const nullBits = (packet.authorizationGrant != null ? 1 : 0) | (packet.serverIdentityToken != null ? 2 : 0);
  writer.writeUInt8(nullBits);
  const authorizationGrantOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const serverIdentityTokenOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const variableBase = writer.offset;
  if (packet.authorizationGrant != null) {
    writer.setInt32LE(authorizationGrantOffsetSlot, writer.offset - variableBase);
    writeVarString(writer, packet.authorizationGrant, 4096, "utf8");
  } else {
    writer.setInt32LE(authorizationGrantOffsetSlot, -1);
  }
  if (packet.serverIdentityToken != null) {
    writer.setInt32LE(serverIdentityTokenOffsetSlot, writer.offset - variableBase);
    writeVarString(writer, packet.serverIdentityToken, 8192, "utf8");
  } else {
    writer.setInt32LE(serverIdentityTokenOffsetSlot, -1);
  }
  return writer.toBuffer();
}

export function decodeAuthTokenPacket(buffer: Buffer): AuthTokenPacket {
  const nullBits = readUInt8(buffer, 0);
  let accessToken: string | null = null;
  if ((nullBits & 1) !== 0) {
    accessToken = readVarString(buffer, 9 + readInt32LE(buffer, 1), "utf8").value;
  }
  let serverAuthorizationGrant: string | null = null;
  if ((nullBits & 2) !== 0) {
    serverAuthorizationGrant = readVarString(buffer, 9 + readInt32LE(buffer, 5), "utf8").value;
  }
  return {
    name: "AuthToken",
    accessToken,
    serverAuthorizationGrant
  };
}

export function encodeAuthTokenPacket(packet: AuthTokenPacket): Buffer {
  const writer = new BufferWriter(64);
  const nullBits = (packet.accessToken != null ? 1 : 0) | (packet.serverAuthorizationGrant != null ? 2 : 0);
  writer.writeUInt8(nullBits);
  const accessTokenOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const serverAuthorizationGrantOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const variableBase = writer.offset;
  if (packet.accessToken != null) {
    writer.setInt32LE(accessTokenOffsetSlot, writer.offset - variableBase);
    writeVarString(writer, packet.accessToken, 8192, "utf8");
  } else {
    writer.setInt32LE(accessTokenOffsetSlot, -1);
  }
  if (packet.serverAuthorizationGrant != null) {
    writer.setInt32LE(serverAuthorizationGrantOffsetSlot, writer.offset - variableBase);
    writeVarString(writer, packet.serverAuthorizationGrant, 4096, "utf8");
  } else {
    writer.setInt32LE(serverAuthorizationGrantOffsetSlot, -1);
  }
  return writer.toBuffer();
}

export function decodeServerAuthTokenPacket(buffer: Buffer): ServerAuthTokenPacket {
  const nullBits = readUInt8(buffer, 0);
  let serverAccessToken: string | null = null;
  if ((nullBits & 1) !== 0) {
    serverAccessToken = readVarString(buffer, 9 + readInt32LE(buffer, 1), "utf8").value;
  }
  let passwordChallenge: Buffer | null = null;
  if ((nullBits & 2) !== 0) {
    const base = 9 + readInt32LE(buffer, 5);
    const length = readVarInt(buffer, base);
    if (length.value > 64) {
      throw new ProtocolError(`PasswordChallenge exceeds max length 64: ${length.value}`);
    }
    passwordChallenge = buffer.subarray(base + length.bytesRead, base + length.bytesRead + length.value);
  }
  return {
    name: "ServerAuthToken",
    serverAccessToken,
    passwordChallenge
  };
}

export function encodeServerAuthTokenPacket(packet: ServerAuthTokenPacket): Buffer {
  const writer = new BufferWriter(64);
  const nullBits = (packet.serverAccessToken != null ? 1 : 0) | (packet.passwordChallenge != null ? 2 : 0);
  writer.writeUInt8(nullBits);
  const serverAccessTokenOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const passwordChallengeOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const variableBase = writer.offset;
  if (packet.serverAccessToken != null) {
    writer.setInt32LE(serverAccessTokenOffsetSlot, writer.offset - variableBase);
    writeVarString(writer, packet.serverAccessToken, 8192, "utf8");
  } else {
    writer.setInt32LE(serverAccessTokenOffsetSlot, -1);
  }
  if (packet.passwordChallenge != null) {
    writer.setInt32LE(passwordChallengeOffsetSlot, writer.offset - variableBase);
    if (packet.passwordChallenge.length > 64) {
      throw new ProtocolError(`PasswordChallenge exceeds max length 64: ${packet.passwordChallenge.length}`);
    }
    writeVarInt(writer, packet.passwordChallenge.length);
    writer.writeBytes(packet.passwordChallenge);
  } else {
    writer.setInt32LE(passwordChallengeOffsetSlot, -1);
  }
  return writer.toBuffer();
}

export const decodeDisconnectPacket = (buffer: Buffer): DisconnectPacket => ({
  name: "Disconnect",
  reason: (readUInt8(buffer, 0) & 1) !== 0 ? readVarString(buffer, 2, "utf8").value : null,
  type: readDisconnectType(readUInt8(buffer, 1))
});

export function encodeDisconnectPacket(packet: DisconnectPacket): Buffer {
  const writer = new BufferWriter(64);
  writer.writeUInt8(packet.reason != null ? 1 : 0);
  writer.writeUInt8(writeDisconnectType(packet.type));
  if (packet.reason != null) {
    writeVarString(writer, packet.reason, 4_096_000);
  }
  return writer.toBuffer();
}

export const decodePingPacket = (buffer: Buffer): PingPacket => ({
  name: "Ping",
  id: readInt32LE(buffer, 1),
  time: (readUInt8(buffer, 0) & 1) !== 0 ? readInstantData(buffer, 5).value : null,
  lastPingValueRaw: readInt32LE(buffer, 17),
  lastPingValueDirect: readInt32LE(buffer, 21),
  lastPingValueTick: readInt32LE(buffer, 25)
});

export function encodePingPacket(packet: PingPacket): Buffer {
  const writer = new BufferWriter(29);
  writer.writeUInt8(packet.time != null ? 1 : 0);
  writer.writeInt32LE(packet.id);
  writeInstantData(writer, packet.time);
  writer.writeInt32LE(packet.lastPingValueRaw);
  writer.writeInt32LE(packet.lastPingValueDirect);
  writer.writeInt32LE(packet.lastPingValueTick);
  return writer.toBuffer();
}

export const decodePongPacket = (buffer: Buffer): PongPacket => ({
  name: "Pong",
  id: readInt32LE(buffer, 1),
  time: (readUInt8(buffer, 0) & 1) !== 0 ? readInstantData(buffer, 5).value : null,
  type: readPongType(readUInt8(buffer, 17)),
  packetQueueSize: readInt16LE(buffer, 18)
});

export function encodePongPacket(packet: PongPacket): Buffer {
  const writer = new BufferWriter(20);
  writer.writeUInt8(packet.time != null ? 1 : 0);
  writer.writeInt32LE(packet.id);
  writeInstantData(writer, packet.time);
  writer.writeUInt8(writePongType(packet.type));
  writer.writeInt16LE(packet.packetQueueSize);
  return writer.toBuffer();
}

export function decodeRequestAssetsPacket(buffer: Buffer): RequestAssetsPacket {
  const nullBits = readUInt8(buffer, 0);
  if ((nullBits & 1) === 0) {
    return { name: "RequestAssets", assets: null };
  }
  const count = readVarInt(buffer, 1);
  let cursor = 1 + count.bytesRead;
  const assets = [];
  for (let index = 0; index < count.value; index += 1) {
    const asset = readAsset(buffer, cursor);
    assets.push(asset.value);
    cursor += asset.bytesRead;
  }
  return { name: "RequestAssets", assets };
}

export function encodeRequestAssetsPacket(packet: RequestAssetsPacket): Buffer {
  const writer = new BufferWriter(64);
  writer.writeUInt8(packet.assets != null ? 1 : 0);
  if (packet.assets != null) {
    writeVarInt(writer, packet.assets.length);
    packet.assets.forEach((asset) => writeAsset(writer, asset));
  }
  return writer.toBuffer();
}

export function decodeWorldSettingsPacket(buffer: Buffer): WorldSettingsPacket {
  const nullBits = readUInt8(buffer, 0);
  const worldHeight = readInt32LE(buffer, 1);
  if ((nullBits & 1) === 0) {
    return { name: "WorldSettings", worldHeight, requiredAssets: null };
  }
  const count = readVarInt(buffer, 5);
  let cursor = 5 + count.bytesRead;
  const assets = [];
  for (let index = 0; index < count.value; index += 1) {
    const asset = readAsset(buffer, cursor);
    assets.push(asset.value);
    cursor += asset.bytesRead;
  }
  return { name: "WorldSettings", worldHeight, requiredAssets: assets };
}

export function encodeWorldSettingsPacket(packet: WorldSettingsPacket): Buffer {
  const writer = new BufferWriter(64);
  writer.writeUInt8(packet.requiredAssets != null ? 1 : 0);
  writer.writeInt32LE(packet.worldHeight);
  if (packet.requiredAssets != null) {
    writeVarInt(writer, packet.requiredAssets.length);
    packet.requiredAssets.forEach((asset) => writeAsset(writer, asset));
  }
  return writer.toBuffer();
}

export const decodeViewRadiusPacket = (buffer: Buffer): ViewRadiusPacket => ({ name: "ViewRadius", value: readInt32LE(buffer, 0) });

export function encodeViewRadiusPacket(packet: ViewRadiusPacket): Buffer {
  const writer = new BufferWriter(4);
  writer.writeInt32LE(packet.value);
  return writer.toBuffer();
}

export function decodePlayerOptionsPacket(buffer: Buffer): PlayerOptionsPacket {
  if ((readUInt8(buffer, 0) & 1) !== 0) {
    throw new ProtocolError("PlayerSkin decoding is not implemented in the TS protocol client yet");
  }
  return { name: "PlayerOptions", skin: null };
}

export function encodePlayerOptionsPacket(packet: PlayerOptionsPacket): Buffer {
  if (packet.skin != null) {
    throw new ProtocolError("PlayerSkin encoding is not implemented in the TS protocol client yet");
  }
  return Buffer.from([0]);
}

export const decodeSetClientIdPacket = (buffer: Buffer): SetClientIdPacket => ({ name: "SetClientId", clientId: readInt32LE(buffer, 0) });

export function encodeSetClientIdPacket(packet: SetClientIdPacket): Buffer {
  const writer = new BufferWriter(4);
  writer.writeInt32LE(packet.clientId);
  return writer.toBuffer();
}

export const decodeJoinWorldPacket = (buffer: Buffer): JoinWorldPacket => ({
  name: "JoinWorld",
  clearWorld: readBooleanByte(buffer, 0),
  fadeInOut: readBooleanByte(buffer, 1),
  worldUuid: readUuid(buffer, 2)
});

export function encodeJoinWorldPacket(packet: JoinWorldPacket): Buffer {
  const writer = new BufferWriter(18);
  writer.writeUInt8(packet.clearWorld ? 1 : 0);
  writer.writeUInt8(packet.fadeInOut ? 1 : 0);
  writeUuid(writer, packet.worldUuid);
  return writer.toBuffer();
}

export const decodeClientReadyPacket = (buffer: Buffer): ClientReadyPacket => ({
  name: "ClientReady",
  readyForChunks: readBooleanByte(buffer, 0),
  readyForGameplay: readBooleanByte(buffer, 1)
});

export function encodeClientReadyPacket(packet: ClientReadyPacket): Buffer {
  const writer = new BufferWriter(2);
  writer.writeUInt8(packet.readyForChunks ? 1 : 0);
  writer.writeUInt8(packet.readyForGameplay ? 1 : 0);
  return writer.toBuffer();
}

export const decodeClientMovementPacket = (buffer: Buffer): ClientMovementPacket => {
  const nullBits0 = readUInt8(buffer, 0);
  const nullBits1 = readUInt8(buffer, 1);
  return {
    name: "ClientMovement",
    movementStates: (nullBits0 & 1) !== 0 ? readMovementStates(buffer, 2).value : null,
    relativePosition: (nullBits0 & 2) !== 0 ? readHalfFloatPosition(buffer, 24).value : null,
    absolutePosition: (nullBits0 & 4) !== 0 ? readPosition(buffer, 30).value : null,
    bodyOrientation: (nullBits0 & 8) !== 0 ? readDirection(buffer, 54).value : null,
    lookOrientation: (nullBits0 & 16) !== 0 ? readDirection(buffer, 66).value : null,
    teleportAck: (nullBits0 & 32) !== 0 ? readTeleportAck(buffer, 78).value : null,
    wishMovement: (nullBits0 & 64) !== 0 ? readPosition(buffer, 79).value : null,
    velocity: (nullBits0 & 128) !== 0 ? readVector3d(buffer, 103).value : null,
    mountedTo: readInt32LE(buffer, 127),
    riderMovementStates: (nullBits1 & 1) !== 0 ? readMovementStates(buffer, 131).value : null
  };
};

export function encodeClientMovementPacket(packet: ClientMovementPacket): Buffer {
  const writer = new BufferWriter(153);
  let nullBits0 = 0;
  let nullBits1 = 0;
  if (packet.movementStates) nullBits0 |= 1;
  if (packet.relativePosition) nullBits0 |= 2;
  if (packet.absolutePosition) nullBits0 |= 4;
  if (packet.bodyOrientation) nullBits0 |= 8;
  if (packet.lookOrientation) nullBits0 |= 16;
  if (packet.teleportAck) nullBits0 |= 32;
  if (packet.wishMovement) nullBits0 |= 64;
  if (packet.velocity) nullBits0 |= 128;
  if (packet.riderMovementStates) nullBits1 |= 1;
  writer.writeUInt8(nullBits0);
  writer.writeUInt8(nullBits1);
  writeMovementStates(writer, packet.movementStates ?? createDefaultMovementStates());
  writeHalfFloatPosition(writer, packet.relativePosition);
  writePosition(writer, packet.absolutePosition);
  writeDirection(writer, packet.bodyOrientation);
  writeDirection(writer, packet.lookOrientation);
  writeTeleportAck(writer, packet.teleportAck);
  writePosition(writer, packet.wishMovement);
  writeVector3d(writer, packet.velocity);
  writer.writeInt32LE(packet.mountedTo ?? 0);
  writeMovementStates(writer, packet.riderMovementStates ?? createDefaultMovementStates());
  return writer.toBuffer();
}

export const decodeClientTeleportPacket = (buffer: Buffer): ClientTeleportPacket => ({
  name: "ClientTeleport",
  teleportId: readUInt8(buffer, 1),
  modelTransform: (readUInt8(buffer, 0) & 1) !== 0 ? readModelTransform(buffer, 2).value : null,
  resetVelocity: readBooleanByte(buffer, 51)
});

export function encodeClientTeleportPacket(packet: ClientTeleportPacket): Buffer {
  const writer = new BufferWriter(52);
  writer.writeUInt8(packet.modelTransform ? 1 : 0);
  writer.writeUInt8(packet.teleportId);
  writeModelTransform(writer, packet.modelTransform);
  writer.writeUInt8(packet.resetVelocity ? 1 : 0);
  return writer.toBuffer();
}

export const decodeChatMessagePacket = (buffer: Buffer): ChatMessagePacket => ({
  name: "ChatMessage",
  message: (readUInt8(buffer, 0) & 1) !== 0 ? readVarString(buffer, 1, "utf8").value : null
});

export function encodeChatMessagePacket(packet: ChatMessagePacket): Buffer {
  const writer = new BufferWriter(64);
  writer.writeUInt8(packet.message != null ? 1 : 0);
  if (packet.message != null) {
    writeVarString(writer, packet.message, 4_096_000);
  }
  return writer.toBuffer();
}

export const decodeSetPagePacket = (buffer: Buffer): SetPagePacket => ({
  name: "SetPage",
  page: readPageType(readUInt8(buffer, 0)),
  canCloseThroughInteraction: readBooleanByte(buffer, 1)
});

export function encodeSetPagePacket(packet: SetPagePacket): Buffer {
  const writer = new BufferWriter(2);
  writer.writeUInt8(writePageType(packet.page));
  writer.writeUInt8(packet.canCloseThroughInteraction ? 1 : 0);
  return writer.toBuffer();
}

export const decodeServerMessagePacket = (buffer: Buffer): ServerMessagePacket => ({
  name: "ServerMessage",
  type: readChatType(readUInt8(buffer, 1)),
  message: (readUInt8(buffer, 0) & 1) !== 0 ? readFormattedMessage(buffer, 2).value : null
});

export function encodeServerMessagePacket(packet: ServerMessagePacket): Buffer {
  const writer = new BufferWriter(256);
  writer.writeUInt8(packet.message != null ? 1 : 0);
  writer.writeUInt8(writeChatType(packet.type));
  if (packet.message != null) {
    writeFormattedMessage(writer, packet.message);
  }
  return writer.toBuffer();
}

export { decodeCustomPagePacket, decodeCustomPageEventPacket, encodeCustomPagePacket, encodeCustomPageEventPacket, snapshotCustomPage, formattedMessageToPlainText };
