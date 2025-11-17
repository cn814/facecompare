// main.js - Main application logic with multi-reference support and reverse image search
import { DEBUG, debug, downscaleImageToCanvas } from './utils.js';
import { faceService } from './face-service.js';
import { detectSunglassesFast } from './sunglasses.js';
import { createCanvasForImage, placeFaceBox, drawLandmarksOnCanvas, showProcessing, showError, addSearchButton } from './ui.js';
import { computeSimilarity, computeMultiReferenceSimilarity, averageDescriptors } from './comparison.js';
import { reverseImageSearch, createSearchMenu } from './reverse-search.js';
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
const referenceInfo = document.getElementById('referenceInfo');
const refCount = document.getElementById('refCount');
const matchMethod = document.getElementById('matchMethod');

// Application state - NOW SUPPORTS MULTIPLE REFERENCES
let referencePhotos = []; // Array of {image, faces, canvas, wrapper, file}
let comparisons = [];
let comparisonResults = [];

/**
 * Bootstrap the application
 */
async function boot() {
  try {
    await faceService.loadModels(function(p, txt) {
      loadingProgress.style.width = p + '%';
      loadingText.textContent = txt;
    });
    setTimeout(function() {
      loadingStatus.classList.add('hidden');
      mainApp.classList.remove('hidden');
    }, 300);
  } catch (e) {
    loadingText.innerHTML = '<span style="color:#ef4444">' + e.message + '</span>';
    loadingProgress.style.background = '#ef4444';
  }
}

/**
 * Update the compare button state based on available faces
 */
function setDisabledState() {
  const totalRefFaces = referencePhotos.reduce(function(s, r) { 
    return s + r.faces.length; 
  }, 0);
  const totalCompFaces = comparisons.reduce(function(s, c) { 
    return s + (c.faces ? c.faces.length : 0); 
  }, 0);
  
  compareBtn.disabled = !(totalRefFaces > 0 && totalCompFaces > 0);
  
  if (compareBtn.disabled) {
    compareBtn.textContent = 'Upload Photos to Compare';
  } else {
    const refText = referencePhotos.length > 1 
      ? referencePhotos.length + ' references' 
      : '1 reference';
    compareBtn.textContent = 'Compare ' + refText + ' vs ' + totalCompFaces + ' face' + (totalCompFaces > 1 ? 's' : '');
    compareBtn.title = 'Press Ctrl+' + CONFIG.keyboard.compare.toUpperCase() + ' to compare';
  }
  
  // Update reference info
  if (totalRefFaces > 0) {
    referenceInfo.classList.remove('hidden');
    refCount.textContent = referencePhotos.length + ' photo' + (referencePhotos.length > 1 ? 's' : '') + 
      ' (' + totalRefFaces + ' face' + (totalRefFaces > 1 ? 's' : '') + ')';
  } else {
    referenceInfo.classList.add('hidden');
  }
}

/**
 * Setup UI event listeners
 */
function setupUI() {
  // Drag and drop for upload areas
  [uploadArea1, uploadArea2].forEach(function(area) {
    area.addEventListener('dragover', function(e) {
      e.preventDefault();
      area.classList.add('dragover');
    });
    
    area.addEventListener('dragleave', function(e) {
      e.preventDefault();
      area.classList.remove('dragover');
    });
    
    area.addEventListener('drop', async function(e) {
      e.preventDefault();
      area.classList.remove('dragover');
      const files = Array.from(e.dataTransfer.files);
      if (area.dataset.target === '1') {
        await handleReferencePhotos(files);
      } else {
        await handleComparisons(files);
      }
    });
  });

  // File input changes
  fileInput1.addEventListener('change', async function(e) {
    if (e.target.files.length) await handleReferencePhotos(Array.from(e.target.files));
  });
  
  fileInput2.addEventListener('change', async function(e) {
    if (e.target.files.length) await handleComparisons(Array.from(e.target.files));
  });

  // Button clicks
  compareBtn.addEventListener('click', performComparison);
  clearBtn.addEventListener('click', clearAll);

  // Keyboard shortcuts
  document.addEventListener('keydown', function(e) {
    if (e.key === CONFIG.keyboard.compare && e.ctrlKey && !compareBtn.disabled) {
      e.preventDefault();
      performComparison();
    }
    if (e.key === CONFIG.keyboard.clear) {
      clearAll();
    }
    if (e.key === CONFIG.keyboard.debug && e.shiftKey) {
      e.preventDefault();
      debugToggle.checked = !debugToggle.checked;
      redrawAllReferences();
      redrawComparisons();
    }
  });
}

