/* global self, setTimeout, URL, File, crypto, Response, caches, fetch */
const precacheEntries = self.__WB_MANIFEST;
const cacheName = `quickdrop-shell-${precacheEntries.map(({ url }) => url).join('|')}`;
const precacheUrls = new Set(
  precacheEntries.map(({ url }) => new URL(url, self.location.href).href),
);

const acknowledgements = new Map();

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data?.type !== 'quickdrop-share-target-ack') return;
  const acknowledge = acknowledgements.get(event.data.id);
  if (acknowledge) {
    acknowledgements.delete(event.data.id);
    acknowledge();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('quickdrop-shell-') && name !== cacheName)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(cacheName)
      .then((cache) => cache.addAll([...precacheUrls]))
      .then(() => undefined),
  );
});

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function deliverShare(message) {
  let acknowledged = false;
  let targetClientId = null;
  acknowledgements.set(message.id, () => {
    acknowledged = true;
  });

  try {
    for (let attempt = 0; attempt < 80 && !acknowledged; attempt += 1) {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      const targetClient = targetClientId
        ? windows.find((windowClient) => windowClient.id === targetClientId)
        : windows[0];

      if (targetClient) {
        targetClientId = targetClient.id;
        targetClient.postMessage(message);
      } else if (windows.length === 0 && attempt === 4) {
        await self.clients.openWindow('/?share-target=1');
      } else {
        targetClientId = null;
      }

      await delay(250);
    }
  } finally {
    acknowledgements.delete(message.id);
  }
}

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (
    event.request.method !== 'POST' ||
    requestUrl.pathname !== '/share-target'
  ) {
    return;
  }

  const id = crypto.randomUUID();
  const share = event.request.formData().then((formData) => {
    const files = formData
      .getAll('files')
      .filter((value) => typeof File !== 'undefined' && value instanceof File)
      .filter((file) => file.name.length > 0);
    const message = files.length > 0
      ? { type: 'quickdrop-share-target', id, files }
      : {
          type: 'quickdrop-share-target-error',
          id,
          error: 'No files were included in the share. Choose files and try again.',
        };
    return { message };
  }).catch(() => ({
    message: {
      type: 'quickdrop-share-target-error',
      id,
      error: 'The shared files could not be read. Try sharing them again.',
    },
  }));

  event.waitUntil(share.then(({ message }) => deliverShare(message)));
  event.respondWith(
    share.then(() => Response.redirect(new URL('/?share-target=1', requestUrl), 303)),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  const cacheUrl = request.mode === 'navigate'
    ? new URL('/index.html', self.location.href).href
    : request.url;
  if (!precacheUrls.has(cacheUrl)) return;

  event.respondWith(
    caches.open(cacheName).then(async (cache) => {
      const cached = await cache.match(cacheUrl);
      return cached || fetch(request);
    }),
  );
});
