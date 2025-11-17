import { downscaleImageToCanvas, debug } from './utils.js';

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model/';

export const faceService = {
  modelsLoaded: false,
  async loadModels(onProgress=(p, txt)=>{}){
    try{
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
    }catch(err){
      throw err;
    }
  },

  // detect all faces with landmarks & descriptors using a downscaled image (faster)
  async detectAllFaces(img, options={}) {
    // downscale for speed; face-api can handle smaller canvases faster
    const canvas = downscaleImageToCanvas(img, options.maxW||800, options.maxH||800);
    const useTiny = options.useTiny ?? true;
    const detector = useTiny ? new faceapi.TinyFaceDetectorOptions({inputSize:416, scoreThreshold:0.35}) : new faceapi.SsdMobilenetv1Options({minConfidence:0.35});
    let results = await faceapi.detectAllFaces(canvas, detector).withFaceLandmarks().withFaceDescriptors();
    // If no faces and we used tiny, try SSD as fallback on original image
    if(results.length === 0 && useTiny) {
      debug('Fallback to SSD on original image');
      results = await faceapi.detectAllFaces(img, new faceapi.SsdMobilenetv1Options({minConfidence:0.3})).withFaceLandmarks().withFaceDescriptors();
    }
    return results;
  }
}
