import './inventory.css';
import { getItemImage, getItem, getItemSlot, getMaxStack, type SlotType } from './items';
import { armorEquipIndex } from './equipment';

const SLOT_BG = '/gui/inventory/inventorySlotBG.svg';
const SLOT_SELECTED_BG = '/gui/inventory/inventorySlotSelectedBG.svg';
const INVENTORY_BG = '/gui/inventory/inventoryBG.svg';
const HOTBAR_BG = '/gui/inventory/hotbar.svg';
const HEALTHBAR_EMPTY = '/gui/inventory/healthbarOverlay.svg';
const HEALTHBAR_FILLED = '/gui/inventory/healthbarOverlay2.svg';
const HEALTH_TICK = '/gui/inventory/healthbarTick.svg';
const CURSOR_DEFAULT = '/gui/inventory/cursor.svg';
const CURSOR_HOVER = '/gui/inventory/cursorHover.svg';
const CURSOR_GRAB = '/gui/inventory/cursorGrab.svg';

const HOTBAR_SIZE = 5;
const INVENTORY_ROWS = 3;
const INVENTORY_COLS = 5;
const GRID_SLOTS = INVENTORY_ROWS * INVENTORY_COLS;
const TOTAL_SLOTS = HOTBAR_SIZE + GRID_SLOTS;
export const EQUIP_BASE = 100;
export const HELMET_SLOT = EQUIP_BASE + 0;
export const CHESTPLATE_SLOT = EQUIP_BASE + 1;
export const OFFHAND_SLOT = EQUIP_BASE + 2;
const EQUIP_SLOTS = 3;
const MAX_HP = 10;
const TICK_COUNT = 10;

export interface Stack { id: string; count: number; }

function ghostCopiesFor(count: number): number {
  if (count <= 1) return 0;
  if (count <= 3) return 1;
  if (count <= 7) return 2;
  return 3;
}

const inventoryState: Record<number, Stack | null> = {};
for (let i = 0; i < TOTAL_SLOTS; i++) inventoryState[i] = null;
for (let i = 0; i < EQUIP_SLOTS; i++) inventoryState[EQUIP_BASE + i] = null;

inventoryState[0] = { id: 'diamondSword', count: 1 };
inventoryState[1] = { id: 'diamondPickaxe', count: 1 };
inventoryState[2] = { id: 'hammer', count: 1 };
inventoryState[3] = { id: 'bow', count: 1 };
inventoryState[4] = { id: 'arrow', count: 16 };

let selectedHotbarIndex = -1;
let currentHP = MAX_HP;
let fakeCursorX = window.innerWidth / 2;
let fakeCursorY = window.innerHeight / 2;

let cursorStack: Stack | null = null;
let rightDragVisited: Set<number> | null = null;

type EquipChange = { mainhand: string | null; offhand: string | null; helmet: string | null; chestplate: string | null };
const equipListeners: ((c: EquipChange) => void)[] = [];
const hotbarListeners: ((index: number, itemId: string | null) => void)[] = [];

// STEP 5: drop listeners. main.ts subscribes to spawn world drops.
export type DropRequest = { itemId: string; count: number };
const dropListeners: ((d: DropRequest) => void)[] = [];

export function onEquipChange(fn: (c: EquipChange) => void) { equipListeners.push(fn); }
export function onHotbarSelect(fn: (index: number, itemId: string | null) => void) { hotbarListeners.push(fn); }
export function onItemDrop(fn: (d: DropRequest) => void) { dropListeners.push(fn); }

export function refreshEquipment() { fireEquipChange(); }

function stackId(s: Stack | null): string | null { return s ? s.id : null; }

function fireEquipChange() {
  const mainhandId = selectedHotbarIndex === -1 ? null : stackId(inventoryState[selectedHotbarIndex]);
  const change: EquipChange = {
    mainhand: mainhandId,
    offhand: stackId(inventoryState[OFFHAND_SLOT]),
    helmet: stackId(inventoryState[HELMET_SLOT]),
    chestplate: stackId(inventoryState[CHESTPLATE_SLOT]),
  };
  for (const fn of equipListeners) fn(change);
}

