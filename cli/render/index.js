import { stdout } from 'node:process';
import { detectCaps, glyphs } from './caps.js';
import { theme } from './themes.js';
import { painter } from './paint.js';

/**
 * Capa de presentación. Recibe el JSON crudo de la API y decide todo lo visual.
 * No conoce HTTP ni la forma en que se obtuvo la respuesta: si mañana hay web,
 * la API no arrastra nada de esto.
 */
export function createRenderer(opts = {}) {
  const caps = detectCaps(opts.caps);
  const g = glyphs(caps);
  const write = (s) => stdout.write(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function ctx(tone) {
    const t = theme(opts.theme ?? tone);
    return { t, p: painter(caps, t.palette), r: t.rhythm };
  }

  async function type(text, paint, ms) {
    if (!caps.animation || ms === 0) return void write(`${paint(text)}\n`);
    for (const ch of text) {
      write(paint(ch));
      // No pausar dentro de una palabra corta: leerlo letra a letra cansa.
      if (ch === ' ' || ch === '\n') await sleep(ms);
      else if (Math.random() < 0.25) await sleep(ms / 2);
    }
    write('\n');
  }

  function wrap(text, width) {
    return text
      .split('\n')
      .flatMap((para) => {
        if (!para.trim()) return [''];
        const out = [];
        let line = '';
        for (const word of para.split(/\s+/)) {
          if ((line + ' ' + word).trim().length > width) {
            out.push(line.trim());
            line = word;
          } else line += ` ${word}`;
        }
        if (line.trim()) out.push(line.trim());
        return out;
      });
  }

  function cardColor(p, carta, invertida) {
    if (invertida) return p.invertida;
    if (carta.arcano === 'mayor') return p.mayor;
    return p[carta.palo] ?? p.base;
  }

  async function shuffle({ t, p, r }) {
    if (!caps.animation) return;
    const frames = caps.unicode ? ['▚▚▚', '▞▞▞', '▟▙▟', '▛▜▛'] : ['[|]', '[/]', '[-]', '[\\]'];
    const until = Date.now() + r.shuffleMs;
    let i = 0;
    while (Date.now() < until) {
      write(`\r${p.dim(`${t.copy.barajando} `)}${p.accent(frames[i++ % frames.length])}`);
      await sleep(90);
    }
    write(`\r${' '.repeat(t.copy.barajando.length + 6)}\r`);
  }

  function clear({ r }) {
    if (caps.animation && r.clearBetweenScenes) write('\x1b[2J\x1b[H');
  }

  return {
    caps,

    async reading(res) {
      const c = ctx(res.render?.tono);
      const { t, p, r } = c;

      clear(c);
      await shuffle(c);

      write(`${p.dim(g.sep.repeat(Math.min(caps.width, 60)))}\n`);
      write(`${p.bold(p.accent(t.copy.revelando))} ${p.dim(`(${res.tirada.tipo})`)}\n\n`);

      for (const item of res.tirada.cartas) {
        const paint = cardColor(p, item.carta, item.invertida);
        const marca = item.invertida ? ` ${g.down} invertida` : '';
        write(
          `  ${p.dim(`${g.card} ${item.slot.padEnd(10)}`)}` +
            `${paint(item.carta.nombre)}${p.invertida(marca)}\n`,
        );
        if (caps.animation) await sleep(r.pauseMs);
      }

      write(`\n${p.dim(g.sep.repeat(Math.min(caps.width, 60)))}\n\n`);
      if (caps.animation) await sleep(r.pauseMs);

      for (const line of wrap(res.interpretacion, caps.width - 4)) {
        if (!line) { write('\n'); continue; }
        await type(`  ${line}`, p.base, r.typeMs);
      }
      write('\n');
    },

    support(res) {
      const { p } = ctx('directo');
      write(`\n${p.bold(p.invertida('· · ·'))}\n\n`);
      for (const line of wrap(res.mensaje, caps.width - 4)) write(`  ${p.base(line)}\n`);
      write('\n');
      for (const rec of res.recursos) {
        write(`  ${p.accent(rec.pais.padEnd(3))} ${p.base(rec.nombre)} ${p.dim(`— ${rec.contacto}`)}\n`);
      }
      write(`\n  ${p.dim(res.nota)}\n\n`);
    },

    history(res) {
      const { p } = ctx('directo');
      write(`\n${p.dim(`${res.total} lectura(s) en esta sesión`)}\n\n`);
      for (const l of res.lecturas) {
        const cartas = l.tirada.cartas
          .map((c) => cardColor(p, c.carta, c.invertida)(c.carta.nombre))
          .join(p.dim(` ${g.dot} `));
        write(`  ${p.dim(l.fecha.slice(0, 16).replace('T', ' '))}  ${p.base(l.pregunta)}\n`);
        write(`  ${' '.repeat(16)}  ${cartas}\n\n`);
      }
    },

    info(msg) {
      const { p } = ctx('directo');
      write(`${p.dim(msg)}\n`);
    },

    error(msg) {
      const { p } = ctx('directo');
      process.stderr.write(`${p.invertida('error')} ${msg}\n`);
    },
  };
}
