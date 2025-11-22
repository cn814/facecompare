// background.js - Service worker for FaceCompare extension

// Handle extension installation
chrome.runtime.onInstalled.addListener(function(details) {
  if (details.reason === 'install') {
    console.log('[FaceCompare] Extension installed');

    // Set default settings
    chrome.storage.local.set({
      minSize: '100',
      maxImages: '50'
    });
  }
});

// Handle messages from content scripts or popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'fetchImage') {
    // Fetch image and convert to base64 (bypasses CORS)
    fetchImageAsBase64(request.url)
      .then(function(base64) {
        sendResponse({ success: true, data: base64 });
      })
      .catch(function(err) {
        sendResponse({ success: false, error: err.message });
      });

    return true; // Keep message channel open for async response
  }

  if (request.action === 'downloadImages') {
    downloadImages(request.images);
    sendResponse({ success: true });
  }

  if (request.action === 'openFaceCompare') {
    // Open FaceCompare tool in a new tab
    chrome.tabs.create({
      url: chrome.runtime.getURL('index.html')
    });
    sendResponse({ success: true });
  }
});

/**
 * Fetch an image and convert to base64
 * This bypasses CORS restrictions since it runs in the service worker
 */
async function fetchImageAsBase64(url) {
  try {
    const response = await fetch(url, {
      mode: 'cors',
      credentials: 'omit'
    });

    if (!response.ok) {
      throw new Error('Failed to fetch image: ' + response.status);
    }

    const blob = await response.blob();
    return new Promise(function(resolve, reject) {
      const reader = new FileReader();
      reader.onloadend = function() {
        resolve(reader.result);
      };
      reader.onerror = function() {
        reject(new Error('Failed to read image data'));
      };
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    throw new Error('Fetch failed: ' + err.message);
  }
}

/**
 * Download multiple images
 */
async function downloadImages(images) {
  for (const img of images) {
    try {
      await chrome.downloads.download({
        url: img.url,
        filename: 'facecompare_images/' + extractFilename(img.url),
        conflictAction: 'uniquify'
      });
    } catch (err) {
      console.error('[FaceCompare] Download failed:', img.url, err);
    }
  }
}

/**
 * Extract filename from URL
 */
function extractFilename(url) {
  try {
    const pathname = new URL(url).pathname;
    let filename = pathname.split('/').pop() || 'image';
    filename = filename.split('?')[0];
    filename = decodeURIComponent(filename);

    // Ensure valid extension
    if (!/\.(jpg|jpeg|png|gif|webp|bmp|avif)$/i.test(filename)) {
      filename += '.jpg';
    }

    // Sanitize filename
    filename = filename.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);

    return filename;
  } catch (e) {
    return 'image_' + Date.now() + '.jpg';
  }
}

// Context menu for right-clicking on images
chrome.runtime.onInstalled.addListener(function() {
  chrome.contextMenus.create({
    id: 'addToFaceCompare',
    title: 'Add to FaceCompare',
    contexts: ['image']
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(function(info, tab) {
  if (info.menuItemId === 'addToFaceCompare') {
    // Store the image URL for FaceCompare
    chrome.storage.local.get(['faceCompareImages'], function(result) {
      const images = result.faceCompareImages || [];
      images.push({
        url: info.srcUrl,
        width: 0,
        height: 0,
        alt: 'Right-click added'
      });

      chrome.storage.local.set({
        faceCompareImages: images,
        timestamp: Date.now()
      });

      // Show notification
      chrome.action.setBadgeText({ text: images.length.toString() });
      chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
    });
  }
});

console.log('[FaceCompare] Background service worker loaded');
