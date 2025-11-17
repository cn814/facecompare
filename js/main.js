import { DEBUG, debug, downscaleImageToCanvas } from './utils.js';
import { faceService } from './face-service.js';
import { detectSunglassesFast } from './sunglasses.js';
import { createCanvasForImage, placeFaceBox, drawLandmarksOnCanvas } from './ui.js';
import { computeSimilarity } from './comparison.js';

const loadingText = document.getElementById('loadingText');
const loadingProgress = document.getElementById('loadingProgress');
const loadingStatus = document.getElementById('loadingStatus');
const mainApp = document.getElementById('mainApp');
const fileInput1 = document.getElementById('fileInput1');
const fileInput2 = document.getElementById('fileInput2');
const uploadArea1 = document.getElementById('uploadArea1');
const uploadArea2 = document.getElementById('uploadArea2');
const preview1 = document.getElementById('preview1');
const preview2 = document.getElementById('preview2');
const compareBtn = document.getElementById('compareBtn');
const resultsDiv = document.getElementById('results');
const debugToggle = document.getElementById('debugToggle');
const clearBtn = document.getElementById('clearBtn');

let reference = { image: null, faces: [], selectedIndex: 0, canvas: null, wrapper: null };
let comparisons = [];
let comparisonResults = [];

async function boot() {
  try {
    await faceService.loadModels((p, txt) => {
      loadingProgress.style.width = p + '%';
      loadingText.textContent = txt;
    });
    setTimeout(() => {
      loadingStatus.classList.add('hidden');
      mainApp.classList.remove('hidden');
    }, 300);
  } catch (e) {
    loadingText.innerHTML = `<span style="color:red">Error loading models: ${e.message}</span>`;
  }
}

function setDisabledState() {
  const totalFaces = comparisons.reduce((s, c) => s + (c.faces ? c.faces.length : 0), 0);
  compareBtn.disabled = !(reference.faces.length && totalFaces > 0);
  compareBtn.textContent = compareBtn.disabled
    ? 'Upload Photos to Compare'
    : `Compare Against ${totalFaces} Face${totalFaces > 1 ? 's' : ''}`;
}

function setupUI() {
  ;[uploadArea1, uploadArea2].forEach(area => {
    area.addEventListener('dragover', e => {
      e.preventDefault();
      area.classList.add('dragover');
    });
    area.addEventListener('dragleave', e => {
      e.preventDefault();
      area.classList.remove('dragover');
    });
    area.addEventListener('drop', async e => {
      e.preventDefault();
      area.classList.remove('dragover');
      const files = Array.from(e.dataTransfer.files);
      if (area.dataset.target === '1') await handleReference(files[0]);
      else await handleComparisons(files);
    });
  });

  fileInput1.addEventListener('change', async e => {
    if (e.target.files[0]) await handleReference(e.target.files[0]);
  });
  fileInput2.addEventListener('change', async e => {
    if (e.target.files.length) await handleComparisons(Array.from(e.target.files));
  });
  compareBtn.addEventListener('click', performComparison);
  clearBtn.addEventListener('click', clearAll);
}

async function handleReference(file) {
  preview1.innerHTML = '';
  reference = { image: null, faces: [], selectedIndex: 0, canvas: null, wrapper: null };

  if (!file || !file.type.startsWith('image/')) {
    showError(preview1, 'Please provide an image file');
    return;
  }

  const img = await fileToImage(file);
  reference.image = img;

  const { canvas, ctx } = createCanvasForImage(img, 600, 400);
  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.display = 'inline-block';
  wrapper.appendChild(canvas);
  preview1.appendChild(wrapper);

  // store reference canvas & wrapper for export
  reference.canvas = canvas;
  reference.wrapper = wrapper;

  // Detect on the *same canvas* we’re displaying
  const detections = await faceService.detectAllFaces(canvas, { useTiny: true, maxW: 800 });
  if (detections.length === 0) {
    showError(preview1, 'No faces detected in this image.');
    setDisabledState();
    return;
  }

  detections.forEach((d, i) => {
    d.hasSunglasses = detectSunglassesFast(img, d.landmarks);

    const box = d.detection.box;
    const ageSuffix = typeof d.age === 'number' ? ` (~${Math.round(d.age)}y)` : '';
    const labelText = (i === 0
      ? `Face 1${ageSuffix} (Selected)`
      : `Face ${i + 1}${ageSuffix}`);

    const div = placeFaceBox(
      wrapper,
      box,
      i,
      labelText,
      '#f59e0b',
      canvas
    );
    div.addEventListener('click', () => {
      selectReferenceFace(i, wrapper);
    });
    if (debugToggle.checked) drawLandmarksOnCanvas(canvas, d.landmarks);
  });

  reference.faces = detections;
  reference.selectedIndex = 0;
  selectReferenceFace(0, wrapper);
  setDisabledState();
}

