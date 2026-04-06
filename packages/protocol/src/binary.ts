import { ProtocolError } from "./errors.js";

export class BufferWriter {
  private buffer: Buffer;
  private cursor = 0;

  constructor(initialSize = 256) {
    this.buffer = Buffer.allocUnsafe(Math.max(initialSize, 1));
  }

  get offset(): number {
    return this.cursor;
  }

  private ensure(size: number): void {
    const required = this.cursor + size;
    if (required <= this.buffer.length) {
      return;
    }
    let nextSize = this.buffer.length;
    while (nextSize < required) {
      nextSize *= 2;
    }
    const next = Buffer.allocUnsafe(nextSize);
    this.buffer.copy(next, 0, 0, this.cursor);
    this.buffer = next;
  }

  writeUInt8(value: number): void {
    this.ensure(1);
    this.buffer.writeUInt8(value & 0xff, this.cursor);
    this.cursor += 1;
  }

  writeInt16LE(value: number): void {
    this.ensure(2);
    this.buffer.writeInt16LE(value, this.cursor);
    this.cursor += 2;
  }

  writeInt32LE(value: number): void {
    this.ensure(4);
    this.buffer.writeInt32LE(value, this.cursor);
    this.cursor += 4;
  }

  writeFloatLE(value: number): void {
    this.ensure(4);
    this.buffer.writeFloatLE(value, this.cursor);
    this.cursor += 4;
  }

  writeDoubleLE(value: number): void {
    this.ensure(8);
    this.buffer.writeDoubleLE(value, this.cursor);
    this.cursor += 8;
  }

  writeBigInt64LE(value: bigint): void {
    this.ensure(8);
    this.buffer.writeBigInt64LE(value, this.cursor);
    this.cursor += 8;
  }

  writeBytes(value: Buffer): void {
    this.ensure(value.length);
    value.copy(this.buffer, this.cursor);
    this.cursor += value.length;
  }

  writeZero(length: number): void {
    this.ensure(length);
    this.buffer.fill(0, this.cursor, this.cursor + length);
    this.cursor += length;
  }

  setInt32LE(offset: number, value: number): void {
    this.buffer.writeInt32LE(value, offset);
  }

  toBuffer(): Buffer {
    return this.buffer.subarray(0, this.cursor);
  }
}

export interface ReadResult<T> {
  readonly value: T;
  readonly bytesRead: number;
}

export function assertRange(buffer: Buffer, offset: number, size: number, label: string): void {
  if (offset < 0 || offset + size > buffer.length) {
    throw new ProtocolError(`Buffer overflow reading ${label}`);
  }
}

export function readUInt8(buffer: Buffer, offset: number): number {
  assertRange(buffer, offset, 1, "byte");
  return buffer.readUInt8(offset);
}

export function readInt16LE(buffer: Buffer, offset: number): number {
  assertRange(buffer, offset, 2, "int16");
  return buffer.readInt16LE(offset);
}

export function readInt32LE(buffer: Buffer, offset: number): number {
  assertRange(buffer, offset, 4, "int32");
  return buffer.readInt32LE(offset);
}

export function readFloatLE(buffer: Buffer, offset: number): number {
  assertRange(buffer, offset, 4, "float");
  return buffer.readFloatLE(offset);
}

export function readDoubleLE(buffer: Buffer, offset: number): number {
  assertRange(buffer, offset, 8, "double");
  return buffer.readDoubleLE(offset);
}

export function readBigInt64LE(buffer: Buffer, offset: number): bigint {
  assertRange(buffer, offset, 8, "int64");
  return buffer.readBigInt64LE(offset);
}

export function readBooleanByte(buffer: Buffer, offset: number): boolean {
  return readUInt8(buffer, offset) !== 0;
}

export function readVarInt(buffer: Buffer, offset: number): ReadResult<number> {
  let value = 0;
  let shift = 0;
  let position = offset;
  while (position < buffer.length) {
    const byte = buffer[position];
    value |= (byte & 0x7f) << shift;
    position += 1;
    if ((byte & 0x80) === 0) {
      return { value, bytesRead: position - offset };
    }
    shift += 7;
    if (shift > 28) {
      throw new ProtocolError("VarInt exceeds maximum length (5 bytes)");
    }
  }
  throw new ProtocolError("Incomplete VarInt");
}

export function writeVarInt(writer: BufferWriter, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new ProtocolError(`VarInt cannot encode negative or non-integer values: ${value}`);
  }
  let remaining = value >>> 0;
  while ((remaining & ~0x7f) !== 0) {
    writer.writeUInt8((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  writer.writeUInt8(remaining);
}

export function varIntSize(value: number): number {
  if ((value & ~0x7f) === 0) {
    return 1;
  }
  if ((value & ~0x3fff) === 0) {
    return 2;
  }
  if ((value & ~0x1fffff) === 0) {
    return 3;
  }
  if ((value & ~0xfffffff) === 0) {
    return 4;
  }
  return 5;
}

export function stringSize(value: string, encoding: BufferEncoding = "utf8"): number {
  const byteLength = Buffer.byteLength(value, encoding);
  return varIntSize(byteLength) + byteLength;
}

export function readFixedAsciiString(buffer: Buffer, offset: number, length: number): string {
  assertRange(buffer, offset, length, "fixed ASCII string");
  const slice = buffer.subarray(offset, offset + length);
  const terminator = slice.indexOf(0);
  return slice.subarray(0, terminator >= 0 ? terminator : slice.length).toString("ascii");
}

export function writeFixedAsciiString(writer: BufferWriter, value: string | null | undefined, length: number): void {
  const encoded = Buffer.from(value ?? "", "ascii");
  if (encoded.length > length) {
    throw new ProtocolError(`Fixed ASCII string exceeds ${length} bytes`);
  }
  writer.writeBytes(encoded);
  if (encoded.length < length) {
    writer.writeZero(length - encoded.length);
  }
}

export function readVarString(buffer: Buffer, offset: number, encoding: BufferEncoding = "utf8"): ReadResult<string> {
  const lengthResult = readVarInt(buffer, offset);
  const start = offset + lengthResult.bytesRead;
  const end = start + lengthResult.value;
  assertRange(buffer, start, lengthResult.value, "string");
  return {
    value: buffer.toString(encoding, start, end),
    bytesRead: lengthResult.bytesRead + lengthResult.value
  };
}

export function writeVarString(writer: BufferWriter, value: string, maxBytes: number, encoding: BufferEncoding = "utf8"): void {
  const encoded = Buffer.from(value, encoding);
  if (encoded.length > maxBytes) {
    throw new ProtocolError(`String exceeds max bytes ${maxBytes}: ${encoded.length}`);
  }
  writeVarInt(writer, encoded.length);
  writer.writeBytes(encoded);
}

export function normalizeUuid(value: string): string {
  const normalized = value.toLowerCase();
  const compact = normalized.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/.test(compact)) {
    throw new ProtocolError(`Invalid UUID: ${value}`);
  }
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

export function readUuid(buffer: Buffer, offset: number): string {
  assertRange(buffer, offset, 16, "UUID");
  const value = buffer.subarray(offset, offset + 16).toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function writeUuid(writer: BufferWriter, value: string): void {
  writer.writeBytes(Buffer.from(normalizeUuid(value).replace(/-/g, ""), "hex"));
}
