/* HAMODYBR Tools V2 — progressive enhancement, no backend required */
(()=>{'use strict';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const store={get(k,d=[]){try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}};
const toast=(msg)=>{let t=$('#toast');if(!t){t=document.createElement('div');t.id='toast';t.className='toast';document.body.appendChild(t)}t.textContent=msg;t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),2300)};
const keyForCard=c=>c?.querySelector('b')?.textContent.trim()||c?.textContent.trim().slice(0,60)||'';
let activeCategory='all', favoritesOnly=false, installPrompt=null, pdfFiles=[], lastPdfInput=null;

function enhanceHeader(){
  const brand=$('.brand'); if(brand&&!$('.v2-badge',brand)) brand.insertAdjacentHTML('beforeend','<span class="v2-badge">V2</span>');
  const theme=$('#theme'); if(!theme||$('.v2-top-actions')) return;
  const wrap=document.createElement('div');wrap.className='v2-top-actions';
  wrap.innerHTML='<button class="v2-install" hidden>Install app</button><div class="v2-status"><i class="v2-dot"></i><span>Local & private</span></div>';
  theme.parentNode.insertBefore(wrap,theme);wrap.appendChild(theme);
  const install=$('.v2-install',wrap);install.onclick=async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;install.hidden=true};
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;install.hidden=false});
  const status=$('.v2-status',wrap), sync=()=>{status.classList.toggle('offline',!navigator.onLine);$('span',status).textContent=navigator.onLine?'Local & private':'Offline mode'};
  addEventListener('online',sync);addEventListener('offline',sync);sync();
}

