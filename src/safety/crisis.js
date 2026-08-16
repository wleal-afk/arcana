import { randomUUID } from 'node:crypto';
import { db, nowISO } from '../db.js';

// Capa 1: detección determinística. Corre ANTES de cualquier llamada al modelo,
// no cuesta tokens, no puede fallar por timeout y no se puede "prompt-injectar".
// Está calibrada para alta sensibilidad: un falso positivo cuesta una lectura,
// un falso negativo cuesta bastante más.
const PATRONES = [
  // Ideación suicida explícita
  /\b(me\s+quiero\s+(morir|matar)|quiero\s+morirme?|quiero\s+matarme)\b/i,
  /\b(suicid(arme|arme|io|a|arse)|quitarme\s+la\s+vida|acabar\s+con\s+mi\s+vida)\b/i,
  /\bno\s+quiero\s+(seguir\s+)?vivir\b/i,
  /\b(mejor\s+(estar[íi]a|estarian?)\s+muert[oa])\b/i,
  /\b(kill\s+myself|end\s+my\s+life|want\s+to\s+die|suicidal)\b/i,
  // Autolesión
  /\b(autolesion|autolesionarme|cortarme|hacerme\s+da[ñn]o|lastimarme)\b/i,
  /\b(self[-\s]?harm|hurt\s+myself|cutting\s+myself)\b/i,
  // Plan / medios
  /\b(pastillas|sobredosis|overdose)\b.{0,30}\b(todas|de\s+golpe|para\s+acabar)\b/i,
  // Desesperanza aguda combinada
  /\bya\s+no\s+(aguanto|puedo)\s+m[aá]s\b.{0,60}\b(vivir|existir|nada)\b/i,
];

// Frases que suenan parecido pero son idiomáticas. Se evalúan sobre el match,
// no sobre el texto completo, para no abrir un agujero en el gate.
const IDIOMATICO = [
  /\bme\s+quiero\s+morir\s+de\s+(risa|verg[üu]enza|hambre|sue[ñn]o|amor)\b/i,
  /\bme\s+muero\s+de\s+ganas\b/i,
];

export function detectCrisis(text) {
  if (!text) return { crisis: false };
  const normalizado = text.normalize('NFC');

  if (IDIOMATICO.some((r) => r.test(normalizado)) && !/\b(suicid|autolesi|matarme)/i.test(normalizado)) {
    return { crisis: false };
  }

  for (const r of PATRONES) {
    if (r.test(normalizado)) {
      return { crisis: true, source: 'reglas', severity: 'alta' };
    }
  }
  return { crisis: false };
}

/**
 * Registra el evento SIN el texto del usuario. Lo que se necesita operativamente
 * es "cuántas veces se activó el gate y en qué sesiones", no el contenido.
 * Guardar el texto convertiría a la DB en un repositorio de datos de salud
 * mental sin consentimiento ni identidad verificada.
 */
export function logSafetyEvent({ sessionId, source, severity }) {
  db.prepare(
    'INSERT INTO safety_events (id, session_id, created_at, source, severity) VALUES (?, ?, ?, ?, ?)',
  ).run(randomUUID(), sessionId, nowISO(), source, severity);
}

export const RECURSOS = [
  { pais: 'MX', nombre: 'Línea de la Vida', contacto: '800 911 2000', horario: '24/7' },
  { pais: 'ES', nombre: 'Línea de atención a la conducta suicida', contacto: '024', horario: '24/7' },
  { pais: 'AR', nombre: 'Salud Mental Responde', contacto: '0800 999 0091', horario: '24/7' },
  { pais: 'CO', nombre: 'Línea 106', contacto: '106', horario: '24/7' },
  { pais: 'CL', nombre: 'Salud Responde', contacto: '600 360 7777', horario: '24/7' },
  { pais: 'US', nombre: '988 Suicide & Crisis Lifeline', contacto: '988', horario: '24/7' },
  { pais: '*', nombre: 'Directorio internacional', contacto: 'https://findahelpline.com', horario: '—' },
];

export function crisisResponse() {
  return {
    tipo: 'apoyo',
    mensaje: [
      'Leí lo que escribiste y prefiero parar aquí en vez de darte una tirada.',
      '',
      'No soy la herramienta adecuada para esto, y no quiero que una lectura de cartas',
      'ocupe el lugar de alguien que sí puede acompañarte ahora mismo.',
      '',
      'Si estás en peligro inmediato, busca atención de emergencia en tu zona.',
      'Si no, hablar con una de estas líneas es un buen primer paso — son gratuitas',
      'y confidenciales:',
    ].join('\n'),
    recursos: RECURSOS,
    nota: 'Este evento no guardó el texto de tu pregunta.',
  };
}