/**
 * Crop and search a face online
 * @param {HTMLCanvasElement} canvas - Source canvas
 * @param {Object} box - Face bounding box
 * @param {string} photoName - Name of the photo
 */
async function searchFaceOnline(canvas, box, photoName) {
  // Crop the face from the canvas
  const padding = CONFIG.reverseSearch.cropPadding;
  const padX = box.width * padding;
  const padY = box.height * padding;

  let sx = Math.max(0, box.x - padX);
  let sy = Math.max(0, box.y - padY);
  let sw = Math.min(canvas.width - sx, box.width + padX * 2);
  let sh = Math.min(canvas.height - sy, box.height + padY * 2);

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = sw;
  cropCanvas.height = sh;
  const ctx = cropCanvas.getContext('2d');
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

  // Show search menu
  const menu = createSearchMenu(async function(engine) {
    const loadingMsg = document.createElement('div');
    loadingMsg.className = 'loading-toast';
    loadingMsg.textContent = 'Opening search engines...';
    document.body.appendChild(loadingMsg);

    try {
      let engines;
      if (engine === 'all') {
        engines = CONFIG.reverseSearch.engines;
      } else {
        engines = {
          google: false,
          yandex: false,
          bing: false,
          tineye: false
        };
        engines[engine] = true;
      }

      const results = await reverseImageSearch(cropCanvas, { engines: engines });
      
      loadingMsg.textContent = 'Opened ' + results.success.length + ' search engine' + 
        (results.success.length !== 1 ? 's' : '');
      
      setTimeout(function() {
        loadingMsg.remove();
      }, 2000);
      
    } catch (err) {
      loadingMsg.textContent = 'Error: ' + err.message;
      loadingMsg.style.background = 'var(--danger)';
      setTimeout(function() {
        loadingMsg.remove();
      }, 3000);
    }
  });

  document.body.appendChild(menu);
}

/**
 * Handle multiple reference photos upload
 * @param {Array<File>} files - Array of image files
 */
async function handleReferencePhotos(files) {
  // Check limit
  if (referencePhotos.length + files.length > CONFIG.ui.maxReferencePhotos) {
    alert('Maximum ' + CONFIG.ui.maxReferencePhotos + ' reference photos allowed. Please clear existing ones first.');
    return;
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.type.startsWith('image/')) continue;

    const fileWrapper = document.createElement('div');
    fileWrapper.className = 'reference-photo-wrapper';
    preview1.appendChild(fileWrapper);

    const stopSpinner = showProcessing(fileWrapper, 'Processing ' + file.name + '...');

    try {
      const img = await fileToImage(file);
      const canvasData = createCanvasForImage(img, CONFIG.ui.displayMaxWidth, CONFIG.ui.displayMaxHeight);
      const canvas = canvasData.canvas;
      
      const wrapper = document.createElement('div');
      wrapper.style.position = 'relative';
      wrapper.style.display = 'inline-block';
      wrapper.appendChild(canvas);

      // Add remove button
      const currentIndex = referencePhotos.length;
      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-ref-btn';
      removeBtn.textContent = '×';
      removeBtn.title = 'Remove this reference photo';
      removeBtn.onclick = function() { 
        removeReferencePhoto(currentIndex); 
      };
      wrapper.appendChild(removeBtn);

      fileWrapper.innerHTML = '';
      fileWrapper.appendChild(wrapper);

      // Detect faces
      const detections = await faceService.detectAllFaces(canvas, { useTiny: true, maxW: 800 });
      
      stopSpinner();

      if (detections.length === 0) {
        showError(fileWrapper, 'No faces detected in ' + file.name);
        continue;
      }

      // Process each detected face
      for (let j = 0; j < detections.length; j++) {
        const d = detections[j];
        const sunglassesResult = detectSunglassesFast(img, d.landmarks);
        d.hasSunglasses = sunglassesResult.hasSunglasses;
        d.sunglassesConfidence = sunglassesResult.confidence;

        const box = d.detection.box;
        const ageSuffix = typeof d.age === 'number' ? ' (~' + Math.round(d.age) + 'y)' : '';
        const sunglassesIndicator = d.hasSunglasses ? ' 🕶️' : '';
        const labelText = 'Ref ' + (referencePhotos.length + 1) + '.' + (j + 1) + ageSuffix + sunglassesIndicator;

        const faceBox = placeFaceBox(wrapper, box, j, labelText, '#22c55e', canvas, d.quality);
        
        // Add search button
        addSearchButton(faceBox, function() {
          searchFaceOnline(canvas, box, file.name);
        });
        
        if (debugToggle.checked) drawLandmarksOnCanvas(canvas, d.landmarks);
      }

      referencePhotos.push({ 
        image: img, 
        faces: detections, 
        canvas: canvas, 
        wrapper: wrapper, 
        file: file,
        index: referencePhotos.length
      });

    } catch (err) {
      stopSpinner();
      showError(fileWrapper, 'Error processing ' + file.name + ': ' + err.message);
    }
  }
  
  setDisabledState();
}

