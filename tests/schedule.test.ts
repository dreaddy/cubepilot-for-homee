import { test } from 'node:test';
import assert from 'node:assert/strict';

// The translation module sets the document language when loaded.
Object.assign(globalThis, { document: { documentElement: { lang: 'en' } } });
const { scheduleFromFields, scheduleToFields } = await import('../frontend/src/app/core/schedule.ts');

test('complex recurrence rules stay in advanced mode without losing restrictions', () => {
  for (const rule of [
    'FREQ=HOURLY;INTERVAL=2;BYHOUR=8,10',
    'FREQ=DAILY;BYHOUR=8;BYMINUTE=0,30',
    'FREQ=DAILY;BYHOUR=8;BYSECOND=30',
    'FREQ=WEEKLY;BYHOUR=8',
    'FREQ=WEEKLY;BYHOUR=8;BYDAY=1MO',
  ]) {
    const schedule = scheduleFromFields('20261018T080000Z', rule);
    assert.equal(schedule.mode, 'advanced', rule);
    assert.equal(scheduleToFields(schedule).rrule, rule);
  }
});

test('simple weekly schedules preserve the UTC weekdays and time on a round-trip', () => {
  const rule = 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,FR;BYHOUR=23;BYMINUTE=30';
  const schedule = scheduleFromFields('20261018T233000Z', rule);
  assert.equal(schedule.mode, 'weekly');
  assert.equal(scheduleToFields(schedule).rrule, rule);
});
