// reverse-search.js - Reverse image search integration (Fixed version)

/**
 * Convert canvas to blob for downloading
 * @param {HTMLCanvasElement} canvas - Canvas to convert
 * @param {string} type - Image type (default: image/jpeg)
 * @param {number} quality - Image quality 0-1 (default: 0.9)
 * @returns {Promise<Blob>} Image blob
 */
export function canvasToBlob(canvas, type, quality) {
  type = type || 'image/jpeg';
  quality = quality || 0.9;
  
  return new Promise(function(resolve, reject) {
    canvas.toBlob(function(blob) {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to convert canvas to blob'));
      }
    }, type, quality);
  });
}

/**
 * Download a blob as a file
 * @param {Blob} blob - Blob to download
 * @param {string} filename - Filename
 */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  // Clean up the URL after a delay
  setTimeout(function() {
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Open Google reverse image search with instructions
 * @param {Blob} imageBlob - Image blob to search
 * @returns {Promise<boolean>}
 */
export async function searchGoogle(imageBlob) {
  try {
    // Download the image for user to upload manually
    downloadBlob(imageBlob, 'face_search.jpg');
    
    // Open Google Images search page
    setTimeout(function() {
      window.open('https://www.google.com/imghp?hl=en', '_blank');
    }, 500);
    
    return true;
  } catch (err) {
    console.error('Google search failed:', err);
    return false;
  }
}

/**
 * Open Yandex reverse image search
 * @param {Blob} imageBlob - Image blob to search  
 * @returns {Promise<boolean>}
 */
export async function searchYandex(imageBlob) {
  try {
    // Download the image
    downloadBlob(imageBlob, 'face_search.jpg');
    
    // Open Yandex Images
    setTimeout(function() {
      window.open('https://yandex.com/images/', '_blank');
    }, 500);
    
    return true;
  } catch (err) {
    console.error('Yandex search failed:', err);
    return false;
  }
}

/**
 * Open Bing visual search
 * @param {Blob} imageBlob - Image blob to search
 * @returns {Promise<boolean>}
 */
export async function searchBing(imageBlob) {
  try {
    // Download the image
    downloadBlob(imageBlob, 'face_search.jpg');
    
    // Open Bing Visual Search
    setTimeout(function() {
      window.open('https://www.bing.com/visualsearch', '_blank');
    }, 500);
    
    return true;
  } catch (err) {
    console.error('Bing search failed:', err);
    return false;
  }
}

/**
 * Open TinEye reverse image search
 * @param {Blob} imageBlob - Image blob to search
 * @returns {Promise<boolean>}
 */
export async function searchTinEye(imageBlob) {
  try {
    // Download the image
    downloadBlob(imageBlob, 'face_search.jpg');
    
    // Open TinEye
    setTimeout(function() {
      window.open('https://tineye.com/', '_blank');
    }, 500);
    
    return true;
  } catch (err) {
    console.error('TinEye search failed:', err);
    return false;
  }
}

/**
 * Perform reverse image search on multiple engines
 * @param {HTMLCanvasElement} canvas - Canvas containing the image
 * @param {Object} options - Search options
 * @returns {Promise<Object>} Results object
 */
export async function reverseImageSearch(canvas, options) {
  options = options || {};
  const engines = options.engines || {
    google: true,
    yandex: true,
    bing: true,
    tineye: true
  };
  
  try {
    // Convert canvas to blob
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
    
    const results = {
      success: [],
      failed: []
    };
    
    const enabledEngines = [];
    if (engines.google) enabledEngines.push('google');
    if (engines.yandex) enabledEngines.push('yandex');
    if (engines.bing) enabledEngines.push('bing');
    if (engines.tineye) enabledEngines.push('tineye');
    
    // Download image once for all searches
    downloadBlob(blob, 'face_search.jpg');
    
    // Open each search engine with delay
    for (let i = 0; i < enabledEngines.length; i++) {
      const engine = enabledEngines[i];
      let success = false;
      
      await delay(i * 600); // Stagger to avoid popup blocking
      
      switch(engine) {
        case 'google':
          window.open('https://www.google.com/imghp?hl=en', '_blank');
          success = true;
          break;
        case 'yandex':
          window.open('https://yandex.com/images/', '_blank');
          success = true;
          break;
        case 'bing':
          window.open('https://www.bing.com/visualsearch', '_blank');
          success = true;
          break;
        case 'tineye':
          window.open('https://tineye.com/', '_blank');
          success = true;
          break;
      }
      
      if (success) {
        results.success.push(engine.charAt(0).toUpperCase() + engine.slice(1));
      } else {
        results.failed.push(engine.charAt(0).toUpperCase() + engine.slice(1));
      }
    }
    
    return results;
  } catch (err) {
    console.error('Reverse image search failed:', err);
    throw err;
  }
}

/**
 * Simple delay utility
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise}
 */
function delay(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * Create a search menu UI element with instructions
 * @param {Function} onSearch - Callback when search is initiated
 * @returns {HTMLElement} Search menu element
 */
export function createSearchMenu(onSearch) {
  const menu = document.createElement('div');
  menu.className = 'reverse-search-menu';
  menu.innerHTML = `
    <div class="search-menu-header">
      <span>🔍 Search Online</span>
      <button class="close-menu">×</button>
    </div>
    <div class="search-menu-instructions">
      <p><strong>How it works:</strong></p>
      <ol>
        <li>Image will be <strong>downloaded</strong> to your computer</li>
        <li>Search engine pages will <strong>open in new tabs</strong></li>
        <li>Click the <strong>camera/upload icon</strong> on each search page</li>
        <li>Upload the downloaded <strong>face_search.jpg</strong> file</li>
      </ol>
    </div>
    <div class="search-menu-options">
      <button class="search-btn" data-engine="all">
        <span class="engine-icon">🌐</span>
        <span>Open All Search Engines</span>
      </button>
      <button class="search-btn" data-engine="google">
        <span class="engine-icon">G</span>
        <span>Google Images</span>
      </button>
      <button class="search-btn" data-engine="yandex">
        <span class="engine-icon">Я</span>
        <span>Yandex Images</span>
      </button>
      <button class="search-btn" data-engine="bing">
        <span class="engine-icon">B</span>
        <span>Bing Visual Search</span>
      </button>
      <button class="search-btn" data-engine="tineye">
        <span class="engine-icon">👁️</span>
        <span>TinEye</span>
      </button>
    </div>
    <div class="search-menu-note">
      ⚠️ Due to security restrictions, the image will download and you'll need to manually upload it to the search engines.
    </div>
  `;
  
  // Add event listeners
  const closeBtn = menu.querySelector('.close-menu');
  closeBtn.addEventListener('click', function() {
    menu.remove();
  });
  
  const searchButtons = menu.querySelectorAll('.search-btn');
  searchButtons.forEach(function(btn) {
    btn.addEventListener('click', function() {
      const engine = btn.dataset.engine;
      onSearch(engine);
      menu.remove();
    });
  });
  
  return menu;
}
