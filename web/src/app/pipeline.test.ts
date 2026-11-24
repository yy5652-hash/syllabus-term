import { describe, expect, it } from 'vitest';
import type { Runner } from '../core/router';
import { extractWithProgress } from './pipeline';
import { SAMPLE } from './sample';

// Device answer with a grading table that does not add up to 100: it fails its check.
const device: Runner = async (prompt) => prompt.startsWith('Extract the grading')
  ? { source: 'on_device', text: JSON.stringify({ components: [{ name: 'Midterm exam', weight: 30, kind: 'exam' }] }) }
  : { source: 'on_device', text: JSON.stringify({ items: [{ label: 'Final exam', date: '2026-12-17', kind: 'exam' }] }) };

describe('Remote Config escalation switch', () => {
  it('with escalation off, a failed section stays on the device and keeps its issues', async () => {
    const calls: string[] = [];
    const cloud: Runner = async () => { calls.push('cloud'); throw new Error('must not be called'); };
    const plan = await extractWithProgress(SAMPLE, 2026, { hybrid: device, cloud }, undefined, () => {}, false);
    expect(calls).toEqual([]);
    expect(plan.grading.finalSource).toBe('on_device');
    expect(plan.grading.finalReport.ok).toBe(false);
    expect(plan.grading.charsSentToCloud).toBe(0);
  });
  it('with escalation on (default), the failed section goes to the cloud', async () => {
    const calls: string[] = [];
    const cloud: Runner = async () => { calls.push('cloud'); return { source: 'in_cloud', text: '{"components":[]}' }; };
    await extractWithProgress(SAMPLE, 2026, { hybrid: device, cloud }, undefined, () => {});
    expect(calls).toEqual(['cloud']);
  });
});
