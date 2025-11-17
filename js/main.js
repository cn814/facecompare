// main.js - Main application logic
import { DEBUG, debug, downscaleImageToCanvas } from './utils.js';
import { faceService } from './face-service.js';
import { detectSunglassesFast } from './sunglasses.js';
import { createCanvasForImage, placeFaceBox, drawLandmarksOnCanvas, showProcessing, showError } from './ui.js';
import { computeSimilarity } from './comparison.js';
import { CONFIG } from './config.js';

// DOM elements
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

// Application state
let reference = { image: null, faces: [], selectedIndex: 0, canvas: null, wrapper: null };
let comparisons = [];
let comparisonResults = [];

/**
 * Bootstrap the application
 */
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
    loadingText.innerHTML = `<span style="color:#ef4444">${e.message}</span>`;
    loadingProgress.style.background = '#ef4444';
  }
}

/**
 * Update the compare button state based on available faces
 */
function setDisabledState() {
  const totalFaces = comparisons.reduce((s, c) => s + (c.faces ? c.faces.length : 0), 0);
  compareBtn.disabled = !(reference.faces.length && totalFaces > 0);
  
  if (compareBtn.disabled) {
    compareBtn.textContent = 'Upload Photos to Compare';
  } else {
    compareBtn.textContent = `Compare Against ${totalFaces} Face${totalFaces > 1 ? 's' : ''}`;
    compareBtn.title = `Press Ctrl+${CONFIG.keyboard.compare.toUpperCase()} to compare`;
  }
}

/**
 * Setup UI event listeners
 */
function setupUI() {
  // Drag and drop for upload areas
  [uploadArea1, uploadArea2].forEach(area => {
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
      if (area.dataset.target === '1') {
        await handleReference(files[0]);
      } else {
        await handleComparisons(files);
      }
    });
  });

  // File input changes
  fileInput1.addEventListener('change', async e => {
    if (e.target.files[0]) await handleReference(e.target.files[0]);
  });
  
  fileInput2.addEventListener('change', async e => {
    if (e.target.files.length) await handleComparisons(Array.from(e.target.files));
  });

  // Button clicks
  compareBtn.addEventListener('click', performComparison);
  clearBtn.addEventListener('click', clearAll);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl+C to compare
    if (e.key === CONFIG.keyboard.compare && e.ctrlKey && !compareBtn.disabled) {
      e.preventDefault();
      performComparison();
    }
    // Escape to clear
    if (e.key === CONFIG.keyboard.clear) {
      clearAll();
    }
    // Shift+D to toggle debug
    if (e.key === CONFIG.keyboard.debug && e.shiftKey) {
      e.preventDefault();
      debugToggle.checked = !debugToggle.checked;
      // Redraw current images with/without landmarks
      if (reference.wrapper) redrawReference();
      redrawComparisons();
    }
  });
}

/**
 * Handle reference photo upload
 * @param {File} file - Image file
 */
async function handleReference(file) {
  preview1.innerHTML = '';
  reference = { image: null, faces: [], selectedIndex: 0, canvas: null, wrapper: null };

  if (!file || !file.type.startsWith('image/')) {
    showError(preview1, 'Please provide an image file');
    setDisabledState();
    return;
  }

  const stopSpinner = showProcessing(preview1, 'Detecting faces...');

  try {
    const img = await fileToImage(file);
    reference.image = img;

    const { canvas, ctx } = createCanvasForImage(
      img, 
      CONFIG.ui.displayMaxWidth, 
      CONFIG.ui.displayMaxHeight
    );
    
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.display = 'inline-block';
    wrapper.appendChild(canvas);
    preview1.appendChild(wrapper);

    reference.canvas = canvas;
    reference.wrapper = wrapper;

    // Detect faces
    const detections = await faceService.detectAllFaces(canvas, { useTiny: true, maxW: 800 });
    
    stopSpinner();

    if (detections.length === 0) {
      showError(preview1, 'No faces detected in this image. Try a clearer photo with visible faces.');
      setDisabledState();
      return;
    }

    // Process each detected face
    detections.forEach((d, i) => {
      const sunglassesResult = detectSunglassesFast(img, d.landmarks);
      d.hasSunglasses = sunglassesResult.hasSunglasses;
      d.sunglassesConfidence = sunglassesResult.confidence;

      const box = d.detection.box;
      const ageSuffix = typeof d.age === 'number' ? ` (~${Math.round(d.age)}y)` : '';
      const sunglassesIndicator = d.hasSunglasses ? ' 🕶️' : '';
      const labelText = i === 0
        ? `Face 1${ageSuffix}${sunglassesIndicator} (Selected)`
        : `Face ${i + 1}${ageSuffix}${sunglassesIndicator}`;

      const div = placeFaceBox(wrapper, box, i, labelText, '#f59e0b', canvas, d.quality);
      div.addEventListener('click', () => selectReferenceFace(i, wrapper));
      
      if (debugToggle.checked) drawLandmarksOnCanvas(canvas, d.landmarks);
    });

    reference.faces = detections;
    reference.selectedIndex = 0;
    selectReferenceFace(0, wrapper);
    setDisabledState();
  } catch (err) {
    stopSpinner();
    showError(preview1, `Error processing image: ${err.message}`);
    setDisabledState();
  }
}

