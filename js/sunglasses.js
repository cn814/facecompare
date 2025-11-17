// sunglasses.js - Sunglasses detection
import { debug, clamp } from './utils.js';

/**
 * Detect sunglasses by analyzing eye region brightness and uniformity
 * @param {HTMLImageElement} image - Source image
 * @param {Object} landmarks - Face landmarks from face-api
 * @returns {{hasSunglasses: boolean, confidence: number}} Detection result with confidence
 */
export function detectSunglassesFast(image, landmarks) {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = Math.round(image.width * 0.2);
    canvas.height = Math.round(image.height * 0.2);
    
    // Draw downscaled version for faster processing
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const scale = canvas.width / image.width;

    // Get bounding box for eye region
    const getEyeBox = (indices) => {
      const pts = indices.map(i => landmarks.positions[i]);
      const xs = pts.map(p => p.x * scale);
      const ys = pts.map(p => p.y * scale);
      const x = Math.max(0, Math.floor(Math.min(...xs) - 2));
      const y = Math.max(0, Math.floor(Math.min(...ys) - 2));
      const w = Math.min(canvas.width - x, Math.ceil(Math.max(...xs) - Math.min(...xs) + 4));
      const h = Math.min(canvas.height - y, Math.ceil(Math.max(...ys) - Math.min(...ys) + 4));
      return { x, y, w, h };
    };

    // Left and right eye landmark indices
    const left = getEyeBox([36, 37, 38, 39, 40, 41]);
    const right = getEyeBox([42, 43, 44, 45, 46, 47]);

    // Sample eye region for brightness and uniformity
    const sample = (box) => {
      if (box.w <= 0 || box.h <= 0) return { avg: 255, darkRatio: 0, uniformity: 0 };
      
      const d = ctx.getImageData(box.x, box.y, box.w, box.h).data;
      let sum = 0, dark = 0, n = d.length / 4;
      const brightnesses = [];
      
      for (let i = 0; i < d.length; i += 4) {
        const brightness = (d[i] + d[i + 1] + d[i + 2]) / 3;
        sum += brightness;
        brightnesses.push(brightness);
        if (brightness < 60) dark++;
      }
      
      // Calculate standard deviation for uniformity
      const avg = sum / n;
      const variance = brightnesses.reduce((acc, b) => acc + Math.pow(b - avg, 2), 0) / n;
      const stdDev = Math.sqrt(variance);
      const uniformity = 1 - Math.min(stdDev / 100, 1); // 0-1, higher = more uniform
      
      return { avg, darkRatio: dark / n, uniformity };
    };

    const L = sample(left);
    const R = sample(right);
    
    const avg = (L.avg + R.avg) / 2;
    const darkRatio = (L.darkRatio + R.darkRatio) / 2;
    const uniformity = (L.uniformity + R.uniformity) / 2;
    const brightnessDiff = Math.abs(L.avg - R.avg);

    // Sunglasses criteria: dark + high dark ratio + uniform + similar between eyes
    const darkScore = avg < 55 ? 1 : clamp(1 - (avg - 55) / 50, 0, 1);
    const ratioScore = darkRatio > 0.55 ? 1 : darkRatio / 0.55;
    const uniformScore = uniformity;
    const symmetryScore = brightnessDiff < 18 ? 1 : clamp(1 - (brightnessDiff - 18) / 30, 0, 1);
    
    // Weighted confidence score
    const confidence = (darkScore * 0.4 + ratioScore * 0.3 + uniformScore * 0.2 + symmetryScore * 0.1);
    const hasSunglasses = confidence > 0.6;
    
    debug('sunglasses', { 
      avg, 
      darkRatio, 
      uniformity, 
      brightnessDiff, 
      confidence: confidence.toFixed(2),
      hasSunglasses 
    });
    
    return { hasSunglasses, confidence: clamp(confidence, 0, 1) };
  } catch (e) {
    debug('sunglasses error', e);
    return { hasSunglasses: false, confidence: 0 };
  }
}
