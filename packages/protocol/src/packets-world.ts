import {
  type ReadResult,
  readBooleanByte,
  readDoubleLE,
  readFloatLE,
  readInt16LE,
  readInt32LE,
  readUInt8,
  readVarInt,
  readVarString
} from "./binary.js";
import {
  readCalculationType,
  readEntityPart,
  readEntityStatOp,
  readEntityStatResetBehavior,
  readModifierTarget,
  readSortType,
  readUpdateType
} from "./enums.js";
import { ProtocolError } from "./errors.js";
import {
  readColor,
  readDirection,
  readModelTransform,
  readMovementStates,
  readVector3f
} from "./model/primitives.js";
import type {
  ComponentUpdate,
  EntityStatEffects,
  EntityStatType,
  EntityStatUpdate,
  EntityStatsUpdateComponent,
  EntityUpdate,
  EntityUpdatesPacket,
  InventorySection,
  ItemWithAllMetadata,
  ModelParticle,
  Modifier,
  UpdateEntityStatTypesPacket,
  UpdatePlayerInventoryPacket
} from "./types.js";

const MAX_COLLECTION = 4_096_000;
const MAX_STAT_UPDATES = 64;
const MAX_COMPONENT_BYTES = 512 * 1024;

function assertCollectionSize(label: string, count: number, limit = MAX_COLLECTION): void {
  if (count < 0) {
    throw new ProtocolError(`${label} length cannot be negative: ${count}`);
  }
  if (count > limit) {
    throw new ProtocolError(`${label} exceeds max length ${limit}: ${count}`);
  }
}

function readModifier(buffer: Buffer, offset: number): ReadResult<Modifier> {
  return {
    value: {
      target: readModifierTarget(readUInt8(buffer, offset)),
      calculationType: readCalculationType(readUInt8(buffer, offset + 1)),
      amount: readFloatLE(buffer, offset + 2)
    },
    bytesRead: 6
  };
}

function readEntityStatUpdate(buffer: Buffer, offset: number): ReadResult<EntityStatUpdate> {
  const nullBits = readUInt8(buffer, offset);
  const op = readEntityStatOp(readUInt8(buffer, offset + 1));
  const predictable = readBooleanByte(buffer, offset + 2);
  const value = readFloatLE(buffer, offset + 3);
  let modifier: Modifier | null = null;
  if ((nullBits & 1) !== 0) {
    modifier = readModifier(buffer, offset + 7).value;
  }

  let modifiers: Record<string, Modifier> | null = null;
  let modifierKey: string | null = null;
  let maxEnd = 21;
  if ((nullBits & 2) !== 0) {
    const varPos = offset + 21 + readInt32LE(buffer, offset + 13);
    const count = readVarInt(buffer, varPos);
    assertCollectionSize("EntityStatUpdate.modifiers", count.value);
    let cursor = varPos + count.bytesRead;
    modifiers = {};
    for (let i = 0; i < count.value; i += 1) {
      const keyResult = readVarString(buffer, cursor, "utf8");
      cursor += keyResult.bytesRead;
      const modifierResult = readModifier(buffer, cursor);
      cursor += modifierResult.bytesRead;
      modifiers[keyResult.value] = modifierResult.value;
    }
    maxEnd = Math.max(maxEnd, cursor - offset);
  }

  if ((nullBits & 4) !== 0) {
    const varPos = offset + 21 + readInt32LE(buffer, offset + 17);
    const keyResult = readVarString(buffer, varPos, "utf8");
    modifierKey = keyResult.value;
    maxEnd = Math.max(maxEnd, varPos + keyResult.bytesRead - offset);
  }

  return {
    value: {
      op,
      predictable,
      value,
      modifiers,
      modifierKey,
      modifier
    },
    bytesRead: maxEnd
  };
}

function readEntityStatsUpdate(buffer: Buffer, offset: number): ReadResult<EntityStatsUpdateComponent> {
  let cursor = offset;
  const count = readVarInt(buffer, cursor);
  assertCollectionSize("EntityStatsUpdate.entityStatUpdates", count.value);
  cursor += count.bytesRead;
  const updates: Record<number, EntityStatUpdate[]> = {};
  for (let i = 0; i < count.value; i += 1) {
    const key = readInt32LE(buffer, cursor);
    cursor += 4;
    const valueCount = readVarInt(buffer, cursor);
    assertCollectionSize("EntityStatsUpdate.entityStatUpdates.value", valueCount.value, MAX_STAT_UPDATES);
    cursor += valueCount.bytesRead;
    const values: EntityStatUpdate[] = [];
    for (let j = 0; j < valueCount.value; j += 1) {
      const update = readEntityStatUpdate(buffer, cursor);
      values.push(update.value);
      cursor += update.bytesRead;
    }
    updates[key] = values;
  }

  return {
    value: {
      kind: "EntityStats",
      entityStatUpdates: updates
    },
    bytesRead: cursor - offset
  };
}

