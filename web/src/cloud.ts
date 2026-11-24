// Remote Config (operator switches), anonymous Auth and Firestore run statistics.
// Loaded lazily; nothing here ever sees syllabus text, grades or course names.

import { getAuth, signInAnonymously } from 'firebase/auth';
import { addDoc, collection, count, getAggregateFromServer, getFirestore, query, serverTimestamp, sum, where } from 'firebase/firestore';
import { fetchAndActivate, getRemoteConfig, getValue } from 'firebase/remote-config';
import { app } from './firebase';

export interface Switches { escalationEnabled: boolean; cloudTimeoutMs: number; statsMinRuns: number }
export const DEFAULT_SWITCHES: Switches = { escalationEnabled: true, cloudTimeoutMs: 30_000, statsMinRuns: 5 };

let switches: Promise<Switches> | null = null;
/** Remote Config values, falling back to the defaults if the fetch is slow (>2 s) or fails. */
export function loadSwitches(): Promise<Switches> {
  switches ??= (async () => {
    const rc = getRemoteConfig(app);
    rc.settings.minimumFetchIntervalMillis = import.meta.env.DEV ? 0 : 10 * 60_000;
    rc.defaultConfig = { escalation_enabled: true, cloud_timeout_ms: 30_000, stats_min_runs: 5 };
    await Promise.race([fetchAndActivate(rc).catch(() => false), new Promise((r) => setTimeout(r, 2000))]);
    return {
      escalationEnabled: getValue(rc, 'escalation_enabled').asBoolean(),
      cloudTimeoutMs: Math.min(120_000, Math.max(5_000, getValue(rc, 'cloud_timeout_ms').asNumber() || 30_000)),
      statsMinRuns: getValue(rc, 'stats_min_runs').asNumber() || 5,
    };
  })().catch(() => DEFAULT_SWITCHES);
  return switches;
}

export interface RunStats {
  charsTotal: number; charsSent: number; gradingSource: 'on_device' | 'in_cloud'; datesSource: 'on_device' | 'in_cloud';
  gradingOk: boolean; datesOk: boolean; escalated: number; repaired: number; ms: number; sample: boolean;
}
export const VERSION = '2026.11.23';

/** Store one run's numbers under an anonymous user. Never throws: statistics must not break the app. */
export async function recordRun(stats: RunStats): Promise<boolean> {
  try {
    const auth = getAuth(app);
    const user = auth.currentUser ?? (await signInAnonymously(auth)).user;
    await addDoc(collection(getFirestore(app), 'runs'), { ...stats, uid: user.uid, at: serverTimestamp(), version: VERSION });
    return true;
  } catch { return false; }
}

export interface LiveStats { runs: number; keptShare: number }
/** Totals across real syllabi checked on the site (the built-in sample is left out): how many, and how much text stayed on the device. */
export async function liveStats(): Promise<LiveStats | null> {
  try {
    const [agg, cfg] = await Promise.all([getAggregateFromServer(query(collection(getFirestore(app), 'runs'), where('sample', '==', false)),
      { runs: count(), total: sum('charsTotal'), sent: sum('charsSent') }), loadSwitches()]);
    const { runs, total, sent } = agg.data();
    if (runs < cfg.statsMinRuns || !total) return null;
    return { runs, keptShare: 1 - sent / total };
  } catch { return null; }
}
