import { downscaleImageToCanvas, debug } from './utils.js';

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model/';

export const faceService = {
  modelsLoaded: false,

  async loadModels(onProgress = (p, txt) => {}) {
    try {
      onProgress(10, 'Loading SSD mobilenet...');
      await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);

      onProgress(30, 'Loading tiny face detector...');
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);

      onProgress(60, 'Loading landmarks...');
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);

      onProgress(85, 'Loading recognition model...');
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);

      this.modelsLoaded = true;
      onProgress(100, 'Ready');
    } catch (err) {
      throw err;
    }
  },

  // Detect on whatever you pass in:
  // - if it's a canvas, use it directly (keeps coordinates in sync with what you show)
  // - otherwise, downscale and detect on that
  async detectAllFaces(input, options = {}) {
    const useTiny = options.useTiny ?? true;
    const detector = useTiny
      ? new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.35 })
      : new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35 });

    let detectionInput = input;

    // If it's not already a canvas/video element, downscale to a canvas for performance
    if (!(input instanceof HTMLCanvasElement) && !(input instanceof HTMLVideoElement)) {
      detectionInput = downscaleImageToCanvas(
        input,
        options.maxW || 800,
        options.maxH || 800
      );
    }

    let results = await faceapi
      .detectAllFaces(detectionInput, detector)
      .withFaceLandmarks()
      .withFaceDescriptors();

    // If nothing detected and we used tiny, fall back to SSD on original image
    if (results.length === 0 && useTiny && input !== detectionInput) {
      debug('Fallback to SSD on original image');
      results = await faceapi
        .detectAllFaces(input, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
        .withFaceLandmarks()
        .withFaceDescriptors();
    }

    return results;
  }
};
