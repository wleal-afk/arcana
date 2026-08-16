# REPL de arcana con nivel de magia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir el CLI de un disparo en un REPL donde se elige nivel de magia al inicio, se ve una barra de maná que se agota con el uso, y la tirada se dibuja como cruz.

**Architecture:** El nivel viaja como valor semántico (`alta`/`media`/`baja`) en el body de `POST /ask`; el servidor lo traduce a modelos por etapa y pasa el modelo como parámetro a las tres funciones que hoy leen constantes de módulo. La barra vive solo en memoria del proceso REPL y descuenta el `uso.costo_usd` real que devuelve la API. Toda la presentación nueva (cruz, barra, acentos) sigue el patrón existente: `caps` decide qué se puede usar, `themes` guarda los datos, `paint` es el único que toca color.

**Tech Stack:** Node 22+, ESM, Express 4, `node:test`, `node:readline/promises`, chalk. Sin dependencias nuevas.

## Global Constraints

- Node `>=22`. ESM en todo el proyecto (`"type": "module"`).
- **No agregar dependencias.** El REPL usa `node:readline/promises`, que es built-in.
- Ningún código ANSI fuera de `cli/render/paint.js`. Ningún módulo salvo `paint.js` importa chalk.
- La API nunca conoce presentación: recibe y devuelve `nivel` semántico, nunca nombres de modelo ni colores.
- Los dólares no se imprimen nunca en la UI normal. Solo con `--dev`.
- Copy en español rioplatense, en minúscula salvo nombres propios de nivel.
- Todo glifo unicode necesita fallback ASCII vía `glyphs(caps)`. **Excepción
  única:** `cli/render/cross.js` es unicode-only por diseño — sin unicode el
  render cae a la lista vertical, así que un fallback ASCII ahí sería un camino
  que nunca corre. El módulo lo documenta explícitamente.
- Presupuesto por defecto: `0.20` USD. Barra de 16 segmentos.
- Nombres de nivel en UI: `plenilunio` (alta), `media luna` (media), `luna nueva` (baja).
- Costos de referencia por lectura: alta `0.0290`, media `0.0142`, baja `0.0058`.

---

## File Structure

**Crear:**
- `cli/budget.js` — aritmética pura de la barra. Sin I/O, sin color.
- `cli/render/cross.js` — layout espacial de la cruz. Devuelve líneas de texto.
- `cli/repl.js` — el loop interactivo. Orquesta budget + render + api.
- `test/budget.test.js` — tests de la barra.
- `test/render.test.js` — tests de cruz, ritmo de tipeo y degradación.
- `test/nivel.test.js` — tests de resolución de nivel y validación HTTP.

**Modificar:**
- `src/llm/client.js` — agregar `NIVELES`, `resolveNivel()`; quitar las tres constantes de modelo.
- `src/llm/analyze.js:81` — `analyzeQuestion(question, { model, signal })`.
- `src/llm/interpret.js:107` — `interpret({ ..., model })`.
- `src/memory/profile.js:39` — `refreshProfile(sessionId, { model })`.
- `src/routes/session.js:64` — validar y resolver `nivel`, pasar modelos, echar `nivel` en la respuesta.
- `cli/render/caps.js` — agregar `caps.wide`.
- `cli/render/themes.js` — rótulos de slot con acento y copy de niveles.
- `cli/render/index.js` — `esperando()`, ritmo adaptativo, usar la cruz, dibujar la barra.
- `cli/arcana.js` — despachar a REPL cuando no hay argumentos y hay TTY.
- `package.json` — eliminar `ora`, `boxen`, `gradient-string`.
- `.env.example`, `README.md` — reemplazar las env vars de modelo por `ARCANA_NIVEL_DEFAULT`.

---

### Task 1: Presets de nivel en el servidor

**Files:**
- Modify: `src/llm/client.js:12-15`
- Test: `test/nivel.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `NIVELES` (objeto), `NIVEL_DEFAULT` (string), `resolveNivel(nivel) → { interpret, analysis, profile }`.

- [ ] **Step 1: Write the failing test**

Crear `test/nivel.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/nivel.test.js`
Expected: FAIL — `NIVELES` es `undefined`, no está exportado.

- [ ] **Step 3: Write minimal implementation**

En `src/llm/client.js`, reemplazar las tres constantes `MODEL_*` (líneas 12-15) por:

```js
/**
 * Presets de nivel. El escalón real lo marca `interpret`: en la lectura medida
 * se llevó el 72% del gasto. El análisis produce ~77 tokens de salida, así que
 * subirlo de Haiku agrega costo y no calidad percibida.
 */
