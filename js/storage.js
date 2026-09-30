// storage.js – a tiny "keep this for next time" box for things that do not fit in normal settings:
// the template folder you picked and the preview background image. (Uses the browser's IndexedDB.)

function openKeepBox() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('chessifity', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('keep');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function keepGet(key) {
  const db = await openKeepBox();
  return new Promise((resolve, reject) => {
    const request = db.transaction('keep').objectStore('keep').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function keepSet(key, value) {
  const db = await openKeepBox();
  return new Promise((resolve, reject) => {
    const request = db.transaction('keep', 'readwrite').objectStore('keep').put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
