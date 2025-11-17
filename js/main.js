import { DEBUG, debug, downscaleImageToCanvas } from './utils.js';
import { faceService } from './face-service.js';
import { detectSunglassesFast } from './sunglasses.js';
import { createCanvasForImage, placeFaceBox, drawLandmarksOnCanvas } from './ui.js';
import { computeSimilarity } from './comparison.js';

const loadingText = document.getElementById('loadingText');
const loadingProgress = document.getElementById('loadingProgress');
const loadingStatus = document.getElementById('loadingStatus');
const mainApp = document.getElementById('mainApp');
const fileInput1 = document.getElementById('fileInput1');
const fileInput2 = document.getElementById('fileInput2');
const uploadArea1 = document.getElementById('uploadArea1');
const uploadArea2 = document.getElementById('uploadArea2');
const preview1 = document.getElementById('preview1');
const preview2 = document.getElementById('preview2');
const compareBtn = document.getElementById('compareBtn');
const resultsDiv = document.getElementById('results');
const debugToggle = document.getElementById('debugToggle');
const clearBtn = document.getElementById('clearBtn');

let reference = {image:null, faces:[], selectedIndex:0};
let comparisons = [];
let comparisonResults = [];

async function boot(){
  try{
    await faceService.loadModels((p,txt)=>{ loadingProgress.style.width = p+'%'; loadingText.textContent = txt; });
    setTimeout(()=>{ loadingStatus.classList.add('hidden'); mainApp.classList.remove('hidden'); }, 300);
  }catch(e){ loadingText.innerHTML = `<span style="color:red">Error loading models: ${e.message}</span>`; }
}

function setDisabledState(){
  const totalFaces = comparisons.reduce((s,c)=>s + (c.faces?c.faces.length:0),0);
  compareBtn.disabled = !(reference.faces.length && totalFaces>0);
  compareBtn.textContent = compareBtn.disabled ? 'Upload Photos to Compare' : `Compare Against ${totalFaces} Face${totalFaces>1?'s':''}`;
}

function setupUI(){
  ;[uploadArea1, uploadArea2].forEach(area=>{
    area.addEventListener('dragover', e=>{ e.preventDefault(); area.classList.add('dragover'); });
    area.addEventListener('dragleave', e=>{ e.preventDefault(); area.classList.remove('dragover'); });
    area.addEventListener('drop', async e=>{ e.preventDefault(); area.classList.remove('dragover'); const files = Array.from(e.dataTransfer.files); if(area.dataset.target==='1') await handleReference(files[0]); else await handleComparisons(files); });
  });

  fileInput1.addEventListener('change', async e=>{ if(e.target.files[0]) await handleReference(e.target.files[0]); });
  fileInput2.addEventListener('change', async e=>{ if(e.target.files.length) await handleComparisons(Array.from(e.target.files)); });
  compareBtn.addEventListener('click', performComparison);
  clearBtn.addEventListener('click', clearAll);
}

async function handleReference(file){
  preview1.innerHTML=''; reference = {image:null, faces:[], selectedIndex:0};
  if(!file || !file.type.startsWith('image/')){ showError(preview1,'Please provide an image file'); return; }
  const img = await fileToImage(file);
  reference.image = img;

  const {canvas, ctx, scale} = createCanvasForImage(img, 600, 400);
  const wrapper = document.createElement('div'); wrapper.style.position='relative'; wrapper.appendChild(canvas);
  preview1.appendChild(wrapper);

  const detections = await faceService.detectAllFaces(img, {useTiny:true, maxW:800});
  if(detections.length === 0){ showError(preview1,'No faces detected in this image.'); setDisabledState(); return; }

  detections.forEach((d,i)=>{
    d.hasSunglasses = detectSunglassesFast(img, d.landmarks);
    const box = d.detection.box;
    const div = placeFaceBox(wrapper, box, scale, i, (i===0? 'Selected':'Click to select'), '#ff9800');
    div.addEventListener('click', ()=>{ selectReferenceFace(i, wrapper); });
    if(debugToggle.checked) drawLandmarksOnCanvas(canvas, d.landmarks, scale);
  });

  reference.faces = detections;
  reference.selectedIndex = 0;
  selectReferenceFace(0, wrapper);
  setDisabledState();
}

function selectReferenceFace(i, wrapper){
  reference.selectedIndex = i;
  const boxes = wrapper.querySelectorAll('.face-box');
  boxes.forEach((b,idx)=>{ const label = b.querySelector('.face-label'); if(idx===i){ b.style.borderColor='var(--success)'; label.textContent=`Face ${idx+1} (Selected)`; label.style.background='var(--success)'; } else { b.style.borderColor='var(--warn)'; label.textContent=`Face ${idx+1}`; label.style.background='var(--warn)'; } });
}

