import CryptoJS from 'crypto-js';

// WARNING: Client-side encryption protects against casual inspection only.
// Anyone running dev tools can access the key. Use server-side storage for
// truly sensitive data. Rotate and set VITE_SECURE_STORAGE_KEY at build time.
const PASSPHRASE = import.meta.env.VITE_SECURE_STORAGE_KEY || 'aqm-insecure-fallback-key';

function encryptString(plain) {
  try {
    return CryptoJS.AES.encrypt(plain, PASSPHRASE).toString();
  } catch {
    return plain; // fallback (unencrypted) if encryption fails
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

export const secureStorage = {
  setItem(key, value) {
    try {
      const v = typeof value === 'string' ? value : JSON.stringify(value);
      const enc = encryptString(v);
      localStorage.setItem(key, enc);
    } catch {}
  },
  getItem(key) {
    try {
      const enc = localStorage.getItem(key);
      if (enc == null) return null;
      const dec = decryptString(enc);
      return dec;
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
    try { return JSON.parse(raw); } catch { return null; }
  },
  removeItem(key) { try { localStorage.removeItem(key); } catch {} },
  clear() { try { localStorage.clear(); } catch {} }
};

// Optional: Monkey-patch for automatic encryption of future direct localStorage usage.
// Commented out to avoid surprising behavior. Uncomment if desired.
// const originalSet = localStorage.setItem.bind(localStorage);
// localStorage.setItem = (k, v) => originalSet(k, encryptString(typeof v === 'string' ? v : JSON.stringify(v)));
// const originalGet = localStorage.getItem.bind(localStorage);
// localStorage.getItem = (k) => decryptString(originalGet(k));
