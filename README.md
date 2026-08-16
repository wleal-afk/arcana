# arcana

Lectura de tarot programática, con IA y magia integrada.

API de texto plano pensada para usarse desde la terminal. Sin frontend, sin
login: cada cliente guarda un `session_id` local. La personalización sale de la
pregunta que la persona escribe y de su historial — nunca de un formulario.

Las decisiones de diseño (análisis de la pregunta, memoria entre sesiones, capa
de presentación) están en **[DESIGN.md](./DESIGN.md)**.

## Correr en local

Requiere Node 22+ (usa `--env-file-if-exists`, sin dependencia de dotenv).

```bash
npm install
cp .env.example .env      # y poné tu ANTHROPIC_API_KEY
npm start                 # http://localhost:3000
```

En otra terminal:

```bash
npm test        # unitarios — no llaman al modelo, ~0.4s
npm run smoke   # camino real end-to-end — SÍ gasta tokens
```

`npm run smoke` es el que responde "¿la integración funciona?". Hace dos
lecturas seguidas a propósito: la segunda verifica que la memoria entre lecturas
y la rotación de modos de continuidad estén funcionando. Imprime ambas
interpretaciones para poder juzgarlas a ojo, que es lo que ningún assert cubre.

Después, probá el CLI contra ese mismo servidor:

```bash
npm run cli -- "¿debería aceptar la oferta de trabajo?"
npm run cli -- historial
npm run cli -- --plain "misma pregunta, sin color ni animación"
```

## API

La API devuelve JSON y es agnóstica de presentación: ni un color, ni un código
ANSI, ni una decisión de layout.

```bash
# crear sesión
curl -s -XPOST localhost:3000/session \
  -H 'content-type: application/json' -d '{"tono":"auto"}'

# pedir una lectura
curl -s -XPOST localhost:3000/session/$SID/ask \
  -H 'content-type: application/json' \
  -d '{"pregunta":"¿debería aceptar el trabajo o quedarme donde estoy?"}'

# historial
curl -s localhost:3000/session/$SID/history

# borrar todo
curl -s -XDELETE localhost:3000/session/$SID
```

| endpoint | qué hace |
|---|---|
| `POST /session` | crea sesión. Devuelve `session_id` y el aviso de retención. |
| `POST /session/:id/ask` | análisis → gate de crisis → tirada → interpretación |
| `GET /session/:id/history` | lecturas anteriores (`?limit=N`) |
| `DELETE /session/:id` | borrado real, con cascada |
| `GET /health` | ok |

`/ask` devuelve uno de tres tipos:

- `tipo: "lectura"` — tirada + interpretación + `render: { tono, continuidad }`
- `tipo: "apoyo"` — se detectaron señales de crisis: **sin tirada, sin
  interpretación**, con recursos de ayuda ([DESIGN.md §1.4](./DESIGN.md))
- `tipo: "sin_lectura"` — el modelo declinó; reformular

## CLI

```bash
node cli/arcana.js nueva                          # crea sesión (~/.config/arcana)
node cli/arcana.js "¿debería aceptar el trabajo?" # lectura
node cli/arcana.js historial
node cli/arcana.js olvidar                        # borra sesión e historial
```

Toda la personalidad visual —color, ritmo, animación, temas— vive en
`cli/render/`. La API no sabe que existe.

```
--plain      sin color, sin unicode, sin animación
--no-anim    color sí, efecto máquina de escribir no
--theme X    fuerza tema (directo | poetico)
```

Se degrada solo: sin TTY no hay animación, sin UTF-8 usa glifos ASCII, y respeta
`NO_COLOR`, `TERM=dumb`, `CI` y `ARCANA_NO_ANIM`.

## Costo por lectura

Cada lectura guarda su consumo real en `reading_meta` — tokens crudos por etapa,
modelo que los produjo, y tokens de caché leídos/escritos. `POST /ask` lo
devuelve en `uso`, y `GET /history` acumula `costo_acumulado_usd` de la sesión.

Los **tokens** no envejecen; el **costo** se estima con la tabla de precios de
`src/llm/pricing.js`, que sí. Si los precios cambian, se actualiza esa tabla y
se puede recalcular el histórico entero. Un modelo fuera de la tabla reporta
costo `null` en vez de un número inventado.

Sirve para comparar modelos con datos y no con estimaciones:

```bash
ARCANA_NIVEL_DEFAULT=media npm start   # y volvé a correr el smoke
```

## Configuración

| variable | default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | requerida |
| `PORT` | `3000` | |
| `ARCANA_DB` | `./data/arcana.db` | |
| `ARCANA_RETENTION_DAYS` | `180` | purga por inactividad |
| `ARCANA_NIVEL_DEFAULT` | `alta` | nivel cuando el request no manda uno: `alta` (opus 5), `media` (sonnet 5), `baja` (haiku 4.5) |
| `ARCANA_PRESUPUESTO` | `0.20` | magia por corrida de terminal, en USD |
| `ARCANA_API` | `http://localhost:3000` | usada por el CLI |

## Tests

```bash
npm test
```

Cubren mazo, determinismo de la tirada, gate de crisis (positivos e
idiomáticos), rotación de modos de continuidad y el ciclo HTTP de sesión. No
llaman al modelo.

## Estructura

```
src/
  server.js            express
  db.js                esquema SQLite
  retention.js         purga por inactividad
  routes/session.js    los tres endpoints + gate
  tarot/               mazo (78) y tirada determinística por semilla
  llm/                 analyze (structured outputs) + interpret
  memory/              retrieve, continuity (anti-repetición), profile
  safety/crisis.js     gate determinístico + recursos
cli/
  arcana.js            argumentos + HTTP. Cero ANSI.
  render/              capacidades, temas, pintado, escenas
```
