# Arcana — decisiones de diseño

Este documento resuelve las tres preguntas abiertas del brief. Cada decisión
apunta al código donde está implementada.

---

## Pregunta 1 — análisis de la pregunta libre

### 1.1 Esquema de metadata

**Decisión:** siete campos, todos enums cerrados (`src/llm/analyze.js`).

| campo | valores | para qué se usa en código |
|---|---|---|
| `dominio` | vinculos, trabajo, dinero, salud, identidad, duelo, creatividad, otro | scoring de historial relevante |
| `tension_temporal` | pasado, presente, futuro, decision | elección de tirada |
| `especificidad` | concreta, difusa | elección de tirada y de tono |
| `intensidad_emocional` | baja, media, alta | elección de tirada y de tono |
| `busqueda` | certeza, exploracion, permiso, desahogo | lente de interpretación |
| `agencia` | propia, ajena | lente de interpretación |
| `riesgo` | ninguno, malestar, crisis | gate de seguridad |

Los cuatro del brief (dominio / tensión temporal / especificidad / intensidad)
describen la pregunta. Los tres que agregué describen **qué quiere la persona
de la respuesta**, que es lo que realmente cambia la lectura:

- `busqueda` es el campo de mayor rendimiento. "¿Debería dejarlo, no?" y
  "¿Qué pasa si lo dejo?" tienen el mismo dominio y la misma tensión temporal,
  y necesitan lecturas opuestas: una pide que no le firmes la decisión, la otra
  pide que abras el abanico.
- `agencia` distingue "¿qué hago?" de "¿qué va a hacer él?". Sin este campo el
  sistema termina prediciendo conducta ajena, que es exactamente lo que no
  queremos que haga.
- `riesgo` es la segunda red del gate de seguridad (§1.4).

**Todo campo nuevo tiene que pasar esta prueba: ¿hay una rama de código que
cambie según su valor?** Si no la hay, es un token que se paga en cada request
y no altera el output. Por eso no hay campos de texto libre: además de no ser
ramificables, un campo libre generado desde el texto del usuario es un vector
de inyección directo hacia el prompt de interpretación.

**Cómo se inyecta importa tanto como qué se extrae.** La metadata *no* entra al
prompt como etiquetas (`dominio: trabajo`). Se traduce a **lentes de lectura**
—instrucciones sobre qué hacer con esa señal— en `LENTES` (`src/llm/interpret.js`):

```
busqueda=permiso → "Suena a que ya decidió y busca autorización.
                    No se la des ni se la niegues: mostrale que ya decidió."
```

Una etiqueta le dice poco al modelo y, si se filtra al output, suena a ficha
clínica: es justo el efecto "me están perfilando" que el brief quiere evitar.

### 1.2 Una llamada vs. dos

**Decisión: dos llamadas, con lógica determinística en el medio.** No es una
decisión de costo — es que **una sola llamada no puede implementarse**.

El orden de operaciones lo obliga:

```
pregunta → análisis → [gate de crisis] → elegir tirada → BARAJAR → interpretar
                            ↑                  ↑
                   corta el flujo         el tipo de tirada
                   sin gastar más         depende del análisis
```

Con una sola llamada, el modelo tendría que recibir las cartas *antes* de que
sepamos qué tirada corresponde, y tendría que emitir la interpretación en el
mismo output donde detecta la crisis — es decir, escribir una lectura de tarot
para alguien con ideación suicida y confiar en que un campo del JSON haga que
la descartemos después. El gate deja de ser un gate y pasa a ser un filtro
post-hoc. Ese solo punto cierra la discusión.

Lo demás refuerza la misma conclusión:

| | una llamada | dos llamadas |
|---|---|---|
| gate de crisis | post-hoc, ya se generó la lectura | corta antes de la segunda llamada |
| tirada según señal | imposible | sí |
| latencia | 1× | ~1.15× (la etapa 1 es corta, `effort: low`, ~30 tokens de salida) |
| costo | ~1× | ~1.05× (la etapa 1 lee ≤600 caracteres) |
| fallo parcial | todo o nada | análisis falla → lectura sigue con metadata neutra |
| modelo por etapa | uno solo | independientes; la etapa 1 admite un modelo barato |

