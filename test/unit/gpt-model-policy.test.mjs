import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDatabase, closeDatabase } from '../../src/lib/db/database.mjs'
import { SettingsRepo } from '../../src/lib/db/repos/settings-repo.mjs'
import {
  getGptModelPolicy,
  isImageToolModelEnabled,
  listGptPolicyModels,
  listImageToolModels,
  loadGptModelPolicy,
  resetGptModelPolicy,
  saveGptModelPolicy,
  syncGptIdsIntoPolicy,
} from '../../src/lib/protocol/gpt-model-policy.mjs'

function withDb(t) {
  openDatabase({ dbPath: ':memory:' })
  loadGptModelPolicy({ force: true })
  t.after(() => {
    closeDatabase()
    loadGptModelPolicy({ force: true })
  })
}

test('seed enables both image models', (t) => {
  withDb(t)
  assert.deepEqual(getGptModelPolicy().image_tools, {
    'gpt-image-2.5-flare': { enabled: true },
    'gpt-image-2.5-sunburst': { enabled: true },
  })
  assert.deepEqual(
    listImageToolModels().map((m) => [m.id, m.enabled, m.upstream_default]),
    [
      ['gpt-image-2.5-flare', true, true],
      ['gpt-image-2.5-sunburst', true, false],
    ],
  )
})

test('save keeps only known image ids with boolean enabled', (t) => {
  withDb(t)
  saveGptModelPolicy({
    image_tools: {
      'gpt-image-2.5-sunburst': { enabled: false },
      'gpt-image-2': { enabled: false },
      'gpt-image-2.5-flare': { enabled: 'no' },
    },
  })
  assert.deepEqual(getGptModelPolicy().image_tools, {
    'gpt-image-2.5-flare': { enabled: true },
    'gpt-image-2.5-sunburst': { enabled: false },
  })
  const stored = new SettingsRepo().get('gpt_model_policy', null)
  assert.equal(stored.image_tools['gpt-image-2.5-sunburst'].enabled, false)
  assert.equal(stored.image_tools['gpt-image-2'], undefined)
})

test('save without image_tools keeps the current switches', (t) => {
  withDb(t)
  saveGptModelPolicy({ image_tools: { 'gpt-image-2.5-flare': { enabled: false } } })
  saveGptModelPolicy({ models: { 'gpt-6-luna': { enabled: true } } })
  assert.equal(getGptModelPolicy().image_tools['gpt-image-2.5-flare'].enabled, false)
})

test('reset and reload restore image switches', (t) => {
  withDb(t)
  saveGptModelPolicy({ image_tools: { 'gpt-image-2.5-flare': { enabled: false } } })
  loadGptModelPolicy({ force: true })
  assert.equal(isImageToolModelEnabled('gpt-image-2.5-flare'), false)
  resetGptModelPolicy()
  assert.equal(isImageToolModelEnabled('gpt-image-2.5-flare'), true)
})

test('stored policy from before image_tools gets defaults', (t) => {
  withDb(t)
  new SettingsRepo().set('gpt_model_policy', {
    source: 'codex',
    models: { 'gpt-6-luna': { id: 'gpt-6-luna', enabled: true } },
  })
  loadGptModelPolicy({ force: true })
  assert.equal(isImageToolModelEnabled('gpt-image-2.5-sunburst'), true)
})

test('isImageToolModelEnabled folds snapshots and returns null for unknown ids', (t) => {
  withDb(t)
  saveGptModelPolicy({ image_tools: { 'gpt-image-2.5-sunburst': { enabled: false } } })
  assert.equal(isImageToolModelEnabled('gpt-image-2.5-sunburst-2026-09-08'), false)
  assert.equal(isImageToolModelEnabled('gpt-image-2.5-flare'), true)
  assert.equal(isImageToolModelEnabled('gpt-image-2'), null)
  assert.equal(isImageToolModelEnabled(''), null)
})

test('image models never enter the GPT chat catalog', (t) => {
  withDb(t)
  saveGptModelPolicy({ models: { 'gpt-image-2.5-flare': { enabled: true } } })
  assert.equal(getGptModelPolicy().models['gpt-image-2.5-flare'], undefined)
  const synced = syncGptIdsIntoPolicy([{ id: 'gpt-6-luna' }, { id: 'gpt-image-2.5-flare' }])
  assert.ok(synced.ids.includes('gpt-6-luna'))
  assert.ok(!synced.ids.includes('gpt-image-2.5-flare'))
})

