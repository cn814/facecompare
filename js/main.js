// main.js - Main application logic with multi-reference support
import { DEBUG, debug, downscaleImageToCanvas } from './utils.js';
import { faceService } from './face-service.js';
import { detectSunglassesFast } from './sunglasses.js';
import { createCanvasForImage, placeFaceBox, drawLandmarksOnCanvas, showProcessing, showError } from './ui.js';
import { computeSimilarity, computeMultiReferenceSimilarity, averageDescriptors } from './comparison.js';
import { CONFIG } from './config.js';
import { fetchImagesFromUrl } from './url-fetcher.js';

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
const yearbookToggle = document.getElementById('yearbookToggle');
const clearBtn = document.getElementById('clearBtn');
const referenceInfo = document.getElementById('referenceInfo');
const refCount = document.getElementById('refCount');
const matchMethod = document.getElementById('matchMethod');

// URL-related DOM elements
const sourceTabs = document.querySelectorAll('.source-tab');
const fileSource = document.getElementById('fileSource');
const urlSource = document.getElementById('urlSource');
const urlInput = document.getElementById('urlInput');
const fetchUrlBtn = document.getElementById('fetchUrlBtn');
const maxImagesSelect = document.getElementById('maxImagesSelect');
const minSizeSelect = document.getElementById('minSizeSelect');
const urlStatus = document.getElementById('urlStatus');
const urlPreview = document.getElementById('urlPreview');

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
  const totalRefFaces = referencePhotos.reduce((sum, r) => sum + r.faces.length, 0);
  const selectedRefFaces = referencePhotos.reduce((sum, r) => sum + r.faces.filter(f => f.selected).length, 0);
  const totalCompFaces = comparisons.reduce((sum, c) => sum + (c.faces?.length || 0), 0);

  compareBtn.disabled = !(selectedRefFaces > 0 && totalCompFaces > 0);

  if (compareBtn.disabled) {
    if (totalRefFaces > 0 && selectedRefFaces === 0) {
      compareBtn.textContent = 'Select at least one reference face';
    } else {
      compareBtn.textContent = 'Upload Photos to Compare';
    }
  } else {
    const refText = selectedRefFaces > 1
      ? selectedRefFaces + ' ref faces'
      : '1 ref face';
    compareBtn.textContent = 'Compare ' + refText + ' vs ' + totalCompFaces + ' face' + (totalCompFaces > 1 ? 's' : '');
    compareBtn.title = 'Press Ctrl+' + CONFIG.keyboard.compare.toUpperCase() + ' to compare';
  }

  // Update reference info
  if (totalRefFaces > 0) {
    referenceInfo.classList.remove('hidden');
    const selectedText = selectedRefFaces < totalRefFaces
      ? ' (' + selectedRefFaces + ' selected)'
      : '';
    refCount.textContent = referencePhotos.length + ' photo' + (referencePhotos.length > 1 ? 's' : '') +
      ' (' + totalRefFaces + ' face' + (totalRefFaces > 1 ? 's' : '') + ')' + selectedText;
  } else {
    referenceInfo.classList.add('hidden');
  }
}

/**
 * Toggle face selection for reference photos
 */
