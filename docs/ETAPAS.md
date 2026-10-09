# Desarrollo por etapas

Cada etapa termina con un resultado ejecutable, pruebas pertinentes, revisión independiente y prueba del usuario. Se corrigen problemas antes de ampliar el alcance. No se interpretan los tests sintéticos como aprobación del dispositivo real.

Estado al 14 de septiembre de 2026: el usuario confirmó que el micrófono «ya está mejor» y autorizó pasar a la siguiente fase. Etapa 1 revisada con él; etapa 2 implementada para su revisión. Etapas 3 a 6 pendientes de autorización tras esa prueba.

Actualización del 15: el usuario aprobó el progreso de biblioteca y pidió automatizar preparación, aportar letras y separar voz. Se entregó la subetapa 2B (LRCLIB, letra independiente y canto libre); la siguiente prioridad es separación y modos vocales, seguida del mapa automático revisable. Ver `PREPARACION-AUTOMATICA.md` y `EVALUACION-02B.md`. La personalización anterior no se inicia antes de resolver esta nueva prioridad y revisar cada resultado con él.

| Etapa | Entrega | Evaluador / condición de aceptación |
| --- | --- | --- |
| 1. Primer escenario | Ejercicio original, micrófono, letras, notas, puntaje, resultados y demo distinguible | Tests de frecuencia y puntuación; prueba completa de navegador; revisión de lifecycle; usuario confirma voz y sincronización con auriculares |
| 2. Biblioteca propia | Importar audio y un mapa validado; editor/ajuste de tiempos; buscar y asociar metadatos MusicBrainz | Archivos válidos e inválidos, coincidencia exacta de versión/duración, reglas de API, errores y permisos de fuentes documentados |
| 3. Personalización | Repetir frases, rango cómodo, transponer pista y mapa, historial local | Audio y objetivos se transponen juntos; guardado/lectura consistentes; calibración real en varios dispositivos |
| 4. Búsqueda por mood | Embeddings multilingües y filtros explícitos sobre catálogo propio | Conjunto de consultas de referencia, evaluación de relevancia por usuario, filtros de fecha/idioma y resultados vacíos correctos |
| 5. Salas y duelos | Turnos, cola compartida, reacciones y puntuaciones | Pruebas con varios clientes, reloj compartido, reconexión, autorización de acciones y comparabilidad de mapas/puntajes |
| 6. Palabras cantadas | Evaluación experimental por frase y confianza visible | Contrastar palabras correctas, omitidas e incorrectas con varios acentos; errores e incertidumbre documentados, sin confundir alineación con reconocimiento |

## Orden y decisiones

Empezar con web React + TypeScript valida el motor en la computadora. El núcleo musical y el formato del mapa se mantienen independientes de la interfaz para futura adaptación móvil. Una app React Native deberá validar su propia captura y latencia; no se presupone reutilización íntegra del motor Web Audio.

No introducir microservicios hasta tener una necesidad medida. La biblioteca usa almacenamiento local y un servicio modular de metadatos en Vite; la preparación de notas es manual. El análisis costoso de pistas, si se incorpora, se hará antes de cantar; el análisis de la voz del jugador seguirá local cuando sea posible.

Los rankings públicos y duetos remotos simultáneos requieren evaluaciones propias. Los duelos por turnos son la primera experiencia social prevista. Las puntuaciones locales actuales no sirven como sistema resistente a trampas.

## Revisión humana de cada entrega

1. ¿La función principal se entiende y se puede completar sin instrucciones técnicas?
2. ¿La respuesta audiovisual se siente coherente con lo que ocurre?
3. ¿Las limitaciones y errores se explican con claridad?
4. ¿La interfaz responde bien en las pantallas acordadas?
5. ¿Qué observación del usuario cambia el siguiente paso?
