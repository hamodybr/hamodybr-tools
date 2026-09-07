/* HAMODYBR Tools V2.5 core */
(()=>{'use strict';
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)],modal=$('#modal'),content=$('#content');if(!modal||!content)return;
const defs={};
const api=window.HB_V25={
 $,$$,defs,
 toast(msg){let t=$('#toast');if(!t){t=document.createElement('div');t.id='toast';t.className='toast';document.body.appendChild(t)}t.textContent=msg;t.classList.add('show');clearTimeout(api.toast.t);api.toast.t=setTimeout(()=>t.classList.remove('show'),2300)},
 bytes:n=>n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(2)+' MB',
 base:n=>(n||'file').replace(/\.[^.]+$/,''),
 download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1800)},
 image(file){return new Promise((ok,no)=>{const u=URL.createObjectURL(file),im=new Image;im.onload=()=>{URL.revokeObjectURL(u);ok(im)};im.onerror=()=>{URL.revokeObjectURL(u);no(new Error('Image decode failed'))};im.src=u})},
 toBlob:(c,t,q=.9)=>new Promise((ok,no)=>c.toBlob(b=>b?ok(b):no(new Error('Encode failed')),t,q)),
 header:(tag,title,desc)=>`<small class="v25-tag">${tag}</small><h2>${title}</h2><p class="desc">${desc}</p>`,
 register(def){defs[def.id]=def;api.addCard(def)},
 addCard(t){const grid=$('#grid');if(!grid||$(`.card[data-id="${t.id}"]`,grid))return;grid.insertAdjacentHTML('beforeend',`<article class="card" data-id="${t.id}" data-keys="${t.keys||''}"><div class="ico">${t.icon}</div><div><small style="color:var(--muted);font-weight:800">${t.tag}</small><b>${t.name}</b><p>${t.desc}</p></div><button class="open" aria-label="Open ${t.name}">→</button></article>`);},
 open(id){const t=defs[id];if(!t)return false;content.innerHTML=t.render();t.init?.();modal.showModal();return true}
};
function styles(){if($('#hb-v25-style'))return;const s=document.createElement('style');s.id='hb-v25-style';s.textContent='.v25-tag{color:var(--accent);font-weight:900}.v25-note{padding:12px 14px;border:1px solid color-mix(in srgb,var(--accent) 24%,var(--line));background:var(--soft);color:var(--accent);border-radius:14px;font-size:12px;line-height:1.5;font-weight:700}.v25-mini{font-size:11px;color:var(--muted)}.v25-results{display:grid;gap:8px}.v25-result{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 12px;border:1px solid var(--line);background:var(--bg);border-radius:13px}.v25-result strong,.v25-result span{display:block}.v25-result strong{font-size:12px;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.v25-result span{font-size:11px;color:var(--muted);margin-top:3px}.v25-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.v25-grid .btn{width:100%}.v25-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;min-height:220px}.v25-preview{height:110px;border:1px solid var(--line);border-radius:16px;background:#6558f5}@media(max-width:560px){.v25-result{flex-direction:column;align-items:stretch}.v25-grid{grid-template-columns:1fr}}';document.head.appendChild(s)}
function bind(){const grid=$('#grid');if(!grid||grid.dataset.hbV25==='1')return;grid.dataset.hbV25='1';grid.addEventListener('click',e=>{const c=e.target.closest?.('.card');if(!c||!defs[c.dataset.id]||e.isTrusted)return;e.preventDefault();e.stopImmediatePropagation();api.open(c.dataset.id)},true)}
async function load(){styles();bind();const root=(()=>{const b=document.querySelector('base')?.href;if(b)return new URL(b);const m='/hamodybr-tools/',p=location.pathname,i=p.indexOf(m);return i>=0?new URL(location.origin+p.slice(0,i+m.length)):new URL('./',location.href)})();for(const f of ['v2.5-pdf.js?v=250','v2.5-images.js?v=250','v2.5-text.js?v=250']){await new Promise((ok,no)=>{const s=document.createElement('script');s.src=new URL(f,root).href;s.onload=ok;s.onerror=no;document.head.appendChild(s)})}const id=window.HB_ROUTE?.id;if(id&&defs[id])setTimeout(()=>api.open(id),60)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load);else load();
})();