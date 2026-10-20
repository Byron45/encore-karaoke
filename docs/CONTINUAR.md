# Punto de continuación · revisión 2K terminada

## Última revisión: tomas del 19 de octubre, piso de la escala e historial

19 de octubre de 2026. El usuario cantó varias canciones con 2J (dice que la puntuación subió) y solo descargó dos resultados: «Kilómetros» (Los Caligaris, 4.165, voz original) y «Qué distintos tú y yo» (7.026, voz al 25 %). Pistas regeneradas en `artifacts/audio-kilometros` y `artifacts/audio-que-distintos`. Diagnóstico: en «Qué distintos» la toma es buena hasta 3:18 (85 % por frase) y después sigue una línea 3–4 semitonos más aguda que la voz principal; en «Kilómetros» canta por debajo y encajaría mejor un semitono abajo.

Cambios 2K: la escala de la grabación tiene un piso continuo del 75 % en vez de saltar a la general del 85 % (sin cambiar `SCORING_VERSION`, para no esconder sus marcas); historial de los últimos 60 intentos en IndexedDB propia (`encore-takes-v1`) con descarga y borrado desde el escenario; `scripts/mis-marcas.js` lista las mejores marcas desde la consola del navegador. Detalle en `docs/NOTAS-TECNICAS.md`, sección 2K.

Después, a petición del usuario (la preparación le tardaba 10–15 min): el análisis de la melodía se reparte en 4 procesos de 4 hilos; «Kilómetros» pasa de 426 s a 311 s con resultado idéntico. Separar en paralelo no compensa. La aceleración con la GPU (RTX 5050) necesita unos 3 GB de descargas y espera su permiso, igual que la evaluación de la letra con reconocimiento de voz.

Pendiente: que el usuario pruebe «Kilómetros» en −1/−2 y ensaye el final de «Qué distintos» con la voz al 25 %.

## Revisión 2J: separador de voz, escala de la grabación y cambio de tono

18 de octubre de 2026. El usuario aceptó las tres propuestas de 2I, autorizó descargar `Kim_Vocal_2.onnx` y dejó libertad para otras mejoras. Revisión 2J:

- `prepare.py` separa en dos pasadas: instrumental con `Inst_HQ_3`, voz con `Kim_Vocal_2`. En «Primaveras» el bajo colado en la voz baja del 45 % al 1 % y el mapa pierde sus 51 notas instrumentales.
- En canciones con pistas preparadas, 10.000 puntos son lo que obtiene la voz aislada de la grabación con las mismas reglas (`src/voice-reference.ts`). La escala no baja del 75 % del máximo (desde 2K; antes, por debajo de ese valor se usaba la general del 85 %). `encore-intonation-5`; las marcas anteriores no se comparan.
- Selector «Tono de la canción» (±5 semitonos) para canciones con audio: el servidor local mueve la pista con Rubber Band (`POST /api/preparation/transpose`, caché en `.local/audio/transposed`) y las notas se mueven con ella.
- Ensayo por frases desde el resultado (botón «Ensayar»): solo esa frase, desde 2 s antes, sin marca.

Medidas y decisiones en `docs/NOTAS-TECNICAS.md`, sección 2J. Las canciones de la biblioteca del usuario siguen con las pistas de `Inst_HQ_3` hasta que las vuelva a separar; «Primaveras» queda en la escala general hasta entonces.

Pistas de comparación fuera del repositorio: `artifacts/audio-*/kim/vocals.wav` y `artifacts/audio-*/kim/map/analysis.json`; `artifacts/audio-un-millon-de-primaveras/kim` sirve como carpeta `--prepared` para `scripts/analyze-take.mjs` (para la toma 4, `--unsung 0-17,75-94`).

Pendiente: que el usuario vuelva a separar «Primaveras» y la cante en la nueva escala, probar el cambio de tono con voz real y escuchar la calidad de Rubber Band a ±5 semitonos.

## Revisión 2I: escala para una voz real y nivel por defecto

11 de octubre de 2026. El usuario indicó que las puntuaciones seguían bajas y dejó las medidas a criterio del asistente. Revisión 2I: en Relajada y Normal, 10.000 puntos equivalen al 85 % del máximo teórico (lo que alcanza la voz original de una grabación); el nivel por defecto pasa a Relajada; el resultado dice cómo fue la toma y, si la voz se inclina hacia grave o agudo, hacia dónde corregir. La toma de «Un Millón de Primaveras» pasa de 3.915 a 5.703 puntos con la misma interpretación. Medidas y decisiones en `docs/NOTAS-TECNICAS.md`.