function fireHotbarSelect() {
  const id = selectedHotbarIndex === -1 ? null : stackId(inventoryState[selectedHotbarIndex]);
  for (const fn of hotbarListeners) fn(selectedHotbarIndex, id);
}

function fireDrop(itemId: string, count: number) {
  if (count <= 0) return;
  for (const fn of dropListeners) fn({ itemId, count });
}

function makeSlot(index: number) {
  const slot = document.createElement('div');
  slot.className = 'inventory-slot';
  slot.style.backgroundImage = `url('${SLOT_BG}')`;
  slot.dataset.slotIndex = String(index);
  return slot;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

function makeStackVisual(stack: Stack, index: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'slot-stack';
  wrap.dataset.itemIndex = String(index);
  wrap.dataset.itemId = stack.id;

  const src = getItemImage(stack.id);
  const copies = ghostCopiesFor(stack.count);

  for (let i = 0; i < copies; i++) {
    const ghost = document.createElement('img');
    if (src) ghost.src = src;
    ghost.className = 'slot-item slot-item-ghost';
    const seed = hashStr(stack.id + ':' + i);
    const dx = ((seed % 100) / 100 - 0.5) * 30;
    const dy = (((seed >> 8) % 100) / 100 - 0.5) * 30;
    const rot = (((seed >> 16) % 100) / 100 - 0.5) * 30;
    ghost.style.setProperty('--ghost-dx', `${dx}%`);
    ghost.style.setProperty('--ghost-dy', `${dy}%`);
    ghost.style.setProperty('--ghost-rot', `${rot}deg`);
    wrap.appendChild(ghost);
  }

  const main = document.createElement('img');
  if (src) main.src = src;
  main.className = 'slot-item';
  wrap.appendChild(main);

  if (stack.count > 1) {
    const badge = document.createElement('div');
    badge.className = 'stack-count';
    badge.textContent = String(stack.count);
    wrap.appendChild(badge);
  }
  return wrap;
}

function getSlotUnderCursor(): number | null {
  const el = document.elementFromPoint(fakeCursorX, fakeCursorY);
  if (!el) return null;
  const slot = (el as HTMLElement).closest<HTMLElement>('[data-slot-index]');
  if (!slot) return null;
  return Number(slot.dataset.slotIndex);
}

function canPlaceInSlot(itemId: string | null, slotIndex: number): boolean {
  if (itemId === null) return true;
  if (slotIndex < TOTAL_SLOTS) return true;
  const def = getItem(itemId);
  if (!def) return false;
  const required = armorEquipIndex(def.slot);
  return required === slotIndex;
}

// ---------- cursor-stack operations ----------

function pickUpAll(slotIndex: number) {
  const cur = inventoryState[slotIndex];
  if (!cur) return;
  cursorStack = { id: cur.id, count: cur.count };
  inventoryState[slotIndex] = null;
}

function splitInto(srcIndex: number) {
  const cur = inventoryState[srcIndex];
  if (!cur) return;
  const take = Math.ceil(cur.count / 2);
  cursorStack = { id: cur.id, count: take };
  const left = cur.count - take;
  inventoryState[srcIndex] = left > 0 ? { id: cur.id, count: left } : null;
}

function depositAll(slotIndex: number) {
  if (!cursorStack) return;
  if (!canPlaceInSlot(cursorStack.id, slotIndex)) return;
  const slot = inventoryState[slotIndex];
  if (!slot) {
    inventoryState[slotIndex] = cursorStack;
    cursorStack = null;
    return;
  }
  if (slot.id === cursorStack.id) {
    const max = getMaxStack(slot.id);
    const room = max - slot.count;
    if (room <= 0) return;
    const moved = Math.min(room, cursorStack.count);
    slot.count += moved;
    cursorStack.count -= moved;
    if (cursorStack.count <= 0) cursorStack = null;
    return;
  }
  inventoryState[slotIndex] = cursorStack;
  cursorStack = slot;
}

function depositOne(slotIndex: number): boolean {
  if (!cursorStack) return false;
  if (!canPlaceInSlot(cursorStack.id, slotIndex)) return false;
  const slot = inventoryState[slotIndex];
  if (!slot) {
    inventoryState[slotIndex] = { id: cursorStack.id, count: 1 };
  } else {
    if (slot.id !== cursorStack.id) return false;
    const max = getMaxStack(slot.id);
    if (slot.count >= max) return false;
    slot.count += 1;
  }
  cursorStack.count -= 1;
  if (cursorStack.count <= 0) cursorStack = null;
  return true;
}

// STEP 5: distinguish "outside the inventory panel entirely" from "inside the
// panel but in a gap between slots". Throwing items into the world only fires
// for the former — missing a slot by a few pixels shouldn't dump your stack.
function cursorIsOutsidePanel(): boolean {
  const panel = document.querySelector<HTMLElement>('.inventory-panel');
  if (!panel) return true;
  const r = panel.getBoundingClientRect();
  return (
    fakeCursorX < r.left ||
    fakeCursorX > r.right ||
    fakeCursorY < r.top ||
    fakeCursorY > r.bottom
  );
}

// ---------- Mouse handlers ----------

export function handleInventoryMouseDown(button: number = 0) {
  const slotIndex = getSlotUnderCursor();

  if (button === 0) {
    if (slotIndex === null) {
      // STEP 5: clicking outside the panel while holding a stack drops it.
      // Inside the panel but between slots → no-op.
      if (cursorStack && cursorIsOutsidePanel()) {
        fireDrop(cursorStack.id, cursorStack.count);
        cursorStack = null;
        renderInventory();
      }
      return;
    }
    if (cursorStack) {
      depositAll(slotIndex);
    } else {
      pickUpAll(slotIndex);
    }
    renderInventory();
    fireEquipChange();
    return;
  }

  if (button === 2) {
    rightDragVisited = new Set();
    if (slotIndex === null) {
      // STEP 5: right-click outside drops one item from the cursor.
      if (cursorStack && cursorIsOutsidePanel()) {
        fireDrop(cursorStack.id, 1);
        cursorStack.count -= 1;
        if (cursorStack.count <= 0) cursorStack = null;
        renderInventory();
      }
      return;
    }

    // Armor auto-equip shortcut.
    if (!cursorStack) {
      const stack = inventoryState[slotIndex];
      if (stack && stack.count === 1) {
        const slotType = getItemSlot(stack.id);
        if (slotType) {
          const targetIndex = armorEquipIndex(slotType);
          if (targetIndex !== null && targetIndex !== slotIndex) {
            const target = inventoryState[targetIndex];
            inventoryState[targetIndex] = stack;
            inventoryState[slotIndex] = target;
            rightDragVisited.add(slotIndex);
            renderInventory();
            fireEquipChange();
            return;
          }
        }
      }
    }

    if (cursorStack) {
      if (depositOne(slotIndex)) rightDragVisited.add(slotIndex);
    } else {
      splitInto(slotIndex);
      rightDragVisited.add(slotIndex);
    }
    renderInventory();
    fireEquipChange();
  }
}

export function handleInventoryMouseUp(button: number = 0) {
  if (button === 2) rightDragVisited = null;
}

function updateFakeCursor(dx: number, dy: number) {
  fakeCursorX = Math.max(0, Math.min(window.innerWidth, fakeCursorX + dx));
  fakeCursorY = Math.max(0, Math.min(window.innerHeight, fakeCursorY + dy));
  const cursor = document.getElementById('fake-cursor');
  if (cursor) {
    cursor.style.left = `${fakeCursorX}px`;
    cursor.style.top = `${fakeCursorY}px`;
  }
  updateCursorAttachment();
  updateCursorSprite();

  const slotIndex = getSlotUnderCursor();
  if (slotIndex !== null && rightDragVisited && cursorStack && !rightDragVisited.has(slotIndex)) {
    if (depositOne(slotIndex)) {
      rightDragVisited.add(slotIndex);
      renderInventory();
      fireEquipChange();
    }
  }
}

function updateCursorSprite() {
  const cursor = document.getElementById('fake-cursor') as HTMLImageElement | null;
  if (!cursor) return;

  if (cursorStack) {
    cursor.src = CURSOR_GRAB;
    return;
  }

  const slotIndex = getSlotUnderCursor();
  if (slotIndex !== null && inventoryState[slotIndex]) {
    cursor.src = CURSOR_HOVER;
  } else {
    cursor.src = CURSOR_DEFAULT;
  }
}

function updateCursorAttachment() {
  const node = document.getElementById('cursor-stack');
  if (!node) return;
  node.style.left = `${fakeCursorX}px`;
  node.style.top = `${fakeCursorY}px`;
}

export function handleInventoryMouseMove(dx: number, dy: number) {
  updateFakeCursor(dx, dy);
}

export function isInventoryOpen() {
  const overlay = document.getElementById('inventory-overlay');
  return overlay !== null && !overlay.classList.contains('hidden');
}

export function selectHotbar(index: number) {
  if (index < 0 || index >= HOTBAR_SIZE) return;
  selectedHotbarIndex = index === selectedHotbarIndex ? -1 : index;
  renderInventory();
  fireHotbarSelect();
  fireEquipChange();
}

export function getSelectedHotbarIndex() { return selectedHotbarIndex; }
export function getHeldItemId(): string | null {
  return selectedHotbarIndex === -1 ? null : stackId(inventoryState[selectedHotbarIndex]);
}
export function getOffhandItemId(): string | null { return stackId(inventoryState[OFFHAND_SLOT]); }

export function toggleOffhand() {
  if (selectedHotbarIndex === -1) return;
  const held = inventoryState[selectedHotbarIndex];
  const off = inventoryState[OFFHAND_SLOT];
  if (held === null && off === null) return;
  if (held && !canPlaceInSlot(held.id, OFFHAND_SLOT)) return;
  inventoryState[OFFHAND_SLOT] = held;
  inventoryState[selectedHotbarIndex] = off;
  renderInventory();
  fireEquipChange();
  fireHotbarSelect();
}

// STEP 5: Q-drop from the currently-held hotbar slot (inventory closed).

export function dropHeldOne() {
  if (selectedHotbarIndex === -1) return;
  const stack = inventoryState[selectedHotbarIndex];
  if (!stack) return;
  fireDrop(stack.id, 1);
  stack.count -= 1;
  if (stack.count <= 0) inventoryState[selectedHotbarIndex] = null;
  renderInventory();
  fireEquipChange();
  fireHotbarSelect();
}

export function dropHeldStack() {
  if (selectedHotbarIndex === -1) return;
  const stack = inventoryState[selectedHotbarIndex];
  if (!stack) return;
  fireDrop(stack.id, stack.count);
  inventoryState[selectedHotbarIndex] = null;
  renderInventory();
  fireEquipChange();
  fireHotbarSelect();
}

// STEP 5: pickup. Merge into existing same-id stacks first, then fill empties.
// Returns leftover count that couldn't fit.
export function tryAddItem(itemId: string, count: number): number {
  const max = getMaxStack(itemId);
  let remaining = count;

  for (let i = 0; i < TOTAL_SLOTS && remaining > 0; i++) {
    const s = inventoryState[i];
    if (s && s.id === itemId && s.count < max) {
      const room = max - s.count;
      const moved = Math.min(room, remaining);
      s.count += moved;
      remaining -= moved;
    }
  }
  for (let i = 0; i < TOTAL_SLOTS && remaining > 0; i++) {
    if (inventoryState[i] === null) {
      const moved = Math.min(max, remaining);
      inventoryState[i] = { id: itemId, count: moved };
      remaining -= moved;
    }
  }

  if (remaining !== count) {
    renderInventory();
    fireEquipChange();
    fireHotbarSelect();
  }
  return remaining;
}

function renderInventory() {
  const allSlots = document.querySelectorAll<HTMLDivElement>('[data-slot-index]');
  allSlots.forEach(slot => {
    const i = Number(slot.dataset.slotIndex);
    const isSelected = i === selectedHotbarIndex && i < HOTBAR_SIZE;
    slot.style.backgroundImage = `url('${isSelected ? SLOT_SELECTED_BG : SLOT_BG}')`;
    slot.innerHTML = '';
    const stack = inventoryState[i];
    if (stack) slot.appendChild(makeStackVisual(stack, i));
  });
  renderCursorStack();
}

function renderCursorStack() {
  let node = document.getElementById('cursor-stack');
  if (!cursorStack) {
    node?.remove();
    return;
  }
  if (!node) {
    node = document.createElement('div');
    node.id = 'cursor-stack';
    document.body.appendChild(node);
  }
  node.innerHTML = '';
  node.appendChild(makeStackVisual(cursorStack, -1));
  updateCursorAttachment();
}

function buildHotbarBar() {
  const wrapper = document.createElement('div');
  wrapper.id = 'hotbar-wrapper';

  const healthbar = document.createElement('div');
  healthbar.id = 'healthbar';

  const healthEmpty = document.createElement('div');
  healthEmpty.className = 'healthbar-layer healthbar-empty';
  healthEmpty.style.backgroundImage = `url('${HEALTHBAR_EMPTY}')`;

  const healthFilled = document.createElement('div');
  healthFilled.className = 'healthbar-layer healthbar-filled';
  healthFilled.id = 'healthbar-filled';

  const healthHighlight = document.createElement('div');
  healthHighlight.className = 'healthbar-layer healthbar-highlight';
  healthHighlight.style.backgroundImage = `url('${HEALTHBAR_FILLED}')`;

  const healthTicks = document.createElement('div');
  healthTicks.className = 'healthbar-ticks';
  for (let i = 0; i < TICK_COUNT; i++) {
    const tick = document.createElement('div');
    tick.className = 'health-tick';
    tick.style.backgroundImage = `url('${HEALTH_TICK}')`;
    healthTicks.appendChild(tick);
  }

  healthbar.appendChild(healthEmpty);
  healthbar.appendChild(healthFilled);
  healthbar.appendChild(healthHighlight);
  healthbar.appendChild(healthTicks);

  const hotbar = document.createElement('div');
  hotbar.id = 'hotbar';
  hotbar.style.backgroundImage = `url('${HOTBAR_BG}')`;
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    hotbar.appendChild(makeSlot(i));
  }

  wrapper.appendChild(healthbar);
  wrapper.appendChild(hotbar);
  document.body.appendChild(wrapper);
}

