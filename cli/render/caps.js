/**
 * Detección de capacidades del terminal. Todo el resto del render pregunta
 * aquí antes de imprimir algo: un único punto donde se decide qué se puede usar.
 */
import { stdout } from 'node:process';

function envFlag(name) {
  const v = process.env[name];
  return v !== undefined && v !== '' && v !== '0';
}

export function detectCaps(overrides = {}) {
  const tty = Boolean(stdout.isTTY);

  // NO_COLOR es un estándar de facto (no-color.org): si está, no hay color.
  const noColor = envFlag('NO_COLOR') || process.env.TERM === 'dumb';

  // Unicode: asumir sí sólo si el locale lo dice. Windows sin UTF-8 rompe feo.
  const lang = `${process.env.LC_ALL ?? ''}${process.env.LC_CTYPE ?? ''}${process.env.LANG ?? ''}`;
  const unicode =
    /UTF-?8/i.test(lang) || (process.platform === 'win32' && envFlag('WT_SESSION'));

  const caps = {
    tty,
    color: tty && !noColor,
    truecolor: tty && !noColor && /truecolor|24bit/i.test(process.env.COLORTERM ?? ''),
    unicode: tty && unicode,
    // Sin TTY (pipe, CI, `arcana ask | less`) no hay animación ni control de cursor.
    animation: tty && !envFlag('ARCANA_NO_ANIM') && !envFlag('CI'),
    width: Math.min(stdout.columns || 80, 100),
  };

  return { ...caps, ...overrides };
}

// Glifos con fallback ASCII. Nunca imprimir un símbolo sin pasar por acá.
const GLYPHS = {
  unicode: { card: '▚', sep: '─', dot: '•', up: '▲', down: '▼', corner: '·' },
  ascii: { card: '#', sep: '-', dot: '*', up: '^', down: 'v', corner: '+' },
};

export function glyphs(caps) {
  return caps.unicode ? GLYPHS.unicode : GLYPHS.ascii;
}
