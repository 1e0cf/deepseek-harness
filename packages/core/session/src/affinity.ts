/** Cache-routing affinity for a session lineage. */

import type { SessionHeader, SessionId } from './types.ts'

/** The lineage facts one session must expose to resolve its affinity. */
export interface SessionLineage {
  readonly id: SessionId
  readonly header: Pick<SessionHeader, 'parentSession'>
}

/** Resolves a session id to a live lineage node, when that session still exists. */
export type SessionLineageLookup = (id: SessionId) => SessionLineage | undefined

/**
 * Resolve the id that groups one session's model requests for provider-side
 * cache routing: the outermost ancestor reachable through
 * {@link SessionHeader.parentSession}, or the session's own id when it has no
 * parent. A descendant inherits its parent's history, so a provider that keys a
 * prompt cache by this value reuses the cached prefix only when the child
 * reports the same root as its parent.
 *
 * `lookup` extends the walk past the direct parent while ancestors are live. A
 * child whose parent session is gone keeps its parent's id: that value stays
 * stable and still separates the child from an unrelated conversation.
 * @param session - the session whose affinity is requested.
 * @param lookup - optional live-session resolver for walking the whole chain.
 * @returns the affinity value; equal to `session.id` for a top-level session.
 */
export function resolveSessionAffinity(
  session: SessionLineage,
  lookup?: SessionLineageLookup,
): SessionId {
  const visited = new Set<SessionId>([session.id])
  let affinity = session.id
  let current: SessionLineage | undefined = session
  while (current !== undefined) {
    const parent: SessionId | undefined = current.header.parentSession
    if (parent === undefined || visited.has(parent)) return affinity
    visited.add(parent)
    affinity = parent
    current = lookup?.(parent)
  }
  return affinity
}
