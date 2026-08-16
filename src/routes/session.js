import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db, nowISO } from '../db.js';
import { cardById } from '../tarot/deck.js';
import { drawSpread, chooseSpread, newSeed } from '../tarot/draw.js';
import { analyzeQuestion } from '../llm/analyze.js';
import { interpret, chooseTone } from '../llm/interpret.js';
import { resolveNivel, NIVELES, NIVEL_DEFAULT } from '../llm/client.js';
import { costOf, sumCosts, totals } from '../llm/pricing.js';
import { detectCrisis, logSafetyEvent, crisisResponse } from '../safety/crisis.js';
import { relevantHistory, readingCount } from '../memory/retrieve.js';
import { pickMode } from '../memory/continuity.js';
import { getProfile, needsRefresh, refreshProfile } from '../memory/profile.js';
import { RETENTION_DAYS } from '../retention.js';

export const router = Router();

const MAX_LEN = 600;

function getSession(id) {
  return db
    .prepare('SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL')
    .get(id) ?? null;
}

function serializeCards(cards) {
  return cards.map((c) => ({
    posicion: c.position,
    slot: c.slot,
    carta: {
      id: c.card.id,
      nombre: c.card.nombre,
      arcano: c.card.arcano,
      palo: c.card.palo,
      numero: c.card.numero,
    },
    invertida: c.reversed,
  }));
}

// POST /session
router.post('/session', (req, res) => {
  const id = randomUUID();
  const ts = nowISO();
  const tone = ['auto', 'directo', 'poetico'].includes(req.body?.tono) ? req.body.tono : 'auto';
  db.prepare(
    'INSERT INTO sessions (id, created_at, last_seen_at, tone) VALUES (?, ?, ?, ?)',
  ).run(id, ts, ts, tone);

  res.status(201).json({
    session_id: id,
    creada: ts,
    tono: tone,
    retencion_dias: RETENTION_DAYS,
    aviso:
      `Guardamos tus preguntas y tiradas ligadas a este session_id durante ${RETENTION_DAYS} días ` +
      'de inactividad, para dar continuidad entre lecturas. No hay cuenta ni identidad detrás: ' +
      'si pierdes el session_id, el historial no es recuperable. Puedes borrarlo cuando quieras ' +
      'con DELETE /session/:id.',
  });
});

