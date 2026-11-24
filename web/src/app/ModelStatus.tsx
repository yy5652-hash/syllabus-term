import { useEffect, useRef, useState } from 'react';

type Availability = 'checking' | 'available' | 'downloadable' | 'downloading' | 'unavailable';
type FirebaseModule = typeof import('../firebase');
type LanguageModelApi = { availability: (options?: object) => Promise<string> };
const languageModel = () => (globalThis as { LanguageModel?: LanguageModelApi }).LanguageModel;
const options = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
const normalise = (value: string): Availability => ['available', 'downloadable', 'downloading'].includes(value) ? value as Availability : 'unavailable';

export function useDeviceModel() {
  const [availability, setAvailability] = useState<Availability>('checking');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [moduleReady, setModuleReady] = useState(false);
  const firebase = useRef<FirebaseModule | null>(null);
  const preparing = useRef(false);
  useEffect(() => {
    let live = true;
    void import('../firebase').then((module) => { if (live) { firebase.current = module; setModuleReady(true); } }).catch(() => {
      if (live) setError('AI could not be initialized. Check this app’s Firebase configuration and reload.');
    });
    const api = languageModel();
    if (!api) setAvailability('unavailable');
    else void api.availability(options).then((value) => { if (live) setAvailability(normalise(value)); }).catch(() => { if (live) setAvailability('unavailable'); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (availability !== 'downloading' || preparing.current) return;
    const interval = setInterval(() => {
      void languageModel()?.availability(options).then((value) => setAvailability(normalise(value))).catch(() => setAvailability('unavailable'));
    }, 2000);
    return () => clearInterval(interval);
  }, [availability]);

  // Invoke directly inside the click, after preloading the module: preserve user activation.
  const enable = async () => {
    if (!firebase.current || preparing.current) return;
    preparing.current = true;
    setError('');
    setProgress(null);
    setAvailability('downloading');
    try {
      const result = await firebase.current.prepareOnDevice((p) => setProgress(Math.min(100, Math.max(0, Math.round(p * 100)))));
      setAvailability(normalise(result));
    } catch {
      setAvailability('downloadable');
      setError('On-device AI could not be enabled. Try again, or continue with cloud-only processing.');
    } finally { preparing.current = false; }
  };
  return { availability, progress, error, moduleReady, enable };
}

export function ModelStatus({ model }: { model: ReturnType<typeof useDeviceModel> }) {
  const label = model.availability === 'available' ? 'On-device AI: ready'
    : model.availability === 'unavailable' ? 'Not available on this device — cloud only'
    : model.availability === 'downloading' ? `Downloading ${model.progress === null ? 'on-device AI…' : `${model.progress}%`}`
    : model.availability === 'checking' ? 'Checking on-device AI…' : 'Tap to enable on-device AI';
  return <button className={`model-chip ${model.availability === 'available' ? 'model-ready' : ''}`} onClick={() => void model.enable()}
    disabled={model.availability !== 'downloadable' || !model.moduleReady} aria-label={label}>
    <span className={`status-dot ${model.availability === 'downloading' ? 'pulse' : ''}`} aria-hidden="true" />{label}
  </button>;
}
