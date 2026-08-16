import { test } from 'node:test';
import assert from 'node:assert/strict';

const { NIVELES, resolveNivel } = await import('../src/llm/client.js');

test('los tres niveles existen y sólo cambia la interpretación', () => {
  assert.deepEqual(Object.keys(NIVELES).sort(), ['alta', 'baja', 'media']);
  assert.equal(NIVELES.alta.interpret, 'claude-opus-5');
  assert.equal(NIVELES.media.interpret, 'claude-sonnet-5');
  assert.equal(NIVELES.baja.interpret, 'claude-haiku-4-5');
  // El análisis es Haiku en los tres: genera ~77 tokens, subirlo no paga.
  for (const n of Object.values(NIVELES)) {
    assert.equal(n.analysis, 'claude-haiku-4-5');
    assert.equal(n.profile, 'claude-haiku-4-5');
  }
});

test('resolveNivel cae al default con entradas inválidas', () => {
  assert.equal(resolveNivel('media').interpret, 'claude-sonnet-5');
  assert.equal(resolveNivel('inventado').interpret, NIVELES.alta.interpret);
  assert.equal(resolveNivel(undefined).interpret, NIVELES.alta.interpret);
  assert.equal(resolveNivel(null).interpret, NIVELES.alta.interpret);
});

test('todos los modelos de los presets tienen precio conocido', async () => {
  const { PRECIOS } = await import('../src/llm/pricing.js');
  for (const preset of Object.values(NIVELES)) {
    for (const model of Object.values(preset)) {
      assert.ok(PRECIOS[model], `falta precio para ${model}`);
    }
  }
});

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ARCANA_DB = join(mkdtempSync(join(tmpdir(), 'arcana-nivel-')), 'test.db');
const { createApp } = await import('../src/server.js');

test('el nivel inválido se rechaza antes de gastar un token', async () => {
  const app = createApp();
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  try {
    const s = await (await fetch(`${base}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })).json();

    const res = await fetch(`${base}/session/${s.session_id}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pregunta: '¿y ahora?', nivel: 'ultra' }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'nivel_invalido');
  } finally {
    server.close();
  }
});
