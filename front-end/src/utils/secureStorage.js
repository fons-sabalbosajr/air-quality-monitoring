import CryptoJS from 'crypto-js';

// ---------------------------------------------------------------------------
// Client-side AES encryption for localStorage & sessionStorage.
//
// • Keys and values are both encrypted so the Storage panel shows only
//   opaque ciphertext — nothing is human-readable.
// • A global monkey-patch intercepts ALL calls to localStorage /
//   sessionStorage (including from third-party libs like Ant Design)
//   so they are transparently encrypted & decrypted.
//
// Set VITE_SECURE_STORAGE_KEY at build time to use a project-specific key.
// ---------------------------------------------------------------------------

const STORAGE_SECRET = import.meta.env.VITE_SECURE_STORAGE_KEY || 'aqm-insecure-fallback-key';

if (!import.meta.env.VITE_SECURE_STORAGE_KEY && import.meta.env.PROD) {
  console.warn('[secureStorage] VITE_SECURE_STORAGE_KEY is not set. Storage will be obscured, but not hardened for production.');
}

const STORAGE_PROTO = Object.getPrototypeOf(localStorage);
const RAW_SET_ITEM = STORAGE_PROTO.setItem;
const RAW_GET_ITEM = STORAGE_PROTO.getItem;
const RAW_REMOVE_ITEM = STORAGE_PROTO.removeItem;
const RAW_CLEAR = STORAGE_PROTO.clear;
const RAW_KEY = STORAGE_PROTO.key;

function getScopedSecret(scope) {
  return CryptoJS.HmacSHA256(String(scope), STORAGE_SECRET).toString();
}

/* ---------- Primitives -------------------------------------------------- */

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

/** Deterministic hash of a key so the same logical key always maps to the
 *  same opaque storage key, but is not reversible in the DevTools panel. */
function hashKey(key, secret) {
  return CryptoJS.HmacSHA256(String(key), secret).toString();
}

/* ---------- Migrate any old plain-text entries -------------------------- */

function migrateStore(store, secret) {
  try {
    const len = store.length;
    const toRemove = [];
    const toSet = [];
    for (let i = 0; i < len; i++) {
      const rawKey = store.key(i);
      if (!rawKey) continue;
      // Hashed keys are 64-char hex strings; anything else is legacy
      if (/^[0-9a-f]{64}$/i.test(rawKey)) continue;
      const rawVal = RAW_GET_ITEM.call(store, rawKey);
      toRemove.push(rawKey);
      toSet.push({ k: rawKey, v: rawVal });
    }
    for (const { k, v } of toSet) {
      RAW_SET_ITEM.call(store, hashKey(k, secret), encryptString(v ?? '', secret));
    }
    for (const k of toRemove) {
      RAW_REMOVE_ITEM.call(store, k);
    }
  } catch {
    /* migration is best-effort */
  }
}

/* ---------- Build a secure wrapper around a native store ---------------- */

function makeSecureStore(store) {
  const scope = store === sessionStorage ? 'session' : 'local';
  const secret = getScopedSecret(scope);

  return {
    setItem(key, value) {
      try {
        const v = typeof value === 'string' ? value : JSON.stringify(value);
        RAW_SET_ITEM.call(store, hashKey(key, secret), encryptString(v, secret));
      } catch {}
    },
    getItem(key) {
      try {
        const enc = RAW_GET_ITEM.call(store, hashKey(key, secret));
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
      const raw = this.getItem(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    removeItem(key) {
      try {
        RAW_REMOVE_ITEM.call(store, hashKey(key, secret));
      } catch {}
    },
    clear() {
      try {
        RAW_CLEAR.call(store);
      } catch {}
    },
  };
}

function resolveSecureStore(store) {
  return store === sessionStorage ? secureSession : secureStorage;
}

function patchGlobalStorage() {
  try {
    STORAGE_PROTO.setItem = function (key, value) {
      resolveSecureStore(this).setItem(key, value);
    };
    STORAGE_PROTO.getItem = function (key) {
      return resolveSecureStore(this).getItem(key);
    };
    STORAGE_PROTO.removeItem = function (key) {
      resolveSecureStore(this).removeItem(key);
    };
    STORAGE_PROTO.clear = function () {
      resolveSecureStore(this).clear();
    };
    STORAGE_PROTO.key = function (idx) {
      return RAW_KEY.call(this, idx);
    };
  } catch {
    /* environments without writable prototypes – just skip */
  }
}

/* ---------- Exports ------------------------------------------------------ */

export const secureStorage = makeSecureStore(localStorage);
export const secureSession = makeSecureStore(sessionStorage);

// Migrate any existing plain-text entries, then patch globally
migrateStore(localStorage, getScopedSecret('local'));
migrateStore(sessionStorage, getScopedSecret('session'));
patchGlobalStorage();
