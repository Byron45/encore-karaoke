# Encore · notas técnicas por etapa

Detalle de cada entrega, con sus decisiones, límites y pruebas. Para instalar y usar la aplicación, empieza por el [README](../README.md). Las rutas de este documento son relativas a la raíz del repositorio.

Aplicación web local en React + TypeScript. Nombre provisional. Etapa 2: **biblioteca de audio propia, editor de letras y notas, y metadatos MusicBrainz**, sobre el escenario de afinación de la primera entrega.

Ampliaciones implementadas: **LRCLIB y letras completas/LRC**, separación vocal local y mapa automático. La etapa **2D** añade análisis CREPE + pYIN, curvas de afinación, mejora del mapa reutilizando la voz aislada y un afinador conectado a la evaluación. Evidencia y límites en `docs/EVALUACION-02D.md`.

La revisión **2F** adapta la evaluación a cantar en condiciones reales: tres niveles de exigencia con octava libre, compensación de retraso automática con propuesta de ajuste, nivel de micrófono adaptable y aviso cuando la música entra por el micrófono. Ver «Cantar en condiciones reales».

## Ejecutar

Requisitos: Node.js 22.18 o superior y npm.

```powershell
npm install
npm run dev
```

Abre http://127.0.0.1:5173. El servidor escucha únicamente en este equipo. El micrófono necesita localhost o HTTPS. El navegador integrado puede gestionar permisos de forma distinta; si no ofrece acceso al micrófono, abre la misma dirección en Edge o Chrome.

1. Usa **Ver demo** para escuchar y observar el recorrido con voz simulada.
2. Conecta auriculares, elige la entrada y usa **Probar micrófono**. Comprueba el nombre del dispositivo, nivel y nota; después usa **Empezar a cantar**.
3. Sigue las barras y las palabras; puedes cantar las sílabas libremente: todavía no evaluamos el contenido de la letra.
4. Al terminar, revisa cada frase o descarga el resultado JSON. La demo se identifica como simulada también en el archivo.

El audio de entrada se procesa en un AudioWorklet del dispositivo. No se graba ni se sube. Las fuentes tipográficas se cargan desde Google Fonts con alternativas locales si no hay conexión. No hay cuentas, analítica ni almacenamiento de grabaciones. Las puntuaciones viven en memoria hasta la descarga voluntaria.

## Probar la biblioteca

1. Abre **Biblioteca → Añadir ejemplo editable**. Incluye audio original y 24 notas listas. Pulsa **Guardar y cantar** para probar el recorrido completo.
2. Para usar tu archivo, pulsa **Cargar audio**. Admite MP3, WAV, OGG, M4A, FLAC o WebM compatibles con el navegador, de 1 segundo a 10 minutos y hasta 30 MB.
3. Escucha la pista y prepara filas con palabra/sílaba, frase, inicio, duración y nota. **Marcar** toma la posición actual del reproductor; **Aplicar desfase** desplaza todo el mapa.
4. Opcionalmente busca el título y artista en **Identificar en MusicBrainz**. Revisa edición y duración antes de asociar. Esto no obtiene audio, letra ni notas.
5. Guarda el borrador o, con el mapa válido, pulsa **Guardar y cantar**. Puedes exportar audio y mapa para conservar una copia.

La biblioteca se guarda en IndexedDB del mismo navegador y origen. Abrir `localhost` en lugar de `127.0.0.1`, cambiar de puerto o navegador crea otro espacio. Borrar los datos del sitio elimina la biblioteca; no hay copia en la nube. Al guardar se solicita al navegador almacenamiento persistente; puede concederlo o no sin avisar. La elección de micrófono, la exigencia de afinación y la compensación de cada micrófono se recuerdan en localStorage.

El mapa puede editarse manualmente o generarse como **borrador automático experimental**. Cada mapa JSON Encore versión 1 (manual), 2 (automático) o 3 (con curvas de afinación) se vincula al contenido exacto del audio mediante SHA-256 y a su duración. Se conservan los mapas anteriores. Un mapa de otro archivo se rechaza, aunque tenga el mismo título. Se admiten 2.000 notas, 40.000 puntos de curvas en total y 12 MB de JSON. Cambiar los metadatos MusicBrainz no altera la pista ni demuestra que sus notas sean correctas.

## Separación y mapa automático · etapa 2C