function toggleFaceSelection(refIndex, faceIndex) {
  const ref = referencePhotos[refIndex];
  if (!ref || !ref.faces[faceIndex]) return;

  const face = ref.faces[faceIndex];
  face.selected = !face.selected;

  // Update visual state
  const faceBoxes = ref.wrapper.querySelectorAll('.face-box');
  const faceBox = faceBoxes[faceIndex];
  if (faceBox) {
    if (face.selected) {
      faceBox.classList.add('face-selected');
      faceBox.classList.remove('face-deselected');
      faceBox.style.borderColor = '#22c55e';
      faceBox.style.opacity = '1';
    } else {
      faceBox.classList.remove('face-selected');
      faceBox.classList.add('face-deselected');
      faceBox.style.borderColor = '#6b7280';
      faceBox.style.opacity = '0.5';
    }
  }

  setDisabledState();
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

  // Debug toggle checkbox
  debugToggle.addEventListener('change', function() {
    redrawAllReferences();
    redrawComparisons();
  });

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

  // Source tab switching
  sourceTabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      const source = tab.dataset.source;

      // Update tab active state
      sourceTabs.forEach(function(t) { t.classList.remove('active'); });
      tab.classList.add('active');

      // Show/hide content
      if (source === 'file') {
        fileSource.classList.add('active');
        fileSource.classList.remove('hidden');
        urlSource.classList.remove('active');
        urlSource.classList.add('hidden');
      } else {
        urlSource.classList.add('active');
        urlSource.classList.remove('hidden');
        fileSource.classList.remove('active');
        fileSource.classList.add('hidden');
      }
    });
  });

  // URL fetch button
  fetchUrlBtn.addEventListener('click', handleUrlFetch);

  // URL input enter key
  urlInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleUrlFetch();
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
    alert('Maximum ' + CONFIG.ui.maxReferencePhotos + ' reference photos allowed. Please clear existing ones first.');
    return;
  }

  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;

    const fileWrapper = document.createElement('div');
    fileWrapper.className = 'reference-photo-wrapper';
    preview1.appendChild(fileWrapper);

    const processor = showProcessing(fileWrapper, 'Processing ' + file.name + '...');

    try {
      processor.updateProgress(10);
      const img = await fileToImage(file);
      processor.updateProgress(30);

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

      processor.updateProgress(50);

      // Replace content while keeping processor overlay
      const processorElement = fileWrapper.querySelector('.processing-overlay');
      fileWrapper.innerHTML = '';
      fileWrapper.appendChild(wrapper);
      if (processorElement) {
        fileWrapper.appendChild(processorElement);
      }

      // Yearbook mode: use higher resolution and lower quality threshold for small faces
      const isYearbookMode = yearbookToggle.checked;
      const detectionMaxW = isYearbookMode ? 2500 : 1024;
      const qualityThreshold = isYearbookMode ? 15 : 30;

      // Detect faces on display canvas - coordinates will be in canvas space
      let detections = await faceService.detectAllFaces(canvas, { useTiny: false, maxW: detectionMaxW });

      processor.updateProgress(75);

      if (detections.length === 0) {
        processor.remove();
        showError(fileWrapper, 'No faces detected in ' + file.name);
        continue;
      }

      // Filter out low-quality faces to improve accuracy (lower threshold in yearbook mode)
      const initialCount = detections.length;
      detections = detections.filter(d => d.quality >= qualityThreshold);

      // Process each detected face
      detections.forEach((d, j) => { // `j` is now the index in the *filtered* array
        const sunglassesResult = detectSunglassesFast(img, d.landmarks);
        d.hasSunglasses = sunglassesResult.hasSunglasses;
        d.sunglassesConfidence = sunglassesResult.confidence;
        d.selected = true; // All faces selected by default

        const box = d.detection.box;
        const ageSuffix = typeof d.age === 'number' ? ' (~' + Math.round(d.age) + 'y)' : '';
        const sunglassesIndicator = d.hasSunglasses ? ' 🕶️' : '';
        const labelText = 'Ref ' + (referencePhotos.length + 1) + '.' + (j + 1) + ageSuffix + sunglassesIndicator;

        // Add a note if some faces were filtered out
        if (initialCount > detections.length && j === 0) {
          const note = `${initialCount - detections.length} low-quality face(s) ignored.`;
          d.qualityNote = note; // We can display this later if needed.
        }
        const faceBox = placeFaceBox(wrapper, box, j, labelText, '#22c55e', canvas, d.quality);

        // Make face box clickable to toggle selection
        if (faceBox) {
          faceBox.style.cursor = 'pointer';
          faceBox.dataset.faceIndex = j;
          faceBox.dataset.refIndex = referencePhotos.length;
          faceBox.classList.add('face-selected');
          faceBox.addEventListener('click', function(e) {
            e.stopPropagation();
            toggleFaceSelection(parseInt(faceBox.dataset.refIndex), parseInt(faceBox.dataset.faceIndex));
          });
        }

        if (debugToggle.checked) drawLandmarksOnCanvas(canvas, d.landmarks);
      });

      processor.updateProgress(90);

      referencePhotos.push({
        image: img,
        faces: detections,
        canvas: canvas,
        wrapper: wrapper,
        file: file,
        index: referencePhotos.length
      });

      processor.updateProgress(100);

    } catch (err) {
      processor.remove();
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
  referencePhotos.forEach((ref, i) => {
    ref.index = i;
    // Update labels
    ref.wrapper.querySelectorAll('.face-box').forEach((box, faceIdx) => {
      const label = box.querySelector('.face-label');
      if (label) {
        const face = ref.faces[faceIdx];
        const ageSuffix = typeof face.age === 'number' ? ' (~' + Math.round(face.age) + 'y)' : '';
        const sunglassesIndicator = face.hasSunglasses ? ' 🕶️' : '';
        label.textContent = 'Ref ' + (i + 1) + '.' + (faceIdx + 1) + ageSuffix + sunglassesIndicator;
      }
    });
  });
  
  setDisabledState();
}

