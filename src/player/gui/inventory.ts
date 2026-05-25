import './inventory.css';
import { getItemImage, getItem, getItemSlot, getMaxStack } from './items';
import { armorEquipIndex } from './equipment';

function buildTooltipEl(): HTMLElement {
  const tt = document.createElement('div');
  tt.id = 'item-tooltip';

  const header = document.createElement('div');
  header.className = 'tt-header';
  tt.appendChild(header);

  const count = document.createElement('div');
  count.className = 'tt-count';
  header.appendChild(count);

  const titleGroup = document.createElement('div');
  titleGroup.className = 'tt-title';
  header.appendChild(titleGroup);

  const name = document.createElement('div');
  name.className = 'tt-name';
  titleGroup.appendChild(name);

  const slotType = document.createElement('div');
  slotType.className = 'tt-slot';
  titleGroup.appendChild(slotType);

  const desc = document.createElement('div');
  desc.className = 'tt-desc';
  tt.appendChild(desc);

  const divider = document.createElement('div');
  divider.className = 'tt-divider';
  tt.appendChild(divider);

  const stats = document.createElement('div');
  stats.className = 'tt-stats';
  divider.appendChild(stats);

  document.body.appendChild(tt);
  return tt;
}

function showTooltip(slotIndex: number | null) {
  const tt = document.getElementById('item-tooltip');
  if (!tt) return;

  if (!isInventoryOpen() || slotIndex === null || !inventoryState[slotIndex]) {
    tt.style.display = 'none';
    return;
  }

  const stack = inventoryState[slotIndex]!;
  const def = getItem(stack.id);
  if (!def) { tt.style.display = 'none'; return; }

  (tt.querySelector('.tt-name') as HTMLElement).textContent = def.name;

  const slotEl = tt.querySelector('.tt-slot') as HTMLElement;
  slotEl.textContent = def.slot ?? '';

  const descEl = tt.querySelector('.tt-desc') as HTMLElement;
  const descText = def.tooltip?.description ?? '';
  descEl.textContent = descText;
  descEl.style.display = descText ? 'block' : 'none';

  const statsEl = tt.querySelector('.tt-stats') as HTMLElement;
  statsEl.innerHTML = '';
  for (const [k, v] of Object.entries(def.stats)) {
    if (typeof v === 'number') {
      const row = document.createElement('div');
      const label = k.charAt(0).toUpperCase() + k.slice(1);
      row.innerHTML = `<span class="stat-label">${label}</span><span class="stat-value">${v}</span>`;
      statsEl.appendChild(row);
    }
  }
  (tt.querySelector('.tt-divider') as HTMLElement).style.display =
    statsEl.children.length > 0 ? 'block' : 'none';

  const countEl = tt.querySelector('.tt-count') as HTMLElement;
  countEl.textContent = stack.count > 1 ? `×${stack.count}` : '';

  tt.style.display = 'block';
  const h = tt.offsetHeight;
  const leftPad  = Math.ceil(260 * 0.1675 * (1 - 10 / h)) + 8;
  const rightPad = Math.ceil(260 * 0.198  * (1 - 16 / h)) + 8;
  tt.style.paddingLeft  = `${leftPad}px`;
  tt.style.paddingRight = `${rightPad}px`;

  let x = fakeCursorX + 18;
  if (x + 260 > window.innerWidth) x = fakeCursorX - 260 - 8;
  const y = Math.max(8, fakeCursorY - 10);
  tt.style.left = `${x}px`;
  tt.style.top  = `${y}px`;
}

const SLOT_BG = '/gui/inventory/inventorySlotBG.svg';
const SLOT_SELECTED_BG = '/gui/inventory/inventorySlotSelectedBG.svg';
const INVENTORY_BG = '/gui/inventory/inventoryBG.svg';
const SETTINGS_BG  = '/gui/inventory/settingsBG.svg';
const HOTBAR_BG = '/gui/inventory/hotbar.svg';
const CURSOR_DEFAULT = '/gui/inventory/cursor.svg';

const HB_EMPTY_COLOR  = '#9e2083';
const HB_FULL_COLOR   = '#c8658c';
const HB_LOW_COLOR    = '#7a1212';
const HB_TICK_COLOR   = '#731f7a';
const HB_BORDER_COLOR = '#731f7a';

