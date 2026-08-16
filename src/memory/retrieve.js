import { db } from '../db.js';

const RECENTES = 8;      // ventana que se puntúa
const A_INYECTAR = 3;    // cuántas llegan al prompt

/**
 * Recupera el historial relevante para la lectura actual.
 *
 * v1 no usa embeddings: puntúa una ventana corta con señales que ya tenemos
 * guardadas (dominio, búsqueda, recencia, cartas compartidas). Es determinístico,
 * barato y explicable. El punto de extensión es `score()`: cuando exista la
 * tabla `embeddings`, se suma un término de similitud coseno y el resto queda
 * igual.
 */
export function relevantHistory(sessionId, meta, { excludeId = null } = {}) {
  const rows = db
    .prepare(
      `SELECT r.id, r.created_at, r.question, r.spread
         FROM readings r
        WHERE r.session_id = ? AND r.id IS NOT ?
        ORDER BY r.created_at DESC
        LIMIT ?`,
    )
    .all(sessionId, excludeId, RECENTES);

  if (rows.length === 0) return { lecturas: [], cartas_recurrentes: [] };

  const cardsStmt = db.prepare(
    `SELECT position, slot, card_id, reversed FROM reading_cards
      WHERE reading_id = ? ORDER BY position`,
  );
  const metaStmt = db.prepare('SELECT key, value FROM reading_meta WHERE reading_id = ?');

  const enriched = rows.map((r, idx) => {
    const cards = cardsStmt.all(r.id);
    const m = Object.fromEntries(metaStmt.all(r.id).map((x) => [x.key, x.value]));
    return { ...r, cards, meta: m, recencia: idx };
  });

  const currentCards = new Set();
  const scored = enriched
    .map((r) => ({ r, s: score(r, meta, currentCards) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, A_INYECTAR)
    .map(({ r }) => ({
      id: r.id,
      fecha: r.created_at,
      pregunta: r.question,
      dominio: r.meta.dominio ?? null,
      cartas: r.cards.map((c) => ({ card_id: c.card_id, reversed: !!c.reversed })),
    }));

  return { lecturas: scored, cartas_recurrentes: recurrentCards(sessionId) };
}

function score(reading, meta, _currentCards) {
  let s = 0;
  s += Math.max(0, 3 - reading.recencia * 0.5);                       // recencia
  if (reading.meta.dominio && reading.meta.dominio === meta.dominio) s += 3;
  if (reading.meta.busqueda === meta.busqueda) s += 1;
  if (reading.meta.tension_temporal === meta.tension_temporal) s += 0.5;
  return s;
}

/** Cartas que ya salieron 2+ veces en la sesión. Señal fuerte de continuidad. */
export function recurrentCards(sessionId, min = 2) {
  return db
    .prepare(
      `SELECT rc.card_id, COUNT(*) AS veces, MAX(r.created_at) AS ultima
         FROM reading_cards rc
         JOIN readings r ON r.id = rc.reading_id
        WHERE r.session_id = ?
        GROUP BY rc.card_id
       HAVING veces >= ?
        ORDER BY veces DESC, ultima DESC
        LIMIT 5`,
    )
    .all(sessionId, min);
}

export function readingCount(sessionId) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM readings WHERE session_id = ?')
    .get(sessionId).n;
}
