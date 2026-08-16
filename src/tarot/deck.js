// Mazo completo (78 cartas). `id` es estable y es la clave que usa
// reading_cards.card_id, así que no debe cambiar entre versiones.

const MAYORES = [
  'El Loco', 'El Mago', 'La Sacerdotisa', 'La Emperatriz', 'El Emperador',
  'El Hierofante', 'Los Enamorados', 'El Carro', 'La Fuerza', 'El Ermitaño',
  'La Rueda de la Fortuna', 'La Justicia', 'El Colgado', 'La Muerte',
  'La Templanza', 'El Diablo', 'La Torre', 'La Estrella', 'La Luna',
  'El Sol', 'El Juicio', 'El Mundo',
];

const PALOS = [
  { id: 'copas', nombre: 'Copas', elemento: 'agua', dominio: 'emocional' },
  { id: 'oros', nombre: 'Oros', elemento: 'tierra', dominio: 'material' },
  { id: 'espadas', nombre: 'Espadas', elemento: 'aire', dominio: 'mental' },
  { id: 'bastos', nombre: 'Bastos', elemento: 'fuego', dominio: 'vital' },
];

const RANGOS = [
  'As', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete',
  'Ocho', 'Nueve', 'Diez', 'Sota', 'Caballo', 'Reina', 'Rey',
];

function slug(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export const DECK = [
  ...MAYORES.map((nombre, i) => ({
    id: `mayor-${String(i).padStart(2, '0')}-${slug(nombre)}`,
    nombre,
    arcano: 'mayor',
    numero: i,
    palo: null,
    elemento: null,
    dominio: null,
  })),
  ...PALOS.flatMap((palo) =>
    RANGOS.map((rango, i) => ({
      id: `${palo.id}-${String(i + 1).padStart(2, '0')}`,
      nombre: `${rango} de ${palo.nombre}`,
      arcano: 'menor',
      numero: i + 1,
      palo: palo.id,
      elemento: palo.elemento,
      dominio: palo.dominio,
    })),
  ),
];

const BY_ID = new Map(DECK.map((c) => [c.id, c]));

export function cardById(id) {
  return BY_ID.get(id) ?? null;
}

export const SPREADS = {
  // Una carta: preguntas cerradas o de alta urgencia (menos ruido, más foco).
  unica: ['presente'],
  // Tres cartas: el default.
  tres: ['pasado', 'presente', 'futuro'],
  // Cruz: preguntas de decisión donde hay fuerzas en tensión.
  cruz: ['situacion', 'obstaculo', 'raiz', 'consejo', 'resultado'],
};
