# Evaluación 2B · letras completas y canto libre

15 de septiembre de 2026. Entrega técnica aprobada; pendiente de prueba del usuario en su canción.

## Alcance entregado

- LRCLIB por título/artista o enlace/ID, vista previa, duración comparada y elección explícita entre letra sincronizada y solo texto.
- Texto completo y LRC independientes del mapa, guardados en IndexedDB; editar letra no crea ni altera notas.
- LRC por líneas, marcas repetidas, metadatos, fracciones, offset, interludios y validación de tiempos. Ajuste de letra independiente de la compensación de micrófono.
- Exportación LRC con tiempos efectivos. Texto plano desplazable manualmente.
- Canto libre con audio original y letra, sin requerir mapa. Escuchar sin micrófono o cantar con la entrada seleccionada. Interfaz sin puntos y exportación `scored:false, score:null`.

## Evidencia

| Comprobación | Resultado |
| --- | --- |
| Compilación y TypeScript | Aprobados |
| Pruebas unitarias (`npm test`) | 27 aprobadas, 0 fallos |
| Pruebas Edge (`npm run test:browser`) | 24 aprobadas, 0 fallos; 2,6 minutos |
| Registro real 34541541 | Luz de Día / Los Enanitos Verdes, 289 s, texto y 47 marcas LRC |
| Búsqueda real por título/artista | Respuesta con varias versiones, incluidas de 268 y 269 s; no se confirma equivalencia solo por duración |
| UI del enlace real | Comprobada con agent-browser; muestra registro 4:49 y aviso de duración distinta |
| Desktop/móvil | Capturas inspeccionadas; controles disponibles y sin desbordamiento de página |

La captura del usuario muestra un archivo de aproximadamente 267 s. La diferencia con el registro enlazado se comunicó; no se aplicaron esos tiempos ni se modificó su biblioteca desde el navegador de pruebas.

## Cinco recorridos nuevos de navegador

1. Consultar enlace, revisar, importar LRC, guardar/recargar, escuchar la canción sin solicitar micrófono, observar ambas líneas y descargar resultado sin puntuación ficticia.
2. Duración diferente y LRC fuera del archivo: no se aplica automáticamente; error claro y alternativa de importar solo texto.
3. API caída: la entrada manual funciona; LRC inválido no se guarda; ajuste/exportación conserva tiempo efectivo y vista móvil cabe en pantalla.
4. Edición de letra completa preserva las 24 notas del ejemplo, advertencia de cambios pendientes y puntuación del mapa existente.
5. Canto con micrófono sintético y mapa vacío: termina sin diagnóstico de cero o falta de análisis, y libera la pista de entrada.

Las pruebas usan audios y frases originales de prueba, respuestas de API controladas y micrófono sintético. La consulta de LRCLIB real se hizo aparte. No son una evaluación acústica de la voz física del usuario.

## Revisión independiente y correcciones

El evaluador `evaluador_etapa_1` detectó dos P2 y un P3: la descarga perdía el ajuste temporal; adelantar letras fusionaba varias líneas anteriores al comienzo; un ajuste inválido quedaba oculto al cambiar a texto plano. Se corrigieron exportando tiempos efectivos, conservando solo la última línea activa en cero y normalizando/ignorando offsets de texto plano. Se añadió regresión de ida/vuelta LRC y comprobación de descarga desde la interfaz. El evaluador confirmó las correcciones sin nuevos hallazgos en su revisión acotada.

La primera ejecución de las nuevas pruebas mostró que el selector de etiqueta de textarea dejaba de localizarla tras introducir contenido; se añadió un nombre accesible explícito y estable. Las cinco pruebas nuevas y las 19 anteriores pasaron en la ejecución final.

## Pendiente

El usuario debe revisar letra y sincronización en su archivo, preferiblemente buscando una edición cercana a su duración. La separación vocal/instrumental, modo intermedio con voz reducida y mapa automático siguen como próximas entregas revisables. LRCLIB entrega texto y tiempos por línea, no notas. No se ha instalado ni ejecutado aún un modelo de separación; no afirmar calidad de separación ni generación de mapa ya comprobadas.
