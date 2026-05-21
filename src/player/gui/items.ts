import itemsData from './items.json';

export type SlotType = 'weapon' | 'offhand' | 'helmet' | 'chestplate';

export interface AttachTransform {
  offset?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

export interface ItemDef {
  id: string;
  name: string;
  slot: SlotType;
  image: string;
  model: string;
  attach?: AttachTransform;
  stats: Record<string, number | boolean>;
}

const registry: Record<string, ItemDef> = {};
for (const [id, def] of Object.entries(itemsData as unknown as Record<string, Omit<ItemDef, 'id'>>)) {
  registry[id] = { id, ...def };
}

export function loadItems(_url?: string): Promise<void> {
  return Promise.resolve();
}

export function getItem(id: string | null): ItemDef | null {
  if (!id) return null;
  return registry[id] ?? null;
}

export function getItemImage(id: string | null): string | null {
  return getItem(id)?.image ?? null;
}

export function getItemSlot(id: string | null): SlotType | null {
  return getItem(id)?.slot ?? null;
}

export function allItems(): ItemDef[] {
  return Object.values(registry);
}