function readModelParticle(buffer: Buffer, offset: number): ReadResult<ModelParticle> {
  const nullBits = readUInt8(buffer, offset);
  const scale = readFloatLE(buffer, offset + 1);
  const color = (nullBits & 1) !== 0 ? readColor(buffer, offset + 5).value : null;
  const targetEntityPart = readEntityPart(readUInt8(buffer, offset + 8));
  const positionOffset = (nullBits & 2) !== 0 ? readVector3f(buffer, offset + 9).value : null;
  const rotationOffset = (nullBits & 4) !== 0 ? readDirection(buffer, offset + 21).value : null;
  const detachedFromModel = readBooleanByte(buffer, offset + 33);

  let maxEnd = 42;
  let systemId: string | null = null;
  let targetNodeName: string | null = null;
  if ((nullBits & 8) !== 0) {
    const varPos = offset + 42 + readInt32LE(buffer, offset + 34);
    const systemIdResult = readVarString(buffer, varPos, "utf8");
    systemId = systemIdResult.value;
    maxEnd = Math.max(maxEnd, varPos + systemIdResult.bytesRead - offset);
  }
  if ((nullBits & 16) !== 0) {
    const varPos = offset + 42 + readInt32LE(buffer, offset + 38);
    const targetNodeResult = readVarString(buffer, varPos, "utf8");
    targetNodeName = targetNodeResult.value;
    maxEnd = Math.max(maxEnd, varPos + targetNodeResult.bytesRead - offset);
  }

  return {
    value: {
      systemId,
      scale,
      color,
      targetEntityPart,
      targetNodeName,
      positionOffset,
      rotationOffset,
      detachedFromModel
    },
    bytesRead: maxEnd
  };
}

function readEntityStatEffects(buffer: Buffer, offset: number): ReadResult<EntityStatEffects> {
  const nullBits = readUInt8(buffer, offset);
  const triggerAtZero = readBooleanByte(buffer, offset + 1);
  const soundEventIndex = readInt32LE(buffer, offset + 2);
  let particles: ModelParticle[] | null = null;
  let cursor = offset + 6;
  if ((nullBits & 1) !== 0) {
    const count = readVarInt(buffer, cursor);
    assertCollectionSize("EntityStatEffects.particles", count.value);
    cursor += count.bytesRead;
    particles = [];
    for (let i = 0; i < count.value; i += 1) {
      const particle = readModelParticle(buffer, cursor);
      particles.push(particle.value);
      cursor += particle.bytesRead;
    }
  }
  return {
    value: {
      triggerAtZero,
      soundEventIndex,
      particles
    },
    bytesRead: cursor - offset
  };
}

function readEntityStatType(buffer: Buffer, offset: number): ReadResult<EntityStatType> {
  const nullBits = readUInt8(buffer, offset);
  const value = readFloatLE(buffer, offset + 1);
  const min = readFloatLE(buffer, offset + 5);
  const max = readFloatLE(buffer, offset + 9);
  const resetBehavior = readEntityStatResetBehavior(readUInt8(buffer, offset + 13));
  const hideFromTooltip = readBooleanByte(buffer, offset + 14);

  let id: string | null = null;
  let minValueEffects: EntityStatEffects | null = null;
  let maxValueEffects: EntityStatEffects | null = null;
  let maxEnd = 27;
  if ((nullBits & 1) !== 0) {
    const varPos = offset + 27 + readInt32LE(buffer, offset + 15);
    const idResult = readVarString(buffer, varPos, "utf8");
    id = idResult.value;
    maxEnd = Math.max(maxEnd, varPos + idResult.bytesRead - offset);
  }
  if ((nullBits & 2) !== 0) {
    const varPos = offset + 27 + readInt32LE(buffer, offset + 19);
    const effectsResult = readEntityStatEffects(buffer, varPos);
    minValueEffects = effectsResult.value;
    maxEnd = Math.max(maxEnd, varPos + effectsResult.bytesRead - offset);
  }
  if ((nullBits & 4) !== 0) {
    const varPos = offset + 27 + readInt32LE(buffer, offset + 23);
    const effectsResult = readEntityStatEffects(buffer, varPos);
    maxValueEffects = effectsResult.value;
    maxEnd = Math.max(maxEnd, varPos + effectsResult.bytesRead - offset);
  }

  return {
    value: {
      id,
      value,
      min,
      max,
      minValueEffects,
      maxValueEffects,
      resetBehavior,
      hideFromTooltip
    },
    bytesRead: maxEnd
  };
}

