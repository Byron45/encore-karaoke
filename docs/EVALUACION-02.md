# Evaluación de la etapa 2 · biblioteca propia

Fecha: 14 de septiembre de 2026. Estado: **validación técnica aprobada; pendiente de revisión del usuario con su audio**.

## Evidencia

| Comprobación | Resultado |
| --- | --- |
| TypeScript y producción (`npm run build`) | Aprobado |
| Motor, diagnóstico, mapas y servicio (`npm test`) | 20 aprobadas, 0 fallos |
| Recorrido de navegador Edge (`npm run test:browser`) | 19 aprobadas, 0 fallos; 2,1 minutos |
| Consulta externa real | Imagine / John Lennon, API local devuelve grabaciones de MusicBrainz |
| Desktop y móvil | Capturas inspeccionadas a 1440 y 390 px; sin desbordamiento de página. Tabla desplazable dentro del editor |
| Revisión independiente | Tres hallazgos corregidos y confirmados resueltos |

Las 19 pruebas incluyen las 13 de escenario/micrófono y seis de biblioteca. La entrada de voz se simula en el navegador; el AudioWorklet y la puntuación son reales. No se activó el micrófono físico del usuario para estas pruebas.

## Recorrido comprobado

- Importación de WAV válido, rechazo de archivo ilegible, validación de tiempos/rango/frases y mapa de otro archivo rechazado por hash.
- Guardado en IndexedDB y recuperación tras recargar; ejemplo de 24 notas; detección de duplicados y eliminación confirmada.
- Edición, marcado del inicio con el reproductor, desfase, eliminación de nota y exportación.
- Audio importado de cuatro segundos con dos frases llevado al escenario y cantado mediante flujo sintético Do4: resultado superior a 7.000 y dos resultados de frase.
- Asociación MusicBrainz con duración diferente: requiere confirmar; la asociación persiste tras recarga. Esta prueba usa respuesta controlada; la conectividad externa se verificó aparte.
- Cola, separación de peticiones, deduplicación, caché, escape de consultas y recuperación ante error del catálogo probados con transporte controlado.
- Borrador pendiente protegido al seleccionar la misma ficha; descarte explícito al reimportar.
- Guardado demorado artificialmente: edición, asociación, selección y navegación bloqueadas hasta confirmar la transacción.

## Evaluador y correcciones

El evaluador independiente `evaluador_etapa_1` revisó la implementación en solo lectura y detectó tres P2:

1. Reseleccionar la ficha actual podía borrar la marca de cambios sin guardar. Se conserva el borrador y la advertencia; reimportar un duplicado tras confirmar descarte reinicia el editor desde el registro guardado.
2. Era posible editar o salir mientras se guardaba. El editor y la biblioteca bloquean esas acciones hasta concluir la persistencia, incluida MusicBrainz.
3. El diagnóstico podía recomendar Grave/Agudo para una pista externa, donde esos ajustes están deshabilitados. Ahora indica revisar las notas en la biblioteca y mantiene el archivo original.

Los tres cambios tienen regresiones automatizadas. El evaluador confirmó los tres resueltos, sin nuevos hallazgos dentro del alcance revisado.

La suite previa contenía una prueba temporal intermitente: el polling perdía la ventana corta en la que la letra avanza mientras el feedback aún evalúa la muestra compensada. Se sustituyó por observación de las actualizaciones del escenario, comprobando reloj de reproducción, reloj de captura, palabra y feedback en la misma actualización. Pasó aislada y dentro de las 19 pruebas.

## Revisión pendiente del usuario

1. Biblioteca → Añadir ejemplo editable → Guardar y cantar. Revisar audio, letra, micrófono seleccionado y resultado.
2. Cargar un audio propio, preparar unas notas, guardar, recargar y volver a cantar. Revisar si el marcado de tiempos y la guía resultan comprensibles.
3. Buscar una versión en MusicBrainz y comprobar título, artista, edición y duración antes de asociar.

La preparación de letras y notas es manual. El hash demuestra que el mapa corresponde al mismo archivo, no que su contenido musical sea correcto. MusicBrainz aporta metadatos; no entrega letra sincronizada, notas ni audio. La transposición de archivos, extracción vocal y reconocimiento de palabras quedan fuera de esta entrega. No se declara validada la latencia de todos los dispositivos ni la calidad musical de mapas preparados por el usuario.
