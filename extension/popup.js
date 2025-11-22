// popup.js - Extension popup functionality

// Configuration - FaceCompare GitHub Pages URL
const FACECOMPARE_URL = 'https://cn814.github.io/facecompare/';

// DOM Elements
const extractBtn = document.getElementById('extractBtn');
const minSizeSelect = document.getElementById('minSize');
const maxImagesSelect = document.getElementById('maxImages');
const statusDiv = document.getElementById('status');
const resultsDiv = document.getElementById('results');
const imageGrid = document.getElementById('imageGrid');
const imageCountSpan = document.getElementById('imageCount');
const selectedCountSpan = document.getElementById('selectedCount');
const selectAllBtn = document.getElementById('selectAllBtn');
const deselectAllBtn = document.getElementById('deselectAllBtn');
const exportBtn = document.getElementById('exportBtn');
const downloadBtn = document.getElementById('downloadBtn');
const openFaceCompareLink = document.getElementById('openFaceCompare');

// State
let extractedImages = [];

// Show status message
function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = 'status ' + type;
}

// Hide status
function hideStatus() {
  statusDiv.className = 'status';
}

// Update selected count
function updateSelectedCount() {
  const selected = document.querySelectorAll('.image-item.selected');
  selectedCountSpan.textContent = selected.length;
  exportBtn.disabled = selected.length === 0;
  downloadBtn.disabled = selected.length === 0;
}

// Extract images from current tab
async function extractImages() {
  showStatus('Extracting images...', 'loading');
  extractBtn.disabled = true;

  const minSize = parseInt(minSizeSelect.value, 10);
  const maxImages = parseInt(maxImagesSelect.value, 10);

  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      showStatus('No active tab found', 'error');
      extractBtn.disabled = false;
      return;
    }

    // Execute content script to extract images
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractImagesFromPage,
      args: [minSize, maxImages]
    });

    if (!results || !results[0] || !results[0].result) {
      showStatus('Failed to extract images', 'error');
      extractBtn.disabled = false;
      return;
    }

    extractedImages = results[0].result;

    if (extractedImages.length === 0) {
      showStatus('No suitable images found on this page', 'error');
      extractBtn.disabled = false;
      return;
    }

    // Display results
    displayImages(extractedImages);
    showStatus('Found ' + extractedImages.length + ' images', 'success');

  } catch (err) {
    console.error('Extraction error:', err);
    showStatus('Error: ' + err.message, 'error');
  }

  extractBtn.disabled = false;
}

// Function that runs in the page context to extract images
function extractImagesFromPage(minSize, maxImages) {
  const images = [];
  const seenUrls = new Set();

  // Helper to check if URL is valid image
  function isValidImageUrl(url) {
    if (!url || url.startsWith('data:') || url.startsWith('blob:')) return false;
    if (url.includes('data:image')) return false;
    return true;
  }

  // Helper to get absolute URL
  function getAbsoluteUrl(src) {
    if (!src) return null;
    try {
      return new URL(src, window.location.href).href;
    } catch (e) {
      return null;
    }
  }

  // Extract from <img> elements
  document.querySelectorAll('img').forEach(function(img) {
    if (images.length >= maxImages) return;

    const src = img.src || img.dataset.src || img.dataset.lazySrc;
    const absoluteUrl = getAbsoluteUrl(src);

    if (!absoluteUrl || !isValidImageUrl(absoluteUrl)) return;
    if (seenUrls.has(absoluteUrl)) return;

    // Check size
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;

    if (width >= minSize && height >= minSize) {
      seenUrls.add(absoluteUrl);
      images.push({
        url: absoluteUrl,
        width: width,
        height: height,
        alt: img.alt || ''
      });
    }
  });

  // Extract from background images
  document.querySelectorAll('*').forEach(function(el) {
    if (images.length >= maxImages) return;

    const style = window.getComputedStyle(el);
    const bgImage = style.backgroundImage;

    if (bgImage && bgImage !== 'none') {
      const matches = bgImage.match(/url\(['"]?([^'")\s]+)['"]?\)/gi);
      if (matches) {
        matches.forEach(function(match) {
          if (images.length >= maxImages) return;

          const url = match.replace(/url\(['"]?/, '').replace(/['"]?\)/, '');
          const absoluteUrl = getAbsoluteUrl(url);

          if (!absoluteUrl || !isValidImageUrl(absoluteUrl)) return;
          if (seenUrls.has(absoluteUrl)) return;

          seenUrls.add(absoluteUrl);
          images.push({
            url: absoluteUrl,
            width: 0,
            height: 0,
            alt: 'Background image'
          });
        });
      }
    }
  });

  // Extract from <a> tags linking to images
  document.querySelectorAll('a[href]').forEach(function(a) {
    if (images.length >= maxImages) return;

    const href = a.href;
    if (!href) return;

    const imageExtensions = /\.(jpg|jpeg|png|gif|webp|bmp|avif)(\?.*)?$/i;
    if (imageExtensions.test(href)) {
      const absoluteUrl = getAbsoluteUrl(href);

      if (!absoluteUrl || !isValidImageUrl(absoluteUrl)) return;
      if (seenUrls.has(absoluteUrl)) return;

      seenUrls.add(absoluteUrl);
      images.push({
        url: absoluteUrl,
        width: 0,
        height: 0,
        alt: 'Linked image'
      });
    }
  });

  // Extract from Open Graph meta tags
  document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]').forEach(function(meta) {
    if (images.length >= maxImages) return;

    const content = meta.getAttribute('content');
    const absoluteUrl = getAbsoluteUrl(content);

    if (!absoluteUrl || !isValidImageUrl(absoluteUrl)) return;
    if (seenUrls.has(absoluteUrl)) return;

    seenUrls.add(absoluteUrl);
    images.push({
      url: absoluteUrl,
      width: 0,
      height: 0,
      alt: 'Meta image'
    });
  });

  return images;
}

