import { IfcParser, type IfcDataStore } from '@ifc-lite/parser';
import { GeometryProcessor } from '@ifc-lite/geometry';
import { Renderer } from '@ifc-lite/renderer';
import { IfcQuery } from '@ifc-lite/query';
import { collectPluckSet, pluck, type PluckOptions } from './pluck';
import './style.css';

type SpatialNode = NonNullable<IfcDataStore['spatialHierarchy']>['project'];

/** Rows rendered per tree node / selection list before collapsing into "…and N more". */
const LIST_LIMIT = 300;

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>('canvas');
const viewport = el<HTMLElement>('viewport');
const fileInput = el<HTMLInputElement>('file-input');
const openBtn = el<HTMLButtonElement>('open-btn');
const statusEl = el<HTMLParagraphElement>('status');
const modelPanel = el<HTMLElement>('model-panel');
const modelInfo = el<HTMLParagraphElement>('model-info');
const typeSelect = el<HTMLSelectElement>('type-select');
const treeEl = el<HTMLDivElement>('tree');
const selCount = el<HTMLSpanElement>('sel-count');
const selList = el<HTMLUListElement>('sel-list');
const clearBtn = el<HTMLButtonElement>('clear-btn');
const pluckBtn = el<HTMLButtonElement>('pluck-btn');
const previewCheck = el<HTMLInputElement>('opt-preview');
const resultEl = el<HTMLParagraphElement>('result');
const optionChecks: Record<keyof PluckOptions, HTMLInputElement> = {
  properties: el('opt-properties'),
  hosted: el('opt-hosted'),
  types: el('opt-types'),
  materials: el('opt-materials'),
  parts: el('opt-parts'),
};

const state = {
  processor: null as GeometryProcessor | null,
  renderer: null as Renderer | null,
  store: null as IfcDataStore | null,
  fileName: '',
  selection: new Set<number>(),
  /** Entities isolated in the viewer while "Show only what will be plucked" is on. */
  preview: null as Set<number> | null,
  busy: false,
};

// Handy for poking at the viewer from the dev-tools console during development.
if (import.meta.env.DEV) Object.assign(window, { ifcpluck: state });

