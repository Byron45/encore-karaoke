# Evaluación de la etapa 1

Fecha: 14 de septiembre de 2026.

**Estado actualizado: el usuario confirmó que el micrófono «ya está mejor» y autorizó avanzar a la etapa 2.** El detalle siguiente conserva la evaluación inicial; la revisión posterior se documenta al final.

## Evidencia automática

| Comprobación | Resultado |
| --- | --- |
| TypeScript y compilación de producción | Aprobado (`npm run build`) |
| Suite del motor (`npm test`) | 10 pruebas aprobadas, 0 fallos |
| Suite de navegador (`npm run test:browser`) | 7 pruebas aprobadas, 0 fallos, 58,2 s |
| Vista de escritorio | Inspeccionada a 1440 × 1000; sin error de página en la demo completa |
| Vista móvil | Inspeccionada a 390 × 844; sin desbordamiento horizontal en escenario y etapas |
| Dependencias instaladas | npm informó 0 vulnerabilidades en la instalación |

### Motor

1. Tonos conocidos a 16, 44,1 y 48 kHz con error inferior a 15 cents en los casos probados.
2. Conservación de la fundamental con armónicos tras la reducción de muestras.
3. Procesador real ejecutado por bloques de 128 muestras a 44,1/48/96 kHz, incluido un tono de 65,41 Hz.
4. Silencio, señal constante, nivel bajo y ruido aleatorio reproducible sin frecuencia confiable.
5. Tiempo de cálculo sintético medio por debajo del límite de prueba de 20 ms. Este umbral no mide la latencia total del micrófono.
6. Distinción entre nota correcta, desafinación, octava y baja confianza.
7. Interpretación correcta cercana al máximo; silencio y octava incorrecta con cero puntos.
8. Puntuación basada en duración y aproximadamente independiente de la frecuencia de muestreo de eventos.
9. Sin crédito en descansos, cuenta atrás, fuera de la canción o por duplicar muestras.
10. Sin sumar intervalos perdidos y sin racha por una muestra aislada.

### Navegador (Microsoft Edge / Chromium, automatizado)

1. Demo completa, sin solicitar micrófono, resultado marcado como simulado y descarga JSON verificable.
2. Detención y reinicio con puntuación reiniciada y nueva cuenta atrás.
3. Rechazo del permiso con instrucciones de recuperación.
4. Cancelación mientras el permiso está pendiente; un stream que llega tarde termina sus pistas.
5. Flujo sintético de 440 Hz procesado por el AudioWorklet real, feedback La4, cero puntos por nota incorrecta y liberación al detener.
6. Controles y seis etapas navegables en móvil, sin desbordamiento horizontal.
7. Compensación de 300 ms: las indicaciones de afinación se comparan con la nota capturada mientras la letra sigue el reloj de reproducción.

Estas pruebas sustituyen `getUserMedia` por casos controlados cuando hace falta. No acceden al micrófono físico del usuario.

## Revisión independiente

Se asignó una revisión de solo lectura al evaluador `evaluador_etapa_1`. Detectó dos problemas:

- El feedback utilizaba la nota actual de reproducción mientras la puntuación utilizaba la muestra compensada. **Corregido:** tiempo capturado independiente, feedback y posición de voz alineados a la misma muestra.
- La ventana fija de 2048 muestras era demasiado corta para graves en dispositivos de 96 kHz. **Corregido:** ventana mínima de 43 ms y salto aproximado de 21 ms, ajustados a la frecuencia del contexto.

El evaluador revisó las correcciones, volvió a ejecutar las 10 pruebas del motor y confirmó ambos hallazgos resueltos, sin nuevos hallazgos dentro del alcance revisado.

Durante QA móvil, el selector del test incluía un contador oculto en esa pantalla. Se fijó un nombre accesible estable para la navegación y se repitió la suite completa. También se adaptó la anchura del mapa de notas al contenedor para conservar su legibilidad.

## Prueba pendiente con el usuario

Usar auriculares con cable y comenzar con compensación de 0 ms.

| Acción | Resultado esperado | Estado |
| --- | --- | --- |
| Abrir Ver demo | Música, notas, palabras y resultado simulado comprensibles | Pendiente de opinión del usuario |
| Empezar a cantar y permitir micrófono | Nivel visible que responde a la voz | Pendiente |
| Guardar silencio durante notas | No se suman puntos | Pendiente |
| Sostener una nota y luego subirla/bajarla | La altura del punto cambia y el feedback resulta coherente | Pendiente |
| Detener | Se corta el acompañamiento y se libera el indicador del micrófono del navegador | Pendiente |
| Cantar el ejercicio completo | Letras y barras se sienten sincronizadas; se muestran resultados por frase | Pendiente |

No se declara evaluada la pronunciación, resistencia a trampas, calidad artística, latencia universal ni compatibilidad física con todos los dispositivos. La validación móvil fue de diseño en un navegador automatizado, no una prueba de audio en un teléfono real.

## Siguiente entrega

Tras revisar esta experiencia con el usuario, iniciar la etapa 2: importación de audio, formato y edición del mapa musical, y asociación de metadatos MusicBrainz respetando identificación, límites y condiciones del servicio.

## Cierre posterior de la revisión de micrófono

Se incorporaron selección exacta del dispositivo, monitor de nivel/nota sin puntuación, preferencia persistente, registros por octava y diagnóstico separado de silencio, falta de análisis y diferencias de tono. El evaluador confirmó la corrección de recomendaciones relativas al registro elegido.

Las 14 pruebas unitarias de motor/diagnóstico y las 13 pruebas de navegador de escenario/micrófono pasaron dentro de la evaluación final de etapa 2 (20 unitarias y 19 de navegador en total). Esto incluye canto sintético completo por la captura real con resultados positivos en cada frase. La prueba temporal de compensación ahora observa cada actualización para evitar perder una transición breve.

La confirmación del usuario permite continuar; no demuestra qué causó exactamente el cero inicial ni valida todos sus dispositivos. La etapa 2 se recoge en `EVALUACION-02.md`.
