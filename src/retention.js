import { db } from './db.js';

export const RETENTION_DAYS = Number(process.env.ARCANA_RETENTION_DAYS ?? 180);

/**
 * El session_id no está atado a una identidad verificada: nadie puede pedir su
 * historial "de vuelta", y nadie puede consentir por él más allá del momento en
 * que escribió. Eso empuja a una retención acotada y a borrado real (no soft
 * delete): pasado el período de inactividad, la sesión y todo lo que cuelga de
 * ella se eliminan por ON DELETE CASCADE.
 *
 * Los safety_events sobreviven a propósito: no contienen texto del usuario y
 * son el único registro operativo de que el gate funciona.
 */
export function purgeExpired() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  const info = db.prepare('DELETE FROM sessions WHERE last_seen_at < ?').run(cutoff);
  if (info.changes > 0) console.log(`[retencion] ${info.changes} sesiones purgadas (corte ${cutoff})`);
  return info.changes;
}

export function schedulePurge(intervalMs = 6 * 60 * 60 * 1000) {
  purgeExpired();
  const t = setInterval(purgeExpired, intervalMs);
  t.unref();
  return t;
}
