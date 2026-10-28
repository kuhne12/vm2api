import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase } from '../../src/lib/db/database.mjs'
import {
  loadGptModelPolicy,
  saveGptModelPolicy,
  syncGptIdsIntoPolicy,
} from '../../src/lib/protocol/gpt-model-policy.mjs'
import { gatewayModelCatalog } from '../../src/lib/protocol/models.mjs'
import { resolveTestModels } from '../../src/lib/admin/vm-test-chat.mjs'

test('refreshing a limited slot cannot empty other slots or the public GPT model catalog', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-gpt-catalog-refresh-'))
  openDatabase({ dbPath: ':memory:' })
  loadGptModelPolicy({ force: true })
  t.after(() => {
    closeDatabase()
    loadGptModelPolicy({ force: true })
    fs.rmSync(root, { recursive: true, force: true })
  })
  for (const id of ['vm-limited', 'vm-full']) {
    fs.mkdirSync(path.join(root, 'vms', id), { recursive: true })
    fs.writeFileSync(
      path.join(root, 'vms', `${id}.json`),
      JSON.stringify({
        id,
        platform: 'openai',
        family: 'codex',
        proxy: { url: 'socks5h://127.0.0.1:1080' },
      }),
    )
    fs.writeFileSync(
      path.join(root, 'vms', id, 'codex-credentials.json'),
      JSON.stringify({ accounts: [{ access_token: 'test-access' }] }),
    )
  }
  syncGptIdsIntoPolicy(['gpt-6.1-sol', 'gpt-6-luna'])
  saveGptModelPolicy({ models: { 'gpt-6.1-sol': { enabled: true }, 'gpt-6-luna': { enabled: false } } })
  const refreshed = await resolveTestModels({
    projectRoot: root,
    vmId: 'vm-limited',
    refresh: true,
    catalogClientVersion: '0.165.0',
    fetchImpl: async () => ({ status: 200, json: async () => ({ models: [{ slug: 'gpt-6-luna' }] }) }),
  })
  assert.equal(refreshed.source, 'chatgpt')
  const full = await resolveTestModels({ projectRoot: root, vmId: 'vm-full' })
  assert.ok(full.items.some((m) => m.id === 'gpt-6.1-sol'))
  const catalog = gatewayModelCatalog({ groupType: 'openai' })
  assert.ok(catalog.data.some((m) => m.id === 'gpt-6.1-sol'))
  assert.ok(!catalog.data.some((m) => m.id === 'gpt-6-luna'))
})
