/** Readable initial passwords for building heads (no look-alike characters such as 0/O, 1/l). */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generatePassword(length = 10): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  // Guarantee at least one digit for weak-password checks.
  return /\d/.test(out) ? out : out.slice(0, -1) + String(2 + (bytes[0] % 8));
}
