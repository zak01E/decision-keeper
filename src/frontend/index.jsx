// Jira issue panel: shows the decisions linked to the current issue, related
// decisions from elsewhere that may conflict, and decision-like comments that
// have not been saved to the registry yet.
//
// Only UI Kit components from @forge/react are allowed here (no HTML tags).

import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  EmptyState,
  Heading,
  Inline,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Strong,
  Text,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';

// A light card style used for each decision in the lists.
const cardStyle = xcss({
  padding: 'space.150',
  borderRadius: 'border.radius',
  borderColor: 'color.border',
  borderStyle: 'solid',
  borderWidth: 'border.width',
});

/**
 * Formats an ISO timestamp as a short date, e.g. "1 Nov 2026".
 */
function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

/**
 * One decision from the registry: id, title, rationale and metadata.
 */
const DecisionCard = ({ decision }) => (
  <Box xcss={cardStyle}>
    <Stack space="space.050">
      {/* The id sits on its own line so a long title cannot squeeze it. */}
      <Inline>
        <Lozenge appearance="success">{decision.id}</Lozenge>
      </Inline>
      <Strong>{decision.title}</Strong>
      <Text>{decision.rationale}</Text>
      <Text size="small">
        {[decision.decidedBy && `Decided by ${decision.decidedBy}`, decision.source && `Source: ${decision.source}`, formatDate(decision.recordedAt)]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    </Stack>
  </Box>
);

const App = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  // commentId currently being saved, to show a loading state on its button.
  const [savingId, setSavingId] = useState(null);

  const load = () =>
    invoke('getPanelData')
      .then(setData)
      .catch((err) => setError(err.message || String(err)));

  useEffect(() => {
    load();
  }, []);

  const saveComment = async (comment) => {
    setSavingId(comment.commentId);
    try {
      await invoke('recordFromComment', {
        commentId: comment.commentId,
        title: comment.suggestedTitle,
        text: comment.text,
        author: comment.author,
      });
      await load();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSavingId(null);
    }
  };

  if (error) {
    return <SectionMessage appearance="error" title="Decision Keeper could not load">
      <Text>{error}</Text>
    </SectionMessage>;
  }

  if (!data) {
    return <Spinner label="Loading decisions" />;
  }

  const { linked, related, unrecorded } = data;
  const nothingToShow = linked.length === 0 && related.length === 0 && unrecorded.length === 0;

  if (nothingToShow) {
    return (
      <EmptyState
        header="No decisions yet"
        description="When a comment on this issue records a decision (“we decided…”, “agreed…”), Decision Keeper will offer to save it here."
      />
    );
  }

  return (
    <Stack space="space.300">
      {related.length > 0 && (
        <SectionMessage appearance="warning" title="Check before you change course">
          <Stack space="space.100">
            <Text>
              These active decisions share keywords with this issue. Make sure the work here does not contradict them,
              or ask the Decision Keeper agent in Rovo to supersede them.
            </Text>
            {related.map((decision) => (
              <Stack key={decision.id} space="space.050">
                <DecisionCard decision={decision} />
                <Text size="small">Matched on: {decision.matchedKeywords.join(', ')}</Text>
              </Stack>
            ))}
          </Stack>
        </SectionMessage>
      )}

      {unrecorded.length > 0 && (
        <Stack space="space.100">
          <Heading size="small">Decisions found in comments</Heading>
          {unrecorded.map((comment) => (
            <Box key={comment.commentId} xcss={cardStyle}>
              <Stack space="space.100">
                <Text>{comment.text}</Text>
                <Text size="small">
                  {[comment.author, formatDate(comment.created)].filter(Boolean).join(' · ')}
                </Text>
                <Inline>
                  <Button
                    appearance="primary"
                    isDisabled={savingId !== null}
                    onClick={() => saveComment(comment)}
                  >
                    {savingId === comment.commentId ? 'Saving…' : 'Save as decision'}
                  </Button>
                </Inline>
              </Stack>
            </Box>
          ))}
        </Stack>
      )}

      {linked.length > 0 && (
        <Stack space="space.100">
          <Heading size="small">Decisions made on this issue</Heading>
          {linked.map((decision) => (
            <DecisionCard key={decision.id} decision={decision} />
          ))}
        </Stack>
      )}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