function readItemWithAllMetadata(buffer: Buffer, offset: number): ReadResult<ItemWithAllMetadata> {
  const nullBits = readUInt8(buffer, offset);
  const quantity = readInt32LE(buffer, offset + 1);
  const durability = readDoubleLE(buffer, offset + 5);
  const maxDurability = readDoubleLE(buffer, offset + 13);
  const overrideDroppedItemAnimation = readBooleanByte(buffer, offset + 21);
  const variableBase = offset + 30;

  const itemIdPos = variableBase + readInt32LE(buffer, offset + 22);
  const itemIdResult = readVarString(buffer, itemIdPos, "utf8");
  let metadata: string | null = null;
  let maxEnd = itemIdPos + itemIdResult.bytesRead - offset;
  if ((nullBits & 1) !== 0) {
    const metadataPos = variableBase + readInt32LE(buffer, offset + 26);
    const metadataResult = readVarString(buffer, metadataPos, "utf8");
    metadata = metadataResult.value;
    maxEnd = Math.max(maxEnd, metadataPos + metadataResult.bytesRead - offset);
  }

  return {
    value: {
      itemId: itemIdResult.value,
      quantity,
      durability,
      maxDurability,
      overrideDroppedItemAnimation,
      metadata
    },
    bytesRead: Math.max(maxEnd, 30)
  };
}

function readInventorySection(buffer: Buffer, offset: number): ReadResult<InventorySection> {
  const nullBits = readUInt8(buffer, offset);
  const capacity = readInt16LE(buffer, offset + 1);
  let cursor = offset + 3;
  let items: Record<number, ItemWithAllMetadata> | null = null;
  if ((nullBits & 1) !== 0) {
    const count = readVarInt(buffer, cursor);
    assertCollectionSize("InventorySection.items", count.value);
    cursor += count.bytesRead;
    items = {};
    for (let i = 0; i < count.value; i += 1) {
      const key = readInt32LE(buffer, cursor);
      cursor += 4;
      const item = readItemWithAllMetadata(buffer, cursor);
      cursor += item.bytesRead;
      items[key] = item.value;
    }
  }
  return {
    value: {
      items,
      capacity
    },
    bytesRead: cursor - offset
  };
}

function readComponentUpdate(buffer: Buffer, offset: number): { value: ComponentUpdate | null; bytesRead: number; partial: boolean; partialReason?: string } {
  const typeIdResult = readVarInt(buffer, offset);
  const cursor = offset + typeIdResult.bytesRead;
  switch (typeIdResult.value) {
    case 8: {
      const statsUpdate = readEntityStatsUpdate(buffer, cursor);
      return { value: statsUpdate.value, bytesRead: typeIdResult.bytesRead + statsUpdate.bytesRead, partial: false };
    }
    case 9: {
      const transform = readModelTransform(buffer, cursor);
      return {
        value: { kind: "Transform", transform: transform.value },
        bytesRead: typeIdResult.bytesRead + transform.bytesRead,
        partial: false
      };
    }
    case 10: {
      const movement = readMovementStates(buffer, cursor);
      return {
        value: { kind: "MovementStates", movementStates: movement.value },
        bytesRead: typeIdResult.bytesRead + movement.bytesRead,
        partial: false
      };
    }
    default:
      {
        const lengthResult = readVarInt(buffer, cursor);
        const remaining = buffer.length - (cursor + lengthResult.bytesRead);
        const nextOffset = cursor + lengthResult.bytesRead + lengthResult.value;
        const lengthOk = lengthResult.value >= 0 && lengthResult.value <= remaining && lengthResult.value <= MAX_COMPONENT_BYTES;
        let nextLooksPlausible = true;
        if (lengthOk && nextOffset < buffer.length) {
          const peek = readVarInt(buffer, nextOffset);
          nextLooksPlausible = peek.value >= 0 && peek.value <= 64;
        }
        if (lengthOk && nextLooksPlausible) {
          return {
            value: null,
            bytesRead: typeIdResult.bytesRead + lengthResult.bytesRead + lengthResult.value,
            partial: false
          };
        }
        return {
          value: null,
          bytesRead: 0,
          partial: true,
          partialReason: `Unsupported ComponentUpdate type ${typeIdResult.value}`
        };
      }
  }
}

