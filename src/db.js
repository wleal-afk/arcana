import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.ARCANA_DB ?? './data/arcana.db';

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Esquema pensado para crecer sin migración destructiva:
//  - `readings` guarda lo mínimo de v1 (pregunta, timestamp, sesión).
//  - `reading_cards` normaliza la tirada (1 fila por carta) en vez de un JSON
//    opaco: permite `GROUP BY card_id` para "cartas recurrentes" sin parsear.
//  - `reading_meta` es un key/value tipado. Añadir una señal nueva al análisis
//    NO requiere ALTER TABLE, y migrar a Postgres es un COPY directo.
//  - `session_profile` guarda el resumen incremental (1 fila por sesión).
//  - `embeddings` existe vacía en v1; es el punto de enganche para pgvector.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  tone         TEXT NOT NULL DEFAULT 'auto',
  deleted_at   TEXT
);

CREATE TABLE IF NOT EXISTS readings (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  question    TEXT NOT NULL,
  spread      TEXT NOT NULL,
  seed        TEXT NOT NULL,
  interpretation TEXT
);
CREATE INDEX IF NOT EXISTS idx_readings_session ON readings(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reading_cards (
  reading_id TEXT NOT NULL REFERENCES readings(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  slot       TEXT NOT NULL,
  card_id    TEXT NOT NULL,
  reversed   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (reading_id, position)
);
CREATE INDEX IF NOT EXISTS idx_reading_cards_card ON reading_cards(card_id);

CREATE TABLE IF NOT EXISTS reading_meta (
  reading_id TEXT NOT NULL REFERENCES readings(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  PRIMARY KEY (reading_id, key)
);
CREATE INDEX IF NOT EXISTS idx_reading_meta_key ON reading_meta(key, value);

CREATE TABLE IF NOT EXISTS session_profile (
  session_id      TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  summary         TEXT NOT NULL,
  readings_at_gen INTEGER NOT NULL,
  updated_at      TEXT NOT NULL
);

-- v1 no la escribe. Existe para que añadir retrieval semántico más adelante
-- no obligue a rehacer el modelo de datos (en Postgres: vector(N) + índice ivfflat).
CREATE TABLE IF NOT EXISTS embeddings (
  reading_id TEXT PRIMARY KEY REFERENCES readings(id) ON DELETE CASCADE,
  model      TEXT NOT NULL,
  vector     BLOB NOT NULL,
  created_at TEXT NOT NULL
);

-- Eventos de crisis. Deliberadamente NO guarda el texto del usuario.
CREATE TABLE IF NOT EXISTS safety_events (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  source     TEXT NOT NULL,
  severity   TEXT NOT NULL
);
`;

db.exec(SCHEMA);

export function nowISO() {
  return new Date().toISOString();
}
