/* =============================================
   MOSAIC PLAN MEASURE — app.js
   The Mosaic Company of Louisiana
   ============================================= */

'use strict';

// =============================================
// CONSTANTS & CONFIGURATION
// =============================================
const PRINT_DPI = 96;

const MATERIALS = {
  'lvp-floating':  { name: 'LVP Floating', color: '#534AB7', waste: 0.10, type: 'floor' },
  'wood':          { name: 'Wood',          color: '#7B4A1E', waste: 0.10, type: 'floor' },
  'tile':          { name: 'Tile',          color: '#1D9E75', waste: 0.10, type: 'floor' },
  'carpet':        { name: 'Carpet',        color: '#BA7517', waste: 0.10, type: 'floor' },
  'sheet-vinyl':   { name: 'Sheet Vinyl',   color: '#378ADD', waste: 0.10, type: 'floor' },
  'glue-down':     { name: 'Glue Down',     color: '#888780', waste: 0.10, type: 'floor' },
  'laminate':      { name: 'Laminate',      color: '#639922', waste: 0.10, type: 'floor' },
  'backsplash':    { name: 'Backsplash',    color: '#D4537E', waste: 0.15, type: 'wall',
                     heightMode: 'fixed', fixedHeight: 1.5 },
  'tub-surround':  { name: 'Tub Surround',  color: '#0F6E56', waste: 0.15, type: 'wall',
                     heightMode: 'prompt' },
  'shower-floor':  { name: 'Shower Floor',  color: '#185FA5', waste: 0.15, type: 'floor' },
  'shower-walls':  { name: 'Shower Walls',  color: '#5DCAA5', waste: 0.15, type: 'wall',
                     heightMode: 'prompt' },
  'fireplace':     { name: 'Fireplace',     color: '#E24B4A', waste: 0.10, type: 'wall',
                     heightMode: 'prompt' },
};

// Scale factor = feet per inch on paper
const SCALE_OPTIONS = [
  { label: '1" = 1\'',    factor: 1 },
  { label: '3/4" = 1\'',  factor: 4/3 },
  { label: '1/2" = 1\'',  factor: 2 },
  { label: '3/8" = 1\'',  factor: 8/3 },
  { label: '1/4" = 1\'',  factor: 4 },
  { label: '3/16" = 1\'', factor: 16/3 },
  { label: '1/8" = 1\'',  factor: 8 },
  { label: '3/32" = 1\'', factor: 32/3 },
  { label: '1/16" = 1\'', factor: 16 },
  { label: '1/32" = 1\'', factor: 32 },
];

const SNAP_RADIUS    = 14;  // pixels on canvas
const ZOOM_STEP      = 0.15;
const MIN_ZOOM       = 0.1;
const MAX_ZOOM       = 4.0;
const CLOSE_RADIUS   = 16; // px to first point to auto-close
const PAN_STEP       = 120; // px per button press

// =============================================
// STATE
// =============================================
let state = {
  // PDF
  pdfDoc:       null,
  renderScale:  1,      // canvas px per PDF pt
  viewZoom:     0.3,    // CSS transform scale

  // Job
  job: { client: '', address: '', num: '', estimator: '', date: '' },

  // Scale
  scaleFactor: 4,       // feet per inch on paper
  scaleLabel:  "1/4\" = 1'",

  // Sheets
  sheets: [{ name: 'Sheet 1', areas: [] }],
  currentSheet: 0,

  // Drawing
  currentMaterial: 'lvp-floating',
  drawing: false,
  currentPoints: [],    // { x, y } in canvas coords
  mousePos: null,

  // Snap
  snapGrid:  true,
  snapPoint: true,

  // Undo stack
  undoStack: [],        // array of serialized states

  // Pan
  panMode:   false,
  panning:   false,
  panStart:  null,
  panScroll: null,
};

// =============================================
// DOM REFERENCES
// =============================================
const $ = id => document.getElementById(id);

const uploadScreen  = $('upload-screen');
const editorScreen  = $('editor-screen');
const printView     = $('print-view');

const pdfInput      = $('pdf-input');
const loadInput     = $('load-input');
const scaleSelect   = $('scale-select');

const pdfCanvas     = $('pdf-canvas');
const overlayCanvas = $('overlay-canvas');
const pdfCtx        = pdfCanvas.getContext('2d');
const overlayCtx    = overlayCanvas.getContext('2d');

const snapDot       = $('snap-dot');
const canvasContainer = $('canvas-container');
const canvasWrapper   = $('canvas-wrapper');

const materialSelect = $('material-select');
const materialSwatch = $('material-swatch');
const scaleDisplay   = $('scale-display');
const sheetSelect    = $('sheet-select');
const zoomDisplay    = $('zoom-display');
const areaList       = $('area-list');
const totalsPanel    = $('totals-panel');
const areaCount      = $('area-count');
const statusMsg      = $('status-msg');
const statusCoords   = $('status-coords');

