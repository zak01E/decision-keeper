// Shared decision registry logic, used by both the Rovo agent actions
// (src/index.js) and the Jira issue panel resolver (src/resolvers/index.js).

import api, { route } from '@forge/api';
import { kvs, WhereConditions } from '@forge/kvs';

// All decisions are stored in Forge Key-Value Storage under keys like
// "decision:DEC-1". A separate counter key gives each new decision a short,
// human-friendly id that users can quote in conversations.
const DECISION_PREFIX = 'decision:';
const COUNTER_KEY = 'decision-counter';

// Words that usually signal that a comment or page records a decision.
export const DECISION_WORDS = ['decided', 'decision', 'agreed', 'we will', 'going with', 'approved'];

// Common words ignored when matching an issue summary against decisions,
// otherwise every decision would "match" on words like "the" or "update".
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'this', 'that', 'will', 'should',
  'update', 'add', 'new', 'fix', 'use', 'make', 'setup', 'improvement', 'support',
]);

/**
 * Turns a comma-separated string ("db, billing") into a clean array of
 * lowercase tags (["db", "billing"]). Empty values are dropped.
 */
function parseTags(tags) {
  if (!tags) return [];
  return String(tags)
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Reads every decision from storage. KVS returns results in pages, so we keep
 * following the cursor until there is nothing left.
 */
export async function getAllDecisions() {
  const decisions = [];
  let cursor;
  do {
    let query = kvs.query().where('key', WhereConditions.beginsWith(DECISION_PREFIX)).limit(100);
    if (cursor) query = query.cursor(cursor);
    const page = await query.getMany();
    decisions.push(...page.results.map((result) => result.value));
    cursor = page.nextCursor;
  } while (cursor);
  return decisions;
}

/**
 * Returns true when the decision mentions the keyword in its title,
 * rationale or tags. The comparison ignores upper/lower case.
 */
export function matchesKeyword(decision, keyword) {
  if (!keyword) return true;
  const needle = keyword.toLowerCase();
  const haystack = [decision.title, decision.rationale, ...(decision.tags || [])].join(' ').toLowerCase();
  return haystack.includes(needle);
}

/**
 * Splits free text (e.g. an issue summary) into meaningful lowercase keywords:
 * at least 4 letters long and not a common stop word.
 */
export function extractKeywords(text) {
  return [...new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4 && !STOP_WORDS.has(word)),
  )];
}

/**
 * Jira comments are stored in Atlassian Document Format (ADF), a JSON tree.
 * This walks the tree and concatenates every text node so we can search and
 * quote the comment as plain text.
 */
export function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  const children = (node.content || []).map(adfToText).join(node.type === 'doc' ? '\n' : ' ');
  return children.replace(/\s+/g, ' ').trim();
}

/**
 * Returns true when a piece of text contains one of the decision words.
 */
export function looksLikeDecision(text) {
  const lower = text.toLowerCase();
  return DECISION_WORDS.some((word) => lower.includes(word));
}

/**
 * Saves a new decision and returns it. If `supersedes` points to an older
 * decision, that decision is marked as superseded so it no longer shows up
 * as active.
 */
export async function saveDecision({ title, rationale, decidedBy, source, tags, supersedes, recordedBy, commentId }) {
  // Get the next sequential id (DEC-1, DEC-2, ...).
  const nextNumber = ((await kvs.get(COUNTER_KEY)) || 0) + 1;
  await kvs.set(COUNTER_KEY, nextNumber);
  const id = `DEC-${nextNumber}`;

  const decision = {
    id,
    title: title.trim(),
    rationale: rationale.trim(),
    decidedBy: decidedBy ? decidedBy.trim() : null,
    source: source ? source.trim() : null,
    // Id of the Jira comment the decision was captured from, if any. Lets the
    // issue panel know which decision comments are already in the registry.
    commentId: commentId || null,
    tags: parseTags(tags),
    status: 'active',
    supersedes: supersedes ? supersedes.trim().toUpperCase() : null,
    supersededBy: null,
    // accountId of the user who recorded it, kept for traceability.
    recordedBy: recordedBy || null,
    recordedAt: new Date().toISOString(),
  };

  // Mark the older decision as replaced by this one.
  if (decision.supersedes) {
    const oldKey = DECISION_PREFIX + decision.supersedes;
    const oldDecision = await kvs.get(oldKey);
    if (oldDecision) {
      await kvs.set(oldKey, { ...oldDecision, status: 'superseded', supersededBy: id });
    } else {
      decision.supersedes = null;
    }
  }

  await kvs.set(DECISION_PREFIX + id, decision);
  return decision;
}

/**
 * Fetches one Jira issue (summary + comments) as the current user, so users
 * only ever see issues they are allowed to see.
 */
export async function getIssueWithComments(issueKey) {
  const response = await api
    .asUser()
    .requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary,comment`, {
      headers: { Accept: 'application/json' },
    });
  if (!response.ok) {
    throw new Error(`Could not load ${issueKey} (${response.status})`);
  }
  return response.json();
}
