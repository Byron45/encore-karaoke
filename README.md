# Encore · Karaoke personal

Aplicación web local en React + TypeScript. Nombre provisional. Etapa 2: **biblioteca de audio propia, editor de letras y notas, y metadatos MusicBrainz**, sobre el escenario de afinación de la primera entrega.

Ampliaciones implementadas: **LRCLIB y letras completas/LRC**, separación vocal local y mapa automático. La etapa **2D** añade análisis CREPE + pYIN, curvas de afinación, mejora del mapa reutilizando la voz aislada y un afinador conectado a la evaluación. Evidencia y límites en `docs/EVALUACION-02D.md`.

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

La biblioteca se guarda en IndexedDB del mismo navegador y origen. Abrir `localhost` en lugar de `127.0.0.1`, cambiar de puerto o navegador crea otro espacio. Borrar los datos del sitio elimina la biblioteca; no hay copia en la nube. La elección de micrófono se recuerda en localStorage.

El mapa puede editarse manualmente o generarse como **borrador automático experimental**. Cada mapa JSON Encore versión 1 (manual), 2 (automático) o 3 (con curvas de afinación) se vincula al contenido exacto del audio mediante SHA-256 y a su duración. Se conservan los mapas anteriores. Un mapa de otro archivo se rechaza, aunque tenga el mismo título. Se admiten 2.000 notas, 40.000 puntos de curvas en total y 12 MB de JSON. Cambiar los metadatos MusicBrainz no altera la pista ni demuestra que sus notas sean correctas.

## Separación y mapa automático · etapa 2C

En esta computadora el motor ya está instalado y probado. Para otra instalación, instala [uv](https://docs.astral.sh/uv/) y ejecuta `npm run audio:setup`. Crea `.venv-audio` con Python 3.11 y dependencias fijadas en `scripts/audio/requirements-lock.txt`. Se usa CPU; no requiere configurar CUDA. El primer procesamiento descarga el modelo `UVR-MDX-NET-Inst_HQ_3.onnx` (~67 MB). Después queda en `.local/audio/models`.

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

La API `/api/preparation` funciona con Vite dev/preview en loopback, valida origen y token, permite un solo trabajo y cancela su árbol de procesos en Windows. Los trabajos descargados/cancelados se eliminan; el modelo queda en caché. Tras un cierre abrupto pueden quedar temporales en `.local/audio/jobs`. Un alojamiento estático o un teléfono sin este servidor local no ejecuta Python.

## Mejorar el mapa y comprobar afinación · etapa 2D

Para canciones ya separadas: **Biblioteca → canción → Mejorar mapa desde la voz**. Reutiliza el WAV vocal guardado; no vuelve a separar ni modifica las tres pistas. Compara el borrador con el anterior, escucha la voz aislada, acepta el mapa y pulsa **Guardar cambios** o **Guardar y cantar**. Cancelar o descartar conserva el mapa anterior. Las nuevas preparaciones usan directamente este motor.

El análisis sigue la altura cada 20 ms y conserva una curva dentro de cada nota para representar vibrato y deslizamientos. Procesa por CPU y puede tardar varios minutos. `torchcrepe==0.0.24` y sus pesos se instalan con `npm run audio:setup`; no se sube audio a un servicio externo.

En el escenario, el afinador muestra la referencia, tu frecuencia y la diferencia en cents: negativa significa más grave, positiva más aguda; 100 cents equivalen a un semitono. Afinador, curva dibujada y puntuación comparten la referencia. Sin tono fiable o sin referencia, el indicador queda neutral. En el resultado se separan **Afinación al cantar** y **Cobertura de notas**, con error medio y tendencia grave/aguda. No detecta palabras.

Los mapas automáticos excluyen hasta 20 ms por extremo de nota para reducir penalizaciones en transiciones, conservando al menos 80 ms evaluables. El resultado indica el tiempo excluido. La compensación de micrófono sigue siendo manual; las pruebas sintéticas no sustituyen cantar con el dispositivo real.

## Letras completas y canto libre

La revisión **2E** mejora la explicación de resultados: distingue cobertura parcial de afinación y muestra diagnóstico por frase. La descarga JSON v3 incluye tiempos, señal, tono y errores por frase junto con el texto de retroalimentación y datos básicos de la referencia. El promedio firmado puede compensar desviaciones graves/agudas; no sustituye al error absoluto. Detalles y análisis de una prueba real en `docs/EVALUACION-02E.md`. La fórmula de puntuación continúa en `encore-intonation-2`.

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
- Compensación **manual** de 0 a 300 ms. No constituye calibración automática.
- Resultados por frase y vista de las siguientes etapas.
- Selector de micrófono, monitor previo sin puntuación y diagnóstico de señal, tono y octava. Registros Grave/Original/Agudo para el ejercicio sintetizado.

## Límites que deben mantenerse visibles

- No identifica ni califica palabras, pronunciación, timbre o calidad artística.
- Las barras no prueban por sí mismas que la persona canta: música filtrada por altavoces puede activar el detector. Usar auriculares; la evaluación no es un mecanismo antitrampas.
- La melodía guía es instrumental, no una voz sintetizada pronunciando la letra.
- Los enlaces Spotify/YouTube no se descargan. Se importa un archivo local que tengas permiso de utilizar.
- Los archivos importados se reproducen en su registro original; la transposición del audio queda pendiente. El mapa automático es experimental y puede cubrir solo una parte del canto.
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
- `docs/EVALUACION-01.md`, `docs/EVALUACION-02.md`, `docs/EVALUACION-02B.md`, `docs/EVALUACION-02C.md` y `docs/EVALUACION-02D.md`: evidencia de evaluación y límites de lo comprobado.
- `docs/CONTINUAR.md`: punto de continuidad ante interrupciones de cuota.

## Arquitectura

`App.tsx` controla la sesión y sus estados; `Stage.tsx` dibuja el escenario. `audio.ts` se encarga del contexto, la captura y el reloj. El worklet procesa audio fuera del hilo de React y envía medidas aproximadamente cada 21–24 ms. La interfaz se actualiza aproximadamente a 30 fps.

`scoring.ts` integra cada intervalo de voz sobre la referencia continua del mapa, limita saltos largos y descarta muestras duplicadas. El máximo fijo es 10.000 puntos. Hay crédito completo dentro de 35 cents, disminución lineal hasta 100 cents y cero desde un semitono. Las octavas cuentan como distintas. Los silencios previstos y tramos sin referencia no se puntúan ni penalizan; no cantar durante una nota evaluable sí reduce el resultado. Racha: notas completas con al menos 65% de crédito. La cobertura indica tono fiable detectado, incluso si está desafinado. La afinación se calcula sobre el tiempo cantado; sin tono fiable no se inventa ese porcentaje. Los resultados exportados identifican `encore-intonation-2` y no son directamente comparables con la puntuación anterior.

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
