# Selector interactivo, revelado de cartas e idioma neutro

Fecha: 2026-08-16
Estado: aprobado, pendiente de plan de implementación
Depende de: `2026-08-16-cli-repl-magia-design.md` (el REPL ya existe)

## Problema

El REPL funciona, pero cinco cosas se sienten mal al usarlo:

1. **El nivel se elige escribiendo un número.** Funciona, pero es la primera
   pantalla del producto y se ve como un menú de cajero automático.
2. **El prompt no dice qué se espera.** Después de elegir nivel aparece un `›`
   pelado; no queda claro si hay que escribir un comando o una pregunta.
3. **Las cartas aparecen todas de golpe.** No hay revelado; el bloque completo
   se imprime en un instante, sin ceremonia.
4. **El typewriter quedó demasiado rápido.** Se acotó el total a ~4 s para que
   los textos largos no cansaran, y eso aplanó los dos temas: hoy directo y
   poético van al mismo ritmo, cuando existían justamente para ir distinto.
5. **Las lecturas hablan en rioplatense.** El system prompt está escrito en
   voseo, y el modelo imita el registro en que se le habla.

Y un defecto aparte: el historial no marca las cartas invertidas. Sólo cambia
el color, que en `--plain` no existe y que de todos modos nadie sabe leer.

## Alcance

Entra: selector con flechas, prompt de pregunta, revelado carta por carta,
ritmo de tipeo por tema con skip, marca de invertida en el historial, y paso a
español latinoamericano neutro en prompts y copy.

No entra: pantallas de configuración, migración a Ink, streaming token a token
de la interpretación. Si el CLI crece a varias pantallas navegables, conviene
evaluar Ink antes de construir medio Ink a mano.

## Decisiones tomadas

| Decisión | Elección | Razón |
|---|---|---|
| Revelado | Una carta por vez, en su posición final | Sirve para los tres tipos de tirada; el volteo de dorso exige repintar el tablero y conviene después |
| Ritmo de tipeo | Por tema: directo ~7 s, poético ~15 s | Los temas ya existían para diferenciarse; el tope único los aplanaba |
| Saltear la animación | Cualquier tecla revela todo | Permite ceremonia larga sin castigar a quien ya leyó |
| Invertidas | Se marca sólo la invertida | Menos ruido; la ausencia de marca significa al derecho |
| Frontera de ANSI | Color en `paint.js`, cursor en `cursor.js` | La regla siempre fue sobre color; el control de cursor ya estaba suelto |
| Mensaje de crisis | No se toca | Ya está en neutro y es el copy de mayor riesgo del producto |

## Arquitectura

### El selector (`cli/render/select.js`)

Módulo nuevo con una sola responsabilidad: mostrar una lista, permitir moverse
con flechas, devolver el índice elegido. No sabe de niveles ni de tarot.

```
  ¿Con cuánta magia quieres leer?

  › ◆◆◆  Plenilunio    ~6 lecturas
    ◆◆◇  Media luna    ~14 lecturas
    ◆◇◇  Luna nueva    ~34 lecturas

  ↑↓ para elegir · Enter para confirmar
```

Mecánica: `setRawMode(true)`, decodificar las secuencias de escape de las
flechas (`\x1b[A` arriba, `\x1b[B` abajo), subir N líneas con `\x1b[${n}A` y
repintar el bloque completo en cada tecla.

En modo raw la terminal deja de proteger, así que hay tres obligaciones:

- **Ctrl+C** llega como el byte `\x03` y ya no mata el proceso. Sin capturarlo,
  la persona queda atrapada. Ctrl+D (`\x04`) igual.
- **El cursor** se oculta durante la selección y se restaura en `finally`. Un
  proceso que muere con el cursor oculto deja la terminal rota hasta un `reset`.
- **El modo raw** se apaga en `finally`, por lo mismo.

Como red de seguridad adicional, `process.on('exit')` restaura cursor y modo
aunque el proceso muera por un camino no previsto.

**Sin TTY no hay selector:** con pipe, `--plain` o sin terminal interactiva cae
al prompt numerado actual. La decisión vive en `caps`.

### Frontera de ANSI (`cli/render/cursor.js`)

La regla del proyecto —ningún ANSI fuera de `paint.js`— siempre fue sobre
color, pero ya hay control de cursor suelto en `index.js` (`\r` del barajado,
`\x1b[2J\x1b[H` de `clear()`). El selector suma ocultar cursor, mover y borrar
bloques.

Se agrupa todo el control de cursor y pantalla en `cli/render/cursor.js`, y la
regla pasa a ser: **color en `paint.js`, cursor en `cursor.js`, nadie más
escribe escapes.**

### El prompt de la pregunta

Después de elegir nivel, la primera vez:

```
  ◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈   plenilunio

  ¿Qué quieres saber? Escribe tu pregunta o lo que quieras consultar
  con las cartas.

  ›
```

En las lecturas siguientes sólo queda la barra y el `›`: la instrucción no se
repite.

### El revelado