// Modals
const heightModal     = $('height-modal');
const heightTitle     = $('height-modal-title');
const heightDesc      = $('height-modal-desc');
const heightFt        = $('height-ft');
const heightIn        = $('height-in');
const heightCancel    = $('height-cancel');
const heightConfirm   = $('height-confirm');

const nameModal       = $('name-modal');
const areaNameInput   = $('area-name-input');
const nameCancel      = $('name-cancel');
const nameConfirm     = $('name-confirm');

// Print canvases
const printPdfCanvas     = $('print-pdf-canvas');
const printOverlayCanvas = $('print-overlay-canvas');

// =============================================
// SCALE UTILITIES
// =============================================
function pixelsPerFoot() {
  // 1 foot on paper = 1/scaleFactor inch = 72/scaleFactor PDF pts = (72*renderScale)/scaleFactor px
  return (72 * state.renderScale) / state.scaleFactor;
}

function pxToFeet(px) {
  return px / pixelsPerFoot();
}

function feetToFtIn(ft) {
  const totalIn = Math.round(ft * 12);
  const f = Math.floor(totalIn / 12);
  const i = totalIn % 12;
  return i === 0 ? `${f}'-0"` : `${f}'-${i}"`;
}

function feetToDecimal(ft) {
  return Math.round(ft * 100) / 100;
}

// =============================================
// POLYGON GEOMETRY
// =============================================
function polygonAreaPx2(pts) {
  // Shoelace formula
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

function pxAreaToSqFt(areaPx2) {
  const ppf = pixelsPerFoot();
  return areaPx2 / (ppf * ppf);
}

function boundingDimensions(pts) {
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  const wPx = Math.max(...xs) - Math.min(...xs);
  const hPx = Math.max(...ys) - Math.min(...ys);
  return { w: pxToFeet(wPx), h: pxToFeet(hPx) };
}

function polylineLengthPx(pts) {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i+1].x - pts[i].x;
    const dy = pts[i+1].y - pts[i].y;
    len += Math.sqrt(dx*dx + dy*dy);
  }
  return len;
}

// Centroid for label placement
function centroid(pts) {
  const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return { x, y };
}

// =============================================
// SNAP SYSTEM
// =============================================
function gridSize() {
  // Snap to 6-inch increments
  return pixelsPerFoot() * 0.5;
}

function applySnap(x, y) {
  let sx = x, sy = y;
  let snapped = false;

  // Point snap — check all existing polygon points across all areas
  if (state.snapPoint) {
    const allAreas = state.sheets[state.currentSheet].areas;
    const curPts   = state.currentPoints;
    const candidates = [];
    allAreas.forEach(a => a.points.forEach(p => candidates.push(p)));
    curPts.forEach(p => candidates.push(p));

    for (const p of candidates) {
      const dx = x - p.x, dy = y - p.y;
      if (Math.sqrt(dx*dx + dy*dy) < SNAP_RADIUS) {
        sx = p.x; sy = p.y; snapped = true;
        break;
      }
    }
  }

  // Grid snap (only if no point snap hit)
  if (!snapped && state.snapGrid) {
    const g = gridSize();
    sx = Math.round(x / g) * g;
    sy = Math.round(y / g) * g;
    snapped = true;
  }

  return { x: sx, y: sy, snapped };
}

// =============================================
// CANVAS MOUSE COORDINATES (cached rect for perf)
// =============================================
let _cachedRect = null;
let _rectTime   = 0;

function getRect() {
  const now = Date.now();
  if (!_cachedRect || now - _rectTime > 150) {
    _cachedRect = overlayCanvas.getBoundingClientRect();
    _rectTime   = now;
  }
  return _cachedRect;
}

function invalidateRect() { _cachedRect = null; }

function canvasCoords(e) {
  const rect = getRect();
  const scaleX = overlayCanvas.width  / rect.width;
  const scaleY = overlayCanvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top)  * scaleY,
  };
}

// RAF-throttled redraw
let _rafPending = false;
function scheduleRedraw() {
  if (_rafPending) return;
  _rafPending = true;
  requestAnimationFrame(() => { redraw(); _rafPending = false; });
}

// =============================================
// DRAWING — OVERLAY CANVAS
// =============================================
function redraw() {
  const w = overlayCanvas.width;
  const h = overlayCanvas.height;
  overlayCtx.clearRect(0, 0, w, h);

  // Draw completed areas
  const areas = state.sheets[state.currentSheet].areas;
  areas.forEach(area => drawArea(overlayCtx, area, false));

  // Draw current polygon in progress
  if (state.drawing && state.currentPoints.length > 0) {
    const mat = MATERIALS[state.currentMaterial];
    const pts = state.currentPoints;

    overlayCtx.beginPath();
    overlayCtx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach(p => overlayCtx.lineTo(p.x, p.y));
    if (state.mousePos) overlayCtx.lineTo(state.mousePos.x, state.mousePos.y);

    overlayCtx.strokeStyle = mat.color;
    overlayCtx.lineWidth = 1.5;
    overlayCtx.setLineDash([6, 3]);
    overlayCtx.stroke();
    overlayCtx.setLineDash([]);

    // Draw corner dots
    pts.forEach((p, i) => {
      overlayCtx.beginPath();
      overlayCtx.arc(p.x, p.y, i === 0 ? 5 : 3, 0, Math.PI * 2);
      overlayCtx.fillStyle = i === 0 ? '#ff6600' : mat.color;
      overlayCtx.fill();
    });
  }
}

