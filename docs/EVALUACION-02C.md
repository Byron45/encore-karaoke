# Evaluación 2C · separación y borrador de notas

15 de septiembre de 2026. Implementación y revisión técnica terminadas. Pendiente de audición y canto del usuario para valorar calidad perceptiva; el mapa automático no se considera referencia completa ni validada musicalmente.

## Implementación

- Audio Separator 0.47.0, modelo UVR-MDX-NET-Inst_HQ_3.onnx, Python 3.11 aislado, CPU, librosa 0.11.0/pYIN. Dependencias fijadas, FFmpeg local. No se instaló CUDA ni se alteró Python global.
- Voz, instrumental y mezcla instrumental + voz al 25 %, ganancia compartida, PCM16 estéreo 44.1 kHz. Original intacto. Manifiesto con hashes, muestras, duración, ajustes de cola y correlación/desfase en tres zonas.
- Preparación desde biblioteca, progreso/cancelación, validación, vista previa, descarga y aceptación explícita; reemplazo de mapa previa confirmación. Guardado atómico en IndexedDB, protección de borrador, falta de espacio y errores.
- Notas estables de voz aislada, confianza y silencios; agrupación por líneas LRC sin asignar palabras ficticias. Máximo 2.000 notas; tabla paginada. Mapa v2 automático y compatibilidad v1.
- Acompañamiento fijo por sesión y exportado con resultado; variantes mantienen mapa/reloj. Original, voz al 25 % e instrumental. Aviso de evaluación parcial experimental.

## Evidencia

| Comprobación | Resultado |
| --- | --- |
| npm test | 33 aprobadas |
| Python tests/audio_analysis_test.py | 3 aprobadas: cuatro tonos/tiempos, vibrato/silencios/incertidumbre, desplazamiento de 100 ms |
| npm run build | TypeScript y Vite aprobados |
| Navegador Edge | 29 casos comprobados: 28 pasaron en ejecución conjunta; uno se interrumpió por una recarga de Vite al editar y pasó aislado con código estable. No fue un fallo corregido ocultando la aserción. |
| Cinco casos nuevos de preparación | Aprobados: borrador/navegación/guardado, recarga de pistas, micrófono sintético y tres acompañamientos, cancelar, WAV corrupto, solo pistas conserva mapa, motor ausente y móvil |
| API real + modelo | Aprobada: restricciones origen/token, 409 concurrente, cancelación, trabajo completo y validación de tres stems de un audio sintético de 8 s |
| Revisión visual | Capturas escritorio/móvil y canción real inspeccionadas; sin desbordamiento de página |
| Evaluador independiente | Cuatro hallazgos corregidos y cierre sin nuevos bloqueantes en revisión acotada |

Los casos de canto en navegador usan micrófono sintético y verifican puntuación >7.000 con las tres variantes, además de frecuencia del audio efectivamente reproducido. No usan ni califican el micrófono físico del usuario. La prueba de dos pistas diferentes no mide calidad de separación del modelo.

Informes: `artifacts/browser-report.json` (ejecución conjunta), `artifacts/browser-lyrics-recheck.json` (repetición aprobada), `artifacts/audio-service-check.json`, `artifacts/real-preparation-check.json`. Capturas: `etapa-2c-preparacion.png`, `etapa-2c-mobile.png`, `etapa-2c-luz-de-dia.png`.

## Archivo real del usuario

Entrada: `C:\Users\ASUS\Music\Enanitos Verdes - Luz de Día.mp3`.
Salida conservada: `artifacts/audio-luz-de-dia` (tres WAV y manifiesto).

- Duración: 267,818956916 s. Tiempo de procesamiento: 205,09 s por CPU.
- Tres pistas de 47.243.308 bytes cada una, con la misma cantidad de muestras.
- Comprobaciones al 5 %, 50 % y 90 %: desfase 0 s; correlaciones 0,9976 / 0,9947 / 0,9958.
- 129 notas propuestas; 32,28 segundos de notas estables (12,05 % del tiempo total, que también incluye instrumentales). No hay medida de cobertura de la voz real sin referencia humana anotada.
- El navegador decodificó el MP3, validó las tres pistas y el mapa, guardó/reabrió el conjunto en IndexedDB y comenzó reproducción instrumental. Para reutilizar la salida CLI ya calculada, esta comprobación interceptó respuestas de la API con archivos reales; la prueba API separada sí ejecutó el modelo real. Ambas usaron perfiles temporales, sin tocar la biblioteca del usuario.
- No se escuchó ni juzgó perceptivamente la separación. La igualdad de duración/correlación confirma alineación técnica, no ausencia de voz residual ni exactitud de las 129 notas.

## Hallazgos del evaluador resueltos

1. Candidato recién generado protegido al navegar, cerrar, guardar o cantar. Hay que aceptarlo o descartarlo.
2. Cancelación en Windows termina también FFmpeg/procesos hijos del trabajador. Prueba con hijo y nieto real aprobada fuera del sandbox restrictivo.
3. Exportación/importación de mapas largos usa el mismo presupuesto UTF-8 de 12 MB; máximo 2.000 notas con etiquetas largas probado.
4. Guardar y cantar ya no evita la protección de candidato: botones bloqueados y guardia adicional en persist().

## Límites y próxima validación

La app automatiza separación y un primer mapa parcial; aún no hace alineación de palabras, reconocimiento de letra cantada ni extracción fiable de toda la melodía. Coros, octavas y sonidos filtrados pueden dar errores. Un LRC de otra edición sigue necesitando revisión. Probar primero la audición instrumental/voz aislada, la letra elegida y el canto con micrófono seleccionado; mejorar cobertura/segmentación sobre una frase anotada antes de añadir rankings u otras fases.

El servicio es local de escritorio. Los modelos y el entorno ocupan disco; cada preparación añade WAV a IndexedDB tras aceptarla/guardarla. Reiniciar el servidor cancela trabajos conocidos; un cierre abrupto puede dejar temporales en `.local/audio/jobs`. No hay migración ni subida de la biblioteca a la nube.
