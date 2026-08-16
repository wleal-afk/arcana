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