function hpToColor(hpFraction: number): string {
  const clamped = Math.max(0, Math.min(1, hpFraction));
  let r: number, g: number, b: number;
  if (clamped > 0.5) {
    const t = (clamped - 0.5) * 2;
    r = Math.round(241 * (1 - t) + 46 * t);
    g = Math.round(196 * (1 - t) + 204 * t);
    b = Math.round(15 * (1 - t) + 64 * t);
  } else {
    const t = clamped * 2;
    r = Math.round(231 * (1 - t) + 241 * t);
    g = Math.round(76 * (1 - t) + 196 * t);
    b = Math.round(60 * (1 - t) + 15 * t);
  }
  return `rgb(${r}, ${g}, ${b})`;
}

export function setHealth(hp: number) {
  currentHP = Math.max(0, Math.min(MAX_HP, hp));
  const fraction = currentHP / MAX_HP;
  const filled = document.getElementById('healthbar-filled');
  const highlight = document.querySelector<HTMLDivElement>('.healthbar-highlight');

  const SKEW = 8;
  const pct = fraction * 100;
  const usableWidth = 100 - SKEW;
  const topLeft = SKEW;
  const topRight = SKEW + (pct / 100) * usableWidth;
  const bottomLeft = 0;
  const bottomRight = (pct / 100) * usableWidth;

  const clip = `polygon(
    ${topLeft}% 0%,
    ${topRight}% 0%,
    ${bottomRight}% 100%,
    ${bottomLeft}% 100%
  )`;

  if (filled) {
    filled.style.clipPath = clip;
    filled.style.backgroundColor = hpToColor(fraction);
  }
  if (highlight) {
    highlight.style.clipPath = clip;
  }
}

