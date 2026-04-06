import assert from "node:assert/strict";
import test from "node:test";
import {
  CONNECT_USERNAME_MAX_BYTES,
  FramedPacketDecoder,
  createConnectPacket,
  decodeFramedPacket,
  encodeFramedPacket,
  getPacketRegistryEntryByName,
  type ConnectPacket,
  type CustomPageEventPacket,
  type CustomPagePacket,
  type RequestAssetsPacket,
  type SetClientIdPacket,
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

  assert.deepEqual(decodeFramedPacket(encodeFramedPacket(worldSettings, "toClient"), "toClient"), worldSettings);
  assert.deepEqual(decodeFramedPacket(encodeFramedPacket(setClientId, "toClient"), "toClient"), setClientId);
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