/**
 * Select a specific face as reference
 * @param {number} i - Face index to select
 * @param {HTMLElement} wrapper - Wrapper element
 */
function selectReferenceFace(i, wrapper) {
  reference.selectedIndex = i;
  const boxes = wrapper.querySelectorAll('.face-box');
  
  boxes.forEach((b, idx) => {
    const label = b.querySelector('.face-label');
    if (!label) return;
    
    const face = reference.faces[idx];
    const ageSuffix = face && typeof face.age === 'number' ? ` (~${Math.round(face.age)}y)` : '';
    const sunglassesIndicator = face && face.hasSunglasses ? ' 🕶️' : '';

    if (idx === i) {
      b.style.borderColor = 'var(--success)';
      label.textContent = `Face ${idx + 1}${ageSuffix}${sunglassesIndicator} (Selected)`;
      label.style.background = 'var(--success)';
    } else {
      b.style.borderColor = 'var(--warn)';
      label.textContent = `Face ${idx + 1}${ageSuffix}${sunglassesIndicator}`;
      label.style.background = 'var(--warn)';
    }
  });
}

/**
 * Redraw reference image with current debug settings
 */
function redrawReference() {
  if (!reference.wrapper || !reference.canvas) return;
  
  const boxes = reference.wrapper.querySelectorAll('.face-box');
  boxes.forEach(b => b.remove());
  
  // Clear and redraw canvas
  const ctx = reference.canvas.getContext('2d');
  ctx.clearRect(0, 0, reference.canvas.width, reference.canvas.height);
  ctx.drawImage(reference.image, 0, 0, reference.canvas.width, reference.canvas.height);
  
  // Redraw face boxes
  reference.faces.forEach((d, i) => {
    const box = d.detection.box;
    const ageSuffix = typeof d.age === 'number' ? ` (~${Math.round(d.age)}y)` : '';
    const sunglassesIndicator = d.hasSunglasses ? ' 🕶️' : '';
    const labelText = i === reference.selectedIndex
      ? `Face ${i + 1}${ageSuffix}${sunglassesIndicator} (Selected)`
      : `Face ${i + 1}${ageSuffix}${sunglassesIndicator}`;
    
    const div = placeFaceBox(reference.wrapper, box, i, labelText, '#f59e0b', reference.canvas, d.quality);
    div.addEventListener('click', () => selectReferenceFace(i, reference.wrapper));
    
    if (debugToggle.checked) drawLandmarksOnCanvas(reference.canvas, d.landmarks);
  });
  
  selectReferenceFace(reference.selectedIndex, reference.wrapper);
}
/**
 * Handle comparison photos upload
 * @param {Array<File>} files - Array of image files
 */
