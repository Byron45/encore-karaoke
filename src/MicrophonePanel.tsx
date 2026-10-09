import { Mic2, RefreshCw, Square } from 'lucide-react';
import { frequencyOf, midiOf, noteName } from './song';
import type { ActiveMicrophone, InputReading } from './microphone';

interface Props {
  devices: MediaDeviceInfo[]; deviceId: string; active: ActiveMicrophone | null;
  onSelect: (id: string) => void; onRefresh: () => void; listError: string;
  testing: boolean; connecting: boolean; singing: boolean; locked: boolean;
  reading: Pick<InputReading, 'rms' | 'frequency'>;
  onTest: () => void; onStop: () => void; transpose: number; firstMidi?: number;
}
export function MicrophonePanel(props: Props) {
  const { devices, deviceId, active, onSelect, onRefresh, listError, testing, connecting, singing, locked, reading, onTest, onStop, transpose } = props;
  const available = !deviceId || devices.some(device => device.deviceId === deviceId);
  const receiving = testing || singing;
  const db = reading.rms > 0 ? 20 * Math.log10(reading.rms) : -80;
  const level = receiving ? Math.max(0, Math.min(100, (db + 65) / 55 * 100)) : 0;
  const inputStatus = connecting ? 'Conectando…' : receiving ? 'Escuchando' : 'Apagado';
  return <section className="microphone-panel" aria-label="Seleccionar y probar micrófono">
    <div className="mic-heading"><Mic2 size={17}/><label htmlFor="microphone">Micrófono</label><span>{inputStatus}</span></div>
    <div className="device-select-row"><select id="microphone" value={deviceId} disabled={locked} onChange={event => onSelect(event.target.value)}>
      <option value="">Predeterminado del sistema</option>
      {!available ? <option value={deviceId}>Entrada guardada · no disponible</option> : null}
      {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Micrófono ${index + 1} · permite acceso para ver el nombre`}</option>)}
    </select><button className="icon-button" type="button" aria-label="Actualizar micrófonos" title="Actualizar micrófonos" onClick={onRefresh}><RefreshCw size={17}/></button></div>
    {listError ? <p className="mic-warning">{listError}</p> : null}
    {!available ? <p className="mic-warning">Esa entrada no aparece en la lista. Actualiza o elige otra; no cambiaremos de micrófono sin avisarte.</p> : null}
    <p className="active-device">{receiving && active ? <>Usando: <strong>{active.label}</strong></> : 'Pulsa Probar micrófono para dar permiso y ver los nombres de tus entradas.'}</p>
    <div className="level-meter" role="meter" aria-label="Nivel del micrófono" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level)}><span style={{ width: `${level}%` }}/></div>
    {receiving ? <div className="input-diagnostic"><strong>{reading.frequency ? `Tu nota: ${noteName(midiOf(reading.frequency))} · ${Math.round(reading.frequency)} Hz` : reading.rms < 0.008 ? 'Señal baja o silencio' : 'Llega sonido; sostén una nota'}</strong><p>{reading.frequency ? 'El detector recibe un tono. Comprueba que sigue tu voz.' : reading.rms < 0.008 ? 'Habla o canta cerca del micrófono y revisa su volumen de entrada.' : 'Prueba con una vocal larga, sin música de fondo.'}</p></div> : null}
    <div className="mic-test-actions">{testing || connecting ? <button className="secondary-button" onClick={onStop}><Square size={14}/> Detener prueba</button> : <button className="secondary-button" disabled={locked} onClick={onTest}><Mic2 size={15}/> Probar micrófono</button>}</div>
    {testing ? <p className="settings-hint">Prueba sin música ni puntos. No se reproduce ni se graba tu voz.</p> : null}
    {props.firstMidi !== undefined ? <p className="reference-note">Inicio de la guía: <strong>{noteName(props.firstMidi + transpose)}</strong> · {Math.round(frequencyOf(props.firstMidi + transpose))} Hz</p> : null}
  </section>;
}
