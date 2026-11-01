// Decision Keeper: backend functions behind the Rovo agent's actions.
//
// Each exported function is wired to a Rovo action in manifest.yml.
// Rovo calls the function with a `payload` object that contains the action
// inputs (e.g. payload.keyword) plus a `context` object describing where the
// agent is running. Whatever the function returns is handed back to the agent,
// which turns it into a natural-language answer for the user.

import api, { route } from '@forge/api';
import {
  adfToText,
  getAllDecisions,
  looksLikeDecision,
  matchesKeyword,
  saveDecision,
} from './decisions';
import { syncDecisionsToGraph } from './graph';

// The Jira issue panel resolver and the Teamwork Graph connection callback
// are exported from here so the manifest can point every function at the
// same bundle entry point (index.js).
export { handler } from './resolvers';
export { onConnectionChange } from './graph';

/**
 * Action "record-decision": saves a new decision in the registry.
 */
export async function recordDecision(payload) {
  const { title, rationale, decidedBy, source, tags, supersedes } = payload;

  if (!title || !rationale) {
    return { error: 'A decision needs both a title and a rationale.' };
  }

  const { decision, changed } = await saveDecision({
    title,
    rationale,
    decidedBy,
    source,
    tags,
    supersedes,
    recordedBy: payload.context?.accountId,
  });
  await syncDecisionsToGraph(changed);
  return { saved: decision };
}

/**
 * Action "list-decisions": returns decisions, newest first, optionally
 * filtered by a keyword. Superseded decisions are hidden unless requested.
 */
export async function listDecisions(payload) {
  const { keyword, includeSuperseded } = payload;
  const decisions = (await getAllDecisions())
    .filter((decision) => includeSuperseded || decision.status === 'active')
    .filter((decision) => matchesKeyword(decision, keyword))
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
    .slice(0, 25);

  return { count: decisions.length, decisions };
}

/**
 * Action "find-jira-decisions": looks for Jira comments that mention the
 * keyword and read like a decision. Requests run as the current user, so the
 * agent only sees issues that user is allowed to see.
 */
export async function findJiraDecisions(payload) {
  const keyword = (payload.keyword || '').replace(/"/g, '');
  if (!keyword) return { error: 'A keyword is required.' };

  let jql = `comment ~ "${keyword}" ORDER BY updated DESC`;
  if (payload.projectKey) {
    jql = `project = "${payload.projectKey.replace(/"/g, '')}" AND ${jql}`;
  }

  const response = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jql, fields: ['summary', 'comment'], maxResults: 10 }),
  });

  if (!response.ok) {
    return { error: `Jira search failed (${response.status}): ${await response.text()}` };
  }

  const { issues = [] } = await response.json();
  const needle = keyword.toLowerCase();
  const findings = [];

  for (const issue of issues) {
    const comments = issue.fields?.comment?.comments || [];
    for (const comment of comments) {
      const text = adfToText(comment.body);
      if (text.toLowerCase().includes(needle) && looksLikeDecision(text)) {
        findings.push({
          issueKey: issue.key,
          issueSummary: issue.fields.summary,
          author: comment.author?.displayName || null,
          date: comment.created,
          text: text.slice(0, 500),
        });
      }
    }
  }

  return { count: findings.length, findings };
}

/**
 * Action "find-confluence-decisions": searches Confluence pages that mention
 * the keyword and either carry the "decision" label or use decision wording.
 */
export async function findConfluenceDecisions(payload) {
  const keyword = (payload.keyword || '').replace(/"/g, '');
  if (!keyword) return { error: 'A keyword is required.' };

  const cql =
    `type = page AND text ~ "${keyword}" AND ` +
    `(label = "decision" OR text ~ "decided" OR text ~ "decision" OR text ~ "agreed") ` +
    `ORDER BY lastmodified DESC`;

  const response = await api
    .asUser()
    .requestConfluence(route`/wiki/rest/api/search?cql=${cql}&limit=10&excerpt=highlight`, {
      headers: { Accept: 'application/json' },
    });

  if (!response.ok) {
    return { error: `Confluence search failed (${response.status}): ${await response.text()}` };
  }

  const { results = [], _links = {} } = await response.json();
  const findings = results.map((result) => ({
    title: result.content?.title || result.title,
    url: _links.base && result.url ? _links.base + result.url : null,
    lastModified: result.lastModified || null,
    // Search excerpts contain highlight markers; strip them for readability.
    excerpt: (result.excerpt || '').replace(/@@@(end)?hl@@@/g, '').slice(0, 500),
  }));

  return { count: findings.length, findings };
}
