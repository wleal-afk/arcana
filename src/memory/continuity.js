import { createHash } from 'node:crypto';

/**
 * Antídoto contra "la última vez preguntaste sobre X".
 *
 * El problema de la memoria en un producto así no es recuperar el historial;
 * es que el modelo siempre lo use de la misma forma. La solución no es pedirle
 * "varía" (no es fiable): es elegir en código UN modo de continuidad por lectura
 * y dejar los demás fuera del prompt. El modelo no puede caer en el default
 * porque nunca ve el menú completo.
 *
 * La elección es determinística (hash de la lectura) y rota: dos lecturas
 * seguidas no pueden usar el mismo modo.
 */
export const MODOS = {
  silencio: {
    id: 'silencio',
    instruccion:
      'No menciones lecturas anteriores. El contexto previo es sólo para que entiendas ' +
      'dónde está parada la persona; no lo cites, no lo resumas, no lo enumeres.',
  },
  eco_de_carta: {
    id: 'eco_de_carta',
    instruccion:
      'Si alguna carta de esta tirada ya apareció antes, señálalo una sola vez y en una ' +
      'frase, sin explicar el historial completo. No abras la lectura con eso.',
  },
  contraste: {
    id: 'contraste',
    instruccion:
      'Marca en qué se diferencia esta pregunta de las anteriores: qué se movió, qué ' +
      'sigue igual. Una observación breve, integrada en el cuerpo de la lectura.',
  },
  pregunta_debajo: {
    id: 'pregunta_debajo',
    instruccion:
      'Nombra —sin recitar el historial— la pregunta de fondo que se repite bajo las ' +
      'distintas formulaciones. Hazlo como observación, no como diagnóstico.',
  },
  continuacion: {
    id: 'continuacion',
    instruccion:
      'Trata esta lectura como el siguiente capítulo de la anterior: retoma el hilo sin ' +
      'volver a presentarlo. Nunca empieces con una fórmula del tipo "la última vez preguntaste".',
  },
};

const ORDEN = ['silencio', 'eco_de_carta', 'contraste', 'pregunta_debajo', 'continuacion'];

export function pickMode({ seed, historyCount, recurrentCards = [], lastMode = null }) {
  if (historyCount === 0) return MODOS.silencio;

  let candidatos = ORDEN.filter((m) => m !== lastMode);

  // Con poco historial, contrastar o buscar "la pregunta de fondo" es inventar.
  if (historyCount < 2) candidatos = candidatos.filter((m) => m !== 'pregunta_debajo' && m !== 'contraste');
  // Sin cartas repetidas no hay eco posible.
  if (recurrentCards.length === 0) candidatos = candidatos.filter((m) => m !== 'eco_de_carta');
  if (candidatos.length === 0) candidatos = ['silencio'];

  const h = createHash('sha256').update(String(seed)).digest();
  return MODOS[candidatos[h[0] % candidatos.length]];
}