function setStatus(message: string, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

function setBusy(busy: boolean) {
  state.busy = busy;
  openBtn.disabled = busy || !state.processor;
  updateSelectionUi();
}

const readOptions = (): PluckOptions => ({
  properties: optionChecks.properties.checked,
  hosted: optionChecks.hosted.checked,
  types: optionChecks.types.checked,
  materials: optionChecks.materials.checked,
  parts: optionChecks.parts.checked,
});

function describe(id: number) {
  const entities = state.store!.entities;
  return { type: entities.getTypeName(id), name: entities.getName(id) || 'Unnamed', globalId: entities.getGlobalId(id) };
}

// ── Selection ────────────────────────────────────────────────────────────────

function setSelection(ids: Iterable<number>) {
  state.selection = new Set(ids);
  onSelectionChanged();
}

function addToSelection(ids: Iterable<number>) {
  for (const id of ids) state.selection.add(id);
  onSelectionChanged();
}

function toggleSelected(id: number) {
  if (!state.selection.delete(id)) state.selection.add(id);
  onSelectionChanged();
}

function onSelectionChanged() {
  resultEl.hidden = true;
  updatePreview();
  updateSelectionUi();
}

function updatePreview() {
  const { store, selection } = state;
  state.preview = store && previewCheck.checked && selection.size > 0 ? collectPluckSet(store, selection, readOptions()).all : null;
}

function updateSelectionUi() {
  const count = state.selection.size;
  selCount.textContent = String(count);
  clearBtn.disabled = count === 0 || state.busy;
  pluckBtn.disabled = count === 0 || state.busy;
  pluckBtn.textContent = count > 0 ? `Pluck ${count} element${count === 1 ? '' : 's'} to new IFC` : 'Pluck to new IFC';

  selList.replaceChildren();
  if (!state.store) return;
  if (count === 0) {
    selList.append(listNote('Click elements in the 3D view or the model tree.'));
    return;
  }
  const ids = [...state.selection];
  for (const id of ids.slice(0, LIST_LIMIT)) {
    const { type, name, globalId } = describe(id);
    const li = document.createElement('li');
    li.title = `GlobalId ${globalId}`;
    const label = document.createElement('span');
    label.innerHTML = `<b></b> <small></small>`;
    label.querySelector('b')!.textContent = name;
    label.querySelector('small')!.textContent = type;
    const remove = document.createElement('button');
    remove.className = 'icon-btn';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${name}`);
    remove.onclick = () => toggleSelected(id);
    li.append(label, remove);
    selList.append(li);
  }
  if (ids.length > LIST_LIMIT) selList.append(listNote(`…and ${ids.length - LIST_LIMIT} more`));
}

function listNote(text: string) {
  const li = document.createElement('li');
  li.className = 'note';
  li.textContent = text;
  return li;
}

// ── Model panel ──────────────────────────────────────────────────────────────

function buildModelPanel(store: IfcDataStore) {
  modelPanel.hidden = false;
  modelInfo.textContent = `${state.fileName} · ${store.schemaVersion} · ${store.entityCount.toLocaleString()} entities`;

  // Only types that actually have geometry are worth picking.
  const types = [...store.entityIndex.byType.values()]
    .map((ids) => ({ ids: ids.filter((id) => store.entities.hasGeometry(id)), sample: ids[0] }))
    .filter((t) => t.ids.length > 0)
    .map((t) => ({ name: store.entities.getTypeName(t.sample), count: t.ids.length }))
    .sort((a, b) => a.name.localeCompare(b.name));
  typeSelect.replaceChildren(new Option('Choose a type…', ''));
  for (const t of types) typeSelect.append(new Option(`${t.name} (${t.count})`, t.name));

  treeEl.replaceChildren();
  const root = store.spatialHierarchy?.project;
  if (root) treeEl.append(treeNode(root, true));
  else treeEl.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'No spatial structure found.' }));
}

function elementsUnder(node: SpatialNode): number[] {
  return [...node.elements, ...node.children.flatMap(elementsUnder)];
}

function treeNode(node: SpatialNode, open = false): HTMLElement {
  const details = document.createElement('details');
  details.open = open;
  const summary = document.createElement('summary');
  const label = document.createElement('span');
  label.className = 'node-label';
  label.textContent = node.name || describe(node.expressId).type;
  const total = elementsUnder(node).length;
  const selectAll = document.createElement('button');
  selectAll.className = 'mini-btn';
  selectAll.textContent = `+ ${total}`;
  selectAll.title = `Add all ${total} elements in ${label.textContent} to the selection`;
  selectAll.disabled = total === 0;
  selectAll.onclick = (e) => {
    e.preventDefault();
    addToSelection(elementsUnder(node));
  };
  summary.append(label, selectAll);
  details.append(summary);

  let filled = false;
  const fill = () => {
    if (filled) return;
    filled = true;
    for (const child of node.children) details.append(treeNode(child));
    for (const id of node.elements.slice(0, LIST_LIMIT)) {
      const { type, name } = describe(id);
      const row = document.createElement('button');
      row.className = 'tree-leaf';
      row.innerHTML = `<span></span> <small></small>`;
      row.querySelector('span')!.textContent = name;
      row.querySelector('small')!.textContent = type;
      row.onclick = (e) => (e.ctrlKey || e.metaKey ? toggleSelected(id) : setSelection([id]));
      details.append(row);
    }
    if (node.elements.length > LIST_LIMIT) {
      details.append(Object.assign(document.createElement('p'), { className: 'muted small', textContent: `…and ${node.elements.length - LIST_LIMIT} more` }));
    }
  };
  if (open) fill();
  else details.addEventListener('toggle', fill, { once: true });
  return details;
}

typeSelect.onchange = () => {
  const typeName = typeSelect.value;
  typeSelect.value = '';
  if (!typeName || !state.store) return;
  const ids = new IfcQuery(state.store).ofType(typeName).execute().map((e) => e.expressId);
  addToSelection(ids.filter((id) => state.store!.entities.hasGeometry(id)));
};

// ── Loading ──────────────────────────────────────────────────────────────────

async function loadFile(file: File) {
  if (state.busy || !state.processor) return;
  if (!/\.ifc$/i.test(file.name)) {
    setStatus('Please choose an .ifc file.', true);
    return;
  }
  setBusy(true);
  state.renderer?.destroy();
  state.renderer = null;
  state.store = null;
  state.fileName = file.name;
  modelPanel.hidden = true;
  setSelection([]);

  try {
    setStatus('Reading model data…');
    // Parser and geometry each get their own buffer, so neither can detach the other's.
    const [dataBuffer, geometryBuffer] = await Promise.all([file.arrayBuffer(), file.arrayBuffer()]);
    const store = await new IfcParser().parseColumnar(dataBuffer, {
      onProgress: ({ percent }) => setStatus(`Reading model data… ${Math.round(percent)}%`),
    });

    const renderer = new Renderer(canvas);
    await renderer.init();
    state.renderer = renderer;
    resizeRenderer();

    setStatus('Building 3D geometry…');
    // Type objects can carry their own representation-map geometry, drawn as stray copies, and
    // opening elements are voids that sit in front of their doors and windows. Neither is
    // something to see or click, so they never reach the renderer.
    const isPickable = (id: number) => !/(Type|Style)$|^IfcOpeningElement$/.test(store.entities.getTypeName(id));
    for await (const event of state.processor.processStreaming(new Uint8Array(geometryBuffer))) {
      if (event.type === 'batch') {
        renderer.addMeshes(event.meshes.filter((mesh) => isPickable(mesh.expressId)), true);
        setStatus(`Building 3D geometry… ${event.totalSoFar.toLocaleString()} meshes`);
      } else if (event.type === 'complete') {
        renderer.fitToView();
      }
    }

    state.store = store;
    buildModelPanel(store);
    updateSelectionUi();
    setStatus(`${file.name} is ready. Pick some elements.`);
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : 'Could not load this IFC file.', true);
  } finally {
    setBusy(false);
  }
}

openBtn.onclick = () => fileInput.click();
fileInput.onchange = () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (file) void loadFile(file);
};
viewport.addEventListener('dragover', (e) => {
  e.preventDefault();
  viewport.classList.add('dragging');
});
viewport.addEventListener('dragleave', () => viewport.classList.remove('dragging'));
viewport.addEventListener('drop', (e) => {
  e.preventDefault();
  viewport.classList.remove('dragging');
  const file = e.dataTransfer?.files[0];
  if (file) void loadFile(file);
});

// ── Viewer: camera, picking, render loop ─────────────────────────────────────

function resizeRenderer() {
  const rect = canvas.getBoundingClientRect();
  state.renderer?.resize(Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)));
}
new ResizeObserver(resizeRenderer).observe(viewport);

/** Pointer travel (px) below which a press counts as a click rather than a drag. */
const CLICK_TOLERANCE = 4;
let drag: { lastX: number; lastY: number; startX: number; startY: number; pan: boolean } | null = null;

canvas.addEventListener('mousedown', (e) => {
  drag = { lastX: e.clientX, lastY: e.clientY, startX: e.clientX, startY: e.clientY, pan: e.button !== 0 || e.shiftKey };
});
window.addEventListener('mousemove', (e) => {
  if (!drag || !state.renderer) return;
  const camera = state.renderer.getCamera();
  const dx = e.clientX - drag.lastX;
  const dy = e.clientY - drag.lastY;
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;
  if (drag.pan) camera.pan(dx, dy);
  else camera.orbit(dx, dy);
});
window.addEventListener('mouseup', (e) => {
  if (!drag) return;
  const isClick = !drag.pan && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < CLICK_TOLERANCE;
  drag = null;
  if (isClick) void pickAt(e);
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  state.renderer?.getCamera().zoom(e.deltaY);
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.selection.size > 0) setSelection([]);
});

async function pickAt(e: MouseEvent) {
  const { renderer, store } = state;
  if (!renderer || !store) return;
  const rect = canvas.getBoundingClientRect();
  const hit = await renderer.pick(e.clientX - rect.left, e.clientY - rect.top);
  const additive = e.ctrlKey || e.metaKey;
  if (hit) additive ? toggleSelected(hit.expressId) : setSelection([hit.expressId]);
  else if (!additive) setSelection([]);
}

function frame() {
  state.renderer?.render({ selectedIds: state.selection, isolatedIds: state.preview });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ── Pluck ────────────────────────────────────────────────────────────────────

clearBtn.onclick = () => setSelection([]);
previewCheck.onchange = updatePreview;
for (const check of Object.values(optionChecks)) check.onchange = updatePreview;

pluckBtn.onclick = async () => {
  const { store, selection } = state;
  if (!store || selection.size === 0) return;
  setBusy(true);
  setStatus('Plucking…');
  // Let the status paint before the synchronous export runs.
  await new Promise((resolve) => setTimeout(resolve, 16));
  try {
    const result = pluck(store, selection, readOptions());
    const outName = `${state.fileName.replace(/\.ifc$/i, '')}-pluck.ifc`;
    download(result.content, outName);
    const notes: string[] = [];
    const withheld = result.stats.warnings.length;
    if (withheld) {
      console.info('[IFCpluck] export warnings', result.stats.warnings);
      notes.push(`${withheld} record${withheld === 1 ? ' was' : 's were'} left out to avoid broken references (details in the console).`);
    }
    if (result.truncated) notes.push('The selection has a very large web of relationships; some related entities may be missing.');
    resultEl.hidden = false;
    resultEl.textContent = `Saved ${outName}: ${selection.size} element${selection.size === 1 ? '' : 's'}, ${result.stats.entityCount.toLocaleString()} IFC entities, ${formatBytes(result.stats.fileSize)}.${notes.length ? ` Note: ${notes.join(' ')}` : ''}`;
    setStatus(`${state.fileName} is ready. Pick some elements.`);
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? `Pluck failed: ${error.message}` : 'Pluck failed.', true);
  } finally {
    setBusy(false);
  }
};

function download(bytes: Uint8Array, fileName: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/x-step' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  if (!('gpu' in navigator)) {
    setStatus('WebGPU is not available in this browser. Use a recent Chrome, Edge, Firefox or Safari.', true);
    return;
  }
  try {
    const processor = new GeometryProcessor();
    await processor.init();
    state.processor = processor;
    setBusy(false);
    setStatus('Open or drop an IFC file to start.');
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : 'Could not start the geometry engine.', true);
  }
}

void boot();
