import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROMPTS,
  parseRtptpaBody,
  runRtptpa,
} from './rtptpa';

describe('parseRtptpaBody', () => {
  it('uses the skill self-test prompts when the body is empty', () => {
    const parsed = parseRtptpaBody({});
    expect(parsed.prompts).toEqual([...DEFAULT_PROMPTS]);
    expect(parsed.crystal).toEqual([0.96, 0.84, 0.73]);
    expect(parsed.gaps).toEqual([0.18, 0.25, 0.09]);
  });
});

describe('runRtptpa', () => {
  it('matches the Python self-test control_spec on the default prompts', async () => {
    const evt = await runRtptpa({});
    const spec = evt.data.control_spec;
    expect(evt.record_type).toBe('rtpTPA_arbitration');
    expect(spec.target_system).toBe('Diamond_NV_center');
    expect(spec.dynamical_decoupling).toBe('XY8');
    expect(spec.microwave_frequency_hz).toBeCloseTo(2875000000, 0);
    expect(spec.detuning_hz).toBeCloseTo(5000000, 0);
    expect(spec.pulse_duration_us).toBeCloseTo(0.05, 5);
    expect(spec.expected_fidelity).toBeCloseTo(0.98, 2);
    expect(spec.thermodynamic_cost_j).toBeGreaterThan(0);
    expect(evt.metrics.structural_invariance).toBe(true);
    expect(evt.data.relative_tensor_shape).toEqual([3, 3, 32]);
  });
});
