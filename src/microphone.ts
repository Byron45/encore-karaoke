export interface InputReading { time: number; span: number; frequency: number | null; rms: number; confidence: number }
export interface ActiveMicrophone { deviceId: string; label: string }

export function microphoneError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  return name === 'NotAllowedError' ? 'No pudimos acceder al micrófono. Habilita el permiso del navegador o prueba la demostración.'
    : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'El micrófono elegido no está disponible. Actualiza la lista y selecciona uno conectado.'
    : name === 'NotReadableError' ? 'El micrófono está ocupado o no está disponible. Revisa otras aplicaciones y vuelve a intentar.'
    : error instanceof Error ? error.message : 'No se pudo iniciar el micrófono. Inténtalo de nuevo.';
}

/** Owns capture nodes and tracks. The caller owns the audio context. */
export class MicrophoneInput {
  private context: AudioContext;
  private stream: MediaStream | null = null;
  private processor: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private mute: GainNode | null = null;
  private disposed = false;
  constructor(context: AudioContext) { this.context = context; }

  async open(deviceId: string, onReading: (data: InputReading) => void, onDevice: (device: ActiveMicrophone) => void, onError: (message: string) => void): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite usar el micrófono aquí. Abre la app en localhost o HTTPS.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1,
    } });
    if (this.disposed) { stream.getTracks().forEach(track => track.stop()); return false; }
    this.stream = stream;
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error('El dispositivo no entregó una pista de audio. Selecciona otro micrófono.');
    const actualId = track.getSettings().deviceId || '';
    if (deviceId && !['default', 'communications'].includes(deviceId) && actualId && actualId !== deviceId) throw new Error('El navegador abrió una entrada distinta de la elegida. Actualiza la lista y vuelve a seleccionarla.');
    track.addEventListener('ended', () => { if (!this.disposed) onError('El micrófono se desconectó. Actualiza la lista y elige una entrada disponible.'); });
    await this.context.audioWorklet.addModule('/audio/pitch-processor.js');
    if (this.disposed) return false;
    this.processor = new AudioWorkletNode(this.context, 'encore-pitch');
    this.source = this.context.createMediaStreamSource(stream);
    this.mute = this.context.createGain(); this.mute.gain.value = 0;
    this.source.connect(this.processor).connect(this.mute).connect(this.context.destination);
    this.processor.onprocessorerror = () => { if (!this.disposed) onError('El análisis de audio se interrumpió. Prueba de nuevo el micrófono.'); };
    this.processor.port.onmessage = ({ data }: MessageEvent<InputReading>) => { if (!this.disposed) onReading(data); };
    onDevice({ deviceId: actualId || deviceId, label: track.label || 'Entrada predeterminada del sistema' });
    return true;
  }

  stop() {
    this.disposed = true;
    if (this.processor) { this.processor.port.onmessage = null; this.processor.onprocessorerror = null; this.processor.disconnect(); }
    this.source?.disconnect(); this.mute?.disconnect();
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
  }
}

/** Unscored, silent input check. It uses exactly the same capture pipeline as a song. */
export class MicrophoneMonitor {
  private context: AudioContext | null = null;
  private input: MicrophoneInput | null = null;
  private disposed = false;
  async start(deviceId: string, onReading: (data: InputReading) => void, onDevice: (device: ActiveMicrophone) => void, onError: (message: string) => void) {
    const fail = (message: string) => { if (!this.disposed) { this.stop(); onError(message); } };
    try {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      await this.context.resume();
      if (this.disposed) return;
      this.input = new MicrophoneInput(this.context);
      let lastPaint = 0;
      await this.input.open(deviceId, data => {
        if (performance.now() - lastPaint > 50) { lastPaint = performance.now(); onReading(data); }
      }, onDevice, fail);
    } catch (error) { fail(microphoneError(error)); }
  }
  stop() {
    this.disposed = true; this.input?.stop();
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
  }
}
