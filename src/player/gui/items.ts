import itemsData from './items.json';

export type SlotType = 'weapon' | 'offhand' | 'helmet' | 'chestplate';




export interface AttachTransform {
  offset?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

/** A single keyframe for a weapon animation. time is 0–1. */
export interface AnimKeyframe {
  time: number;
  armRot: [number, number, number]; // euler xyz in radians, applied to the right arm
}

/**
 * Animation definition stored in items.json under the "animation" key.
 *
 * type:
 *   'melee' – left-click triggers one random swing from `swings`
 *   'bow'   – hold left-click to charge (bowCharge), release to fire (bowRelease)
 *   'axe'   – right-click triggers one random swing from `swings`
 */
export interface WeaponAnimDef {
  type: 'melee' | 'bow' | 'axe';
  /** Seconds for one melee/axe swing animation (default 0.45). */
  duration?: number;
  /** Array of swing variants. One is chosen at random per attack. */
  swings?: AnimKeyframe[][];
  /** Bow: maximum charge time in seconds (default 2). */
  chargeMax?: number;
  /** Bow: keyframes played while the button is held (0=released, 1=full draw). */
  bowCharge?: AnimKeyframe[];
  /** Bow: keyframes played on release. */
  bowRelease?: AnimKeyframe[];
  /** Bow: duration of the release animation in seconds (default 0.35). */
  bowReleaseDuration?: number;
}

export interface ItemTooltip {
  /** Short flavour/description line shown in the tooltip. */
  description?: string;
}

export interface ItemDef {
  id: string;
  name: string;
  slot: SlotType;
  image: string;
  model: string;
  // STEP 1: new optional fields. Old code paths that don't read them keep working.
  maxStack?: number;
  dropLightColor?: string;
  attach?: AttachTransform;
  animation?: WeaponAnimDef;
  tooltip?: ItemTooltip;
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

// STEP 1: new accessors. Unused yet — just here so later steps can call them.
export function getMaxStack(id: string | null): number {
  const def = getItem(id);
  if (!def) return 1;
  return def.maxStack ?? 1;
}

export function getDropLightColor(id: string | null): string {
  return getItem(id)?.dropLightColor ?? '#ffffff';
}

export function allItems(): ItemDef[] {
  return Object.values(registry);
}