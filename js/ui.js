import { debug } from './utils.js';

export function createCanvasForImage(img, maxW=600, maxH=400){
  const canvas = document.createElement('canvas');
  let w=img.width, h=img.height;
  if(w>maxW||h>maxH){ const scale = Math.min(maxW/w, maxH/h); w=Math.round(w*scale); h=Math.round(h*scale); }
  canvas.width=w; canvas.height=h; canvas.style.width = w+'px'; canvas.style.height = h+'px';
  const ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0,w,h);
  return {canvas, ctx, scale: canvas.width/img.width};
}

export function placeFaceBox(wrapper, box, scale, index, labelText, color){
  const div = document.createElement('div'); div.className='face-box';
  div.style.left = (box.x*scale)+'px'; div.style.top = (box.y*scale)+'px';
  div.style.width = (box.width*scale)+'px'; div.style.height = (box.height*scale)+'px';
  div.style.borderColor = color || 'var(--warn)';
  const label = document.createElement('div'); label.className='face-label'; label.textContent = labelText||('Face '+(index+1));
  label.style.background = color||'var(--warn)';
  label.style.left='50%'; label.style.transform='translateX(-50%)'; label.style.top='-18px';
  div.appendChild(label);
  wrapper.appendChild(div);
  return div;
}

export function drawLandmarksOnCanvas(canvas, landmarks, scale=1){
  const ctx = canvas.getContext('2d');
  ctx.save();
  landmarks.positions.forEach((p,i)=>{
    ctx.beginPath(); ctx.arc(p.x*scale, p.y*scale, 2, 0, Math.PI*2);
    if(i<17) ctx.fillStyle='#FF6B6B'; else if(i<27) ctx.fillStyle='#4ECDC4'; else if(i<36) ctx.fillStyle='#45B7D1'; else if(i<48) ctx.fillStyle='#FFA07A'; else ctx.fillStyle='#98D8C8';
    ctx.fill(); ctx.lineWidth=1; ctx.strokeStyle='white'; ctx.stroke();
  });
  ctx.restore();
}
