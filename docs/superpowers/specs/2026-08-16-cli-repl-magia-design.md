# REPL de arcana: nivel de magia y barra de consumo

Fecha: 2026-08-16
Estado: aprobado, pendiente de plan de implementación

## Problema

El CLI actual funciona pero tiene cuatro defectos que se notan al usarlo de verdad:

1. **18 segundos de terminal muerta.** El `fetch` a `/ask` ocurre antes de
   `render.reading()`, y la animación de barajado vive adentro de `reading()`.
   El usuario ve la nada durante toda la llamada al modelo y después una
   animación de 700 ms que ya no cubre ninguna espera.
2. **La tirada es espacial pero se imprime como lista.** Una cruz de cinco
   cartas sale como cinco renglones apilados; la forma, que es información,
   se pierde.
3. **Falta de pulido.** Los slots se imprimen crudos (`situacion`, `raiz`),
   sin acentos.
4. **No hay forma de elegir cuánto gastar.** El modelo se fija por env var al
   arrancar el servidor; cambiarlo exige reiniciar.

Además, `ora`, `boxen` y `gradient-string` están declaradas en `package.json`
y no las importa nadie.

## Alcance

Entra: selección de nivel de magia, barra de consumo, REPL interactivo, layout
de cruz, pulido tipográfico, arreglo de la espera, limpieza de dependencias.

No entra: distribución del CLI (`npm link` / publicación), streaming de la
interpretación token a token, modo dev completo con JSON crudo. La instalación
global se resolverá aparte; para uso personal alcanza `npm link`.

## Decisiones tomadas

| Decisión | Elección | Razón |
|---|---|---|
| Alcance de la barra | Por corrida de terminal | El usuario lo eligió sabiendo que no es un tope real de gasto |
| Forma del programa | REPL interactivo | Es donde "elegir al inicio" y "barra que se agota" tienen lugar natural |
| Nivel en la API | Semántico (`alta`/`media`/`baja`) | El cliente no queda atado a nombres de modelo |
| Dinero en la UI | No se muestra nunca | Se ve como barra; los USD quedan detrás de `--dev` |
| Progreso durante la espera | Animación autónoma, sin streaming | 18 s se toleran con movimiento; el streaming se paga cuando haya token a token |

## Arquitectura

### Nivel de magia

Presets en `src/llm/client.js`, junto a `tune()`:

```js
export const NIVELES = {
  alta:  { interpret: 'claude-opus-5',    analysis: 'claude-haiku-4-5', profile: 'claude-haiku-4-5' },
  media: { interpret: 'claude-sonnet-5',  analysis: 'claude-haiku-4-5', profile: 'claude-haiku-4-5' },
  baja:  { interpret: 'claude-haiku-4-5', analysis: 'claude-haiku-4-5', profile: 'claude-haiku-4-5' },
};
```

El análisis es Haiku en los tres niveles a propósito: genera ~77 tokens de
salida, así que subirlo no cambia la calidad percibida y sí el costo. El
escalón lo marca la interpretación, que concentra el 72 % del gasto medido.

Costos medidos (tokens reales: análisis 1229/77, interpretación 912/655):

| Nivel | Nombre en UI | Costo/lectura | Lecturas con $0.20 |
|---|---|---|---|
| alta | plenilunio | $0.0290 | ~6 |
| media | media luna | $0.0142 | ~14 |
| baja | luna nueva | $0.0058 | ~34 |

`POST /ask` acepta `nivel` en el body, lo valida contra las claves de `NIVELES`
y lo devuelve en la respuesta. La ruta resuelve el preset y pasa el modelo como
argumento a `analyzeQuestion(question, { model })`, `interpret({ ..., model })`
y `refreshProfile(sessionId, { model })`. Hoy las tres importan la constante
directamente desde `client.js`; pasan a recibirla como parámetro. `tune()` ya
maneja las diferencias entre generaciones de modelo, así que cambiar de modelo
por request es seguro.

**Cambio incompatible:** las env vars `ARCANA_MODEL_INTERPRET`,
`ARCANA_MODEL_ANALYSIS` y `ARCANA_MODEL_PROFILE` se eliminan. Si fijaran el
modelo, pisarían el nivel del request y lo volverían inútil. Las reemplaza
`ARCANA_NIVEL_DEFAULT=alta`, que decide qué usar cuando el request no manda
nivel (un-disparo y smoke). Hay que actualizar `.env.example`, el `.env` local
y el README.

### La barra de magia

Vive solo en memoria del proceso REPL. Sin archivo, sin base, sin servidor:
nace al abrir `arcana` y muere al salir.

```js
const PRESUPUESTO = Number(process.env.ARCANA_PRESUPUESTO ?? 0.20);
```

Después de cada lectura se resta `uso.costo_usd` — el número real que devuelve
la API, no una estimación — y se redibuja. Son 16 bloques; cada uno vale
$0.0125. El valor en dólares nunca se imprime.

