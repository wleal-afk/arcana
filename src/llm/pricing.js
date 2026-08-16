/**
 * Precios de lista en USD por millón de tokens.
 *
 * ⚠️ Esta tabla es lo único de acá que envejece. Verificada contra los precios
 * publicados en 2026-08. Si un modelo no está en la tabla, el costo se reporta
 * como null en vez de inventarse un número.
 *
 * Los tokens que se guardan en reading_meta son crudos y no envejecen: si esta
 * tabla cambia, se puede recalcular el histórico entero.
 */
export const PRECIOS = {
  'claude-opus-5': { in: 5, out: 25 },
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-opus-4-7': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-fable-5': { in: 10, out: 50 },
};

// Multiplicadores de prompt caching sobre el precio de entrada.
const LECTURA_CACHE = 0.1;   // leer de caché cuesta ~10%
const ESCRITURA_CACHE = 1.25; // escribir en caché cuesta ~125% (TTL de 5 min)

/**
 * Costo estimado de una llamada, en USD. Devuelve null si no conocemos el
 * precio del modelo — es preferible a reportar un número inventado.
 */
export function costOf(model, usage) {
  const p = PRECIOS[model];
  if (!p || !usage) return null;

  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;

  return (
    (input * p.in +
      cacheRead * p.in * LECTURA_CACHE +
      cacheWrite * p.in * ESCRITURA_CACHE +
      output * p.out) /
    1_000_000
  );
}

/** Suma de costos donde los nulls no contaminan el total. */
export function sumCosts(...costs) {
  const conocidos = costs.filter((c) => typeof c === 'number');
  return conocidos.length ? conocidos.reduce((a, b) => a + b, 0) : null;
}

export function totals(usage) {
  if (!usage) return { in: 0, out: 0, cache_read: 0, cache_write: 0 };
  return {
    in: usage.input_tokens ?? 0,
    out: usage.output_tokens ?? 0,
    cache_read: usage.cache_read_input_tokens ?? 0,
    cache_write: usage.cache_creation_input_tokens ?? 0,
  };
}
