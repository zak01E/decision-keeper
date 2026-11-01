// Teamwork Graph connector: publishes every decision in the registry to
// Atlassian's Teamwork Graph, linked to the Jira issue it came from.
//
// Once a site admin connects "Decision Keeper" (Atlassian Administration →
// Connected apps → Decision Keeper → Connections), decisions show up as
// documents in the graph. Rovo search and every Rovo agent — not only ours —
// can then find them and see which work items they relate to.

import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { graph } from '@forge/teamwork-graph';
import { getAllDecisions } from './decisions';

// KVS key holding the id of the active Teamwork Graph connection. The graph
// API needs it on every call, and only onConnectionChange receives it.
const CONNECTION_KEY = 'graph-connection-id';

// setObjects accepts at most 100 objects per request.
const BATCH_SIZE = 100;

// Matches Jira issue keys such as "PLAT-7" so we can link the decision to it.
const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;

/**
 * Returns the base URL of the Jira site (e.g. https://acme.atlassian.net),
 * used to build links back to the decision's source issue.
 */
async function getSiteUrl() {
  const response = await api.asApp().requestJira(route`/rest/api/3/serverInfo`, {
    headers: { Accept: 'application/json' },
  });
  const { baseUrl } = await response.json();
  return baseUrl;
}

/**
 * Converts a registry decision into a Teamwork Graph "atlassian:document".
 * The rationale becomes the searchable text, and the source issue (if any)
 * becomes an association so the graph links the decision to that work item.
 */
function toGraphDocument(decision, siteUrl) {
  const issueKey = ISSUE_KEY_PATTERN.test(decision.source || '') ? decision.source : null;
  const lastUpdatedAt = decision.updatedAt || decision.recordedAt;

  const text = [
    `${decision.id}: ${decision.title}`,
    `Status: ${decision.status}${decision.supersededBy ? ` (superseded by ${decision.supersededBy})` : ''}`,
    `Why: ${decision.rationale}`,
    decision.decidedBy && `Decided by: ${decision.decidedBy}`,
    decision.source && `Source: ${decision.source}`,
  ]
    .filter(Boolean)
    .join('\n');

  const document = {
    schemaVersion: '1.0',
    id: decision.id,
    // Must grow every time the object changes so the graph keeps the latest
    // version; a millisecond timestamp does that without extra bookkeeping.
    updateSequenceNumber: Date.parse(lastUpdatedAt),
    displayName: `Decision ${decision.id}: ${decision.title}`,
    description: decision.rationale.slice(0, 250),
    url: issueKey ? `${siteUrl}/browse/${issueKey}` : siteUrl,
    createdAt: decision.recordedAt,
    lastUpdatedAt,
    // Decisions are team knowledge: everyone in the workspace may read them.
    permissions: [{ accessControls: [{ principals: [{ type: 'ATLASSIAN_WORKSPACE' }] }] }],
    'atlassian:document': {
      type: { category: 'DOCUMENT', mimeType: 'text/plain' },
      content: { mimeType: 'text/plain', text },
      labels: ['decision', decision.status, ...(decision.tags || [])],
    },
  };

  if (issueKey) {
    document.associations = {
      lastUpdatedAt,
      set: [{ associationType: 'issueIdOrKeys', values: [issueKey] }],
    };
  }

  return document;
}

/**
 * Sends decisions to the graph in batches. Does nothing until an admin has
 * connected the connector. Rejected objects are logged rather than thrown so
 * saving a decision never fails because of the graph.
 */
export async function syncDecisionsToGraph(decisions) {
  const connectionId = await kvs.get(CONNECTION_KEY);
  if (!connectionId || decisions.length === 0) return { synced: 0 };

  const siteUrl = await getSiteUrl();
  let synced = 0;

  for (let i = 0; i < decisions.length; i += BATCH_SIZE) {
    const objects = decisions.slice(i, i + BATCH_SIZE).map((decision) => toGraphDocument(decision, siteUrl));
    try {
      const response = await graph.setObjects({ objects, connectionId });
      synced += response.accepted?.length ?? (response.success ? objects.length : 0);
      if (response.rejected?.length) {
        console.warn('Teamwork Graph rejected decisions:', JSON.stringify(response.rejected));
      }
    } catch (error) {
      console.error('Teamwork Graph sync failed:', error);
    }
  }

  return { synced };
}

/**
 * Called by Atlassian when an admin creates, updates or deletes the
 * connection. On creation we remember the connection id and backfill every
 * existing decision so the graph is complete from day one.
 */
export async function onConnectionChange(request) {
  switch (request.action) {
    case 'CREATED':
    case 'UPDATED': {
      await kvs.set(CONNECTION_KEY, request.connectionId);
      const result = await syncDecisionsToGraph(await getAllDecisions());
      console.log(`Teamwork Graph connection ${request.action}: synced ${result.synced} decisions`);
      break;
    }
    case 'DELETED':
      await kvs.delete(CONNECTION_KEY);
      break;
    default:
      console.warn(`Unknown connection action: ${request.action}`);
  }
}