Antes de cada lectura hay un chequeo previo contra el costo promedio del nivel
activo. Si no alcanza, no se manda el request: se avisa y se ofrece bajar de
nivel. Cambiar de nivel a mitad de sesión es parte de la mecánica, no un extra.

**Costo desconocido.** `costOf()` devuelve `null` cuando el modelo no está en
la tabla de precios. En ese caso la barra pasa a estado indeterminado: se
dibuja con `~`, se avisa que no se puede medir el consumo y se deja de
garantizar el tope. No se resta cero (mentiría) ni un estimado (inventaría).

**Lo que la barra no hace:** no persiste, no bloquea entre ventanas, no protege
de nada. Otra terminal arranca con otros $0.20. Es un recordatorio de consumo,
no un límite.

### El REPL

```
✦ arcana

  ¿Con cuánta magia querés leer?

    1  ◆◆◆  Plenilunio    ~6 lecturas
    2  ◆◆◇  Media luna    ~14 lecturas
    3  ◆◇◇  Luna nueva    ~34 lecturas

  › 1

  ◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈   plenilunio
  › ¿debería aceptar la oferta?
```

Comandos dentro del REPL: una pregunta cualquiera pide lectura; `nivel <x>`
cambia de nivel; `historial` lista lecturas previas; `olvidar` borra la sesión
de memoria; `salir` termina.

El `arcana "pregunta"` de un disparo se mantiene intacto, sin barra ni
selección de nivel, para pipes y scripts. Usa `ARCANA_NIVEL_DEFAULT`.

El flag `--dev` es lo único que muestra dólares: reactiva una línea por lectura
con tokens y costo real por etapa, para auditar el gasto sin ensuciar la
experiencia normal. No es un modo dev completo — no muestra JSON crudo ni
latencias por etapa; eso quedó fuera de alcance.

Resumen al salir, sin cifras:

```
  ✦ 4 lecturas · plenilunio
    ◈◈◈◈◈◈◇◇◇◇◇◇◇◇◇◇  te quedaba magia para ~2 más
```

### La cruz

```
                      ▲ resultado
                        La Torre


      ◀ consejo         ✦ situación         obstáculo ▶
        As de Oros        El Sol              Diez de Oros


                      ▼ raíz
                        Sota de Bastos
```

Requiere ~64 columnas y unicode. Se agrega `caps.wide` a `cli/render/caps.js`;
si falta ancho, unicode o TTY (pipe, `--plain`), cae a la lista vertical
actual. La decisión vive en `caps`, que ya es el único punto donde se resuelve
qué se puede usar.

Los rótulos con acento (`Situación`, `Obstáculo`, `Raíz`) son presentación y
viven en `themes.js` junto al resto del copy. La API sigue devolviendo claves
sin acento; no se toca.

### La espera

Se invierte el orden actual:

```js
const stop = render.esperando();   // arranca el barajado, no bloquea
const res = await api(...);        // la espera real
stop();                            // limpia la línea
await render.reading(res);
```

`esperando()` devuelve una función de corte y el barajado corre en loop
mientras dure la llamada, en vez de los 700 ms fijos de hoy.

**Ritmo del tipeo.** `typeMs` deja de ser constante: se calcula para que el
texto completo tarde un tope de ~4 s sin importar el largo. Hoy 275 palabras a
6 ms/carácter tardan ~10 s, que sumados a los 18 de espera son demasiado.
`--no-anim` sigue saltando el efecto por completo.

### Limpieza

Se eliminan `ora`, `boxen` y `gradient-string` de `package.json`. Solo `chalk`
se usa, en `cli/render/paint.js`.

## Errores

Ningún error mata el REPL: se imprime y se vuelve al prompt con la barra
intacta — no se descuenta lo que no se cobró. Si el servidor no responde al
abrir, se avisa antes de pedir el nivel en vez de fallar después de elegir.
Ctrl+C y Ctrl+D salen limpio mostrando el resumen.

## Testing

Sin gastar tokens:

- **Aritmética de la barra:** descuento, umbral de "no alcanza", caso `null`
  indeterminado, y que nunca quede negativa.
- **Resolución de nivel:** que `media` mapee a Sonnet en interpretación, que un
  nivel inválido caiga en el default, que el nivel viaje en el body y vuelva en
  la respuesta.
- **Render:** que con ancho suficiente dibuje la cruz, que con ancho chico o
  `--plain` caiga a lista, y que `wrap()` siga siendo lossless.

El loop interactivo se verifica a mano: es caro de simular y da poco.

## Riesgos conocidos

- La barra no es un tope real de gasto (decisión explícita).
- Eliminar las env vars de modelo rompe cualquier `.env` existente.
- Los costos por nivel salen de una sola lectura medida; son orden de
  magnitud, no promedios estadísticos. El conteo de "lecturas restantes" es
  aproximado y debe presentarse con `~`.
