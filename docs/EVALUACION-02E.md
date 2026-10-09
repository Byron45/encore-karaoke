# Evaluación 2E · retroalimentación a partir de una prueba real

Fecha: 16 de septiembre de 2026. El usuario aportó `encore-microphone-resultado (2).json` y captura de «Marta tiene un marcapasos». Confirmó que cantó toda la canción, cuyo final tiene unos 30 segundos de vocalizaciones, usando el micrófono de la laptop sin auriculares. No se recibió audio de su interpretación ni el mapa de esa canción.

## Auditoría del resultado recibido

| Medida | Valor e interpretación |
| --- | --- |
| Puntos | 1.019 / 10.000, no cero |
| Referencia evaluable | 53,44 s, después de excluir 9,76 s de bordes automáticos |
| Tono evaluable | 21,63 s; 40,48 % antes de redondear |
| Afinación durante tono evaluable | 25 % de crédito ponderado, no porcentaje de palabras o notas correctas |
| Señal suficiente | 44 % del tiempo de referencia; no identifica quién produjo el sonido |
| Análisis recibido | 100 % redondeado; indica muestras procesadas, no voz identificada |
| Desviación absoluta media | 175 cents frente al mapa |
| Promedio firmado | +11 cents; graves y agudos pueden compensarse |
| Final del informe | Nueve frases en cero; los agregados antiguos no explican su causa |

La aritmética es coherente: 21,63 / 53,44 = 40,48 %. A partir de los puntos redondeados se infieren aproximadamente 5,4455 segundos de crédito, equivalentes al 25,18 % del tiempo con tono. Las pequeñas diferencias al multiplicar porcentajes visibles se deben a redondeo.

No hay evidencia de fallo en la fórmula a partir de este JSON. Tampoco permite certificar afinación real, exactitud del mapa, desfase, interferencia musical ni el motivo de los ceros. La música de altavoces puede mezclarse con la voz en el micrófono; debe repetirse con auriculares para reducir esa fuente de ambigüedad. Vocalizaciones sin palabras pueden tener notas evaluables.

## Correcciones implementadas

1. El diagnóstico anterior usaba el porcentaje combinado para afirmar poca coincidencia de tono y hablaba de «El cero» aunque hubiera puntos. Ahora distingue cobertura parcial de afinación y utiliza `intonation` para hablar de coincidencia. Un caso de afinación 100 % y cobertura 12 % ya no se presenta como mala afinación.
2. Cada frase conserva inicio/fin, segundos de referencia, tiempo transcurrido evaluable, muestras analizadas, señal suficiente y tono fiable, además de cobertura, afinación y desviaciones absoluta/firmada. La interfaz distingue falta de muestras, señal baja, poco tono fiable y resultado combinado bajo; los valores detallados permiten analizar causas mixtas.
3. Se aclara que el promedio firmado cercano a cero no demuestra buena afinación, y que el análisis recibido no equivale a detectar la voz del usuario. «Tiempo cantado» pasa a «Tiempo con tono evaluable».
4. Resultado JSON v3 con `phraseDiagnostics`, metadatos del mapa reproducido y el mismo texto de retroalimentación mostrado. Conserva campos anteriores. No graba audio ni crea historial de grabaciones. Los archivos v2 ya descargados no contienen los nuevos detalles y no pueden reconstruirse retrospectivamente.

La fórmula de puntuación, los umbrales del micrófono y el motor de generación del mapa permanecen en sus versiones anteriores; esta entrega corrige interpretación y observabilidad.

## Evaluador y pruebas

El evaluador independiente reprodujo el caso afinación 100 % / cobertura 12 % y confirmó la coherencia aritmética del informe. En la revisión final detectó una segunda ambigüedad: una frase con afinación 4 % y cobertura 10 % redondea su puntuación combinada a cero. Se corrigió su texto para identificar expresamente el porcentaje combinado y mostrar ambas métricas, con regresión.

- Suite Node: 43 aprobadas. Tras el último ajuste de redacción, las 4 regresiones de diagnóstico se repitieron y pasaron.
- Compilación TypeScript/Vite final aprobada.
- Cinco casos de navegador seleccionados aprobados: demo/exportación, micrófono sintético completo/exportación, letra alternativa, canto libre LRC y resultado parcial en escritorio/móvil. No se repitió toda la suite de 33 casos de la etapa anterior.
- El nuevo caso visual falló inicialmente porque su simulación modificaba otra instancia del módulo Vite por la URL de HMR. Se corrigió el test para usar la URL cargada por la aplicación; después pasó. No fue un defecto de captura del producto.
- Capturas inspeccionadas: `artifacts/etapa-2e-diagnostico.png`, `artifacts/etapa-2e-cobertura-parcial.png` y `artifacts/etapa-2e-cobertura-movil.png`. La captura parcial usa un caso controlado; no representa una repetición del canto del usuario.

## Siguiente comparación

Recargar la misma pestaña habitual; misma canción, mapa y micrófono de laptop, pero escuchar por auriculares. Probar primero la entrada y cantar la canción. Descargar el nuevo JSON v3. No cambiar automáticamente compensación ni sensibilidad a partir de los promedios actuales. Si persisten anomalías, revisar los tiempos y métricas de frases concretas y contrastar esas notas con la voz aislada antes de avanzar a transposición, historial o salas.
