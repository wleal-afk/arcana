import { test } from 'node:test';
import assert from 'node:assert/strict';

const { cross } = await import('../cli/render/cross.js');
const { detectCaps } = await import('../cli/render/caps.js');

const CARTAS = [
  { slot: 'situacion', carta: { nombre: 'El Sol' }, invertida: false },
  { slot: 'obstaculo', carta: { nombre: 'Diez de Oros' }, invertida: false },
  { slot: 'raiz', carta: { nombre: 'Sota de Bastos' }, invertida: true },
  { slot: 'consejo', carta: { nombre: 'As de Oros' }, invertida: false },
  { slot: 'resultado', carta: { nombre: 'La Torre' }, invertida: false },
];

const LABELS = {
  situacion: 'situación', obstaculo: 'obstáculo', raiz: 'raíz',
  consejo: 'consejo', resultado: 'resultado',
};

test('la cruz coloca cada carta en su posición espacial', () => {
  const lines = cross({ cartas: CARTAS, labels: LABELS });
  const texto = lines.join('\n');

  // Las cinco cartas y sus rótulos acentuados aparecen.
  for (const c of CARTAS) assert.ok(texto.includes(c.carta.nombre), c.carta.nombre);
  for (const l of Object.values(LABELS)) assert.ok(texto.includes(l), l);

  const idx = (s) => lines.findIndex((l) => l.includes(s));
  // resultado arriba, raíz abajo, situación en el medio.
  assert.ok(idx('La Torre') < idx('El Sol'));
  assert.ok(idx('El Sol') < idx('Sota de Bastos'));
  // consejo, situación y obstáculo comparten renglón.
  assert.equal(idx('As de Oros'), idx('El Sol'));
  assert.equal(idx('El Sol'), idx('Diez de Oros'));
});

test('la cruz marca las invertidas', () => {
  const texto = cross({ cartas: CARTAS, labels: LABELS }).join('\n');
  assert.ok(/Sota de Bastos.*invertida/s.test(texto));
});

test('cross acepta un pintor y no rompe el alineado', () => {
  const plano = cross({ cartas: CARTAS, labels: LABELS });
  const pintado = cross({ cartas: CARTAS, labels: LABELS, pintar: (i) => `\x1b[31m${i.carta.nombre}\x1b[0m` });
  assert.equal(plano.length, pintado.length);
  // El ancho visible no cambia aunque se agreguen escapes ANSI.
  const visible = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').length;
  for (let i = 0; i < plano.length; i++) {
    assert.equal(visible(pintado[i]), plano[i].length);
  }
});

test('caps.wide exige ancho, unicode y tty', () => {
  assert.equal(detectCaps({ tty: true, unicode: true, width: 80 }).wide, true);
  assert.equal(detectCaps({ tty: true, unicode: true, width: 40 }).wide, false);
  assert.equal(detectCaps({ tty: true, unicode: false, width: 80 }).wide, false);
  assert.equal(detectCaps({ tty: false, unicode: true, width: 80 }).wide, false);
  // Un override explícito manda, para que --plain pueda forzarlo.
  assert.equal(detectCaps({ tty: true, unicode: true, width: 80, wide: false }).wide, false);
});
