import { randomInt } from 'node:crypto';

/**
 * Códigos de invitación tecleables por humanos.
 *
 * Alfabeto sin confusables (sin 0/O, 1/I/L): la abuela lo va a tipear desde un
 * papelito. 8 caracteres sobre 31 símbolos ≈ 2^39,6 combinaciones; con el
 * throttling del endpoint de unión, adivinar un código activo por fuerza bruta
 * queda fuera de alcance práctico. El código además solo sirve para UNIRSE a
 * una familia (acción visible para todos sus integrantes), no para leer datos.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 8;

export function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

/**
 * Normaliza lo que tipeó el usuario: mayúsculas, sin espacios ni guiones (la
 * UI muestra el código como XXXX-XXXX para que sea fácil de dictar).
 */
export function normalizeInviteCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Presentación con guion al medio: más fácil de leer por teléfono. */
export function formatInviteCode(code: string): string {
  return code.length === INVITE_CODE_LENGTH
    ? `${code.slice(0, 4)}-${code.slice(4)}`
    : code;
}