const HB_W = 100;
const HB_H = 10;
const HB_SKEW = 8;
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

// ─── Game Settings ────────────────────────────────────────────────────────────

export interface GameSettings {
  mouseSensitivity: number;
  bowAimSensitivity: number;
  fov: number;
}

export const gameSettings: GameSettings = {
  mouseSensitivity: 0.01,
  bowAimSensitivity: 0.003,
  fov: 75,
};

const SETTINGS_DEFAULTS: GameSettings = {
  mouseSensitivity: 0.01,
  bowAimSensitivity: 0.003,
  fov: 75,
};

function loadSettings() {
  try {
    const saved = localStorage.getItem('geode_settings');
    if (saved) Object.assign(gameSettings, JSON.parse(saved));
  } catch {}
}

function saveSettings() {
  localStorage.setItem('geode_settings', JSON.stringify(gameSettings));
}

interface SettingRow {
  key: keyof GameSettings;
  label: string;
  step: number;
  min: number;
  max: number;
  fmt: (v: number) => string;
}

interface SettingSection {
  section: string;
  rows: SettingRow[];
}

const SETTINGS_DEFS: SettingSection[] = [
  {
    section: 'Controls',
    rows: [
      { key: 'mouseSensitivity',  label: 'Mouse Sensitivity', step: 0.001,  min: 0.001, max: 0.05, fmt: v => v.toFixed(3) },
      { key: 'bowAimSensitivity', label: 'Bow Sensitivity',   step: 0.0005, min: 0.0005, max: 0.01, fmt: v => v.toFixed(4) },
    ],
  },
  {
    section: 'Camera',
    rows: [
      { key: 'fov', label: 'Field of View', step: 1, min: 50, max: 110, fmt: v => `${v}°` },
    ],
  },
];

function adjustSetting(key: keyof GameSettings, direction: 1 | -1) {
  const def = SETTINGS_DEFS.flatMap(s => s.rows).find(r => r.key === key);
  if (!def) return;
  const cur = gameSettings[key] as number;
  const next = Math.max(def.min, Math.min(def.max, +(cur + direction * def.step).toFixed(10)));
  (gameSettings as unknown as Record<string, number>)[key] = next;
  saveSettings();
  const valEl = document.querySelector<HTMLElement>(`[data-setting-val="${key}"]`);
  if (valEl) valEl.textContent = def.fmt(next);
}

function resetAllSettings() {
  Object.assign(gameSettings, SETTINGS_DEFAULTS);
  saveSettings();
  for (const { rows } of SETTINGS_DEFS) {
    for (const def of rows) {
      const valEl = document.querySelector<HTMLElement>(`[data-setting-val="${def.key}"]`);
      if (valEl) valEl.textContent = def.fmt(gameSettings[def.key] as number);
    }
  }
}

// ─── Tab System ───────────────────────────────────────────────────────────────

type InventoryTab = 'inventory' | 'character' | 'chat' | 'settings';

function switchTab(tab: InventoryTab) {
  const panel = document.querySelector<HTMLElement>('.inventory-panel');
  if (panel) {
    panel.style.backgroundImage = `url('${tab === 'inventory' ? INVENTORY_BG : SETTINGS_BG}')`;
  }
  document.querySelectorAll<HTMLElement>('.inv-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.querySelectorAll<HTMLElement>('.inv-tab-pane').forEach(p => {
    p.classList.toggle('hidden', p.id !== `tab-${tab}`);
  });
  showTooltip(null);
}

// ─────────────────────────────────────────────────────────────────────────────

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
inventoryState[2] = { id: 'bow', count: 1 };
inventoryState[3] = { id: 'arrow', count: 16 };

let selectedHotbarIndex = -1;
let currentHP = MAX_HP;
let fakeCursorX = window.innerWidth / 2;
let fakeCursorY = window.innerHeight / 2;

let cursorStack: Stack | null = null;
let rightDragVisited: Set<number> | null = null;

type EquipChange = { mainhand: string | null; offhand: string | null; helmet: string | null; chestplate: string | null };
const equipListeners: ((c: EquipChange) => void)[] = [];
const hotbarListeners: ((index: number, itemId: string | null) => void)[] = [];

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