function drawArea(ctx, area, forPrint) {
  const mat = MATERIALS[area.material];
  const pts = area.points;
  if (!pts || pts.length < 2) return;

  const hex = mat.color;
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);

  // Fill polygon
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.fillStyle = `rgba(${r},${g},${b},0.18)`;
  ctx.fill();
  ctx.strokeStyle = mat.color;
  ctx.lineWidth = forPrint ? 1.2 : 1.5;
  ctx.stroke();

  // Corner dots
  pts.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, forPrint ? 2 : 2.5, 0, Math.PI * 2);
    ctx.fillStyle = mat.color;
    ctx.fill();
  });

  // Label in centroid
  const ctr = centroid(pts);
  const fontSize = Math.max(forPrint ? 8 : 11, Math.min(forPrint ? 11 : 14, pixelsPerFoot() * 0.6));

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Dimension line 1
  ctx.font = `500 ${fontSize}px monospace`;
  ctx.fillStyle = darken(mat.color, 0.3);
  ctx.fillText(area.dimLabel1, ctr.x, ctr.y - fontSize * 0.7);

  // SF line
  ctx.font = `${fontSize * 0.9}px monospace`;
  ctx.fillStyle = mat.color;
  ctx.fillText(area.sfLabel, ctr.x, ctr.y + fontSize * 0.5);
}

function darken(hex, amt) {
  const r = Math.max(0, parseInt(hex.slice(1,3),16) - Math.round(255*amt));
  const g = Math.max(0, parseInt(hex.slice(3,5),16) - Math.round(255*amt));
  const b = Math.max(0, parseInt(hex.slice(5,7),16) - Math.round(255*amt));
  return `rgb(${r},${g},${b})`;
}

// =============================================
// AREA FINALIZATION
// =============================================
let _heightResolve = null;
let _nameResolve   = null;

function promptHeight(materialKey) {
  const mat = MATERIALS[materialKey];
  return new Promise(resolve => {
    if (mat.heightMode === 'fixed') {
      resolve(mat.fixedHeight);
      return;
    }
    if (mat.type === 'floor') {
      resolve(null); // no height needed
      return;
    }
    // Prompt
    heightTitle.textContent = `${mat.name} — Wall Height`;
    heightDesc.textContent  = `Enter the height of the ${mat.name.toLowerCase()} surface.`;
    heightFt.value = '';
    heightIn.value = '';
    heightModal.classList.remove('hidden');
    heightFt.focus();
    _heightResolve = resolve;
  });
}

function promptName() {
  return new Promise(resolve => {
    areaNameInput.value = '';
    nameModal.classList.remove('hidden');
    areaNameInput.focus();
    _nameResolve = resolve;
  });
}

function buildAreaLabels(area) {
  const mat = MATERIALS[area.material];
  if (mat.type === 'floor') {
    const dims = boundingDimensions(area.points);
    const sqFt = pxAreaToSqFt(polygonAreaPx2(area.points));
    area.dimLabel1 = `${feetToFtIn(dims.w)} × ${feetToFtIn(dims.h)}`;
    area.sfLabel   = `${Math.round(sqFt)} sf`;
    area.netSqFt   = sqFt;
    area.totalSqFt = sqFt * (1 + mat.waste);
  } else {
    // Wall — length × height
    const lengthPx = polylineLengthPx(area.points);
    const lengthFt = pxToFeet(lengthPx);
    const heightFtVal = area.wallHeight || 0;
    const sqFt = lengthFt * heightFtVal;
    area.dimLabel1 = `${feetToFtIn(lengthFt)} × ${feetToFtIn(heightFtVal)} H`;
    area.sfLabel   = `${Math.round(sqFt)} sf`;
    area.netSqFt   = sqFt;
    area.totalSqFt = sqFt * (1 + mat.waste);
  }
}

async function finalizePolygon(points) {
  if (points.length < 2) return;

  // Save undo snapshot BEFORE adding
  pushUndo();

  const materialKey = state.currentMaterial;
  const mat = MATERIALS[materialKey];

  // Get wall height if needed
  let wallHeight = null;
  if (mat.type === 'wall') {
    wallHeight = await promptHeight(materialKey);
    if (wallHeight === null && mat.heightMode !== 'fixed') {
      // Cancelled
      return;
    }
  }

  // Get area name
  const name = await promptName();
  if (name === null) return; // cancelled

  const area = {
    id:         Date.now(),
    name:       name || mat.name,
    material:   materialKey,
    points:     points.map(p => ({ ...p })),
    wallHeight: wallHeight,
    dimLabel1:  '',
    sfLabel:    '',
    netSqFt:    0,
    totalSqFt:  0,
  };

  buildAreaLabels(area);

  state.sheets[state.currentSheet].areas.push(area);
  state.drawing = false;
  state.currentPoints = [];

  redraw();
  updateSidebar();
  setStatus('Area added. Click to trace the next area.');
}