export function getHealth() {
  return currentHP;
}

export function createInventory() {
  buildHotbarBar();

  const overlay = document.createElement('div');
  overlay.id = 'inventory-overlay';
  overlay.className = 'hidden';

  const panel = document.createElement('div');
  panel.className = 'inventory-panel';
  panel.style.backgroundImage = `url('${INVENTORY_BG}')`;

  const characterPanel = document.createElement('div');
  characterPanel.className = 'character-panel';

  const modelPreview = document.createElement('div');
  modelPreview.className = 'model-preview';
  modelPreview.id = 'character-preview';
  modelPreview.textContent = '3D model';

  const stats = document.createElement('div');
  stats.className = 'stats';
  stats.innerHTML = `
    <div>HP: ${currentHP}/${MAX_HP}</div>
    <div>Speed: 50</div>
    <div>Protection: 20</div>
  `;

  characterPanel.appendChild(modelPreview);
  characterPanel.appendChild(stats);

  const equipment = document.createElement('div');
  equipment.className = 'equipment';
  equipment.appendChild(makeSlot(HELMET_SLOT));
  equipment.appendChild(makeSlot(CHESTPLATE_SLOT));
  equipment.appendChild(makeSlot(OFFHAND_SLOT));

  const grid = document.createElement('div');
  grid.className = 'inventory-grid';
  for (let i = 0; i < GRID_SLOTS; i++) {
    grid.appendChild(makeSlot(HOTBAR_SIZE + i));
  }

  const overlayHotbar = document.createElement('div');
  overlayHotbar.className = 'inventory-hotbar-row';
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    overlayHotbar.appendChild(makeSlot(i));
  }

  const cursor = document.createElement('img');
  cursor.id = 'fake-cursor';
  cursor.src = CURSOR_DEFAULT;
  document.body.appendChild(cursor);

  panel.appendChild(equipment);
  panel.appendChild(characterPanel);
  panel.appendChild(grid);
  panel.appendChild(overlayHotbar);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  document.body.appendChild(cursor);

  overlay.addEventListener('contextmenu', e => e.preventDefault());

  renderInventory();
  setHealth(MAX_HP);
  fireEquipChange();
  fireHotbarSelect();
}

