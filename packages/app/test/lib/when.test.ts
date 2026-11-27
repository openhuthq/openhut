import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayOf, nextOf, onceOf, scheduleOf } from '../../src/lib/when.ts'

test('common cron schedules read as plain words', () => {
  assert.equal(scheduleOf('0 10 * * 1-5'), 'Weekdays at 10:00')
  assert.equal(scheduleOf('0 9 * * 1'), 'Mondays at 9:00')
  assert.equal(scheduleOf('0 18 * * 1,4'), 'Mondays and Thursdays at 18:00')
  assert.equal(scheduleOf('30 7 * * 1,3,5'), 'Mondays, Wednesdays and Fridays at 7:30')
  assert.equal(scheduleOf('*/30 * * * *'), 'Every 30 minutes')
  assert.equal(scheduleOf('0 */2 * * *'), 'Every 2 hours')
  assert.equal(scheduleOf('15 8 * * *'), 'Every day at 8:15')
  assert.equal(scheduleOf('0 9 1 * *'), 'Monthly on the 1st at 9:00')
  assert.equal(scheduleOf('0 9 1 6 *'), 'Repeats')
})

test('the next run is said relative to today', () => {
  const now = new Date(2026, 10, 20, 12, 0)
  assert.equal(nextOf({ at: new Date(2026, 10, 21, 10, 0), now }), 'Tomorrow at 10:00')
  assert.equal(nextOf({ at: new Date(2026, 10, 20, 19, 5), now }), 'Today at 19:05')
  assert.equal(dayOf({ at: new Date(2026, 10, 23, 9, 0), now }), 'Monday')
  assert.equal(dayOf({ at: new Date(2026, 11, 20, 9, 0), now }), 'Dec 20')
  assert.equal(onceOf(new Date(2026, 10, 27, 9, 0)), 'Friday, Nov 27 at 9:00')
})