// =============================================
// UNDO
// =============================================
function pushUndo() {
  const snapshot = JSON.stringify(state.sheets[state.currentSheet].areas.map(a => ({
    ...a,
    points: a.points.map(p => ({ ...p }))
  })));
  state.undoStack.push(snapshot);
  if (state.undoStack.length > 50) state.undoStack.shift();
}

function undo() {
  if (state.drawing) {
    // Undo last point
    if (state.currentPoints.length > 0) {
      state.currentPoints.pop();
      if (state.currentPoints.length === 0) {
        state.drawing = false;
        setStatus('Select a material, then click on the plan to start tracing an area.');
      }
      redraw();
    }
    return;
  }
  if (state.undoStack.length === 0) return;
  const prev = JSON.parse(state.undoStack.pop());
  state.sheets[state.currentSheet].areas = prev;
  // Rebuild labels
  state.sheets[state.currentSheet].areas.forEach(a => buildAreaLabels(a));
  redraw();
  updateSidebar();
}

// =============================================
// SIDEBAR & TOTALS
// =============================================
function updateSidebar() {
  const areas = state.sheets[state.currentSheet].areas;
  areaCount.textContent = areas.length;

  // Area list
  areaList.innerHTML = '';
  areas.forEach(area => {
    const mat = MATERIALS[area.material];
    const div = document.createElement('div');
    div.className = 'area-item';
    div.innerHTML = `
      <div class="area-item-swatch" style="background:${mat.color}"></div>
      <div class="area-item-info">
        <div class="area-item-name">${area.name}</div>
        <div class="area-item-detail">${mat.name} &bull; ${area.dimLabel1} &bull; ${Math.round(area.netSqFt)} sf net</div>
      </div>
      <button class="area-item-del" data-id="${area.id}" title="Delete">&#x2715;</button>
    `;
    div.querySelector('.area-item-del').addEventListener('click', e => {
      e.stopPropagation();
      pushUndo();
      const id = parseInt(e.target.dataset.id);
      state.sheets[state.currentSheet].areas =
        state.sheets[state.currentSheet].areas.filter(a => a.id !== id);
      redraw();
      updateSidebar();
    });
    areaList.appendChild(div);
  });

  // Totals
  renderTotals(totalsPanel, areas, false);
}

function renderTotals(container, areas, forPrint) {
  // Group by material
  const groups = {};
  areas.forEach(area => {
    const key = area.material;
    if (!groups[key]) groups[key] = { netSqFt: 0, totalSqFt: 0, mat: MATERIALS[key] };
    groups[key].netSqFt   += area.netSqFt;
    groups[key].totalSqFt += area.totalSqFt;
  });

  const totalNet   = areas.reduce((s, a) => s + a.netSqFt, 0);
  const totalMat   = areas.reduce((s, a) => s + a.totalSqFt, 0);

  if (!forPrint) {
    // Sidebar compact totals
    let html = '';
    Object.entries(groups).forEach(([key, g]) => {
      html += `<div class="totals-row">
        <span>${g.mat.name}</span>
        <span>${Math.round(g.totalSqFt)} sf</span>
      </div>`;
    });
    html += `<div class="totals-row main">
      <span>Working area</span><span>${Math.round(totalNet)} sf</span>
    </div>
    <div class="totals-row main">
      <span>Material needed</span><span>${Math.round(totalMat)} sf</span>
    </div>`;
    container.innerHTML = html;
  } else {
    // Print table — detailed
    let html = '';
    const ORDER = ['lvp-floating','wood','tile','carpet','sheet-vinyl','glue-down','laminate',
                   'backsplash','tub-surround','shower-floor','shower-walls','fireplace'];

    ORDER.forEach(key => {
      const areasOfType = areas.filter(a => a.material === key);
      if (areasOfType.length === 0) return;
      const mat = MATERIALS[key];
      const hex = mat.color;
      const r = parseInt(hex.slice(1,3),16);
      const g2 = parseInt(hex.slice(3,5),16);
      const b = parseInt(hex.slice(5,7),16);

      html += `<div style="margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:5px;border-bottom:1px solid #ccc;padding-bottom:3px;margin-bottom:3px;">
          <div style="width:8px;height:8px;border-radius:2px;background:${mat.color};flex-shrink:0;"></div>
          <span style="font-size:7pt;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">${mat.name}</span>
          <span style="font-size:6pt;color:#777;">(+${Math.round(mat.waste*100)}% waste)</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:7pt;">
          <thead>
            <tr style="color:#888;">
              <th style="text-align:left;padding:1px 3px;font-weight:400;">Area</th>
              <th style="text-align:left;padding:1px 3px;font-weight:400;">Dim</th>
              <th style="text-align:right;padding:1px 3px;font-weight:400;">Net&nbsp;SF</th>
              <th style="text-align:right;padding:1px 3px;font-weight:400;">Total&nbsp;SF</th>
            </tr>
          </thead>
          <tbody>
            ${areasOfType.map(a => `
              <tr style="border-top:0.5px solid #e8e8e8;">
                <td style="padding:2px 3px;">${a.name}</td>
                <td style="padding:2px 3px;font-family:monospace;font-size:6.5pt;">${a.dimLabel1}</td>
                <td style="text-align:right;padding:2px 3px;">${Math.round(a.netSqFt)}</td>
                <td style="text-align:right;padding:2px 3px;font-weight:500;">${Math.round(a.totalSqFt)}</td>
              </tr>`).join('')}
            <tr style="border-top:1px solid #bbb;">
              <td colspan="2" style="padding:2px 3px;font-style:italic;color:#666;font-size:6pt;">Subtotal</td>
              <td style="text-align:right;padding:2px 3px;">${Math.round(areasOfType.reduce((s,a)=>s+a.netSqFt,0))}</td>
              <td style="text-align:right;padding:2px 3px;font-weight:600;">${Math.round(areasOfType.reduce((s,a)=>s+a.totalSqFt,0))}</td>
            </tr>
          </tbody>
        </table>
      </div>`;
    });

    // Grand total
    html += `<div style="border-top:1.5px solid #333;margin-top:8px;padding-top:6px;">
      <div style="display:flex;justify-content:space-between;font-size:7.5pt;color:#555;margin-bottom:3px;">
        <span>Total working area</span><span>${Math.round(totalNet)} sf</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:8pt;font-weight:700;">
        <span>Total material needed</span><span>${Math.round(totalMat)} sf</span>
      </div>
    </div>`;

    container.innerHTML = html;
  }
}

