// Resolves one grounded draft context from canonical opportunity and candidate sources.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { contactUid, parseContacts } from '../../contacts.mjs';
import { openOpportunityStore } from '../opportunities/store.mjs';

export async function loadGroundedApplicationContext(databasePath, opportunityId, root = process.cwd()) {
  const store = await openOpportunityStore(databasePath);
  try {
    const opportunity = store.opportunity(opportunityId);
    if (!opportunity || !store.shortlist().some(row => row.id === opportunityId)) throw new Error(`Opportunity ${opportunityId} must be a shortlist opportunity`);
    const candidate = {
      cv: join(root, 'cv.md'), profile: join(root, 'config/profile.yml'), articleDigest: join(root, 'article-digest.md'),
    };
    if (!existsSync(candidate.cv) || !existsSync(candidate.profile)) throw new Error('Grounded drafts require cv.md and config/profile.yml');
    const profile = yaml.load(readFileSync(candidate.profile, 'utf8')) || {};
    return {
      opportunity, evaluation: store.evaluation(opportunityId), artifacts: store.artifacts(opportunityId), evidence: opportunity.evidence, contacts: store.outreachContacts(opportunityId),
      candidate: { cv: readFileSync(candidate.cv, 'utf8'), profile, articleDigest: existsSync(candidate.articleDigest) ? readFileSync(candidate.articleDigest, 'utf8') : null },
      outputLanguage: profile.language?.output || 'en',
      draftContract: { draftOnly: true, candidateClaimSources: ['cv.md', 'config/profile.yml', 'article-digest.md', 'current user statement'] },
    };
  } finally { store.close(); }
}

export async function linkGroundedContact(databasePath, opportunityId, contactKey, { confirmed = false, root = process.cwd() } = {}) {
  if (!confirmed) throw new Error('Contact linking requires explicit candidate confirmation');
  const contactsPath = join(root, 'data/contacts.tsv');
  const known = existsSync(contactsPath) && parseContacts(readFileSync(contactsPath, 'utf8')).contacts.some(contact => contactKey === contactUid(contact));
  if (!known) throw new Error('Contact key is not present in data/contacts.tsv');
  const store = await openOpportunityStore(databasePath);
  try { store.linkOutreachContact(opportunityId, contactKey); } finally { store.close(); }
}

export function contactKeyFor(name, company) { return contactUid({ name, company }); }
