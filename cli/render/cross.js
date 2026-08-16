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
