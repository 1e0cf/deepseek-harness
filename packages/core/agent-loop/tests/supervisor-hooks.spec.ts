/**
 * The two host-supervisor hooks on the agent machine: cancellation is announced
 * before the inbox changes, and a checkpointed input can be re-armed from the
 * idle phase without inserting a new message.
 * @module dsh-agent-loop/tests/supervisor-hooks
 */
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { MockAdapter, textResponse } from './mock-adapter.ts'

async function harness(adapter: MockAdapter) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

describe('agent supervisor hooks', () => {
  it('announces a cancel with its cause before the inbox is cleared', async () => {
    const adapter = new MockAdapter([textResponse('unused')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('cancel-announced'), { provider: 'mock', model: 'mock' })
    agent.inject(createUserMessage([{ type: 'text', text: 'queued' }]))
    const seen: { kind: string }[] = []
    let pendingWhenAnnounced: boolean | undefined
    ctx.on('agent/cancel-requested', ({ agent: subject, cause }) => {
      if (subject !== agent) return
      pendingWhenAnnounced = subject.inbox.hasPending
      seen.push(cause as { kind: string })
    })

    agent.cancel({ kind: 'user' })

    expect(seen).toEqual([{ kind: 'user' }])
    // The listener sees the input the cancel is about to drop.
    expect(pendingWhenAnnounced).toBe(true)
    expect(agent.inbox.hasPending).toBe(false)
  })

  it('does nothing when the same hook runs with nothing pending', async () => {
    const adapter = new MockAdapter([textResponse('unused')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('wake-empty'), { provider: 'mock', model: 'mock' })

    agent.wakePending()
    await Promise.resolve()

    expect(adapter.requests).toHaveLength(0)
    expect(agent.status).toBe('idle')
  })
})
