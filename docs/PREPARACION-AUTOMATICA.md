# Propuesta de ampliación · preparación automática

Diseño inicial del 14 de septiembre de 2026. Estado al 16: letras completas/LRCLIB, separación, mapa parcial con curvas de afinación y afinador ya implementados. Consultar EVALUACION-02D.md y CONTINUAR.md para el estado vigente. El resto de este documento conserva el diseño y las hipótesis previas a implementar; las afirmaciones de trabajo pendiente son históricas.

## Necesidad expresada por el usuario

MusicBrainz encontró sus canciones, pero introducir cada palabra y nota manualmente resulta tedioso. Quiere obtener letras desde una API, automatizar el mapa y elegir entre cantar con voz original o con instrumental obtenido mediante separación. Aportó https://lrclib.net/tracks/34541541. El servicio devuelve Luz de Día, Los Enanitos Verdes, 289 s y 47 marcas LRC; la captura de su archivo indica 4:27. Mostrar esa discrepancia y verificar versión es parte de la entrega.

## Recorrido propuesto

Audio original → letra completa → separación vocal/instrumental → tiempos de letra y melodía vocal → borrador para revisar → cantar.

Preparar los resultados una sola vez por archivo y configuración. Conservar el original. El editor se convierte en una herramienta para corregir segmentos inciertos, no para introducir toda la canción.

### A. Importar letras completas

Integrado LRCLIB por título/artista o ID/enlace. Texto completo pegado o LRC pegado, almacenamiento independiente, ajuste temporal y exportación que conserva ajustes. Canto libre con letra sin inventar notas ni puntuación. La búsqueda real y el registro aportado respondieron desde el servicio local.

Desacoplar la letra del mapa: actualmente Note contiene word/phrase, Stage dibuja las palabras de las notas y ScoreTracker agrupa por phrase. Una palabra puede durar varias notas y una línea LRC no aporta notas ni tiempos por palabra. Mantener líneas/palabras con tiempos propios, notas con segmentos de afinación y una asociación explícita para resultados por frase. Nunca fabricar notas a partir de las palabras o del BPM.

Evaluación: texto sin tiempos, LRC válido/incorrecto, líneas repetidas, introducción instrumental, versión distinta y ausencia de resultados. La letra debe poder guardarse sin inventar sincronización.

### B. Separar una canción y elegir ayuda vocal

Script local Python basado en audio-separator para producir voz e instrumental. No requiere descargar canciones de Spotify/YouTube. Procesa el archivo que el usuario ya proporciona. La primera ejecución necesita dependencias y pesos del modelo; todavía no se instalaron ni se probó una separación en este equipo.

Salida en carpeta nueva, sin sobrescribir el original. Manifest con hash SHA-256 original y de cada variante, sample rate, número de muestras, duración y cualquier offset/crop/padding aplicado. Mantener el timeline del original; igualdad de duración por sí sola no prueba alineación. Validar hashes y alineación antes de aceptar variantes. El modelo puede dejar restos de voz o alterar instrumentos: audición y evaluación necesarias.

Modos: original con voz; instrumental con voz separada a volumen reducido; instrumental. La selección permanece fija durante la sesión y se incluye en el resultado. Todos usan el mismo mapa. Si se mezclan stems, su normalización debe ser coherente y debe controlarse el clipping. La melodía guía sintetizada es un ajuste distinto de la voz original.

El límite actual de 30 MB no sirve para todos los stems WAV: tres minutos estéreo a 48 kHz y 16 bit rondan 34,6 MB. Definir presupuesto de importación y almacenamiento propio, verificar cuota, guardar el conjunto de forma atómica y decodificar solo las variantes necesarias. No perder el mapa previo ante un fallo.

Evaluación: archivo original intacto, hashes, duration/sample count, offset detectable en señal conocida, importación/persistencia, modo sin variante bloqueado y cambio de modo sin cambiar los objetivos de puntuación. Audición real para valorar calidad de separación.

### C. Generar un mapa vocal revisable

Extraer la frecuencia fundamental del stem vocal, no del acompañamiento completo. Agrupar regiones estables, conservar silencios y confianza, tratar vibrato y posibles errores de octava. El detector YIN existente es un punto de partida experimental; comparar con pYIN o un detector neuronal antes de decidir calidad final.

Si hay LRC, empezar con sincronización por línea. Si solo hay texto, alinear letra y voz mediante un modelo específico y validar en canto en español; un alineador de habla como WhisperX es candidato a evaluar, no garantía de precisión cantada. Distinguir alineación de una letra conocida de reconocimiento de lo que canta el usuario.

No activar puntuación de segmentos sin una referencia razonablemente confiable. Mostrar zonas sin detección o con baja confianza y permitir corregirlas. La letra puede visualizarse aunque esas notas estén pendientes. Revisar límites actuales de 500 notas/100 frases y rendimiento de tabla y escenario con canciones completas.

Evaluación: melodía sintética de notas conocidas, voz aislada con silencios, octavas/vibrato, errores en separación y canción real revisada por el usuario. Medir error de afinación y tiempos por separado; no declarar válido el mapa solo porque el JSON pasa el validador.

## Orden acordable de entregas

Resolver letras completas y sincronización por líneas; después separar una canción y probar los modos; finalmente evaluar la generación del mapa sobre esa misma canción. Cada entrega conserva pruebas y revisión independiente. El pedido cambia la prioridad respecto a la etapa 3 anterior (historial y transposición), que queda pendiente.

## Evidencia de esta revisión

El evaluador independiente señaló el acoplamiento actual letra/nota, la necesidad de comprobar la alineación además de la duración y el tamaño de stems frente al límite de importación. Estos puntos están incorporados arriba. La letra independiente ya se implementó conservando compatibilidad con mapas anteriores; aún no se ha validado un modelo de separación.

El equipo informa NVIDIA GeForce RTX 5050 Laptop GPU con 8151 MiB. Esto permite plantear una prueba local, pero no acredita compatibilidad CUDA de las dependencias ni tiempos de procesamiento. Python predeterminado 3.14.0; torch, audio-separator, librosa y soundfile no estaban instalados. Preparar entorno aislado compatible cuando se implemente el script.

Fuentes primarias consultadas:

- https://github.com/nomadkaraoke/python-audio-separator
- https://lrclib.net/docs
- https://librosa.org/doc/0.11.0/generated/librosa.pyin.html
- https://github.com/m-bain/whisperX
