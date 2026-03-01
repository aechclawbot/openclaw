/**
 * OASIS Dashboard v3 - File Mutex Utility
 * Promise-based per-key mutex to prevent concurrent file write corruption.
 */

const mutexMap = new Map();

/**
 * Run `fn` exclusively for the given key.
 * Concurrent calls with the same key are serialized; different keys run concurrently.
 *
 * @param {string} key   Mutex key (e.g. a file path)
 * @param {() => Promise<any>} fn  Async function to execute exclusively
 * @returns {Promise<any>} Result of fn()
 */
export function withMutex(key, fn) {
  const prev = mutexMap.get(key) || Promise.resolve();
  let release;
  const next = new Promise((r) => { release = r; });
  mutexMap.set(key, next);
  return prev.then(() => fn().finally(release));
}