export const NIVELES = {
  alta:  { interpret: 'claude-opus-5',    analysis: 'claude-haiku-4-5', profile: 'claude-haiku-4-5' },
  media: { interpret: 'claude-sonnet-5',  analysis: 'claude-haiku-4-5', profile: 'claude-haiku-4-5' },
  baja:  { interpret: 'claude-haiku-4-5', analysis: 'claude-haiku-4-5', profile: 'claude-haiku-4-5' },
};

export const NIVEL_DEFAULT = NIVELES[process.env.ARCANA_NIVEL_DEFAULT] ? process.env.ARCANA_NIVEL_DEFAULT : 'alta';

/** Un nivel desconocido no es un error: cae al default. */
export function resolveNivel(nivel) {
  return NIVELES[nivel] ?? NIVELES[NIVEL_DEFAULT];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/nivel.test.js`
Expected: PASS — 3 tests.

Nota: `node --test test/*.test.js` va a fallar en este punto porque
`analyze.js`, `interpret.js` y `profile.js` todavía importan las constantes
borradas. Se arregla en la Task 2. Correr sólo `test/nivel.test.js` acá.

- [ ] **Step 5: Commit**

```bash
git add src/llm/client.js test/nivel.test.js
git commit -m "Agrega presets de nivel de magia en el cliente LLM"
```

---

### Task 2: Pasar el modelo como parámetro

**Files:**
- Modify: `src/llm/analyze.js:1,81,85,88,104`
- Modify: `src/llm/interpret.js:1,107,129,132`
- Modify: `src/memory/profile.js:2,39,63,66`
- Modify: `src/routes/session.js:8,84,119-152`
- Test: `test/nivel.test.js` (agregar)

**Interfaces:**
- Consumes: `resolveNivel(nivel)` de Task 1.
- Produces: `analyzeQuestion(question, { model, signal })`, `interpret({ ..., model })`, `refreshProfile(sessionId, { model })`. Las tres reciben el modelo por parámetro y ya no importan constantes.

- [ ] **Step 1: Write the failing test**

Agregar a `test/nivel.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/nivel.test.js`
Expected: FAIL — el servidor no valida `nivel`; responde 200 o 502, no 400.

- [ ] **Step 3: Write minimal implementation**

En `src/llm/analyze.js`, línea 1 y firma:

```js
import { anthropic, textOf, tune } from './client.js';
```

```js
export async function analyzeQuestion(question, { model, signal } = {}) {
```

Dentro, reemplazar las tres apariciones de `MODEL_ANALYSIS` por `model`:
`model: model,` en el request, `tune(model, {...})`, y `_model: model` en el
return de la línea 104.

En `src/llm/interpret.js`, línea 1:

```js
import { anthropic, textOf, tune } from './client.js';
```

Agregar `model` al objeto desestructurado de la firma en la línea 107, y
reemplazar `MODEL_INTERPRET` por `model` en las líneas 129 y 132.

En `src/memory/profile.js`, línea 2:

```js
import { anthropic, textOf, tune } from '../llm/client.js';
```

```js
export async function refreshProfile(sessionId, { model } = {}) {
```

Reemplazar `MODEL_PROFILE` por `model` en las líneas 63 y 66.

En `src/routes/session.js`, cambiar el import de la línea 8:

```js
import { resolveNivel, NIVELES, NIVEL_DEFAULT } from '../llm/client.js';
```

Después de la validación de largo (línea 72), agregar:

```js
  const nivel = req.body?.nivel ?? NIVEL_DEFAULT;
  if (!NIVELES[nivel]) {
    return res.status(400).json({ error: 'nivel_invalido', validos: Object.keys(NIVELES) });
  }
  const modelos = resolveNivel(nivel);
```

Pasar el modelo en cada llamada:

```js
const meta = await analyzeQuestion(question, { model: modelos.analysis });
```

En la llamada a `interpret({...})`, agregar `model: modelos.interpret`.
En la llamada a `refreshProfile(...)`, agregar `{ model: modelos.profile }`.

En el bloque `uso` (líneas 140-152), cambiar el modelo reportado de la
interpretación:

```js
      modelo: modelos.interpret,
      ...totals(usoInterpret),
      costo_usd: costOf(modelos.interpret, usoInterpret),
```

Y agregar `nivel` a la respuesta de la línea 191:

```js
  res.json({
    nivel,
    // ...el resto igual
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/*.test.js`
Expected: PASS — los 10 tests originales más los 4 de nivel. Esta vez corre la
suite completa: ya no quedan imports rotos.

- [ ] **Step 5: Commit**

```bash
git add src/llm/analyze.js src/llm/interpret.js src/memory/profile.js src/routes/session.js test/nivel.test.js
git commit -m "Convierte el modelo de constante de módulo a parámetro por request"
```

---

### Task 3: Migrar la configuración de entorno

**Files:**
- Modify: `.env.example`
- Modify: `README.md` (sección "Configuración")
- Test: manual

**Interfaces:**
- Consumes: `NIVEL_DEFAULT` de Task 1.
- Produces: nada de código.

- [ ] **Step 1: Actualizar `.env.example`**

Reemplazar el bloque de las tres `ARCANA_MODEL_*` por:

```
# Nivel usado cuando el request no manda uno (un-disparo, smoke).
# alta = opus | media = sonnet | baja = haiku — sólo cambia la interpretación.
ARCANA_NIVEL_DEFAULT=alta

# Presupuesto de la barra de magia del REPL, en USD por corrida de terminal.
ARCANA_PRESUPUESTO=0.20
```

- [ ] **Step 2: Actualizar el `.env` local**

```bash
grep -v '^ARCANA_MODEL_' .env > .env.tmp && mv .env.tmp .env
printf '\nARCANA_NIVEL_DEFAULT=alta\nARCANA_PRESUPUESTO=0.20\n' >> .env
```

- [ ] **Step 3: Actualizar el README**

En la sección "Configuración", borrar las filas de `ARCANA_MODEL_INTERPRET`,
`ARCANA_MODEL_ANALYSIS` y `ARCANA_MODEL_PROFILE`, y agregar
`ARCANA_NIVEL_DEFAULT` y `ARCANA_PRESUPUESTO` con las descripciones de arriba.

- [ ] **Step 4: Verificar que el servidor arranca**

Run: `PORT=3001 npm start`
Expected: `arcana escuchando en http://localhost:3001`, sin warnings.
Cortar con Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add .env.example README.md
git commit -m "Reemplaza las env vars de modelo por ARCANA_NIVEL_DEFAULT"
```

---

### Task 4: La aritmética de la barra

**Files:**
- Create: `cli/budget.js`
- Test: `test/budget.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `COSTO_PROMEDIO` (objeto), `nuevaBarra(presupuesto) → Barra`, `descontar(barra, costo) → Barra`, `restante(barra) → number`, `alcanza(barra, nivel) → boolean`, `lecturasRestantes(barra, nivel) → number | null` (`null` cuando la barra es indeterminada o el nivel no existe: "no se puede saber" no es lo mismo que "cero"), `segmentos(barra, total) → { llenos, vacios }`. `Barra` es `{ presupuesto, gastado, desconocido, lecturas }` y es **inmutable**: cada función devuelve una nueva.

- [ ] **Step 1: Write the failing test**

Crear `test/budget.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/budget.test.js`
Expected: FAIL — `Cannot find module '../cli/budget.js'`.

- [ ] **Step 3: Write minimal implementation**

Crear `cli/budget.js`:

```js
/**
 * Aritmética de la barra de magia. Puro: sin I/O, sin color, sin estado global.
 * Internamente cuenta en USD porque es lo único que la API mide de verdad,
 * pero ese número no se imprime nunca: la UI sólo muestra la barra.
 */

/** Costo medido por lectura, en USD. Orden de magnitud, no promedio estadístico. */
export const COSTO_PROMEDIO = { alta: 0.0290, media: 0.0142, baja: 0.0058 };

export function nuevaBarra(presupuesto = 0.20) {
  return { presupuesto, gastado: 0, desconocido: false, lecturas: 0 };
}

/**
 * `costo` null significa que no conocemos el precio del modelo. En ese caso la
 * barra pasa a indeterminada y deja de descontar: restar cero mentiría y restar
 * un estimado inventaría un número.
 */
export function descontar(barra, costo) {
  if (typeof costo !== 'number') {
    return { ...barra, desconocido: true, lecturas: barra.lecturas + 1 };
  }
  return { ...barra, gastado: barra.gastado + costo, lecturas: barra.lecturas + 1 };
}

export function restante(barra) {
  return Math.max(0, barra.presupuesto - barra.gastado);
}

export function alcanza(barra, nivel) {
  if (barra.desconocido) return true;
  return restante(barra) >= (COSTO_PROMEDIO[nivel] ?? 0);
}

export function lecturasRestantes(barra, nivel) {
  const costo = COSTO_PROMEDIO[nivel];
  if (!costo || barra.desconocido) return null;
  return Math.floor(restante(barra) / costo);
}

export function segmentos(barra, total = 16) {
  const proporcion = barra.presupuesto > 0 ? restante(barra) / barra.presupuesto : 0;
  const llenos = Math.round(proporcion * total);
  return { llenos, vacios: total - llenos };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/budget.test.js`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add cli/budget.js test/budget.test.js
git commit -m "Agrega la aritmética de la barra de magia"
```

---

### Task 5: Capacidad `wide` y layout de cruz

**Files:**
- Modify: `cli/render/caps.js:28-32`
- Create: `cli/render/cross.js`
- Test: `test/render.test.js`

**Interfaces:**
- Consumes: `glyphs(caps)` existente.
- Produces: `caps.wide` (boolean), `cross({ cartas, labels, pintar }) → string[]`. `cartas` es el array `res.tirada.cartas` de la API (cada item: `{ slot, carta: { nombre }, invertida }`). `labels` mapea slot → rótulo con acento. `pintar(item) → string` por defecto devuelve `item.carta.nombre` sin tocar.

- [ ] **Step 1: Write the failing test**

Crear `test/render.test.js`:

```js
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
```

Nota: `detectCaps` aplica los overrides *antes* de calcular `wide`, porque
`wide` se deriva de `tty`, `unicode` y `width` — que el llamador puede
sobrescribir. Ver Step 3.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/render.test.js`
Expected: FAIL — `Cannot find module '../cli/render/cross.js'`.

- [ ] **Step 3: Write minimal implementation**

En `cli/render/caps.js`, cambiar el return de `detectCaps` para que `wide` se
calcule sobre las capacidades ya combinadas con los overrides:

```js
  const base = { ...caps, ...overrides };
  // La cruz necesita ancho real y glifos; si no, se cae a la lista vertical.
  // Se deriva de los valores ya sobrescritos, pero un `wide` explícito manda.
  const wide = base.tty && base.unicode && base.width >= 64;
  return { ...base, wide: overrides.wide ?? wide };
```

Crear `cli/render/cross.js`:

```js
/**
 * Layout espacial de la tirada en cruz. Devuelve líneas listas para imprimir.
 *
 * El ancho se calcula sobre el texto crudo y el color se aplica al final, así
 * los escapes ANSI no descuadran el alineado. Por eso `pintar` recibe el item
 * y devuelve sólo el nombre pintado: el padding lo pone esta función.
 */
const COL = 20;

function celda(item, labels, pintar) {
  if (!item) return { label: '', nombre: '', pintado: '' };
  const marca = item.invertida ? ' ▼ invertida' : '';
  return {
    label: labels[item.slot] ?? item.slot,
    nombre: item.carta.nombre + marca,
    pintado: pintar(item) + marca,
  };
}

/** Rellena a la derecha contando sólo caracteres visibles. */
function pad(texto, visible, ancho) {
  return texto + ' '.repeat(Math.max(0, ancho - visible));
}

export function cross({ cartas, labels = {}, pintar = (i) => i.carta.nombre }) {
  const by = (slot) => cartas.find((c) => c.slot === slot);
  const c = (slot) => celda(by(slot), labels, pintar);

  const resultado = c('resultado');
  const consejo = c('consejo');
  const situacion = c('situacion');
  const obstaculo = c('obstaculo');
  const raiz = c('raiz');

  const centro = ' '.repeat(COL + 2);
  const lines = [];

  lines.push(`${centro}▲ ${resultado.label}`);
  lines.push(`${centro}  ${resultado.pintado}`);
  lines.push('');
  lines.push(
    pad(`  ◀ ${consejo.label}`, 4 + consejo.label.length, COL) +
      pad(`✦ ${situacion.label}`, 2 + situacion.label.length, COL) +
      `${obstaculo.label} ▶`,
  );
  lines.push(
    pad(`    ${consejo.pintado}`, 4 + consejo.nombre.length, COL) +
      pad(`  ${situacion.pintado}`, 2 + situacion.nombre.length, COL) +
      obstaculo.pintado,
  );
  lines.push('');
  lines.push(`${centro}▼ ${raiz.label}`);
  lines.push(`${centro}  ${raiz.pintado}`);

  return lines;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/render.test.js`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add cli/render/cross.js cli/render/caps.js test/render.test.js
git commit -m "Dibuja la tirada en cruz con degradación por capacidades"
```

---

### Task 6: Rótulos con acento, ritmo adaptativo y espera real

**Files:**
- Modify: `cli/render/themes.js`
- Modify: `cli/render/index.js:22-30,71-105`
- Test: `test/render.test.js` (agregar)

**Interfaces:**
- Consumes: `cross()` de Task 5, `caps.wide` de Task 5.
- Produces: `theme(id).slots` (objeto slot → rótulo), `theme(id).niveles` (objeto nivel → nombre UI), `ritmoTipeo(largo, base) → number` exportada de `cli/render/index.js`, `render.esperando() → stopFn`, `render.barra(barra, nivel)`.

- [ ] **Step 1: Write the failing test**

Agregar a `test/render.test.js`:

```js
const { ritmoTipeo } = await import('../cli/render/index.js');
const { theme } = await import('../cli/render/themes.js');

test('el ritmo de tipeo acota el tiempo total del texto largo', () => {
  // Texto corto: usa el ritmo base.
  assert.equal(ritmoTipeo(100, 6), 6);
  // Texto largo: baja el ritmo para no pasar de ~4s.
  const largo = 4000;
  assert.ok(ritmoTipeo(largo, 6) < 6);
  assert.ok(ritmoTipeo(largo, 6) * largo <= 4000);
  // Nunca cero: se perdería el efecto por completo.
  assert.ok(ritmoTipeo(100000, 6) > 0);
});

test('los temas traen rótulos acentuados y nombres de nivel', () => {
  for (const id of ['directo', 'poetico']) {
    const t = theme(id);
    assert.equal(t.slots.situacion, 'situación');
    assert.equal(t.slots.raiz, 'raíz');
    assert.equal(t.slots.obstaculo, 'obstáculo');
    assert.equal(t.niveles.alta, 'plenilunio');
    assert.equal(t.niveles.media, 'media luna');
    assert.equal(t.niveles.baja, 'luna nueva');
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/render.test.js`
Expected: FAIL — `ritmoTipeo is not a function` y `t.slots` es `undefined`.

- [ ] **Step 3: Write minimal implementation**

En `cli/render/themes.js`, agregar a **cada** uno de los dos temas (`directo` y
`poetico`), dentro del objeto, junto a `copy`:

```js
    slots: {
      situacion: 'situación', obstaculo: 'obstáculo', raiz: 'raíz',
      consejo: 'consejo', resultado: 'resultado',
      pasado: 'pasado', presente: 'presente', futuro: 'futuro', unica: 'única',
    },
    niveles: { alta: 'plenilunio', media: 'media luna', baja: 'luna nueva' },
```

En `cli/render/index.js`, agregar la función exportada arriba de
`createRenderer`:

```js
/**
 * El tipeo a ritmo fijo castiga los textos largos: 275 palabras a 6ms/carácter
 * son ~10s. Se acota el total y se conserva la sensación de revelado.
 */
const TIPEO_MAX_MS = 4000;

export function ritmoTipeo(largo, base) {
  if (largo <= 0) return base;
  return Math.max(0.1, Math.min(base, TIPEO_MAX_MS / largo));
}
```

Dentro de `createRenderer`, agregar el método `esperando()` al objeto que se
retorna:

```js
    /**
     * Anima mientras corre la llamada al modelo (~18s). Devuelve la función de
     * corte: la animación cubre la espera real, no la simula después.
     */
    esperando(tono) {
      const { t, p } = ctx(tono);
      if (!caps.animation) {
        write(`${p.dim(`${t.copy.barajando}…`)}\n`);
        return () => {};
      }
      const frames = caps.unicode ? ['▚▚▚', '▞▞▞', '▟▙▟', '▛▜▛'] : ['[|]', '[/]', '[-]', '[\\]'];
      let i = 0;
      const timer = setInterval(() => {
        write(`\r${p.dim(`${t.copy.barajando} `)}${p.accent(frames[i++ % frames.length])}`);
      }, 90);
      return () => {
        clearInterval(timer);
        write(`\r${' '.repeat(t.copy.barajando.length + 6)}\r`);
      };
    },

    /** La barra de magia. Nunca imprime dólares. */
    barra(estado, nivel, { llenos, vacios }) {
      const { t, p } = ctx();
      const lleno = caps.unicode ? '◈' : '#';
      const vacio = caps.unicode ? '◇' : '-';
      if (estado.desconocido) {
        write(`  ${p.invertida('~'.repeat(llenos + vacios))}  ${p.dim('magia de origen desconocido')}\n`);
        return;
      }
      write(`  ${p.accent(lleno.repeat(llenos))}${p.dim(vacio.repeat(vacios))}   ${p.dim(t.niveles[nivel])}\n`);
    },
```

En el método `reading(res)`, borrar la llamada a `await shuffle(c)` — la espera
ahora la cubre `esperando()`. Reemplazar el bucle que imprime las cartas
(líneas 84-92) por:

```js
      if (caps.wide && res.tirada.tipo === 'cruz') {
        for (const line of cross({
          cartas: res.tirada.cartas,
          labels: t.slots,
          pintar: (item) => cardColor(p, item.carta, item.invertida)(item.carta.nombre),
        })) {
          write(`${line}\n`);
        }
      } else {
        for (const item of res.tirada.cartas) {
          const paint = cardColor(p, item.carta, item.invertida);
          const marca = item.invertida ? ` ${g.down} invertida` : '';
          const label = t.slots[item.slot] ?? item.slot;
          write(`  ${p.dim(`${g.card} ${label.padEnd(11)}`)}${paint(item.carta.nombre)}${p.invertida(marca)}\n`);
        }
      }
```

Agregar el import arriba: `import { cross } from './cross.js';`

Y en el bucle de la interpretación, usar el ritmo adaptativo:

```js
      const ms = ritmoTipeo(res.interpretacion.length, r.typeMs);
      for (const line of wrap(res.interpretacion, caps.width - 4)) {
        if (!line) { write('\n'); continue; }
        await type(`  ${line}`, p.base, ms);
      }
```

Borrar la función `shuffle` ahora que nadie la llama.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/*.test.js`
Expected: PASS — toda la suite.

- [ ] **Step 5: Commit**

```bash
git add cli/render/index.js cli/render/themes.js test/render.test.js
git commit -m "Cubre la espera real con animación y acota el ritmo de tipeo"
```

---

### Task 7: El REPL

**Files:**
- Create: `cli/repl.js`
- Test: manual (el loop interactivo no se testea automáticamente)

**Interfaces:**
- Consumes: `nuevaBarra`, `descontar`, `alcanza`, `lecturasRestantes`, `segmentos`, `COSTO_PROMEDIO` de Task 4; `createRenderer` con `esperando()` y `barra()` de Task 6.
- Produces: `runRepl({ api, render, presupuesto, dev }) → Promise<void>`. `api(path, opts)` es la misma función que ya usa `cli/arcana.js`.

- [ ] **Step 1: Escribir el REPL**

Crear `cli/repl.js`:

```js
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
  nuevaBarra, descontar, alcanza, lecturasRestantes, segmentos, COSTO_PROMEDIO,
} from './budget.js';

const NIVELES_UI = [
  { key: 'alta', nombre: 'Plenilunio', marca: '◆◆◆' },
  { key: 'media', nombre: 'Media luna', marca: '◆◆◇' },
  { key: 'baja', nombre: 'Luna nueva', marca: '◆◇◇' },
];

async function elegirNivel(rl, render, presupuesto) {
  render.info('');
  render.info('  ¿Con cuánta magia querés leer?');
  render.info('');
  for (const [i, n] of NIVELES_UI.entries()) {
    const cuantas = Math.floor(presupuesto / COSTO_PROMEDIO[n.key]);
    render.info(`    ${i + 1}  ${n.marca}  ${n.nombre.padEnd(12)} ~${cuantas} lecturas`);
  }
  render.info('');
  while (true) {
    const r = (await rl.question('  › ')).trim();
    const porNumero = NIVELES_UI[Number(r) - 1];
    const porNombre = NIVELES_UI.find((n) => n.key === r.toLowerCase());
    if (porNumero) return porNumero.key;
    if (porNombre) return porNombre.key;
    render.info('  elegí 1, 2 o 3.');
  }
}

export async function runRepl({ api, render, presupuesto = 0.20, dev = false }) {
  // Si el servidor no está, se avisa antes de pedir el nivel.
  try {
    await api('/health');
  } catch {
    render.error('no hay servidor. levantalo con `npm start`.');
    process.exitCode = 1;
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  let barra = nuevaBarra(presupuesto);
  let nivel = await elegirNivel(rl, render, presupuesto);
  let sessionId = null;

  const salir = () => {
    render.info('');
    render.info(`  ✦ ${barra.lecturas} lectura(s) · ${nivel}`);
    render.barra(barra, nivel, segmentos(barra));
    rl.close();
  };

  rl.on('SIGINT', () => { salir(); process.exit(0); });

  while (true) {
    render.info('');
    render.barra(barra, nivel, segmentos(barra));

    let linea;
    try {
      linea = (await rl.question('  › ')).trim();
    } catch {
      break; // Ctrl+D
    }
    if (!linea) continue;
    if (linea === 'salir' || linea === 'exit') break;

    if (linea.startsWith('nivel')) {
      const pedido = linea.split(/\s+/)[1];
      if (COSTO_PROMEDIO[pedido]) { nivel = pedido; render.info(`  nivel: ${nivel}`); }
      else render.info('  niveles: alta, media, baja');
      continue;
    }

    if (!sessionId) {
      const s = await api('/session', { method: 'POST', body: { tono: 'auto' } });
      sessionId = s.session_id;
    }

    if (linea === 'historial') {
      render.history(await api(`/session/${sessionId}/history?limit=20`));
      continue;
    }

    if (linea === 'olvidar') {
      await api(`/session/${sessionId}`, { method: 'DELETE' });
      sessionId = null;
      render.info('  historial borrado.');
      continue;
    }

    if (!alcanza(barra, nivel)) {
      // `lecturasRestantes` devuelve null cuando no se puede medir; null > 0 es
      // false, así que hay que distinguirlo de "cero" en vez de tragarlo.
      const conBaja = lecturasRestantes(barra, 'baja');
      render.info(`  no alcanza para ${nivel}.`);
      if (conBaja === null) render.info('  no se puede medir el consumo.');
      else if (conBaja > 0) render.info(`  con luna nueva te queda para ~${conBaja} lectura(s): › nivel baja`);
      continue;
    }

    // Un error acá no descuenta: no se cobra lo que no se leyó.
    let res;
    const stop = render.esperando();
    try {
      res = await api(`/session/${sessionId}/ask`, {
        method: 'POST',
        body: { pregunta: linea, nivel },
      });
    } catch (err) {
      stop();
      render.error(err.message);
      continue;
    }
    stop();

    if (res.tipo === 'apoyo') { render.support(res); continue; }
    if (res.tipo === 'sin_lectura') { render.info(res.mensaje); continue; }

    await render.reading(res);
    barra = descontar(barra, res.uso?.costo_usd ?? null);

    if (dev) {
      const u = res.uso ?? {};
      render.info(
        `  [dev] análisis ${u.analisis?.in}/${u.analisis?.out} tok · ` +
        `interpretación ${u.interpretacion?.in}/${u.interpretacion?.out} tok · ` +
        `$${(u.costo_usd ?? 0).toFixed(4)}`,
      );
    }
  }

  salir();
}
```

- [ ] **Step 2: Verificar que el archivo parsea**

Run: `node --check cli/repl.js`
Expected: sin salida (sintaxis válida).

El REPL todavía no es alcanzable desde `arcana`: eso lo conecta la Task 8, y
ahí está la verificación manual end-to-end.

- [ ] **Step 3: Commit**

```bash
git add cli/repl.js
git commit -m "Agrega el loop interactivo del REPL"
```

---

### Task 8: Conectar el REPL y limpiar dependencias

**Files:**
- Modify: `cli/arcana.js:52-66,86-98`
- Modify: `package.json:20-28`
- Modify: `README.md` (sección "CLI")
- Test: manual

**Interfaces:**
- Consumes: `runRepl` de Task 7.
- Produces: `arcana` sin argumentos y con TTY abre el REPL; con argumentos mantiene el comportamiento de un disparo.

- [ ] **Step 1: Despachar al REPL**

En `cli/arcana.js`, agregar el import:

```js
import { runRepl } from './repl.js';
```

Agregar `--dev` al parser de flags (línea 57 en adelante):

```js
    else if (a === '--dev') flags.dev = true;
```

En `main()`, reemplazar el bloque de ayuda (líneas 95-98) por:

```js
  if (flags.help) {
    process.stdout.write(HELP);
    return;
  }

  // Sin argumentos y con terminal interactiva: el REPL. Con argumentos o por
  // pipe: un disparo, sin barra ni selección de nivel, para scripts.
  if (rest.length === 0) {
    if (!render.caps.tty) {
      process.stdout.write(HELP);
      return;
    }
    return runRepl({
      api,
      render,
      presupuesto: Number(process.env.ARCANA_PRESUPUESTO ?? 0.20),
      dev: flags.dev,
    });
  }
```

Actualizar `HELP` para documentar el REPL:

```js
const HELP = `arcana — lecturas de tarot desde la terminal

  arcana                                  abre el REPL (elegís nivel de magia)
  arcana "¿tu pregunta?"                  una lectura y salir
  arcana historial [--limit N]            lecturas anteriores
  arcana olvidar                          borra la sesión y su historial

dentro del REPL
  <pregunta>     pide una lectura
  nivel <x>      cambia el nivel: alta | media | baja
  historial      lecturas anteriores
  salir          termina y muestra el resumen

opciones de presentación (sólo del cliente; la API no las conoce)
  --plain        sin color, sin animación, sin unicode
  --no-anim      mantiene el color, quita el efecto máquina de escribir
  --theme X      fuerza un tema (directo | poetico)
  --dev          muestra tokens y costo real por lectura

variables de entorno
  ARCANA_API=http://localhost:3000
  ARCANA_PRESUPUESTO=0.20   magia por corrida de terminal, en USD
  NO_COLOR=1                desactiva color (estándar no-color.org)
  ARCANA_NO_ANIM=1          desactiva animación de forma persistente
`;
```

- [ ] **Step 2: Eliminar las dependencias muertas**

```bash
npm uninstall ora boxen gradient-string
```

Verificar que sólo quedó chalk como dep de UI:

Run: `grep -rn "from 'ora'\|from 'boxen'\|from 'gradient-string'" cli src scripts`
Expected: sin resultados.

- [ ] **Step 3: Correr la suite completa**

Run: `npm test`
Expected: PASS — todos los tests, incluidos los nuevos de budget, render y nivel.

- [ ] **Step 4: Verificación manual end-to-end**

En una terminal: `PORT=3001 npm start`

En otra:

```bash
ARCANA_API=http://localhost:3001 node cli/arcana.js
```

Verificar en orden:
1. Aparece el menú de tres niveles con el conteo de lecturas.
2. Elegir `3` (luna nueva, la más barata).
3. La barra sale llena, con 16 bloques.
4. Al preguntar, el barajado **se mueve durante toda la espera** y no después.
5. La cruz se dibuja con las cinco cartas en posición y rótulos acentuados.
6. La barra baja después de la lectura.
7. `nivel alta` cambia el nivel.
8. `salir` muestra el resumen, sin ningún signo `$`.
9. Ningún `$` en toda la salida salvo con `--dev`.

Y la degradación:

```bash
ARCANA_API=http://localhost:3001 node cli/arcana.js --plain "¿y ahora qué?"
```

Expected: sin color, sin animación, tirada como lista vertical, no como cruz.

- [ ] **Step 5: Actualizar el README y commitear**

En la sección "CLI" del README, reemplazar el ejemplo de un disparo por el
bloque de ayuda nuevo, y documentar el REPL, la barra y los tres niveles.

```bash
git add cli/arcana.js package.json package-lock.json README.md
git commit -m "Despacha al REPL sin argumentos y elimina dependencias muertas"
```

---

## Self-Review

**Cobertura del spec:**

| Requisito del spec | Task |
|---|---|
| Presets de nivel, análisis en Haiku | 1 |
| `nivel` semántico en el body, echo en la respuesta | 2 |
| Modelo como parámetro en las tres etapas | 2 |
| Eliminar `ARCANA_MODEL_*`, agregar `ARCANA_NIVEL_DEFAULT` | 3 |
| Barra en memoria, 16 bloques, descuento real | 4 |
| Caso `null` indeterminado | 4 |
| Chequeo previo y cambio de nivel a mitad de sesión | 4 (lógica), 7 (uso) |
| `caps.wide` y degradación a lista | 5 |
| Layout de cruz | 5 |
| Rótulos con acento en `themes.js` | 6 |
| Animación durante la espera real | 6 |
| Ritmo de tipeo acotado | 6 |
| REPL, comandos, resumen al salir | 7 |
| Errores no matan el loop ni descuentan | 7 |
| Aviso si no hay servidor al abrir | 7 |
| Ctrl+C y Ctrl+D limpios | 7 |
| Un disparo intacto para scripts | 8 |
| `--dev` como único lugar con dólares | 7 (impresión), 8 (flag) |
| Eliminar `ora`, `boxen`, `gradient-string` | 8 |

Sin huecos.

**Consistencia de tipos:** `Barra` es `{ presupuesto, gastado, desconocido, lecturas }` en Task 4 y se usa igual en 6 y 7. `segmentos()` devuelve `{ llenos, vacios }` y `render.barra()` lo recibe con esa forma exacta. `cross({ cartas, labels, pintar })` en Task 5 se llama con esos tres nombres en Task 6. `resolveNivel` de Task 1 se consume en Task 2.

**Riesgo conocido del plan:** la Task 1 deja la suite completa en rojo
transitoriamente (los módulos todavía importan las constantes borradas); se
resuelve en la Task 2. Está señalado en el Step 4 de la Task 1.