`scripts/analyze-take.mjs` analiza un resultado descargado y, con la carpeta de `prepare.py`, lo compara con la voz original. Las pistas de las dos canciones probadas están en `artifacts/audio-luz-de-dia` y `artifacts/audio-un-millon-de-primaveras` (fuera del repositorio; se regeneran con `prepare.py` desde los MP3 de `C:\Users\ASUS\Music`).

Lo que queda es afinación real del cantante (en la nota un 28 % del tiempo, inclinado hacia grave) y calidad de la separación. Resuelto en 2J: modelo de separación para la voz y cambio de tono; la inclinación hacia grave resultó ser en buena parte el bajo colado en la voz.

## Revisión 2H: fuga de los auriculares y notas sin letra

9 de octubre de 2026. Segunda prueba del usuario, «Un Millón de Primaveras» (Vicente Fernández), 3.915 puntos, ya con el trazo en el resultado. Observó que en los interludios puntuaba sin cantar. Causas confirmadas con el trazo: la música de los auriculares se cuela en su micrófono a 0,004–0,009 de nivel y el umbral de la revisión 2F (0,0054) la dejaba pasar; y el mapa automático tenía 51 notas en la introducción y el interludio.

Revisión 2H: el umbral de silencio sale del nivel en reposo y del nivel de la voz de la propia toma (`LevelStats`, `levelGate` en `src/capture.ts`) y el resultado se vuelve a puntuar con el umbral definitivo; con letra con tiempos, las notas automáticas fuera de las líneas cantadas no se evalúan (`sungNotes` en `src/library-model.ts`). El resultado incluye el mapa cantado (`reference.chart`). Detalle y medidas en `docs/NOTAS-TECNICAS.md`.

Diagnóstico de la puntuación baja, medido contra el mapa y contra la voz original aislada: el usuario está en la nota entre el 28 % y el 36 % del tiempo y canta hacia grave (mediana −51 cents). Es una diferencia real de afinación, no un fallo de medida. La escala además es dura: la voz original obtiene 6.845 y 8.432 en las dos canciones probadas.

Para repetir el análisis de una toma: `scripts/audio/prepare.py` sobre el MP3 original genera la voz aislada y el mapa; los scripts usados quedaron fuera del repositorio.

Pendiente de decidir con el usuario: mostrar la puntuación respecto a la voz original; transponer el acompañamiento para cantar en un tono cómodo; probar un modelo de separación pensado para la voz (hay que descargarlo); monitor de la propia voz.

## Revisión 2G: calibración con voz real

9 de octubre de 2026. El usuario cantó «Luz de Día» con auriculares HyperX Cloud Stinger (entrada «Micrófono (Realtek(R) Audio)»), exigencia Normal, voz al 25 %, retraso automático de 60 ms: 4.001 puntos, cobertura 73 %, afinación 55 %, error 121 cents. La captura funcionó: señal 100 %, sin altavoces, ruido de fondo 0,0022.

La voz original aislada, puntuada contra su propio mapa, solo alcanzaba 7.319 puntos: el detector descartaba parte de una voz real. Revisión 2G: umbral de YIN 0,15 → 0,25, margen de tiempo de ±120 ms (Normal) y ±160 ms (Relajada), lecturas del intento conservadas en el resultado (`capture.trace` en la descarga) y botón «Ver trazo» por frase. La voz original pasa a 8.432 puntos. Medidas y decisiones en `docs/NOTAS-TECNICAS.md`, sección «Calibración con voz real».

El repositorio está en https://github.com/Byron45/encore-karaoke (privado). El usuario pidió seguir subiendo ahí los cambios.

Siguiente paso: repetir la misma canción y enviar el JSON descargado. Con el trazo se puede volver a puntuar el intento con otros ajustes y ver, frase por frase, si la desviación hacia grave es de la voz o del mapa. Pendiente de esa evidencia: limpiar el mapa (notas aisladas antes de que entre la voz, tramos de coro) y decidir si hace falta monitor de la propia voz en los auriculares.

## Revisión 2F: auditoría y evaluación para cantar en condiciones reales

9 de octubre de 2026. Una auditoría independiente confirmó que el motor es correcto en laboratorio y que el resultado real de 1.019 puntos no medía el canto: octava exacta, tolerancia de afinador, retraso sin medir, umbral de nivel fijo y música entrando por el micrófono. El proyecto pasó a ser un repositorio git; su primer commit conserva el estado anterior a estos cambios.

