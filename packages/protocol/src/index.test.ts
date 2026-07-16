import assert from "node:assert/strict";
import test from "node:test";
import {
  CONNECT_USERNAME_MAX_BYTES,
  FramedPacketDecoder,
  createConnectPacket,
  decodeFramedPacket,
  encodeFramedPacket,
  getPacketRegistryEntryByName,
  snapshotCustomPage,
  type ConnectPacket,
  type CustomPageEventPacket,
  type CustomPagePacket,
  type MouseInteractionPacket,
  type RequestAssetsPacket,
  type ServerMessagePacket,
  type SetActiveSlotPacket,
  type SetClientIdPacket,
  type SyncInteractionChainsPacket,
  type WorldSettingsPacket
} from "./index.js";

test("Connect round-trips through framed encode/decode", () => {
  const packet = createConnectPacket({
    username: "CodecBot",
    uuid: "4f3f22e0-5f49-4fcb-b8c3-34d869da8b76",
    clientVersion: "hyrhythm-bot"
  });
  const frame = encodeFramedPacket(packet, "toServer");
  const decoded = decodeFramedPacket(frame, "toServer");
  if (decoded.name !== "Connect") {
    assert.fail(`Expected Connect packet, received ${decoded.name}`);
  }
  const connectPacket = decoded as ConnectPacket;
  assert.equal(connectPacket.username, packet.username);
  assert.equal(connectPacket.clientVersion, packet.clientVersion);
  assert.equal(connectPacket.protocolBuildNumber, packet.protocolBuildNumber);
});

test("RequestAssets uses compressed framing and round-trips", () => {
  const packet: RequestAssetsPacket = { name: "RequestAssets", assets: [] };
  const decoded = decodeFramedPacket(encodeFramedPacket(packet, "toServer"), "toServer");
  assert.deepEqual(decoded, packet);
});

test("WorldSettings and SetClientId decode from server-framed payloads", () => {
  const worldSettings: WorldSettingsPacket = { name: "WorldSettings", worldHeight: 256, requiredAssets: [] };
  const setClientId: SetClientIdPacket = { name: "SetClientId", clientId: 42 };
  const setActiveSlot: SetActiveSlotPacket = { name: "SetActiveSlot", inventorySectionId: -1, activeSlot: -1 };

  assert.deepEqual(decodeFramedPacket(encodeFramedPacket(worldSettings, "toClient"), "toClient"), worldSettings);
  assert.deepEqual(decodeFramedPacket(encodeFramedPacket(setClientId, "toClient"), "toClient"), setClientId);
  assert.deepEqual(decodeFramedPacket(encodeFramedPacket(setActiveSlot, "toClient"), "toClient"), setActiveSlot);
});

test("CustomPage and CustomPageEvent round-trip", () => {
  const customPage: CustomPagePacket = {
    name: "CustomPage",
    key: "com.hyrhythm.ui.RhythmSongSelectionPage",
    isInitial: true,
    clear: false,
    lifetime: "CanDismiss",
    commands: [{ type: "Set", selector: "#ClockValue.Text", text: "12.345" }],
    eventBindings: [{ type: "Activating", selector: "#ConfirmButton", data: "{\"Action\":\"Confirm\"}", locksInterface: false }]
  };
  const customPageEvent: CustomPageEventPacket = {
    name: "CustomPageEvent",
    type: "Data",
    data: "{\"Action\":\"Confirm\"}"
  };

  assert.deepEqual(decodeFramedPacket(encodeFramedPacket(customPage, "toClient"), "toClient"), customPage);
  assert.deepEqual(decodeFramedPacket(encodeFramedPacket(customPageEvent, "toServer"), "toServer"), customPageEvent);
});

test("MouseInteraction right-click entity packet round-trips", () => {
  const packet: MouseInteractionPacket = {
    name: "MouseInteraction",
    clientTimestamp: 123456789n,
    activeSlot: 0,
    screenPoint: { x: 0.5, y: 0.5 },
    mouseButton: { mouseButtonType: "Right", state: "Pressed", clicks: 1 },
    worldInteraction: {
      entityId: 77,
      blockPosition: null,
      blockRotation: null
    },
    itemInHandId: null,
    mouseMotion: null
  };

  assert.deepEqual(decodeFramedPacket(encodeFramedPacket(packet, "toServer"), "toServer"), packet);
});

test("SyncInteractionChains Secondary entity interaction packet round-trips", () => {
  const packet: SyncInteractionChainsPacket = {
    name: "SyncInteractionChains",
    updates: [
      {
        activeHotbarSlot: -1,
        activeUtilitySlot: -1,
        activeToolsSlot: -1,
        itemInHandId: null,
        utilityItemId: null,
        toolsItemId: null,
        initial: true,
        desync: false,
        overrideRootInteraction: -2147483648,
        interactionType: "Secondary",
        equipSlot: -1,
        chainId: 1,
        forkedId: null,
        data: {
          entityId: 77,
          proxyId: "4f3f22e0-5f49-4fcb-b8c3-34d869da8b76",
          hitLocation: { x: 10, y: 64.5, z: -3 },
          hitDetail: null,
          blockPosition: null,
          targetSlot: -2147483648,
          hitNormal: null
        },
        state: "NotFinished",
        newForks: null,
        operationBaseIndex: 0,
        interactionData: null
      }
    ]
  };

  assert.deepEqual(decodeFramedPacket(encodeFramedPacket(packet, "toServer"), "toServer"), packet);
});

