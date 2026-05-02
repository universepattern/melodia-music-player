(function(){
'use strict';

// ── ELEMENTS ──
const audio    = document.getElementById('audioEl');
const playBtn  = document.getElementById('playBtn');
const playIco  = document.getElementById('playIco');
const prevBtn  = document.getElementById('prevBtn');
const nextBtn  = document.getElementById('nextBtn');
const shuffleBtn = document.getElementById('shuffleBtn');
const repeatBtn  = document.getElementById('repeatBtn');
const volSlider  = document.getElementById('volSlider');
const volPct     = document.getElementById('volPct');
const volIco     = document.getElementById('volIco');
const muteBtn    = document.getElementById('muteBtn');
const tName    = document.getElementById('tName');
const tArtist  = document.getElementById('tArtist');
const tFmt     = document.getElementById('tFmt');
const tCur     = document.getElementById('tCur');
const tTot     = document.getElementById('tTot');
const waveWrap = document.getElementById('waveWrap');
const waveCanvas= document.getElementById('waveCanvas');
const oilCanvas = document.getElementById('oilCanvas');
const discHalo  = document.getElementById('discHalo');
const discPin   = document.getElementById('discPin');
const needle    = document.getElementById('needle');
const bgEl      = document.getElementById('bg');
const dropRing  = document.getElementById('dropRing');
const queueList = document.getElementById('queueList');
const sbCount   = document.getElementById('sbCount');
const clearBtn  = document.getElementById('clearBtn');
const openBtn   = document.getElementById('openBtn');
const folderBtn = document.getElementById('folderBtn');
const fileInput = document.getElementById('fileInput');
const folderInput=document.getElementById('folderInput');
const toastEl   = document.getElementById('toast');
const themeBtn  = document.getElementById('themeBtn');
const miniBtn   = document.getElementById('miniBtn');
const stage     = document.getElementById('stage');
const card      = document.getElementById('card');

const wCtx = waveCanvas.getContext('2d');
const oCtx = oilCanvas.getContext('2d');

// ── STATE ──
let tracks=[], currentIdx=-1, isPlaying=false;
let isShuffle=false, isRepeat=false, isMuted=false, prevVol=75;
let waveData=null, urlCache={};
let audioCtx, analyser, srcNode, freqData, timeData, bufLen;
let rafId, lastDrawTime=0;
let isMiniMode = false;

const THEMES = ['sakura', 'midnight', 'autumn', 'matcha'];
let currentThemeIdx = 0;

// ── LOAD SETTINGS FROM LOCALSTORAGE ──
function loadSettings() {
  try {
    const s = localStorage.getItem('sakuraSettings');
    if (s) {
      const parsed = JSON.parse(s);
      if (parsed.volume !== undefined) {
        audio.volume = parsed.volume / 100;
        volSlider.value = parsed.volume;
        volPct.textContent = parsed.volume + '%';
        updateVolIco(parsed.volume);
      }
      if (parsed.shuffle) { isShuffle = true; shuffleBtn.classList.add('active'); }
      if (parsed.repeat) { isRepeat = true; audio.loop = true; repeatBtn.classList.add('active'); }
      if (parsed.theme) {
        const idx = THEMES.indexOf(parsed.theme);
        if (idx > -1) {
          currentThemeIdx = idx;
          applyTheme(THEMES[currentThemeIdx]);
        }
      }
    }
  } catch(e) {}
}

function saveSettings() {
  const s = {
    volume: parseInt(volSlider.value),
    shuffle: isShuffle,
    repeat: isRepeat,
    theme: THEMES[currentThemeIdx]
  };
  localStorage.setItem('sakuraSettings', JSON.stringify(s));
}

// ── PETALS ──
const petalsEl = document.getElementById('petals');
for(let i=0;i<14;i++){
  const p=document.createElement('div');
  p.className='petal';
  p.style.cssText=`
    left:${Math.random()*100}vw;
    width:${5+Math.random()*5}px;height:${6+Math.random()*6}px;
    animation-duration:${9+Math.random()*14}s;
    animation-delay:${-Math.random()*22}s;
    background:hsla(${330+Math.random()*40},65%,75%,${.3+Math.random()*.4});
  `;
  petalsEl.appendChild(p);
}

// ── CANVAS RESIZE ──
function resizeCanvases(){
  const dpr=window.devicePixelRatio||1;
  const ww=waveWrap.offsetWidth, wh=waveWrap.offsetHeight;
  waveCanvas.width=ww*dpr; waveCanvas.height=wh*dpr;
  waveCanvas.style.width=ww+'px'; waveCanvas.style.height=wh+'px';
  wCtx.scale(dpr,dpr);
  drawWave();
}
window.addEventListener('resize',resizeCanvases);
setTimeout(resizeCanvases,80);

// ── AUDIO CONTEXT ──
function setupAudio(){
  if(audioCtx)return;
  audioCtx=new(window.AudioContext||window.webkitAudioContext)();
  analyser=audioCtx.createAnalyser();
  analyser.fftSize=1024;
  bufLen=analyser.frequencyBinCount;
  freqData=new Uint8Array(bufLen);
  timeData=new Uint8Array(bufLen);
  srcNode=audioCtx.createMediaElementSource(audio);
  srcNode.connect(analyser);
  analyser.connect(audioCtx.destination);
}

// ── OIL PAINT DISC ──
const OIL_W = 280, OIL_H = 280;
const cx0 = OIL_W/2, cy0 = OIL_H/2;

const PALETTES = {
  sakura: ['#ff6b6b','#ffa07a','#ff69b4','#ffb347','#ff6eb4'],
  midnight: ['#38bdf8','#818cf8','#c084fc','#fb7185','#fde68a'],
  autumn: ['#f97316','#ef4444','#ec4899','#a855f7','#6366f1'],
  matcha: ['#86efac','#6ee7b7','#67e8f9','#93c5fd','#c4b5fd']
};
let palette = PALETTES.sakura;

const BLOB_COUNT = 7;
const blobs = [];
function initBlobs(){
  blobs.length=0;
  for(let i=0;i<BLOB_COUNT;i++){
    const angle = (i/BLOB_COUNT)*Math.PI*2;
    const r = 30+Math.random()*50;
    blobs.push({
      x: cx0 + Math.cos(angle)*r,
      y: cy0 + Math.sin(angle)*r,
      vx: (Math.random()-.5)*0.7,
      vy: (Math.random()-.5)*0.7,
      radius: 38+Math.random()*32,
      phase: Math.random()*Math.PI*2,
      speed: .3+Math.random()*.5,
    });
  }
}
initBlobs();

let oilTime = 0;
let bassEnergy = 0, midEnergy = 0, hiEnergy = 0;
let spinning = 0;

function updateBlobs(){
  bassEnergy *= .88;
  midEnergy  *= .88;
  hiEnergy   *= .92;

  if(analyser && isPlaying){
    analyser.getByteFrequencyData(freqData);
    const bsum = freqData.slice(0,8).reduce((a,b)=>a+b,0)/8/255;
    const msum = freqData.slice(8,40).reduce((a,b)=>a+b,0)/32/255;
    const hsum = freqData.slice(40,128).reduce((a,b)=>a+b,0)/88/255;
    bassEnergy = Math.max(bassEnergy, bsum);
    midEnergy  = Math.max(midEnergy,  msum);
    hiEnergy   = Math.max(hiEnergy,   hsum);
  }

  const pulse = 1 + bassEnergy*0.4;
  const timeFactor = isPlaying ? 1+midEnergy*1.5 : 0.25;
  oilTime += 0.012 * timeFactor;

  if(isPlaying) spinning += (0.004 + bassEnergy*0.02);

  blobs.forEach((b,i)=>{
    b.phase += b.speed * 0.012 * timeFactor;
    const wave = Math.sin(b.phase)*55 + Math.sin(b.phase*1.7+i)*30;
    const drift = Math.cos(b.phase*0.8+i*0.5)*40;
    b.x = cx0 + drift + Math.cos(oilTime*0.4 + i*1.1)*45*pulse;
    b.y = cy0 + wave + Math.sin(oilTime*0.3 + i*0.9)*38*pulse;
    b.radius = (38+Math.random()*2) + bassEnergy*25 + midEnergy*10;
  });
}

function hexToRgb(hex){
  const r=parseInt(hex.slice(1,3),16);
  const g=parseInt(hex.slice(3,5),16);
  const b=parseInt(hex.slice(5,7),16);
  return {r,g,b};
}
function lerpColor(c1,c2,t){
  return {
    r: Math.round(c1.r+(c2.r-c1.r)*t),
    g: Math.round(c1.g+(c2.g-c1.g)*t),
    b: Math.round(c1.b+(c2.b-c1.b)*t),
  };
}

function drawOilDisc(){
  const W=OIL_W, H=OIL_H;
  const cx=W/2, cy=H/2;
  const radius=W/2;

  oCtx.clearRect(0,0,W,H);
  oCtx.save();
  oCtx.beginPath(); oCtx.arc(cx,cy,radius,0,Math.PI*2); oCtx.clip();

  const bgGrad = oCtx.createRadialGradient(
    cx + Math.cos(spinning)*20, cy + Math.sin(spinning)*20, 0, cx, cy, radius
  );
  const bg1 = palette[0], bg2 = palette[palette.length-1];
  bgGrad.addColorStop(0,  bg1 + 'cc');
  bgGrad.addColorStop(0.6, bg2 + '99');
  bgGrad.addColorStop(1,  '#1a0a1a');
  oCtx.fillStyle = bgGrad;
  oCtx.fillRect(0,0,W,H);

  blobs.forEach((b,i)=>{
    const c1 = hexToRgb(palette[i % palette.length]);
    const c2 = hexToRgb(palette[(i+2) % palette.length]);
    const mix = (Math.sin(oilTime + i)*0.5+0.5);
    const col = lerpColor(c1,c2,mix);
    const alpha = 0.55 + midEnergy*0.25 + bassEnergy*0.2;

    const grad = oCtx.createRadialGradient(b.x,b.y,0,b.x,b.y,b.radius*(1+hiEnergy*.3));
    grad.addColorStop(0,   `rgba(${col.r},${col.g},${col.b},${alpha})`);
    grad.addColorStop(0.55,`rgba(${col.r},${col.g},${col.b},${alpha*0.4})`);
    grad.addColorStop(1,   `rgba(${col.r},${col.g},${col.b},0)`);

    oCtx.globalCompositeOperation = 'screen';
    oCtx.fillStyle = grad;
    oCtx.beginPath();
    oCtx.arc(b.x,b.y,b.radius*(1.2+hiEnergy*.3),0,Math.PI*2);
    oCtx.fill();
  });

  oCtx.globalCompositeOperation = 'overlay';
  const shimAngle = spinning * 0.5;
  const shimGrad = oCtx.createLinearGradient(
    cx + Math.cos(shimAngle)*radius, cy + Math.sin(shimAngle)*radius,
    cx - Math.cos(shimAngle)*radius, cy - Math.sin(shimAngle)*radius
  );
  shimGrad.addColorStop(0,   'rgba(255,255,255,0.0)');
  shimGrad.addColorStop(0.3, 'rgba(255,255,255,0.12)');
  shimGrad.addColorStop(0.5, 'rgba(255,255,255,0.22)');
  shimGrad.addColorStop(0.7, 'rgba(255,255,255,0.08)');
  shimGrad.addColorStop(1,   'rgba(255,255,255,0.0)');
  oCtx.fillStyle = shimGrad;
  oCtx.beginPath(); oCtx.arc(cx,cy,radius,0,Math.PI*2); oCtx.fill();

  oCtx.globalCompositeOperation = 'multiply';
  const vigGrad = oCtx.createRadialGradient(cx,cy,radius*0.3,cx,cy,radius);
  vigGrad.addColorStop(0,'rgba(255,255,255,1)');
  vigGrad.addColorStop(1,'rgba(80,30,60,0.9)');
  oCtx.fillStyle = vigGrad;
  oCtx.beginPath(); oCtx.arc(cx,cy,radius,0,Math.PI*2); oCtx.fill();

  oCtx.globalCompositeOperation = 'source-over';
  const hiGrad = oCtx.createRadialGradient(cx-30,cy-30,0,cx-30,cy-30,radius*0.7);
  hiGrad.addColorStop(0,'rgba(255,255,255,0.18)');
  hiGrad.addColorStop(1,'rgba(255,255,255,0)');
  oCtx.fillStyle = hiGrad;
  oCtx.beginPath(); oCtx.arc(cx,cy,radius,0,Math.PI*2); oCtx.fill();

  oCtx.restore();
}

function genWave(){
  const n=180; const d=[];
  let v=0.4;
  for(let i=0;i<n;i++){
    v+=(Math.random()-.5)*0.13;
    v=Math.max(.05,Math.min(.93,v));
    d.push(v);
  }
  for(let p=0;p<5;p++){
    const pos=Math.floor(Math.random()*n);
    const h=.5+Math.random()*.48;
    for(let j=-6;j<=6;j++) if(d[pos+j]!==undefined) d[pos+j]=Math.min(.97,d[pos+j]+h*(1-Math.abs(j)/7));
  }
  return d;
}

function drawWave(){
  const W=waveCanvas.offsetWidth, H=waveCanvas.offsetHeight;
  wCtx.clearRect(0,0,W,H);
  const prog=(audio.duration&&isFinite(audio.duration))? audio.currentTime/audio.duration:0;
  const splitX=prog*W;

  if(!waveData){
    wCtx.strokeStyle='rgba(180,120,80,.18)';
    wCtx.lineWidth=1.5;
    wCtx.beginPath(); wCtx.moveTo(0,H/2); wCtx.lineTo(W,H/2); wCtx.stroke();
    return;
  }
  const bw=W/waveData.length;
  for(let i=0;i<waveData.length;i++){
    const x=i*bw;
    const bh=waveData[i]*H*.9;
    const y=(H-bh)/2;
    wCtx.fillStyle = x<splitX ? 'rgba(176,112,64,.78)' : 'rgba(176,112,64,.16)';
    wCtx.fillRect(x+.5,y,Math.max(1,bw-1),bh);
  }
  if(prog>0){
    wCtx.strokeStyle='rgba(220,80,80,.65)';
    wCtx.lineWidth=1.5;
    wCtx.shadowColor='rgba(220,80,80,.45)';
    wCtx.shadowBlur=5;
    wCtx.beginPath(); wCtx.moveTo(splitX,0); wCtx.lineTo(splitX,H); wCtx.stroke();
    wCtx.shadowBlur=0;
  }
}

function loop(time){
  rafId=requestAnimationFrame(loop);
  
  // Optimization: Stop heavy canvas processing if paused
  if (!isPlaying && !isMiniMode) {
    if (time - lastDrawTime < 100) return; // throttle updates heavily
  }
  lastDrawTime = time;

  if (!isMiniMode) {
    updateBlobs();
    drawOilDisc();
  }
  drawWave();
}
loop(0);

// ── THEMES ──
function applyTheme(themeName) {
  document.body.className = '';
  if (themeName !== 'sakura') {
    document.body.classList.add('theme-' + themeName);
  }
  
  if (themeName === 'sakura') {
    bgEl.style.background = 'linear-gradient(135deg,#FFE8D6 0%,#FFCBA4 45%,#F5B08A 75%,#F7B8C4 100%)';
  } else {
    bgEl.style.background = ''; // use CSS variable fallback if needed, but we rely on the CSS class changing root colors
  }
  
  palette = PALETTES[themeName] || PALETTES.sakura;
  initBlobs();
  saveSettings();
}

themeBtn.addEventListener('click', () => {
  currentThemeIdx = (currentThemeIdx + 1) % THEMES.length;
  applyTheme(THEMES[currentThemeIdx]);
  toast(`Theme: ${THEMES[currentThemeIdx]}`);
});

miniBtn.addEventListener('click', () => {
  isMiniMode = !isMiniMode;
  stage.classList.toggle('mini-mode', isMiniMode);
  card.classList.toggle('mini-mode', isMiniMode);
  setTimeout(resizeCanvases, 400); // resize wave canvas after transition
  toast(isMiniMode ? "Mini Player On" : "Mini Player Off");
});


// ── LOAD TRACK ──
function loadTrack(idx){
  if(idx<0||idx>=tracks.length)return;
  currentIdx=idx;
  const t=tracks[idx];
  if(!urlCache[idx]) urlCache[idx]=URL.createObjectURL(t.file);
  audio.src=urlCache[idx];
  
  updateTrackInfoUI();
  
  tFmt.textContent=t.file.name.split('.').pop().toUpperCase();
  tFmt.classList.add('on');
  waveData=genWave();
  renderQueue();
}

function updateTrackInfoUI() {
  if (currentIdx === -1) return;
  const t = tracks[currentIdx];
  tName.textContent = t.title;
  tName.classList.remove('idle');
  tArtist.textContent = t.artist;
  if (t.cover) {
    discPin.style.backgroundImage = `url(${t.cover})`;
  } else {
    discPin.style.backgroundImage = 'none';
  }
}

// ── PLAY ──
function togglePlay(){
  setupAudio();
  if(audioCtx.state==='suspended') audioCtx.resume();
  if(audio.paused){audio.play();setPlaying(true);}
  else{audio.pause();setPlaying(false);}
}

function setPlaying(v){
  isPlaying=v;
  playIco.innerHTML=v
    ?'<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
    :'<polygon points="5 3 19 12 5 21 5 3"/>';
  discHalo.classList.toggle('active',v);
  needle.classList.toggle('on',v);
  renderQueue();
}

// ── ADD FILES WITH ID3 PARSING ──
function addFiles(files,fromFolder){
  const ok=/\.(mp3|flac|wav|ogg|aac|m4a|opus|wma|aiff|alac)$/i;
  const valid=Array.from(files)
    .filter(f=>ok.test(f.name)||f.type.startsWith('audio/'))
    .sort((a,b)=>{
      const pa=(a.webkitRelativePath||a.name).toLowerCase();
      const pb=(b.webkitRelativePath||b.name).toLowerCase();
      return pa.localeCompare(pb,undefined,{numeric:true});
    });
  if(!valid.length)return;
  const startIdx=tracks.length;
  
  valid.forEach(f=>{
    const tIdx=tracks.length;
    const cleanName = f.name.replace(/\.[^.]+$/,'').replace(/[-_]/g,' ');
    const entry={
      file: f,
      duration: null,
      title: cleanName,
      artist: 'Unknown Artist',
      cover: null
    };
    tracks.push(entry);
    
    // Asynchronous ID3 parsing
    if (window.jsmediatags) {
      jsmediatags.read(f, {
        onSuccess: function(tag) {
          const t = tag.tags;
          if (t.title) tracks[tIdx].title = t.title;
          if (t.artist) tracks[tIdx].artist = t.artist;
          if (t.picture) {
            let base64String = "";
            for (let i = 0; i < t.picture.data.length; i++) {
                base64String += String.fromCharCode(t.picture.data[i]);
            }
            tracks[tIdx].cover = "data:" + t.picture.format + ";base64," + window.btoa(base64String);
          }
          if (tIdx === currentIdx) updateTrackInfoUI();
          renderQueue(); // Update queue UI with real names
        },
        onError: function() { /* ignore errors and use filename */ }
      });
    }

    const tmp=new Audio(URL.createObjectURL(f));
    tmp.addEventListener('loadedmetadata',()=>{
      tracks[tIdx].duration=fmt(tmp.duration);
      renderQueue();
    });
  });
  
  if(fromFolder){
    const fn=valid[0].webkitRelativePath?valid[0].webkitRelativePath.split('/')[0]:'folder';
    toast(`♪ ${valid.length} tracks — "${fn}"`);
  }
  if(currentIdx===-1){
    loadTrack(startIdx);
    audio.play().then(()=>setPlaying(true)).catch(()=>{});
  }
  renderQueue();
}

function clearQueue(){
  audio.pause(); audio.src='';
  tracks=[]; urlCache={}; currentIdx=-1; isPlaying=false; waveData=null;
  tName.textContent='drop your music ♪'; tName.classList.add('idle');
  tArtist.textContent='sakura player';
  discPin.style.backgroundImage = 'none';
  tFmt.classList.remove('on');
  tCur.textContent='0:00'; tTot.textContent='0:00';
  playIco.innerHTML='<polygon points="5 3 19 12 5 21 5 3"/>';
  discHalo.classList.remove('active'); needle.classList.remove('on');
  drawWave(); renderQueue();
  toast('queue cleared ✕');
}

function renderQueue(){
  sbCount.textContent=tracks.length+' track'+(tracks.length!==1?'s':'');
  if(!tracks.length){
    queueList.innerHTML='<li class="queue-empty">nothing here yet<br>open a folder or drop files ♪</li>';
    return;
  }
  queueList.innerHTML='';
  tracks.forEach((t,i)=>{
    const ext=t.file.name.split('.').pop().toUpperCase();
    const isAct=i===currentIdx;
    const li=document.createElement('li');
    li.className='qi'+(isAct?' active':'');
    li.style.animationDelay=Math.min(i*.03,.5)+'s';
    li.innerHTML=`
      <span class="qi-num">${isAct
        ?`<div class="qi-eq ${isPlaying?'play':'pause'}"><span></span><span></span><span></span></div>`
        :i+1}</span>
      <div class="qi-info">
        <div class="qi-name">${t.title}</div>
        <div class="qi-ext">${ext}</div>
      </div>
      <span class="qi-dur">${t.duration||'─:──'}</span>
    `;
    li.addEventListener('click',()=>{
      if(i!==currentIdx){loadTrack(i);audio.play();setPlaying(true);}
      else togglePlay();
    });
    queueList.appendChild(li);
  });
  setTimeout(()=>{
    const a=queueList.querySelector('.active');
    if(a) a.scrollIntoView({block:'nearest',behavior:'smooth'});
  },50);
}

// ── EVENTS ──
audio.addEventListener('timeupdate',()=>{
  if(!isFinite(audio.duration))return;
  tCur.textContent=fmt(audio.currentTime);
  tTot.textContent=fmt(audio.duration);
});
audio.addEventListener('ended',()=>{
  if(isRepeat){audio.play();return;}
  const ni=isShuffle?Math.floor(Math.random()*tracks.length):currentIdx+1;
  if(ni<tracks.length){loadTrack(ni);audio.play();setPlaying(true);}
  else setPlaying(false);
});

waveWrap.addEventListener('click',e=>{
  if(!isFinite(audio.duration))return;
  const r=waveWrap.getBoundingClientRect();
  audio.currentTime=((e.clientX-r.left)/r.width)*audio.duration;
  drawWave(); // ensure immediate update if paused
});

playBtn.addEventListener('click',()=>{if(tracks.length)togglePlay();});
prevBtn.addEventListener('click',()=>{
  if(!tracks.length)return;
  if(audio.currentTime>3){audio.currentTime=0;return;}
  const ni=(currentIdx-1+tracks.length)%tracks.length;
  loadTrack(ni);audio.play();setPlaying(true);
});
nextBtn.addEventListener('click',()=>{
  if(!tracks.length)return;
  const ni=isShuffle?Math.floor(Math.random()*tracks.length):(currentIdx+1)%tracks.length;
  loadTrack(ni);audio.play();setPlaying(true);
});
shuffleBtn.addEventListener('click',()=>{
  isShuffle=!isShuffle;
  shuffleBtn.classList.toggle('active',isShuffle);
  saveSettings();
});
repeatBtn.addEventListener('click',()=>{
  isRepeat=!isRepeat;
  audio.loop=isRepeat;
  repeatBtn.classList.toggle('active',isRepeat);
  saveSettings();
});

// Volume
volSlider.addEventListener('input',e=>{
  const v=parseInt(e.target.value);
  audio.volume=v/100; volPct.textContent=v+'%';
  volSlider.style.background=`linear-gradient(90deg,var(--kincha) ${v}%,rgba(180,120,80,.2) ${v}%)`;
  updateVolIco(v);
});
volSlider.addEventListener('change', saveSettings);

muteBtn.addEventListener('click',()=>{
  isMuted=!isMuted;
  if(isMuted){prevVol=parseInt(volSlider.value);volSlider.value=0;}
  else volSlider.value=prevVol;
  volSlider.dispatchEvent(new Event('input'));
  saveSettings();
});
function updateVolIco(v){
  volIco.innerHTML=v===0
    ?'<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'
    :v<50
    ?'<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>'
    :'<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>';
}

clearBtn.addEventListener('click',clearQueue);
openBtn.addEventListener('click',()=>fileInput.click());
folderBtn.addEventListener('click',()=>folderInput.click());
fileInput.addEventListener('change',e=>addFiles(e.target.files,false));
folderInput.addEventListener('change',e=>{addFiles(e.target.files,true);folderInput.value='';});

let dragN=0;
document.addEventListener('dragenter',e=>{e.preventDefault();dragN++;dropRing.classList.add('on');});
document.addEventListener('dragleave',e=>{dragN--;if(dragN<=0){dragN=0;dropRing.classList.remove('on');}});
document.addEventListener('dragover',e=>e.preventDefault());
document.addEventListener('drop',async e=>{
  e.preventDefault();dragN=0;dropRing.classList.remove('on');
  const items=Array.from(e.dataTransfer.items||[]);
  const allFiles=[];let isFolder=false;
  async function readEntry(entry){
    if(entry.isFile) return new Promise(res=>entry.file(f=>{allFiles.push(f);res();}));
    if(entry.isDirectory){
      isFolder=true;
      return new Promise(res=>{
        const reader=entry.createReader();
        function readAll(){
          reader.readEntries(async entries=>{
            if(!entries.length){res();return;}
            await Promise.all(entries.map(readEntry));
            readAll();
          });
        }
        readAll();
      });
    }
  }
  if(items.length&&items[0].webkitGetAsEntry){
    await Promise.all(items.map(item=>{const e2=item.webkitGetAsEntry();return e2?readEntry(e2):Promise.resolve();}));
    addFiles(allFiles,isFolder);
  } else addFiles(e.dataTransfer.files,false);
});

document.addEventListener('keydown',e=>{
  if(['INPUT','TEXTAREA'].includes(e.target.tagName))return;
  if(e.code==='Space'){e.preventDefault();if(tracks.length)togglePlay();}
  if(e.code==='ArrowRight') audio.currentTime=Math.min(audio.duration||0,(audio.currentTime||0)+10);
  if(e.code==='ArrowLeft')  audio.currentTime=Math.max(0,(audio.currentTime||0)-10);
  if(e.code==='ArrowUp'){volSlider.value=Math.min(100,+volSlider.value+5);volSlider.dispatchEvent(new Event('input')); saveSettings();}
  if(e.code==='ArrowDown'){volSlider.value=Math.max(0,+volSlider.value-5);volSlider.dispatchEvent(new Event('input')); saveSettings();}
  if(e.code==='KeyN')nextBtn.click();
  if(e.code==='KeyP')prevBtn.click();
  if(e.code==='KeyM')muteBtn.click();
});

let toastT;
function toast(msg){
  toastEl.textContent=msg;
  toastEl.classList.add('on');
  clearTimeout(toastT);
  toastT=setTimeout(()=>toastEl.classList.remove('on'),2800);
}

function fmt(s){
  if(!isFinite(s))return'0:00';
  const m=Math.floor(s/60),sec=Math.floor(s%60);
  return`${m}:${sec.toString().padStart(2,'0')}`;
}

// Init
loadSettings();
applyTheme(THEMES[currentThemeIdx]);

// Generate lightweight CSS stars for Midnight theme
function generateStars(count) {
  let val = `${Math.floor(Math.random() * 100)}vw ${Math.floor(Math.random() * 100)}vh #fff`;
  for(let i=1; i<count; i++) {
    val += `, ${Math.floor(Math.random() * 100)}vw ${Math.floor(Math.random() * 100)}vh #fff`;
  }
  return val;
}
const s1 = document.querySelector('.stars1');
const s2 = document.querySelector('.stars2');
const s3 = document.querySelector('.stars3');
if(s1 && s2 && s3) {
  s1.style.boxShadow = generateStars(120);
  s2.style.boxShadow = generateStars(60);
  s3.style.boxShadow = generateStars(30);
}

})();
