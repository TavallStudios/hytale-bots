import { BufferWriter, type ReadResult, readBooleanByte, readInt32LE, readUInt8, readVarInt, readVarString, writeVarInt, writeVarString } from "../binary.js";
import { type CustomPageLifetime, readCustomPageLifetime, readCustomPageEventType, readCustomUiCommandType, readCustomUiEventBindingType, writeCustomPageEventType, writeCustomPageLifetime, writeCustomUiCommandType, writeCustomUiEventBindingType } from "../enums.js";
import type { CustomPageEventPacket, CustomPagePacket, CustomUICommand, CustomUIEventBinding } from "../types.js";

export function readCustomUiCommand(buffer: Buffer, offset: number): ReadResult<CustomUICommand> {
  const nullBits = readUInt8(buffer, offset);
  const variableBase = offset + 14;
  let maxEnd = 14;
  const value: CustomUICommand = { type: readCustomUiCommandType(readUInt8(buffer, offset + 1)) };
  if ((nullBits & 1) !== 0) {
    const fieldOffset = readInt32LE(buffer, offset + 2);
    const stringValue = readVarString(buffer, variableBase + fieldOffset, "utf8");
    maxEnd = Math.max(maxEnd, 14 + fieldOffset + stringValue.bytesRead);
    (value as { selector?: string }).selector = stringValue.value;
  }
  if ((nullBits & 2) !== 0) {
    const fieldOffset = readInt32LE(buffer, offset + 6);
    const stringValue = readVarString(buffer, variableBase + fieldOffset, "utf8");
    maxEnd = Math.max(maxEnd, 14 + fieldOffset + stringValue.bytesRead);
    (value as { data?: string }).data = stringValue.value;
  }
  if ((nullBits & 4) !== 0) {
    const fieldOffset = readInt32LE(buffer, offset + 10);
    const stringValue = readVarString(buffer, variableBase + fieldOffset, "utf8");
    maxEnd = Math.max(maxEnd, 14 + fieldOffset + stringValue.bytesRead);
    (value as { text?: string }).text = stringValue.value;
  }
  return { value, bytesRead: maxEnd };
}

export function writeCustomUiCommand(writer: BufferWriter, value: CustomUICommand): void {
  const nullBits = (value.selector != null ? 1 : 0) | (value.data != null ? 2 : 0) | (value.text != null ? 4 : 0);
  writer.writeUInt8(nullBits);
  writer.writeUInt8(writeCustomUiCommandType(value.type));
  const selectorOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const dataOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const textOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const variableBase = writer.offset;
  if (value.selector != null) {
    writer.setInt32LE(selectorOffsetSlot, writer.offset - variableBase);
    writeVarString(writer, value.selector, 4_096_000);
  } else {
    writer.setInt32LE(selectorOffsetSlot, -1);
  }
  if (value.data != null) {
    writer.setInt32LE(dataOffsetSlot, writer.offset - variableBase);
    writeVarString(writer, value.data, 4_096_000);
  } else {
    writer.setInt32LE(dataOffsetSlot, -1);
  }
  if (value.text != null) {
    writer.setInt32LE(textOffsetSlot, writer.offset - variableBase);
    writeVarString(writer, value.text, 4_096_000);
  } else {
    writer.setInt32LE(textOffsetSlot, -1);
  }
}

export function readCustomUiEventBinding(buffer: Buffer, offset: number): ReadResult<CustomUIEventBinding> {
  const nullBits = readUInt8(buffer, offset);
  const variableBase = offset + 11;
  let maxEnd = 11;
  const value: CustomUIEventBinding = {
    type: readCustomUiEventBindingType(readUInt8(buffer, offset + 1)),
    locksInterface: readBooleanByte(buffer, offset + 2)
  };
  if ((nullBits & 1) !== 0) {
    const fieldOffset = readInt32LE(buffer, offset + 3);
    const stringValue = readVarString(buffer, variableBase + fieldOffset, "utf8");
    maxEnd = Math.max(maxEnd, 11 + fieldOffset + stringValue.bytesRead);
    (value as { selector?: string }).selector = stringValue.value;
  }
  if ((nullBits & 2) !== 0) {
    const fieldOffset = readInt32LE(buffer, offset + 7);
    const stringValue = readVarString(buffer, variableBase + fieldOffset, "utf8");
    maxEnd = Math.max(maxEnd, 11 + fieldOffset + stringValue.bytesRead);
    (value as { data?: string }).data = stringValue.value;
  }
  return { value, bytesRead: maxEnd };
}

export function writeCustomUiEventBinding(writer: BufferWriter, value: CustomUIEventBinding): void {
  const nullBits = (value.selector != null ? 1 : 0) | (value.data != null ? 2 : 0);
  writer.writeUInt8(nullBits);
  writer.writeUInt8(writeCustomUiEventBindingType(value.type));
  writer.writeUInt8(value.locksInterface ? 1 : 0);
  const selectorOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const dataOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const variableBase = writer.offset;
  if (value.selector != null) {
    writer.setInt32LE(selectorOffsetSlot, writer.offset - variableBase);
    writeVarString(writer, value.selector, 4_096_000);
  } else {
    writer.setInt32LE(selectorOffsetSlot, -1);
  }
  if (value.data != null) {
    writer.setInt32LE(dataOffsetSlot, writer.offset - variableBase);
    writeVarString(writer, value.data, 4_096_000);
  } else {
    writer.setInt32LE(dataOffsetSlot, -1);
  }
}

