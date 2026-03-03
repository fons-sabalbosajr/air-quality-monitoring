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

const PASSPHRASE =
  import.meta.env.VITE_SECURE_STORAGE_KEY || 'aqm-insecure-fallback-key';

/* ---------- Primitives -------------------------------------------------- */

function encryptString(plain) {
  try {
    return CryptoJS.AES.encrypt(String(plain), PASSPHRASE).toString();
  } catch {
    return plain;
  }
}

function decryptString(cipher) {
  if (cipher == null) return null;
  try {
    const bytes = CryptoJS.AES.decrypt(cipher, PASSPHRASE);
    const out = bytes.toString(CryptoJS.enc.Utf8);
    return out || null;
  } catch {
    return null;
  }
}

/** Deterministic hash of a key so the same logical key always maps to the
 *  same opaque storage key, but is not reversible in the DevTools panel. */
function hashKey(key) {
  return CryptoJS.HmacSHA256(String(key), PASSPHRASE).toString();
}

/* ---------- Migrate any old plain-text entries -------------------------- */

function migrateStore(store) {
  try {
    const len = store.length;
    const toRemove = [];
    const toSet = [];
    for (let i = 0; i < len; i++) {
      const rawKey = store.key(i);
      if (!rawKey) continue;
      // Hashed keys are 64-char hex strings; anything else is legacy
      if (/^[0-9a-f]{64}$/i.test(rawKey)) continue;
      const rawVal = store.getItem(rawKey);
      toRemove.push(rawKey);
      toSet.push({ k: rawKey, v: rawVal });
    }
    // Use the *original* methods (before patching) via __aqm_raw_*
    const rawSet =
      store.__aqm_raw_setItem ||
      Object.getPrototypeOf(store).setItem.bind(store);
    const rawRemove =
      store.__aqm_raw_removeItem ||
      Object.getPrototypeOf(store).removeItem.bind(store);
    for (const { k, v } of toSet) {
      rawSet(hashKey(k), encryptString(v ?? ''));
    }
    for (const k of toRemove) {
      rawRemove(k);
    }
  } catch {
    /* migration is best-effort */
  }
}

/* ---------- Build a secure wrapper around a native store ---------------- */

function makeSecureStore(store) {
  // Keep pristine references to the native methods
  const proto = Object.getPrototypeOf(store);
  const _setItem = proto.setItem.bind(store);
  const _getItem = proto.getItem.bind(store);
  const _removeItem = proto.removeItem.bind(store);
  const _clear = proto.clear.bind(store);
  const _key = proto.key.bind(store);

  // Expose raw methods for migration helper
  store.__aqm_raw_setItem = _setItem;
  store.__aqm_raw_removeItem = _removeItem;

  return {
    setItem(key, value) {
      try {
        const v = typeof value === 'string' ? value : JSON.stringify(value);
        _setItem(hashKey(key), encryptString(v));
      } catch {}
    },
    getItem(key) {
      try {
        const enc = _getItem(hashKey(key));
        if (enc == null) return null;
        return decryptString(enc);
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
        _removeItem(hashKey(key));
      } catch {}
    },
    clear() {
      try {
        _clear();
      } catch {}
    },

    /* ---- Global monkey-patch ----------------------------------------- */
    /** Replace the native setItem / getItem / removeItem so that ANY code
     *  (including third-party libs) automatically gets encryption. */
    patchGlobal() {
      try {
        const secure = this;
        proto.setItem = function (k, v) {
          secure.setItem(k, v);
        };
        proto.getItem = function (k) {
          return secure.getItem(k);
        };
        proto.removeItem = function (k) {
          secure.removeItem(k);
        };
        proto.clear = function () {
          secure.clear();
        };
        // key() is not very useful once keys are hashed, but keep it
        // functional by returning the hashed key as-is.
        proto.key = function (idx) {
          return _key(idx);
        };
      } catch {
        /* environments without writable prototypes – just skip */
      }
    },
  };
}

/* ---------- Exports ------------------------------------------------------ */

export const secureStorage = makeSecureStore(localStorage);
export const secureSession = makeSecureStore(sessionStorage);

// Migrate any existing plain-text entries, then patch globally
migrateStore(localStorage);
migrateStore(sessionStorage);
secureStorage.patchGlobal();
secureSession.patchGlobal();