function selectReferenceFace(i, wrapper) {
  reference.selectedIndex = i;
  const boxes = wrapper.querySelectorAll('.face-box');
  boxes.forEach((b, idx) => {
    const label = b.querySelector('.face-label');
    if (!label) return;
    const face = reference.faces[idx];
    const ageSuffix = face && typeof face.age === 'number'
      ? ` (~${Math.round(face.age)}y)`
      : '';

    if (idx === i) {
      b.style.borderColor = 'var(--success)';
      label.textContent = `Face ${idx + 1}${ageSuffix} (Selected)`;
      label.style.background = 'var(--success)';
    } else {
      b.style.borderColor = 'var(--warn)';
      label.textContent = `Face ${idx + 1}${ageSuffix}`;
      label.style.background = 'var(--warn)';
    }
  });
}

async function handleComparisons(files) {
  preview2.innerHTML = '';
  comparisons = [];
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const img = await fileToImage(file);
    const { canvas, ctx } = createCanvasForImage(img, 500, 400);
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.display = 'inline-block';
    wrapper.dataset.fileName = file.name;
    wrapper.appendChild(canvas);
    preview2.appendChild(wrapper);

    // Detect on THIS canvas
    const detections = await faceService.detectAllFaces(canvas, { useTiny: true, maxW: 800 });
    if (detections.length === 0) {
      const err = document.createElement('div');
      err.className = 'error';
      err.textContent = `No faces detected in ${file.name}`;
      wrapper.appendChild(err);
    } else {
      detections.forEach((d, i) => {
        d.hasSunglasses = detectSunglassesFast(img, d.landmarks);
        if (debugToggle.checked) drawLandmarksOnCanvas(canvas, d.landmarks);
        const box = d.detection.box;
        const ageSuffix = typeof d.age === 'number' ? ` (~${Math.round(d.age)}y)` : '';
        placeFaceBox(wrapper, box, i, `${i + 1}${ageSuffix}`, '#f59e0b', canvas);
      });

      // store canvas & wrapper for export
      comparisons.push({ file, image: img, faces: detections, canvas, wrapper });
    }
  }
  setDisabledState();
}