Entrega 2F. `src/scoring.ts` pasa a `encore-intonation-3` con exigencias Relajada, Normal (por defecto) y Estricta; Estricta es la regla anterior sin cambios. `src/pitch-reference.ts` comparte `pitchError` entre puntuación y afinador. `src/capture.ts` mide en la cuenta atrás el ruido de fondo, el umbral de nivel y si se oyen los clics. `src/audio.ts` aplica el retraso que informa el equipo cuando no hay ajuste propio y, al terminar, `estimateOffset` propone otro si explica mejor el intento; `src/preferences.ts` guarda exigencia y retraso por micrófono. Resultado JSON versión 4 con `difficulty`, `levelGate` y `capture`. Corregidos: el escenario seguía con el mapa anterior tras «Guardar cambios», los trabajos cancelados dejaban temporales y «Probar micrófono» borraba el resultado.

Verificado: 53 unitarias, 39 de navegador en una corrida completa (tras un último retoque de textos y estilos se repitieron solo las 6 afectadas), tipos y build; `tests/audio-service-check.mjs` con el modelo real, ahora afirmando que no quedan temporales. Voz sintética por el micrófono, worklet y puntuación reales: una octava abajo pasa de 0 a 9.744 en Normal; voz muy suave de 0 a 9.829; 150 ms de retraso propone 170 ms y recupera el resultado. Sobre el mapa de Luz de Día, un cantante simulado con σ=50 cents sube de 7.013 (Estricta) a 9.053 (Normal).

No comprobado: voz humana, altavoces y micrófono físicos, auriculares Bluetooth. El retraso que informa el equipo puede no coincidir con el real. El mapa automático sigue fragmentado (mediana 0,18 s por nota); la tolerancia y la propuesta de retraso lo mitigan, no lo corrigen.

Siguiente paso: cantar la misma canción con auriculares en exigencia Normal, aceptar la propuesta de retraso si aparece y repetir. Después, decidir entre mejorar el mapa (fusionar notas contiguas, alineación por sílabas) o importar mapas hechos a mano.

## Revisión anterior: prueba real del usuario y corrección de retroalimentación

16 de septiembre de 2026: el usuario compartió resultado v2 de Marta tiene un marcapasos (1019 puntos, referencia53,44 s, tono21,63 s, afinación25 %, cobertura40 %, señal44 %, análisis100 %, error175 cents, media firmada+11). Confirmó canto completo con micrófono de laptop SIN auriculares, final de unos30 s con vocalizaciones. Las cifras son coherentes; no permiten atribuir los ceros finales a silencio ni certificar afinación musical. Se explicó posible mezcla de altavoces y voz, sin afirmar causa demostrada.

Entrega2E: src/scoring.ts separa feedback de cobertura/afinación y añade phraseDiagnostics con tiempos, señal, tono y errores por frase. src/result.ts exporta JSONv3 con feedback mostrado y metadatos del mapa; no audio. App muestra detalle y aclara media firmada. Puntuación y detector sin cambios. El evaluador independiente confirmó defecto del mensaje anterior y revisó la corrección; se cerró también una ambigüedad en frases de puntuación redondeada0.

Verificado:43 unitarias,4 regresiones repetidas después del último ajuste, build final aprobado y5 casos E2E seleccionados aprobados. Un fallo inicial del nuevo E2E provenía del mock del módulo con timestampVite; corregido el test y aprobado. Capturas2E de escritorio/móvil inspeccionadas. No se repitió toda la suite de la etapa2D. Navegador encore-results cerrado. Puerto5173 ya estaba activo; no se inició otro servidor.

Siguiente paso: repetir misma canción/mapa/micrófono escuchando POR AURICULARES y descargar JSONv3. Esto ayuda a aislar interferencias antes de ajustar sensibilidad o mapa. No es necesario reprocesar el audio para esta mejora. Los informes v2 no permiten reconstruir diagnóstico por frase retrospectivamente. Informe completo docs/EVALUACION-02E.md. Se conserva debajo el contexto técnico2D.

Actualizado: 16 de septiembre de 2026, tras reanudar por cuota. Conservar proyecto, biblioteca e instalaciones. El usuario quiere entregas por etapas con evaluador independiente y continuar donde quedó tras interrupciones. Ignoró expresamente su pregunta sobre migrar cuentas.

## Estado operativo

Proyecto: C:\Users\ASUS\Documents\Empleo\Proyectos Personales\Karaoke. React/TypeScript/Vite. No es repositorio git. El usuario usa localhost:5173 en Opera; no cambiar origen o navegador porque IndexedDB es independiente. Las pruebas usan perfiles temporales en 127.0.0.1 y no tocaron su biblioteca.

Vite reiniciado, última sesión de herramienta 13415, puerto 5173. Comprobar listener antes de levantar otro. Las sesiones pueden desaparecer tras interrupción por cuota. Navegador de prueba encore-tuner cerrado.

