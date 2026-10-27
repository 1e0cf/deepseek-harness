import { describe, expect, it } from 'vitest'
import { resolveSessionAffinity, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionLineage } from '@deepseek-ai/dsh-session'

const node = (id: string, parent?: string): SessionLineage => ({
  id: SessionId(id),
  header: parent === undefined ? {} : { parentSession: SessionId(parent) },
})

const store = (...nodes: SessionLineage[]) => {
  const byId = new Map(nodes.map(entry => [entry.id, entry]))
  return (id: SessionId) => byId.get(id)
}

describe('session affinity', () => {
  it('reports its own id for a top-level session', () => {
    expect(resolveSessionAffinity(node('root'))).toBe(SessionId('root'))
    expect(resolveSessionAffinity(node('root'), store(node('root')))).toBe(SessionId('root'))
  })

  it('reports the parent id when no live-session lookup is supplied', () => {
    expect(resolveSessionAffinity(node('child', 'root'))).toBe(SessionId('root'))
  })

  it('walks to the root of a nested lineage while every ancestor is live', () => {
    const root = node('root')
    const middle = node('middle', 'root')
    const leaf = node('leaf', 'middle')
    expect(resolveSessionAffinity(leaf, store(root, middle, leaf))).toBe(SessionId('root'))
    expect(resolveSessionAffinity(middle, store(root, middle))).toBe(SessionId('root'))
  })

  it('keeps the outermost reachable ancestor when an ancestor session is gone', () => {
    const leaf = node('leaf', 'middle')
    expect(resolveSessionAffinity(leaf, store(leaf))).toBe(SessionId('middle'))
  })

  it('terminates on a cyclic lineage', () => {
    const first = node('first', 'second')
    const second = node('second', 'first')
    expect(resolveSessionAffinity(first, store(first, second))).toBe(SessionId('second'))
  })
})
