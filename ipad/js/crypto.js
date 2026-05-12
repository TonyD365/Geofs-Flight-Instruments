// AES-GCM encrypted envelope over a shared passphrase.
// The same module is consumed by the iPad page and (via @require equivalent
// inline copy) by the Tampermonkey userscript.

const SALT = new TextEncoder().encode('geofs-instruments-v1');
const PBKDF2_ROUNDS = 100_000;
const IV_LEN = 12;

function b64encode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64decode(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function deriveKey(passphrase) {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase),
    'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: SALT, iterations: PBKDF2_ROUNDS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function roomIdFrom(passphrase) {
  const h = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode('room:' + passphrase),
  );
  const bytes = new Uint8Array(h).slice(0, 6);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function encryptJson(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const plaintext = new TextEncoder().encode(JSON.stringify(obj));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, plaintext,
  );
  const cipherBytes = new Uint8Array(cipher);
  const out = new Uint8Array(IV_LEN + cipherBytes.length);
  out.set(iv, 0);
  out.set(cipherBytes, IV_LEN);
  return b64encode(out);
}

export async function decryptJson(key, b64) {
  try {
    const bytes = b64decode(b64);
    const iv = bytes.slice(0, IV_LEN);
    const cipher = bytes.slice(IV_LEN);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv }, key, cipher,
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch (_) {
    return null; // wrong key or tampered — fall through silently
  }
}
