// Create a display canvas (downscaled if needed) and draw the image on it
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

// Place a face box on top of the canvas, accounting for CSS scaling
export function placeFaceBox(wrapper, box, index, labelText, color, canvas) {
  // If canvas is displayed at a different CSS size, compensate for that
  const cssScale = canvas ? (canvas.clientWidth / canvas.width || 1) : 1;
  const scale = cssScale; // detection now uses this canvas, so box is in canvas coords

  const div = document.createElement('div');
  div.className = 'face-box';
  div.style.left = (box.x * scale) + 'px';
  div.style.top = (box.y * scale) + 'px';
  div.style.width = (box.width * scale) + 'px';
  div.style.height = (box.height * scale) + 'px';
  if (color) div.style.borderColor = color;

  const label = document.createElement('div');
  label.className = 'face-label';
  label.textContent = labelText || ('Face ' + (index + 1));
  div.appendChild(label);

  wrapper.appendChild(div);
  return div;
}

// Draw landmarks on the same coordinate system as the canvas
export function drawLandmarksOnCanvas(canvas, landmarks) {
  const ctx = canvas.getContext('2d');
  const cssScale = canvas.clientWidth / canvas.width || 1;
  const scale = cssScale;

  ctx.save();
  landmarks.positions.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x * scale, p.y * scale, 2, 0, Math.PI * 2);

    if (i < 17) ctx.fillStyle = '#fb7185';         // jaw
    else if (i < 27) ctx.fillStyle = '#22c55e';   // brows
    else if (i < 36) ctx.fillStyle = '#38bdf8';   // nose
    else if (i < 48) ctx.fillStyle = '#f97316';   // eyes
    else ctx.fillStyle = '#a855f7';               // mouth

    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#020617';
    ctx.stroke();
  });
  ctx.restore();
}
