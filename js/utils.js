// utils.js - General utility functions
export const DEBUG = false; // Toggle for debug logging

/**
 * Debug logging utility
 * @param {...any} args - Arguments to log
 */
export function debug(...args) {
  if (DEBUG) console.log('[DEBUG]', ...args);
}

/**
 * Clamp a value between min and max
 * @param {number} v - Value to clamp
 * @param {number} a - Minimum value
 * @param {number} b - Maximum value
 * @returns {number} Clamped value
 */
export function clamp(v, a = 0, b = 100) {
  return Math.max(a, Math.min(b, v));
}

/**
 * Create an element from HTML string
 * @param {string} html - HTML string
 * @returns {HTMLElement} Created element
 */
export function createElementFromHTML(html) {
  const tmpl = document.createElement('template');
  tmpl.innerHTML = html.trim();
  return tmpl.content.firstChild;
}

/**
 * Downscale an image to fit within max dimensions and return canvas
 * @param {HTMLImageElement} img - Source image
 * @param {number} maxW - Maximum width
 * @param {number} maxH - Maximum height
 * @returns {HTMLCanvasElement} Canvas with downscaled image
 */
export function downscaleImageToCanvas(img, maxW = 800, maxH = 800) {
  const ratio = Math.min(1, Math.min(maxW / img.width, maxH / img.height));
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

/**
 * Format a file size in bytes to human-readable string
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted file size
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Debounce a function
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