function readEntityUpdate(buffer: Buffer, offset: number): { value: EntityUpdate; bytesRead: number; partial: boolean; partialReason?: string } {
  const nullBits = readUInt8(buffer, offset);
  const networkId = readInt32LE(buffer, offset + 1);
  const variableBase = offset + 13;

  let removed: number[] | null = null;
  let maxEnd = 13;
  if ((nullBits & 1) !== 0) {
    const start = variableBase + readInt32LE(buffer, offset + 5);
    const count = readVarInt(buffer, start);
    assertCollectionSize("EntityUpdate.removed", count.value);
    const cursor = start + count.bytesRead;
    removed = [];
    for (let i = 0; i < count.value; i += 1) {
      removed.push(readUInt8(buffer, cursor + i));
    }
    maxEnd = Math.max(maxEnd, cursor + count.value - offset);
  }

  let updates: ComponentUpdate[] | null = null;
  if ((nullBits & 2) !== 0) {
    const start = variableBase + readInt32LE(buffer, offset + 9);
    const count = readVarInt(buffer, start);
    assertCollectionSize("EntityUpdate.updates", count.value);
    let cursor = start + count.bytesRead;
    updates = [];
    for (let i = 0; i < count.value; i += 1) {
      const component = readComponentUpdate(buffer, cursor);
      if (component.partial) {
        return {
          value: { networkId, removed, updates },
          bytesRead: buffer.length - offset,
          partial: true,
          partialReason: component.partialReason
        };
      }
      if (component.value) {
        updates.push(component.value);
      }
      cursor += component.bytesRead;
    }
    maxEnd = Math.max(maxEnd, cursor - offset);
  }

  return {
    value: { networkId, removed, updates },
    bytesRead: maxEnd,
    partial: false
  };
}

export function decodeEntityUpdatesPacket(buffer: Buffer): EntityUpdatesPacket {
  const nullBits = readUInt8(buffer, 0);
  const variableBase = 9;
  let removed: number[] | null = null;
  if ((nullBits & 1) !== 0) {
    const start = variableBase + readInt32LE(buffer, 1);
    const count = readVarInt(buffer, start);
    assertCollectionSize("EntityUpdates.removed", count.value);
    const cursor = start + count.bytesRead;
    removed = [];
    for (let i = 0; i < count.value; i += 1) {
      removed.push(readInt32LE(buffer, cursor + i * 4));
    }
  }

  let updates: EntityUpdate[] | null = null;
  let partial = false;
  let partialReason: string | null = null;
  if ((nullBits & 2) !== 0) {
    const start = variableBase + readInt32LE(buffer, 5);
    const count = readVarInt(buffer, start);
    assertCollectionSize("EntityUpdates.updates", count.value);
    let cursor = start + count.bytesRead;
    updates = [];
    for (let i = 0; i < count.value; i += 1) {
      const entity = readEntityUpdate(buffer, cursor);
      updates.push(entity.value);
      cursor += entity.bytesRead;
      if (entity.partial) {
        partial = true;
        partialReason = entity.partialReason ?? null;
        break;
      }
    }
  }

  return {
    name: "EntityUpdates",
    removed,
    updates,
    partial: partial || undefined,
    partialReason: partial ? partialReason : null
  };
}

export function decodeUpdateEntityStatTypesPacket(buffer: Buffer): UpdateEntityStatTypesPacket {
  const nullBits = readUInt8(buffer, 0);
  const type = readUpdateType(readUInt8(buffer, 1));
  const maxId = readInt32LE(buffer, 2);
  let types: Record<number, EntityStatType> | null = null;
  let cursor = 6;
  if ((nullBits & 1) !== 0) {
    const count = readVarInt(buffer, cursor);
    assertCollectionSize("UpdateEntityStatTypes.types", count.value);
    cursor += count.bytesRead;
    types = {};
    for (let i = 0; i < count.value; i += 1) {
      const key = readInt32LE(buffer, cursor);
      cursor += 4;
      const typeResult = readEntityStatType(buffer, cursor);
      cursor += typeResult.bytesRead;
      types[key] = typeResult.value;
    }
  }

  return {
    name: "UpdateEntityStatTypes",
    type,
    maxId,
    types
  };
}

export function decodeUpdatePlayerInventoryPacket(buffer: Buffer): UpdatePlayerInventoryPacket {
  const nullBits = readUInt8(buffer, 0);
  const sortType = readSortType(readUInt8(buffer, 1));
  const variableBase = 30;

  const readSection = (mask: number, offsetSlot: number): InventorySection | null => {
    if ((nullBits & mask) === 0) {
      return null;
    }
    const start = variableBase + readInt32LE(buffer, offsetSlot);
    return readInventorySection(buffer, start).value;
  };

  return {
    name: "UpdatePlayerInventory",
    sortType,
    storage: readSection(1, 2),
    armor: readSection(2, 6),
    hotbar: readSection(4, 10),
    utility: readSection(8, 14),
    builderMaterial: readSection(16, 18),
    tools: readSection(32, 22),
    backpack: readSection(64, 26)
  };
}