/**
 * Remove a reference photo
 * @param {number} index - Index of reference photo to remove
 */
function removeReferencePhoto(index) {
  if (!confirm('Remove this reference photo?')) return;
  
  const ref = referencePhotos[index];
  if (ref && ref.wrapper && ref.wrapper.parentElement) {
    ref.wrapper.parentElement.remove();
  }
  
  referencePhotos.splice(index, 1);
  
  // Re-index remaining photos
  for (let i = 0; i < referencePhotos.length; i++) {
    referencePhotos[i].index = i;
    // Update labels
    const boxes = referencePhotos[i].wrapper.querySelectorAll('.face-box');
    boxes.forEach(function(box, faceIdx) {
      const label = box.querySelector('.face-label');
      if (label) {
        const face = referencePhotos[i].faces[faceIdx];
        const ageSuffix = typeof face.age === 'number' ? ' (~' + Math.round(face.age) + 'y)' : '';
        const sunglassesIndicator = face.hasSunglasses ? ' 🕶️' : '';
        label.textContent = 'Ref ' + (i + 1) + '.' + (faceIdx + 1) + ageSuffix + sunglassesIndicator;
      }
    });
  }
  
  setDisabledState();
}

/**
 * Redraw all reference images with current debug settings
 */
function redrawAllReferences() {
  referencePhotos.forEach(function(ref) {
    const boxes = ref.wrapper.querySelectorAll('.face-box');
    boxes.forEach(function(b) { b.remove(); });
    
    // Clear and redraw canvas
    const ctx = ref.canvas.getContext('2d');
    ctx.clearRect(0, 0, ref.canvas.width, ref.canvas.height);
    ctx.drawImage(ref.image, 0, 0, ref.canvas.width, ref.canvas.height);
    
    // Redraw face boxes
    for (let i = 0; i < ref.faces.length; i++) {
      const d = ref.faces[i];
      const box = d.detection.box;
      const ageSuffix = typeof d.age === 'number' ? ' (~' + Math.round(d.age) + 'y)' : '';
      const sunglassesIndicator = d.hasSunglasses ? ' 🕶️' : '';
      const labelText = 'Ref ' + (ref.index + 1) + '.' + (i + 1) + ageSuffix + sunglassesIndicator;
      
      const faceBox = placeFaceBox(ref.wrapper, box, i, labelText, '#22c55e', ref.canvas, d.quality);
      
      // Re-add search button
      addSearchButton(faceBox, function() {
        searchFaceOnline(ref.canvas, box, ref.file.name);
      });
      
      if (debugToggle.checked) drawLandmarksOnCanvas(ref.canvas, d.landmarks);
    }
  });
}

/**
 * Handle comparison photos upload
 * @param {Array<File>} files - Array of image files
 */