export function showInventory() {
  document.getElementById('inventory-overlay')?.classList.remove('hidden');
  document.getElementById('hotbar-wrapper')?.classList.add('darkened');
  fakeCursorX = window.innerWidth / 2;
  fakeCursorY = window.innerHeight / 2;
  const cursor = document.getElementById('fake-cursor');
  if (cursor) {
    cursor.classList.add('visible');
    cursor.style.left = `${fakeCursorX}px`;
    cursor.style.top = `${fakeCursorY}px`;
  }
}

export function hideInventory() {
  document.getElementById('inventory-overlay')?.classList.add('hidden');
  document.getElementById('hotbar-wrapper')?.classList.remove('darkened');
  document.getElementById('fake-cursor')?.classList.remove('visible');
  // If still carrying when the inventory closes: try to fit it back; world-drop
  // anything that doesn't fit so it isn't silently lost.
  if (cursorStack) {
    const leftover = tryAddItem(cursorStack.id, cursorStack.count);
    if (leftover > 0) fireDrop(cursorStack.id, leftover);
    cursorStack = null;
    renderInventory();
  }
  rightDragVisited = null;
}

export function toggleInventory() {
  const overlay = document.getElementById('inventory-overlay');
  if (!overlay) return;
  if (overlay.classList.contains('hidden')) {
    showInventory();
  } else {
    hideInventory();
  }
}

export function setCharacterPreview(canvas: HTMLCanvasElement) {
  const container = document.getElementById('character-preview');
  if (container) {
    container.textContent = '';
    container.appendChild(canvas);
  }
}