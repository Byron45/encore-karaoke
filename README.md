# Encore · Karaoke personal

Karaoke para practicar con tu propia música. Encore escucha tu voz por el micrófono, detecta la nota que cantas en tiempo real y la compara con la melodía de la canción. Todo ocurre en tu computadora: tu voz no se graba ni se envía a ningún servidor.

![El escenario de Encore durante una canción: barras de notas, punto de voz, afinador y letra](docs/img/escenario.png)

> **Estado:** en desarrollo (revisión 2F). El recorrido completo funciona y está cubierto por pruebas automáticas con voz sintética. Todavía falta validarlo con voces reales y distintos micrófonos; consulta [Limitaciones](#limitaciones-conocidas).

## Características

- **Escenario de canto** con barras de notas, letra sincronizada, afinador en vivo (en cents) y puntuación sobre 10.000. El punto de tu voz cambia de color mientras cantas: verde en la nota, ámbar cerca, rojo fuera.
- **Tres niveles de exigencia.** En Relajada y Normal cuenta la nota y no su altura: puedes cantar en la octava que te resulte cómoda.
- **Biblioteca propia.** Importa MP3, WAV, OGG, M4A, FLAC o WebM (hasta 30 MB y 10 minutos) y guárdalos en el navegador.
- **Editor de letra y notas.** Marca tiempos mientras escuchas, desplaza el mapa completo e importa o exporta mapas en JSON.
- **Letras con tiempos** desde [LRCLIB](https://lrclib.net) y metadatos de la grabación desde [MusicBrainz](https://musicbrainz.org).
- **Preparación automática opcional.** Separa la voz del acompañamiento y propone un mapa de notas a partir de la voz aislada, sin salir de tu equipo.
- **Tres acompañamientos** tras separar: voz original, voz al 25 % o solo instrumental.
- **Cambio de tono.** Sube o baja tu canción hasta cinco semitonos sin cambiar el ritmo; las notas que se evalúan se mueven con ella.
- **Puntuación respecto a la voz original.** En una canción preparada, 10.000 puntos son lo que obtiene la voz de la propia grabación medida con este mismo sistema.
- **Ajustes que se adaptan a tu equipo.** Compensa el retraso de audio, ajusta la sensibilidad al nivel de tu micrófono y avisa si la música está entrando por él.
- **Resultados explicados** por frase, con descarga en JSON, y **tu mejor marca** por canción y nivel de exigencia.
- **Tus intentos guardados.** Cada canción que cantas con micrófono queda en el navegador (los últimos 60) para descargar su resultado más tarde, aunque no lo hayas descargado al terminar.
- **Ensayo por frases.** Desde el resultado, repite solo la frase que se te resiste: suena desde un poco antes y solo cuentan sus notas.

![Editor de la biblioteca: letra completa y mapa de notas de una canción](docs/img/mapa-de-notas.png)

## Requisitos

| Para | Necesitas |
| --- | --- |
| Usar la aplicación | [Node.js](https://nodejs.org) 22.18 o superior y un navegador basado en Chromium (Edge, Chrome u Opera) |
| Cantar con puntuación fiable | Auriculares, para que la música no entre por el micrófono |
| Preparación automática (opcional) | [uv](https://docs.astral.sh/uv/), unos 1,3 GB de disco y varios minutos de CPU por canción |
| Pruebas de navegador (opcional) | Microsoft Edge |

Desarrollado y probado en Windows 11. No se ha verificado en macOS ni Linux.

## Inicio rápido

```bash
git clone https://github.com/Byron45/encore-karaoke.git
cd encore-karaoke
npm install
npm run dev
```

Abre <http://127.0.0.1:5173>. El micrófono solo funciona en `localhost`, `127.0.0.1` o HTTPS.

## Cómo se usa

### 1. Prueba el escenario

Pulsa **Ver demo** para ver el recorrido con una voz simulada. Después conecta los auriculares, elige tu entrada, pulsa **Probar micrófono** y luego **Empezar a cantar**. El ejercicio incluido dura 32 segundos.

### 2. Canta tu música

1. En **Biblioteca**, pulsa **Cargar audio** y elige un archivo que tengas permiso de usar.
2. Añade la letra: búscala en LRCLIB por título y artista, o pégala completa.
3. Prepara las notas, a mano en el editor o con **Separar voz y generar mapa**.
4. Pulsa **Guardar y cantar**.

Con letra y sin notas también puedes cantar: la app reproduce tu audio y avanza la letra, sin puntuación.

### 3. Ajusta la evaluación

En el panel **Prepara tu voz**:

- **Exigencia de afinación** decide cuánto margen tienes (tabla siguiente). Empieza en Relajada.
- **Tono de la canción** sube o baja la música y las notas, de semitono en semitono. Si al terminar el resultado dice que cantaste por debajo de la nota, prueba a bajarla uno o dos. Necesita la preparación automática instalada; la primera vez con cada canción y tono tarda unos 5 segundos por minuto de canción.
- **Compensar retraso** empieza en automático. Al terminar una canción, si tu voz encaja mejor con otro valor, aparece un botón para usarlo; se recuerda para ese micrófono.

## Cómo se puntúa

La puntuación mide cuánto tiempo sostienes la nota correcta. No reconoce palabras ni valora la interpretación.

| Exigencia | Crédito completo | Sin crédito desde | Octava | Margen de tiempo | Referencia |
| --- | --- | --- | --- | --- | --- |
| Relajada (por defecto) | ±100 cents (un semitono) | 200 cents | cualquiera | ±160 ms | la nota escrita o la curva original, la más cercana |
| Normal | ±50 cents | 150 cents | cualquiera | ±120 ms | la nota escrita o la curva original, la más cercana |
| Estricta | ±35 cents | 100 cents | exacta | ninguno | la curva original |

El margen de tiempo acepta una nota que entra un poco antes o se sostiene un poco después de lo que marca el mapa. Los silencios previstos no suman ni restan; no cantar durante una nota sí reduce el resultado. Los resultados solo son comparables entre intentos con la misma exigencia.

**La escala.** Una voz real no suena con tono el 100 % del tiempo: las consonantes y las respiraciones no tienen nota. Por eso, en Relajada y Normal, 10.000 puntos no son el máximo teórico sino lo que alcanza una voz real:

- **En una canción con pistas preparadas**, la app lee la voz aislada de la grabación con el mismo detector que tu micrófono y la puntúa con las mismas reglas. Lo que obtiene son los 10.000 puntos de esa canción. Medidas así, «Un Millón de Primaveras» llega al 98 % del máximo teórico y «Luz de Día» al 83 %: el detector no lee igual de bien todas las voces, y la escala lo compensa.
- **La escala no baja del 75 % del máximo.** Una voz aislada que se lee peor suele llevar instrumentos u otras voces, y eso no debe volver la escala más indulgente. El paso es gradual: una grabación leída al 74 % y otra al 76 % quedan casi en la misma escala.
- **Sin pistas preparadas** se usa una escala general: 10.000 es el 85 % del máximo.

Estricta se queda en el máximo teórico. El resultado dice qué escala se usó y muestra también los puntos sin ajustar.

**Qué puntuación esperar** en Relajada, medido sobre «Un Millón de Primaveras», preparada con el separador actual, y una toma real:

| Quién canta | Puntos |
| --- | --- |
| La voz original aislada, contra su propio mapa | 10.000 (es la referencia) |
| Una voz sin entrenar que sigue la melodía, en la misma nota que la grabación casi la mitad del tiempo | unos 5.500 |
| Una sola nota sostenida, la que mejor encaja con la canción | hasta 4.700 |
| Notas al azar dentro del registro | unos 2.800 |
| La misma voz sobre otra parte de la canción | unos 1.100 |

Con un semitono de margen, una nota fija bien elegida se acerca a una melodía cantada a medias: es el precio de una escala indulgente. Normal separa más (4.450 frente a 3.000).

**Qué no se evalúa.** Si la letra tiene tiempos por línea, las notas de un mapa automático que caen fuera de las líneas cantadas (introducción, interludios) se dejan fuera; el escenario indica cuántas. Tampoco puntúa lo que tus auriculares dejan pasar a su propio micrófono: el umbral de silencio se ajusta al nivel de tu voz en cada canción.

**Repaso.** Al terminar, cada frase tiene un botón **Ver trazo** que dibuja tu voz sobre las notas con las que se comparó: verde en la nota, ámbar cerca, rojo fuera. Sirve para distinguir si desafinaste o si el mapa no representa lo que cantaste. **Ensayar** repite esa frase sola, con la cuenta atrás y dos segundos de canción antes; los ensayos no cuentan como marca.

## Preparación automática

Es opcional y se instala aparte, porque descarga dependencias pesadas de Python:

```bash
npm run audio:setup
```

Crea un entorno aislado en `.venv-audio` con Python 3.11 y dependencias fijadas. Todo el procesamiento se hace por CPU en tu equipo.

La separación hace dos pasadas, cada una con el modelo entrenado para lo que se queda: UVR-MDX-NET-Inst_HQ_3 para el instrumental y Kim_Vocal_2 para la voz. La voz aislada es la base del mapa de notas y de la escala, y con el modelo de voz sale mucho más limpia: en una de las canciones de prueba, el bajo que se colaba en ella pasó del 45 % de las lecturas con tono al 1 %. El primer uso descarga los dos modelos (unos 134 MB). El mismo motor instala FFmpeg, que cambia el tono de las canciones con Rubber Band. En Windows la versión que instala ya lo incluye; en otros sistemas la app comprueba si lo tiene y, si no, deja desactivado el cambio de tono.

Las canciones preparadas antes de esta versión conservan sus pistas. Para usar la voz nueva, vuelve a separarlas desde la biblioteca.

El mapa generado es **experimental**: puede cubrir solo parte de la canción, equivocarse de octava o confundir coros con la voz principal. Escucha la voz aislada y revisa las notas antes de fiarte de la puntuación.

## Privacidad

- La voz se analiza en el navegador con un AudioWorklet. No se graba ni se sube.
- El resultado de cada intento incluye el trazo de afinación (la nota detectada y el nivel en cada instante), no el sonido. Se guarda en el navegador junto con los 59 intentos anteriores, en «Tus intentos guardados» del escenario, donde puedes descargarlos o borrarlos.
- La biblioteca y tus intentos viven en IndexedDB, en tu navegador, y tus ajustes y mejores marcas en su almacenamiento local. No hay cuentas ni copia en la nube: borrar los datos del sitio lo borra todo.
- El servidor local escucha solo en `127.0.0.1`. La preparación de audio comprueba además el origen de cada petición y un token de sesión.
- Conexiones externas, todas iniciadas por una acción tuya salvo la primera:
  - Google Fonts, al cargar la página (hay tipografías locales de respaldo).
  - MusicBrainz y LRCLIB, al pulsar buscar; se envían solo título y artista.
  - La descarga de los dos modelos, la primera vez que separas una canción.

## Pruebas

```bash
npm test             # 64 pruebas unitarias: detector, puntuación, mapas, letras, cambio de tono, servicios
npm run build        # comprobación de tipos y compilación
npm run test:browser # 43 pruebas de extremo a extremo; requiere `npm run dev` activo y Microsoft Edge
```

Las pruebas de navegador hacen pasar una voz sintética por el micrófono, el detector y la puntuación reales. No sustituyen una prueba con voz humana.

### Analizar una toma real

El resultado que descargas tras cantar incluye el trazo de tu afinación. Esta herramienta lo estudia: qué captó el micrófono, cuánto puntúa con cada exigencia y dónde estuvo tu voz respecto a las notas.

```bash
node scripts/analyze-take.mjs resultado.json
```

Con la carpeta que genera `scripts/audio/prepare.py` para el audio original de la canción, compara además tu voz con la voz original aislada y calcula tu puntuación en la escala de esa grabación:

```bash
node scripts/analyze-take.mjs resultado.json --prepared artifacts/audio-mi-cancion
```

## Estructura del proyecto

```
src/            Interfaz en React y motor de canto
  audio.ts        Reloj de la canción, captura y calibración
  scoring.ts      Puntuación y diagnóstico
  capture.ts      Ruido de fondo, nivel y detección de altavoces
  Stage.tsx       Escenario, afinador y letra
  Library.tsx     Biblioteca y editor
public/audio/   Detector de tono (YIN) que corre en el AudioWorklet
server/         Servicios locales como complementos de Vite: MusicBrainz, LRCLIB y preparación
scripts/audio/  Motor de Python: separación de voz y análisis de melodía
tests/          Pruebas unitarias; tests/browser contiene las de extremo a extremo
docs/           Notas técnicas, plan por etapas y evaluaciones
```

## Limitaciones conocidas

- **Hacen falta auriculares.** Sin ellos la música se mezcla con tu voz y la puntuación deja de ser fiable. La app lo detecta y avisa, pero no lo corrige.
- **Poca validación con voz real.** Además de la señal sintética, la evaluación se ha contrastado con la voz original aislada de una canción y con una prueba cantada con auriculares con micrófono. Faltan más personas, micrófonos y auriculares Bluetooth.
- **El mapa automático sale de la pista de voz separada**, que incluye coros, segundas voces y a veces instrumentos. En esos tramos la referencia puede no ser la melodía principal. Sin letra con tiempos, las notas de los tramos instrumentales no se pueden descartar.
- **La escala de cada canción depende de su voz aislada.** Una separación mejor o peor cambia el 10.000 de esa canción; por eso una voz que se lee mal no se usa como referencia. Sin pistas preparadas se aplica la escala general (85 %), que es una media y no una medida.
- **El retraso automático es una estimación.** Parte de lo que informa el equipo, que puede no coincidir con el real; por eso existe la propuesta al terminar cada canción.
- **El mapa automático es experimental** y suele quedar fragmentado en notas muy cortas.
- **El cambio de tono necesita el servidor local** con el motor de audio instalado y llega a cinco semitonos; más allá la voz y los instrumentos suenan artificiales. Rubber Band puede adelantar o retrasar el sonido unos 20 ms, dentro del margen de tiempo de Relajada y Normal.
- **Los servicios locales dependen de Vite** (`npm run dev` o `npm run preview`). Copiar solo `dist/` a un alojamiento estático no incluye las búsquedas ni la preparación.
- **El historial guarda los últimos 60 intentos** con micrófono, sin gráficas de progreso. No hay pausa ni cola de canciones.

## Próximos pasos propuestos

- [ ] Validar con voz real, auriculares y varios micrófonos.
- [ ] Mejorar el mapa automático: unir notas fragmentadas y obtener tiempos por sílaba.
- [ ] Importar mapas hechos a mano.
- [ ] Progreso a lo largo de los intentos, pausa y cola de canciones.
- [ ] Copia de seguridad de la biblioteca y guardado que no reescriba el audio en cada cambio.
- [ ] Formateador, linter e integración continua.

El plan original por etapas está en [docs/ETAPAS.md](docs/ETAPAS.md).

## Documentación

- [Notas técnicas por etapa](docs/NOTAS-TECNICAS.md): decisiones, límites y detalle de cada entrega.
- [Preparación automática](docs/PREPARACION-AUTOMATICA.md): diseño de la separación y del mapa.
- [Punto de continuación](docs/CONTINUAR.md): estado actual y siguiente paso.
- Evaluaciones de cada etapa en `docs/EVALUACION-*.md`.

## Tecnología y créditos

React 19, TypeScript y Vite. Web Audio API para la captura y el análisis. Playwright para las pruebas de navegador.

El motor opcional usa [python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator) con dos modelos UVR-MDX-NET (Inst_HQ_3 y Kim_Vocal_2), [FFmpeg](https://ffmpeg.org) con [Rubber Band](https://breakfastquay.com/rubberband/) para el cambio de tono, [torchcrepe](https://github.com/maxrmorrison/torchcrepe) y [librosa](https://librosa.org). Los iconos son de [Lucide](https://lucide.dev). Los metadatos proceden de MusicBrainz y las letras de LRCLIB; cada servicio tiene sus propias condiciones de uso.

Encore no incluye ni descarga canciones. Usa solo audio y letras que tengas derecho a utilizar.

## Licencia

Proyecto personal en desarrollo, todavía sin licencia de código abierto.
