import packetRegistryJson from "../generated/packet-registry.json" with { type: "json" };
import { ProtocolError } from "./errors.js";

export type RegistryDirection = "ToServer" | "ToClient" | "Both";
export type WireDirection = "toServer" | "toClient";

export interface PacketRegistryEntry {
  readonly id: number;
  readonly name: string;
  readonly direction: RegistryDirection;
  readonly channel: string;
  readonly type: string;
  readonly fixedBlockSize: number;
  readonly maxSize: number;
  readonly compressed: boolean;
}

const REGISTRY = packetRegistryJson as PacketRegistryEntry[];
const REGISTRY_BY_ID = new Map<number, PacketRegistryEntry>(REGISTRY.map((entry) => [entry.id, entry]));
const REGISTRY_BY_NAME = new Map<string, PacketRegistryEntry>(REGISTRY.map((entry) => [entry.name, entry]));

export function getPacketRegistry(): readonly PacketRegistryEntry[] {
  return REGISTRY;
}

export function getPacketRegistryEntryById(id: number): PacketRegistryEntry | undefined {
  return REGISTRY_BY_ID.get(id);
}

export function getPacketRegistryEntryByName(name: string): PacketRegistryEntry | undefined {
  return REGISTRY_BY_NAME.get(name);
}

export function assertPacketDirection(entry: PacketRegistryEntry, direction: WireDirection): void {
  if (entry.direction === "Both") {
    return;
  }
  if (direction === "toServer" && entry.direction !== "ToServer") {
    throw new ProtocolError(`Packet ${entry.name} is not valid for client->server transport`);
  }
  if (direction === "toClient" && entry.direction !== "ToClient") {
    throw new ProtocolError(`Packet ${entry.name} is not valid for server->client transport`);
  }
}
