import Anthropic from '@anthropic-ai/sdk';

let _client = null;

export function anthropic() {
  if (!_client) _client = new Anthropic();
  return _client;
}

// Un modelo por etapa, los tres en Opus 5 mientras se evalúa la calidad.
// Bajar análisis y perfil a Haiku es un cambio de env var (ahorra ~11%);
// la palanca real de costo es MODEL_INTERPRET, que es ~95% del gasto.
export const MODEL_INTERPRET = process.env.ARCANA_MODEL_INTERPRET ?? 'claude-opus-5';
export const MODEL_ANALYSIS = process.env.ARCANA_MODEL_ANALYSIS ?? 'claude-opus-5';
export const MODEL_PROFILE = process.env.ARCANA_MODEL_PROFILE ?? 'claude-opus-5';

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
