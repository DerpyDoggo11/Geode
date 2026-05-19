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

function makeSlot(index: number) {
  const slot = document.createElement('div');
  slot.className = 'inventory-slot';
  slot.style.backgroundImage = `url('${SLOT_BG}')`;
  slot.dataset.slotIndex = String(index);

  slot.addEventListener('dragover', (e) => e.preventDefault());
  slot.addEventListener('drop', (e) => {
    e.preventDefault();
    if (draggedFromIndex === null) return;
    const from = draggedFromIndex;
    const to = index;
    [inventoryState[from], inventoryState[to]] = [inventoryState[to], inventoryState[from]];
    draggedFromIndex = null;
    renderInventory();
  });

  return slot;
}

function makeItemImg(src: string, index: number) {
  const img = document.createElement('img');
  img.src = src;
  img.className = 'slot-item';
  img.draggable = true;

  img.addEventListener('dragstart', (e) => {
    draggedFromIndex = index;
    document
      .querySelectorAll<HTMLDivElement>(`[data-slot-index="${index}"]`)
      .forEach(s => (s.style.backgroundImage = `url('${SLOT_SELECTED_BG}')`));
    e.dataTransfer?.setData('text/plain', String(index));
  });

  img.addEventListener('dragend', () => {
    draggedFromIndex = null;
    renderInventory();
  });

  return img;
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
  healthFilled.style.backgroundImage = `url('${HEALTHBAR_FILLED}')`;

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

export function setHealth(hp: number) {
  currentHP = Math.max(0, Math.min(MAX_HP, hp));
  const filled = document.getElementById('healthbar-filled');
  if (filled) {
    filled.style.width = `${(currentHP / MAX_HP) * 100}%`;
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

  panel.appendChild(equipment);
  panel.appendChild(characterPanel);
  panel.appendChild(grid);
  panel.appendChild(overlayHotbar);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  renderInventory();
  setHealth(MAX_HP);
}

export function showInventory() {
  document.getElementById('inventory-overlay')?.classList.remove('hidden');
  document.getElementById('hotbar-wrapper')?.classList.add('darkened');
}

export function hideInventory() {
  document.getElementById('inventory-overlay')?.classList.add('hidden');
  document.getElementById('hotbar-wrapper')?.classList.remove('darkened');
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