test('sync stores catalog metadata and replaces it on the next sync', (t) => {
  withDb(t)
  syncGptIdsIntoPolicy([
    {
      id: 'gpt-6-luna',
      display_name: 'GPT-6 Luna',
      catalog: { context_window: 272000, supported_reasoning_levels: ['low', 'high'] },
    },
  ])
  const first = getGptModelPolicy().models['gpt-6-luna'].catalog
  assert.equal(first.context_window, 272000)
  assert.deepEqual(first.supported_reasoning_levels, ['low', 'high'])
  assert.match(first.synced_at, /^\d{4}-\d{2}-\d{2}T/)
  syncGptIdsIntoPolicy([{ id: 'gpt-6-luna', catalog: { max_context_window: 1000000 } }])
  const second = getGptModelPolicy().models['gpt-6-luna'].catalog
  assert.equal(second.context_window, undefined)
  assert.equal(second.max_context_window, 1000000)
  assert.equal(listGptPolicyModels().find((m) => m.id === 'gpt-6-luna').catalog.max_context_window, 1000000)
})

test('sync without metadata keeps the previous catalog', (t) => {
  withDb(t)
  syncGptIdsIntoPolicy([{ id: 'gpt-6-luna', catalog: { context_window: 272000 } }])
  syncGptIdsIntoPolicy(['gpt-6-luna'])
  assert.equal(getGptModelPolicy().models['gpt-6-luna'].catalog.context_window, 272000)
})

test('panel save keeps the synced catalog; only a sync writes it', (t) => {
  withDb(t)
  syncGptIdsIntoPolicy([{ id: 'gpt-6-luna', catalog: { context_window: 272000 } }])
  saveGptModelPolicy({
    models: { 'gpt-6-luna': { enabled: true, catalog: { context_window: 1, synced_at: 'stale' } } },
  })
  assert.equal(getGptModelPolicy().models['gpt-6-luna'].catalog.context_window, 272000)
  saveGptModelPolicy({ models: { 'gpt-7': { enabled: true, catalog: { context_window: 9 } } } })
  assert.equal(getGptModelPolicy().models['gpt-7'].catalog, undefined)
})

test('a narrower account catalog preserves known models and admin switches across reloads', (t) => {
  withDb(t)
  syncGptIdsIntoPolicy(['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna'])
  saveGptModelPolicy({
    models: {
      'gpt-6.1-sol': { enabled: true, sort: 12, aliases: ['sol'] },
      'gpt-6-astra': { enabled: false },
      'gpt-6-luna': { enabled: false },
    },
  })
  const before = structuredClone(getGptModelPolicy().models['gpt-6.1-sol'])
  syncGptIdsIntoPolicy(['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna'])
  const narrow = syncGptIdsIntoPolicy(['gpt-6-luna', 'gpt-7-preview'])
  assert.deepEqual(narrow.added, ['gpt-7-preview'])
  assert.ok(narrow.ids.includes('gpt-6.1-sol'))
  loadGptModelPolicy({ force: true })
  assert.deepEqual(getGptModelPolicy().models['gpt-6.1-sol'], before)
  assert.equal(getGptModelPolicy().models['gpt-6-astra'].enabled, false)
  const wide = syncGptIdsIntoPolicy(['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna'])
  assert.deepEqual(wide.added, [])
  assert.equal(getGptModelPolicy().models['gpt-6.1-sol'].enabled, true)
  assert.equal(getGptModelPolicy().models['gpt-6-astra'].enabled, false)
  assert.equal(getGptModelPolicy().models['gpt-7-preview'].enabled, false)
})

test('saving a draft from a narrower catalog keeps models discovered after the draft', (t) => {
  withDb(t)
  syncGptIdsIntoPolicy(['gpt-6-luna'])
  const draft = structuredClone(getGptModelPolicy())
  syncGptIdsIntoPolicy([{ id: 'gpt-6.1-sol', catalog: { context_window: 1000000 } }])
  saveGptModelPolicy(draft)
  const models = getGptModelPolicy().models
  assert.equal(models['gpt-6.1-sol'].enabled, false)
  assert.equal(models['gpt-6.1-sol'].catalog.context_window, 1000000)
  assert.equal(models['gpt-5.4'], undefined, 'live policy must not reintroduce seed models')
})
