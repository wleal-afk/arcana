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

  // `salir` se llama tanto al terminar el loop normalmente como desde el
  // handler de SIGINT: la bandera evita que el resumen se imprima dos veces
  // si el SIGINT dispara la salida y el loop igual llega a su fin normal.
  let salido = false;
  const salir = () => {
    if (salido) return;
    salido = true;
    render.info('');
    render.info(`  ✦ ${barra.lecturas} lectura(s) · ${nivel}`);
    render.barra(barra, nivel, segmentos(barra));
    rl.close();
  };

  rl.on('SIGINT', () => { salir(); process.exit(0); });

  try {
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
        // `lecturasRestantes` devuelve null cuando no se puede medir (costo
        // desconocido o nivel inexistente); null > 0 es false, así que hay
        // que distinguir explícitamente los tres casos en vez de tragarlo.
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
        render.error(err.message);
        continue;
      } finally {
        // Garantizado por todos los caminos: si no se corta, el setInterval
        // de la animación queda vivo y mantiene el proceso despierto.
        stop();
      }

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
  } finally {
    // Por más que algo reviente arriba, el readline se cierra siempre: que
    // el proceso no quede colgado esperando stdin.
    salir();
  }
}