/**
 * Redraw all reference images with current debug settings
 */
function redrawAllReferences() {
  referencePhotos.forEach((ref) => {
    ref.wrapper.querySelectorAll('.face-box').forEach(b => b.remove());

    // Clear and redraw canvas
    const ctx = ref.canvas.getContext('2d');
    ctx.clearRect(0, 0, ref.canvas.width, ref.canvas.height);
    ctx.drawImage(ref.image, 0, 0, ref.canvas.width, ref.canvas.height);

    // Redraw face boxes - coordinates are already in canvas space
    ref.faces.forEach((d, i) => {
      const box = d.detection.box;
      const ageSuffix = typeof d.age === 'number' ? ' (~' + Math.round(d.age) + 'y)' : '';
      const sunglassesIndicator = d.hasSunglasses ? ' 🕶️' : '';
      const labelText = 'Ref ' + (ref.index + 1) + '.' + (i + 1) + ageSuffix + sunglassesIndicator;

      placeFaceBox(ref.wrapper, box, i, labelText, '#22c55e', ref.canvas, d.quality);

      if (debugToggle.checked) {
        drawLandmarksOnCanvas(ref.canvas, d.landmarks);
      }
    });
  });
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

    const processor = showProcessing(fileWrapper, 'Processing ' + file.name + '...');

    try {
      processor.updateProgress(10);
      const img = await fileToImage(file);
      processor.updateProgress(30);

      const canvasData = createCanvasForImage(img, CONFIG.ui.comparisonMaxWidth, CONFIG.ui.comparisonMaxHeight);
      const canvas = canvasData.canvas;

      const wrapper = document.createElement('div');
      wrapper.style.position = 'relative';
      wrapper.style.display = 'inline-block';
      wrapper.dataset.fileName = file.name;
      wrapper.appendChild(canvas);

      processor.updateProgress(50);

      // Replace content while keeping processor overlay
      const processorElement = fileWrapper.querySelector('.processing-overlay');
      fileWrapper.innerHTML = '';
      fileWrapper.appendChild(wrapper);
      if (processorElement) {
        fileWrapper.appendChild(processorElement);
      }

      // Yearbook mode: use higher resolution and lower quality threshold for small faces
      const isYearbookMode = yearbookToggle.checked;
      const detectionMaxW = isYearbookMode ? 2500 : 1024;
      const qualityThreshold = isYearbookMode ? 15 : 30;

      // Detect faces on display canvas - coordinates will be in canvas space
      let detections = await faceService.detectAllFaces(canvas, { useTiny: false, maxW: detectionMaxW });

      processor.updateProgress(75);

      if (detections.length === 0) {
        processor.remove();
        const err = document.createElement('div');
        err.className = 'error';
        err.textContent = 'No faces detected in ' + file.name;
        wrapper.appendChild(err);
      } else {
        // Filter out low-quality faces to improve accuracy (lower threshold in yearbook mode)
        const initialCount = detections.length;
        detections = detections.filter(d => d.quality >= qualityThreshold);

        detections.forEach((d, j) => { // `j` is now the index in the *filtered* array
          const sunglassesResult = detectSunglassesFast(img, d.landmarks);
          d.hasSunglasses = sunglassesResult.hasSunglasses;
          d.sunglassesConfidence = sunglassesResult.confidence;

          if (debugToggle.checked) drawLandmarksOnCanvas(canvas, d.landmarks);

          const box = d.detection.box;
          const ageSuffix = typeof d.age === 'number' ? ' (~' + Math.round(d.age) + 'y)' : '';
          const sunglassesIndicator = d.hasSunglasses ? ' 🕶️' : '';

          // Add a note if some faces were filtered out
          if (initialCount > detections.length && j === 0) {
            const note = `${initialCount - detections.length} low-quality face(s) ignored.`;
            d.qualityNote = note;
          }
          placeFaceBox(wrapper, box, j, (j + 1) + ageSuffix + sunglassesIndicator, '#f59e0b', canvas, d.quality);
        });

        processor.updateProgress(90);

        comparisons.push({
          file: file,
          image: img,
          faces: detections,
          canvas: canvas,
          wrapper: wrapper
        });

        processor.updateProgress(100);
      }
    } catch (err) {
      processor.remove();
      showError(fileWrapper, 'Error processing ' + file.name + ': ' + err.message);
    }
  }
  
  setDisabledState();
}

/**
 * Handle URL fetch button click
 */
