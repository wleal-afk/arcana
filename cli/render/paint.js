import chalk from 'chalk';

/**
 * Único punto donde se aplica color. Recibe capacidades + paleta y devuelve
 * funciones de pintado que degradan solas:
 *   truecolor -> rgb, color básico -> ansi256, sin color -> identidad.
 * Ningún otro módulo importa chalk.
 */
export function painter(caps, palette) {
  if (!caps.color) {
    const id = (s) => s;
    return new Proxy({ raw: id }, { get: () => id });
  }

  const c = caps.truecolor ? chalk.level >= 3 ? chalk : chalk : chalk;

  function color(rgb) {
    if (!rgb) return (s) => s;
    return caps.truecolor ? c.rgb(rgb[0], rgb[1], rgb[2]) : c.ansi256(toAnsi256(rgb));
  }

  const painters = {};
  for (const [name, rgb] of Object.entries(palette)) painters[name] = color(rgb);
  painters.bold = c.bold;
  painters.italic = c.italic;
  painters.raw = (s) => s;
  return painters;
}

function toAnsi256([r, g, b]) {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  return (
    16 +
    36 * Math.round((r / 255) * 5) +
    6 * Math.round((g / 255) * 5) +
    Math.round((b / 255) * 5)
  );
}
