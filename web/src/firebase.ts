// Firebase AI Logic wiring: one hybrid model (on device first, cloud fallback)
// and one cloud-only model used when a section fails its checks.

import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, ThinkingLevel } from 'firebase/ai';
import type { Runner } from './core/router';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(config);

// App Check is required by Firebase AI Logic. In local development a debug
// token is used (registered in the console), as the contest rules allow.
if (import.meta.env.DEV) {
  (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
    import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
}
// App Check (and the reCAPTCHA script it loads) starts on the first AI call,
// not on page load, so a visitor who only reads the page loads no third party.
// getAI must come after it: the AI service picks up App Check when created.
let ai: ReturnType<typeof getAI> | null = null;
function getAi() {
  if (!ai) {
    if (import.meta.env.VITE_RECAPTCHA_SITE_KEY) {
      initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(import.meta.env.VITE_RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true });
    }
    ai = getAI(app, { backend: new GoogleAIBackend() });
  }
  return ai;
}
const CLOUD_MODEL = import.meta.env.VITE_CLOUD_MODEL || 'gemini-3.8-flash';
// A slow cloud call must not stall the page: give up after 30 s and keep the
// on-device answer (the router flags it). The SDK default is 180 s.
let cloudTimeoutMs = 30_000;
/** Set from Remote Config; models are rebuilt so the new timeout applies. */
export function setCloudTimeout(ms: number) { if (ms !== cloudTimeoutMs) { cloudTimeoutMs = ms; models.clear(); } }

// One model per (mode, schema): the SDK keeps the last Chrome session of a
// model alive, so reusing the model keeps Gemini Nano loaded between calls.
const models = new Map<string, ReturnType<typeof getGenerativeModel>>();

function runner(mode: InferenceMode): Runner {
  return async (prompt, schema) => {
    const key = mode + JSON.stringify(schema);
    const model = models.get(key) ?? getGenerativeModel(getAi(), {
      mode,
      onDeviceParams: {
        createOptions: { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] },
        promptOptions: { responseConstraint: schema },
      },
      inCloudParams: {
        model: CLOUD_MODEL,
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema as { [key: string]: unknown }, temperature: 0,
          // Extraction needs little reasoning; low thinking keeps escalation fast.
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
      },
    }, { timeout: cloudTimeoutMs });
    models.set(key, model);
    const res = await model.generateContent(prompt);
    return { text: res.response.text(), source: res.response.inferenceSource ?? (mode === InferenceMode.ONLY_IN_CLOUD ? 'in_cloud' : 'on_device') };
  };
}

export const hybrid = runner(InferenceMode.PREFER_ON_DEVICE);
export const cloud = runner(InferenceMode.ONLY_IN_CLOUD);

/** Must be called from a click: downloads Gemini Nano if needed. */
export async function prepareOnDevice(onProgress?: (p: number) => void): Promise<string> {
  const LM = (globalThis as { LanguageModel?: { availability: (o?: object) => Promise<string> } }).LanguageModel;
  if (!LM) return 'unavailable';
  const model = getGenerativeModel(getAi(), { mode: InferenceMode.PREFER_ON_DEVICE });
  await model.initializeDeviceModel(onProgress);
  return LM.availability();
}

