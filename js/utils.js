export const DEBUG = false; // toggle quickly during dev
export function debug(...args){ if(DEBUG) console.log(...args); }

export function clamp(v, a=0, b=100){ return Math.max(a, Math.min(b, v)); }

export function createElementFromHTML(html){
  const tmpl = document.createElement('template');
  tmpl.innerHTML = html.trim();
  return tmpl.content.firstChild;
}

// Resize an image object proportionally to fit within maxW x maxH and return a canvas
export function downscaleImageToCanvas(img, maxW=800, maxH=800){
  const ratio = Math.min(1, Math.min(maxW / img.width, maxH / img.height));
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}
