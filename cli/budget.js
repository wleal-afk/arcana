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
