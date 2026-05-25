import CryptoJS from 'crypto-js';

// ---------------------------------------------------------------------------
// Client-side AES encryption for localStorage & sessionStorage.
//
// Keys and values are both encrypted so the Storage panel shows only opaque
// ciphertext. When a signage/editor iframe blocks Web Storage, this module
// falls back to in-memory storage instead of crashing the app during import.
//
// Set VITE_SECURE_STORAGE_KEY at build time to use a project-specific key.
// ---------------------------------------------------------------------------

const STORAGE_SECRET = import.meta.env.VITE_SECURE_STORAGE_KEY || 'aqm-insecure-fallback-key';

if (!import.meta.env.VITE_SECURE_STORAGE_KEY && import.meta.env.PROD) {
  console.warn('[secureStorage] VITE_SECURE_STORAGE_KEY is not set. Storage will be obscured, but not hardened for production.');
}

function createMemoryStorage() {
  const data = new Map();
  return {
    get length() {
      return data.size;
    },
    key(index) {
      return Array.from(data.keys())[index] ?? null;
    },
    getItem(key) {
      const k = String(key);
      return data.has(k) ? data.get(k) : null;
    },
    setItem(key, value) {
      data.set(String(key), String(value));
    },
    removeItem(key) {
      data.delete(String(key));
    },
    clear() {
      data.clear();
    },
  };
}

function resolveBrowserStorage(name, fallback) {
  try {
    if (typeof window === 'undefined') return fallback;
    const store = window[name];
    const probe = `__aqm_storage_probe__${Date.now()}`;
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return fallback;
  }
}

function getRawAccess(store) {
  const proto = Object.getPrototypeOf(store);
  return {
    setItem: proto?.setItem ?? store.setItem,
    getItem: proto?.getItem ?? store.getItem,
    removeItem: proto?.removeItem ?? store.removeItem,
    clear: proto?.clear ?? store.clear,
    key: proto?.key ?? store.key,
  };
}

function isWindowStorage(name, store) {
  try {
    return typeof window !== 'undefined' && window[name] === store;
  } catch {
    return false;
  }
}

const LOCAL_STORAGE = resolveBrowserStorage('localStorage', createMemoryStorage());
const SESSION_STORAGE = resolveBrowserStorage('sessionStorage', createMemoryStorage());
const LOCAL_RAW = getRawAccess(LOCAL_STORAGE);
const SESSION_RAW = getRawAccess(SESSION_STORAGE);

function getScopedSecret(scope) {
  return CryptoJS.HmacSHA256(String(scope), STORAGE_SECRET).toString();
}

function encryptString(plain, secret) {
  try {
    return CryptoJS.AES.encrypt(String(plain), secret).toString();
  } catch {
    return plain;
  }
}

function decryptString(cipher, secret) {
  if (cipher == null) return null;
  try {
    const bytes = CryptoJS.AES.decrypt(cipher, secret);
    const out = bytes.toString(CryptoJS.enc.Utf8);
    return out || null;
  } catch {
    return null;
  }
}

function hashKey(key, secret) {
  return CryptoJS.HmacSHA256(String(key), secret).toString();
}

function migrateStore(store, raw, secret) {
  try {
    const len = store.length;
    const toRemove = [];
    const toSet = [];
    for (let i = 0; i < len; i += 1) {
      const rawKey = raw.key.call(store, i);
      if (!rawKey) continue;
      if (/^[0-9a-f]{64}$/i.test(rawKey)) continue;
      const rawVal = raw.getItem.call(store, rawKey);
      toRemove.push(rawKey);
      toSet.push({ k: rawKey, v: rawVal });
    }
    for (const { k, v } of toSet) {
      raw.setItem.call(store, hashKey(k, secret), encryptString(v ?? '', secret));
    }
    for (const k of toRemove) {
      raw.removeItem.call(store, k);
    }
  } catch {
    /* migration is best-effort */
  }
}

function makeSecureStore(store, raw, scope) {
  const secret = getScopedSecret(scope);

  return {
    setItem(key, value) {
      try {
        const v = typeof value === 'string' ? value : JSON.stringify(value);
        raw.setItem.call(store, hashKey(key, secret), encryptString(v, secret));
      } catch {}
    },
    getItem(key) {
      try {
        const enc = raw.getItem.call(store, hashKey(key, secret));
        if (enc == null) return null;
        return decryptString(enc, secret);
      } catch {
        return null;
      }
    },
    setJSON(key, obj) {
      this.setItem(key, JSON.stringify(obj));
    },
    getJSON(key) {
      const rawValue = this.getItem(key);
      if (!rawValue) return null;
      try {
        return JSON.parse(rawValue);
      } catch {
        return null;
      }
    },
    removeItem(key) {
      try {
        raw.removeItem.call(store, hashKey(key, secret));
      } catch {}
    },
    clear() {
      try {
        raw.clear.call(store);
      } catch {}
    },
  };
}

export const secureStorage = makeSecureStore(LOCAL_STORAGE, LOCAL_RAW, 'local');
export const secureSession = makeSecureStore(SESSION_STORAGE, SESSION_RAW, 'session');

function resolveSecureStore(store) {
  return store === SESSION_STORAGE ? secureSession : secureStorage;
}

function patchGlobalStorage() {
  try {
    if (!isWindowStorage('localStorage', LOCAL_STORAGE)) return;
    const storageProto = Object.getPrototypeOf(LOCAL_STORAGE);
    storageProto.setItem = function (key, value) {
      resolveSecureStore(this).setItem(key, value);
    };
    storageProto.getItem = function (key) {
      return resolveSecureStore(this).getItem(key);
    };
    storageProto.removeItem = function (key) {
      resolveSecureStore(this).removeItem(key);
    };
    storageProto.clear = function () {
      resolveSecureStore(this).clear();
    };
    storageProto.key = function (idx) {
      return (this === SESSION_STORAGE ? SESSION_RAW : LOCAL_RAW).key.call(this, idx);
    };
  } catch {
    /* environments without writable prototypes: just skip */
  }
}

migrateStore(LOCAL_STORAGE, LOCAL_RAW, getScopedSecret('local'));
migrateStore(SESSION_STORAGE, SESSION_RAW, getScopedSecret('session'));
patchGlobalStorage();
