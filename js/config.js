// config.js - Central configuration
export const CONFIG = {
  detection: {
    inputSize: 416,
    scoreThreshold: 0.25,
    maxImageSize: 1600,
    fallbackToSSD: true,
    minFaceSize: 20
  },
  similarity: {
    thresholds: {
      veryHigh: 0.4,
      high: 0.5,
      good: 0.6,
      low: 0.7
    },
    sunglassesAdjustment: 0.1,
    multiReferenceMethod: 'average'
  },
  export: {
    matchThreshold: 60,
    tileSize: 160,
    columns: 3,
    padding: 20,
    gap: 14
  },
  ui: {
    displayMaxWidth: 600,
    displayMaxHeight: 400,
    comparisonMaxWidth: 500,
    comparisonMaxHeight: 400,
    maxReferencePhotos: 5
  },
  keyboard: {
    compare: 'c',
    clear: 'Escape',
    debug: 'd'
  },
};