// =============================================
// STATUS BAR
// =============================================
function setStatus(msg) {
  statusMsg.textContent = msg;
}

function updateCoords(x, y) {
  const ft = pxToFeet;
  const xFt = feetToDecimal(pxToFeet(x));
  const yFt = feetToDecimal(pxToFeet(y));
  statusCoords.textContent = `${xFt}' × ${yFt}'`;
}

// =============================================
// PDF LOADING & RENDERING
// =============================================
async function loadPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  state.pdfDoc = pdf;
  state.sheets[state.currentSheet].pdfData = arrayBuffer;

  await renderPDFPage(1);

  // Switch to editor
  uploadScreen.classList.add('hidden');
  editorScreen.classList.remove('hidden');

  // Populate job date
  if (!state.job.date) {
    const d = new Date();
    state.job.date = d.toLocaleDateString('en-US');
  }

  updateSheetSelector();
  fitZoom();
  setStatus('Plan loaded. Select a material and click corners to trace an area. Double-click or click the first point to close.');
}

async function renderPDFPage(pageNum) {
  const page = await state.pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });

  // Compute render scale to hit PRINT_DPI
  // PDF native is 72 dpi
  state.renderScale = PRINT_DPI / 72;

  const scaledViewport = page.getViewport({ scale: state.renderScale });
  const w = Math.round(scaledViewport.width);
  const h = Math.round(scaledViewport.height);

  // Size both canvases
  pdfCanvas.width     = w;
  pdfCanvas.height    = h;
  overlayCanvas.width  = w;
  overlayCanvas.height = h;
  printPdfCanvas.width     = w;
  printPdfCanvas.height    = h;
  printOverlayCanvas.width  = w;
  printOverlayCanvas.height = h;

  await page.render({ canvasContext: pdfCtx, viewport: scaledViewport }).promise;

  // Set @page size for printing
  const pageWIn = viewport.width  / 72;  // inches
  const pageHIn = viewport.height / 72;
  setPageSize(pageWIn, pageHIn);

  redraw();
}

