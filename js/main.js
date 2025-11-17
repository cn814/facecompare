// main.js - Main application logic with multi-reference support
import { DEBUG, debug, downscaleImageToCanvas } from './utils.js';
import { faceService } from './face-service.js';
import { detectSunglassesFast } from './sunglasses.js';
import { createCanvasForImage, placeFaceBox, drawLandmarksOnCanvas, showProcessing, showError } from './ui.js';
import { computeSimilarity, computeMultiReferenceSimilarity, averageDescriptors } from './comparison.js';
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
  const totalRefFaces = referencePhotos.reduce((s, r) => s + r.faces.length, 0);
  const totalCompFaces = comparisons.reduce((s, c) => s + (c.faces ? c.faces.length : 0), 0);
  
  compareBtn.disabled = !(totalRefFaces > 0 && totalCompFaces > 0);
  
  if (compareBtn.disabled) {
    compareBtn.textContent = 'Upload Photos to Compare';
  } else {
    const refText = referencePhotos.length > 1 ? `${referencePhotos.length} references` : '1 reference';
    compareBtn.textContent = `Compare ${refText} vs ${totalCompFaces} face${totalCompFaces > 1 ? 's' : ''}`;
    compareBtn.title = `Press Ctrl+${CONFIG.keyboard.compare.toUpperCase()} to compare`;
  }
  
  // Update reference info
  if (totalRefFaces > 0) {
    referenceInfo.classList.remove('hidden');
    refCount.textContent = `${referencePhotos.length} photo${referencePhotos.length > 1 ? 's' : ''} (${totalRefFaces} face${totalRefFaces > 1 ? 's' : ''})`;
  } else {
    referenceInfo.classList.add('hidden');
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
        await handleReferencePhotos(files);
      } else {
        await handleComparisons(files);
      }
    });
  });

  // File input changes
  fileInput1.addEventListener('change', async e => {
    if (e.target.files.length) await handleReferencePhotos(Array.from(e.target.files));
  });
  
  fileInput2.addEventListener('change', async e => {
    if (e.target.files.length) await handleComparisons(Array.from(e.target.files));
  });

  // Button clicks
  compareBtn.addEventListener('click', performComparison);
  clearBtn.addEventListener('click', clearAll);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
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
 * Handle multiple reference photos upload
 * @param {Array<File>} files - Array of image files
 */
