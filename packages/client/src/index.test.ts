import assert from "node:assert/strict";
import test from "node:test";
import type {
  ClientMovementPacket,
  ClientTeleportPacket,
  MouseInteractionPacket,
  SetActiveSlotPacket,
  StructuredPacket,
  SyncInteractionChainsPacket,
  WorldSettingsPacket
} from "@hyrhythm/hytale-protocol";
import { HytaleBot } from "./index.js";

test("WorldSettings setup handshake is sent once per connection", () => {
  const bot = new HytaleBot({
    username: "SetupBot",
    uuid: "523e4567-e89b-12d3-a456-426614174099"
  });
  const sentPackets: string[] = [];
  bot.sendPacket = (packet: StructuredPacket) => {
    sentPackets.push(packet.name);
  };

  const packet: WorldSettingsPacket = { name: "WorldSettings", worldHeight: 256, requiredAssets: [] };
  const testBot = bot as unknown as { handleWorldSettings(packet: WorldSettingsPacket): void };
  testBot.handleWorldSettings(packet);
  testBot.handleWorldSettings(packet);

  assert.deepEqual(sentPackets, ["RequestAssets", "ViewRadius", "PlayerOptions"]);
});

test("WorldLoadFinished does not emit synthetic movement heartbeats", () => {
  const bot = new HytaleBot({
    username: "MovementBot",
    uuid: "623e4567-e89b-12d3-a456-426614174099"
  });
  const sentPackets: string[] = [];
  bot.sendPacket = (packet: StructuredPacket) => {
    sentPackets.push(packet.name);
  };

  const testBot = bot as unknown as {
    connected: boolean;
    worldJoined: boolean;
    handleWorldLoadFinished(packet: { name: "WorldLoadFinished" }): void;
  };
  testBot.connected = true;
  testBot.worldJoined = true;
  testBot.handleWorldLoadFinished({ name: "WorldLoadFinished" });

  assert.deepEqual(sentPackets, ["ClientReady", "LoadHotbar"]);
});

test("ClientTeleport acknowledgement without transform uses the current position", () => {
  const bot = new HytaleBot({
    username: "TeleportAckBot",
    uuid: "723e4567-e89b-12d3-a456-426614174099"
  });
  const sentPackets: StructuredPacket[] = [];
  bot.sendPacket = (packet: StructuredPacket) => {
    sentPackets.push(packet);
  };

  bot.move({
    absolutePosition: { x: 12, y: 75, z: -4 },
    bodyOrientation: { yaw: 90, pitch: 0, roll: 0 },
    lookOrientation: { yaw: 90, pitch: 10, roll: 0 }
  });
  sentPackets.length = 0;

  const packet: ClientTeleportPacket = {
    name: "ClientTeleport",
    teleportId: 41,
    modelTransform: null,
    resetVelocity: false
  };
  const testBot = bot as unknown as { handleTeleport(packet: ClientTeleportPacket): void };
  testBot.handleTeleport(packet);

  assert.equal(sentPackets.length, 1);
  const movement = sentPackets[0] as ClientMovementPacket;
  assert.equal(movement.name, "ClientMovement");
  assert.deepEqual(movement.teleportAck, { teleportId: 41 });
  assert.equal(movement.movementStates, null);
  assert.deepEqual(movement.absolutePosition, { x: 12, y: 75, z: -4 });
  assert.equal(movement.bodyOrientation, null);
  assert.equal(movement.lookOrientation, null);
});

test("ClientTeleport acknowledgement with transform uses the teleported position", () => {
  const bot = new HytaleBot({
    username: "TeleportBot2",
    uuid: "823e4567-e89b-12d3-a456-426614174099"
  });
  const sentPackets: StructuredPacket[] = [];
  bot.sendPacket = (packet: StructuredPacket) => {
    sentPackets.push(packet);
  };

  const packet: ClientTeleportPacket = {
    name: "ClientTeleport",
    teleportId: 42,
    modelTransform: {
      position: { x: -625.5, y: 124, z: 360.5 },
      bodyOrientation: { yaw: 180, pitch: 0, roll: 0 },
      lookOrientation: { yaw: 180, pitch: -5, roll: 0 }
    },
    resetVelocity: true
  };
  const testBot = bot as unknown as { handleTeleport(packet: ClientTeleportPacket): void };
  testBot.handleTeleport(packet);

  assert.equal(sentPackets.length, 1);
  const movement = sentPackets[0] as ClientMovementPacket;
  assert.deepEqual(movement.teleportAck, { teleportId: 42 });
  assert.equal(movement.movementStates, null);
  assert.deepEqual(movement.absolutePosition, packet.modelTransform?.position);
  assert.equal(movement.bodyOrientation, null);
  assert.equal(movement.lookOrientation, null);
  assert.deepEqual(bot.getPosition(), packet.modelTransform?.position);
});

