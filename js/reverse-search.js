// reverse-search.js - Reverse image search integration

/**
 * Convert canvas to blob for uploading
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
 * Convert blob to base64 data URL
 * @param {Blob} blob - Blob to convert
 * @returns {Promise<string>} Base64 data URL
 */
export function blobToDataURL(blob) {
  return new Promise(function(resolve, reject) {
    const reader = new FileReader();
    reader.onload = function() {
      resolve(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Open Google reverse image search
 * @param {Blob} imageBlob - Image blob to search
 */
export async function searchGoogle(imageBlob) {
  try {
    // Google Images accepts base64 data URLs via URL parameter
    const dataURL = await blobToDataURL(imageBlob);
    
    // Create a form and submit it
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = 'https://www.google.com/searchbyimage/upload';
    form.target = '_blank';
    
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'encoded_image';
    input.value = dataURL.split(',')[1]; // Remove data:image/jpeg;base64, prefix
    
    const inputType = document.createElement('input');
    inputType.type = 'hidden';
    inputType.name = 'image_content';
    inputType.value = '';
    
    form.appendChild(input);
    form.appendChild(inputType);
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
    
    return true;
  } catch (err) {
    console.error('Google search failed:', err);
    return false;
  }
}

/**
 * Open Yandex reverse image search
 * @param {Blob} imageBlob - Image blob to search
 */
export async function searchYandex(imageBlob) {
  try {
    const dataURL = await blobToDataURL(imageBlob);
    
    // Yandex accepts images via their upload endpoint
    const url = 'https://yandex.com/images/search?rpt=imageview&url=' + encodeURIComponent(dataURL);
    window.open(url, '_blank');
    
    return true;
  } catch (err) {
    console.error('Yandex search failed:', err);
    return false;
  }
}

/**
 * Open Bing visual search
 * @param {Blob} imageBlob - Image blob to search
 */
export async function searchBing(imageBlob) {
  try {
    const dataURL = await blobToDataURL(imageBlob);
    
    // Bing Visual Search URL
    const url = 'https://www.bing.com/images/search?view=detailv2&iss=sbi&form=SBIIRP&sbisrc=UrlPaste&q=imgurl:' + 
                encodeURIComponent(dataURL);
    window.open(url, '_blank');
    
    return true;
  } catch (err) {
    console.error('Bing search failed:', err);
    return false;
  }
}

/**
 * Open TinEye reverse image search
 * @param {Blob} imageBlob - Image blob to search
 */
export async function searchTinEye(imageBlob) {
  try {
    // TinEye requires uploading via their form
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = 'https://tineye.com/search';
    form.target = '_blank';
    form.enctype = 'multipart/form-data';
    
    const formData = new FormData();
    formData.append('image', imageBlob, 'search.jpg');
    
    // Create temporary iframe for submission
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.name = 'tineye_upload';
    document.body.appendChild(iframe);
    
    form.target = 'tineye_upload';
    document.body.appendChild(form);
    
    // Convert FormData to form inputs
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.name = 'image';
    
    // Create a File from Blob
    const file = new File([imageBlob], 'search.jpg', { type: 'image/jpeg' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;
    
    form.appendChild(fileInput);
    form.submit();
    
    setTimeout(function() {
      document.body.removeChild(form);
      document.body.removeChild(iframe);
    }, 1000);
    
    return true;
  } catch (err) {
    console.error('TinEye search failed:', err);
    // Fallback: open TinEye homepage
    window.open('https://tineye.com/', '_blank');
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
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
    
    const results = {
      success: [],
      failed: []
    };
    
    // Search on each enabled engine with slight delay between each
    if (engines.google) {
      const success = await searchGoogle(blob);
      results[success ? 'success' : 'failed'].push('Google');
      if (engines.yandex || engines.bing || engines.tineye) {
        await delay(500); // Delay to avoid browser popup blocking
      }
    }
    
    if (engines.yandex) {
      const success = await searchYandex(blob);
      results[success ? 'success' : 'failed'].push('Yandex');
      if (engines.bing || engines.tineye) {
        await delay(500);
      }
    }
    
    if (engines.bing) {
      const success = await searchBing(blob);
      results[success ? 'success' : 'failed'].push('Bing');
      if (engines.tineye) {
        await delay(500);
      }
    }
    
    if (engines.tineye) {
      const success = await searchTinEye(blob);
      results[success ? 'success' : 'failed'].push('TinEye');
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
 * Create a search menu UI element
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
    <div class="search-menu-options">
      <button class="search-btn" data-engine="all">
        <span class="engine-icon">🌐</span>
        <span>Search All Engines</span>
      </button>
      <button class="search-btn" data-engine="google">
        <span class="engine-icon">G</span>
        <span>Google Images</span>
      </button>
      <button class="search-btn" data-engine="yandex">
        <span class="engine-icon">Я</span>
        <span>Yandex</span>
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
      Find where this face appears online. Opens search engines in new tabs.
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