async function handleReferencePhotos(files) {
  // Check limit
  if (referencePhotos.length + files.length > CONFIG.ui.maxReferencePhotos) {
    alert(`Maximum ${CONFIG.ui.maxReferencePhotos} reference photos allowed. Please clear existing ones first.`);
    return;
  }

  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;

    const fileWrapper = document.createElement('div');
    fileWrapper.className = 'reference-photo-wrapper';
    preview1.appendChild(fileWrapper);

    const stopSpinner = showProcessing(fileWrapper, `Processing ${file.name}...`);

    try {
      const img = await fileToImage(file);
      const { canvas, ctx } = createCanvasForImage(
        img, 
        CONFIG.ui.displayMaxWidth, 
        CONFIG.ui.displayMaxHeight
      );
      
      const wrapper = document.createElement('div');
      wrapper.style.position = 'relative';
      wrapper.style.display = 'inline-block';
      wrapper.appendChild(canvas);

      // Add remove button
      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-ref-btn';
      removeBtn.textContent = '×';
      removeBtn.title = 'Remove this reference photo';
      removeBtn.onclick = () => removeReferencePhoto(referencePhotos.length);
      wrapper.appendChild(removeBtn);

      fileWrapper.innerHTML = '';
      fileWrapper.appendChild(wrapper);

      // Detect faces
      const detections = await faceService.detectAllFaces(canvas, { useTiny: true, maxW: 800 });
      
      stopSpinner();

      if (detections.length === 0) {
        showError(fileWrapper, `No faces detected in ${file.name}`);
        continue;
      }

      // Process each detected face
      detections.forEach((d, i) => {
        const sunglassesResult = detectSunglassesFast(img, d.landmarks);
        d.hasSunglasses = sunglassesResult.hasSunglasses;
        d.sunglassesConfidence = sunglassesResult.confidence;

        const box = d.detection.box;
        const ageSuffix = typeof d.age === 'number' ? ` (~${Math.round(d.age)}y)` : '';
        const sunglassesIndicator = d.hasSunglasses ? ' 🕶️' : '';
        const labelText = `Ref ${referencePhotos.length + 1}.${i + 1}${ageSuffix}${sunglassesIndicator}`;

        placeFaceBox(wrapper, box, i, labelText, '#22c55e', canvas, d.quality);
        
        if (debugToggle.checked) drawLandmarksOnCanvas(canvas, d.landmarks);
      });

      referencePhotos.push({ 
        image: img, 
        faces: detections, 
        canvas, 
        wrapper, 
        file,
        index: referencePhotos.length
      });

    } catch (err) {
      stopSpinner();
      showError(fileWrapper, `Error processing ${file.name}: ${err.message}`);
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
  referencePhotos.forEach((ref, i) => {
    ref.index = i;
    // Update labels
    const boxes = ref.wrapper.querySelectorAll('.face-box');
    boxes.forEach((box, faceIdx) => {
      const label = box.querySelector('.face-label');
      if (label) {
        const face = ref.faces[faceIdx];
        const ageSuffix = typeof face.age === 'number' ? ` (~${Math.round(face.age)}y)` : '';
        const sunglassesIndicator = face.hasSunglasses ? ' 🕶️' : '';
        label.textContent = `Ref ${i + 1}.${faceIdx + 1}${ageSuffix}${sunglassesIndicator}`;
      }
    });
  });
  
  setDisabledState();
}

/**
 * Redraw all reference images with current debug settings
 */
function redrawAllReferences() {
  referencePhotos.forEach(ref => {
    const boxes = ref.wrapper.querySelectorAll('.face-box');
    boxes.forEach(b => b.remove());
    
    // Clear and redraw canvas
    const ctx = ref.canvas.getContext('2d');
    ctx.clearRect(0, 0, ref.canvas.width, ref.canvas.height);
    ctx.drawImage(ref.image, 0, 0, ref.canvas.width, ref.canvas.height);
    
    // Redraw face boxes
    ref.faces.forEach((d, i) => {
      const box = d.detection.box;
      const ageSuffix = typeof d.age === 'number' ? ` (~${Math.round(d.age)}y)` : '';
      const sunglassesIndicator = d.hasSunglasses ? ' 🕶️' : '';
      const labelText = `Ref ${ref.index + 1}.${i + 1}${ageSuffix}${sunglassesIndicator}`;
      
      placeFaceBox(ref.wrapper, box, i, labelText, '#22c55e', ref.canvas, d.quality);
      
      if (debugToggle.checked) drawLandmarksOnCanvas(ref.canvas, d.landmarks);
    });
  });
}
/* Multi-reference styles */
.helper-text {
  font-size: 0.85rem;
  color: var(--muted);
  margin-bottom: 8px;
}

.reference-info {
  margin-top: 12px;
  padding: 10px;
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
  border-radius: 8px;
  font-size: 0.9rem;
}

.reference-info p {
  margin-bottom: 8px;
}

.method-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.method-selector select {
  flex: 1;
  padding: 6px 10px;
  background: var(--bg1);
  color: var(--muted);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  font-size: 0.9rem;
  cursor: pointer;
}

.method-selector select:hover {
  border-color: var(--accent);
}

.reference-photo-wrapper {
  position: relative;
  display: inline-block;
  margin: 6px;
}

.remove-ref-btn {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--danger);
  color: white;
  border: 2px solid var(--bg1);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  transition: transform 0.1s ease;
}

.remove-ref-btn:hover {
  transform: scale(1.1);
  background: #dc2626;
}