// POST /session/:id/ask
router.post('/session/:id/ask', async (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'sesion_no_encontrada' });

  const question = typeof req.body?.pregunta === 'string' ? req.body.pregunta.trim() : '';
  if (!question) return res.status(400).json({ error: 'pregunta_requerida' });
  if (question.length > MAX_LEN) {
    return res.status(400).json({ error: 'pregunta_muy_larga', maximo: MAX_LEN });
  }

  const nivel = req.body?.nivel ?? NIVEL_DEFAULT;
  if (!NIVELES[nivel]) {
    return res.status(400).json({ error: 'nivel_invalido', validos: Object.keys(NIVELES) });
  }
  const modelos = resolveNivel(nivel);

  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(nowISO(), session.id);

  // --- Gate de seguridad, capa 1: determinística, antes de gastar un token.
  const rule = detectCrisis(question);
  if (rule.crisis) {
    logSafetyEvent({ sessionId: session.id, source: rule.source, severity: rule.severity });
    return res.status(200).json(crisisResponse());
  }

  // --- Etapa 1: análisis estructurado.
  const meta = await analyzeQuestion(question, { model: modelos.analysis });

  // --- Gate de seguridad, capa 2: el modelo como segunda red.
  if (meta.riesgo === 'crisis') {
    logSafetyEvent({ sessionId: session.id, source: 'modelo', severity: 'alta' });
    return res.status(200).json(crisisResponse());
  }

  // --- Lógica determinística entre las dos llamadas.
  const spread = chooseSpread(meta);
  const seed = newSeed();
  const draw = drawSpread({ spread, seed });
  const tone = chooseTone(meta, session.tone);

  const history = relevantHistory(session.id, meta);
  const total = readingCount(session.id);
  const lastMode = db
    .prepare(
      `SELECT value FROM reading_meta
        WHERE key = 'modo_continuidad'
          AND reading_id IN (SELECT id FROM readings WHERE session_id = ? ORDER BY created_at DESC LIMIT 1)`,
    )
    .get(session.id)?.value ?? null;

  const mode = pickMode({
    seed,
    historyCount: total,
    recurrentCards: history.cartas_recurrentes,
    lastMode,
  });

  const profile = getProfile(session.id)?.summary ?? null;

  // --- Etapa 2: interpretación.
  let interpretation;
  let usoInterpret = null;
  try {
    const out = await interpret({
      question, draw, meta, tone, history, profile, mode, cardById, model: modelos.interpret,
    });
    interpretation = out.text;
    usoInterpret = out.usage;
  } catch (err) {
    if (err.code === 'REFUSAL') {
      return res.status(200).json({
        tipo: 'sin_lectura',
        mensaje: 'No puedo dar una lectura sobre esto. Probá reformular la pregunta.',
      });
    }
    console.error('[ask] interpretación falló:', err.message);
    return res.status(502).json({ error: 'interpretacion_no_disponible' });
  }

  // --- Consumo real de las dos etapas. Se guardan tokens crudos (no envejecen)
  // junto al modelo que los produjo; el costo se estima con la tabla de precios
  // y se puede recalcular sobre el histórico si los precios cambian.
  const uso = {
    analisis: {
      modelo: meta._model ?? null,
      ...totals(meta._usage),
      costo_usd: costOf(meta._model, meta._usage),
    },
    interpretacion: {
      modelo: modelos.interpret,
      ...totals(usoInterpret),
      costo_usd: costOf(modelos.interpret, usoInterpret),
    },
  };
  uso.costo_usd = sumCosts(uso.analisis.costo_usd, uso.interpretacion.costo_usd);

  // --- Persistencia.
  const readingId = randomUUID();
  const createdAt = nowISO();
  const persist = db.transaction(() => {
    db.prepare(
      `INSERT INTO readings (id, session_id, created_at, question, spread, seed, interpretation)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(readingId, session.id, createdAt, question, draw.spread, draw.seed, interpretation);

    const insCard = db.prepare(
      'INSERT INTO reading_cards (reading_id, position, slot, card_id, reversed) VALUES (?, ?, ?, ?, ?)',
    );
    for (const c of draw.cards) {
      insCard.run(readingId, c.position, c.slot, c.card.id, c.reversed ? 1 : 0);
    }

    const insMeta = db.prepare(
      'INSERT INTO reading_meta (reading_id, key, value) VALUES (?, ?, ?)',
    );
    for (const [k, v] of Object.entries(meta)) {
      if (k.startsWith('_')) continue;
      insMeta.run(readingId, k, String(v));
    }
    insMeta.run(readingId, 'modo_continuidad', mode.id);
    insMeta.run(readingId, 'tono', tone);

    for (const [etapa, u] of [['analisis', uso.analisis], ['interpretacion', uso.interpretacion]]) {
      if (u.modelo) insMeta.run(readingId, `modelo_${etapa}`, u.modelo);
      insMeta.run(readingId, `tokens_in_${etapa}`, String(u.in));
      insMeta.run(readingId, `tokens_out_${etapa}`, String(u.out));
      if (u.cache_read) insMeta.run(readingId, `cache_read_${etapa}`, String(u.cache_read));
      if (u.cache_write) insMeta.run(readingId, `cache_write_${etapa}`, String(u.cache_write));
    }
    if (uso.costo_usd !== null) insMeta.run(readingId, 'costo_usd', uso.costo_usd.toFixed(6));
  });
  persist();

  res.json({
    nivel,
    tipo: 'lectura',
    reading_id: readingId,
    fecha: createdAt,
    pregunta: question,
    tirada: { tipo: draw.spread, cartas: serializeCards(draw.cards) },
    interpretacion: interpretation,
    // Presentación: el cliente decide cómo pintar esto. La API no manda colores.
    render: { tono: tone, continuidad: mode.id },
    uso,
  });

  // Fuera del camino crítico.
  if (needsRefresh(session.id, total + 1)) {
    refreshProfile(session.id, { model: modelos.profile }).catch((e) => console.error('[profile]', e.message));
  }
});

// GET /session/:id/history
router.get('/session/:id/history', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'sesion_no_encontrada' });

  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const rows = db
    .prepare(
      `SELECT id, created_at, question, spread, interpretation
         FROM readings WHERE session_id = ?
        ORDER BY created_at DESC LIMIT ?`,
    )
    .all(session.id, limit);

  const cardsStmt = db.prepare(
    'SELECT position, slot, card_id, reversed FROM reading_cards WHERE reading_id = ? ORDER BY position',
  );

  const costoAcumulado = db
    .prepare(
      `SELECT SUM(CAST(m.value AS REAL)) AS total
         FROM reading_meta m JOIN readings r ON r.id = m.reading_id
        WHERE r.session_id = ? AND m.key = 'costo_usd'`,
    )
    .get(session.id).total;

  res.json({
    session_id: session.id,
    total: readingCount(session.id),
    costo_acumulado_usd: costoAcumulado ?? 0,
    lecturas: rows.map((r) => ({
      reading_id: r.id,
      fecha: r.created_at,
      pregunta: r.question,
      tirada: {
        tipo: r.spread,
        cartas: cardsStmt.all(r.id).map((c) => {
          const card = cardById(c.card_id);
          return {
            posicion: c.position,
            slot: c.slot,
            carta: {
              id: c.card_id,
              nombre: card?.nombre ?? c.card_id,
              arcano: card?.arcano ?? null,
              palo: card?.palo ?? null,
              numero: card?.numero ?? null,
            },
            invertida: !!c.reversed,
          };
        }),
      },
      interpretacion: r.interpretation,
    })),
  });
});

// DELETE /session/:id — borrado real, no soft-delete.
router.delete('/session/:id', (req, res) => {
  const info = db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'sesion_no_encontrada' });
  res.json({ borrado: true, session_id: req.params.id });
});
