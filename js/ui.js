// ui.js - UI utilities for canvas and DOM manipulation
import { CONFIG } from './config.js';
import { createElementFromHTML } from './utils.js';

/**
 * Create a display canvas and draw image on it (downscaled if needed)
 * @param {HTMLImageElement} img - Source image
 * @param {number} maxW - Maximum width
 * @param {number} maxH - Maximum height
 * @returns {{canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D}}
 */
export function createCanvasForImage(img, maxW = 600, maxH = 400) {
  const canvas = document.createElement('canvas');
  let w = img.width;
  let h = img.height;

  if (w > maxW || h > maxH) {
    const scale = Math.min(maxW / w, maxH / h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  return { canvas, ctx };
}

/**
 * Place a face box overlay on a canvas wrapper with proper scaling
 * @param {HTMLElement} wrapper - Container element
 * @param {Object} box - Face bounding box {x, y, width, height}
 * @param {number} index - Face index
 * @param {string} labelText - Label text to display
 * @param {string} color - Border color
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {Object} quality - Optional quality score
 * @returns {HTMLDivElement} The created face box element
 */
export function placeFaceBox(wrapper, box, index, labelText, color, canvas, quality = null) {
  // Account for CSS scaling
  const cssScale = canvas ? (canvas.clientWidth / canvas.width || 1) : 1;

  const div = document.createElement('div');
  div.className = 'face-box';
  div.style.left = (box.x * cssScale) + 'px';
  div.style.top = (box.y * cssScale) + 'px';
  div.style.width = (box.width * cssScale) + 'px';
  div.style.height = (box.height * cssScale) + 'px';
  if (color) div.style.borderColor = color;

  const label = document.createElement('div');
  label.className = 'face-label';
  label.textContent = labelText || ('Face ' + (index + 1));
  div.appendChild(label);

  // Add tooltip with quality information
  if (quality !== null) {
    div.title = `Face ${index + 1}\nQuality: ${quality}%\nClick to select`;
  }

  wrapper.appendChild(div);
  return div;
}

/**
 * Draw facial landmarks on canvas for debugging
 * @param {HTMLCanvasElement} canvas - Canvas to draw on
 * @param {Object} landmarks - Landmarks from face-api
 */
export function drawLandmarksOnCanvas(canvas, landmarks) {
  const ctx = canvas.getContext('2d');
  const cssScale = canvas.clientWidth / canvas.width || 1;

  ctx.save();
  landmarks.positions.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x * cssScale, p.y * cssScale, 2, 0, Math.PI * 2);

    // Color code by feature
    if (i < 17) ctx.fillStyle = '#fb7185';         // jaw
    else if (i < 27) ctx.fillStyle = '#22c55e';    // brows
    else if (i < 36) ctx.fillStyle = '#38bdf8';    // nose
    else if (i < 48) ctx.fillStyle = '#f97316';    // eyes
    else ctx.fillStyle = '#a855f7';                // mouth

    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#020617';
    ctx.stroke();
  });
  ctx.restore();
}

/**
 * Show a processing spinner overlay
 * @param {HTMLElement} element - Element to show spinner in
 * @param {string} message - Message to display
 * @returns {Function} Function to remove the spinner
 */
export function showProcessing(element, message = 'Processing...') {
  const spinner = createElementFromHTML(`
    <div class="processing-overlay">
      <div class="spinner"></div>
      <p>${message}</p>
    </div>
  `);
  element.style.position = 'relative';
  element.appendChild(spinner);
  return () => {
    if (spinner.parentNode) spinner.parentNode.removeChild(spinner);
  };
}

/**
 * Show an error message in an element
 * @param {HTMLElement} target - Target element
 * @param {string} message - Error message
 */
export function showError(target, message) {
  const e = document.createElement('div');
  e.className = 'error';
  e.textContent = message;
  target.appendChild(e);
}
