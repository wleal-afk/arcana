import Anthropic from '@anthropic-ai/sdk';

let _client = null;

export function anthropic() {
  if (!_client) _client = new Anthropic();
  return _client;
}

/**
 * Presets de nivel. El escalón real lo marca `interpret`: en la lectura medida
 * se llevó el 72% del gasto. El análisis produce ~77 tokens de salida, así que
 * subirlo de Haiku agrega costo y no calidad percibida.
 */
export const NIVELES = {
  alta:  { interpret: 'claude-opus-5',    analysis: 'claude-haiku-4-5', profile: 'claude-haiku-4-5' },
  media: { interpret: 'claude-sonnet-5',  analysis: 'claude-haiku-4-5', profile: 'claude-haiku-4-5' },
  baja:  { interpret: 'claude-haiku-4-5', analysis: 'claude-haiku-4-5', profile: 'claude-haiku-4-5' },
};

export const NIVEL_DEFAULT = NIVELES[process.env.ARCANA_NIVEL_DEFAULT] ? process.env.ARCANA_NIVEL_DEFAULT : 'alta';

/** Un nivel desconocido no es un error: cae al default. */
export function resolveNivel(nivel) {
  return NIVELES[nivel] ?? NIVELES[NIVEL_DEFAULT];
}

// Haiku 4.5 y Sonnet 4.5 son de la generación anterior a `effort` y al thinking
// adaptativo: mandarles cualquiera de los dos devuelve 400. Structured outputs
// sí los soportan. Esta función es lo que hace que cambiar de modelo por env
// var sea seguro y no rompa el request.
const SIN_EFFORT_NI_ADAPTIVE = /haiku-4-5|sonnet-4-5|haiku-3|opus-4-1|opus-4-0/;

export function tune(model, { effort, format, thinking = true } = {}) {
  const legado = SIN_EFFORT_NI_ADAPTIVE.test(model);
  const params = {};
  const outputConfig = {};

  if (format) outputConfig.format = format;
  if (effort && !legado) outputConfig.effort = effort;
  if (Object.keys(outputConfig).length) params.output_config = outputConfig;
  if (thinking && !legado) params.thinking = { type: 'adaptive' };

  return params;
}

export function textOf(response) {
  return response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}
