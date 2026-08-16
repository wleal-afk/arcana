import { randomBytes, createHash } from 'node:crypto';
import { DECK, SPREADS } from './deck.js';

// RNG determinista a partir de una semilla. La semilla se guarda con la lectura,
// así que una tirada es reproducible (útil para debugging y para re-renderizar
// una lectura del historial sin volver a llamar al modelo).
function rngFromSeed(seed) {
  let h = createHash('sha256').update(seed).digest();
  let i = 0;
  return function next() {
    if (i >= h.length - 4) {
      h = createHash('sha256').update(h).digest();
      i = 0;
    }
    const v = h.readUInt32BE(i);
    i += 4;
    return v / 0x1_0000_0000;
  };
}

export function newSeed() {
  return randomBytes(16).toString('hex');
}

/**
 * Elige la tirada según la señal del análisis, con lógica determinística
 * (no le pedimos al modelo que decida el spread: es una regla de producto).
 */
export function chooseSpread(meta) {
  if (meta?.intensidad_emocional === 'alta' && meta?.especificidad === 'concreta') return 'unica';
  if (meta?.busqueda === 'certeza' && meta?.tension_temporal === 'decision') return 'cruz';
  return 'tres';
}

export function drawSpread({ spread = 'tres', seed = newSeed() } = {}) {
  const slots = SPREADS[spread] ?? SPREADS.tres;
  const rand = rngFromSeed(seed);

  // Fisher-Yates parcial: barajamos sólo lo necesario.
  const pool = DECK.slice();
  const cards = [];
  for (let i = 0; i < slots.length; i++) {
    const j = i + Math.floor(rand() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
    cards.push({
      position: i,
      slot: slots[i],
      card: pool[i],
      reversed: rand() < 0.32,
    });
  }
  return { spread, seed, cards };
}
