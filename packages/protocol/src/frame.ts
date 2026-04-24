import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { FRAME_HEADER_SIZE, MAX_FRAME_SIZE } from "./constants.js";
import { decodePacket, encodePacket } from "./codec.js";
import { ProtocolError } from "./errors.js";
import { assertPacketDirection, getPacketRegistryEntryById, getPacketRegistryEntryByName, type WireDirection } from "./registry.js";
import type { DecodedPacket, StructuredPacket } from "./types.js";

export function encodeFramedPacket(packet: StructuredPacket, direction: WireDirection): Buffer {
  const entry = getPacketRegistryEntryByName(packet.name);
  if (!entry) {
    throw new ProtocolError(`Unknown packet type: ${packet.name}`);
  }
  assertPacketDirection(entry, direction);
  const payload = encodePacket(packet, direction);
  const onWirePayload = entry.compressed && payload.length > 0 ? zstdCompressSync(payload) : payload;
  if (onWirePayload.length > MAX_FRAME_SIZE) {
    throw new ProtocolError(`Packet ${packet.name} exceeded frame limit with ${onWirePayload.length} bytes`);
  }
  const frame = Buffer.allocUnsafe(FRAME_HEADER_SIZE + onWirePayload.length);
  frame.writeInt32LE(onWirePayload.length, 0);
  frame.writeInt32LE(entry.id, 4);
  onWirePayload.copy(frame, FRAME_HEADER_SIZE);
  return frame;
}

export function decodeFramedPacket(frame: Buffer, direction: WireDirection): DecodedPacket {
  if (frame.length < FRAME_HEADER_SIZE) {
    throw new ProtocolError("Frame too small");
  }
  const payloadLength = frame.readInt32LE(0);
  if (payloadLength < 0 || payloadLength > MAX_FRAME_SIZE) {
    throw new ProtocolError(`Invalid frame length: ${payloadLength}`);
  }
  if (frame.length !== FRAME_HEADER_SIZE + payloadLength) {
    throw new ProtocolError(`Frame length mismatch: expected ${FRAME_HEADER_SIZE + payloadLength}, received ${frame.length}`);
  }
  const packetId = frame.readInt32LE(4);
  const entry = getPacketRegistryEntryById(packetId);
  if (!entry) {
    throw new ProtocolError(`Unknown packet id: ${packetId}`);
  }
  assertPacketDirection(entry, direction);
  const encodedPayload = frame.subarray(FRAME_HEADER_SIZE);
  const payload = entry.compressed && encodedPayload.length > 0 ? zstdDecompressSync(encodedPayload) : encodedPayload;
  if (payload.length > entry.maxSize) {
    throw new ProtocolError(`Packet ${entry.name} payload ${payload.length} exceeds ${entry.maxSize}`);
  }
  return decodePacket(payload, packetId, direction);
}

export class FramedPacketDecoder {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  constructor(private readonly direction: WireDirection) {}

  push(chunk: Buffer): DecodedPacket[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const packets: DecodedPacket[] = [];
    while (this.buffer.length >= FRAME_HEADER_SIZE) {
      const payloadLength = this.buffer.readInt32LE(0);
      if (payloadLength < 0 || payloadLength > MAX_FRAME_SIZE) {
        throw new ProtocolError(`Invalid frame length: ${payloadLength}`);
      }
      const fullLength = FRAME_HEADER_SIZE + payloadLength;
      if (this.buffer.length < fullLength) {
        break;
      }
      packets.push(decodeFramedPacket(this.buffer.subarray(0, fullLength), this.direction));
      this.buffer = this.buffer.subarray(fullLength);
    }
    return packets;
  }

  flushIncompleteBytes(): Buffer {
    const remainder = this.buffer;
    this.buffer = Buffer.alloc(0);
    return remainder;
  }
}