test("ClientTeleport acknowledgement is skipped until a position is known", () => {
  const bot = new HytaleBot({
    username: "NoPositionBot",
    uuid: "923e4567-e89b-12d3-a456-426614174099"
  });
  const sentPackets: StructuredPacket[] = [];
  const errors: Error[] = [];
  bot.sendPacket = (packet: StructuredPacket) => {
    sentPackets.push(packet);
  };
  bot.on("protocolError", (error) => errors.push(error));

  const packet: ClientTeleportPacket = {
    name: "ClientTeleport",
    teleportId: 43,
    modelTransform: null,
    resetVelocity: false
  };
  const testBot = bot as unknown as { handleTeleport(packet: ClientTeleportPacket): void };
  testBot.handleTeleport(packet);

  assert.equal(sentPackets.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /no acknowledgement position/);
});

test("assumePosition seeds local state without sending movement", () => {
  const bot = new HytaleBot({
    username: "AssumePosBot",
    uuid: "933e4567-e89b-12d3-a456-426614174099"
  });
  const sentPackets: StructuredPacket[] = [];
  bot.sendPacket = (packet: StructuredPacket) => {
    sentPackets.push(packet);
  };

  bot.assumePosition({ x: -12, y: 70, z: 4 });

  assert.equal(sentPackets.length, 0);
  assert.deepEqual(bot.getPosition(), { x: -12, y: 70, z: 4 });
});

test("moveRelative sends relative movement without absolute teleport", () => {
  const bot = new HytaleBot({
    username: "RelativeMoveBot",
    uuid: "943e4567-e89b-12d3-a456-426614174099"
  });
  const sentPackets: StructuredPacket[] = [];
  bot.sendPacket = (packet: StructuredPacket) => {
    sentPackets.push(packet);
  };
  bot.assumePosition({ x: 10, y: 64, z: -2 });

  bot.moveRelative({ x: 0.25, y: 0, z: -0.5 });

  assert.equal(sentPackets.length, 1);
  const movement = sentPackets[0] as ClientMovementPacket;
  assert.deepEqual(movement.relativePosition, { x: 0.25, y: 0, z: -0.5 });
  assert.equal(movement.absolutePosition, null);
  assert.deepEqual(bot.getPosition(), { x: 10.25, y: 64, z: -2.5 });
});

test("rightClickEntity sends pressed and released MouseInteraction packets", () => {
  const bot = new HytaleBot({
    username: "RightClickBot",
    uuid: "a33e4567-e89b-12d3-a456-426614174099"
  });
  const sentPackets: StructuredPacket[] = [];
  bot.sendPacket = (packet: StructuredPacket) => {
    sentPackets.push(packet);
  };

  bot.rightClickEntity(84);

  assert.equal(sentPackets.length, 2);
  assert.equal(sentPackets[0]?.name, "MouseInteraction");
  assert.equal(sentPackets[1]?.name, "MouseInteraction");
  const pressed = sentPackets[0] as MouseInteractionPacket;
  const released = sentPackets[1] as MouseInteractionPacket;
  assert.equal(pressed.worldInteraction?.entityId, 84);
  assert.equal(pressed.mouseButton?.mouseButtonType, "Right");
  assert.equal(pressed.mouseButton?.state, "Pressed");
  assert.equal(released.mouseButton?.state, "Released");
});

test("rightClickEntity can send Secondary interaction chain for an entity UUID", () => {
  const bot = new HytaleBot({
    username: "ClickChainBot",
    uuid: "b33e4567-e89b-12d3-a456-426614174099"
  });
  const sentPackets: StructuredPacket[] = [];
  bot.sendPacket = (packet: StructuredPacket) => {
    sentPackets.push(packet);
  };
  const testBot = bot as unknown as { handleSetActiveSlot(packet: SetActiveSlotPacket): void };
  testBot.handleSetActiveSlot({ name: "SetActiveSlot", inventorySectionId: -1, activeSlot: -1 });

  bot.rightClickEntity(84, {
    targetEntityUuid: "4f3f22e0-5f49-4fcb-b8c3-34d869da8b76",
    hitLocation: { x: 1, y: 2, z: 3 }
  });

  assert.equal(sentPackets.length, 3);
  assert.equal(sentPackets[0]?.name, "MouseInteraction");
  assert.equal(sentPackets[1]?.name, "SyncInteractionChains");
  assert.equal(sentPackets[2]?.name, "MouseInteraction");
  const chainPacket = sentPackets[1] as SyncInteractionChainsPacket;
  assert.equal(chainPacket.updates[0]?.interactionType, "Secondary");
  assert.equal(chainPacket.updates[0]?.activeHotbarSlot, -1);
  assert.equal(chainPacket.updates[0]?.data?.entityId, 84);
  assert.equal(chainPacket.updates[0]?.data?.proxyId, "4f3f22e0-5f49-4fcb-b8c3-34d869da8b76");
});

test("ServerDisconnect marks the bot disconnected immediately", () => {
  const bot = new HytaleBot({
    username: "DisconnectBot",
    uuid: "a23e4567-e89b-12d3-a456-426614174099"
  });
  const testBot = bot as unknown as {
    connected: boolean;
    handleServerDisconnect(packet: { name: "ServerDisconnect"; reason: string }): void;
  };

  testBot.connected = true;
  testBot.handleServerDisconnect({ name: "ServerDisconnect", reason: "server.general.disconnect.invalidTeleport" });

  assert.equal(bot.isConnected(), false);
  assert.match(bot.getServerMessages().at(-1) ?? "", /invalidTeleport/);
});
