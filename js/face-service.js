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

      onProgress(55, 'Loading landmarks...');
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);

      onProgress(75, 'Loading age & gender model...');
      await faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL);

      onProgress(90, 'Loading recognition model...');
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);

      this.modelsLoaded = true;
      onProgress(100, 'Ready');
    } catch (err) {
      throw err;
    }
  },

  // Detect on whatever you pass in (canvas or image).
  // We attach landmarks, descriptors, and age/gender info.
  async detectAllFaces(input, options = {}) {
    const useTiny = options.useTiny ?? true;
    const detector = useTiny
      ? new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.35 })
      : new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35 });

    let detectionInput = input;

    // If it's not already a canvas/video, downscale to canvas
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
      .withAgeAndGender()          // ⬅️ adds age and gender
      .withFaceDescriptors();

    // Fallback if tiny detector finds nothing
    if (results.length === 0 && useTiny && input !== detectionInput) {
      debug('Fallback to SSD on original image');
      results = await faceapi
        .detectAllFaces(input, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
        .withFaceLandmarks()
        .withAgeAndGender()
        .withFaceDescriptors();
    }

    return results;
  }
};