export function handleInventoryMouseDown(button: number = 0) {
  const hoveredEl = document.elementFromPoint(fakeCursorX, fakeCursorY) as HTMLElement | null;

  if (button === 0) {
    // Tab switching
    const tabBtn = hoveredEl?.closest<HTMLElement>('.inv-tab');
    if (tabBtn?.dataset.tab) {
      switchTab(tabBtn.dataset.tab as InventoryTab);
      return;
    }

    // Settings buttons
    const settingsBtn = hoveredEl?.closest<HTMLElement>('.settings-btn');
    if (settingsBtn) {
      if (settingsBtn.classList.contains('settings-reset')) {
        resetAllSettings();
      } else {
        const key = settingsBtn.dataset.settingKey as keyof GameSettings | undefined;
        if (key) {
          adjustSetting(key, settingsBtn.classList.contains('settings-dec') ? -1 : 1);
        }
      }
      return;
    }
  }

  const slotIndex = getSlotUnderCursor();

  if (button === 0) {
    if (slotIndex === null) {
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
      if (cursorStack && cursorIsOutsidePanel()) {
        fireDrop(cursorStack.id, 1);
        cursorStack.count -= 1;
        if (cursorStack.count <= 0) cursorStack = null;
        renderInventory();
      }
      return;
    }

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
  showTooltip(slotIndex);

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
    return;
  }

  const el = document.elementFromPoint(fakeCursorX, fakeCursorY) as HTMLElement | null;
  if (el?.closest('.inv-tab, .settings-btn')) {
    cursor.src = CURSOR_HOVER;
    return;
  }

  cursor.src = CURSOR_DEFAULT;
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

/** Remove one of `itemId` from the inventory, preferring mainhand then offhand then grid. */
export function consumeItemById(itemId: string): boolean {
  // Check mainhand first
  if (selectedHotbarIndex !== -1) {
    const s = inventoryState[selectedHotbarIndex];
    if (s && s.id === itemId) {
      s.count -= 1;
      if (s.count <= 0) inventoryState[selectedHotbarIndex] = null;
      renderInventory();
      fireEquipChange();
      return true;
    }
  }
  // Check offhand
  const off = inventoryState[OFFHAND_SLOT];
  if (off && off.id === itemId) {
    off.count -= 1;
    if (off.count <= 0) inventoryState[OFFHAND_SLOT] = null;
    renderInventory();
    fireEquipChange();
    return true;
  }
  // Check rest of inventory
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    const s = inventoryState[i];
    if (s && s.id === itemId) {
      s.count -= 1;
      if (s.count <= 0) inventoryState[i] = null;
      renderInventory();
      fireEquipChange();
      return true;
    }
  }
  return false;
}

export function consumeArrow(): boolean {
  const offhand = inventoryState[OFFHAND_SLOT];
  if (offhand && offhand.id === 'arrow') {
    offhand.count -= 1;
    if (offhand.count <= 0) inventoryState[OFFHAND_SLOT] = null;
    renderInventory();
    fireEquipChange();
    return true;
  }
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    const s = inventoryState[i];
    if (s && s.id === 'arrow') {
      s.count -= 1;
      if (s.count <= 0) inventoryState[i] = null;
      renderInventory();
      fireEquipChange();
      return true;
    }
  }
  return false;
}

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