async function handleUrlFetch() {
  const url = urlInput.value.trim();

  if (!url) {
    showUrlStatus('Please enter a URL', 'error');
    return;
  }

  // Validate URL
  try {
    new URL(url);
  } catch (e) {
    showUrlStatus('Invalid URL format', 'error');
    return;
  }

  const maxImages = parseInt(maxImagesSelect.value, 10);
  const minSize = parseInt(minSizeSelect.value, 10);

  // Disable button during fetch
  fetchUrlBtn.disabled = true;
  fetchUrlBtn.textContent = 'Fetching...';
  urlPreview.innerHTML = '';

  showUrlStatus('<div class="progress-info"><div class="mini-spinner"></div><span>Starting fetch...</span></div>', 'loading');

  try {
    const images = await fetchImagesFromUrl(url, {
      maxImages: maxImages,
      minWidth: minSize,
      minHeight: minSize,
      onProgress: function(pct, msg) {
        showUrlStatus('<div class="progress-info"><div class="mini-spinner"></div><span>' + msg + '</span></div>', 'loading');
      }
    });

    if (images.length === 0) {
      showUrlStatus('No suitable images found on the page', 'error');
      fetchUrlBtn.disabled = false;
      fetchUrlBtn.textContent = 'Fetch Images';
      return;
    }

    showUrlStatus('Found ' + images.length + ' images. Click to select, then process selected images.', 'success');

    // Display fetched images for selection
    displayUrlImages(images);

  } catch (err) {
    showUrlStatus('Error: ' + err.message, 'error');
  }

  fetchUrlBtn.disabled = false;
  fetchUrlBtn.textContent = 'Fetch Images';
}

/**
 * Show URL status message
 */
function showUrlStatus(message, type) {
  urlStatus.innerHTML = message;
  urlStatus.className = 'url-status ' + type;
  urlStatus.classList.remove('hidden');
}

/**
 * Display fetched URL images for selection
 */
function displayUrlImages(images) {
  urlPreview.innerHTML = '';

  // Store images in a data attribute for later processing
  urlPreview.dataset.images = JSON.stringify(images.map(function(img, idx) {
    return { index: idx, url: img.url, filename: img.filename };
  }));

  // Create image items
  images.forEach(function(imgData, idx) {
    const item = document.createElement('div');
    item.className = 'url-image-item';
    item.dataset.index = idx;

    const img = document.createElement('img');
    img.src = imgData.image.src;
    img.alt = imgData.filename;

    const badge = document.createElement('div');
    badge.className = 'select-badge';
    badge.textContent = '✓';

    item.appendChild(img);
    item.appendChild(badge);

    // Toggle selection on click
    item.addEventListener('click', function() {
      item.classList.toggle('selected');
      updateUrlActions();
    });

    urlPreview.appendChild(item);

    // Store the actual image element for later use
    item._imageData = imgData;
  });

  // Add action buttons
  const actions = document.createElement('div');
  actions.className = 'url-actions';
  actions.innerHTML =
    '<button class="btn secondary" id="selectAllUrlBtn">Select All</button>' +
    '<button class="btn primary" id="processUrlBtn" disabled>Process Selected (0)</button>';
  urlPreview.appendChild(actions);

  // Select all button
  document.getElementById('selectAllUrlBtn').addEventListener('click', function() {
    const items = urlPreview.querySelectorAll('.url-image-item');
    const allSelected = Array.from(items).every(function(i) { return i.classList.contains('selected'); });

    items.forEach(function(item) {
      if (allSelected) {
        item.classList.remove('selected');
      } else {
        item.classList.add('selected');
      }
    });

    updateUrlActions();
  });

  // Process button
  document.getElementById('processUrlBtn').addEventListener('click', processSelectedUrlImages);
}

/**
 * Update URL action buttons based on selection
 */
function updateUrlActions() {
  const selected = urlPreview.querySelectorAll('.url-image-item.selected');
  const processBtn = document.getElementById('processUrlBtn');

  if (processBtn) {
    processBtn.disabled = selected.length === 0;
    processBtn.textContent = 'Process Selected (' + selected.length + ')';
  }
}

/**
 * Process selected URL images for face comparison
 */
