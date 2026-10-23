import { describe, expect, it } from 'vitest';
import {
  addMinutes,
  initialSlaDueAt,
  slaDueAtAfterPriorityChange,
  type SlaState,
} from './sla.rules.js';

const now = new Date('2026-10-23T10:00:00.000Z');
const fresh: SlaState = {
  priority: 'medium',
  slaDueAt: null,
  firstResponseAt: null,
  slaBreachedAt: null,
};

describe('initialSlaDueAt', () => {
  it('starts the clock only for high and urgent tickets', () => {
    expect(initialSlaDueAt('high', now, 2)).toEqual(addMinutes(now, 2));
    expect(initialSlaDueAt('urgent', now, 0.5)).toEqual(new Date('2026-10-23T10:00:30.000Z'));
    expect(initialSlaDueAt('medium', now, 2)).toBeNull();
    expect(initialSlaDueAt('low', now, 2)).toBeNull();
  });
});

describe('slaDueAtAfterPriorityChange', () => {
  it('starts the clock when a ticket is raised to high', () => {
    expect(slaDueAtAfterPriorityChange(fresh, 'high', now, 5)).toEqual(addMinutes(now, 5));
  });

  it('keeps the existing deadline when moving between high and urgent', () => {
    const running = { ...fresh, priority: 'high' as const, slaDueAt: addMinutes(now, 1) };
    expect(slaDueAtAfterPriorityChange(running, 'urgent', now, 5)).toBeUndefined();
  });

  it('clears the deadline when lowered below high', () => {
    const running = { ...fresh, priority: 'urgent' as const, slaDueAt: addMinutes(now, 1) };
    expect(slaDueAtAfterPriorityChange(running, 'low', now, 5)).toBeNull();
  });

  it('does nothing once a staff member has responded or the SLA was breached', () => {
    const responded = { ...fresh, firstResponseAt: now };
    const breached = { ...fresh, priority: 'high' as const, slaDueAt: now, slaBreachedAt: now };
    expect(slaDueAtAfterPriorityChange(responded, 'urgent', now, 5)).toBeUndefined();
    expect(slaDueAtAfterPriorityChange(breached, 'low', now, 5)).toBeUndefined();
  });

  it('does nothing for low/medium changes without a deadline', () => {
    expect(slaDueAtAfterPriorityChange(fresh, 'low', now, 5)).toBeUndefined();
  });
});