async function performComparison() {
  resultsDiv.classList.remove('hidden');
  resultsDiv.innerHTML = '<h2>📊 Comparison Results</h2>';

  const allComparisons = [];
  let matches = 0, total = 0;
  if (!reference.faces.length) return;

  const refFaceSelected = reference.faces[reference.selectedIndex];
  const refDescriptor = refFaceSelected.descriptor;
  const refSunglasses = refFaceSelected.hasSunglasses;
  const refAge = typeof refFaceSelected.age === 'number' ? refFaceSelected.age : null;

  comparisons.forEach((comp, imgIndex) => {
    comp.faces.forEach((face, faceIndex) => {
      total++;
      const distance = faceapi.euclideanDistance(refDescriptor, face.descriptor);
      const anySunglasses = refSunglasses || face.hasSunglasses;
      const { similarity, confidence, isMatch } = computeSimilarity(distance, anySunglasses);
      const compAge = typeof face.age === 'number' ? face.age : null;

      allComparisons.push({
        fileName: comp.file.name,
        imageIndex: imgIndex,
        faceIndex,
        similarity,
        confidence,
        isMatch,
        distance,
        hasSunglasses: face.hasSunglasses,
        referenceSunglasses: refSunglasses,
        refAge,
        compAge
      });
      if (isMatch) matches++;
    });
  });

  allComparisons.sort((a, b) => b.similarity - a.similarity);

  // store globally for export
  comparisonResults = allComparisons;

  updateComparisonVisuals(allComparisons);

  const tpl = document.getElementById('resultItemTpl');
  allComparisons.forEach((c, idx) => {
    const node = tpl.content.cloneNode(true);
    const root = node.querySelector('.result-item');
    root.querySelector('.title').textContent = `#${idx + 1}: ${c.fileName} - Face ${c.faceIndex + 1}`;
    root.querySelector('.similarity-score').textContent = `${c.similarity.toFixed(1)}% Match`;
    const fill = root.querySelector('.progress-fill');
    fill.style.width = c.similarity + '%';
    if (c.similarity >= 85) fill.style.background = 'linear-gradient(90deg,var(--success),#45a049)';
    else if (c.similarity >= 70) fill.style.background = 'linear-gradient(90deg,#8bc34a,#6fb03a)';
    else if (c.similarity >= 50) fill.style.background = 'linear-gradient(90deg,#ff9800,#e68a00)';
    else fill.style.background = 'linear-gradient(90deg,var(--danger),#b71c1c)';

    let ageLine = '';
    if (typeof c.refAge === 'number' || typeof c.compAge === 'number') {
      const refTxt = typeof c.refAge === 'number' ? `${Math.round(c.refAge)}y` : 'n/a';
      const compTxt = typeof c.compAge === 'number' ? `${Math.round(c.compAge)}y` : 'n/a';
      ageLine = `<br>Estimated age (ref / comp): ${refTxt} / ${compTxt}`;
    }

    root.querySelector('.details').innerHTML =
      `Confidence: <strong>${c.confidence}</strong><br>Distance: ${c.distance.toFixed(3)}${ageLine}`;
    resultsDiv.appendChild(node);
  });

  const summary = document.createElement('div');
  summary.className = 'result-item';
  summary.innerHTML =
    `<h3>Summary</h3><p>Found <strong>${matches}</strong> likely match${matches !== 1 ? 'es' : ''} out of <strong>${total}</strong> face${total !== 1 ? 's' : ''}.</p>`;
  resultsDiv.appendChild(summary);

  // add export button if any similarity ≥ 60%
  const hasOver60 = allComparisons.some(c => c.similarity >= 60);
  if (hasOver60) {
    const exportSheetBtn = document.createElement('button');
    exportSheetBtn.className = 'btn secondary';
    exportSheetBtn.style.marginTop = '10px';
    exportSheetBtn.textContent = 'Export match sheet (≥ 60%)';
    exportSheetBtn.addEventListener('click', () => exportMatchSheet());
    resultsDiv.appendChild(exportSheetBtn);
  }

  resultsDiv.scrollIntoView({ behavior: 'smooth' });
}

function updateComparisonVisuals(comparisonsArr) {
  const wrappers = preview2.querySelectorAll('[data-file-name]');
  wrappers.forEach(wrapper => {
    const fileName = wrapper.dataset.fileName;
    const boxes = wrapper.querySelectorAll('.face-box');
    boxes.forEach((box, idx) => {
      const comp = comparisonsArr.find(c => c.fileName === fileName && c.faceIndex === idx);
      if (comp) {
        if (comp.similarity >= 85) box.style.borderColor = 'var(--success)';
        else if (comp.similarity >= 70) box.style.borderColor = '#8bc34a';
        else if (comp.similarity >= 50) box.style.borderColor = '#ff9800';
        else box.style.borderColor = 'var(--danger)';
        const label = box.querySelector('.face-label');
        if (label) {
          // keep whatever age text is already in label, just update % match
          const parts = label.textContent.split(' (');
          const base = parts[0]; // "Face 1 (~27y" or "1 (~27y"
          label.textContent = `${base} – ${comp.similarity.toFixed(0)}% Match`;
        }
      }
    });
  });
}

function cropFaceFromCanvas(canvas, box, paddingRatio = 0.3) {
  const padX = box.width * paddingRatio;
  const padY = box.height * paddingRatio;

  let sx = Math.max(0, box.x - padX);
  let sy = Math.max(0, box.y - padY);
  let sw = Math.min(canvas.width - sx, box.width + padX * 2);
  let sh = Math.min(canvas.height - sy, box.height + padY * 2);

  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;

  const outCtx = out.getContext('2d');
  outCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

  return out;
}