function setPageSize(wIn, hIn) {
  let styleEl = document.getElementById('print-page-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'print-page-style';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `@media print { @page { size: ${wIn.toFixed(2)}in ${hIn.toFixed(2)}in; margin: 0.2in; } }`;
}

// =============================================
// ZOOM
// =============================================
function applyZoom() {
  canvasContainer.style.transform = `scale(${state.viewZoom})`;
  zoomDisplay.textContent = `${Math.round(state.viewZoom * 100)}%`;

  // Adjust wrapper min size so scrollbars appear when zoomed in
  const w = pdfCanvas.width  * state.viewZoom;
  const h = pdfCanvas.height * state.viewZoom;
  canvasContainer.style.width  = pdfCanvas.width  + 'px';
  canvasContainer.style.height = pdfCanvas.height + 'px';
}

function fitZoom() {
  const ww = canvasWrapper.clientWidth  - 40;
  const wh = canvasWrapper.clientHeight - 40;
  const cw = pdfCanvas.width;
  const ch = pdfCanvas.height;
  state.viewZoom = Math.min(ww / cw, wh / ch, 1);
  applyZoom();
}

// =============================================
// CANVAS INTERACTION
// =============================================
overlayCanvas.addEventListener('mousemove', e => {
  if (!state.pdfDoc) return;

  // If panning via drag, handle scroll
  if (state.panning) {
    const dx = e.clientX - state.panStart.x;
    const dy = e.clientY - state.panStart.y;
    canvasWrapper.scrollLeft = state.panScroll.x - dx;
    canvasWrapper.scrollTop  = state.panScroll.y - dy;
    return;
  }

  if (state.panMode) return; // cursor shows grab, no drawing

  const raw     = canvasCoords(e);
  const snapped = applySnap(raw.x, raw.y);
  state.mousePos = snapped;
  updateCoords(snapped.x, snapped.y);

  // Snap dot — positioned in canvas-pixel coords (transform handles visual placement)
  snapDot.style.left = snapped.x + 'px';
  snapDot.style.top  = snapped.y + 'px';
  snapDot.classList.toggle('hidden', !snapped.snapped);

  if (state.drawing && state.currentPoints.length >= 3) {
    const fp = state.currentPoints[0];
    const dx = snapped.x - fp.x, dy = snapped.y - fp.y;
    if (Math.sqrt(dx*dx + dy*dy) < CLOSE_RADIUS) {
      setStatus(`Click to close the shape (${state.currentPoints.length} points)`);
    } else {
      setStatus(`${state.currentPoints.length} pts — click to add, double-click or click first point to close`);
    }
  }

  if (state.drawing) scheduleRedraw();
});

overlayCanvas.addEventListener('mousedown', e => {
  if (!state.pdfDoc) return;
  if (state.panMode) {
    state.panning   = true;
    state.panStart  = { x: e.clientX, y: e.clientY };
    state.panScroll = { x: canvasWrapper.scrollLeft, y: canvasWrapper.scrollTop };
    overlayCanvas.style.cursor = 'grabbing';
    e.preventDefault();
  }
});

document.addEventListener('mouseup', () => {
  if (state.panning) {
    state.panning = false;
    overlayCanvas.style.cursor = state.panMode ? 'grab' : 'crosshair';
  }
});

overlayCanvas.addEventListener('click', async e => {
  if (!state.pdfDoc || state.panMode || state.panning) return;
  const raw     = canvasCoords(e);
  const snapped = applySnap(raw.x, raw.y);
  const pt      = { x: snapped.x, y: snapped.y };

  if (!state.drawing) {
    state.drawing = true;
    state.currentPoints = [pt];
    setStatus('Click to add points. Double-click or click first point to close.');
    scheduleRedraw();
    return;
  }

  if (state.currentPoints.length >= 3) {
    const fp = state.currentPoints[0];
    const dx = pt.x - fp.x, dy = pt.y - fp.y;
    if (Math.sqrt(dx*dx + dy*dy) < CLOSE_RADIUS) {
      const pts = [...state.currentPoints];
      state.currentPoints = [];
      state.drawing = false;
      await finalizePolygon(pts);
      return;
    }
  }

  state.currentPoints.push(pt);
  scheduleRedraw();
});

overlayCanvas.addEventListener('dblclick', async e => {
  if (!state.drawing || !state.pdfDoc || state.panMode) return;
  e.preventDefault();
  if (state.currentPoints.length > 1) state.currentPoints.pop();
  if (state.currentPoints.length < 2) return;
  const pts = [...state.currentPoints];
  state.currentPoints = [];
  state.drawing = false;
  await finalizePolygon(pts);
});

overlayCanvas.addEventListener('mouseleave', () => {
  state.mousePos = null;
  if (!state.panning) snapDot.classList.add('hidden');
  if (state.drawing) scheduleRedraw();
});

// Space = pan mode toggle
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !e.target.matches('input, textarea')) {
    e.preventDefault();
    if (!state.panMode) activatePan();
  }
  if (e.key === 'Escape') {
    if (state.panMode) { deactivatePan(); return; }
    if (state.drawing) {
      state.drawing = false;
      state.currentPoints = [];
      scheduleRedraw();
      setStatus('Cancelled. Select a material and click to start tracing.');
    }
  }
});

document.addEventListener('keyup', e => {
  if (e.code === 'Space') deactivatePan();
});

function activatePan() {
  state.panMode = true;
  overlayCanvas.style.cursor = 'grab';
  $('pan-mode-btn').classList.add('active');
}
function deactivatePan() {
  state.panMode  = false;
  state.panning  = false;
  overlayCanvas.style.cursor = 'crosshair';
  $('pan-mode-btn').classList.remove('active');
}

function panBy(dx, dy) {
  canvasWrapper.scrollLeft += dx;
  canvasWrapper.scrollTop  += dy;
}

// =============================================
// MODAL HANDLERS
// =============================================
heightConfirm.addEventListener('click', () => {
  const ft = parseFloat(heightFt.value) || 0;
  const ins = parseFloat(heightIn.value) || 0;
  const total = ft + ins / 12;
  heightModal.classList.add('hidden');
  if (_heightResolve) { _heightResolve(total); _heightResolve = null; }
});

