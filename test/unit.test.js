import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ARCANA_DB = join(mkdtempSync(join(tmpdir(), 'arcana-')), 'test.db');

const { DECK, cardById } = await import('../src/tarot/deck.js');
const { drawSpread, chooseSpread } = await import('../src/tarot/draw.js');
const { detectCrisis } = await import('../src/safety/crisis.js');
const { pickMode, MODOS } = await import('../src/memory/continuity.js');
const { chooseTone } = await import('../src/llm/interpret.js');
const { createApp } = await import('../src/server.js');

test('el mazo tiene 78 cartas con ids únicos', () => {
  assert.equal(DECK.length, 78);
  assert.equal(new Set(DECK.map((c) => c.id)).size, 78);
  assert.equal(DECK.filter((c) => c.arcano === 'mayor').length, 22);
  assert.ok(cardById('mayor-13-la-muerte'));
});

test('la tirada es determinística por semilla y sin cartas repetidas', () => {
  const a = drawSpread({ spread: 'cruz', seed: 'semilla-fija' });
  const b = drawSpread({ spread: 'cruz', seed: 'semilla-fija' });
  assert.deepEqual(
    a.cards.map((c) => [c.card.id, c.reversed]),
    b.cards.map((c) => [c.card.id, c.reversed]),
  );
  assert.equal(new Set(a.cards.map((c) => c.card.id)).size, 5);

  const c = drawSpread({ spread: 'cruz', seed: 'otra-semilla' });
  assert.notDeepEqual(a.cards.map((x) => x.card.id), c.cards.map((x) => x.card.id));
});

test('la tirada se elige por señal, no al azar', () => {
  assert.equal(chooseSpread({ intensidad_emocional: 'alta', especificidad: 'concreta' }), 'unica');
  assert.equal(chooseSpread({ busqueda: 'certeza', tension_temporal: 'decision' }), 'cruz');
  assert.equal(chooseSpread({}), 'tres');
});

test('el gate de crisis detecta señales explícitas', () => {
  for (const q of [
    'ya no quiero vivir, ¿qué me dicen las cartas?',
    'estoy pensando en quitarme la vida',
    '¿debería cortarme otra vez?',
    'I want to die',
    'me quiero matar',
  ]) {
    assert.equal(detectCrisis(q).crisis, true, `no detectó: ${q}`);
  }
});

test('el gate no se dispara con lenguaje idiomático ni preguntas normales', () => {
  for (const q of [
    'me quiero morir de risa con lo que pasó ayer',
    '¿debería dejar mi trabajo?',
    'la relación está muerta, ¿tiene sentido seguir?',
    '¿voy a superar este duelo?',
  ]) {
    assert.equal(detectCrisis(q).crisis, false, `falso positivo: ${q}`);
  }
});

test('el modo de continuidad nunca repite el anterior y respeta precondiciones', () => {
  assert.equal(pickMode({ seed: 'x', historyCount: 0 }).id, 'silencio');

  for (let i = 0; i < 50; i++) {
    const m = pickMode({
      seed: `s${i}`,
      historyCount: 5,
      recurrentCards: [],
      lastMode: 'contraste',
    });
    assert.notEqual(m.id, 'contraste');
    assert.notEqual(m.id, 'eco_de_carta', 'no puede haber eco sin cartas repetidas');
    assert.ok(MODOS[m.id]);
  }
});

test('el tono se deriva de la metadata pero la preferencia manda', () => {
  assert.equal(chooseTone({ busqueda: 'certeza' }), 'directo');
  assert.equal(chooseTone({ intensidad_emocional: 'alta' }), 'poetico');
  assert.equal(chooseTone({ busqueda: 'certeza' }, 'poetico'), 'poetico');
});

test('ciclo de sesión sobre HTTP (sin llamar al modelo)', async () => {
  const app = createApp();
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  try {
    const created = await (await fetch(`${base}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tono: 'directo' }),
    })).json();
    assert.ok(created.session_id);
    assert.equal(created.tono, 'directo');
    assert.ok(created.aviso.includes('días'));

    const hist = await (await fetch(`${base}/session/${created.session_id}/history`)).json();
    assert.equal(hist.total, 0);

    // El gate de crisis responde sin tocar el modelo.
    const crisis = await (await fetch(`${base}/session/${created.session_id}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pregunta: 'ya no quiero vivir' }),
    })).json();
    assert.equal(crisis.tipo, 'apoyo');
    assert.ok(crisis.recursos.length > 0);
    assert.equal(crisis.interpretacion, undefined);

    const del = await fetch(`${base}/session/${created.session_id}`, { method: 'DELETE' });
    assert.equal(del.status, 200);

    const gone = await fetch(`${base}/session/${created.session_id}/history`);
    assert.equal(gone.status, 404);
  } finally {
    server.close();
  }
});
