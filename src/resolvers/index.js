// Backend for the Jira issue panel. The UI (src/frontend/index.jsx) calls
// these resolver functions with `invoke('functionName', payload)`.

import Resolver from '@forge/resolver';
import {
  adfToText,
  extractKeywords,
  getAllDecisions,
  getIssueWithComments,
  looksLikeDecision,
  matchesKeyword,
  saveDecision,
} from '../decisions';

const resolver = new Resolver();

/**
 * Builds a short title from a comment: its first sentence, capped at 80
 * characters, without a leading "Decision:" label.
 */
function titleFromComment(text) {
  const firstSentence = text.replace(/^decision\s*:\s*/i, '').split(/(?<=[.!?])\s/)[0];
  const title = firstSentence.charAt(0).toUpperCase() + firstSentence.slice(1);
  return title.length > 80 ? `${title.slice(0, 77)}...` : title;
}

/**
 * Returns everything the panel shows for one issue:
 * - linked: active decisions whose source is this issue,
 * - related: active decisions from elsewhere that share keywords with the
 *   issue summary (possible conflicts to double-check),
 * - unrecorded: comments on this issue that read like decisions but are not
 *   in the registry yet.
 */
resolver.define('getPanelData', async ({ context }) => {
  const issueKey = context.extension.issue.key;
  const [issue, decisions] = await Promise.all([getIssueWithComments(issueKey), getAllDecisions()]);

  const active = decisions
    .filter((decision) => decision.status === 'active')
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));

  const linked = active.filter((decision) => (decision.source || '').toUpperCase() === issueKey);

  const keywords = extractKeywords(issue.fields.summary);
  const related = active
    .filter((decision) => !linked.includes(decision))
    .map((decision) => ({
      ...decision,
      matchedKeywords: keywords.filter((keyword) => matchesKeyword(decision, keyword)),
    }))
    .filter((decision) => decision.matchedKeywords.length > 0)
    .slice(0, 5);

  const recordedCommentIds = new Set(decisions.map((decision) => decision.commentId).filter(Boolean));
  // Decisions saved through the Rovo agent have no commentId. Treat a comment
  // as already recorded when at least half of the title keywords of a linked
  // decision appear in it, so the panel does not offer to save it twice.
  const coveredByLinkedDecision = (text) => {
    const lower = text.toLowerCase();
    return linked.some((decision) => {
      if (decision.commentId) return false;
      const titleWords = extractKeywords(decision.title);
      const hits = titleWords.filter((word) => lower.includes(word)).length;
      return titleWords.length > 0 && hits / titleWords.length >= 0.5;
    });
  };

  const unrecorded = (issue.fields.comment?.comments || [])
    .filter((comment) => !recordedCommentIds.has(comment.id))
    .map((comment) => ({
      commentId: comment.id,
      author: comment.author?.displayName || null,
      created: comment.created,
      text: adfToText(comment.body),
    }))
    .filter((comment) => looksLikeDecision(comment.text) && !coveredByLinkedDecision(comment.text))
    .map((comment) => ({ ...comment, suggestedTitle: titleFromComment(comment.text) }));

  return { issueKey, linked, related, unrecorded };
});

/**
 * Saves a decision found in one of this issue's comments. The title and
 * rationale come from the comment; the issue key becomes the source.
 */
resolver.define('recordFromComment', async ({ payload, context }) => {
  const issueKey = context.extension.issue.key;
  return saveDecision({
    title: payload.title,
    rationale: payload.text,
    decidedBy: payload.author,
    source: issueKey,
    commentId: payload.commentId,
    recordedBy: context.accountId,
  });
});

export const handler = resolver.getDefinitions();
