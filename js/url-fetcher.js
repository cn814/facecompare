// url-fetcher.js - Fetch and extract images from URLs

/**
 * Fetch images from a URL
 * Attempts direct fetch first, falls back to CORS proxy if needed
 */
export async function fetchImagesFromUrl(url, options = {}) {
  const {
    onProgress = () => {},
    maxImages = 50,
    minWidth = 100,
    minHeight = 100
  } = options;

  onProgress(5, 'Validating URL...');

  // Validate URL
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (e) {
    throw new Error('Invalid URL format');
  }

  onProgress(10, 'Fetching page...');

  // Try to fetch the page HTML
  let html;
  try {
    html = await fetchWithCorsHandling(url);
  } catch (e) {
    throw new Error('Failed to fetch page: ' + e.message);
  }

  onProgress(30, 'Extracting image URLs...');

  // Parse HTML and extract image URLs
  const imageUrls = extractImageUrls(html, parsedUrl);

  if (imageUrls.length === 0) {
    throw new Error('No images found on the page');
  }

  onProgress(40, `Found ${imageUrls.length} images, loading...`);

  // Load images (with filtering)
  const images = await loadImages(imageUrls, {
    maxImages,
    minWidth,
    minHeight,
    baseUrl: parsedUrl,
    onProgress: (loaded, total) => {
      const pct = 40 + Math.round((loaded / total) * 55);
      onProgress(pct, `Loading images: ${loaded}/${total}`);
    }
  });

  onProgress(100, 'Done!');

  return images;
}

/**
 * Fetch URL content with CORS handling
 * Tries direct fetch first, then falls back to public CORS proxies
 */
async function fetchWithCorsHandling(url) {
  // List of CORS proxies to try (in order)
  const corsProxies = [
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`
  ];

  // Try direct fetch first (works for same-origin or CORS-enabled sites)
  try {
    const response = await fetch(url, {
      mode: 'cors',
      credentials: 'omit',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,*/*'
      }
    });
    if (response.ok) {
      return await response.text();
    }
  } catch (e) {
    // Direct fetch failed, try proxies
  }

  // Try CORS proxies
  for (const proxyFn of corsProxies) {
    try {
      const proxyUrl = proxyFn(url);
      const response = await fetch(proxyUrl);
      if (response.ok) {
        return await response.text();
      }
    } catch (e) {
      // Try next proxy
    }
  }

  throw new Error('Could not fetch page (blocked by CORS). Try the browser extension for full access.');
}

/**
 * Extract image URLs from HTML content
 */
function extractImageUrls(html, baseUrl) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const imageUrls = new Set();

  // Get images from <img> tags
  doc.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
    if (src) {
      const absoluteUrl = resolveUrl(src, baseUrl);
      if (absoluteUrl && isImageUrl(absoluteUrl)) {
        imageUrls.add(absoluteUrl);
      }
    }

    // Check srcset
    const srcset = img.getAttribute('srcset');
    if (srcset) {
      srcset.split(',').forEach(entry => {
        const src = entry.trim().split(' ')[0];
        const absoluteUrl = resolveUrl(src, baseUrl);
        if (absoluteUrl && isImageUrl(absoluteUrl)) {
          imageUrls.add(absoluteUrl);
        }
      });
    }
  });

  // Get images from <a> tags that link to images
  doc.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (href && isImageUrl(href)) {
      const absoluteUrl = resolveUrl(href, baseUrl);
      if (absoluteUrl) {
        imageUrls.add(absoluteUrl);
      }
    }
  });

  // Get images from background-image styles
  doc.querySelectorAll('[style*="background"]').forEach(el => {
    const style = el.getAttribute('style');
    const matches = style.match(/url\(['"]?([^'")\s]+)['"]?\)/gi);
    if (matches) {
      matches.forEach(match => {
        const url = match.replace(/url\(['"]?/, '').replace(/['"]?\)/, '');
        const absoluteUrl = resolveUrl(url, baseUrl);
        if (absoluteUrl && isImageUrl(absoluteUrl)) {
          imageUrls.add(absoluteUrl);
        }
      });
    }
  });

  // Get Open Graph and Twitter Card images
  doc.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]').forEach(meta => {
    const content = meta.getAttribute('content');
    if (content) {
      const absoluteUrl = resolveUrl(content, baseUrl);
      if (absoluteUrl) {
        imageUrls.add(absoluteUrl);
      }
    }
  });

  return Array.from(imageUrls);
}

/**
 * Resolve a potentially relative URL to absolute
 */
function resolveUrl(src, baseUrl) {
  if (!src || src.startsWith('data:')) return null;

  try {
    return new URL(src, baseUrl.href).href;
  } catch (e) {
    return null;
  }
}

/**
 * Check if URL looks like an image
 */
function isImageUrl(url) {
  const imageExtensions = /\.(jpg|jpeg|png|gif|webp|bmp|avif)(\?.*)?$/i;
  const imagePatterns = /(image|photo|pic|img|avatar|profile|thumbnail)/i;

  return imageExtensions.test(url) ||
         url.includes('/images/') ||
         url.includes('/photos/') ||
         imagePatterns.test(url);
}

/**
 * Load images from URLs with filtering
 */
async function loadImages(urls, options) {
  const { maxImages, minWidth, minHeight, baseUrl, onProgress } = options;
  const images = [];
  let loaded = 0;
  const total = Math.min(urls.length, maxImages * 2); // Load extra to account for filtering

  for (const url of urls.slice(0, total)) {
    try {
      const img = await loadSingleImage(url, baseUrl);

      // Filter by size
      if (img.naturalWidth >= minWidth && img.naturalHeight >= minHeight) {
        images.push({
          image: img,
          url: url,
          filename: extractFilename(url)
        });

        if (images.length >= maxImages) break;
      }
    } catch (e) {
      // Skip failed images
    }

    loaded++;
    onProgress(loaded, total);
  }

  return images;
}

/**
 * Load a single image with CORS handling
 */
function loadSingleImage(url, baseUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const timeout = setTimeout(() => {
      reject(new Error('Image load timeout'));
    }, 10000);

    img.onload = () => {
      clearTimeout(timeout);
      resolve(img);
    };

    img.onerror = () => {
      clearTimeout(timeout);
      // Try with CORS proxy
      tryWithProxy(url).then(resolve).catch(reject);
    };

    img.src = url;
  });
}

/**
 * Try loading image through CORS proxy
 */
function tryWithProxy(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;

    const timeout = setTimeout(() => {
      reject(new Error('Proxy image load timeout'));
    }, 15000);

    img.onload = () => {
      clearTimeout(timeout);
      resolve(img);
    };

    img.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('Failed to load image through proxy'));
    };

    img.src = proxyUrl;
  });
}

/**
 * Extract filename from URL
 */
function extractFilename(url) {
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split('/').pop() || 'image';
    return decodeURIComponent(filename).substring(0, 100);
  } catch (e) {
    return 'image_' + Date.now();
  }
}

/**
 * Convert an image URL directly to an Image element
 * For use when you have a direct image URL
 */
export async function urlToImage(url) {
  return loadSingleImage(url, new URL(url));
}
