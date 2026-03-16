import { randomInt } from 'crypto';

export function generateRandomToken(length = 6): string {
  // Por seguridad, no dejar que pidan algo exagerado
  if (length < 1 || length > 15) {
    throw new Error('generateRandomToken length must be between 1 and 15');
  }

  const max = 10 ** length; // para 6 → 1 000 000
  const num = randomInt(0, max); // 0 <= num < 10^length
  // Asegura que siempre tenga exactamente "length" dígitos (con ceros a la izquierda)
  return num.toString().padStart(length, '0');
}