export function decodeCustomPagePacket(buffer: Buffer): CustomPagePacket {
  const nullBits = readUInt8(buffer, 0);
  const variableBase = 16;
  let key: string | null = null;
  let commands: CustomUICommand[] | null = null;
  let eventBindings: CustomUIEventBinding[] | null = null;
  if ((nullBits & 1) !== 0) {
    key = readVarString(buffer, variableBase + readInt32LE(buffer, 4), "utf8").value;
  }
  if ((nullBits & 2) !== 0) {
    const start = variableBase + readInt32LE(buffer, 8);
    const count = readVarInt(buffer, start);
    let cursor = start + count.bytesRead;
    commands = [];
    for (let index = 0; index < count.value; index += 1) {
      const command = readCustomUiCommand(buffer, cursor);
      commands.push(command.value);
      cursor += command.bytesRead;
    }
  }
  if ((nullBits & 4) !== 0) {
    const start = variableBase + readInt32LE(buffer, 12);
    const count = readVarInt(buffer, start);
    let cursor = start + count.bytesRead;
    eventBindings = [];
    for (let index = 0; index < count.value; index += 1) {
      const binding = readCustomUiEventBinding(buffer, cursor);
      eventBindings.push(binding.value);
      cursor += binding.bytesRead;
    }
  }
  return {
    name: "CustomPage",
    key,
    isInitial: readBooleanByte(buffer, 1),
    clear: readBooleanByte(buffer, 2),
    lifetime: readCustomPageLifetime(readUInt8(buffer, 3)),
    commands,
    eventBindings
  };
}

export function encodeCustomPagePacket(packet: CustomPagePacket): Buffer {
  const writer = new BufferWriter(256);
  const nullBits = (packet.key != null ? 1 : 0) | (packet.commands != null ? 2 : 0) | (packet.eventBindings != null ? 4 : 0);
  writer.writeUInt8(nullBits);
  writer.writeUInt8(packet.isInitial ? 1 : 0);
  writer.writeUInt8(packet.clear ? 1 : 0);
  writer.writeUInt8(writeCustomPageLifetime(packet.lifetime));
  const keyOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const commandsOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const bindingsOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const variableBase = writer.offset;
  if (packet.key != null) {
    writer.setInt32LE(keyOffsetSlot, writer.offset - variableBase);
    writeVarString(writer, packet.key, 4_096_000);
  } else {
    writer.setInt32LE(keyOffsetSlot, -1);
  }
  if (packet.commands != null) {
    writer.setInt32LE(commandsOffsetSlot, writer.offset - variableBase);
    writeVarInt(writer, packet.commands.length);
    packet.commands.forEach((command) => writeCustomUiCommand(writer, command));
  } else {
    writer.setInt32LE(commandsOffsetSlot, -1);
  }
  if (packet.eventBindings != null) {
    writer.setInt32LE(bindingsOffsetSlot, writer.offset - variableBase);
    writeVarInt(writer, packet.eventBindings.length);
    packet.eventBindings.forEach((binding) => writeCustomUiEventBinding(writer, binding));
  } else {
    writer.setInt32LE(bindingsOffsetSlot, -1);
  }
  return writer.toBuffer();
}

export function decodeCustomPageEventPacket(buffer: Buffer): CustomPageEventPacket {
  return {
    name: "CustomPageEvent",
    type: readCustomPageEventType(readUInt8(buffer, 1)),
    data: (readUInt8(buffer, 0) & 1) !== 0 ? readVarString(buffer, 2, "utf8").value : null
  };
}

export function encodeCustomPageEventPacket(packet: CustomPageEventPacket): Buffer {
  const writer = new BufferWriter(64);
  writer.writeUInt8(packet.data != null ? 1 : 0);
  writer.writeUInt8(writeCustomPageEventType(packet.type));
  if (packet.data != null) {
    writeVarString(writer, packet.data, 4_096_000);
  }
  return writer.toBuffer();
}

function normalizeCustomUiSelector(selector: string): string {
  return selector.replace(/#HYUUID([A-Za-z_][A-Za-z0-9_]*?)(\d+)(?=[\s.#:[>]|$)/g, "#$1");
}

export function snapshotCustomPage(page: CustomPagePacket): {
  readonly key: string | null;
  readonly isInitial: boolean;
  readonly clear: boolean;
  readonly lifetime: CustomPageLifetime;
  readonly commands: readonly CustomUICommand[];
  readonly eventBindings: readonly CustomUIEventBinding[];
  readonly selectors: readonly string[];
} {
  const commands = [...(page.commands ?? [])].map((command) => (
    command.selector ? { ...command, selector: normalizeCustomUiSelector(command.selector) } : command
  ));
  const eventBindings = [...(page.eventBindings ?? [])].map((binding) => (
    binding.selector ? { ...binding, selector: normalizeCustomUiSelector(binding.selector) } : binding
  ));
  const selectors = Array.from(
    new Set(
      [...commands.map((command) => command.selector), ...eventBindings.map((binding) => binding.selector)]
        .filter((value): value is string => Boolean(value))
    )
  );
  return {
    key: page.key ?? null,
    isInitial: page.isInitial,
    clear: page.clear,
    lifetime: page.lifetime,
    commands,
    eventBindings,
    selectors
  };
}
