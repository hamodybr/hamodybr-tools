/* HAMODYBR Tools V2.3 — pretty, indexable tool routes */
(()=>{'use strict';
const cfg=window.HB_ROUTE;if(!cfg?.id)return;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const routePath=location.pathname.endsWith('/')?location.pathname:location.pathname+'/';
const homePath=routePath.replace(/[^/]+\/$/,'');
const canonical=location.origin+routePath;
const schema=JSON.stringify({'@context':'https://schema.org','@type':'WebApplication',name:cfg.title+' — HAMODYBR Tools',description:cfg.description,applicationCategory:'UtilitiesApplication',operatingSystem:'Any',url:canonical,offers:{'@type':'Offer',price:'0',priceCurrency:'USD'}}).replace(/</g,'\\u003c');
const bootstrap=`<script id="hb-route-bootstrap">(()=>{const routePath=${JSON.stringify(routePath)},homePath=${JSON.stringify(homePath)},toolId=${JSON.stringify(cfg.id)},title=${JSON.stringify(cfg.title+' — HAMODYBR Tools')},description=${JSON.stringify(cfg.description)},canonical=${JSON.stringify(canonical)};const syncMeta=()=>{document.title=title;let d=document.querySelector('meta[name="description"]');if(d)d.content=description;let c=document.querySelector('link[rel="canonical"]');if(!c){c=document.createElement('link');c.rel='canonical';document.head.appendChild(c)}c.href=canonical;const ogt=document.querySelector('meta[property="og:title"]');if(ogt)ogt.content=title;const ogd=document.querySelector('meta[property="og:description"]');if(ogd)ogd.content=description};const launch=()=>{syncMeta();const card=document.querySelector('.card[data-id="'+toolId+'"]');if(card){card.click();history.replaceState(null,'',routePath)}const modal=document.querySelector('#modal');modal?.addEventListener('close',()=>history.replaceState(null,'',homePath));};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(launch,30),{once:true});else setTimeout(launch,30)})();<\/script>`;
fetch('../index.html?v=230',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('Could not load app');return r.text()}).then(html=>{
html=html.replace('<head>','<head><base href="../"><link rel="canonical" href="'+esc(canonical)+'"><script type="application/ld+json">'+schema+'<\\/script>');
html=html.replace(/<title>[\s\S]*?<\/title>/i,'<title>'+esc(cfg.title)+' — HAMODYBR Tools</title>');
html=html.replace(/<meta name="description"[^>]*>/i,'<meta name="description" content="'+esc(cfg.description)+'">');
html=html.replace(/<meta property="og:title"[^>]*>/i,'<meta property="og:title" content="'+esc(cfg.title)+' — HAMODYBR Tools">');
html=html.replace(/<meta property="og:description"[^>]*>/i,'<meta property="og:description" content="'+esc(cfg.description)+'">');
html=html.replace('</body>',bootstrap+'</body>');
document.open();document.write(html);document.close();
}).catch(()=>{document.body.innerHTML='<main style="font-family:system-ui;padding:40px;max-width:720px;margin:auto"><h1>'+esc(cfg.title)+'</h1><p>'+esc(cfg.description)+'</p><p><a href="../?tool='+encodeURIComponent(cfg.id)+'">Open tool</a></p></main>'});
})();