async function handleComparisons(files) {
  preview2.innerHTML = '';
  comparisons = [];

  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;

    const fileWrapper = document.createElement('div');
    fileWrapper.className = 'comparison-file-wrapper';
    preview2.appendChild(fileWrapper);

    const stopSpinner = showProcessing(fileWrapper, `Processing ${file.name}...`);

    try {
      const img = await fileToImage(file);
      const { canvas, ctx } = createCanvasForImage(
        img, 
        CONFIG.ui.comparisonMaxWidth, 
        CONFIG.ui.comparisonMaxHeight
      );
      
      const wrapper = document.createElement('div');
      wrapper.style.position = 'relative';
      wrapper.style.display = 'inline-block';
      wrapper.dataset.fileName = file.name;
      wrapper.appendChild(canvas);

      fileWrapper.innerHTML = '';
      fileWrapper.appendChild(wrapper);

      // Detect faces
      const detections = await faceService.detectAllFaces(canvas, { useTiny: true, maxW: 800 });
      
      if (detections.length === 0) {
        const err = document.createElement('div');
        err.className = 'error';
        err.textContent = `No faces detected in ${file.name}`;
        wrapper.appendChild(err);
      } else {
        detections.forEach((d, i) => {
          const sunglassesResult = detectSunglassesFast(img, d.landmarks);
          d.hasSunglasses = sunglassesResult.hasSunglasses;
          d.sunglassesConfidence = sunglassesResult.confidence;

          if (debugToggle.checked) drawLandmarksOnCanvas(canvas, d.landmarks);
          
          const box = d.detection.box;
          const ageSuffix = typeof d.age === 'number' ? ` (~${Math.round(d.age)}y)` : '';
          const sunglassesIndicator = d.hasSunglasses ? ' 🕶️' : '';
          placeFaceBox(wrapper, box, i, `${i + 1}${ageSuffix}${sunglassesIndicator}`, '#f59e0b', canvas, d.quality);
        });

        comparisons.push({ file, image: img, faces: detections, canvas, wrapper });
      }
    } catch (err) {
      stopSpinner();
      showError(fileWrapper, `Error processing ${file.name}: ${err.message}`);
    }
  }
  
  setDisabledState();
}

/**
 * Redraw all comparison images with current debug settings
 */
function redrawComparisons() {
  comparisons.forEach(comp => {
    const boxes = comp.wrapper.querySelectorAll('.face-box');
    boxes.forEach(b => b.remove());
    
    // Clear and redraw canvas
    const ctx = comp.canvas.getContext('2d');
    ctx.clearRect(0, 0, comp.canvas.width, comp.canvas.height);
    ctx.drawImage(comp.image, 0, 0, comp.canvas.width, comp.canvas.height);
    
    // Redraw face boxes
    comp.faces.forEach((d, i) => {
      if (debugToggle.checked) drawLandmarksOnCanvas(comp.canvas, d.landmarks);
      
      const box = d.detection.box;
      const ageSuffix = typeof d.age === 'number' ? ` (~${Math.round(d.age)}y)` : '';
      const sunglassesIndicator = d.hasSunglasses ? ' 🕶️' : '';
      placeFaceBox(comp.wrapper, box, i, `${i + 1}${ageSuffix}${sunglassesIndicator}`, '#f59e0b', comp.canvas, d.quality);
    });
  });
}

/**
 * Perform face comparison between reference and comparison photos
 */
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

  // Compute all similarities
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
        sunglassesConfidence: face.sunglassesConfidence,
        referenceSunglasses: refSunglasses,
        refAge,
        compAge,
        quality: face.quality
      });
      
      if (isMatch) matches++;
    });
  });

  allComparisons.sort((a, b) => b.similarity - a.similarity);
  comparisonResults = allComparisons;

  // Update visual indicators
  updateComparisonVisuals(allComparisons);

  // Display results
  const tpl = document.getElementById('resultItemTpl');
  allComparisons.forEach((c, idx) => {
    const node = tpl.content.cloneNode(true);
    const root = node.querySelector('.result-item');
    
    const sunglassesNote = c.hasSunglasses || c.referenceSunglasses 
      ? ' 🕶️' 
      : '';
    
    root.querySelector('.title').textContent = `#${idx + 1}: ${c.fileName} - Face ${c.faceIndex + 1}${sunglassesNote}`;
    root.querySelector('.similarity-score').textContent = `${c.similarity.toFixed(1)}% Match`;
    
    const fill = root.querySelector('.progress-fill');
    fill.style.width = c.similarity + '%';
    
    // Color gradient based on similarity
    if (c.similarity >= 85) {
      fill.style.background = 'linear-gradient(90deg,var(--success),#45a049)';
    } else if (c.similarity >= 70) {
      fill.style.background = 'linear-gradient(90deg,#8bc34a,#6fb03a)';
    } else if (c.similarity >= 50) {
      fill.style.background = 'linear-gradient(90deg,#ff9800,#e68a00)';
    } else {
      fill.style.background = 'linear-gradient(90deg,var(--danger),#b71c1c)';
    }

    let detailsHTML = `Confidence: <strong>${c.confidence}</strong><br>Distance: ${c.distance.toFixed(3)}<br>Quality: ${c.quality}%`;
    
    if (typeof c.refAge === 'number' || typeof c.compAge === 'number') {
      const refTxt = typeof c.refAge === 'number' ? `${Math.round(c.refAge)}y` : 'n/a';
      const compTxt = typeof c.compAge === 'number' ? `${Math.round(c.compAge)}y` : 'n/a';
      detailsHTML += `<br>Age (ref / comp): ${refTxt} / ${compTxt}`;
    }
    
    if (c.hasSunglasses || c.referenceSunglasses) {
      detailsHTML += `<br><small>🕶️ Sunglasses detected - thresholds adjusted</small>`;
    }

    root.querySelector('.details').innerHTML = detailsHTML;
    resultsDiv.appendChild(node);
  });

  // Summary
  const summary = document.createElement('div');
  summary.className = 'result-item';
  summary.innerHTML = `
    <h3>Summary</h3>
    <p>Found <strong>${matches}</strong> likely match${matches !== 1 ? 'es' : ''} out of <strong>${total}</strong> face${total !== 1 ? 's' : ''}.</p>
    <p style="margin-top: 8px; font-size: 0.9em; color: var(--muted);">
      Comparison completed at ${new Date().toLocaleTimeString()}
    </p>
  `;
  resultsDiv.appendChild(summary);

  // Export button
  const hasOver60 = allComparisons.some(c => c.similarity >= CONFIG.export.matchThreshold);
  if (hasOver60) {
    const exportSheetBtn = document.createElement('button');
    exportSheetBtn.className = 'btn secondary';
    exportSheetBtn.style.marginTop = '10px';
    exportSheetBtn.textContent = `Export match sheet (≥ ${CONFIG.export.matchThreshold}%)`;
    exportSheetBtn.addEventListener('click', () => exportMatchSheet());
    resultsDiv.appendChild(exportSheetBtn);
  }

  resultsDiv.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Update visual indicators on comparison images
 * @param {Array} comparisonsArr - Array of comparison results
 */
