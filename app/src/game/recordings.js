function database() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("microduck-recordings", 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore("clips", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function access(mode, operation) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("clips", mode),
        req = operation(tx.objectStore("clips"));
      tx.oncomplete = () => resolve(req.result);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export const saveClip = (clip) => access("readwrite", (s) => s.put(clip));
export const clipIds = () => access("readonly", (s) => s.getAllKeys());
export async function loadClip(id) {
  if (id === "demo") {
    const result = await fetch("./recordings/rink.json");
    if (!result.ok) throw Error("Rink recording unavailable");
    return result.json();
  }
  return access("readonly", (s) => s.get(id));
}