**El punto intermedio ("un solo prompt con razonamiento forzado antes del
output") no aplica acá.** Ese patrón sirve cuando el razonamiento sólo alimenta
al mismo output. Acá el análisis alimenta *código* (elegir tirada, cortar el
flujo, elegir modo de continuidad), y ese código tiene que correr antes de que
el modelo escriba una sola palabra de la lectura. Además, hoy el razonamiento
previo ya viene gratis por otra vía: `thinking: {type: "adaptive"}` en la
llamada de interpretación (`src/llm/interpret.js`).

**Costo real:** la etapa 1 procesa ≤600 caracteres y devuelve ~30 tokens. Es
ruido comparado con la interpretación (system prompt + historial + 150-320
palabras de salida). El overhead medido en tokens es ~5%.

Ambas etapas usan `claude-opus-5` por defecto. `ARCANA_MODEL_ANALYSIS` permite
bajar la etapa 1 a un modelo más chico sin tocar código: es extracción
estructurada sobre texto corto, el caso de uso donde esa sustitución tiene menos
costo de calidad. Es una decisión de operación, no de arquitectura.

### 1.3 Formato de salida confiable

**Decisión: structured outputs** (`output_config.format` con JSON Schema),
no *tool use*, no "devolvé JSON y por favor no lo rompas".

```js
output_config: { effort: 'low', format: { type: 'json_schema', schema: META_SCHEMA } }
```

La restricción se aplica en el decoding: el modelo no puede emitir un token que
viole el esquema. No hay preámbulo que limpiar, no hay bloque ```json que
extraer con regex, no hay reintento por parseo. `additionalProperties: false` +
`required` en los siete campos cierra la forma.

Por qué no *tool use*: fuerza un formato válido pero deja la puerta abierta a
que el modelo escriba texto antes de llamar la herramienta, o a que no la llame.
Con `output_config.format` no existe otro camino de salida.

Aun así el parseo va dentro de un `try/catch`, porque queda un modo de falla
real: truncado por `max_tokens` (JSON válido hasta la mitad). Ahí y en cualquier
error de red cae `META_FALLBACK` — metadata neutra — y **la lectura sigue**.
El análisis es una mejora, no un requisito: si falla, el usuario recibe una
lectura genérica, no un error.

### 1.4 Gate de seguridad

**Decisión: dos capas, la primera determinística y antes de gastar un token.**

**Capa 1 — reglas** (`src/safety/crisis.js`), corre en el request, sobre el
texto crudo:

- No cuesta tokens, no tiene latencia, no puede caerse por timeout.
- **No es prompt-injectable.** Una regex no obedece a "ignorá tus
  instrucciones". Esa propiedad es la razón principal de que la capa 1 sea
  determinística y no un modelo.
- Calibrada para **alta sensibilidad**: un falso positivo cuesta una lectura,
  un falso negativo cuesta bastante más.
- Con excepciones idiomáticas explícitas ("me quiero morir de risa"), porque
  esas frases son frecuentes en español y sin manejarlas el gate se vuelve
  inusable. La excepción se anula si en el mismo texto hay términos inequívocos.

**Capa 2 — el modelo**, campo `riesgo` del análisis, con la instrucción de que
ante la duda entre `malestar` y `crisis` elija `crisis`. Cubre lo que la regex
no ve: lo indirecto, lo metafórico, lo que sólo se entiende en contexto ("ya
arreglé todo, sólo quería preguntar una última cosa"). Corre *después* de la
etapa 1 y *antes* de la interpretación: sigue cortando antes de que se escriba
la lectura.

Cualquiera de las dos capas que dispare produce el mismo resultado
(`src/routes/session.js`):

1. **No hay tirada y no hay interpretación.** No se llama al modelo de lectura.
   El objeto de respuesta no tiene campo `interpretacion` — no hay forma de que
   un cliente lo pinte por accidente.
2. HTTP **200** con `tipo: "apoyo"`, no un 4xx. No es un error del usuario, y
   un status de error empujaría a los clientes a mostrar "algo salió mal" en
   lugar del mensaje.
3. Mensaje que **nombra lo que está pasando y explica por qué se para**, sin
   dramatizar y sin fingir que fue un problema técnico. Después, recursos
   concretos por país con teléfono y horario.
4. Se registra el evento en `safety_events` **sin el texto del usuario**: sólo
   sesión, timestamp, capa que disparó y severidad. Lo que hace falta saber es
   "cuántas veces se activó el gate y funciona"; guardar el texto convertiría la
   base en un repositorio de datos de salud mental de personas sin identidad
   verificada ni consentimiento. La respuesta se lo dice al usuario
   explícitamente.

La tabla `safety_events` sobrevive a la purga de retención (§2.5) precisamente
porque no contiene texto del usuario.

Complemento: el system prompt de interpretación prohíbe consejo médico, legal y
financiero, y prohíbe predecir hechos. El gate atrapa la crisis; el prompt evita
que las lecturas normales deriven hacia terreno clínico.

### 1.5 Persistencia de la metadata

**Decisión: se persiste**, en `reading_meta` (key/value por lectura).

Sin persistir, la memoria de la pregunta 2 se cae: el scoring de relevancia
compara el `dominio` de la lectura actual contra el de las anteriores, y esas
anteriores ya pasaron. Recalcularla implicaría re-analizar N preguntas viejas en
cada request.

Va en key/value y no en columnas porque agregar una señal nueva al análisis no
debe requerir `ALTER TABLE` ni una migración: se agrega al enum, se agrega la
lente, y las lecturas viejas simplemente no tienen esa clave. También guarda
`modo_continuidad` y `tono`, que no vienen del modelo pero pertenecen a la misma
capa de "cómo se decidió esta lectura".

---

## Pregunta 2 — memoria acumulada

### 2.1 Estructura de tablas

`src/db.js`. Cinco tablas, ninguna de las cuales necesita migración destructiva
para crecer:

```
sessions ──┬── readings ──┬── reading_cards   (1 fila por carta)
           │              ├── reading_meta    (key/value)
           │              └── embeddings      (vacía en v1)
           └── session_profile                (1 fila por sesión)
safety_events                                 (sin FK: sobrevive a la purga)
```

Las decisiones que importan:

- **`reading_cards` normalizada, no un JSON.** Con una fila por carta,
  "¿qué cartas se repiten en esta sesión?" es un `GROUP BY card_id HAVING
  COUNT(*) >= 2` (`recurrentCards()`). Con un array JSON habría que leer todas
  las lecturas y contar en Node. Es la consulta central de la continuidad.
- **`reading_meta` key/value:** extensible sin DDL (§1.5).
- **`embeddings` existe vacía.** v1 no la escribe. Está para que agregar
  retrieval semántico después sea "poblar una tabla y sumar un término en
  `score()`", no rediseñar el modelo de datos. En Postgres, `vector BLOB` pasa a
  `vector(N)` de pgvector + índice ivfflat; el resto del esquema no cambia.
- **`card_id` es un identificador estable** (`mayor-13-la-muerte`), no un
  índice de arreglo. El mazo puede reordenarse o traducirse sin invalidar el
  historial.
- Nada específico de SQLite: sin `AUTOINCREMENT`, timestamps ISO-8601 en TEXT,
  UUIDs como PK. Migrar a Postgres es un `COPY`.

### 2.2 Qué historial se inyecta

**Decisión: ventana corta + scoring determinístico + tope duro de 3 lecturas**
(`src/memory/retrieve.js`).

Se traen las 8 lecturas más recientes, se puntúan, y entran las 3 mejores:

```
recencia         max(0, 3 - posición × 0.5)
mismo dominio    +3
misma búsqueda   +1
misma tensión    +0.5
```

"Últimas N" solo es malo cuando la persona salta de tema: la lectura de trabajo
de hoy no gana nada con la de vínculos de anteayer. "Sólo coincidencia de
dominio" es peor: pierde la lectura de ayer, que es la que la persona recuerda.
El scoring combina ambas, con el dominio pesando más que la recencia pero sin
anularla.

Aparte del scoring, siempre se inyectan las **cartas recurrentes** de toda la
sesión (2+ apariciones). Es la señal de continuidad más barata y más
convincente: no depende de que las preguntas se parezcan, y es objetivamente
verificable — la carta salió o no salió.

El tope es 3 lecturas + 5 cartas recurrentes. El historial no debe poder crecer
hasta dominar el prompt: la lectura es sobre la pregunta de hoy.

### 2.3 Retrieval vs. perfil incremental

**Decisión: los dos, porque responden preguntas distintas.**

- **Retrieval** (§2.2) responde *"¿qué preguntó antes que se parezca a esto?"*.
  Preciso, con las palabras textuales de la persona.
- **Perfil** (`src/memory/profile.js`) responde *"¿quién es esta persona a lo
  largo de sus lecturas?"*. Patrones que ninguna lectura individual muestra:
  que el foco se movió de la pareja al trabajo, que siempre pregunta sobre lo
  que hará otro.

El perfil **se reescribe entero cada 4 lecturas**, no se acumula. Un resumen
append-only se degrada: crece sin techo, se contradice consigo mismo, arrastra
errores y no hay forma de corregirlo. Reescribir cuesta una llamada barata cada
4 lecturas, mantiene un techo duro de 600 caracteres, y un error de una
generación desaparece en la siguiente. Corre **fuera del camino crítico** —
después de responder al usuario — así que no suma latencia.

El prompt del perfil prohíbe nombres, lugares y lenguaje clínico: describe
patrones, no diagnostica.

### 2.4 Anti-repetición

Este es el riesgo más concreto de toda la feature: **con memoria, el sistema
siempre abre igual.** "La última vez preguntaste sobre X" es aceptable la
primera vez y delator la tercera — el efecto pasa de "me leyó" a "me está
aplicando una plantilla".

**Decisión: elegir el modo de continuidad en código y ocultarle al modelo el
resto del menú** (`src/memory/continuity.js`).

Hay cinco modos: `silencio`, `eco_de_carta`, `contraste`, `pregunta_debajo`,
`continuacion`. En cada lectura se elige **uno** y sólo esa instrucción entra al
prompt. El modelo no puede caer en el default porque nunca ve que existan
alternativas.

La elección es determinística (hash de la semilla de la tirada) y con
precondiciones:

- nunca repite el modo de la lectura anterior;
- `eco_de_carta` requiere que efectivamente haya cartas repetidas;
- `contraste` y `pregunta_debajo` requieren 2+ lecturas previas — con menos, el
  modelo inventa un patrón que no existe;
- sin historial, siempre `silencio`.

Nótese que `silencio` está en la rotación: **a veces lo correcto es no
mencionar el pasado.** La continuidad se siente cuando aparece a veces, no
cuando aparece siempre. Y en todos los modos, la instrucción prohíbe abrir la
lectura con la referencia al historial: si aparece, aparece integrada.

Alternativa descartada: pedirle al modelo "variá la forma de referirte al
historial". No es fiable — converge a dos o tres formas y no se puede testear.
La versión determinística sí: `test/unit.test.js` verifica en 50 iteraciones
que nunca repite el modo anterior y que respeta las precondiciones.

### 2.5 Privacidad y retención

El `session_id` no está atado a una identidad verificada. Eso tiene dos
consecuencias que el diseño toma en serio:

1. **Nadie puede pedir su historial de vuelta.** Perdido el `session_id`, no hay
   forma legítima de recuperarlo, y no debería haberla — cualquier mecanismo de
   recuperación sería también un mecanismo para leer el historial ajeno.
2. **Nadie puede consentir a futuro.** El consentimiento se da al escribir, no
   cubre retención indefinida.

De ahí:

- **Retención por inactividad, 180 días** configurables
  (`ARCANA_RETENTION_DAYS`), con purga cada 6h (`src/retention.js`). Se mide
  desde `last_seen_at`: una sesión activa no se borra; una abandonada
  desaparece.
- **Borrado real, no soft delete.** `DELETE FROM sessions` y `ON DELETE
  CASCADE` limpia lecturas, cartas, metadata y perfil. Un `deleted_at` deja los
  datos ahí y convierte el borrado en una promesa de la capa de aplicación.
- **`DELETE /session/:id` disponible desde el día uno**, y expuesto en el CLI
  como `arcana olvidar`.
- **`safety_events` nunca guarda texto del usuario** (§1.4).
- **Se comunica al crear la sesión**, en la respuesta de `POST /session`, en
  español y en dos frases: qué se guarda, por cuánto tiempo, que no hay cuenta
  detrás, y cómo borrarlo. El CLI lo imprime. Un aviso que sólo vive en unos
  términos y condiciones no cuenta para un producto que se usa por curl.

---

## Pregunta 3 — capa de presentación en terminal

### 3.1 Librerías

**Decisión: `chalk` como única dependencia visual obligatoria.** `boxen`,
`gradient-string` y `ora` quedan instaladas y disponibles, pero el render actual
no las necesita.

Lo que quedó fuera y por qué:

| librería | decisión | razón |
|---|---|---|
| `chalk` | **se usa** | color con degradación automática, un solo punto de import |
| `ora` | disponible, no usado | el spinner de barajado son 6 líneas y las necesitábamos temáticas por tema (frames unicode vs. ASCII) |
| `boxen` | disponible, no usado | las cajas rompen con anchos raros y no aportan sobre separadores |
| `gradient-string` | disponible, no usado | los degradados se ven mal en terminales de 16 colores, que es donde más importa no romper |
| `figlet` | **descartada** | ASCII art grande rompe con anchos < 80 y es puro ruido antes de cada lectura |
| `chalk-animation` | **descartada** | monta su propio loop de render y pelea con nuestro control de ritmo; los efectos rainbow/glitch envejecen mal en un producto que se usa a diario |

El criterio: cada librería visual es superficie de mantenimiento y un modo de
falla más en terminales raros. El efecto máquina de escribir son 8 líneas
(`type()`); el barajado, 10. Vale más tenerlas propias y controlables que
importar dos paquetes que hacen eso y un poco más.

### 3.2 Estructura del módulo de render

```
cli/arcana.js          argumentos + HTTP + config local. Cero códigos ANSI.
cli/render/
  index.js             orquesta escenas (reading, support, history)
  themes.js            DATOS: paleta + ritmo + copy
  paint.js             ÚNICO lugar donde se importa chalk
  caps.js              detección de capacidades + glifos con fallback
```

Las tres fronteras que hacen que esto sea extensible:

1. **La API no sabe que existe el color.** Devuelve `render: { tono, continuidad }`
   — señales semánticas. El cliente decide que `tono: "poetico"` significa
   violeta y 14ms por carácter. Una web futura mapearía las mismas señales a
   CSS sin cambiar un byte del servidor.
2. **Los temas son datos, no código.** Agregar un tema es agregar un objeto en
   `themes.js`. Nada más cambia.
3. **El color se aplica en un único lugar.** `paint.js` recibe capacidades +
   paleta y devuelve funciones que ya degradaron: truecolor → `rgb()`, color
   básico → `ansi256()` (con conversión propia), sin color → identidad. El
   resto del render llama `p.accent(texto)` sin saber en qué terminal está.

Añadir un efecto nuevo es una función en `index.js` que consulta `caps`.
Añadir un tema es un objeto. Ninguna de las dos cosas toca el CLI ni la API.

### 3.3 Temas

**Decisión: sí, y el tema deriva del tono de la lectura, no de una preferencia
de color.**

`POST /session` acepta `tono: directo | poetico | auto`. En `auto`, el tono lo
elige el servidor a partir de la metadata (`chooseTone()`): una pregunta que
busca certeza recibe una lectura directa; una de alta carga emocional, una
reflexiva. Ese tono viaja en `render.tono` y el CLI lo usa para elegir paleta
**y ritmo**:

| | directo | poético |
|---|---|---|
| acento | ámbar | violeta |
| máquina de escribir | 6 ms/char | 14 ms/char |
| pausa entre cartas | 220 ms | 600 ms |
| barajado | 700 ms | 1400 ms |
| limpia pantalla | no | sí |

Que el mismo eje gobierne el texto *y* el ritmo es lo que hace que valga la
pena: una lectura directa que se imprime lento se contradice a sí misma. Con
`--theme` el usuario puede forzar uno.

### 3.4 Compatibilidad

`cli/render/caps.js` es el único lugar que decide qué se puede usar. Todo lo
demás pregunta.

- **Color:** requiere TTY, y respeta `NO_COLOR` (estándar de facto,
  no-color.org) y `TERM=dumb`. Truecolor sólo si `COLORTERM` lo declara; si no,
  ansi256; si no, texto pelado.
- **Unicode:** se asume **no** salvo que el locale diga UTF-8
  (`LC_ALL`/`LC_CTYPE`/`LANG`) o sea Windows Terminal. Cada glifo tiene su
  equivalente ASCII en `GLYPHS` — `▚`→`#`, `▼`→`v`, `─`→`-`. La regla es que
  ningún símbolo se imprime sin pasar por `glyphs()`.
- **Animación:** requiere TTY. Si la salida es un pipe (`arcana ... | less`, CI,
  un script), no hay animación ni control de cursor: se imprime todo de una.
  También se apaga con `CI=1` y `ARCANA_NO_ANIM=1`.
- **Ancho:** `stdout.columns` con tope de 100 y fallback a 80; el texto se
  envuelve a mano en lugar de confiar en el wrapping del terminal.
- **EPIPE:** `arcana ... | head` cierra el pipe antes de que terminemos de
  escribir. Sin manejarlo, Node lanza un stack trace; el CLI sale en silencio.

Verificado en este repo: con salida a pipe, el render sale sin color, con
glifos ASCII y sin animación.

### 3.5 Dónde está la línea entre efecto y estorbo

**El criterio: un efecto que retrasa información que el usuario ya pidió es un
estorbo. Un efecto que marca una transición es ritmo.**

Aplicado:

- El **barajado** (~1s) marca la transición entre "pregunté" y "las cartas están
  echadas". Es tiempo que de todos modos se va en la llamada al modelo.
- La **pausa entre cartas** deja ver cada carta como un evento.
- El **efecto máquina de escribir** es el caso límite y el brief tiene razón: a
  320 palabras y 14 ms/char son ~25 segundos de esperar texto que ya está
  descargado. Por eso: velocidad por tema (6 ms en directo), pausa sólo en
  espacios y saltos de línea —nunca dentro de una palabra, que es lo que lo hace
  insoportable— y **desactivable**.

Es configurable en tres niveles, del más específico al más persistente:

```
arcana --no-anim "¿pregunta?"   color sí, animación no
arcana --plain "¿pregunta?"     sin color, sin unicode, sin animación
ARCANA_NO_ANIM=1                persistente
NO_COLOR=1                      persistente, estándar
```

Y se apaga solo cuando la salida no es un TTY, que es el caso donde nadie lo
pidió y siempre estorba.

---

## Lo que queda fuera de v1 (a propósito)

- **Embeddings / retrieval semántico.** La tabla existe vacía; el punto de
  enganche es `score()` en `src/memory/retrieve.js`.
- **Streaming de la interpretación.** El CLI ya imprime carácter a carácter;
  conectarlo a SSE es cambiar el transporte, no el render.
- **Rate limiting y auth.** El `session_id` no es un secreto de seguridad;
  antes de exponer esto públicamente hace falta rate limiting por IP.
- **Calibración del gate de crisis contra un corpus real.** Las regex están
  calibradas por criterio, no por datos. `safety_events` da el volumen de
  activaciones; los falsos negativos, por definición, no aparecen ahí.