async function handleComparisons(files) {
  preview2.innerHTML = '';
  comparisons = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.type.startsWith('image/')) continue;

    const fileWrapper = document.createElement('div');
    fileWrapper.className = 'comparison-file-wrapper';
    preview2.appendChild(fileWrapper);

    const stopSpinner = showProcessing(fileWrapper, 'Processing ' + file.name + '...');

    try {
      const img = await fileToImage(file);
      const canvasData = createCanvasForImage(img, CONFIG.ui.comparisonMaxWidth, CONFIG.ui.comparisonMaxHeight);
      const canvas = canvasData.canvas;
      
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
        err.textContent = 'No faces detected in ' + file.name;
        wrapper.appendChild(err);
      } else {
        for (let j = 0; j < detections.length; j++) {
          const d = detections[j];
          const sunglassesResult = detectSunglassesFast(img, d.landmarks);
          d.hasSunglasses = sunglassesResult.hasSunglasses;
          d.sunglassesConfidence = sunglassesResult.confidence;

          if (debugToggle.checked) drawLandmarksOnCanvas(canvas, d.landmarks);
          
          const box = d.detection.box;
          const ageSuffix = typeof d.age === 'number' ? ' (~' + Math.round(d.age) + 'y)' : '';
          const sunglassesIndicator = d.hasSunglasses ? ' 🕶️' : '';
          
          const faceBox = placeFaceBox(wrapper, box, j, (j + 1) + ageSuffix + sunglassesIndicator, '#f59e0b', canvas, d.quality);
          
          // Add search button
          addSearchButton(faceBox, function() {
            searchFaceOnline(canvas, box, file.name);
          });
        }

        comparisons.push({ 
          file: file, 
          image: img, 
          faces: detections, 
          canvas: canvas, 
          wrapper: wrapper 
        });
      }
    } catch (err) {
      stopSpinner();
      showError(fileWrapper, 'Error processing ' + file.name + ': ' + err.message);
    }
  }
  
  setDisabledState();
}

/**
 * Redraw all comparison images with current debug settings
 */
function redrawComparisons() {
  comparisons.forEach(function(comp) {
    const boxes = comp.wrapper.querySelectorAll('.face-box');
    boxes.forEach(function(b) { b.remove(); });
    
    const ctx = comp.canvas.getContext('2d');
    ctx.clearRect(0, 0, comp.canvas.width, comp.canvas.height);
    ctx.drawImage(comp.image, 0, 0, comp.canvas.width, comp.canvas.height);
    
    for (let i = 0; i < comp.faces.length; i++) {
      const d = comp.faces[i];
      if (debugToggle.checked) drawLandmarksOnCanvas(comp.canvas, d.landmarks);
      
      const box = d.detection.box;
      const ageSuffix = typeof d.age === 'number' ? ' (~' + Math.round(d.age) + 'y)' : '';
      const sunglassesIndicator = d.hasSunglasses ? ' 🕶️' : '';
      
      const faceBox = placeFaceBox(comp.wrapper, box, i, (i + 1) + ageSuffix + sunglassesIndicator, '#f59e0b', comp.canvas, d.quality);
      
      // Re-add search button
      addSearchButton(faceBox, function() {
        searchFaceOnline(comp.canvas, box, comp.file.name);
      });
    }
  });
}

/**
 * Perform face comparison between reference(s) and comparison photos
 */
