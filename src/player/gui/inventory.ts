import './inventory.css';

const items = {
  broadsword: '/gui/inventory/items/broadsword.svg',
  dagger: '/gui/inventory/items/dagger.svg',
  bow: '/gui/inventory/items/bow.svg',
  arrow: '/gui/inventory/items/arrow.svg',
};

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
const TOTAL_SLOTS = HOTBAR_SIZE + INVENTORY_ROWS * INVENTORY_COLS;
const EQUIP_BASE = 100;
const MAX_HP = 10;
const TICK_COUNT = 10;

const inventoryState: (string | null)[] = new Array(TOTAL_SLOTS).fill(null);
inventoryState[0] = items.dagger;
inventoryState[1] = items.broadsword;
inventoryState[2] = items.bow;
inventoryState[3] = items.arrow;

let currentHP = MAX_HP;
let draggedFromIndex: number | null = null;
let fakeCursorX = window.innerWidth / 2;
let fakeCursorY = window.innerHeight / 2;
let draggedGhost: HTMLImageElement | null = null;

function makeSlot(index: number) {
  const slot = document.createElement('div');
  slot.className = 'inventory-slot';
  slot.style.backgroundImage = `url('${SLOT_BG}')`;
  slot.dataset.slotIndex = String(index);
  return slot;
}

function makeItemImg(src: string, index: number) {
  const img = document.createElement('img');
  img.src = src;
  img.className = 'slot-item';
  img.dataset.itemIndex = String(index);
  return img;
}

function getSlotUnderCursor(): number | null {
  const el = document.elementFromPoint(fakeCursorX, fakeCursorY);
  if (!el) return null;
  const slot = (el as HTMLElement).closest<HTMLElement>('[data-slot-index]');
  if (!slot) return null;
  return Number(slot.dataset.slotIndex);
}

function startDrag(index: number, src: string) {
  draggedFromIndex = index;
  draggedGhost = document.createElement('img');
  draggedGhost.src = src;
  draggedGhost.className = 'slot-item dragging-ghost';
  draggedGhost.style.left = `${fakeCursorX}px`;
  draggedGhost.style.top = `${fakeCursorY}px`;
  document.body.appendChild(draggedGhost);

  document
    .querySelectorAll<HTMLDivElement>(`[data-slot-index="${index}"]`)
    .forEach(s => (s.style.backgroundImage = `url('${SLOT_SELECTED_BG}')`));

  updateCursorSprite();
}

function endDrag() {
  if (draggedFromIndex === null) {
    cleanupDrag();
    return;
  }
  const to = getSlotUnderCursor();
  if (to !== null) {
    const from = draggedFromIndex;
    [inventoryState[from], inventoryState[to]] = [inventoryState[to], inventoryState[from]];
  }
  cleanupDrag();
  renderInventory();
}

function cleanupDrag() {
  draggedFromIndex = null;
  if (draggedGhost) {
    draggedGhost.remove();
    draggedGhost = null;
  }
  updateCursorSprite();
}

function updateCursorSprite() {
  const cursor = document.getElementById('fake-cursor') as HTMLImageElement | null;
  if (!cursor) return;

  if (draggedFromIndex !== null) {
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

function updateFakeCursor(dx: number, dy: number) {
  fakeCursorX = Math.max(0, Math.min(window.innerWidth, fakeCursorX + dx));
  fakeCursorY = Math.max(0, Math.min(window.innerHeight, fakeCursorY + dy));
  const cursor = document.getElementById('fake-cursor');
  if (cursor) {
    cursor.style.left = `${fakeCursorX}px`;
    cursor.style.top = `${fakeCursorY}px`;
  }
  if (draggedGhost) {
    draggedGhost.style.left = `${fakeCursorX}px`;
    draggedGhost.style.top = `${fakeCursorY}px`;
  }
  updateCursorSprite();
}

export function handleInventoryMouseMove(dx: number, dy: number) {
  updateFakeCursor(dx, dy);
}

export function handleInventoryMouseDown() {
  const slotIndex = getSlotUnderCursor();
  if (slotIndex === null) return;
  const src = inventoryState[slotIndex];
  if (!src) return;
  startDrag(slotIndex, src);
}

export function handleInventoryMouseUp() {
  endDrag();
}

export function isInventoryOpen() {
  const overlay = document.getElementById('inventory-overlay');
  return overlay !== null && !overlay.classList.contains('hidden');
}

function renderInventory() {
  const allSlots = document.querySelectorAll<HTMLDivElement>('[data-slot-index]');
  allSlots.forEach(slot => {
    const i = Number(slot.dataset.slotIndex);
    slot.style.backgroundImage = `url('${SLOT_BG}')`;
    slot.innerHTML = '';
    const itemSrc = inventoryState[i];
    if (itemSrc) {
      slot.appendChild(makeItemImg(itemSrc, i));
    }
  });
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
  for (let i = 0; i < 3; i++) {
    equipment.appendChild(makeSlot(EQUIP_BASE + i));
  }

  const grid = document.createElement('div');
  grid.className = 'inventory-grid';
  for (let i = 0; i < INVENTORY_ROWS * INVENTORY_COLS; i++) {
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

  renderInventory();
  setHealth(MAX_HP);
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
  cleanupDrag();
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