function buildHealthbarSVG(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${HB_W} ${HB_H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.cssText = 'width:100%;height:100%;display:block;overflow:visible;';

  const bg = document.createElementNS(NS, 'polygon');
  bg.setAttribute('points', `${HB_SKEW},0 ${HB_W},0 ${HB_W - HB_SKEW},${HB_H} 0,${HB_H}`);
  bg.setAttribute('fill', HB_EMPTY_COLOR);
  svg.appendChild(bg);

  const fill = document.createElementNS(NS, 'polygon');
  fill.id = 'hb-fill-poly';
  fill.setAttribute('fill', HB_FULL_COLOR);
  fill.setAttribute('points', `${HB_SKEW},0 ${HB_W},0 ${HB_W - HB_SKEW},${HB_H} 0,${HB_H}`);
  svg.appendChild(fill);

  for (let i = 1; i < TICK_COUNT; i++) {
    const t = i / TICK_COUNT;
    const xTop = (HB_SKEW + (HB_W - HB_SKEW) * t).toFixed(2);
    const xBot = ((HB_W - HB_SKEW) * t).toFixed(2);
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', xTop); line.setAttribute('y1', '0');
    line.setAttribute('x2', xBot); line.setAttribute('y2', String(HB_H));
    line.setAttribute('stroke', HB_TICK_COLOR);
    line.setAttribute('stroke-width', '0.8');
    svg.appendChild(line);
  }

  const border = document.createElementNS(NS, 'polygon');
  border.setAttribute('points', `${HB_SKEW},0 ${HB_W},0 ${HB_W - HB_SKEW},${HB_H} 0,${HB_H}`);
  border.setAttribute('fill', 'none');
  border.setAttribute('stroke', HB_BORDER_COLOR);
  border.setAttribute('stroke-width', '1.5');
  svg.appendChild(border);

  return svg;
}

function buildHotbarBar() {
  const wrapper = document.createElement('div');
  wrapper.id = 'hotbar-wrapper';

  const healthbar = document.createElement('div');
  healthbar.id = 'healthbar';
  healthbar.appendChild(buildHealthbarSVG());

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

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

function hpToColor(hpFraction: number): string {
  const t = Math.max(0, Math.min(1, hpFraction));
  const [lr, lg, lb] = hexToRgb(HB_LOW_COLOR);
  const [hr, hg, hb] = hexToRgb(HB_FULL_COLOR);
  const r = Math.round(lr * (1 - t) + hr * t);
  const g = Math.round(lg * (1 - t) + hg * t);
  const b = Math.round(lb * (1 - t) + hb * t);
  return `rgb(${r},${g},${b})`;
}

export function setHealth(hp: number) {
  currentHP = Math.max(0, Math.min(MAX_HP, hp));
  const fraction = currentHP / MAX_HP;

  const fillPoly = document.getElementById('hb-fill-poly') as unknown as SVGPolygonElement | null;
  if (fillPoly) {
    const xRight    = (HB_SKEW + (HB_W - HB_SKEW) * fraction).toFixed(2);
    const xBotRight = ((HB_W - HB_SKEW) * fraction).toFixed(2);
    fillPoly.setAttribute('points', `${HB_SKEW},0 ${xRight},0 ${xBotRight},${HB_H} 0,${HB_H}`);
    fillPoly.setAttribute('fill', hpToColor(fraction));
  }
}

export function getHealth() {
  return currentHP;
}

export function createInventory() {
  loadSettings();
  buildHotbarBar();
  buildTooltipEl();

  const overlay = document.createElement('div');
  overlay.id = 'inventory-overlay';
  overlay.className = 'hidden';

  const panel = document.createElement('div');
  panel.className = 'inventory-panel';
  panel.style.backgroundImage = `url('${INVENTORY_BG}')`;

  // ── Tab bar ───────────────────────────────────────────────────────────────
  const tabBar = document.createElement('div');
  tabBar.className = 'inv-tab-bar';

  const tabDefs: { id: InventoryTab; label: string }[] = [
    { id: 'inventory', label: 'Items' },
    { id: 'character', label: 'Character' },
    { id: 'chat',      label: 'Chat' },
    { id: 'settings',  label: 'Settings' },
  ];
  for (const { id, label } of tabDefs) {
    const btn = document.createElement('div');
    btn.className = 'inv-tab' + (id === 'inventory' ? ' active' : '');
    btn.dataset.tab = id;
    btn.textContent = label;
    tabBar.appendChild(btn);
  }
  panel.appendChild(tabBar);

  // ── Inventory pane ────────────────────────────────────────────────────────
  const inventoryPane = document.createElement('div');
  inventoryPane.className = 'inv-tab-pane';
  inventoryPane.id = 'tab-inventory';

  const equipment = document.createElement('div');
  equipment.className = 'equipment';
  equipment.appendChild(makeSlot(HELMET_SLOT));
  equipment.appendChild(makeSlot(CHESTPLATE_SLOT));
  equipment.appendChild(makeSlot(OFFHAND_SLOT));
  inventoryPane.appendChild(equipment);

  const characterPanel = document.createElement('div');
  characterPanel.className = 'character-panel';
  const modelPreview = document.createElement('div');
  modelPreview.className = 'model-preview';
  modelPreview.id = 'character-preview';
  const stats = document.createElement('div');
  stats.className = 'stats';
  stats.innerHTML = `
    <div>HP: ${currentHP}/${MAX_HP}</div>
    <div>Speed: 50</div>
    <div>Protection: 20</div>
  `;
  characterPanel.appendChild(modelPreview);
  characterPanel.appendChild(stats);
  inventoryPane.appendChild(characterPanel);

  const grid = document.createElement('div');
  grid.className = 'inventory-grid';
  for (let i = 0; i < GRID_SLOTS; i++) {
    grid.appendChild(makeSlot(HOTBAR_SIZE + i));
  }
  inventoryPane.appendChild(grid);

  const overlayHotbar = document.createElement('div');
  overlayHotbar.className = 'inventory-hotbar-row';
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    overlayHotbar.appendChild(makeSlot(i));
  }
  inventoryPane.appendChild(overlayHotbar);

  panel.appendChild(inventoryPane);

  // ── Settings pane ─────────────────────────────────────────────────────────
  const settingsPane = document.createElement('div');
  settingsPane.className = 'inv-tab-pane hidden';
  settingsPane.id = 'tab-settings';

  const settingsInner = document.createElement('div');
  settingsInner.className = 'settings-inner';

  for (const { section, rows } of SETTINGS_DEFS) {
    const sectionEl = document.createElement('div');
    sectionEl.className = 'settings-section';

    const titleEl = document.createElement('div');
    titleEl.className = 'settings-section-title';
    titleEl.textContent = section;
    sectionEl.appendChild(titleEl);

    for (const def of rows) {
      const row = document.createElement('div');
      row.className = 'settings-row';

      const labelEl = document.createElement('span');
      labelEl.className = 'settings-label';
      labelEl.textContent = def.label;

      const ctrl = document.createElement('div');
      ctrl.className = 'settings-ctrl';

      const decBtn = document.createElement('div');
      decBtn.className = 'settings-btn settings-dec';
      decBtn.dataset.settingKey = def.key;
      decBtn.textContent = '−';

      const valEl = document.createElement('span');
      valEl.className = 'settings-val';
      valEl.dataset.settingVal = def.key;
      valEl.textContent = def.fmt(gameSettings[def.key] as number);

      const incBtn = document.createElement('div');
      incBtn.className = 'settings-btn settings-inc';
      incBtn.dataset.settingKey = def.key;
      incBtn.textContent = '+';

      ctrl.appendChild(decBtn);
      ctrl.appendChild(valEl);
      ctrl.appendChild(incBtn);

      row.appendChild(labelEl);
      row.appendChild(ctrl);
      sectionEl.appendChild(row);
    }

    settingsInner.appendChild(sectionEl);
  }

  const resetBtn = document.createElement('div');
  resetBtn.className = 'settings-btn settings-reset';
  resetBtn.textContent = 'Reset Defaults';
  settingsInner.appendChild(resetBtn);

  settingsPane.appendChild(settingsInner);
  panel.appendChild(settingsPane);

  // ── Coming-soon panes ─────────────────────────────────────────────────────
  for (const { id, label } of [
    { id: 'tab-character', label: 'Character' },
    { id: 'tab-chat',      label: 'Chat' },
  ]) {
    const pane = document.createElement('div');
    pane.className = 'inv-tab-pane hidden';
    pane.id = id;
    const msg = document.createElement('div');
    msg.className = 'coming-soon';
    msg.innerHTML = `<div class="coming-soon-title">${label}</div><div class="coming-soon-sub">Coming Soon</div>`;
    pane.appendChild(msg);
    panel.appendChild(pane);
  }

  // ── Cursor ────────────────────────────────────────────────────────────────
  const cursor = document.createElement('img');
  cursor.id = 'fake-cursor';
  cursor.src = CURSOR_DEFAULT;

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
  showTooltip(null);
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
