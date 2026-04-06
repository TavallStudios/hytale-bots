import {
  BufferWriter,
  type ReadResult,
  readBigInt64LE,
  readBooleanByte,
  readDoubleLE,
  readFixedAsciiString,
  readFloatLE,
  readInt16LE,
  readInt32LE,
  readUInt8,
  readVarString,
  writeFixedAsciiString,
  writeVarString
} from "../binary.js";
import type {
  Asset,
  Direction,
  HalfFloatPosition,
  HostAddress,
  InstantData,
  ModelTransform,
  MovementStates,
  Position,
  TeleportAck,
  Vector3d
} from "../types.js";

export const MOVEMENT_STATE_KEYS = [
  "idle",
  "horizontalIdle",
  "jumping",
  "flying",
  "walking",
  "running",
  "sprinting",
  "crouching",
  "forcedCrouching",
  "falling",
  "climbing",
  "inFluid",
  "swimming",
  "swimJumping",
  "onGround",
  "mantling",
  "sliding",
  "mounting",
  "rolling",
  "sitting",
  "gliding",
  "sleeping"
] as const satisfies readonly (keyof MovementStates)[];

export function createDefaultMovementStates(overrides: Partial<MovementStates> = {}): MovementStates {
  return {
    idle: false,
    horizontalIdle: false,
    jumping: false,
    flying: false,
    walking: false,
    running: false,
    sprinting: false,
    crouching: false,
    forcedCrouching: false,
    falling: false,
    climbing: false,
    inFluid: false,
    swimming: false,
    swimJumping: false,
    onGround: false,
    mantling: false,
    sliding: false,
    mounting: false,
    rolling: false,
    sitting: false,
    gliding: false,
    sleeping: false,
    ...overrides
  };
}

export function readAsset(buffer: Buffer, offset: number): ReadResult<Asset> {
  const hash = readFixedAsciiString(buffer, offset, 64);
  const name = readVarString(buffer, offset + 64, "utf8");
  return { value: { hash, name: name.value }, bytesRead: 64 + name.bytesRead };
}

export function writeAsset(writer: BufferWriter, asset: Asset): void {
  writeFixedAsciiString(writer, asset.hash, 64);
  writeVarString(writer, asset.name, 512, "utf8");
}

export function readHostAddress(buffer: Buffer, offset: number): ReadResult<HostAddress> {
  const port = readInt16LE(buffer, offset);
  const host = readVarString(buffer, offset + 2, "utf8");
  return { value: { host: host.value, port }, bytesRead: 2 + host.bytesRead };
}

export function writeHostAddress(writer: BufferWriter, value: HostAddress): void {
  writer.writeInt16LE(value.port);
  writeVarString(writer, value.host, 256, "utf8");
}

export function readPosition(buffer: Buffer, offset: number): ReadResult<Position> {
  return {
    value: {
      x: readDoubleLE(buffer, offset),
      y: readDoubleLE(buffer, offset + 8),
      z: readDoubleLE(buffer, offset + 16)
    },
    bytesRead: 24
  };
}

export function writePosition(writer: BufferWriter, value: Position | null | undefined): void {
  if (!value) {
    writer.writeZero(24);
    return;
  }
  writer.writeDoubleLE(value.x);
  writer.writeDoubleLE(value.y);
  writer.writeDoubleLE(value.z);
}

export function readDirection(buffer: Buffer, offset: number): ReadResult<Direction> {
  return {
    value: {
      yaw: readFloatLE(buffer, offset),
      pitch: readFloatLE(buffer, offset + 4),
      roll: readFloatLE(buffer, offset + 8)
    },
    bytesRead: 12
  };
}

export function writeDirection(writer: BufferWriter, value: Direction | null | undefined): void {
  if (!value) {
    writer.writeZero(12);
    return;
  }
  writer.writeFloatLE(value.yaw);
  writer.writeFloatLE(value.pitch);
  writer.writeFloatLE(value.roll);
}

export function readTeleportAck(buffer: Buffer, offset: number): ReadResult<TeleportAck> {
  return { value: { teleportId: readUInt8(buffer, offset) }, bytesRead: 1 };
}

export function writeTeleportAck(writer: BufferWriter, value: TeleportAck | null | undefined): void {
  writer.writeUInt8(value?.teleportId ?? 0);
}

export function readInstantData(buffer: Buffer, offset: number): ReadResult<InstantData> {
  return {
    value: { seconds: readBigInt64LE(buffer, offset), nanos: readInt32LE(buffer, offset + 8) },
    bytesRead: 12
  };
}

export function writeInstantData(writer: BufferWriter, value: InstantData | null | undefined): void {
  if (!value) {
    writer.writeZero(12);
    return;
  }
  writer.writeBigInt64LE(value.seconds);
  writer.writeInt32LE(value.nanos);
}

export function readHalfFloatPosition(buffer: Buffer, offset: number): ReadResult<HalfFloatPosition> {
  return {
    value: {
      x: readInt16LE(buffer, offset),
      y: readInt16LE(buffer, offset + 2),
      z: readInt16LE(buffer, offset + 4)
    },
    bytesRead: 6
  };
}

export function writeHalfFloatPosition(writer: BufferWriter, value: HalfFloatPosition | null | undefined): void {
  if (!value) {
    writer.writeZero(6);
    return;
  }
  writer.writeInt16LE(value.x);
  writer.writeInt16LE(value.y);
  writer.writeInt16LE(value.z);
}

export function readVector3d(buffer: Buffer, offset: number): ReadResult<Vector3d> {
  return {
    value: {
      x: readDoubleLE(buffer, offset),
      y: readDoubleLE(buffer, offset + 8),
      z: readDoubleLE(buffer, offset + 16)
    },
    bytesRead: 24
  };
}

export function writeVector3d(writer: BufferWriter, value: Vector3d | null | undefined): void {
  if (!value) {
    writer.writeZero(24);
    return;
  }
  writer.writeDoubleLE(value.x);
  writer.writeDoubleLE(value.y);
  writer.writeDoubleLE(value.z);
}

export function readMovementStates(buffer: Buffer, offset: number): ReadResult<MovementStates> {
  const value = {} as Record<keyof MovementStates, boolean>;
  MOVEMENT_STATE_KEYS.forEach((key, index) => {
    value[key] = readBooleanByte(buffer, offset + index);
  });
  return { value: value as MovementStates, bytesRead: 22 };
}

export function writeMovementStates(writer: BufferWriter, value: MovementStates | null | undefined): void {
  const normalized = value ?? createDefaultMovementStates();
  MOVEMENT_STATE_KEYS.forEach((key) => writer.writeUInt8(normalized[key] ? 1 : 0));
}

export function readModelTransform(buffer: Buffer, offset: number): ReadResult<ModelTransform> {
  const nullBits = readUInt8(buffer, offset);
  return {
    value: {
      position: (nullBits & 1) !== 0 ? readPosition(buffer, offset + 1).value : null,
      bodyOrientation: (nullBits & 2) !== 0 ? readDirection(buffer, offset + 25).value : null,
      lookOrientation: (nullBits & 4) !== 0 ? readDirection(buffer, offset + 37).value : null
    },
    bytesRead: 49
  };
}

export function writeModelTransform(writer: BufferWriter, value: ModelTransform | null | undefined): void {
  const nullBits =
    (value?.position ? 1 : 0) |
    (value?.bodyOrientation ? 2 : 0) |
    (value?.lookOrientation ? 4 : 0);
  writer.writeUInt8(nullBits);
  writePosition(writer, value?.position);
  writeDirection(writer, value?.bodyOrientation);
  writeDirection(writer, value?.lookOrientation);
}