function categoryFor(c){const s=c.textContent.toLowerCase();if(s.includes('pdf'))return'pdf';if(s.includes('image')||s.includes('jpg')||s.includes('png')||s.includes('webp'))return'image';if(s.includes('text')||s.includes('word')||s.includes('character'))return'text';return'utility'}
function cards(){return $$('.card','#grid')}
function applyFilters(){
  const favs=store.get('hb-v2-favorites',[]);let visible=0;
  cards().forEach(c=>{const k=keyForCard(c), cat=c.dataset.v2cat||categoryFor(c);c.dataset.v2cat=cat;const hide=(activeCategory!=='all'&&cat!==activeCategory)||(favoritesOnly&&!favs.includes(k));c.classList.toggle('v2-cat-hide',hide);if(!hide&&!c.classList.contains('hide'))visible++});
  const count=$('#count');if(count)count.textContent=visible+' tool'+(visible===1?'':'s');
}
function renderRecent(){
  let host=$('.v2-recent');if(!host)return;const recent=store.get('hb-v2-recent',[]).slice(0,3);host.innerHTML='';
  if(!recent.length){host.classList.remove('show');return}host.classList.add('show');host.insertAdjacentHTML('beforeend','<span class="v2-recent-label">Recently used:</span>');
  recent.forEach(name=>{const b=document.createElement('button');b.className='v2-recent-btn';b.textContent=name;b.onclick=()=>{const c=cards().find(x=>keyForCard(x)===name);c?.click()};host.appendChild(b)});
}
function recordRecent(c){const k=keyForCard(c);if(!k)return;let r=store.get('hb-v2-recent',[]).filter(x=>x!==k);r.unshift(k);store.set('hb-v2-recent',r.slice(0,6));renderRecent()}
function enhanceCards(){
  const favs=store.get('hb-v2-favorites',[]);cards().forEach(c=>{c.dataset.v2cat=categoryFor(c);if($('.v2-fav',c))return;const k=keyForCard(c),b=document.createElement('button');b.className='v2-fav'+(favs.includes(k)?' on':'');b.type='button';b.title='Favorite';b.setAttribute('aria-label','Toggle favorite');b.textContent=favs.includes(k)?'★':'☆';
    b.onclick=e=>{e.preventDefault();e.stopPropagation();let f=store.get('hb-v2-favorites',[]);if(f.includes(k))f=f.filter(x=>x!==k);else f.unshift(k);store.set('hb-v2-favorites',f);b.classList.toggle('on',f.includes(k));b.textContent=f.includes(k)?'★':'☆';applyFilters()};c.appendChild(b)});applyFilters();
}
function enhanceDiscovery(){
  const search=$('.search');if(!search)return;
  if(!$('.v2-kbd',search)){const k=document.createElement('kbd');k.className='v2-kbd';k.textContent='/';search.appendChild(k)}
  if(!$('.v2-toolbar')){search.insertAdjacentHTML('afterend','<div class="v2-toolbar"><button class="v2-chip active" data-cat="all">All</button><button class="v2-chip" data-cat="image">Images</button><button class="v2-chip" data-cat="pdf">PDF</button><button class="v2-chip" data-cat="text">Text</button><button class="v2-chip" data-cat="utility">Utilities</button><button class="v2-chip" data-cat="favorites">★ Favorites</button></div><div class="v2-recent"></div>');
    $$('.v2-chip').forEach(b=>b.onclick=()=>{$$('.v2-chip').forEach(x=>x.classList.remove('active'));b.classList.add('active');favoritesOnly=b.dataset.cat==='favorites';activeCategory=favoritesOnly?'all':b.dataset.cat;applyFilters()})}
  const input=$('#search');input?.addEventListener('input',()=>setTimeout(applyFilters));document.addEventListener('keydown',e=>{if(e.key==='/'&&!/input|textarea|select/i.test(document.activeElement?.tagName||'')){e.preventDefault();input?.focus()}if(e.key==='Escape'&&document.activeElement===input)input.blur()});renderRecent();
}
function findImagePdfCard(){return cards().find(c=>{const s=c.textContent.toLowerCase();return s.includes('image')&&s.includes('pdf')})}
function openImagePdf(files){pdfFiles=files.filter(f=>f.type.startsWith('image/'));window.__hbV2PdfFiles=pdfFiles;if(!pdfFiles.length)return false;const c=findImagePdfCard();if(!c){toast('Image to PDF tool was not found.');return false}c.click();return true}
function enhanceDrop(){
  const any=$('#anyFile'),drop=$('#drop');if(any){any.multiple=true;any.addEventListener('change',e=>{const fs=[...e.target.files];if(fs.length>1&&fs.every(f=>f.type.startsWith('image/'))){e.stopImmediatePropagation();openImagePdf(fs)}},true)}
  drop?.addEventListener('drop',e=>{const fs=[...e.dataTransfer.files];if(fs.length>1&&fs.every(f=>f.type.startsWith('image/'))){e.preventDefault();e.stopImmediatePropagation();drop.classList.remove('drag');openImagePdf(fs)}},true);
}
function bytes(n){return n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(2)+' MB'}
function downloadBlob(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1600)}
async function rasterize(file){
  let source,w,h,close=()=>{};try{source=await createImageBitmap(file,{imageOrientation:'from-image'});w=source.width;h=source.height;close=()=>source.close?.()}catch{source=await new Promise((ok,no)=>{const u=URL.createObjectURL(file),im=new Image;im.onload=()=>{URL.revokeObjectURL(u);ok(im)};im.onerror=no;im.src=u});w=source.naturalWidth;h=source.naturalHeight}
  const max=6000,scale=Math.min(1,max/Math.max(w,h)),cw=Math.max(1,Math.round(w*scale)),ch=Math.max(1,Math.round(h*scale)),c=document.createElement('canvas');c.width=cw;c.height=ch;const x=c.getContext('2d',{alpha:false});x.fillStyle='#fff';x.fillRect(0,0,cw,ch);x.drawImage(source,0,0,cw,ch);close();const b=await new Promise((ok,no)=>c.toBlob(v=>v?ok(v):no(new Error('Could not encode image')),'image/jpeg',.92));return{buffer:await b.arrayBuffer(),width:cw,height:ch}}
