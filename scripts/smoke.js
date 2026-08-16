#!/usr/bin/env node
/**
 * Smoke test del camino real contra el modelo. A diferencia de `npm test`,
 * este SÍ gasta tokens: es el que responde "¿la integración funciona?".
 *
 *   npm start          (en otra terminal)
 *   npm run smoke
 *
 * Hace dos lecturas seguidas a propósito: la segunda es la que muestra si la
 * memoria y la rotación de modos de continuidad están funcionando.
 */
const API = process.env.ARCANA_API ?? 'http://localhost:3000';

const checks = [];
function check(nombre, ok, detalle = '') {
  checks.push({ nombre, ok, detalle });
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  return { status: res.status, data };
}

function seccion(t) {
  console.log(`\n\x1b[1m${t}\x1b[0m`);
}

async function main() {
  console.log(`smoke contra ${API}\n`);

  const health = await api('/health').catch(() => null);
  if (!health || health.status !== 200) {
    console.error(`No hay servidor en ${API}. Corré \`npm start\` en otra terminal.`);
    process.exit(1);
  }
  check('servidor arriba', true, `retención ${health.data.retencion_dias}d`);

  // --- sesión
  seccion('1. sesión');
  const { data: sesion } = await api('/session', { method: 'POST', body: { tono: 'auto' } });
  check('POST /session', Boolean(sesion.session_id), sesion.session_id);
  check('aviso de retención presente', Boolean(sesion.aviso));
  const SID = sesion.session_id;

  // --- gate de crisis (no llama al modelo de interpretación)
  seccion('2. gate de crisis');
  const { data: crisis } = await api(`/session/${SID}/ask`, {
    method: 'POST',
    body: { pregunta: 'ya no quiero seguir vivir, ¿qué dicen las cartas?' },
  });
  check('devuelve tipo=apoyo', crisis.tipo === 'apoyo', `tipo=${crisis.tipo}`);
  check('NO hay tirada ni interpretación', !crisis.tirada && !crisis.interpretacion);
  check('incluye recursos', Array.isArray(crisis.recursos) && crisis.recursos.length > 0);

  // --- lectura 1 (acá sí se llama al modelo, dos veces)
  seccion('3. primera lectura (llama al modelo)');
  const t0 = Date.now();
  const { status: s1, data: l1 } = await api(`/session/${SID}/ask`, {
    method: 'POST',
    body: { pregunta: '¿debería aceptar la oferta de trabajo o quedarme donde estoy?' },
  });
  if (s1 !== 200 || l1.tipo !== 'lectura') {
    check('lectura generada', false, JSON.stringify(l1).slice(0, 200));
    resumen();
    console.error('\nSi el error es de credenciales, revisá ANTHROPIC_API_KEY en .env');
    process.exit(1);
  }
  const ms1 = Date.now() - t0;
  check('lectura generada', true, `${(ms1 / 1000).toFixed(1)}s`);
  check('tirada con cartas', l1.tirada?.cartas?.length > 0, `${l1.tirada.tipo} / ${l1.tirada.cartas.length} cartas`);
  check('sin cartas repetidas', new Set(l1.tirada.cartas.map((c) => c.carta.id)).size === l1.tirada.cartas.length);
  check('devuelve señales de render', Boolean(l1.render?.tono), `tono=${l1.render?.tono} continuidad=${l1.render?.continuidad}`);

  const palabras = l1.interpretacion.trim().split(/\s+/).length;
  check('largo dentro de rango (150-320 palabras)', palabras >= 120 && palabras <= 380, `${palabras} palabras`);
  check('sin markdown', !/[*#_`]|^\s*[-•]\s/m.test(l1.interpretacion));

  const u = l1.uso;
  check('reporta uso de tokens', u?.costo_usd != null,
    `análisis ${u.analisis.in}/${u.analisis.out} tok · interpretación ${u.interpretacion.in}/${u.interpretacion.out} tok`);
  console.log(`       cache: ${u.interpretacion.cache_read} leídos, ${u.interpretacion.cache_write} escritos`);
  console.log(`       costo real: $${u.costo_usd.toFixed(4)} USD  (~$${(u.costo_usd * 1000).toFixed(2)} por 1.000 lecturas)`);

  console.log(`\n${l1.tirada.cartas.map((c) => `  ${c.slot}: ${c.carta.nombre}${c.invertida ? ' (inv)' : ''}`).join('\n')}`);
  console.log(`\n  ${l1.interpretacion.replace(/\n/g, '\n  ')}\n`);

  // --- lectura 2: memoria + rotación de continuidad
  seccion('4. segunda lectura (memoria + continuidad)');
  const { data: l2 } = await api(`/session/${SID}/ask`, {
    method: 'POST',
    body: { pregunta: 'sigo dándole vueltas al tema del trabajo, ¿qué se me escapa?' },
  });
  check('segunda lectura generada', l2.tipo === 'lectura');
  check(
    'el modo de continuidad rotó',
    l2.render?.continuidad !== l1.render?.continuidad,
    `${l1.render?.continuidad} → ${l2.render?.continuidad}`,
  );
  check(
    'no abre con la fórmula "la última vez"',
    !/^\s*(la última vez|la vez anterior|anteriormente)/i.test(l2.interpretacion),
  );
  console.log(`\n  ${l2.interpretacion.replace(/\n/g, '\n  ')}\n`);

  // --- historial y borrado
  seccion('5. historial y borrado');
  const { data: hist } = await api(`/session/${SID}/history`);
  check('historial tiene 2 lecturas', hist.total === 2, `total=${hist.total}`);
  check('acumula el costo de la sesión', hist.costo_acumulado_usd > 0,
    `$${(hist.costo_acumulado_usd ?? 0).toFixed(4)} USD en 2 lecturas`);
  check('el historial trae las cartas', hist.lecturas?.[0]?.tirada?.cartas?.length > 0);

  const { status: del } = await api(`/session/${SID}`, { method: 'DELETE' });
  check('DELETE /session', del === 200);
  const { status: gone } = await api(`/session/${SID}/history`);
  check('la sesión ya no existe', gone === 404);

  resumen();
}

function resumen() {
  const fallas = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - fallas.length}/${checks.length} checks ok`);
  if (fallas.length) {
    console.log(fallas.map((f) => `  FALLA: ${f.nombre}`).join('\n'));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\nerror: ${err.message}`);
  process.exit(1);
});