async function processSelectedUrlImages() {
  const selectedItems = urlPreview.querySelectorAll('.url-image-item.selected');

  if (selectedItems.length === 0) {
    alert('Please select at least one image');
    return;
  }

  // Clear existing comparisons
  preview2.innerHTML = '';
  comparisons = [];

  // Process each selected image
  for (const item of selectedItems) {
    const imgData = item._imageData;
    if (!imgData || !imgData.image) continue;

    const fileWrapper = document.createElement('div');
    fileWrapper.className = 'comparison-file-wrapper';
    preview2.appendChild(fileWrapper);

    const processor = showProcessing(fileWrapper, 'Processing ' + imgData.filename + '...');

    try {
      processor.updateProgress(10);
      const img = imgData.image;
      processor.updateProgress(30);

      const canvasData = createCanvasForImage(img, CONFIG.ui.comparisonMaxWidth, CONFIG.ui.comparisonMaxHeight);
      const canvas = canvasData.canvas;

      const wrapper = document.createElement('div');
      wrapper.style.position = 'relative';
      wrapper.style.display = 'inline-block';
      wrapper.dataset.fileName = imgData.filename;
      wrapper.appendChild(canvas);

      processor.updateProgress(50);

      // Replace content while keeping processor overlay
      const processorElement = fileWrapper.querySelector('.processing-overlay');
      fileWrapper.innerHTML = '';
      fileWrapper.appendChild(wrapper);
      if (processorElement) {
        fileWrapper.appendChild(processorElement);
      }

      // Yearbook mode: use higher resolution and lower quality threshold for small faces
      const isYearbookMode = yearbookToggle.checked;
      const detectionMaxW = isYearbookMode ? 2500 : 1024;
      const qualityThreshold = isYearbookMode ? 15 : 30;

      // Detect faces on display canvas
      let detections = await faceService.detectAllFaces(canvas, { useTiny: false, maxW: detectionMaxW });

      processor.updateProgress(75);

      if (detections.length === 0) {
        processor.remove();
        const err = document.createElement('div');
        err.className = 'error';
        err.textContent = 'No faces detected in ' + imgData.filename;
        wrapper.appendChild(err);
      } else {
        // Filter out low-quality faces (lower threshold in yearbook mode)
        const initialCount = detections.length;
        detections = detections.filter(function(d) { return d.quality >= qualityThreshold; });

        detections.forEach(function(d, j) {
          const sunglassesResult = detectSunglassesFast(img, d.landmarks);
          d.hasSunglasses = sunglassesResult.hasSunglasses;
          d.sunglassesConfidence = sunglassesResult.confidence;

          if (debugToggle.checked) drawLandmarksOnCanvas(canvas, d.landmarks);

          const box = d.detection.box;
          const ageSuffix = typeof d.age === 'number' ? ' (~' + Math.round(d.age) + 'y)' : '';
          const sunglassesIndicator = d.hasSunglasses ? ' 🕶️' : '';

          if (initialCount > detections.length && j === 0) {
            d.qualityNote = (initialCount - detections.length) + ' low-quality face(s) ignored.';
          }

          placeFaceBox(wrapper, box, j, (j + 1) + ageSuffix + sunglassesIndicator, '#f59e0b', canvas, d.quality);
        });

        processor.updateProgress(90);

        comparisons.push({
          file: { name: imgData.filename }, // Fake file object for compatibility
          image: img,
          faces: detections,
          canvas: canvas,
          wrapper: wrapper,
          sourceUrl: imgData.url
        });

        processor.updateProgress(100);
      }
    } catch (err) {
      processor.remove();
      showError(fileWrapper, 'Error processing ' + imgData.filename + ': ' + err.message);
    }
  }

  setDisabledState();

  // Switch to file source tab to show results
  sourceTabs.forEach(function(t) { t.classList.remove('active'); });
  document.querySelector('.source-tab[data-source="file"]').classList.add('active');
  fileSource.classList.add('active');
  fileSource.classList.remove('hidden');
  urlSource.classList.remove('active');
  urlSource.classList.add('hidden');
}

/**
 * Redraw all comparison images with current debug settings
 */
function redrawComparisons() {
  comparisons.forEach((comp) => {
    comp.wrapper.querySelectorAll('.face-box').forEach(b => b.remove());

    const ctx = comp.canvas.getContext('2d');
    ctx.clearRect(0, 0, comp.canvas.width, comp.canvas.height);
    ctx.drawImage(comp.image, 0, 0, comp.canvas.width, comp.canvas.height);

    comp.faces.forEach((d, i) => {
      if (debugToggle.checked) {
        drawLandmarksOnCanvas(comp.canvas, d.landmarks);
      }

      const box = d.detection.box;
      const ageSuffix = typeof d.age === 'number' ? ' (~' + Math.round(d.age) + 'y)' : '';
      const sunglassesIndicator = d.hasSunglasses ? ' 🕶️' : '';

      placeFaceBox(comp.wrapper, box, i, (i + 1) + ageSuffix + sunglassesIndicator, '#f59e0b', comp.canvas, d.quality);
    });
  });
}