function drawCropIntoTile(ctx, cropCanvas, x, y, tileW, tileH) {
  const w = cropCanvas.width;
  const h = cropCanvas.height;
  const scale = Math.min(tileW / w, tileH / h);
  const drawW = w * scale;
  const drawH = h * scale;
  const offsetX = x + (tileW - drawW) / 2;
  const offsetY = y + (tileH - drawH) / 2;
  ctx.drawImage(cropCanvas, 0, 0, w, h, offsetX, offsetY, drawW, drawH);
}

function exportMatchSheet() {
  if (!reference || !reference.faces || !reference.faces.length || !reference.canvas) {
    alert('No reference face available.');
    return;
  }
  if (!comparisonResults || !comparisonResults.length) {
    alert('No comparison results available.');
    return;
  }

  // Filter matches with similarity ≥ 60%
  const matches = comparisonResults.filter(c => c.similarity >= 60);
  if (!matches.length) {
    alert('No matches with similarity ≥ 60%.');
    return;
  }

  // Reference face crop
  const refFace = reference.faces[reference.selectedIndex];
  const refBox = refFace.detection.box;
  const refCanvas = reference.canvas;
  const refCrop = cropFaceFromCanvas(refCanvas, refBox, 0.4);

  // Prepare match crops
  const matchCrops = [];
  matches.forEach((m, idx) => {
    const compSet = comparisons[m.imageIndex];
    if (!compSet || !compSet.canvas) return;
    const face = compSet.faces[m.faceIndex];
    if (!face) return;

    const box = face.detection.box;
    const faceCrop = cropFaceFromCanvas(compSet.canvas, box, 0.4);
    matchCrops.push({
      crop: faceCrop,
      similarity: m.similarity,
      fileName: m.fileName,
      faceIndex: m.faceIndex
    });
  });

  if (!matchCrops.length) {
    alert('No valid face crops to export.');
    return;
  }

  // Layout parameters
  const tileSize = 160;
  const padding = 20;
  const gap = 14;
  const cols = 3;
  const refAreaHeight = tileSize + 40; // ref tile + label

  const rows = Math.ceil(matchCrops.length / cols);
  const width = padding * 2 + cols * tileSize + (cols - 1) * gap;
  const height =
    padding * 3 + refAreaHeight +
    rows * (tileSize + 36) +
    (rows - 1) * gap;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  const ctx = outCanvas.getContext('2d');

  // Background
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, width, height);

  // Title
  ctx.fillStyle = '#e5e7eb';
  ctx.font = '18px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Face Match Sheet', width / 2, padding + 16);

  // Draw reference face centered
  const refX = padding + (width - 2 * padding - tileSize) / 2;
  const refY = padding * 2 + 10;
  drawCropIntoTile(ctx, refCrop, refX, refY, tileSize, tileSize);

  ctx.fillStyle = '#9ca3af';
  ctx.font = '14px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Reference', refX + tileSize / 2, refY + tileSize + 18);

  // Draw matched faces grid
  ctx.textAlign = 'center';
  matchCrops.forEach((m, idx) => {
    const row = Math.floor(idx / cols);
    const col = idx % cols;

    const x = padding + col * (tileSize + gap);
    const y = padding * 2 + refAreaHeight + row * (tileSize + 36 + gap);

    drawCropIntoTile(ctx, m.crop, x, y, tileSize, tileSize);

    const label = `${m.similarity.toFixed(1)}%`;
    ctx.fillStyle = '#e5e7eb';
    ctx.font = '13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText(label, x + tileSize / 2, y + tileSize + 16);
  });

  // Download as PNG
  const dataUrl = outCanvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = 'face_match_sheet.png';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function showError(target, message) {
  const e = document.createElement('div');
  e.className = 'error';
  e.textContent = message;
  target.appendChild(e);
}

function clearAll() {
  preview1.innerHTML = '';
  preview2.innerHTML = '';
  resultsDiv.innerHTML = '';
  reference = { image: null, faces: [], selectedIndex: 0, canvas: null, wrapper: null };
  comparisons = [];
  comparisonResults = [];
  setDisabledState();
}

function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setupUI();
  boot();
});