function updateComparisonVisuals(comparisonsArr) {
  const wrappers = preview2.querySelectorAll('[data-file-name]');
  
  wrappers.forEach(wrapper => {
    const fileName = wrapper.dataset.fileName;
    const boxes = wrapper.querySelectorAll('.face-box');
    
    boxes.forEach((box, idx) => {
      const comp = comparisonsArr.find(c => c.fileName === fileName && c.faceIndex === idx);
      if (comp) {
        // Update border color
        if (comp.similarity >= 85) box.style.borderColor = 'var(--success)';
        else if (comp.similarity >= 70) box.style.borderColor = '#8bc34a';
        else if (comp.similarity >= 50) box.style.borderColor = '#ff9800';
        else box.style.borderColor = 'var(--danger)';
        
        // Update label text
        const label = box.querySelector('.face-label');
        if (label) {
          const parts = label.textContent.split(' – ');
          const base = parts[0];
          label.textContent = `${base} – ${comp.similarity.toFixed(0)}%`;
        }
        
        // Update tooltip
        box.title = `Similarity: ${comp.similarity.toFixed(1)}%\nConfidence: ${comp.confidence}\nQuality: ${comp.quality}%`;
      }
    });
  });
}

/**
 * Crop a face region from canvas with padding
 * @param {HTMLCanvasElement} canvas - Source canvas
 * @param {Object} box - Face bounding box
 * @param {number} paddingRatio - Padding ratio (0-1)
 * @returns {HTMLCanvasElement} Cropped canvas
 */
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

/**
 * Draw a cropped face into a tile with aspect ratio preservation
 * @param {CanvasRenderingContext2D} ctx - Destination context
 * @param {HTMLCanvasElement} cropCanvas - Cropped face canvas
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} tileW - Tile width
 * @param {number} tileH - Tile height
 */
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

/**
 * Export match sheet as PNG and PDF
 */
