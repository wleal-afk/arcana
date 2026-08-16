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

```
$ node cli/arcana.js --help
arcana — lecturas de tarot desde la terminal

  arcana                                  abre el REPL (elegís nivel de magia)
  arcana "¿tu pregunta?"                  una lectura y salir
  arcana historial [--limit N]            lecturas anteriores
  arcana olvidar                          borra la sesión y su historial

dentro del REPL
  <pregunta>     pide una lectura
  nivel <x>      cambia el nivel: alta | media | baja
  historial      lecturas anteriores
  salir          termina y muestra el resumen

opciones de presentación (sólo del cliente; la API no las conoce)
  --plain        sin color, sin animación, sin unicode
  --no-anim      mantiene el color, quita el efecto máquina de escribir
  --theme X      fuerza un tema (directo | poetico)
  --dev          muestra tokens y costo real por lectura

variables de entorno
  ARCANA_API=http://localhost:3000
  ARCANA_PRESUPUESTO=0.20   magia por corrida de terminal, en USD
  NO_COLOR=1                desactiva color (estándar no-color.org)
  ARCANA_NO_ANIM=1          desactiva animación de forma persistente
```

Sin argumentos y con terminal interactiva, `arcana` abre el REPL: pide el
nivel de magia una sola vez y después mantiene la sesión, la barra y el nivel
elegido entre pregunta y pregunta. Con argumentos —o corriendo por pipe, sin
TTY— hace un disparo y sale, sin barra ni selección de nivel: es el modo que
usan los scripts, y su comportamiento no cambió.

El nivel de magia tiene tres escalones, de más a menos gasto por lectura:

| nivel (`nivel <x>`) | nombre en el REPL |
|---|---|
| `alta` | Plenilunio |
| `media` | Media luna |
| `baja` | Luna nueva |

Al abrir el REPL se elige uno; `nivel alta` (o `media`/`baja`) lo cambia a
mitad de sesión. La barra de magia muestra cuánto de `ARCANA_PRESUPUESTO`
llevás gastado en la corrida actual: es un recordatorio de consumo, no un
tope real de gasto —se recarga sola en cuanto abrís otra terminal—. Los
dólares no se imprimen en ningún lado salvo con `--dev`.

Toda la personalidad visual —color, ritmo, animación, temas— vive en
`cli/render/`. La API no sabe que existe. Se degrada solo: sin TTY no hay
animación, sin UTF-8 usa glifos ASCII, y respeta `NO_COLOR`, `TERM=dumb`,
`CI` y `ARCANA_NO_ANIM`.

## Costo por lectura

Cada lectura guarda su consumo real en `reading_meta` — tokens crudos por etapa,
modelo que los produjo, y tokens de caché leídos/escritos. `POST /ask` lo
devuelve en `uso`, y `GET /history` acumula `costo_acumulado_usd` de la sesión.

Los **tokens** no envejecen; el **costo** se estima con la tabla de precios de
`src/llm/pricing.js`, que sí. Si los precios cambian, se actualiza esa tabla y
se puede recalcular el histórico entero. Un modelo fuera de la tabla reporta
costo `null` en vez de un número inventado.

El costo varía según el nivel elegido (`ARCANA_NIVEL_DEFAULT`): el servidor
traduce el nivel semántico a un modelo concreto por etapa. Solo cambia el modelo
de interpretación (la etapa más costosa, ~72% del gasto); el análisis y el
perfil corren siempre con `claude-haiku-4-5`. Costos medidos por lectura:
`alta` (opus 5) ~$0.029, `media` (sonnet 5) ~$0.014, `baja` (haiku 4.5) ~$0.006.

Para comparar con datos en lugar de estimaciones:

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
