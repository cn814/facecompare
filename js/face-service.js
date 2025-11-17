// face-service.js - Face detection service
import { downscaleImageToCanvas, debug, clamp } from './utils.js';
import { CONFIG } from './config.js';

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model/';

export const faceService = {
  modelsLoaded: false,

  /**
   * Load all required face detection models
   * @param {Function} onProgress - Callback with (percentage, statusText)
   */
  async loadModels(onProgress = (p, txt) => {}) {
    try {
      onProgress(10, 'Loading SSD mobilenet...');
      await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);

      onProgress(30, 'Loading tiny face detector...');
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);

      onProgress(55, 'Loading landmarks...');
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);

      onProgress(75, 'Loading age & gender model...');
      await faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL);

      onProgress(90, 'Loading recognition model...');
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);

      this.modelsLoaded = true;
      onProgress(100, 'Ready');
    } catch (err) {
      console.error('Model loading failed:', err);
      throw new Error(this.getLoadingErrorMessage(err));
    }
  },

  /**
   * Get user-friendly error message for loading failures
   * @param {Error} err - The error object
   * @returns {string} User-friendly error message
   */
  getLoadingErrorMessage(err) {
    const errorMessages = {
      'Failed to fetch': 'Network error - check your internet connection',
      'NetworkError': 'Network error - check your internet connection',
      'TypeError': 'Invalid model files - try refreshing the page',
      'Out of memory': 'Browser out of memory - try closing other tabs'
    };
    
    for (const [key, message] of Object.entries(errorMessages)) {
      if (err.message.includes(key) || err.name === key) {
        return message;
      }
    }
    
    return `Failed to load AI models: ${err.message}`;
  },

  /**
   * Detect all faces in an image or canvas with landmarks, age, and descriptors
   * @param {HTMLImageElement|HTMLCanvasElement} input - Image or canvas to detect faces in
   * @param {Object} options - Detection options
   * @returns {Promise<Array>} Array of face detections with landmarks, age, and descriptors
   */
  async detectAllFaces(input, options = {}) {
    const useTiny = options.useTiny ?? true;
    const detector = useTiny
      ? new faceapi.TinyFaceDetectorOptions({ 
          inputSize: CONFIG.detection.inputSize, 
          scoreThreshold: CONFIG.detection.scoreThreshold 
        })
      : new faceapi.SsdMobilenetv1Options({ 
          minConfidence: CONFIG.detection.scoreThreshold 
        });

    let detectionInput = input;

    // Downscale large images for better performance
    if (!(input instanceof HTMLCanvasElement) && !(input instanceof HTMLVideoElement)) {
      const maxW = options.maxW || CONFIG.detection.maxImageSize;
      const maxH = options.maxH || CONFIG.detection.maxImageSize;
      detectionInput = downscaleImageToCanvas(input, maxW, maxH);
    }

    let results = await faceapi
      .detectAllFaces(detectionInput, detector)
      .withFaceLandmarks()
      .withAgeAndGender()
      .withFaceDescriptors();

    // Fallback to SSD if tiny detector finds nothing
    if (results.length === 0 && useTiny && CONFIG.detection.fallbackToSSD) {
      debug('No faces found with Tiny detector, falling back to SSD...');
      results = await faceapi
        .detectAllFaces(input, new faceapi.SsdMobilenetv1Options({ 
          minConfidence: CONFIG.detection.scoreThreshold - 0.05 
        }))
        .withFaceLandmarks()
        .withAgeAndGender()
        .withFaceDescriptors();
    }

    // Filter out low-quality detections
    results = results.filter(d => {
      const box = d.detection.box;
      return box.width >= CONFIG.detection.minFaceSize && 
             box.height >= CONFIG.detection.minFaceSize;
    });

    // Add quality scores to each detection
    results.forEach(detection => {
      detection.quality = this.calculateFaceQuality(detection);
    });

    return results;
  },

  /**
   * Calculate quality score for a face detection
   * @param {Object} detection - Face detection object
   * @returns {number} Quality score (0-100)
   */
  calculateFaceQuality(detection) {
    const box = detection.detection.box;
    const score = detection.detection.score;
    const landmarks = detection.landmarks;
    
    let quality = score * 100;
    
    // Penalize small faces
    if (box.width < 80 || box.height < 80) {
      quality *= 0.7;
    } else if (box.width > 200 && box.height > 200) {
      quality *= 1.1; // Bonus for larger faces
    }
    
    // Reward frontal faces (check landmark alignment)
    if (landmarks && landmarks.positions && landmarks.positions.length > 30) {
      const nose = landmarks.positions[30]; // nose tip
      const centerX = box.x + box.width / 2;
      const offset = Math.abs(nose.x - centerX) / box.width;
      quality *= (1 - offset * 0.3); // Less penalty than before
    }
    
    // Check aspect ratio (faces should be roughly square)
    const aspectRatio = box.width / box.height;
    if (aspectRatio < 0.7 || aspectRatio > 1.5) {
      quality *= 0.8;
    }
    
    return Math.round(clamp(quality, 0, 100));
  }
};
