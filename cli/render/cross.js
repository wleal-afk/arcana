/**
 * Layout espacial de la tirada en cruz. Devuelve líneas listas para imprimir.
 *
 * El ancho se calcula sobre el texto crudo y el color se aplica al final, así
 * los escapes ANSI no descuadran el alineado. Por eso `pintar` recibe el item
 * y devuelve sólo el nombre pintado: el padding lo pone esta función.
 *
 * `cross()` es unicode-only por diseño: exige que el llamador ya haya
 * verificado `caps.wide === true` (que a su vez exige `caps.unicode`) antes
 * de invocarla — es responsabilidad del llamador garantizarlo. Por eso las
 * flechas de abajo van literales en vez de pasar por `glyphs(caps)`: no hay
 * variante ASCII posible para este layout, porque sin unicode el camino
 * correcto no es "cruz con glifos ASCII", es la lista vertical (que sí usa
 * `glyphs(caps)`). Agrupamos los cinco glifos en `GLYPHS` para que se vean
 * juntos y quede claro que son un set deliberado, no un descuido.
 */
const GLYPHS = { arriba: '▲', abajo: '▼', izquierda: '◀', derecha: '▶', centro: '✦' };

// Ancho mínimo de columna; crece si una celda no entra (ver anchoColumna).
const COL_MIN = 20;
// Margen de separación entre columnas, para que nunca queden pegadas.
const MARGEN = 2;

function celda(item, labels, pintar) {
  if (!item) return { label: '', nombre: '', pintado: '' };
  const marca = item.invertida ? ` ${GLYPHS.abajo} invertida` : '';
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

/**
 * Ancho de columna necesario para una celda, contando el prefijo que se le
 * antepone (flecha/símbolo) y tomando el texto crudo más largo entre su
 * rótulo y su nombre — nunca el pintado, por la misma razón que `pad()`
 * cuenta caracteres visibles: los escapes ANSI no ocupan ancho real.
 */
function anchoCelda(item, prefijo) {
  return prefijo + Math.max(item.label.length, item.nombre.length);
}

export function cross({ cartas, labels = {}, pintar = (i) => i.carta.nombre }) {
  const by = (slot) => cartas.find((c) => c.slot === slot);
  const c = (slot) => celda(by(slot), labels, pintar);

  const resultado = c('resultado');
  const consejo = c('consejo');
  const situacion = c('situacion');
  const obstaculo = c('obstaculo');
  const raiz = c('raiz');

  // consejo, situación y obstáculo comparten renglón: la columna tiene que
  // ser lo bastante ancha para la más larga de las tres, o se pegan entre sí.
  const anchoCrudo = Math.max(
    anchoCelda(consejo, 4),
    anchoCelda(situacion, 2),
    anchoCelda(obstaculo, 0),
  );
  const COL = Math.max(COL_MIN, anchoCrudo) + MARGEN;

  const centro = ' '.repeat(COL + 2);
  const lines = [];

  lines.push(`${centro}${GLYPHS.arriba} ${resultado.label}`);
  lines.push(`${centro}  ${resultado.pintado}`);
  lines.push('');
  lines.push(
    pad(`  ${GLYPHS.izquierda} ${consejo.label}`, 4 + consejo.label.length, COL) +
      pad(`${GLYPHS.centro} ${situacion.label}`, 2 + situacion.label.length, COL) +
      `${obstaculo.label} ${GLYPHS.derecha}`,
  );
  lines.push(
    pad(`    ${consejo.pintado}`, 4 + consejo.nombre.length, COL) +
      pad(`  ${situacion.pintado}`, 2 + situacion.nombre.length, COL) +
      obstaculo.pintado,
  );
  lines.push('');
  lines.push(`${centro}${GLYPHS.abajo} ${raiz.label}`);
  lines.push(`${centro}  ${raiz.pintado}`);

  return lines;
}
