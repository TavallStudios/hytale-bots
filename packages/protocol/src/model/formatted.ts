import { BufferWriter, type ReadResult, readBigInt64LE, readBooleanByte, readDoubleLE, readInt32LE, readUInt8, readVarInt, readVarString, writeVarInt, writeVarString } from "../binary.js";
import { readMaybeBool, writeMaybeBool } from "../enums.js";
import { ProtocolError } from "../errors.js";
import type { FormattedMessage, ParamValue } from "../types.js";

export function readParamValue(buffer: Buffer, offset: number): ReadResult<ParamValue> {
  const typeId = readVarInt(buffer, offset);
  const start = offset + typeId.bytesRead;
  switch (typeId.value) {
    case 0: {
      const nullBits = readUInt8(buffer, start);
      if ((nullBits & 1) === 0) {
        return { value: { kind: "string", value: null }, bytesRead: typeId.bytesRead + 1 };
      }
      const value = readVarString(buffer, start + 1, "utf8");
      return { value: { kind: "string", value: value.value }, bytesRead: typeId.bytesRead + 1 + value.bytesRead };
    }
    case 1:
      return { value: { kind: "bool", value: readBooleanByte(buffer, start) }, bytesRead: typeId.bytesRead + 1 };
    case 2:
      return { value: { kind: "double", value: readDoubleLE(buffer, start) }, bytesRead: typeId.bytesRead + 8 };
    case 3:
      return { value: { kind: "int", value: readInt32LE(buffer, start) }, bytesRead: typeId.bytesRead + 4 };
    case 4:
      return { value: { kind: "long", value: readBigInt64LE(buffer, start) }, bytesRead: typeId.bytesRead + 8 };
    default:
      throw new ProtocolError(`Unknown polymorphic type ID ${typeId.value} for ParamValue`);
  }
}

export function writeParamValue(writer: BufferWriter, value: ParamValue): void {
  switch (value.kind) {
    case "string":
      writeVarInt(writer, 0);
      writer.writeUInt8(value.value == null ? 0 : 1);
      if (value.value != null) {
        writeVarString(writer, value.value, 4_096_000);
      }
      return;
    case "bool":
      writeVarInt(writer, 1);
      writer.writeUInt8(value.value ? 1 : 0);
      return;
    case "double":
      writeVarInt(writer, 2);
      writer.writeDoubleLE(value.value);
      return;
    case "int":
      writeVarInt(writer, 3);
      writer.writeInt32LE(value.value);
      return;
    case "long":
      writeVarInt(writer, 4);
      writer.writeBigInt64LE(value.value);
  }
}

export function readFormattedMessage(buffer: Buffer, offset: number): ReadResult<FormattedMessage> {
  const nullBits = readUInt8(buffer, offset);
  const variableBase = offset + 34;
  let maxEnd = 34;
  const message: FormattedMessage = {
    bold: readMaybeBool(readUInt8(buffer, offset + 1)),
    italic: readMaybeBool(readUInt8(buffer, offset + 2)),
    monospace: readMaybeBool(readUInt8(buffer, offset + 3)),
    underlined: readMaybeBool(readUInt8(buffer, offset + 4)),
    markupEnabled: readBooleanByte(buffer, offset + 5)
  };

  if ((nullBits & 1) !== 0) {
    const fieldOffset = readInt32LE(buffer, offset + 6);
    const value = readVarString(buffer, variableBase + fieldOffset, "utf8");
    maxEnd = Math.max(maxEnd, 34 + fieldOffset + value.bytesRead);
    (message as { rawText?: string }).rawText = value.value;
  }
  if ((nullBits & 2) !== 0) {
    const fieldOffset = readInt32LE(buffer, offset + 10);
    const value = readVarString(buffer, variableBase + fieldOffset, "utf8");
    maxEnd = Math.max(maxEnd, 34 + fieldOffset + value.bytesRead);
    (message as { messageId?: string }).messageId = value.value;
  }
  if ((nullBits & 4) !== 0) {
    const fieldOffset = readInt32LE(buffer, offset + 14);
    const count = readVarInt(buffer, variableBase + fieldOffset);
    let cursor = variableBase + fieldOffset + count.bytesRead;
    const children: FormattedMessage[] = [];
    for (let index = 0; index < count.value; index += 1) {
      const child = readFormattedMessage(buffer, cursor);
      children.push(child.value);
      cursor += child.bytesRead;
    }
    maxEnd = Math.max(maxEnd, cursor - offset);
    (message as { children?: FormattedMessage[] }).children = children;
  }
  if ((nullBits & 8) !== 0) {
    const fieldOffset = readInt32LE(buffer, offset + 18);
    const count = readVarInt(buffer, variableBase + fieldOffset);
    let cursor = variableBase + fieldOffset + count.bytesRead;
    const params: Record<string, ParamValue> = {};
    for (let index = 0; index < count.value; index += 1) {
      const key = readVarString(buffer, cursor, "utf8");
      cursor += key.bytesRead;
      const value = readParamValue(buffer, cursor);
      cursor += value.bytesRead;
      params[key.value] = value.value;
    }
    maxEnd = Math.max(maxEnd, cursor - offset);
    (message as { params?: Record<string, ParamValue> }).params = params;
  }
  if ((nullBits & 16) !== 0) {
    const fieldOffset = readInt32LE(buffer, offset + 22);
    const count = readVarInt(buffer, variableBase + fieldOffset);
    let cursor = variableBase + fieldOffset + count.bytesRead;
    const params: Record<string, FormattedMessage> = {};
    for (let index = 0; index < count.value; index += 1) {
      const key = readVarString(buffer, cursor, "utf8");
      cursor += key.bytesRead;
      const value = readFormattedMessage(buffer, cursor);
      cursor += value.bytesRead;
      params[key.value] = value.value;
    }
    maxEnd = Math.max(maxEnd, cursor - offset);
    (message as { messageParams?: Record<string, FormattedMessage> }).messageParams = params;
  }
  if ((nullBits & 32) !== 0) {
    const fieldOffset = readInt32LE(buffer, offset + 26);
    const value = readVarString(buffer, variableBase + fieldOffset, "utf8");
    maxEnd = Math.max(maxEnd, 34 + fieldOffset + value.bytesRead);
    (message as { color?: string }).color = value.value;
  }
  if ((nullBits & 64) !== 0) {
    const fieldOffset = readInt32LE(buffer, offset + 30);
    const value = readVarString(buffer, variableBase + fieldOffset, "utf8");
    maxEnd = Math.max(maxEnd, 34 + fieldOffset + value.bytesRead);
    (message as { link?: string }).link = value.value;
  }
  return { value: message, bytesRead: maxEnd };
}

