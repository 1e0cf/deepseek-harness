/** Reload lifecycle events a host supervisor pairs with its own checkpoints. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { FSWatcher } from 'chokidar'
import { expect, it, onTestFinished, vi } from 'vitest'
import Hmr from '../src/index.ts'

const watchers = vi.hoisted(() => [] as FSWatcher[])
vi.mock('chokidar', async (original) => {
  const native = await original<typeof import('chokidar')>()
  return { ...native, watch: () => {
    const watcher = new native.FSWatcher()
    watchers.push(watcher)
    queueMicrotask(() => watcher.emit('ready'))
    return watcher
  } }
})

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-hmr-lifecycle-'))
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(dir).href + '/'
  onTestFinished(async () => { await ctx.fiber.dispose(); rmSync(dir, { recursive: true, force: true }) })
  await ctx.plugin(Loader)
  await ctx.plugin(Timer)
  await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
  return { ctx, dir }
}

it('brackets a configuration reload with one identified pair', async () => {
  const { ctx, dir } = await fixture()
  const file = join(dir, 'cordis.patch.yml')
  writeFileSync(file, '[]\n')
  const seen: string[] = []
  let before: { id: string; filename: string } | undefined
  ctx.on('hmr/before-reload', (payload) => {
    before = payload
    seen.push('before')
  })
  ctx.on('hmr/after-reload', (payload) => {
    // The pair must share the identity the "before" event opened with.
    expect(payload.id).toBe(before?.id)
    expect(payload.filename).toBe(before?.filename)
    seen.push('after')
  })
  const refreshed = Promise.withResolvers<undefined>()
  const dispose = await ctx.hmr.watchConfig(file, async () => {
    seen.push('refresh')
    refreshed.resolve(undefined)
  })
  onTestFinished(dispose)

  watchers.at(-1)!.emit('change', file)
  await refreshed.promise
  await vi.waitFor(() => { expect(seen).toEqual(['before', 'refresh', 'after']) })
  expect(before?.filename).toBe(file)
  expect(typeof before?.id).toBe('string')
})

it('reports a failed reload before the error reaches its caller', async () => {
  const { ctx, dir } = await fixture()
  const file = join(dir, 'cordis.yml')
  writeFileSync(file, '[]\n')
  const seen: string[] = []
  let failure: { id: string; error: unknown } | undefined
  ctx.on('hmr/before-reload', (payload) => { seen.push('before'); ctx.on('hmr/reload-failed', (failed) => {
    expect(failed.id).toBe(payload.id)
    failure = { id: failed.id, error: failed.error }
    seen.push('failed')
  }) })
  const dispose = await ctx.hmr.watchConfig(file, async () => {
    throw new Error('refresh exploded')
  })
  onTestFinished(dispose)

  watchers.at(-1)!.emit('change', file)
  await vi.waitFor(() => { expect(seen).toEqual(['before', 'failed']) })
  expect(failure?.error).toBeInstanceOf(Error)
  expect((failure?.error as Error).message).toBe('refresh exploded')
})