.venv-audio: Python 3.11, audio-separator 0.47.0, librosa 0.11.0, torchcrepe 0.0.24; requirements-lock.txt fija dependencias. npm run audio:setup reproduce mediante uv. CPU, sin CUDA; Python global intacto. UVR-MDX-NET-Inst_HQ_3.onnx y Kim_Vocal_2.onnx (desde 2J) en .local/audio/models, FFmpeg 7.1 de gyan.dev con Rubber Band en .local/audio/models/bin, pesos CREPE incluidos en paquete. Conservar modelos/cachés. Un cierre abrupto puede dejar temporales en .local/audio/jobs.

## Entrega 2D

Tras biblioteca, MusicBrainz, LRCLIB y separación local, se implementó análisis CREPE + pYIN con curvas y afinador conectado a la puntuación.

- scripts/audio/melody_frames.py: estimaciones cada 20 ms y chunks con contexto, decodificador sin doble sigmoid.
- scripts/audio/melody.py: filtros, segmentación, curvas y diagnóstico encore-melody-2. prepare.py admite --analyze-only.
- POST /api/preparation/analysis: WAV vocal verificado de hasta 128 MiB, solo produce analysis.json. Mantiene origen/token, trabajo único y cancelación de árbol.
- src/pitch-reference.ts: referencia continua compartida, validación, señal fiable y márgenes de transición.
- src/scoring.ts: encore-intonation-2, afinación/cobertura separadas y error en cents. Crédito completo hasta 35 cents, cero desde 100. No comparar directamente resultados antiguos.
- Stage: afinador y curvas. App: diagnósticos. PreparationPanel: Mejorar mapa desde la voz reutiliza stems y muestra candidato antes de aceptar/guardar. Library: curvas conservadas al editar duración incluso tras valores intermedios inválidos.
- Mapas v3 con curvas; lectura de v1/v2 conservada. Límites: 2000 notas, 40000 puntos totales, 12 MiB JSON.

## Resultado real final

Original: C:\Users\ASUS\Music\Enanitos Verdes - Luz de Día.mp3, 267,818956916 s. Stems intactos en artifacts/audio-luz-de-dia; su manifest conserva el resultado histórico 2C de 129 notas/32,28 s.

Resultado FINAL 2D: 493 notas y 125,86 s. Datos en artifacts/audio-map-v2/luz-final.npz y analysis.json de la misma carpeta. No usar resultados intermedios. Es cobertura propuesta, NO precisión ni canción completa; coros, residuos y octavas aún pueden causar errores. Falta referencia musical humana y canto real.

No se precargó el mapa en la biblioteca personal. El usuario debe pulsar Mejorar mapa desde la voz, revisar/aceptar y guardar en su pestaña habitual. No necesita repetir separación.

## Verificación cerrada

- Node: 39 unitarias aprobadas; build TypeScript/Vite aprobado.
- Navegador: corrida estable conjunta de 33 aprobadas, 0 fallos, 0 omitidas, 0 inestables. artifacts/browser-report.json, inicio 2026-09-16T14:11:50.953Z.
- Python: 3 casos previos y 4 nuevos. Banco sintético final: cobertura coincidente 99,69 %, mediana 4,63 cents, p95 10,12 cents, falso silencio 0,06 s. No extrapolar a canciones.
- API/modelo reales: artifacts/analysis-service-check.json, 4 notas, curvas/hash válidos y sin repetir separación.
- MP3 y salidas reales: artifacts/real-melody-check.json aprobado 2026-09-16T21:00:52.057Z; 493 curvas persistidas, hashes de pistas conservados, instrumental reproducido, cero errores. Este recorrido intercepta API para servir salidas ya calculadas; inferencia validada por separado. Captura etapa-2d-luz-de-dia.png inspeccionada.
- Afinador, escritorio y móvil comprobados. Evaluador independiente cerró doble sigmoid y duración inválida; sin nuevos bloqueantes en revisión acotada.

## Próximo paso

Entregar esta etapa y recibir prueba del usuario con auriculares, micrófono elegido y fragmento concreto. Ajustar según evidencia de notas/tiempos incorrectos; no saltar de fase sin revisar experiencia. Compensación de latencia manual. No reconoce ni alinea cada palabra; LRCLIB aporta líneas, no alturas. LRC 34541541 dura 289 s frente a MP3 de 267,82 s: comprobar edición. Transposición de audio importado, historial y salas pendientes.

Informe completo docs/EVALUACION-02D.md y README actualizado. No quedan pruebas técnicas pendientes de esta entrega; calidad auditiva y canto físico siguen pendientes del usuario.