async function performComparison() {
  resultsDiv.classList.remove('hidden');
  resultsDiv.innerHTML = '<h2>📊 Comparison Results</h2>';

  if (referencePhotos.length === 0) return;

  // Collect all reference descriptors
  const allRefDescriptors = [];
  const allRefSunglasses = [];
  
  referencePhotos.forEach(function(ref) {
    ref.faces.forEach(function(face) {
      allRefDescriptors.push(face.descriptor);
      allRefSunglasses.push(face.hasSunglasses);
    });
  });

  const anyRefSunglasses = allRefSunglasses.some(function(s) { return s; });
  const method = matchMethod.value;

  // Info banner
  const infoBanner = document.createElement('div');
  infoBanner.className = 'info';
  infoBanner.innerHTML = 
    '<strong>Multi-Reference Comparison Active</strong><br>' +
    'Using ' + allRefDescriptors.length + ' reference face' + (allRefDescriptors.length > 1 ? 's' : '') + ' ' +
    'from ' + referencePhotos.length + ' photo' + (referencePhotos.length > 1 ? 's' : '') + '<br>' +
    'Method: <strong>' + method.charAt(0).toUpperCase() + method.slice(1) + '</strong>' +
    (anyRefSunglasses ? '<br>🕶️ Sunglasses detected in reference - thresholds adjusted' : '');
  resultsDiv.appendChild(infoBanner);

  const allComparisons = [];
  let matches = 0;
  let total = 0;

  // Compute all similarities
  comparisons.forEach(function(comp, imgIndex) {
    comp.faces.forEach(function(face, faceIndex) {
      total++;
      
      const anySunglasses = anyRefSunglasses || face.hasSunglasses;
      const result = computeMultiReferenceSimilarity(
        allRefDescriptors,
        face.descriptor,
        anySunglasses,
        method
      );

      allComparisons.push({
        fileName: comp.file.name,
        imageIndex: imgIndex,
        faceIndex: faceIndex,
        similarity: result.similarity,
        confidence: result.confidence,
        isMatch: result.isMatch,
        distance: result.finalDistance,
        distances: result.distances,
        method: result.method,
        referenceCount: result.referenceCount,
        hasSunglasses: face.hasSunglasses,
        referenceSunglasses: anyRefSunglasses,
        compAge: typeof face.age === 'number' ? face.age : null,
        quality: face.quality
      });
      
      if (result.isMatch) matches++;
    });
  });

  allComparisons.sort(function(a, b) { return b.similarity - a.similarity; });
  comparisonResults = allComparisons;

  // Update visual indicators
  updateComparisonVisuals(allComparisons);

  // Display results
  const tpl = document.getElementById('resultItemTpl');
  allComparisons.forEach(function(c, idx) {
    const node = tpl.content.cloneNode(true);
    const root = node.querySelector('.result-item');
    
    const sunglassesNote = c.hasSunglasses || c.referenceSunglasses ? ' 🕶️' : '';
    
    root.querySelector('.title').textContent = '#' + (idx + 1) + ': ' + c.fileName + ' - Face ' + (c.faceIndex + 1) + sunglassesNote;
    root.querySelector('.similarity-score').textContent = c.similarity.toFixed(1) + '% Match';
    
    const fill = root.querySelector('.progress-fill');
    fill.style.width = c.similarity + '%';
    
    if (c.similarity >= 85) {
      fill.style.background = 'linear-gradient(90deg,var(--success),#45a049)';
    } else if (c.similarity >= 70) {
      fill.style.background = 'linear-gradient(90deg,#8bc34a,#6fb03a)';
    } else if (c.similarity >= 50) {
      fill.style.background = 'linear-gradient(90deg,#ff9800,#e68a00)';
    } else {
      fill.style.background = 'linear-gradient(90deg,var(--danger),#b71c1c)';
    }

    const distanceRange = c.distances.length > 1
      ? Math.min.apply(null, c.distances).toFixed(3) + ' - ' + Math.max.apply(null, c.distances).toFixed(3)
      : c.distance.toFixed(3);

    let detailsHTML = 
      'Confidence: <strong>' + c.confidence + '</strong><br>' +
      'Distance: ' + distanceRange + '<br>' +
      'Quality: ' + c.quality + '%<br>' +
      'References used: ' + c.referenceCount;
    
    if (typeof c.compAge === 'number') {
      detailsHTML += '<br>Age: ~' + Math.round(c.compAge) + 'y';
    }
    
    if (c.hasSunglasses || c.referenceSunglasses) {
      detailsHTML += '<br><small>🕶️ Sunglasses detected - thresholds adjusted</small>';
    }

    root.querySelector('.details').innerHTML = detailsHTML;
    resultsDiv.appendChild(node);
  });

  // Summary
  const summary = document.createElement('div');
  summary.className = 'result-item';
  summary.innerHTML = 
    '<h3>Summary</h3>' +
    '<p>Found <strong>' + matches + '</strong> likely match' + (matches !== 1 ? 'es' : '') + ' out of <strong>' + total + '</strong> face' + (total !== 1 ? 's' : '') + '.</p>' +
    '<p style="margin-top: 8px; font-size: 0.9em; color: var(--muted);">' +
    'Multi-reference comparison improves accuracy by comparing against ' + allRefDescriptors.length + ' reference samples' +
    '</p>';
  resultsDiv.appendChild(summary);

  // Export button
  const hasOver60 = allComparisons.some(function(c) { return c.similarity >= CONFIG.export.matchThreshold; });
  if (hasOver60) {
    const exportSheetBtn = document.createElement('button');
    exportSheetBtn.className = 'btn secondary';
    exportSheetBtn.style.marginTop = '10px';
    exportSheetBtn.textContent = 'Export match sheet (≥ ' + CONFIG.export.matchThreshold + '%)';
    exportSheetBtn.addEventListener('click', function() { exportMatchSheet(); });
    resultsDiv.appendChild(exportSheetBtn);
  }

  resultsDiv.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Update visual indicators on comparison images
 */
function updateComparisonVisuals(comparisonsArr) {
  const wrappers = preview2.querySelectorAll('[data-file-name]');
  
  wrappers.forEach(function(wrapper) {
    const fileName = wrapper.dataset.fileName;
    const boxes = wrapper.querySelectorAll('.face-box');
    
    boxes.forEach(function(box, idx) {
      const comp = comparisonsArr.find(function(c) { 
        return c.fileName === fileName && c.faceIndex === idx; 
      });
      if (comp) {
        if (comp.similarity >= 85) box.style.borderColor = 'var(--success)';
        else if (comp.similarity >= 70) box.style.borderColor = '#8bc34a';
        else if (comp.similarity >= 50) box.style.borderColor = '#ff9800';
        else box.style.borderColor = 'var(--danger)';
        
        const label = box.querySelector('.face-label');
        if (label) {
          const parts = label.textContent.split(' – ');
          const base = parts[0];
          label.textContent = base + ' – ' + comp.similarity.toFixed(0) + '%';
        }
        
        box.title = 'Similarity: ' + comp.similarity.toFixed(1) + '%\n' +
                    'Confidence: ' + comp.confidence + '\n' +
                    'Quality: ' + comp.quality + '%\n' +
                    'Method: ' + comp.method;
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
function cropFaceFromCanvas(canvas, box, paddingRatio) {
  paddingRatio = paddingRatio || 0.3;
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
  if (!referencePhotos || !referencePhotos.length || !referencePhotos[0].faces || !referencePhotos[0].canvas) {
    alert('No reference faces available.');
    return;
  }
  if (!comparisonResults || !comparisonResults.length) {
    alert('No comparison results available.');
    return;
  }

  const matches = comparisonResults.filter(function(c) { 
    return c.similarity >= CONFIG.export.matchThreshold; 
  });
  
  if (!matches.length) {
    alert('No matches with similarity ≥ ' + CONFIG.export.matchThreshold + '%.');
    return;
  }

  // Use first reference face for export (could be enhanced to use best quality)
  const refFace = referencePhotos[0].faces[0];
  const refBox = refFace.detection.box;
  const refCanvas = referencePhotos[0].canvas;
  const refCrop = cropFaceFromCanvas(refCanvas, refBox, 0.4);
  const refAge = typeof refFace.age === 'number' ? Math.round(refFace.age) : null;

  // Match crops
  const matchCrops = [];
  matches.forEach(function(m) {
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
  const height = padding * 3 + refAreaHeight + rows * (tileSize + 42) + (rows - 1) * gap + 40;

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
    ctx.fillText('≈ ' + refAge + 'y', refX + tileSize / 2, refY + tileSize + 34);
  }

  // Matched faces
  matchCrops.forEach(function(m, idx) {
    const row = Math.floor(idx / cols);
    const col = idx % cols;

    const x = padding + col * (tileSize + gap);
    const y = padding * 2 + refAreaHeight + row * (tileSize + 42 + gap);

    drawCropIntoTile(ctx, m.crop, x, y, tileSize, tileSize);

    const centerX = x + tileSize / 2;
    const line1Y = y + tileSize + 16;
    const line2Y = y + tileSize + 32;

    const labelPercent = m.similarity.toFixed(1) + '%';
    ctx.fillStyle = '#e5e7eb';
    ctx.font = '13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(labelPercent, centerX, line1Y);

    if (m.age !== null) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = '12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillText(m.age + 'y', centerX, line2Y);
    }
  });

  // Footer
  ctx.fillStyle = '#6b7280';
  ctx.font = '11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    'Generated ' + new Date().toLocaleDateString() + ' • ' + matches.length + ' matches found',
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
  document.body.removeChild(link);

  // Export PDF
  try {
    const jsPDF = window.jspdf ? window.jspdf.jsPDF : null;
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
  referencePhotos = [];
  comparisons = [];
  comparisonResults = [];
  fileInput1.value = '';
  fileInput2.value = '';
  setDisabledState();
}

/**
 * Convert a File to an Image element
 */
function fileToImage(file) {
  return new Promise(function(resolve, reject) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() { resolve(img); };
      img.onerror = function() { reject(new Error('Failed to load image')); };
      img.src = e.target.result;
    };
    reader.onerror = function() { reject(new Error('Failed to read file')); };
    reader.readAsDataURL(file);
  });
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', function() {
  setupUI();
  boot();
});