async function handleComparisons(files){
  preview2.innerHTML=''; comparisons = [];
  for(const file of files){
    if(!file.type.startsWith('image/')) continue;
    const img = await fileToImage(file);
    const {canvas, ctx, scale} = createCanvasForImage(img, 500, 400);
    const wrapper = document.createElement('div'); wrapper.style.position='relative'; wrapper.dataset.fileName = file.name; wrapper.appendChild(canvas);
    preview2.appendChild(wrapper);

    const detections = await faceService.detectAllFaces(img, {useTiny:true, maxW:800});
    if(detections.length===0){ const err = document.createElement('div'); err.className='error'; err.textContent=`No faces detected in ${file.name}`; wrapper.appendChild(err); }
    else{
      detections.forEach((d,i)=>{ d.hasSunglasses = detectSunglassesFast(img, d.landmarks); if(debugToggle.checked) drawLandmarksOnCanvas(canvas, d.landmarks, scale); const box = d.detection.box; placeFaceBox(wrapper, box, scale, i, `${i+1}`, '#ff9800'); });
      comparisons.push({file, image:img, faces:detections});
    }
  }
  setDisabledState();
}

async function performComparison(){
  resultsDiv.classList.remove('hidden'); resultsDiv.innerHTML = '<h2>📊 Comparison Results</h2>';
  const allComparisons = [];
  let matches=0, total=0;
  if(!reference.faces.length) return;
  const refDescriptor = reference.faces[reference.selectedIndex].descriptor;
  const refSunglasses = reference.faces[reference.selectedIndex].hasSunglasses;

  comparisons.forEach((comp, imgIndex)=>{
    comp.faces.forEach((face, faceIndex)=>{
      total++;
      const distance = faceapi.euclideanDistance(refDescriptor, face.descriptor);
      const anySunglasses = refSunglasses || face.hasSunglasses;
      const {similarity, confidence, isMatch} = computeSimilarity(distance, anySunglasses);
      allComparisons.push({fileName:comp.file.name,imageIndex:imgIndex,faceIndex,similarity,confidence,isMatch,distance,hasSunglasses:face.hasSunglasses,referenceSunglasses:refSunglasses});
      if(isMatch) matches++;
    });
  });

  allComparisons.sort((a,b)=>b.similarity-a.similarity);

  updateComparisonVisuals(allComparisons);

  const tpl = document.getElementById('resultItemTpl');
  allComparisons.forEach((c,idx)=>{
    const node = tpl.content.cloneNode(true);
    const root = node.querySelector('.result-item');
    root.querySelector('.title').textContent = `#${idx+1}: ${c.fileName} - Face ${c.faceIndex+1}`;
    root.querySelector('.similarity-score').textContent = `${c.similarity.toFixed(1)}% Match`;
    const fill = root.querySelector('.progress-fill'); fill.style.width = c.similarity+'%';
    if(c.similarity>=85) fill.style.background = 'linear-gradient(90deg,var(--success),#45a049)';
    else if(c.similarity>=70) fill.style.background = 'linear-gradient(90deg,#8bc34a,#6fb03a)';
    else if(c.similarity>=50) fill.style.background = 'linear-gradient(90deg,#ff9800,#e68a00)';
    else fill.style.background = 'linear-gradient(90deg,var(--danger),#b71c1c)';
    root.querySelector('.details').innerHTML = `Confidence: <strong>${c.confidence}</strong><br>Distance: ${c.distance.toFixed(3)}`;
    resultsDiv.appendChild(node);
  });

  const summary = document.createElement('div'); summary.className='result-item'; summary.innerHTML = `<h3>Summary</h3><p>Found <strong>${matches}</strong> likely match${matches!==1?'es':''} out of <strong>${total}</strong> face${total!==1?'s':''}.</p>`;
  resultsDiv.appendChild(summary);
  resultsDiv.scrollIntoView({behavior:'smooth'});
}

function updateComparisonVisuals(comparisons){
  const wrappers = preview2.querySelectorAll('[data-file-name]');
  wrappers.forEach(wrapper=>{
    const fileName = wrapper.dataset.fileName;
    const boxes = wrapper.querySelectorAll('.face-box');
    boxes.forEach((box, idx)=>{
      const comp = comparisons.find(c=> c.fileName===fileName && c.faceIndex===idx);
      if(comp){
        if(comp.similarity>=85) box.style.borderColor='var(--success)';
        else if(comp.similarity>=70) box.style.borderColor='#8bc34a';
        else if(comp.similarity>=50) box.style.borderColor='#ff9800';
        else box.style.borderColor='var(--danger)';
        const label = box.querySelector('.face-label'); if(label) label.textContent = `${comp.similarity.toFixed(0)}% Match`;
      }
    });
  });
}

function showError(target, message){ const e = document.createElement('div'); e.className='error'; e.textContent=message; target.appendChild(e); }

function clearAll(){ preview1.innerHTML=''; preview2.innerHTML=''; resultsDiv.innerHTML=''; reference={image:null,faces:[],selectedIndex:0}; comparisons=[]; setDisabledState(); }

function fileToImage(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = e=>{ const img = new Image(); img.onload=()=>resolve(img); img.onerror=reject; img.src = e.target.result; };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.addEventListener('DOMContentLoaded', ()=>{ setupUI(); boot(); });
