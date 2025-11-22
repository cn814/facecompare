// content.js - Content script for FaceCompare extension
// This script runs in the context of web pages

// Listen for messages from popup or background script
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'extractImages') {
    const images = extractAllImages(request.minSize || 100, request.maxImages || 50);
    sendResponse({ images: images });
  }

  if (request.action === 'getPageInfo') {
    sendResponse({
      url: window.location.href,
      title: document.title
    });
  }

  return true; // Keep message channel open for async response
});

/**
 * Extract all images from the current page
 */
function extractAllImages(minSize, maxImages) {
  const images = [];
  const seenUrls = new Set();

  // Helper to check if URL is valid image
  function isValidImageUrl(url) {
    if (!url) return false;
    if (url.startsWith('data:')) return false;
    if (url.startsWith('blob:')) return false;
    if (url.length > 2000) return false; // Skip very long URLs
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

  // Helper to check image extension
  function hasImageExtension(url) {
    return /\.(jpg|jpeg|png|gif|webp|bmp|avif|tiff?)(\?.*)?$/i.test(url);
  }

  // 1. Extract from <img> elements
  const imgElements = document.querySelectorAll('img');
  imgElements.forEach(function(img) {
    if (images.length >= maxImages) return;

    // Try multiple source attributes
    const sources = [
      img.src,
      img.dataset.src,
      img.dataset.lazySrc,
      img.dataset.original,
      img.dataset.lazyload
    ];

    for (const src of sources) {
      if (!src) continue;

      const absoluteUrl = getAbsoluteUrl(src);
      if (!absoluteUrl || !isValidImageUrl(absoluteUrl)) continue;
      if (seenUrls.has(absoluteUrl)) continue;

      // Check size if available
      const width = img.naturalWidth || img.width || 0;
      const height = img.naturalHeight || img.height || 0;

      // If size is known, filter by minSize
      if (width > 0 && height > 0) {
        if (width < minSize || height < minSize) continue;
      }

      seenUrls.add(absoluteUrl);
      images.push({
        url: absoluteUrl,
        width: width,
        height: height,
        alt: img.alt || '',
        type: 'img'
      });
      break; // Found a valid source, move to next image
    }

    // Also check srcset
    const srcset = img.srcset || img.dataset.srcset;
    if (srcset && images.length < maxImages) {
      const srcsetParts = srcset.split(',');
      for (const part of srcsetParts) {
        if (images.length >= maxImages) break;

        const src = part.trim().split(' ')[0];
        const absoluteUrl = getAbsoluteUrl(src);

        if (!absoluteUrl || !isValidImageUrl(absoluteUrl)) continue;
        if (seenUrls.has(absoluteUrl)) continue;

        seenUrls.add(absoluteUrl);
        images.push({
          url: absoluteUrl,
          width: 0,
          height: 0,
          alt: img.alt || '',
          type: 'srcset'
        });
      }
    }
  });

  // 2. Extract from <picture> elements
  document.querySelectorAll('picture source').forEach(function(source) {
    if (images.length >= maxImages) return;

    const srcset = source.srcset;
    if (!srcset) return;

    const srcsetParts = srcset.split(',');
    for (const part of srcsetParts) {
      if (images.length >= maxImages) break;

      const src = part.trim().split(' ')[0];
      const absoluteUrl = getAbsoluteUrl(src);

      if (!absoluteUrl || !isValidImageUrl(absoluteUrl)) continue;
      if (seenUrls.has(absoluteUrl)) continue;

      seenUrls.add(absoluteUrl);
      images.push({
        url: absoluteUrl,
        width: 0,
        height: 0,
        alt: '',
        type: 'picture'
      });
    }
  });

  // 3. Extract from background images
  const allElements = document.querySelectorAll('*');
  allElements.forEach(function(el) {
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
            alt: 'Background image',
            type: 'background'
          });
        });
      }
    }
  });

  // 4. Extract from <a> tags linking to images
  document.querySelectorAll('a[href]').forEach(function(a) {
    if (images.length >= maxImages) return;

    const href = a.href;
    if (!href || !hasImageExtension(href)) return;

    const absoluteUrl = getAbsoluteUrl(href);
    if (!absoluteUrl || !isValidImageUrl(absoluteUrl)) return;
    if (seenUrls.has(absoluteUrl)) return;

    seenUrls.add(absoluteUrl);
    images.push({
      url: absoluteUrl,
      width: 0,
      height: 0,
      alt: a.title || 'Linked image',
      type: 'link'
    });
  });

  // 5. Extract from Open Graph and Twitter meta tags
  document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"], meta[property="og:image:url"]').forEach(function(meta) {
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
      alt: 'Social media preview',
      type: 'meta'
    });
  });

  // 6. Extract from JSON-LD structured data
  document.querySelectorAll('script[type="application/ld+json"]').forEach(function(script) {
    if (images.length >= maxImages) return;

    try {
      const data = JSON.parse(script.textContent);
      extractImagesFromJsonLd(data);
    } catch (e) {
      // Invalid JSON, skip
    }
  });

  function extractImagesFromJsonLd(obj) {
    if (images.length >= maxImages) return;
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach(extractImagesFromJsonLd);
      return;
    }

    // Look for image properties
    const imageProps = ['image', 'photo', 'thumbnail', 'logo', 'primaryImageOfPage'];
    for (const prop of imageProps) {
      if (obj[prop]) {
        const imgUrl = typeof obj[prop] === 'string' ? obj[prop] : obj[prop].url;
        if (imgUrl) {
          const absoluteUrl = getAbsoluteUrl(imgUrl);
          if (absoluteUrl && isValidImageUrl(absoluteUrl) && !seenUrls.has(absoluteUrl)) {
            seenUrls.add(absoluteUrl);
            images.push({
              url: absoluteUrl,
              width: 0,
              height: 0,
              alt: 'Structured data image',
              type: 'jsonld'
            });
          }
        }
      }
    }

    // Recurse into nested objects
    for (const key in obj) {
      if (typeof obj[key] === 'object') {
        extractImagesFromJsonLd(obj[key]);
      }
    }
  }

  return images;
}

// Notify that content script is loaded
console.log('[FaceCompare] Content script loaded');
