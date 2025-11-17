import { debug } from './utils.js';

// Lightweight sunglasses detection: sample a small downscaled eye region and look for low brightness + uniformity
export function detectSunglassesFast(image, landmarks){
  try{
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = Math.round(image.width * 0.2);
    canvas.height = Math.round(image.height * 0.2);
    // draw small version of image
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const scale = canvas.width / image.width;

    const getEyeBox = (indices) => {
      const pts = indices.map(i => landmarks.positions[i]);
      const xs = pts.map(p=>p.x*scale); const ys = pts.map(p=>p.y*scale);
      const x = Math.max(0, Math.floor(Math.min(...xs)-2));
      const y = Math.max(0, Math.floor(Math.min(...ys)-2));
      const w = Math.min(canvas.width - x, Math.ceil(Math.max(...xs)-Math.min(...xs)+4));
      const h = Math.min(canvas.height - y, Math.ceil(Math.max(...ys)-Math.min(...ys)+4));
      return {x,y,w,h};
    }

    const left = getEyeBox([36,37,38,39,40,41]);
    const right = getEyeBox([42,43,44,45,46,47]);

    const sample = (box) => {
      if(box.w<=0||box.h<=0) return {avg:255,darkRatio:0};
      const d = ctx.getImageData(box.x, box.y, box.w, box.h).data;
      let sum=0, dark=0, n=d.length/4;
      for(let i=0;i<d.length;i+=4){
        const brightness = (d[i]+d[i+1]+d[i+2])/3;
        sum += brightness;
        if(brightness<60) dark++;
      }
      return {avg: sum/n, darkRatio: dark/n};
    }

    const L = sample(left), R = sample(right);
    const avg = (L.avg+R.avg)/2; const darkRatio = (L.darkRatio+R.darkRatio)/2;
    const brightnessDiff = Math.abs(L.avg-R.avg);

    // require both dark + high dark ratio + similar brightness
    const has = avg<55 && darkRatio>0.55 && brightnessDiff<18;
    debug('sunglasses', {avg,darkRatio,brightnessDiff,has});
    return has;
  }catch(e){ debug('sunglasses error', e); return false; }
}