export function writeFormattedMessage(writer: BufferWriter, value: FormattedMessage): void {
  const nullBits =
    (value.rawText != null ? 1 : 0) |
    (value.messageId != null ? 2 : 0) |
    (value.children != null ? 4 : 0) |
    (value.params != null ? 8 : 0) |
    (value.messageParams != null ? 16 : 0) |
    (value.color != null ? 32 : 0) |
    (value.link != null ? 64 : 0);
  writer.writeUInt8(nullBits);
  writer.writeUInt8(writeMaybeBool(value.bold ?? "Null"));
  writer.writeUInt8(writeMaybeBool(value.italic ?? "Null"));
  writer.writeUInt8(writeMaybeBool(value.monospace ?? "Null"));
  writer.writeUInt8(writeMaybeBool(value.underlined ?? "Null"));
  writer.writeUInt8(value.markupEnabled ? 1 : 0);

  const rawTextOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const messageIdOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const childrenOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const paramsOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const messageParamsOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const colorOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const linkOffsetSlot = writer.offset;
  writer.writeInt32LE(0);
  const variableBase = writer.offset;

  if (value.rawText != null) {
    writer.setInt32LE(rawTextOffsetSlot, writer.offset - variableBase);
    writeVarString(writer, value.rawText, 4_096_000);
  } else {
    writer.setInt32LE(rawTextOffsetSlot, -1);
  }
  if (value.messageId != null) {
    writer.setInt32LE(messageIdOffsetSlot, writer.offset - variableBase);
    writeVarString(writer, value.messageId, 4_096_000);
  } else {
    writer.setInt32LE(messageIdOffsetSlot, -1);
  }
  if (value.children != null) {
    writer.setInt32LE(childrenOffsetSlot, writer.offset - variableBase);
    writeVarInt(writer, value.children.length);
    value.children.forEach((child) => writeFormattedMessage(writer, child));
  } else {
    writer.setInt32LE(childrenOffsetSlot, -1);
  }
  if (value.params != null) {
    const entries = Object.entries(value.params);
    writer.setInt32LE(paramsOffsetSlot, writer.offset - variableBase);
    writeVarInt(writer, entries.length);
    entries.forEach(([key, param]) => {
      writeVarString(writer, key, 4_096_000);
      writeParamValue(writer, param);
    });
  } else {
    writer.setInt32LE(paramsOffsetSlot, -1);
  }
  if (value.messageParams != null) {
    const entries = Object.entries(value.messageParams);
    writer.setInt32LE(messageParamsOffsetSlot, writer.offset - variableBase);
    writeVarInt(writer, entries.length);
    entries.forEach(([key, child]) => {
      writeVarString(writer, key, 4_096_000);
      writeFormattedMessage(writer, child);
    });
  } else {
    writer.setInt32LE(messageParamsOffsetSlot, -1);
  }
  if (value.color != null) {
    writer.setInt32LE(colorOffsetSlot, writer.offset - variableBase);
    writeVarString(writer, value.color, 4_096_000);
  } else {
    writer.setInt32LE(colorOffsetSlot, -1);
  }
  if (value.link != null) {
    writer.setInt32LE(linkOffsetSlot, writer.offset - variableBase);
    writeVarString(writer, value.link, 4_096_000);
  } else {
    writer.setInt32LE(linkOffsetSlot, -1);
  }
}

export function formattedMessageToPlainText(message: FormattedMessage | null | undefined): string {
  if (!message) {
    return "";
  }
  const parts: string[] = [];
  const append = (current: FormattedMessage): void => {
    if (current.rawText && current.rawText.trim().length > 0) {
      parts.push(current.rawText.trim());
    } else if (current.messageId && current.messageId.trim().length > 0) {
      parts.push(current.messageId.trim());
    }
    current.children?.forEach((child) => append(child));
  };
  append(message);
  return parts.join(" ").trim();
}
