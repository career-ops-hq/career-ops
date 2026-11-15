import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.GITHUB_REPOSITORY = 'career-ops-hq/career-ops';
const { buildSnapshot } = await import('../.github/scripts/triage.bundle.mjs');

const labelAt = '2026-11-14T12:00:00.000Z';
const beforeLabel = '2026-11-14T11:59:00.000Z';
const afterLabel = '2026-11-14T12:05:00.000Z';

function fixture({ kind }) {
  const pushed = kind === 'push';
  return {
    number: 6356,
    title: 'PR author activity fixture',
    body: '',
    author: { login: 'contributor', __typename: 'User' },
    authorAssociation: 'CONTRIBUTOR',
    createdAt: '2026-11-14T10:00:00.000Z',
    updatedAt: afterLabel,
    isDraft: false,
    state: 'OPEN',
    headRefOid: 'abcdef0123456789',
    baseRefName: 'main',
    headRefName: 'fix',
    isCrossRepository: true,
    headRepository: { nameWithOwner: 'contributor/repo' },
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    maintainerCanModify: true,
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    reviewDecision: 'CHANGES_REQUESTED',
    autoMergeRequest: null,
    mergeQueueEntry: null,
    labels: { nodes: [{ name: 'triage/waiting-author' }] },
    files: { nodes: [], pageInfo: { hasNextPage: false } },
    commits: { nodes: [{ commit: { oid: 'abcdef0123456789', committedDate: beforeLabel, statusCheckRollup: null } }] },
    reviews: { nodes: [], pageInfo: { hasNextPage: false } },
    reviewThreads: {
      nodes: [{
        isResolved: false,
        isOutdated: false,
        // PR_QUERY asks for comments(first: 1), so this is the thread root;
        // a later author reply is not present in the returned thread comments.
        comments: { nodes: [{ author: { login: 'maintainer' }, createdAt: beforeLabel }] },
      }],
      pageInfo: { hasNextPage: false },
    },
    comments: { nodes: [], pageInfo: { hasNextPage: false } },
    timelineItems: {
      nodes: [
        { __typename: 'LabeledEvent', createdAt: labelAt, label: { name: 'triage/waiting-author' } },
        ...(pushed ? [{
          __typename: 'PullRequestCommit',
          commit: { committedDate: beforeLabel, authoredDate: beforeLabel, author: { user: { login: 'contributor' } } },
        }] : []),
      ],
    },
  };
}

async function snapshotFor(pr) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const { query } = JSON.parse(init.body);
    const data = query.includes('pullRequest(number')
      ? { repository: { pullRequest: pr } }
      : { search: { issueCount: 0 } };
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    return await buildSnapshot(6356);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('a normal push after triage/waiting-author was labeled counts as author activity', async () => {
  const snapshot = await snapshotFor(fixture({ kind: 'push' }));
  assert.equal(snapshot.updatedAt, afterLabel);
  assert.equal(snapshot.lastAuthorActivityAt, afterLabel,
    'the push was after the label, even though its commit timestamp was before it');
});

test('an author reply in a review thread after triage/waiting-author was labeled counts as activity', async () => {
  const snapshot = await snapshotFor(fixture({ kind: 'thread-reply' }));
  assert.equal(snapshot.updatedAt, afterLabel);
  assert.equal(snapshot.lastAuthorActivityAt, afterLabel,
    'the author reply was after the label but is not among the first comment returned for the thread');
});