heightCancel.addEventListener('click', () => {
  heightModal.classList.add('hidden');
  if (_heightResolve) { _heightResolve(null); _heightResolve = null; }
});

nameConfirm.addEventListener('click', () => {
  const name = areaNameInput.value.trim();
  nameModal.classList.add('hidden');
  if (_nameResolve) { _nameResolve(name || null); _nameResolve = null; }
});

nameCancel.addEventListener('click', () => {
  nameModal.classList.add('hidden');
  if (_nameResolve) { _nameResolve(null); _nameResolve = null; }
  // Also cancel the polygon
  state.drawing = false;
  state.currentPoints = [];
  redraw();
});

areaNameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') nameConfirm.click();
  if (e.key === 'Escape') nameCancel.click();
});

heightFt.addEventListener('keydown', e => { if (e.key === 'Enter') heightConfirm.click(); });
heightIn.addEventListener('keydown', e => { if (e.key === 'Enter') heightConfirm.click(); });

// =============================================
// TOOLBAR HANDLERS
// =============================================
materialSelect.addEventListener('change', () => {
  state.currentMaterial = materialSelect.value;
  const mat = MATERIALS[state.currentMaterial];
  materialSwatch.style.background = mat.color;
});

$('zoom-in-btn').addEventListener('click', () => {
  state.viewZoom = Math.min(MAX_ZOOM, state.viewZoom + ZOOM_STEP);
  applyZoom(); invalidateRect();
});

$('zoom-out-btn').addEventListener('click', () => {
  state.viewZoom = Math.max(MIN_ZOOM, state.viewZoom - ZOOM_STEP);
  applyZoom(); invalidateRect();
});

$('zoom-fit-btn').addEventListener('click', () => { fitZoom(); invalidateRect(); });

$('pan-mode-btn').addEventListener('click', () => {
  state.panMode ? deactivatePan() : activatePan();
});

$('pan-up-btn').addEventListener('click',    () => panBy(0, -PAN_STEP));
$('pan-down-btn').addEventListener('click',  () => panBy(0,  PAN_STEP));
$('pan-left-btn').addEventListener('click',  () => panBy(-PAN_STEP, 0));
$('pan-right-btn').addEventListener('click', () => panBy( PAN_STEP, 0));

$('snap-grid-btn').addEventListener('click', () => {
  state.snapGrid = !state.snapGrid;
  $('snap-grid-btn').classList.toggle('active', state.snapGrid);
});

$('snap-point-btn').addEventListener('click', () => {
  state.snapPoint = !state.snapPoint;
  $('snap-point-btn').classList.toggle('active', state.snapPoint);
});

$('undo-btn').addEventListener('click', undo);

// Zoom with mouse wheel (Ctrl+wheel) — plain wheel = scroll
canvasWrapper.addEventListener('wheel', e => {
  if (!e.ctrlKey && !e.metaKey) return; // allow normal scroll without ctrl
  e.preventDefault();
  const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
  state.viewZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.viewZoom + delta));
  applyZoom(); invalidateRect();
}, { passive: false });

// Invalidate rect on scroll too
canvasWrapper.addEventListener('scroll', invalidateRect, { passive: true });
window.addEventListener('resize', () => { invalidateRect(); fitZoom(); });

// =============================================
// SHEET MANAGEMENT
// =============================================
function updateSheetSelector() {
  sheetSelect.innerHTML = '';
  state.sheets.forEach((s, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = s.name;
    sheetSelect.appendChild(opt);
  });
  sheetSelect.value = state.currentSheet;
}

sheetSelect.addEventListener('change', async () => {
  state.currentSheet = parseInt(sheetSelect.value);
  const sheet = state.sheets[state.currentSheet];
  if (sheet.pdfData && state.pdfDoc) {
    // Re-render if different page data available
  }
  state.drawing = false;
  state.currentPoints = [];
  redraw();
  updateSidebar();
});

$('add-sheet-btn').addEventListener('click', () => {
  const name = prompt('Sheet name:', `Sheet ${state.sheets.length + 1}`);
  if (!name) return;
  state.sheets.push({ name, areas: [] });
  state.currentSheet = state.sheets.length - 1;
  updateSheetSelector();
  state.drawing = false;
  state.currentPoints = [];
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  updateSidebar();
});

// =============================================
// PDF UPLOAD
// =============================================
// Scale selection on upload screen carries over
scaleSelect.addEventListener('change', () => {
  const val = parseFloat(scaleSelect.value);
  state.scaleFactor = val;
  const opt = scaleSelect.options[scaleSelect.selectedIndex];
  state.scaleLabel = opt.text;
  scaleDisplay.textContent = opt.text;
  // Rebuild labels for existing areas
  state.sheets.forEach(sheet => sheet.areas.forEach(a => buildAreaLabels(a)));
  redraw();
  updateSidebar();
});

