# Evaluación 2D · mapa vocal y afinador

Fecha: 16 de septiembre de 2026. Entrega técnica comprobada; pendiente la valoración del usuario cantando con su micrófono y una referencia musical anotada para medir precisión en canciones reales.

## Cambios

- CREPE-full local contrasta la voz aislada con pYIN. Ventanas de 20 segundos con contexto, pasos de 20 ms, filtros de energía/confianza y rechazo de discrepancias claras. Recupera caídas breves de confianza cuando mantienen tono y energía, sin rellenar silencios.
- Curvas de afinación para representar vibrato y deslizamientos. Mapas JSON v3, manteniendo lectura de v1/v2. La confianza del modelo es una heurística, no una probabilidad de que la nota musical sea correcta.
- **Mejorar mapa desde la voz** reutiliza el stem vocal verificado, muestra candidato antes de reemplazar, permite cancelar y conserva pistas. Persistencia de curvas y guardado transaccional.
- Afinador con referencia, frecuencia captada y diferencia en cents. Comparte referencia y filtros de fiabilidad con el evaluador. Sin referencia o tono fiable, permanece neutral.
- Puntuación `encore-intonation-2`: crédito completo hasta 35 cents; cero desde 100 cents. Integra referencia continua y excluye hasta 20 ms por extremo de notas automáticas, manteniendo al menos 80 ms evaluables. Distingue afinación mientras se canta, cobertura, error absoluto y tendencia. Compensación de latencia manual.

## Evidencia

| Comprobación | Resultado |
| --- | --- |
| Unitarias Node | 39 aprobadas |
| TypeScript + Vite | Compilación aprobada |
| Navegador, corrida conjunta estable | 33 aprobadas, 0 fallidas, 0 omitidas, 0 inestables |
| Python | 3 casos previos y 4 nuevos aprobados |
| API de reanálisis con modelo real | 4 notas, curvas válidas, hash verificado; solo produce analysis.json |
| Flujo con MP3 real y salidas calculadas | Aceptación, persistencia, curvas y reproducción instrumental aprobados; sin errores de página |

Informe conjunto: `artifacts/browser-report.json`. Incluye cancelación, hash incorrecto, conservación del mapa previo, exportación v3, edición de duración con valores intermedios inválidos, micrófono sintético, desfase y móvil. No captura el micrófono físico ni modifica la biblioteca de Opera del usuario.

Banco sintético del analizador con tonos armónicos, volumen variable y vibrato conocidos: cobertura coincidente 99,69 %, error mediano 4,63 cents, percentil 95 de 10,12 cents y 0,06 s de falsas notas en silencios. Informe `artifacts/melody-synthetic-evaluation.json`. Estas cifras no representan precisión general sobre canciones.

La puntuación se comprueba pasando PCM por el procesador real a 44,1/48/96 kHz: notas de 120/250/1000 ms, silencio, semitono incorrecto y retraso de 80 ms. También vibrato y deslizamientos a 44,1/48 kHz. Afinador y puntuación consultan la misma curva.

## Luz de día

Original: `C:\Users\ASUS\Music\Enanitos Verdes - Luz de Día.mp3`, 267,818956916 s. SHA-256: `0a73e68149b4e3e771419856a42b6e4edaf54dd8ba2a53fc0cac8cb7b6cea7d8`.

| Mapa | Notas propuestas | Duración con notas |
| --- | ---: | ---: |
| Etapa 2C | 129 | 32,28 s |
| Etapa 2D final | 493 | 125,86 s |

El nuevo mapa cubre aproximadamente 47 % del audio total. Ese denominador incluye introducción, pausas e instrumental; no equivale al porcentaje del canto detectado correctamente. No hay anotación humana de esta canción para medir precisión/recobrado ni valorar octavas, coros o instrumentos residuales. Sigue siendo una referencia parcial experimental.

Se reutilizaron los WAV de `artifacts/audio-luz-de-dia`, sin repetir separación. Datos finales: `artifacts/audio-map-v2/luz-final.npz` y `artifacts/audio-map-v2/analysis.json`. Otros resultados intermedios no son la entrega final.

`tests/real-preparation-check.mjs` sirve los archivos reales ya calculados mediante respuestas API interceptadas en un navegador temporal. Verificó incorporación del mapa antiguo, mejora, persistencia de las 493 curvas, hashes de las tres pistas sin cambios y reproducción instrumental. No hizo otra inferencia dentro de ese recorrido ni evaluó calidad auditiva. Inferencia y endpoint se verificaron por separado en `tests/analysis-service-check.mjs`. Informe final: `artifacts/real-melody-check.json`; captura inspeccionada: `artifacts/etapa-2d-luz-de-dia.png`.

## Revisión independiente

El evaluador revisó decodificación, transiciones, puntuación, serialización y edición. Se corrigieron dos hallazgos: aplicar sigmoid de nuevo a activaciones ya normalizadas, y escalar curvas desde una duración intermedia inválida. Ambos tienen regresiones. No encontró nuevos bloqueantes en la revisión final acotada. Se descartó un desplazamiento global del reloj que empeoraba los casos evaluados; se mantuvo el reloj con márgenes de transición acotados.

## Prueba siguiente con el usuario

1. Recargar su pestaña habitual en `localhost:5173`, conservando navegador y origen.
2. Biblioteca → canción ya separada → **Mejorar mapa desde la voz**. Puede tardar varios minutos por CPU.
3. Escuchar voz aislada, revisar y aceptar candidato; guardar.
4. Con auriculares, seleccionar/probar micrófono y cantar un fragmento reconocible. Observar curva, diferencia grave/aguda y compensación de retraso.
5. Contrastar notas concretas incorrectas antes de ajustar más umbrales o avanzar de fase.

No se implementó reconocimiento ni alineación por palabra. LRCLIB mantiene sincronización por líneas; revisar su edición de 289 s contra este audio de 267,82 s. No hay transposición de archivos importados, calibración automática ni validación de instrumentos polifónicos.

## Reproducción

```powershell
npm test
npm run build
.venv-audio/Scripts/python.exe tests/audio_analysis_test.py
.venv-audio/Scripts/python.exe tests/melody_analysis_test.py
# Con npm run dev activo:
npm run test:browser
node tests/analysis-service-check.mjs
node tests/real-preparation-check.mjs 'C:\Users\ASUS\Music\Enanitos Verdes - Luz de Día.mp3' artifacts/audio-luz-de-dia artifacts/audio-map-v2/analysis.json
```

Fuentes técnicas: [torchcrepe](https://github.com/maxrmorrison/torchcrepe), [pYIN de librosa 0.11](https://librosa.org/doc/0.11.0/generated/librosa.pyin.html). Dependencias fijadas en `scripts/audio/requirements-lock.txt`; CPU, sin CUDA.
