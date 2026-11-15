import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextRun } from '../../src/automations/schedule.ts'

const at = (text: string) => new Date(text)
const local = (date: Date) => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()]} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`

test('daily runs today when the time is still ahead, else tomorrow', () => {
  assert.equal(local(nextRun({ schedule: { every: 'daily', at: '09:00' }, after: at('2026-11-16T08:59:00') })), 'Mon 09:00')
  assert.equal(nextRun({ schedule: { every: 'daily', at: '09:00' }, after: at('2026-11-16T09:00:00') }).getDate(), 17)
})

test('weekdays skip Saturday and Sunday', () => {
  const friday = at('2026-11-20T10:00:00')
  assert.equal(local(nextRun({ schedule: { every: 'weekdays', at: '09:00' }, after: friday })), 'Mon 09:00')
  assert.equal(nextRun({ schedule: { every: 'weekdays', at: '09:00' }, after: friday }).getDate(), 23)
})

test('weekly runs on its day, Monday when no day is given', () => {
  assert.equal(local(nextRun({ schedule: { every: 'weekly', at: '16:00', day: 5 }, after: at('2026-11-20T16:00:00') })), 'Fri 16:00')
  assert.equal(nextRun({ schedule: { every: 'weekly', at: '16:00', day: 5 }, after: at('2026-11-20T16:00:00') }).getDate(), 27)
  assert.equal(local(nextRun({ schedule: { every: 'weekly', at: '08:30' }, after: at('2026-11-18T12:00:00') })), 'Mon 08:30')
})

test('hourly uses only the minute and crosses midnight', () => {
  assert.equal(local(nextRun({ schedule: { every: 'hourly', at: '09:15' }, after: at('2026-11-16T13:20:00') })), 'Mon 14:15')
  assert.equal(local(nextRun({ schedule: { every: 'hourly', at: '00:00' }, after: at('2026-11-16T23:30:00') })), 'Tue 00:00')
})