En esta computadora el motor ya está instalado y probado. Para otra instalación, instala [uv](https://docs.astral.sh/uv/) y ejecuta `npm run audio:setup`. Crea `.venv-audio` con Python 3.11 y dependencias fijadas en `scripts/audio/requirements-lock.txt`. Se usa CPU; no requiere configurar CUDA. El primer procesamiento descarga los modelos `UVR-MDX-NET-Inst_HQ_3.onnx` y `Kim_Vocal_2.onnx` (~67 MB cada uno; véase la revisión 2J). Después quedan en `.local/audio/models`.

1. En **Biblioteca**, abre la canción y pulsa **Separar voz y generar mapa**. El original se envía únicamente al servidor de esta computadora.
2. Espera el progreso o cancela. Escucha las tres vistas previas: instrumental, voz reducida y voz aislada. El original y el mapa guardado se conservan mientras revisas el resultado.
3. Elige **Usar solo las pistas**, o revisa el mapa, marca la casilla y pulsa **Usar pistas y mapa automático**. El mapa anterior solo se reemplaza tras confirmarlo. Acepta o descarta el borrador antes de guardar.
4. Pulsa **Guardar y cantar**. En **Acompañamiento** elige Fácil (original), Intermedio (instrumental + voz al 25 %) o Difícil (instrumental). Cambiar a las variantes separadas desactiva la melodía guía; puedes activarla expresamente. Las tres usan las mismas notas de referencia.

[Audio Separator](https://github.com/nomadkaraoke/python-audio-separator) genera los stems. Desde la etapa 2D, [torchcrepe](https://github.com/maxrmorrison/torchcrepe) analiza la voz aislada y se contrasta con pYIN de librosa para descartar discrepancias claras. Se conservan segmentos con confianza y energía suficientes; silencios y segmentos descartados no puntúan. No se inventan notas a partir del BPM ni palabras por nota. Con LRC se agrupan notas por línea; texto plano sigue sin tiempos. No hay alineación ni reconocimiento palabra por palabra.

**El mapa puede ser parcial y equivocarse de octava o confundir coros.** En la prueba de Luz de Día, el mapa pasó de 129 notas / 32,28 s a 493 notas / 125,86 s sobre 267,82 s de audio. Esto mide cobertura propuesta, no precisión musical ni porcentaje de voz correctamente transcrita. La separación también puede dejar residuos vocales. Escucha y revisa antes de evaluar tu interpretación.

Los tres WAV estéreo PCM16/44.1 kHz se validan por SHA-256, muestras, duración y alineación con el original. Pueden superar 30 MB: el límite de entrada aplica al original; cada stem admite hasta 128 MB. Se comprueba cuota y se guarda la ficha completa en una transacción de IndexedDB. El MP3 de ejemplo produjo ~135 MiB de pistas adicionales. Solo se decodifica el acompañamiento elegido al cantar.

Script independiente (elige una carpeta de salida nueva):

```powershell
.venv-audio/Scripts/python.exe scripts/audio/prepare.py --input 'C:\ruta\cancion.mp3' --output 'artifacts/audio-mi-cancion' --cache '.local/audio/models'
```

Produce `vocals.wav`, `instrumental.wav`, `reduced.wav` y `manifest.json`. El script conserva el archivo original. La integración de la app ejecuta este mismo script y recupera automáticamente las pistas; no hay importador de carpetas CLI. La prueba del archivo del usuario está en `artifacts/audio-luz-de-dia`.

La API `/api/preparation` funciona con Vite dev/preview en loopback, valida origen y token, permite un solo trabajo y cancela su árbol de procesos en Windows. Los trabajos descargados/cancelados se eliminan, reintentando mientras el proceso recién cancelado aún retiene archivos; el modelo queda en caché. Tras un cierre abrupto pueden quedar temporales en `.local/audio/jobs`: al arrancar el servidor se borran los que llevan más de dos horas. Un alojamiento estático o un teléfono sin este servidor local no ejecuta Python.

## Mejorar el mapa y comprobar afinación · etapa 2D

Para canciones ya separadas: **Biblioteca → canción → Mejorar mapa desde la voz**. Reutiliza el WAV vocal guardado; no vuelve a separar ni modifica las tres pistas. Compara el borrador con el anterior, escucha la voz aislada, acepta el mapa y pulsa **Guardar cambios** o **Guardar y cantar**. Cancelar o descartar conserva el mapa anterior. Las nuevas preparaciones usan directamente este motor.

El análisis sigue la altura cada 20 ms y conserva una curva dentro de cada nota para representar vibrato y deslizamientos. Procesa por CPU y puede tardar varios minutos. `torchcrepe==0.0.24` y sus pesos se instalan con `npm run audio:setup`; no se sube audio a un servicio externo.

En el escenario, el afinador muestra la referencia, tu frecuencia y la diferencia en cents: negativa significa más grave, positiva más aguda; 100 cents equivalen a un semitono. Afinador, curva dibujada y puntuación comparten la referencia. Sin tono fiable o sin referencia, el indicador queda neutral. En el resultado se separan **Afinación al cantar** y **Cobertura de notas**, con error medio y tendencia grave/aguda. No detecta palabras.

Los mapas automáticos excluyen hasta 20 ms por extremo de nota para reducir penalizaciones en transiciones, conservando al menos 80 ms evaluables. El resultado indica el tiempo excluido. Las pruebas sintéticas no sustituyen cantar con el dispositivo real.

## Cantar en condiciones reales · revisión 2F

**Exigencia de afinación** (panel «Prepara tu voz», se recuerda entre visitas):

| Exigencia | Crédito completo | Sin crédito desde | Octava | Referencia |
| --- | --- | --- | --- | --- |
| Relajada | ±100 cents (un semitono) | 200 cents | cualquiera | la nota escrita o la curva, la más cercana |
| Normal (por defecto) | ±50 cents | 150 cents | cualquiera | la nota escrita o la curva, la más cercana |
| Estricta | ±35 cents | 100 cents | exacta | la curva del mapa |

Estricta reproduce la regla anterior (`encore-intonation-2`). En Relajada y Normal cuenta la nota y no su altura absoluta: una voz grave puede cantar una canción aguda una octava abajo, y no hace falta imitar el vibrato del cantante original. El afinador y el punto de voz del escenario siguen la misma regla. Los resultados identifican `encore-intonation-3` y la exigencia usada; solo son comparables entre intentos con la misma exigencia.

**Retraso.** Sin ajuste propio, cada canción usa el retraso que informa el equipo (salida + entrada, de 0 a 300 ms) y el resultado lo indica como automático. Al terminar, la app vuelve a puntuar lo cantado con otros retrasos; si uno explica claramente mejor el intento, propone usarlo con un botón. El valor elegido se guarda por micrófono y «Volver a automático» lo descarta. El control manual sigue disponible. La propuesta parte de que el mapa está bien sincronizado: con un mapa desplazado propondrá compensar ese desplazamiento.

**Nivel del micrófono.** Durante la cuenta atrás se mide el ruido de fondo. Si la entrada es silenciosa, el umbral de silencio baja (hasta 0,0015 de RMS) para que una voz suave o un micrófono con poca ganancia cuenten; nunca sube por encima del valor anterior (0,008). El resultado descargado incluye el umbral usado (`levelGate`) y el ruido medido. *Esta regla se sustituyó en la revisión 2H: dejaba pasar la fuga de los auriculares.*

**Altavoces.** Si el micrófono oye los clics de la cuenta atrás, la música está entrando por él. La app lo avisa mientras cantas, mantiene el umbral de silencio normal, no propone retraso y, si el resultado es bajo, lo atribuye a los altavoces en lugar de a tu canto. Sobre una grabación propia los clics suenan más fuertes que antes para que la comprobación sea representativa. No es cancelación de eco: la solución sigue siendo usar auriculares.

Qué se comprobó y qué no: las reglas y los cuatro mecanismos están cubiertos con señal sintética que atraviesa el micrófono, el worklet y la puntuación reales (`tests/karaoke-scoring.test.mjs`, `tests/browser/karaoke-mode.spec.ts`). No se ha medido con voz humana, con altavoces y micrófono físicos ni con auriculares Bluetooth; el retraso que informa cada equipo puede no coincidir con el real, y por eso existe la propuesta posterior.

## Calibración con voz real · revisión 2G

Primera prueba cantada con auriculares con micrófono («Luz de Día», exigencia Normal, acompañamiento con voz al 25 %): 4.001 puntos, cobertura 73 %, afinación 55 %, error medio 121 cents, sin altavoces detectados y sin propuesta de retraso.

Para saber cuánto de ese resultado dependía del sistema se usó como referencia la **voz original aislada** de la misma canción (`artifacts/audio-luz-de-dia/vocals.wav`), pasada por el detector y la puntuación de la app contra su propio mapa:

| Medida | Antes | Después |
| --- | --- | --- |
| Voz original, exigencia Normal | 7.319 puntos · cobertura 78 % · afinación 94 % | 8.432 puntos · cobertura 88 % · afinación 96 % |
| Voz original desplazada ±100 ms | 5.679 puntos · afinación 84 % | 7.127 puntos · afinación 90 % |
| Otra parte de la canción sobre el mapa (control) | 872 puntos · afinación 22 % | 1.216 puntos · afinación 25 % |
| Nota fija, la mejor de las doce (cobertura total) | 2.738 puntos | 3.010 puntos |

Cambios que salen de esas medidas:

- **Detector.** El umbral de periodicidad de YIN pasa de 0,15 a 0,25, y el mínimo de confianza aceptado de 0,80 a 0,75. El anterior descartaba una décima parte del tiempo cantado de una voz real, casi siempre bien afinada. Con ruido blanco, ruido grave y soplo no aparece tono con ninguno de los dos. Con música sin voz sí detecta más tono (28 % → 49 % de las lecturas), lo que solo importa si entra por el micrófono.
- **Margen de tiempo.** En Normal (±120 ms) y Relajada (±160 ms) cada lectura se compara también con las notas contiguas a ese instante. Compensa la diferencia de fraseo con el cantante original y las notas muy cortas del mapa automático. En Estricta no hay margen.
- **Trazo y repaso.** El resultado conserva todas las lecturas del intento; la descarga las incluye como texto compacto (`capture.trace`: milisegundos, MIDI × 100 y nivel × 10.000). Cada frase del resultado puede mostrar el trazo de la voz sobre sus notas.

Se probó además elegir un periodo más corto cuando es casi igual de periódico, para reducir errores de octava: no cambió los casos sintéticos y apenas movió la voz real (afinación estricta 73 % → 75 %), así que no se adoptó.

Lectura del resultado cantado, con sus límites: la cobertura del 73 % ya estaba cerca del máximo que permitía el detector (78 %). La afinación del 55 % queda entre el azar (22 %) y la voz original (94 %): la melodía se sigue, con desviación. Varias frases muestran una desviación constante de uno a dos semitonos hacia grave; sin el trazo no puede saberse si es la voz o un tramo donde el mapa sigue un coro. El mapa procede de la pista de voz separada, que incluye segundas voces.

No comprobado: el efecto de estos cambios sobre esa misma interpretación, porque el resultado antiguo no guardaba las lecturas. Requiere repetir la canción.

## Fuga de los auriculares y notas sin letra · revisión 2H

Segunda prueba cantada («Un Millón de Primaveras», misma configuración, guía activada): 3.915 puntos. El usuario observó que la puntuación subía en los interludios, sin cantar. El trazo del resultado lo confirmó y mostró dos causas.

**Fuga.** En la introducción, sin voz, el micrófono registró 136 lecturas con tono a un nivel de 0,004–0,009, y 101 superaron el umbral de 0,0054 que había fijado la revisión 2F a partir del ruido de la sala. Es la música de los propios auriculares colándose en su micrófono; con la guía activada coincide con las notas del mapa y puntuaba con afinación del 98–100 %. La voz del usuario llegaba a 0,03–0,14: veinte veces más.

El umbral de silencio ya no depende del ruido de fondo sino de la toma: `LevelStats` resume el nivel en reposo (percentil 20) y el del cantante (percentil 85), y `levelGate` decide.

| Situación | Umbral |
| --- | --- |
| Nada destaca sobre el reposo (nadie canta, tono sostenido) | 0,008, el valor por defecto |
| Voz a nivel normal (≥ 0,032) | 12 % del nivel de la voz, entre 0,008 y 0,012 |
| Voz baja pero clara (cuatro veces el reposo) | 25 % del nivel de la voz, con mínimo 0,0015 |

Durante la canción el umbral se actualiza cada segundo a partir de los diez primeros; el resultado final vuelve a puntuar todas las lecturas con el umbral definitivo, así que los primeros segundos se juzgan igual que el resto. Límite: con un micrófono de muy poca ganancia la fuga y la voz pueden quedar a niveles parecidos y ningún umbral las separa.

**Notas sin letra.** El mapa de esa canción tenía 51 notas (10 s de 68,6 s) en la introducción y el interludio: instrumentos que el separador deja en la pista de voz. `sungNotes` conserva, cuando la letra tiene tiempos por línea, solo las notas dentro de una línea cantada (con un segundo de margen antes de cada línea) y agrupa las frases por línea. El mapa guardado no se modifica; el escenario indica cuántas notas quedan fuera. Sin letra con tiempos no hay forma de distinguirlas y el mapa se usa entero.

Efecto sobre esa toma, recalculada con su trazo y el mapa regenerado (394 notas, idéntico al del usuario):

| | Puntos | Cobertura | Afinación |
| --- | --- | --- | --- |
| Como se puntuó | 3.853 (la app mostró 3.915) | 69 % | 56 % |
| Con el umbral nuevo | 3.259 | 62 % | 52 % |
| Con el umbral nuevo y sin las notas instrumentales | 3.818 | 73 % | 52 % |

El número casi no cambia, pero unos 600 puntos de la toma eran de la fuga y ahora todos corresponden a la voz.

**Por qué la puntuación sigue baja.** Con el trazo se comparó la voz del usuario de tres maneras, y coinciden: está en la nota (±50 cents) entre el 28 % y el 36 % del tiempo y dentro de un semitono alrededor de la mitad; el azar da un 15 %. La desviación es hacia grave: mediana de −51 cents respecto al mapa, la mitad de las lecturas por debajo de la nota y una quinta parte por encima. El primer verso empieza un tono y medio bajo y converge hacia el minuto 1:00. No hay desfase de tiempo: la coincidencia es máxima sin desplazar la toma.

La voz original de esa canción obtiene 6.845 puntos contra su mapa (8.432 en «Luz de Día»). En esta canción la pista de voz separada conserva mucho bajo —el 45 % de sus lecturas con tono caen por debajo de Do3— y el detector de la app se confunde con él; el mapa, hecho con CREPE, no tiene ese problema (3 notas por debajo de Do3). El separador usa un modelo pensado para el instrumental, y la voz es el residuo.

El resultado descargado incluye ahora el mapa tal como se cantó (`reference.chart`), el nivel en reposo y el de la voz.

## Escala para una voz real y nivel por defecto · revisión 2I

Con la fuga y las notas sin letra resueltas, las puntuaciones seguían siendo bajas. La calibración se hizo con la herramienta `scripts/analyze-take.mjs` (nueva en el repositorio) sobre la toma de «Un Millón de Primaveras», su voz original aislada y la de «Luz de Día». Puntos sobre el máximo teórico, sin ajustar:

| Regla | Voz original (Luz de Día) | Voz original (Primaveras) | La toma | Otra parte de la canción | Mejor nota fija | Notas al azar |
| --- | --- | --- | --- | --- | --- | --- |
| Estricta | 6.387 | 5.283 | 2.145 | 236 | 1.514 | 513 |
| Normal, ±50 / 150 | 8.423 | 6.845 | 3.818 | 770 | 2.751 | 1.831 |
| Relajada, ±100 / 200 | 8.454 | 6.875 | 4.848 | 1.117 | 4.317 | 2.687 |
| ±200 / 300 | 8.471 | 6.884 | 5.939 | 1.649 | 5.654 | 3.606 |

Las tres últimas columnas usan los instantes con tono de la propia toma, con otras alturas. Dos decisiones salen de aquí.

**Escala.** Ni la voz original pasa de 8.450 sobre el máximo teórico con una pista limpia: su cobertura es del 88 %, porque consonantes y respiraciones no tienen tono. En Relajada y Normal, 10.000 puntos equivalen ahora al 85 % del máximo teórico (`VOICE_CEILING`). Se ajustan la puntuación, el porcentaje combinado y el de cada frase; la cobertura y la afinación siguen siendo medidas sin ajustar, y el resultado conserva `rawScore`. Estricta no se ajusta, para seguir siendo la regla de `encore-intonation-2`. La versión pasa a `encore-intonation-4`.

Se descartó medir el techo canción por canción con su voz aislada, que era la propuesta inicial. En «Un Millón de Primaveras» esa pista conserva mucho bajo y el detector de la app la lee mal (cobertura del 74 %): el techo medido sería 0,68 y subiría la puntuación un 25 % más por un defecto de la separación, no del canto. El mapa, hecho con CREPE, no tiene ese problema.

**Nivel por defecto.** Pasa a ser Relajada: un semitono de margen, como el nivel medio de los juegos de karaoke. Quien ya había elegido un nivel lo conserva. El coste se ve en la tabla: una sola nota bien elegida llega a 4.317 sin ajustar (5.079 ajustada) frente a 4.848 (5.703) de la toma real. Normal separa mejor, 3.818 frente a 2.751. No se adoptó un margen mayor (±200 / 300) porque la nota fija casi iguala a la toma.

**Qué dice el resultado.** El titular sigue la puntuación (8.500, 7.000 y 5.500 separan «¡Gran interpretación!», «Muy bien cantada.», «Buen intento.» y «Cada intento cuenta.»). Cuando la desviación media tiene un sentido claro —entre 40 y 150 cents y al menos el 40 % de la desviación absoluta— el texto lo dice y hacia dónde corregir; si además la afinación no llega al 50 %, ese es el titular.

**En vivo.** El punto de la voz en el escenario toma el color del crédito que está ganando (verde, ámbar, rojo), el mismo código que «Ver trazo».

**Mejor marca.** Al terminar una toma con micrófono se compara con la mejor guardada para esa canción y nivel de exigencia (`encore.best.v1` en localStorage, con la versión de puntuación en la clave: las marcas de otra versión no son comparables y se ignoran). No fijan marca las tomas con cero puntos ni aquellas en las que se detectaron los altavoces. Es el único dato de puntuación que persiste; no hay historial.

**La propuesta de retraso** elige el desfase por el crédito sin ajustar, porque la escala se aplana al llegar a 10.000, y decide si proponerlo por la ganancia en puntos ajustados.

Efecto sobre la toma analizada: 3.915 puntos como se cantó, 5.703 con estas reglas. La interpretación es la misma: en la nota un 28 % del tiempo y hasta un semitono un 49 %.

El 27 % de las notas sin tono detectado en esa toma se reparte así: 12 % de sonido sin tono (consonantes, aire) y 15 % por debajo del umbral, es decir, sin cantar. De 343 notas, 50 quedaron sin cantar, en 63 la voz entró tarde (mediana de 78 ms) y en 29 se soltó antes del final. No es un fallo de detección.

## Separador de voz, escala de la grabación y cambio de tono · revisión 2J

El usuario aceptó las tres propuestas de la revisión anterior: puntuar respecto a la voz original, poder bajar el tono y probar un separador pensado para la voz (con permiso para descargar `Kim_Vocal_2.onnx`).

**Separador en dos pasadas.** `Inst_HQ_3` está entrenado para el instrumental: la voz que entregaba era el residuo, con el bajo y los metales que no reconocía como instrumento. `Kim_Vocal_2` (misma arquitectura MDX-Net y mismo tamaño, otro entrenamiento) está entrenado para la voz. `prepare.py` usa cada modelo para la pista que mejor conserva: el instrumental de `Inst_HQ_3`, la voz de `Kim_Vocal_2`; la mezcla con voz reducida se arma con esas dos. Cada pasada debe reconstruir el original por sí sola (comprobación de alineación de la revisión 2C) y también el par que se conserva. El manifiesto mantiene `separator.model` como texto (`"UVR-MDX-NET-Inst_HQ_3.onnx + Kim_Vocal_2.onnx"`) para que los manifiestos anteriores y los nuevos validen igual, y añade `separator.models`. La separación tarda el doble.

Comparación sobre las dos canciones de prueba, con el mismo análisis CREPE para el mapa:

| | Primaveras · Inst_HQ_3 | Primaveras · Kim_Vocal_2 | Luz de Día · Inst_HQ_3 | Luz de Día · Kim_Vocal_2 |
| --- | --- | --- | --- | --- |
| Lecturas de la voz por debajo de Do3 (el bajo colado) | 45 % | 1 % | 24 % | 14 % |
| Notas del mapa en tramos sin letra | 51 | 0 | 0 | 0 |
| Notas del mapa | 394 | 337 | 493 | 508 |
| Voz original contra su mapa, Normal, sobre el máximo teórico | 6.845 (cobertura 74 %) | 9.778 (98 %) | 8.423 (88 %) | 8.325 (87 %) |

En «Primaveras» el cambio es grande: la voz sale limpia y el mapa ya no tiene notas en la introducción ni en el interludio. En «Luz de Día» queda casi igual; la voz de Enanitos Verdes es grave (el mapa baja hasta Fa#2) y lo que queda por debajo de Do3 es voz.

La toma del usuario en «Primaveras», comparada instante a instante con la voz original y sin pasar por el mapa: en la misma nota el 46 % del tiempo y desviación mediana de −18 cents, frente al 31 % y −54 cents que salían con la voz de `Inst_HQ_3`. Buena parte de la inclinación hacia grave del diagnóstico 2H era el bajo de la pista de voz, no el canto.

**Escala de la grabación.** La revisión 2I descartó medir el techo canción por canción porque una voz separada sucia lo falseaba. Con el separador de voz la medida es fiable, y varía entre canciones (0,98 en «Primaveras», 0,83 en «Luz de Día»): el detector de la app no lee igual todas las voces. `src/voice-reference.ts` lee la voz aislada en un worker (`public/audio/voice-reference.js`, con el mismo encuadre que el worklet del micrófono; ~1 s por canción), la puntúa con el mismo mapa, las mismas reglas y su propio umbral de silencio, y ese resultado es el 10.000 de la canción en Relajada y Normal (`ScoreTracker` acepta un techo propio). Reglas:

- La medida se toma con el mapa tal como se canta (sin las notas fuera de la letra) y en el tono original de la grabación.
- Si la voz aislada no llega al 75 % del máximo teórico no se usa: esa falta es de la separación, no del cantante. Se aplica la escala general (85 %) y el resultado sugiere volver a separar. Es lo que pasa con las canciones preparadas con `Inst_HQ_3` como «Primaveras» (0,68). *Cambiado en 2K: ahora la escala tiene un piso del 75 % en vez de saltar a la general; véase esa sección.*
- Sin pistas preparadas (mapa a mano, ejercicio incluido) también se usa la escala general.
- Estricta no cambia de escala; el resultado informa de lo que obtiene la grabación.
- La propuesta de retraso usa la misma escala que la toma.

La versión pasa a `encore-intonation-5` y las mejores marcas anteriores dejan de compararse. El resultado descargado incluye `recording` (lo que obtuvo la grabación, el techo y si se usó) y, desde esta versión, el mapa cantado en el tono en que se cantó.

En «Primaveras», preparada de nuevo, la toma del usuario vale 5.542 en Relajada (5.703 en la app actual con el mapa antiguo y la escala general; 6.391 con el mapa nuevo y la escala general). La diferencia con la escala general es lo que se buscaba: 10.000 es Vicente Fernández, que el sistema lee casi entero. Referencias en la misma escala: mejor nota fija 4.718, notas al azar 2.757, la toma sobre otra parte de la canción 1.143. En Normal, 4.452 frente a 3.032 de la nota fija.

**Cambio de tono.** `POST /api/preparation/transpose` recibe la pista elegida (original, voz reducida o instrumental), comprueba su SHA-256 y la mueve de −6 a +6 semitonos con el filtro Rubber Band de FFmpeg (`pitchq=quality`, canales juntos). Después rellena y recorta a exactamente el número de muestras pedido, porque Rubber Band puede acabar unos milisegundos antes; medido con ráfagas de tono, los inicios se desplazan como mucho 20 ms y la altura queda a menos de 5 cents. Procesa unas 13 veces más rápido que el tiempo real. Los resultados se guardan en `.local/audio/transposed` (hasta 2 GB, se borran los menos usados). Un solo trabajo a la vez; si el navegador cancela, se detiene FFmpeg. `GET /api/preparation/transpose` dice si el cambio está disponible sin esperar la comprobación de Python, y solo lo ofrece si ese FFmpeg incluye Rubber Band (el de Windows que instala el motor lo incluye).

En la app, el selector **Tono de la canción** (de −5 a +5) sustituye al registro de octava en las canciones con audio. Las notas del mapa y la guía se mueven con la pista; la última pista pedida se conserva en memoria para repetir sin volver a enviarla. El selector queda desactivado, con explicación, si el servidor no puede cambiar el tono. Cuando la desviación media indica que el usuario canta por debajo de la nota, el resultado sugiere bajar la canción uno o dos semitonos.

Verificado: pruebas unitarias del filtro (altura, duración exacta, caché, permisos), prueba de navegador con el servidor simulado (pista y notas movidas, sin reenvío al repetir, cancelación limpia) y una comprobación de extremo a extremo con el servidor real: pista 3 semitonos abajo reproducida a 219,5 Hz para 220 esperados, 10.000 puntos con una voz en el nuevo tono, 0,7 s de proceso para 4 s de canción. `tests/audio-service-check.mjs` pasa con las dos pasadas y los dos modelos reales.

**Ensayo por frases.** Mejora añadida con el margen que dejó el usuario. Cada frase del resultado tiene **Ensayar**: el motor (`phrase` en `KaraokeEngine`) evalúa solo las notas de esa frase y reproduce desde `PHRASE_LEAD_IN` (2 s) antes de su primera nota hasta 0,6 s después de la última, tras la cuenta atrás de siempre. La calibración (retraso, ruido, altavoces) y el umbral de silencio se toman respecto al inicio de ese tramo. El resultado dice qué frase se ensayó, ofrece repetirla o volver a la canción completa, no guarda marca y descarga solo las notas de esa frase (`phrase` en el documento). Con el tono cambiado se ensaya en ese tono.

No comprobado: el cambio de tono con voz humana ni la calidad auditiva de Rubber Band en canciones completas a ±5 semitonos; la nueva escala con más canciones y cantantes.

## Tomas del 19 de octubre, piso de la escala e historial · revisión 2K

Dos resultados descargados, ambos en Relajada con la revisión 2J. Las pistas y mapas se regeneraron desde los MP3 del usuario (`artifacts/audio-que-distintos`, `artifacts/audio-kilometros`); en «Qué distintos tú y yo» las 467 notas cantadas coinciden con el mapa regenerado y la medida de la grabación coincide con la de la app (0,761 frente a 0,765).

| | Qué distintos tú y yo | Kilómetros |
| --- | --- | --- |
| Puntos en la app | 7.026 (voz al 25 %) | 4.165 (voz original) |
| La grabación sobre el máximo teórico, Relajada / Normal | 0,76 / 0,73 | 0,75 / 0,73 |
| Tu voz frente a la del cantante, en el mismo instante: en la nota / mediana | 40 % / +4 cents | 30 % / −22 cents |
| Media por frase | 85 % hasta el minuto 3:18; 18 % después | 40 % |

**«Qué distintos tú y yo».** Hasta el minuto 3:18 la toma es buena y centrada, sin inclinación. Desde ahí el mapa y la voz original bajan a La3–Do4 y el usuario siguió una línea más aguda, alrededor de Re#4–Mi4 (de 3 a 4 semitonos por encima). No es un fallo del mapa: la voz principal de la grabación está donde dice el mapa.

**«Kilómetros».** El mapa coincide con la voz original (en la nota del 54 % al 90 % según el tramo). El usuario canta casi siempre por debajo, de uno a cuatro semitonos en los tramos agudos. Puntuada contra el mapa movido, la toma encaja mejor un semitono abajo (Relajada: 5.045 frente a 4.454): es la canción para probar «Tono de la canción» en −1 o −2.

**Piso de la escala.** Las dos grabaciones quedan en el filo del 75 %. En «Qué distintos tú y yo» Relajada (0,76) fijaba la escala y Normal (0,73) saltaba a la general del 85 %; «Kilómetros» (0,7494) también saltaba. Un salto así no tiene sentido entre dos medidas casi iguales y castigaba precisamente a las canciones peor leídas. Desde 2K el techo es `max(medida, 0,75)`: la escala sigue sin poder volverse más indulgente que el 75 % por una separación imperfecta, pero cambia de forma continua. El mensaje del resultado lo explica y solo sugiere volver a separar si las pistas son del separador anterior (`separator.models` ausente en el manifiesto). No se cambió `SCORING_VERSION` para no esconder las mejores marcas del usuario, que eran el único registro de las tomas que no descargó; solo cambian las canciones por debajo del 75 %, y cada resultado descargado incluye el techo con el que se puntuó.

### Preparación más rápida

El usuario notó que preparar una canción tarda de 10 a 15 minutos. Medido en su equipo (Intel i7-14650HX, 16 núcleos y 24 hilos) con «Kilómetros», 193 s de audio: 426 s en total. CREPE «full» se llevaba 212 s y pYIN 39 s; cada pasada de separación unos 90 s. El motor limitaba el análisis a 4 hilos, y darle 12 a un solo proceso apenas ayudaba (188 s): CREPE no aprovecha más hilos en un mismo proceso.

Los tramos de 20 s del análisis son independientes (cada uno lleva un segundo de contexto a cada lado), así que ahora se reparten en 4 procesos de 4 hilos (`melody_frames.WORKERS`, `THREADS`). Con 4 hilos por tramo, como antes, el resultado es idéntico bit a bit; 6 procesos de 3 hilos ganan muy poco más con diferencias numéricas mínimas, y 8 de 2 resultan más lentos (231 s).

| Variante del análisis | Tiempo | Diferencia con el resultado anterior |
| --- | --- | --- |
| Un proceso, 4 hilos (antes) | 272 s | — |
| 4 procesos × 4 hilos (ahora) | 130 s | ninguna |
| 6 procesos × 3 hilos | 125 s | 0,0004 Hz como máximo |
| 8 procesos × 2 hilos | 231 s | 0,0004 Hz como máximo |

Las dos pasadas de separación a la vez no compensan: ONNX Runtime ya ocupa todos los núcleos con una sola (90 s), y en paralelo tardan 260 s con sus hilos por defecto o 167 s limitadas a 8 hilos cada una, frente a 180 s una tras otra. Se descartó.

Resultado: «Kilómetros» pasa de 426 s a 311 s, con las tres pistas y las 491 notas del mapa idénticas a la preparación anterior. Pasan `tests/audio-service-check.mjs` y `tests/analysis-service-check.mjs` con los modelos reales.

Lo que queda es lo que ningún reparto en el procesador acelera: separar y analizar con la GPU (una RTX 5050 en este equipo) bajaría la preparación a alrededor de un minuto, pero requiere instalar PyTorch y ONNX Runtime con CUDA (unos 3 GB). Pendiente del permiso del usuario.

### Historial de intentos

El usuario cantó varias canciones nuevas con la revisión 2J, notó que la puntuación subía y solo descargó dos resultados. Los demás se perdieron: el resultado existía solo en la pestaña. Las mejores marcas sí estaban guardadas; `scripts/mis-marcas.js`, pegado en la consola del navegador con la app abierta, las lista con el título de cada canción sin modificar nada.

Desde 2K cada toma con micrófono y mapa de notas se guarda al terminar (`src/take-history.ts`) en una base IndexedDB propia, `encore-takes-v1`, separada de la biblioteca para no migrarla. Se guarda el mismo documento que da «Descargar resultado» (puntuación, trazo y mapa cantado; nunca audio), unos 150–200 kB por toma, y se conservan las 60 más recientes. «Tus intentos guardados», en el escenario, las lista (canción, fecha, exigencia, tono, ensayo de frase y puntos) para descargarlas o borrarlas una a una o todas. Las tomas de demostración no se guardan.

## Letras completas y canto libre

La revisión **2E** mejora la explicación de resultados: distingue cobertura parcial de afinación y muestra diagnóstico por frase. La descarga JSON (versión 4 desde la revisión 2F) incluye tiempos, señal, tono y errores por frase junto con el texto de retroalimentación, datos básicos de la referencia, la exigencia y lo medido en la captura (`capture`: retraso aplicado, ruido de fondo, altavoces y propuesta). El promedio firmado puede compensar desviaciones graves/agudas; no sustituye al error absoluto. Detalles y análisis de una prueba real en `docs/EVALUACION-02E.md`.

En la ficha de una canción, **Tu letra, de una sola vez** permite buscar por título/artista o pegar un enlace `https://lrclib.net/tracks/…`. La consulta local `/api/lyrics` devuelve opciones ordenadas en la interfaz por cercanía de duración. Se distingue texto plano de LRC con tiempos por línea, se muestra la diferencia con tu archivo y se solicita revisar la versión antes de aplicar LRC. Los tiempos fuera del audio se rechazan; puedes elegir **Usar solo el texto**.

También puedes pegar toda la letra en el cuadro y elegir su formato. No se crean notas ni se reemplaza el mapa musical al editar texto. Las letras se guardan en la misma ficha IndexedDB. **Ajustar letra (s)** desplaza solo la letra: positivo la retrasa, negativo la adelanta. La descarga de LRC incorpora el ajuste efectivo para poder reutilizarlo.

Con letra y sin notas, aparece **Guardar y cantar sin puntuación**. Se reproduce tu audio original, la letra LRC avanza por líneas y la letra plana queda en un panel desplazable manualmente. **Escuchar canción** reproduce sin pedir micrófono; **Empezar a cantar** usa la entrada seleccionada. La sesión libre muestra «Sin puntuación» y exporta `scored:false, score:null`, sin porcentajes de afinación ficticios. Si existe un mapa válido, la puntuación anterior se mantiene; los resultados por frase corresponden al mapa, no a la letra independiente.

LRCLIB no aporta alturas musicales. Un LRC normal no aporta tiempos por palabra. La sincronización de otra edición puede ser incorrecta aunque sus duraciones se parezcan. Para el enlace del usuario `34541541`, el servicio indicó 289 s y 47 marcas de tiempo; su captura mostraba audio de aproximadamente 267 s. Verificar edición y tiempos antes de usarlo.

El servicio solo consulta LRCLIB al pulsar buscar: no envía audio. Incluye timeout de 10 s, cola por proceso, deduplicación, caché temporal y errores recuperables. Funciona con Vite dev y preview, igual que MusicBrainz.

## Qué incluye la etapa 1

- Melodía y letra originales compuestas para el prototipo (`src/song.ts`). Acompañamiento sintetizado con Web Audio, sin canciones descargadas.
- Reloj de audio compartido por reproducción, letras y mapa de notas.
- Estimación de frecuencia fundamental mediante YIN en un AudioWorklet.
- Puntuación por precisión de afinación y duración de la señal, rachas y cobertura de voz.
- Cuenta atrás, reinicio, cancelación y cierre de las pistas de micrófono.
- Manejo de permisos rechazados, dispositivo ausente/ocupado y desconexión.
- Compensación de retraso de 0 a 300 ms, manual en la etapa 1; desde la revisión 2F parte del valor que informa el equipo y se ajusta con una propuesta tras cada canción.
- Resultados por frase y vista de las siguientes etapas.
- Selector de micrófono, monitor previo sin puntuación y diagnóstico de señal, tono y octava. Registros Grave/Original/Agudo para el ejercicio sintetizado.

## Límites que deben mantenerse visibles

- No identifica ni califica palabras, pronunciación, timbre o calidad artística.
- Las barras no prueban por sí mismas que la persona canta: música filtrada por altavoces puede activar el detector. Usar auriculares; la evaluación no es un mecanismo antitrampas.
- La melodía guía es instrumental, no una voz sintetizada pronunciando la letra.
- Los enlaces Spotify/YouTube no se descargan. Se importa un archivo local que tengas permiso de utilizar.
- Los archivos importados se reproducen en su registro original; la transposición del audio queda pendiente. Con exigencia Normal o Relajada puedes cantarlos en otra octava. El mapa automático es experimental y puede cubrir solo una parte del canto.
- Con octava libre y tolerancia amplia, un sonido afinado que no sea tu voz (la guía o la canción por los altavoces) también suma. El aviso de altavoces lo detecta en la cuenta atrás, no lo impide.
- YIN funciona mejor con una única voz. Coros, ruido, vibrato e instrumentos pueden producir errores.
- La exactitud con señales sintéticas no valida la latencia de todos los micrófonos, navegadores o teléfonos.
- Salir de la pestaña detiene la práctica para evitar resultados basados en frames omitidos. No hay reanudación todavía.
- No se comparte ni persiste la puntuación; aún no existen rankings, PWA offline ni instaladores de escritorio.

## Evaluación reproducible

```powershell
npm test
npm run build
# Con npm run dev activo en otra terminal y Microsoft Edge instalado:
npm run test:browser
```

Las pruebas de navegador utilizan una entrada sintética y casos de permisos simulados. No escuchan el micrófono físico del usuario. Para otros entornos se puede cambiar `channel` en `playwright.config.ts` por un navegador Playwright instalado.

- `tests/audio.test.mjs`: detector, silencio, ruido, armónicos, octavas, cobertura y puntuación independiente de la tasa de frames.
- `tests/browser/karaoke.spec.ts`: demo completa, exportación, controles, permisos, procesador real con flujo sintético, cancelación y vista móvil.
- `tests/browser/microphones.spec.ts`: selección exacta, monitor, persistencia, desconexión y canto completo por la captura real con señal sintética.
- `tests/library.test.mjs` y `tests/browser/library.spec.ts`: validación, importación, edición, persistencia, errores, MusicBrainz y canto de audio importado.
- `tests/lyrics.test.mjs` y `tests/browser/lyrics.spec.ts`: texto/LRC, consultas LRCLIB, desfases, persistencia, versión diferente, errores y canto libre sin puntuación.
- `tests/preparation.test.mjs`, `tests/audio_analysis_test.py` y `tests/browser/preparation.spec.ts`: manifiestos/WAV, notas conocidas, alineación, cancelación del árbol de procesos, aceptación, guardado y reproducción de tres variantes. Python: `.venv-audio/Scripts/python.exe tests/audio_analysis_test.py`.
- `tests/audio-service-check.mjs`: prueba explícita del modelo/API real con el fixture local `artifacts/audio-check/original.wav`. `tests/real-preparation-check.mjs <original> <salida CLI>` verifica resultados existentes en un navegador temporal; no acredita su calidad auditiva.
- `docs/ETAPAS.md`: alcance y criterios para cada entrega.
- `tests/intonation.test.mjs`, `tests/melody_analysis_test.py` y `tests/browser/tuner.spec.ts`: referencia continua, señal PCM, vibrato, deslizamientos, silencios, errores conocidos y afinador. `tests/analysis-service-check.mjs` comprueba el nuevo endpoint con inferencia real. El verificador de archivo real admite un tercer argumento con `analysis.json` para comprobar la mejora y persistencia.
- `tests/karaoke-scoring.test.mjs` y `tests/browser/karaoke-mode.spec.ts`: exigencias y octavas, nota escrita frente a curva, propuesta de retraso, umbral de nivel, detección de altavoces y limpieza de temporales. `tests/browser/library.spec.ts` comprueba además que el escenario sigue los cambios guardados en la biblioteca y que probar el micrófono conserva el resultado.
- `docs/EVALUACION-01.md`, `docs/EVALUACION-02.md`, `docs/EVALUACION-02B.md`, `docs/EVALUACION-02C.md` y `docs/EVALUACION-02D.md`: evidencia de evaluación y límites de lo comprobado.
- `docs/CONTINUAR.md`: punto de continuidad ante interrupciones de cuota.

## Arquitectura

`App.tsx` controla la sesión y sus estados; `Stage.tsx` dibuja el escenario. `audio.ts` se encarga del contexto, la captura y el reloj. El worklet procesa audio fuera del hilo de React y envía medidas aproximadamente cada 21–24 ms. La interfaz se actualiza aproximadamente a 30 fps.

`scoring.ts` integra cada intervalo de voz sobre la referencia continua del mapa, limita saltos largos y descarta muestras duplicadas. El máximo fijo es 10.000 puntos. El crédito es completo dentro de la tolerancia de la exigencia elegida y disminuye linealmente hasta cero (tabla en «Cantar en condiciones reales»); solo en Estricta las octavas cuentan como distintas. Los silencios previstos y tramos sin referencia no se puntúan ni penalizan; no cantar durante una nota evaluable sí reduce el resultado. Racha: notas completas con al menos 65% de crédito. La cobertura indica tono fiable detectado, incluso si está desafinado. La afinación se calcula sobre el tiempo cantado; sin tono fiable no se inventa ese porcentaje. Los resultados exportados identifican `encore-intonation-3` y su exigencia; los de `encore-intonation-2` equivalen a la exigencia Estricta.

Separar el tiempo capturado del tiempo de reproducción permite comparar la muestra con su nota de referencia después de compensar el retraso. El cursor de la letra sigue la reproducción; la posición del punto de voz refleja el tiempo evaluado.

## MusicBrainz: decisión de integración

Integrado como fuente de **metadatos**: título, artista, grabación, lanzamiento, duración y MBID. Es útil para distinguir versiones; no reemplaza el archivo de audio, los permisos de uso, la letra sincronizada ni el mapa vocal.

El servicio local `server/musicbrainz.mjs`, conectado a Vite, expone `/api/musicbrainz/recordings`. Envía solo título y artista al buscar explícitamente; utiliza identificación de cliente, cola global por proceso con separación de 1,1 segundos, caché de 15 minutos, deduplicación, timeout de 8 segundos y mensajes de error. No necesita clave para esta consulta pública. La búsqueda por mood tendrá su propio índice y evaluación posterior.

El servicio funciona con `npm run dev` y `npm run preview`. Copiar únicamente `dist/` a un alojamiento estático no proporciona esta API. Si el proyecto se publica o escala, habrá que preparar un servidor de catálogo y revisar la identificación/contacto, condiciones del servicio y limitación compartida entre procesos.

Fuentes consultadas el 14 de septiembre de 2026:
- https://musicbrainz.org/doc/MusicBrainz_API
- https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet
- https://developer.spotify.com/policy
- https://developers.google.com/youtube/terms/developer-policies-guide