function renderPdfSelection(){
  const sum=$('.v2-file-summary'),gal=$('.v2-gallery');if(!sum||!gal)return;const total=pdfFiles.reduce((a,f)=>a+f.size,0);sum.innerHTML=`<strong>${pdfFiles.length} image${pdfFiles.length===1?'':'s'} selected</strong><span>${bytes(total)} • selection order = page order</span>`;gal.innerHTML='';
  pdfFiles.slice(0,12).forEach((f,i)=>{const u=URL.createObjectURL(f),d=document.createElement('div');d.className='v2-thumb';d.innerHTML=`<img alt="Page ${i+1}"><span>${i+1}. ${f.name}</span>`;$('img',d).src=u;$('img',d).onload=()=>URL.revokeObjectURL(u);gal.appendChild(d)});if(pdfFiles.length>12){const d=document.createElement('div');d.className='v2-thumb';d.style.display='grid';d.style.placeItems='center';d.innerHTML=`<strong>+${pdfFiles.length-12}</strong>`;gal.appendChild(d)}
}
async function makePdf(){
  if(!pdfFiles.length)return toast('Choose one or more images first.');if(!window.PDFLib)return toast('PDF engine is not available.');
  const btn=$('.v2-pdf-create'),bar=$('.v2-progress i'),result=$('.v2-pdf-result'),size=$('#v2-page-size')?.value||'a4',margin=Number($('#v2-margin')?.value||24);btn.disabled=true;btn.textContent='Creating…';result.hidden=true;
  try{const doc=await PDFLib.PDFDocument.create();for(let i=0;i<pdfFiles.length;i++){const r=await rasterize(pdfFiles[i]),img=await doc.embedJpg(r.buffer);let pw,ph,m=margin;if(size==='original'){pw=r.width*.75;ph=r.height*.75;const cap=1800,s=Math.min(1,cap/Math.max(pw,ph));pw*=s;ph*=s;m=0}else{const portrait=size==='letter'?[612,792]:[595.28,841.89],landscape=[portrait[1],portrait[0]];[pw,ph]=r.width>=r.height?landscape:portrait}const page=doc.addPage([pw,ph]),availW=Math.max(1,pw-m*2),availH=Math.max(1,ph-m*2),s=Math.min(availW/r.width,availH/r.height),dw=r.width*s,dh=r.height*s;page.drawImage(img,{x:(pw-dw)/2,y:(ph-dh)/2,width:dw,height:dh});if(bar)bar.style.width=((i+1)/pdfFiles.length*100)+'%'}const out=await doc.save(),blob=new Blob([out],{type:'application/pdf'}),name=(pdfFiles[0].name.replace(/\.[^.]+$/,'')||'images')+(pdfFiles.length>1?`-${pdfFiles.length}-images`:'')+'.pdf';result.hidden=false;result.innerHTML=`<div class="v2-result-ok"><strong>PDF ready</strong><span>${pdfFiles.length} pages • ${bytes(blob.size)}</span><button class="btn v2-pdf-download">Download PDF</button></div>`;$('.v2-pdf-download',result).onclick=()=>downloadBlob(blob,name);toast('Your PDF is ready.')}catch(err){console.error(err);toast('Could not create the PDF. Try different images.')}finally{btn.disabled=false;btn.textContent='Create PDF';setTimeout(()=>{if(bar)bar.style.width='0'},700)}}
function prepareImagePdfModal(){
  const content=$('#content');if(!content)return;const title=$('h2',content)?.textContent||'';if(!(/image/i.test(title)&&/pdf/i.test(title)))return;const input=$('input[type="file"]',content);if(!input||input===lastPdfInput)return;lastPdfInput=input;input.multiple=true;input.accept='image/*';
  const form=input.closest('.form')||content;input.closest('.field')?.insertAdjacentHTML('beforebegin','<div class="v2-multi-note">NEW IN V2 — Select multiple images at once. Each image becomes one PDF page, in selection order.</div>');
  input.closest('.field')?.insertAdjacentHTML('afterend','<div class="v2-file-summary"><strong>No images selected</strong><span>You can select many at once</span></div><div class="v2-gallery"></div><div class="row v2-pdf-options"><div class="field"><label>Page size</label><select id="v2-page-size"><option value="a4">A4 — auto orientation</option><option value="letter">Letter — auto orientation</option><option value="original">Original image ratio</option></select></div><div class="field"><label>Margin</label><select id="v2-margin"><option value="0">None</option><option value="24" selected>Small</option><option value="42">Comfortable</option></select></div></div><div class="v2-progress"><i></i></div><div class="result v2-pdf-result" hidden></div>');
  input.addEventListener('change',()=>{pdfFiles=[...input.files];window.__hbV2PdfFiles=pdfFiles;renderPdfSelection()});if(window.__hbV2PdfFiles?.length){pdfFiles=[...window.__hbV2PdfFiles];renderPdfSelection()}
  const action=$('.actions .btn',form)||$('.btn',form);if(action){const b=action.cloneNode(true);b.removeAttribute('id');b.classList.add('v2-pdf-create');b.textContent='Create PDF';action.replaceWith(b);b.onclick=makePdf}
}
function watchModal(){const content=$('#content');if(!content)return;new MutationObserver(()=>prepareImagePdfModal()).observe(content,{childList:true,subtree:true});document.addEventListener('click',e=>{const c=e.target.closest?.('.card');if(c&&!e.target.closest('.v2-fav'))recordRecent(c)},true)}
function boot(){enhanceHeader();enhanceDiscovery();enhanceCards();enhanceDrop();watchModal();prepareImagePdfModal();const grid=$('#grid');if(grid)new MutationObserver(()=>{enhanceCards();applyFilters()}).observe(grid,{childList:true})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
