/**
 * Un tema es datos, no código: paleta + ritmo + copy. Agregar un tema es
 * agregar un objeto acá; nada más en el CLI cambia.
 *
 * El tema se elige con `render.tono` que devuelve la API — que a su vez es una
 * señal semántica ("esta lectura es directa"), no una instrucción de color.
 * La API nunca sabe que existe un color.
 */
export const THEMES = {
  directo: {
    id: 'directo',
    // [r,g,b] — el adaptador de color decide si usa truecolor, 16 colores o nada.
    palette: {
      base: [220, 220, 214],
      dim: [128, 128, 122],
      accent: [214, 168, 74],   // ámbar
      mayor: [214, 168, 74],
      invertida: [196, 96, 84],
      copas: [96, 152, 196],
      oros: [176, 148, 76],
      espadas: [168, 176, 188],
      bastos: [196, 118, 74],
    },
    rhythm: { typeMs: 6, pauseMs: 220, shuffleMs: 700, clearBetweenScenes: false },
    copy: { barajando: 'Barajando', revelando: 'La tirada', leyendo: 'Leyendo' },
  },
  poetico: {
    id: 'poetico',
    palette: {
      base: [226, 220, 236],
      dim: [130, 124, 148],
      accent: [168, 130, 214],  // violeta
      mayor: [200, 168, 240],
      invertida: [188, 112, 140],
      copas: [120, 168, 208],
      oros: [188, 164, 108],
      espadas: [180, 184, 204],
      bastos: [206, 130, 108],
    },
    rhythm: { typeMs: 14, pauseMs: 600, shuffleMs: 1400, clearBetweenScenes: true },
    copy: { barajando: 'Barajando el mazo', revelando: 'Lo que salió', leyendo: 'Leyendo las cartas' },
  },
};

export function theme(id) {
  return THEMES[id] ?? THEMES.poetico;
}
