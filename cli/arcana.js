#!/usr/bin/env node
/**
 * CLI delgado: parsea argumentos, hace HTTP, guarda el session_id local y
 * delega TODO lo visual a ./render. No hay un solo código ANSI en este archivo.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRenderer } from './render/index.js';

// `arcana ... | head` cierra el pipe antes de que terminemos de escribir.
// Sin esto, Node lanza EPIPE con un stack trace; el comportamiento correcto
// de un CLI es salir en silencio.
for (const s of [process.stdout, process.stderr]) {
  s.on('error', (err) => {
    if (err.code === 'EPIPE') process.exit(0);
    throw err;
  });
}

const API = process.env.ARCANA_API ?? 'http://localhost:3000';
const CONFIG = process.env.ARCANA_CONFIG ?? join(homedir(), '.config', 'arcana', 'session.json');

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  mkdirSync(dirname(CONFIG), { recursive: true });
  writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error ?? `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--plain') flags.plain = true;
    else if (a === '--no-anim') flags.noAnim = true;
    else if (a === '--theme') flags.theme = argv[++i];
    else if (a === '--tono') flags.tono = argv[++i];
    else if (a === '--limit') flags.limit = argv[++i];
    else if (a === '-h' || a === '--help') flags.help = true;
    else rest.push(a);
  }
  return { flags, rest };
}

const HELP = `arcana — lecturas de tarot desde la terminal

  arcana nueva [--tono directo|poetico]   crea una sesión
  arcana "¿tu pregunta?"                  pide una lectura
  arcana historial [--limit N]            lecturas anteriores
  arcana olvidar                          borra la sesión y su historial

opciones de presentación (sólo del cliente; la API no las conoce)
  --plain        sin color, sin animación, sin unicode
  --no-anim      mantiene el color, quita el efecto máquina de escribir
  --theme X      fuerza un tema (directo | poetico)

variables de entorno
  ARCANA_API=http://localhost:3000
  NO_COLOR=1        desactiva color (estándar no-color.org)
  ARCANA_NO_ANIM=1  desactiva animación de forma persistente
`;

async function main() {
  const { flags, rest } = parseArgs(process.argv.slice(2));

  const capOverrides = {};
  if (flags.plain) Object.assign(capOverrides, { color: false, unicode: false, animation: false });
  if (flags.noAnim) capOverrides.animation = false;

  const render = createRenderer({ caps: capOverrides, theme: flags.theme });

  if (flags.help || rest.length === 0) {
    process.stdout.write(HELP);
    return;
  }

  const cfg = loadConfig();
  const cmd = rest[0];

  if (cmd === 'nueva') {
    const res = await api('/session', { method: 'POST', body: { tono: flags.tono ?? 'auto' } });
    saveConfig({ ...cfg, session_id: res.session_id });
    render.info(`sesión creada: ${res.session_id}`);
    render.info(res.aviso);
    return;
  }

  if (!cfg.session_id) {
    const res = await api('/session', { method: 'POST', body: { tono: flags.tono ?? 'auto' } });
    saveConfig({ ...cfg, session_id: res.session_id });
    render.info(`(sesión nueva creada: ${res.session_id})`);
    cfg.session_id = res.session_id;
  }

  if (cmd === 'historial') {
    const res = await api(`/session/${cfg.session_id}/history?limit=${flags.limit ?? 20}`);
    render.history(res);
    return;
  }

  if (cmd === 'olvidar') {
    await api(`/session/${cfg.session_id}`, { method: 'DELETE' });
    saveConfig({ ...cfg, session_id: undefined });
    render.info('historial borrado.');
    return;
  }

  // Cualquier otra cosa es la pregunta.
  const pregunta = rest.join(' ');
  const res = await api(`/session/${cfg.session_id}/ask`, {
    method: 'POST',
    body: { pregunta },
  });

  if (res.tipo === 'apoyo') return render.support(res);
  if (res.tipo === 'sin_lectura') return render.info(res.mensaje);
  await render.reading(res);
}

main().catch((err) => {
  createRenderer().error(err.message);
  process.exitCode = 1;
});