/**
 * Perform face comparison between reference(s) and comparison photos
 */
async function performComparison() {
  resultsDiv.classList.remove('hidden');
  resultsDiv.innerHTML = '<h2>📊 Comparison Results</h2>';

  if (referencePhotos.length === 0) return;

  // Collect only SELECTED reference descriptors
  const allRefDescriptors = [];
  const allRefSunglasses = [];
  referencePhotos.forEach(ref => {
    ref.faces.forEach(face => {
      if (face.selected) {
        allRefDescriptors.push(face.descriptor);
        allRefSunglasses.push(face.hasSunglasses);
      }
    });
  });
  const anyRefSunglasses = allRefSunglasses.some(function(s) { return s; });

  if (allRefDescriptors.length === 0) {
    alert('Please select at least one reference face');
    return;
  }
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
  comparisons.forEach((comp, imgIndex) => {
    comp.faces.forEach((face, faceIndex) => {
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
  comparisonResults = allComparisons; // This is now a global state

  // Update visual indicators
  updateComparisonVisuals(allComparisons);

  // Display results
  const tpl = document.getElementById('resultItemTpl');
  allComparisons.forEach(function(c, idx) {
    const node = tpl.content.cloneNode(true);
    const root = node.querySelector('.result-item');

    // Extract face thumbnail
    const compSet = comparisons[c.imageIndex];
    if (compSet && compSet.canvas && compSet.faces && compSet.faces[c.faceIndex]) {
      const face = compSet.faces[c.faceIndex];
      const box = face.detection.box;
      const faceCrop = cropFaceFromCanvas(compSet.canvas, box, 0.3);

      // Create thumbnail container
      const thumbnailDiv = document.createElement('div');
      thumbnailDiv.className = 'result-face-thumbnail';
      thumbnailDiv.appendChild(faceCrop);

      // Color code thumbnail border based on similarity
      if (c.similarity >= 85) {
        thumbnailDiv.style.borderColor = 'var(--success)';
        thumbnailDiv.style.boxShadow = '0 2px 8px rgba(16, 185, 129, 0.3)';
      } else if (c.similarity >= 70) {
        thumbnailDiv.style.borderColor = '#8bc34a';
        thumbnailDiv.style.boxShadow = '0 2px 8px rgba(139, 195, 74, 0.3)';
      } else if (c.similarity >= 50) {
        thumbnailDiv.style.borderColor = '#ff9800';
        thumbnailDiv.style.boxShadow = '0 2px 8px rgba(255, 152, 0, 0.3)';
      } else {
        thumbnailDiv.style.borderColor = 'var(--danger)';
        thumbnailDiv.style.boxShadow = '0 2px 8px rgba(239, 68, 68, 0.3)';
      }

      // Insert thumbnail before the title
      root.insertBefore(thumbnailDiv, root.firstChild);

      // Wrap existing content
      const contentDiv = document.createElement('div');
      contentDiv.className = 'result-content';
      while (root.children.length > 1) {
        contentDiv.appendChild(root.children[1]);
      }
      root.appendChild(contentDiv);
    } else {
      root.classList.add('no-thumbnail');
    }

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
  summary.className = 'result-item no-thumbnail';
  summary.innerHTML =
    '<h3>Summary</h3>' +
    '<p>Found <strong>' + matches + '</strong> likely match' + (matches !== 1 ? 'es' : '') + ' out of <strong>' + total + '</strong> face' + (total !== 1 ? 's' : '') + '.</p>' +
    '<p style="margin-top: 8px; font-size: 0.9em; color: var(--text-muted);">' +
    'Multi-reference comparison improves accuracy by comparing against ' + allRefDescriptors.length + ' reference samples' +
    '</p>';
  resultsDiv.appendChild(summary);

  // Export buttons
  const hasOver60 = allComparisons.some(function(c) { return c.similarity >= CONFIG.export.matchThreshold; });
  if (hasOver60) {
    const exportSheetBtn = document.createElement('button');
    exportSheetBtn.className = 'btn secondary';
    exportSheetBtn.style.marginTop = '10px';
    exportSheetBtn.textContent = 'Export match sheet (≥ ' + CONFIG.export.matchThreshold + '%)';
    exportSheetBtn.addEventListener('click', function() { exportMatchSheet(); });
    resultsDiv.appendChild(exportSheetBtn);
  }

  // ZIP Export controls
  const zipExportDiv = document.createElement('div');
  zipExportDiv.className = 'export-controls';
  zipExportDiv.style.marginTop = '20px';
  zipExportDiv.style.padding = '15px';
  zipExportDiv.style.background = 'rgba(255, 255, 255, 0.05)';
  zipExportDiv.style.borderRadius = '8px';

  const zipTitle = document.createElement('h3');
  zipTitle.textContent = 'Export Matching Photos to ZIP';
  zipTitle.style.marginTop = '0';
  zipTitle.style.marginBottom = '10px';
  zipExportDiv.appendChild(zipTitle);

  const zipDescription = document.createElement('p');
  zipDescription.textContent = 'Download all photos containing faces that match the reference at or above the selected threshold:';
  zipDescription.style.fontSize = '0.9em';
  zipDescription.style.color = 'var(--muted)';
  zipDescription.style.marginBottom = '15px';
  zipExportDiv.appendChild(zipDescription);

  // Threshold buttons
  const thresholds = [60, 75, 80, 90];
  const buttonContainer = document.createElement('div');
  buttonContainer.style.display = 'flex';
  buttonContainer.style.gap = '10px';
  buttonContainer.style.flexWrap = 'wrap';

  thresholds.forEach(function(threshold) {
    const matchCount = allComparisons.filter(function(c) { return c.similarity >= threshold; }).length;
    const btn = document.createElement('button');
    btn.className = 'btn secondary';
    btn.textContent = '≥ ' + threshold + '% (' + matchCount + ' match' + (matchCount !== 1 ? 'es' : '') + ')';
    btn.disabled = matchCount === 0;

    if (matchCount > 0) {
      btn.addEventListener('click', function() {
        exportMatchingPhotosToZip(threshold);
      });
    }

    buttonContainer.appendChild(btn);
  });

  zipExportDiv.appendChild(buttonContainer);
  resultsDiv.appendChild(zipExportDiv);

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
 * Export matching photos to ZIP file with threshold filter
 * @param {number} threshold - Minimum similarity percentage (60, 75, 80, 90)
 */
async function exportMatchingPhotosToZip(threshold) {
  if (!comparisonResults || !comparisonResults.length) {
    alert('No comparison results available.');
    return;
  }

  const matches = comparisonResults.filter(function(c) {
    return c.similarity >= threshold;
  });

  if (!matches.length) {
    alert('No matches with similarity ≥ ' + threshold + '%.');
    return;
  }

  try {
    // Check if JSZip is available
    if (typeof JSZip === 'undefined') {
      alert('JSZip library not loaded. Please refresh the page.');
      return;
    }

    const zip = new JSZip();
    const folder = zip.folder('matched_faces_' + threshold + 'percent');

    // Track which files we've already added to avoid duplicates
    const addedFiles = new Map();

    // Process each match
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const compSet = comparisons[match.imageIndex];

      if (!compSet || !compSet.file) continue;

      const fileName = compSet.file.name;
      const fileKey = fileName + '_' + match.faceIndex;

      // Skip if we've already added this exact file/face combination
      if (addedFiles.has(fileKey)) continue;

      // Read the original file and add to ZIP
      try {
        const fileData = await readFileAsArrayBuffer(compSet.file);

        // Create a unique filename with similarity score
        const nameParts = fileName.split('.');
        const ext = nameParts.pop();
        const baseName = nameParts.join('.');
        const newFileName = baseName + '_face' + (match.faceIndex + 1) + '_' + match.similarity.toFixed(1) + 'percent.' + ext;

        folder.file(newFileName, fileData);
        addedFiles.set(fileKey, true);
      } catch (err) {
        console.error('Error adding file to ZIP:', fileName, err);
      }
    }

    // Generate ZIP file
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    // Download ZIP file
    const link = document.createElement('a');
    link.href = URL.createObjectURL(zipBlob);
    link.download = 'matched_faces_' + threshold + 'percent_' + new Date().toISOString().split('T')[0] + '.zip';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    alert('Successfully exported ' + addedFiles.size + ' matched photo' + (addedFiles.size !== 1 ? 's' : '') + ' to ZIP file.');
  } catch (err) {
    console.error('ZIP export failed:', err);
    alert('Failed to create ZIP file: ' + err.message);
  }
}

/**
 * Read a File object as ArrayBuffer
 * @param {File} file - File to read
 * @returns {Promise<ArrayBuffer>} File data as ArrayBuffer
 */
function readFileAsArrayBuffer(file) {
  return new Promise(function(resolve, reject) {
    const reader = new FileReader();
    reader.onload = function(e) { resolve(e.target.result); };
    reader.onerror = function() { reject(new Error('Failed to read file')); };
    reader.readAsArrayBuffer(file);
  });
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
    alert("PNG downloaded successfully. PDF generation failed: " + err.message);
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
  boot().then(function() {
    // Check for images passed via URL hash (from browser extension)
    checkForExtensionImages();
  });
});

/**
 * Check for images passed from browser extension via URL hash
 */
function checkForExtensionImages() {
  const hash = window.location.hash;
  console.log('[FaceCompare] Checking for extension images, hash:', hash);

  if (!hash || !hash.startsWith('#images=')) {
    console.log('[FaceCompare] No extension images in hash');
    return;
  }

  try {
    const encoded = hash.substring(8); // Remove '#images='
    const imageUrls = JSON.parse(decodeURIComponent(encoded));
    console.log('[FaceCompare] Parsed image URLs:', imageUrls);

    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
      console.log('[FaceCompare] No valid image URLs found');
      return;
    }

    // Clear the hash to avoid reprocessing on refresh
    history.replaceState(null, '', window.location.pathname);

    // Switch to URL tab first so the status div is visible
    sourceTabs.forEach(function(t) { t.classList.remove('active'); });
    const urlTab = document.querySelector('.source-tab[data-source="url"]');
    if (urlTab) urlTab.classList.add('active');
    fileSource.classList.remove('active');
    fileSource.classList.add('hidden');
    urlSource.classList.add('active');
    urlSource.classList.remove('hidden');

    // Show notification
    showUrlStatus('Received ' + imageUrls.length + ' images from extension. Loading...', 'loading');
    console.log('[FaceCompare] Starting to load extension images');

    // Load images from URLs
    loadExtensionImages(imageUrls);

  } catch (e) {
    console.error('[FaceCompare] Failed to parse extension images:', e);
    showUrlStatus('Failed to parse images from extension: ' + e.message, 'error');
  }
}

/**
 * Load images passed from browser extension
 */
async function loadExtensionImages(imageUrls) {
  console.log('[FaceCompare] loadExtensionImages called with', imageUrls.length, 'URLs');
  const images = [];
  let loaded = 0;
  let failed = 0;

  for (const url of imageUrls) {
    try {
      console.log('[FaceCompare] Loading image:', url);
      const img = await loadImageFromUrl(url);
      images.push({
        image: img,
        url: url,
        filename: extractFilenameFromUrl(url)
      });
      console.log('[FaceCompare] Successfully loaded:', url);
    } catch (e) {
      console.error('[FaceCompare] Failed to load image:', url, e);
      failed++;
    }

    loaded++;
    showUrlStatus('Loading images: ' + loaded + '/' + imageUrls.length + (failed > 0 ? ' (' + failed + ' failed)' : ''), 'loading');
  }

  console.log('[FaceCompare] Finished loading. Success:', images.length, 'Failed:', failed);

  if (images.length === 0) {
    showUrlStatus('Failed to load images from extension. Images may be blocked by CORS.', 'error');
    return;
  }

  showUrlStatus('Loaded ' + images.length + ' images. Click to select, then process.', 'success');
  displayUrlImages(images);
}

/**
 * Load a single image from URL (with CORS proxy fallback)
 */
function loadImageFromUrl(url) {
  return new Promise(function(resolve, reject) {
    // Try direct load first
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const timeout = setTimeout(function() {
      console.log('[FaceCompare] Direct load timeout, trying proxy:', url);
      tryWithProxy();
    }, 5000);

    img.onload = function() {
      clearTimeout(timeout);
      console.log('[FaceCompare] Direct load success:', url);
      resolve(img);
    };

    img.onerror = function() {
      clearTimeout(timeout);
      console.log('[FaceCompare] Direct load failed, trying proxy:', url);
      tryWithProxy();
    };

    img.src = url;

    function tryWithProxy() {
      const proxyImg = new Image();
      proxyImg.crossOrigin = 'anonymous';

      const proxyTimeout = setTimeout(function() {
        reject(new Error('Proxy load timeout'));
      }, 15000);

      proxyImg.onload = function() {
        clearTimeout(proxyTimeout);
        console.log('[FaceCompare] Proxy load success:', url);
        resolve(proxyImg);
      };

      proxyImg.onerror = function() {
        clearTimeout(proxyTimeout);
        console.log('[FaceCompare] Proxy load failed:', url);
        reject(new Error('Failed to load image'));
      };

      proxyImg.src = 'https://corsproxy.io/?' + encodeURIComponent(url);
    }
  });
}

/**
 * Extract filename from URL
 */
function extractFilenameFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split('/').pop() || 'image';
    return decodeURIComponent(filename).substring(0, 100);
  } catch (e) {
    return 'image_' + Date.now();
  }
}