// Display extracted images in grid
function displayImages(images) {
  imageGrid.innerHTML = '';
  imageCountSpan.textContent = images.length;

  images.forEach(function(imgData, index) {
    const item = document.createElement('div');
    item.className = 'image-item';
    item.dataset.index = index;

    const img = document.createElement('img');
    img.src = imgData.url;
    img.alt = imgData.alt || 'Image ' + (index + 1);
    img.onerror = function() {
      item.style.display = 'none';
    };

    const badge = document.createElement('div');
    badge.className = 'check-badge';
    badge.textContent = '✓';

    item.appendChild(img);
    item.appendChild(badge);

    item.addEventListener('click', function() {
      item.classList.toggle('selected');
      updateSelectedCount();
    });

    imageGrid.appendChild(item);
  });

  resultsDiv.classList.remove('hidden');
  updateSelectedCount();
}

// Select all images
function selectAll() {
  document.querySelectorAll('.image-item').forEach(function(item) {
    item.classList.add('selected');
  });
  updateSelectedCount();
}

// Deselect all images
function deselectAll() {
  document.querySelectorAll('.image-item').forEach(function(item) {
    item.classList.remove('selected');
  });
  updateSelectedCount();
}

// Get selected image URLs
function getSelectedImages() {
  const selected = [];
  document.querySelectorAll('.image-item.selected').forEach(function(item) {
    const index = parseInt(item.dataset.index, 10);
    if (extractedImages[index]) {
      selected.push(extractedImages[index]);
    }
  });
  return selected;
}

// Export selected images to FaceCompare
async function exportToFaceCompare() {
  const selected = getSelectedImages();

  if (selected.length === 0) {
    showStatus('Please select at least one image', 'error');
    return;
  }

  // Store selected images in extension storage
  await chrome.storage.local.set({
    faceCompareImages: selected,
    timestamp: Date.now()
  });

  // Create URL with image data
  const imageUrls = selected.map(img => img.url);

  // Pass images via URL hash (limit to ~50 to avoid URL length issues)
  let targetUrl = FACECOMPARE_URL;
  const encoded = encodeURIComponent(JSON.stringify(imageUrls));

  // Check URL length - browsers typically support ~2000 chars, but let's be safe
  if (encoded.length < 8000) {
    targetUrl = FACECOMPARE_URL + '#images=' + encoded;
    console.log('[FaceCompare Extension] Opening with hash, length:', encoded.length);
  } else {
    // Too many images - user will need to use the URL fetch feature manually
    console.log('[FaceCompare Extension] Too many images for URL hash, opening without');
    showStatus('Too many images for direct transfer. Use "Download Selected" then upload to FaceCompare.', 'error');
    return;
  }

  // Open FaceCompare with the images
  chrome.tabs.create({ url: targetUrl });

  showStatus('Opening FaceCompare with ' + selected.length + ' images...', 'success');
}

// Download selected images
async function downloadSelected() {
  const selected = getSelectedImages();

  if (selected.length === 0) {
    showStatus('Please select at least one image', 'error');
    return;
  }

  showStatus('Downloading ' + selected.length + ' images...', 'loading');

  let downloaded = 0;
  for (const imgData of selected) {
    try {
      // Use chrome.downloads API
      await chrome.downloads.download({
        url: imgData.url,
        filename: 'facecompare_images/' + extractFilename(imgData.url)
      });
      downloaded++;
    } catch (err) {
      console.error('Download failed:', imgData.url, err);
    }
  }

  showStatus('Downloaded ' + downloaded + ' of ' + selected.length + ' images', 'success');
}

// Extract filename from URL
function extractFilename(url) {
  try {
    const pathname = new URL(url).pathname;
    let filename = pathname.split('/').pop() || 'image';
    // Remove query params and ensure extension
    filename = filename.split('?')[0];
    if (!/\.(jpg|jpeg|png|gif|webp|bmp|avif)$/i.test(filename)) {
      filename += '.jpg';
    }
    return filename;
  } catch (e) {
    return 'image_' + Date.now() + '.jpg';
  }
}

// Open FaceCompare tool
function openFaceCompareTool() {
  chrome.tabs.create({
    url: FACECOMPARE_URL
  });
}

// Event listeners
extractBtn.addEventListener('click', extractImages);
selectAllBtn.addEventListener('click', selectAll);
deselectAllBtn.addEventListener('click', deselectAll);
exportBtn.addEventListener('click', exportToFaceCompare);
downloadBtn.addEventListener('click', downloadSelected);
openFaceCompareLink.addEventListener('click', function(e) {
  e.preventDefault();
  openFaceCompareTool();
});

// Initialize
document.addEventListener('DOMContentLoaded', function() {
  // Load saved settings
  chrome.storage.local.get(['minSize', 'maxImages'], function(result) {
    if (result.minSize) minSizeSelect.value = result.minSize;
    if (result.maxImages) maxImagesSelect.value = result.maxImages;
  });
});

// Save settings when changed
minSizeSelect.addEventListener('change', function() {
  chrome.storage.local.set({ minSize: minSizeSelect.value });
});

maxImagesSelect.addEventListener('change', function() {
  chrome.storage.local.set({ maxImages: maxImagesSelect.value });
});
