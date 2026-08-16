import Anthropic from '@anthropic-ai/sdk';

let _client = null;

export function anthropic() {
  if (!_client) _client = new Anthropic();
  return _client;
}

// Ambas etapas usan Opus 5 por defecto. La etapa de análisis es la que
// naturalmente admite un modelo más barato: es extracción estructurada de un
// texto corto. Se cambia con ARCANA_MODEL_ANALYSIS sin tocar código.
export const MODEL_ANALYSIS = process.env.ARCANA_MODEL_ANALYSIS ?? 'claude-opus-5';
export const MODEL_INTERPRET = process.env.ARCANA_MODEL_INTERPRET ?? 'claude-opus-5';

export function textOf(response) {
  return response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}