Una carta por vez, reusando `r.pauseMs` de los temas (220 ms directo, 600 ms
poético), que hoy casi no se nota.

- **Lista vertical:** se imprime un renglón, se espera, se imprime el siguiente.
- **Cruz:** es un bloque de ocho líneas donde las cartas no están en orden de
  lectura. Se dibuja el tablero con las posiciones vacías y se repinta el bloque
  cinco veces, agregando una carta cada vez. Cinco repintados de ocho líneas,
  posible ahora que existe `cursor.js`.

### El ritmo del tipeo

Se agrega `tipeoTotalMs` al ritmo de cada tema: **7000 en directo, 15000 en
poético**. `ritmoTipeo` deja de aplanar ambos con un tope único y calcula el ms
por carácter para llegar a ese total. Se conserva el piso que evita que un texto
larguísimo lo lleve a cero.

**El skip:** durante la animación, cualquier tecla revela el resto de golpe.

Sutileza que hay que respetar: durante la animación el REPL tiene un `readline`
vivo esperando la próxima pregunta. Si se activa un listener en modo raw sin
pausar `readline`, la tecla del skip entra al buffer y aparece escrita en el
prompt siguiente. Hay que pausar `readline`, escuchar, y restaurarlo en
`finally`.

### Las invertidas

Se mantiene la marca sólo en la carta invertida. El cambio está en el historial
(`cli/render/index.js:162`), que hoy sólo pinta el nombre con color:

```
  2026-08-16 14:32  ¿debería aceptar la oferta?
                    El Sol • Diez de Oros • Sota de Bastos ▼ • As de Oros • La Torre
```

En el historial se usa el `▼` solo, sin la palabra: hay cinco cartas por
renglón y "invertida" cinco veces sería ilegible. En la tirada, con una carta
por línea, se mantiene la palabra completa.

### El idioma

El trabajo real está en los prompts, no en el CLI.

**`src/llm/interpret.js`** — el system prompt está en voseo de punta a punta
("Cómo leés", "Hablás con la persona", "No predecís hechos", "leé lo que la
persona está sintiendo y decí con naturalidad", "Terminás con algo",
"entrelazalas"). Los tonos igual ("Nombrá las cosas por su nombre", "Dejá
espacio a la ambigüedad") y los modos de continuidad también ("Devolvé el
foco", línea 62).

Todo pasa a neutro: "Cómo lees", "Hablas con la persona", "lee lo que la
persona está sintiendo y di con naturalidad", "Nombra las cosas por su nombre",
"Devuelve el foco".

Además se agrega una instrucción explícita al system prompt: hablar en español
latinoamericano neutro, sin voseo ni modismos regionales. Confiar sólo en la
imitación es frágil — basta que la pregunta venga con voseo para que el modelo
lo espeje.

**Barrer también** `src/llm/analyze.js` y `src/memory/profile.js` por
imperativos rioplatenses.

**El copy del CLI:** cinco cadenas ("¿Con cuánta magia querés leer?", "elegí 1,
2 o 3", "no hay servidor. levantalo con `npm start`", más la ayuda de
`arcana.js`) y cuatro comentarios con "acá".

**No se toca** el mensaje de crisis de `src/safety/crisis.js`: ya está en
neutro y es el copy de mayor riesgo del producto.

## Errores

El modo raw agrega una clase de falla nueva: dejar la terminal rota (cursor
oculto, teclas sin eco, Ctrl+C muerto). Todo lo que entra en modo raw sale en
`finally`, más el `process.on('exit')` como red.

El resto del manejo de errores del REPL no cambia: un fallo imprime y vuelve al
prompt sin descontar de la barra.

## Testing

Sin gastar tokens:

- **Decodificación de teclas**, como función pura: `decodeKey(buf)` →
  `'arriba' | 'abajo' | 'enter' | 'cancelar' | null`. Ahí viven los bugs
  sutiles de secuencias de escape.
- **Ritmo por tema:** que directo apunte a 7000 ms y poético a 15000 ms, y que
  el piso siga sin dar cero.
- **Historial con invertidas:** que el `▼` aparezca, y que siga apareciendo con
  `--plain`.
- **Guardián de idioma:** un test que escanee los prompts de `src/llm/` y
  `src/memory/` y falle si encuentra voseo. Barato, y evita exactamente la
  regresión que originó este trabajo.

El loop de selección interactivo se verifica a mano.

## Verificación manual

Lo único que no se puede comprobar con tests es si las lecturas efectivamente
cambiaron de registro. Requiere una lectura real (~$0.006 en luna nueva) y
leerla.

## Riesgos conocidos

- El modo raw mal manejado deja la terminal de la persona inutilizable. Es el
  riesgo más alto de este trabajo y por eso hay tres capas de restauración.
- Cambiar el system prompt altera el estilo de las lecturas de un modo que
  ningún test cubre; el cambio de idioma puede arrastrar cambios de tono.
- El skip y el `readline` compiten por stdin: si la restauración falla, las
  teclas se duplican o desaparecen.
