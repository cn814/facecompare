// comparison.js - Face similarity computation
import { CONFIG } from './config.js';

/**
 * Compute similarity between two faces based on descriptor distance
 * @param {number} distance - Euclidean distance between face descriptors (0-2 range typically)
 * @param {boolean} anySunglasses - Whether either face has sunglasses detected
 * @returns {{similarity: number, confidence: string, isMatch: boolean}}
 */
export function computeSimilarity(distance, anySunglasses = false) {
  const adjust = anySunglasses ? CONFIG.similarity.sunglassesAdjustment : 0;
  const t = CONFIG.similarity.thresholds;
  
  let similarity, confidence, isMatch = false;
  
  if (distance < t.veryHigh + adjust) {
    similarity = 95 + ((t.veryHigh + adjust) - distance) * 12.5;
    confidence = 'Very High';
    isMatch = true;
  } else if (distance < t.high + adjust) {
    similarity = 85 + ((t.high + adjust) - distance) * 100;
    confidence = 'High';
    isMatch = true;
  } else if (distance < t.good + adjust) {
    similarity = 70 + ((t.good + adjust) - distance) * 150;
    confidence = 'Good';
    isMatch = true;
  } else if (distance < t.low + adjust) {
    similarity = 50 + ((t.low + adjust) - distance) * 200;
    confidence = 'Low';
    isMatch = false;
  } else {
    similarity = Math.max(0, 50 - (distance - (t.low + adjust)) * 100);
    confidence = 'Very Low';
    isMatch = false;
  }
  
  similarity = Math.min(100, Math.max(0, similarity));
  return { similarity, confidence, isMatch };
}

/**
 * Batch compute similarities for multiple face comparisons
 * @param {Float32Array} refDescriptor - Reference face descriptor
 * @param {Array} comparisons - Array of comparison objects with faces
 * @param {boolean} refHasSunglasses - Whether reference face has sunglasses
 * @returns {Array} Array of similarity results
 */
export function computeAllSimilarities(refDescriptor, comparisons, refHasSunglasses = false) {
  const results = [];
  
  comparisons.forEach((comp, imgIndex) => {
    comp.faces.forEach((face, faceIndex) => {
      const distance = faceapi.euclideanDistance(refDescriptor, face.descriptor);
      const anySunglasses = refHasSunglasses || face.hasSunglasses;
      const { similarity, confidence, isMatch } = computeSimilarity(distance, anySunglasses);
      
      results.push({
        fileName: comp.file.name,
        imageIndex: imgIndex,
        faceIndex,
        similarity,
        confidence,
        isMatch,
        distance,
        hasSunglasses: face.hasSunglasses,
        referenceSunglasses: refHasSunglasses,
        refAge: face.refAge,
        compAge: typeof face.age === 'number' ? face.age : null
      });
    });
  });
  
  return results.sort((a, b) => b.similarity - a.similarity);
}
