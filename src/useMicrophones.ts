import { useCallback, useEffect, useRef, useState } from 'react';

const preferenceKey = 'encore.microphone.v1';
function savedDevice() { try { return localStorage.getItem(preferenceKey) || ''; } catch { return ''; } }

export function useMicrophones() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState(savedDevice);
  const [listError, setListError] = useState('');
  const mounted = useRef(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      if (!navigator.mediaDevices?.enumerateDevices) throw new Error('Este navegador no permite consultar las entradas de audio.');
      const available = await navigator.mediaDevices.enumerateDevices();
      if (!mounted.current || request !== generation.current) return;
      setDevices(available.filter(device => device.kind === 'audioinput' && device.deviceId && !['default', 'communications'].includes(device.deviceId)));
      setListError('');
    } catch { if (mounted.current && request === generation.current) setListError('No pudimos actualizar la lista. Comprueba el permiso del micrófono e inténtalo de nuevo.'); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () => { mounted.current = false; generation.current++; navigator.mediaDevices?.removeEventListener('devicechange', refresh); };
  }, [refresh]);
  function selectDevice(id: string) {
    setDeviceId(id);
    try { localStorage.setItem(preferenceKey, id); } catch { /* Selection still works without storage. */ }
  }
  return { devices, deviceId, selectDevice, refresh, listError };
}
