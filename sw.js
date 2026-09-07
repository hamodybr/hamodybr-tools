const CACHE='hamodybr-tools-v2-5';
const FALLBACK='./index.html';
const CORE=[
  './','./index.html','./manifest.webmanifest','./icon.svg',
  './v2.css?v=220','./v2.js?v=220','./v2.1-ios-multipicker.js?v=220',
  './v2.4-links.css?v=240','./v2.4-links.js?v=240','./route-loader.js?v=230',
  './v2.5-core.js?v=250','./v2.5-pdf.js?v=250','./v2.5-images.js?v=250','./v2.5-text.js?v=250'
];
self.addEventListener('install',event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).catch(()=>{}))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;const req=event.request,url=new URL(req.url);if(req.mode==='navigate'){event.respondWith(fetch(req,{cache:'no-store'}).then(r=>{if(r&&r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(FALLBACK,copy)).catch(()=>{})}return r}).catch(()=>caches.match(FALLBACK)));return}event.respondWith(fetch(req,url.origin===self.location.origin?{cache:'no-store'}:undefined).then(r=>{if(r&&r.ok&&url.origin===self.location.origin){const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{})}return r}).catch(()=>caches.match(req))) });