const CACHE='hamodybr-tools-v2-4';
const FALLBACK='./index.html';
const CORE=['./index.html','./manifest.webmanifest','./icon.svg','./v2.css','./v2.js','./v2.1-ios-multipicker.js'];

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).catch(()=>{}));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const req=event.request;

  if(req.mode==='navigate'){
    event.respondWith(
      fetch(req,{cache:'no-store'})
        .then(response=>{
          if(response&&response.ok){
            const copy=response.clone();
            caches.open(CACHE).then(cache=>cache.put(FALLBACK,copy)).catch(()=>{});
          }
          return response;
        })
        .catch(()=>caches.match(FALLBACK))
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then(response=>{
        if(response&&response.ok&&new URL(req.url).origin===self.location.origin){
          const copy=response.clone();
          caches.open(CACHE).then(cache=>cache.put(req,copy)).catch(()=>{});
        }
        return response;
      })
      .catch(()=>caches.match(req))
  );
});