function exportMatchSheet() {
  if (!reference || !reference.faces || !reference.faces.length || !reference.canvas) {
    alert('No reference face available.');
    return;
  }
  if (!comparisonResults || !comparisonResults.length) {
    alert('No comparison results available.');
    return;
  }

  const matches = comparisonResults.filter(c => c.similarity >= CONFIG.export.matchThreshold);
  if (!matches.length) {
    alert(`No matches with similarity ≥ ${CONFIG.export.matchThreshold}%.`);
    return;
  }

  // Reference face
  const refFace = reference.faces[reference.selectedIndex];
  const refBox = refFace.detection.box;
  const refCanvas = reference.canvas;
  const refCrop = cropFaceFromCanvas(refCanvas, refBox, 0.4);
  const refAge = typeof refFace.age === 'number' ? Math.round(refFace.age) : null;

  // Match crops
  const matchCrops = [];
  matches.forEach((m) => {
    const compSet = comparisons[m.imageIndex];
    if (!compSet || !compSet.canvas) return;
    const face = compSet.faces[m.faceIndex];
    if (!face) return;

    const box = face.detection.box;
    const faceCrop = cropFaceFromCanvas(compSet.canvas, box, 0.4);
    const compAge = typeof face.age === 'number' ? Math.round(face.age) : null;

    matchCrops.push({
      crop: faceCrop,
      similarity: m.similarity,
      fileName: m.fileName,
      faceIndex: m.faceIndex,
      age: compAge
    });
  });

  if (!matchCrops.length) {
    alert('No valid face crops to export.');
    return;
  }

  // Layout
  const tileSize = CONFIG.export.tileSize;
  const padding = CONFIG.export.padding;
  const gap = CONFIG.export.gap;
  const cols = CONFIG.export.columns;
  const refAreaHeight = tileSize + 50;

  const rows = Math.ceil(matchCrops.length / cols);
  const width = padding * 2 + cols * tileSize + (cols - 1) * gap;
  const height = padding * 3 + refAreaHeight + rows * (tileSize + 42) + (rows - 1) * gap + 40; // +40 for footer

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

  // Reference face
  const refX = padding + (width - 2 * padding - tileSize) / 2;
  const refY = padding * 2 + 10;
  drawCropIntoTile(ctx, refCrop, refX, refY, tileSize, tileSize);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#9ca3af';
  ctx.font = '14px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText('Reference', refX + tileSize / 2, refY + tileSize + 18);

  if (refAge !== null) {
    ctx.font = '13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText(`≈ ${refAge}y`, refX + tileSize / 2, refY + tileSize + 34);
  }

  // Matched faces
  matchCrops.forEach((m, idx) => {
    const row = Math.floor(idx / cols);
    const col = idx % cols;

    const x = padding + col * (tileSize + gap);
    const y = padding * 2 + refAreaHeight + row * (tileSize + 42 + gap);

    drawCropIntoTile(ctx, m.crop, x, y, tileSize, tileSize);

    const centerX = x + tileSize / 2;
    const line1Y = y + tileSize + 16;
    const line2Y = y + tileSize + 32;

    const labelPercent = `${m.similarity.toFixed(1)}%`;
    ctx.fillStyle = '#e5e7eb';
    ctx.font = '13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(labelPercent, centerX, line1Y);

    if (m.age !== null) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = '12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillText(`${m.age}y`, centerX, line2Y);
    }
  });

  // Footer
  ctx.fillStyle = '#6b7280';
  ctx.font = '11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    `Generated ${new Date().toLocaleDateString()} • ${matches.length} matches found`,
    width / 2,
    height - 15
  );

  // Export PNG
  const pngDataUrl = outCanvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = pngDataUrl;
  link.download = 'face_match_sheet.png';
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Export PDF
  try {
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) {
      console.error('jsPDF not found');
      return;
    }

    const pdf = new jsPDF({
      orientation: outCanvas.width > outCanvas.height ? 'landscape' : 'portrait',
      unit: 'pt',
      format: [outCanvas.width, outCanvas.height]
    });

    pdf.addImage(pngDataUrl, 'PNG', 0, 0, outCanvas.width, outCanvas.height);
    pdf.save('face_match_sheet.pdf');
  } catch (err) {
    console.error('PDF export failed:', err);
    alert("PNG downloaded successfully. PDF generation failed - see console.");
  }
}

/**
 * Clear all data and reset UI
 */
function clearAll() {
  if (!confirm('Clear all images and results?')) return;
  
  preview1.innerHTML = '';
  preview2.innerHTML = '';
  resultsDiv.innerHTML = '';
  resultsDiv.classList.add('hidden');
  reference = { image: null, faces: [], selectedIndex: 0, canvas: null, wrapper: null };
  comparisons = [];
  comparisonResults = [];
  fileInput1.value = '';
  fileInput2.value = '';
  setDisabledState();
}

/**
 * Convert a File to an Image element
 * @param {File} file - Image file
 * @returns {Promise<HTMLImageElement>} Image element
 */
function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  setupUI();
  boot();
});
