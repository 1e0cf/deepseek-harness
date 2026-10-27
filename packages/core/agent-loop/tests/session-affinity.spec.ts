import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse } from './mock-adapter.ts'

async function harness(adapter: MockAdapter): Promise<Context> {
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

describe('session affinity stamping', () => {
  it('stamps the session id as affinity for a top-level agent', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('root'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(adapter.requests[0]?.sessionId).toBe('root')
    expect(adapter.requests[0]?.sessionAffinity).toBe('root')
    await ctx.fiber.dispose()
  })

  it('stamps the lineage root as affinity for a subagent child', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await harness(adapter)
    await ctx.agentLoop.create(SessionId('root'), { provider: 'mock', model: 'mock' })
    const handle = await ctx.agentLoop.createAgent(ctx, {
      sessionId: SessionId('child'),
      meta: { parentSession: SessionId('root'), origin: 'subagent', delegationDepth: 1 },
      agentOptions: { provider: 'mock', model: 'mock' },
    })

    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()

    expect(adapter.requests[0]?.sessionId).toBe('child')
    expect(adapter.requests[0]?.sessionAffinity).toBe('root')
    await handle.dispose()
    await ctx.fiber.dispose()
  })
})
