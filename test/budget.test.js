import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  nuevaBarra, descontar, restante, alcanza, lecturasRestantes, segmentos, COSTO_PROMEDIO,
} = await import('../cli/budget.js');

test('la barra arranca llena y descuenta el costo real', () => {
  let b = nuevaBarra(0.20);
  assert.equal(restante(b), 0.20);
  assert.equal(b.lecturas, 0);

  b = descontar(b, 0.029);
  assert.ok(Math.abs(restante(b) - 0.171) < 1e-9);
  assert.equal(b.lecturas, 1);
});

test('descontar no muta la barra original', () => {
  const a = nuevaBarra(0.20);
  const b = descontar(a, 0.029);
  assert.equal(restante(a), 0.20);
  assert.notEqual(a, b);
});

test('el restante nunca queda negativo', () => {
  const b = descontar(nuevaBarra(0.02), 0.05);
  assert.equal(restante(b), 0);
});

test('un costo desconocido marca la barra como indeterminada', () => {
  const b = descontar(nuevaBarra(0.20), null);
  assert.equal(b.desconocido, true);
  assert.equal(b.lecturas, 1);
  // No se resta nada: restar cero mentiría, restar un estimado inventaría.
  assert.equal(restante(b), 0.20);
});

test('alcanza compara contra el costo promedio del nivel', () => {
  const casi = descontar(nuevaBarra(0.20), 0.19);  // quedan 0.01
  assert.equal(alcanza(casi, 'alta'), false);
  assert.equal(alcanza(casi, 'media'), false);
  assert.equal(alcanza(casi, 'baja'), true);
  assert.equal(alcanza(nuevaBarra(0.20), 'alta'), true);
});

test('una barra indeterminada siempre alcanza: ya no podemos medir', () => {
  const b = descontar(nuevaBarra(0.20), null);
  assert.equal(alcanza(b, 'alta'), true);
});

test('lecturas restantes por nivel', () => {
  const b = nuevaBarra(0.20);
  assert.equal(lecturasRestantes(b, 'alta'), 6);   // 0.20 / 0.029
  assert.equal(lecturasRestantes(b, 'media'), 14); // 0.20 / 0.0142
  assert.equal(lecturasRestantes(b, 'baja'), 34);  // 0.20 / 0.0058
});

test('los segmentos reflejan la proporción restante', () => {
  assert.deepEqual(segmentos(nuevaBarra(0.20), 16), { llenos: 16, vacios: 0 });
  assert.deepEqual(segmentos(descontar(nuevaBarra(0.20), 0.10), 16), { llenos: 8, vacios: 8 });
  assert.deepEqual(segmentos(descontar(nuevaBarra(0.20), 0.20), 16), { llenos: 0, vacios: 16 });
});

test('COSTO_PROMEDIO cubre los tres niveles', () => {
  assert.deepEqual(Object.keys(COSTO_PROMEDIO).sort(), ['alta', 'baja', 'media']);
});
