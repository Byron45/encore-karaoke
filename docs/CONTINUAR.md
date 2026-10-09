# Punto de continuación · etapa 2E terminada

## Última revisión: prueba real del usuario y corrección de retroalimentación

16 de septiembre de 2026: el usuario compartió resultado v2 de Marta tiene un marcapasos (1019 puntos, referencia53,44 s, tono21,63 s, afinación25 %, cobertura40 %, señal44 %, análisis100 %, error175 cents, media firmada+11). Confirmó canto completo con micrófono de laptop SIN auriculares, final de unos30 s con vocalizaciones. Las cifras son coherentes; no permiten atribuir los ceros finales a silencio ni certificar afinación musical. Se explicó posible mezcla de altavoces y voz, sin afirmar causa demostrada.

Entrega2E: src/scoring.ts separa feedback de cobertura/afinación y añade phraseDiagnostics con tiempos, señal, tono y errores por frase. src/result.ts exporta JSONv3 con feedback mostrado y metadatos del mapa; no audio. App muestra detalle y aclara media firmada. Puntuación y detector sin cambios. El evaluador independiente confirmó defecto del mensaje anterior y revisó la corrección; se cerró también una ambigüedad en frases de puntuación redondeada0.

Verificado:43 unitarias,4 regresiones repetidas después del último ajuste, build final aprobado y5 casos E2E seleccionados aprobados. Un fallo inicial del nuevo E2E provenía del mock del módulo con timestampVite; corregido el test y aprobado. Capturas2E de escritorio/móvil inspeccionadas. No se repitió toda la suite de la etapa2D. Navegador encore-results cerrado. Puerto5173 ya estaba activo; no se inició otro servidor.

Siguiente paso: repetir misma canción/mapa/micrófono escuchando POR AURICULARES y descargar JSONv3. Esto ayuda a aislar interferencias antes de ajustar sensibilidad o mapa. No es necesario reprocesar el audio para esta mejora. Los informes v2 no permiten reconstruir diagnóstico por frase retrospectivamente. Informe completo docs/EVALUACION-02E.md. Se conserva debajo el contexto técnico2D.

Actualizado: 16 de septiembre de 2026, tras reanudar por cuota. Conservar proyecto, biblioteca e instalaciones. El usuario quiere entregas por etapas con evaluador independiente y continuar donde quedó tras interrupciones. Ignoró expresamente su pregunta sobre migrar cuentas.

## Estado operativo

Proyecto: C:\Users\ASUS\Documents\Empleo\Proyectos Personales\Karaoke. React/TypeScript/Vite. No es repositorio git. El usuario usa localhost:5173 en Opera; no cambiar origen o navegador porque IndexedDB es independiente. Las pruebas usan perfiles temporales en 127.0.0.1 y no tocaron su biblioteca.

Vite reiniciado, última sesión de herramienta 13415, puerto 5173. Comprobar listener antes de levantar otro. Las sesiones pueden desaparecer tras interrupción por cuota. Navegador de prueba encore-tuner cerrado.

.venv-audio: Python 3.11, audio-separator 0.47.0, librosa 0.11.0, torchcrepe 0.0.24; requirements-lock.txt fija dependencias. npm run audio:setup reproduce mediante uv. CPU, sin CUDA; Python global intacto. UVR-MDX-NET-Inst_HQ_3.onnx en .local/audio/models, pesos CREPE incluidos en paquete. Conservar modelos/cachés. Un cierre abrupto puede dejar temporales en .local/audio/jobs.

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