// Drag and drop
const dropzone = $('upload-dropzone');
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.style.borderColor = '#1a4a8a'; });
dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = ''; });
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.style.borderColor = '';
  const file = e.dataTransfer.files[0];
  if (file && file.type === 'application/pdf') {
    collectJobInfo();
    loadPDF(file);
  }
});

function collectJobInfo() {
  state.job.client    = $('job-client').value.trim();
  state.job.address   = $('job-address').value.trim();
  state.job.num       = $('job-num').value.trim();
  state.job.estimator = $('job-estimator').value.trim();
  state.job.date      = new Date().toLocaleDateString('en-US');
  state.scaleFactor   = parseFloat(scaleSelect.value);
  state.scaleLabel    = scaleSelect.options[scaleSelect.selectedIndex].text;
  scaleDisplay.textContent = state.scaleLabel;
}

pdfInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) { collectJobInfo(); loadPDF(file); }
});

// =============================================
// SAVE / LOAD
// =============================================
$('save-btn').addEventListener('click', () => {
  const data = {
    version: 1,
    job:     state.job,
    scaleFactor: state.scaleFactor,
    scaleLabel:  state.scaleLabel,
    sheets: state.sheets.map(s => ({
      name:  s.name,
      areas: s.areas.map(a => ({
        ...a,
        points: a.points.map(p => ({ x: p.x, y: p.y }))
      }))
    })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `mosaic-${state.job.num || 'session'}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

loadInput.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const data = JSON.parse(text);
  state.job         = data.job || {};
  state.scaleFactor = data.scaleFactor || 4;
  state.scaleLabel  = data.scaleLabel  || "1/4\" = 1'";
  state.sheets      = data.sheets.map(s => ({
    name:  s.name,
    areas: s.areas.map(a => {
      const area = { ...a, points: a.points.map(p => ({ ...p })) };
      buildAreaLabels(area);
      return area;
    })
  }));
  state.currentSheet = 0;

  // If there's a PDF reference, prompt for re-upload
  alert('Session loaded. Please re-upload the original PDF to continue.');
  uploadScreen.classList.remove('hidden');
  editorScreen.classList.add('hidden');

  // Pre-fill job fields
  $('job-client').value    = state.job.client    || '';
  $('job-address').value   = state.job.address   || '';
  $('job-num').value       = state.job.num       || '';
  $('job-estimator').value = state.job.estimator || '';
  scaleDisplay.textContent = state.scaleLabel;
});

// =============================================
// PRINT
// =============================================
$('print-btn').addEventListener('click', preparePrint);

async function preparePrint() {
  const areas = [];
  state.sheets.forEach(s => areas.push(...s.areas));
  if (areas.length === 0) {
    alert('No areas measured yet. Add at least one area before printing.');
    return;
  }

  // Render print PDF canvas (same as screen canvas since same renderScale)
  const printPdfCtx = printPdfCanvas.getContext('2d');
  printPdfCtx.drawImage(pdfCanvas, 0, 0);

  // Render print overlay
  const printOvCtx = printOverlayCanvas.getContext('2d');
  printOvCtx.clearRect(0, 0, printOverlayCanvas.width, printOverlayCanvas.height);
  areas.forEach(area => drawArea(printOvCtx, area, true));

  // Build header
  const j = state.job;
  $('pv-header').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div>
        <div style="font-size:11pt;font-weight:700;">The Mosaic Company of Louisiana</div>
        <div style="font-size:9pt;color:#444;margin-top:2px;">Floor Plan &amp; Material Takeoff</div>
      </div>
      <div style="text-align:right;font-size:8pt;color:#555;">
        <div><strong>Client:</strong> ${j.client || '—'}</div>
        <div><strong>Address:</strong> ${j.address || '—'}</div>
        <div><strong>Job #:</strong> ${j.num || '—'} &nbsp; <strong>By:</strong> ${j.estimator || '—'}</div>
        <div><strong>Scale:</strong> ${state.scaleLabel} &nbsp; <strong>Date:</strong> ${j.date || '—'}</div>
      </div>
    </div>
  `;

  // Build table
  renderTotals($('pv-table'), areas, true);

  // Build footer — legend
  const legendHtml = Object.entries(MATERIALS)
    .filter(([key]) => areas.some(a => a.material === key))
    .map(([key, mat]) =>
      `<span style="display:inline-flex;align-items:center;gap:3px;margin-right:10px;">
        <span style="width:8px;height:8px;border-radius:2px;background:${mat.color};display:inline-block;"></span>
        ${mat.name}
      </span>`
    ).join('');

  $('pv-footer').innerHTML = `
    <div>${legendHtml}</div>
    <div>Print at 100% scale — no fit to page — verify with architect's scale</div>
  `;

  window.print();
}

// =============================================
// INIT
// =============================================
function init() {
  // Set initial material swatch
  materialSwatch.style.background = MATERIALS['lvp-floating'].color;

  // scaleDisplay
  scaleDisplay.textContent = state.scaleLabel;

  // Initial sheet selector
  updateSheetSelector();

  // Sidebar empty state
  updateSidebar();

  setStatus('Upload a PDF architectural plan to begin.');
}

init();