test("CustomPage snapshots normalize HyUI generated selectors", () => {
  const snapshot = snapshotCustomPage({
    name: "CustomPage",
    key: "com.tavall.hytale.resourcegame.ui.CastleInfoPage",
    isInitial: true,
    clear: true,
    lifetime: "CanDismiss",
    commands: [
      { type: "Set", selector: "#HYUUIDCastleId306.Text", data: "{\"0\":\"1\"}" },
      { type: "Set", selector: "#HYUUIDStageLevel30Button123 #HyUITextButton.Text", data: "{\"0\":\"Level 30\"}" }
    ],
    eventBindings: [
      { type: "Activating", selector: "#HYUUIDBackButton331 #HyUISecondaryTextButton", data: "{}", locksInterface: false }
    ]
  });

  assert.deepEqual(snapshot.selectors, [
    "#CastleId.Text",
    "#StageLevel30Button #HyUITextButton.Text",
    "#BackButton #HyUISecondaryTextButton"
  ]);
  assert.equal(snapshot.commands[0]?.selector, "#CastleId.Text");
  assert.equal(snapshot.eventBindings[0]?.selector, "#BackButton #HyUISecondaryTextButton");
});

test("FramedPacketDecoder handles fragmented frames", () => {
  const packet: WorldSettingsPacket = { name: "WorldSettings", worldHeight: 512, requiredAssets: [] };
  const frame = encodeFramedPacket(packet, "toClient");
  const decoder = new FramedPacketDecoder("toClient");
  assert.equal(decoder.push(frame.subarray(0, 5)).length, 0);
  const packets = decoder.push(frame.subarray(5));
  assert.equal(packets.length, 1);
  assert.deepEqual(packets[0], packet);
});

test("Unknown packet ids fail explicitly", () => {
  const frame = Buffer.alloc(8);
  frame.writeInt32LE(0, 0);
  frame.writeInt32LE(999_999, 4);
  assert.throws(() => decodeFramedPacket(frame, "toClient"), /Unknown packet id/);
});

test("Malformed structured packets fall back to raw packets without desynchronizing the stream", () => {
  const entry = getPacketRegistryEntryByName("ServerMessage");
  assert.ok(entry, "Expected registry metadata for ServerMessage");

  const payload = Buffer.from([1, 0]);
  const frame = Buffer.alloc(8 + payload.length);
  frame.writeInt32LE(payload.length, 0);
  frame.writeInt32LE(entry.id, 4);
  payload.copy(frame, 8);

  const decoded = decodeFramedPacket(frame, "toClient");
  assert.equal(decoded.name, "ServerMessage");
  if (!("structured" in decoded) || decoded.structured !== false) {
    assert.fail("Expected malformed ServerMessage payload to fall back to a raw packet");
  }
  assert.match(decoded.decodeError ?? "", /Buffer overflow/);
});

test("ServerMessage decodes current formatted message header", () => {
  const entry = getPacketRegistryEntryByName("ServerMessage");
  assert.ok(entry, "Expected registry metadata for ServerMessage");
  const payload = Buffer.from([
    1, 0, 10, 0, 0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255,
    33, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 32, 115, 101, 114, 118, 101, 114, 46, 103, 101, 110, 101,
    114, 97, 108, 46, 112, 108, 97, 121, 101, 114, 74, 111, 105, 110, 101, 100,
    87, 111, 114, 108, 100, 2, 5, 119, 111, 114, 108, 100, 0, 1, 7, 100, 101,
    102, 97, 117, 108, 116, 8, 117, 115, 101, 114, 110, 97, 109, 101, 0, 1, 12,
    70, 97, 114, 109, 115, 116, 101, 97, 100, 66, 111, 116
  ]);
  const frame = Buffer.alloc(8 + payload.length);
  frame.writeInt32LE(payload.length, 0);
  frame.writeInt32LE(entry.id, 4);
  payload.copy(frame, 8);

  const decoded = decodeFramedPacket(frame, "toClient");
  assert.equal(decoded.name, "ServerMessage");
  if ("structured" in decoded && decoded.structured === false) {
    assert.fail(`Expected structured ServerMessage, got raw fallback: ${decoded.decodeError}`);
  }
  const message = (decoded as ServerMessagePacket).message;
  assert.equal(message?.messageId, "server.general.playerJoinedWorld");
  assert.equal(message?.params?.username?.kind, "string");
  assert.equal(message?.params?.username?.value, "FarmsteadBot");
});

test("Oversized frame lengths fail explicitly", () => {
  const frame = Buffer.alloc(8);
  frame.writeInt32LE(1_677_721_601, 0);
  frame.writeInt32LE(0, 4);
  assert.throws(() => decodeFramedPacket(frame, "toServer"), /Invalid frame length/);
});

test("Connect packet validation fails early for usernames that exceed protocol limits", () => {
  const tooLongName = "X".repeat(CONNECT_USERNAME_MAX_BYTES + 1);
  assert.throws(
    () => createConnectPacket({ username: tooLongName }),
    /Connect\.username exceeds 16 ASCII bytes/
  );
});

test("Packet registry includes live voice configuration packets", () => {
  const entry = getPacketRegistryEntryByName("VoiceConfig");
  assert.ok(entry, "Expected live registry metadata for VoiceConfig");
  assert.equal(entry.id, 452);
  assert.equal(entry.direction, "ToClient");
});
