export function exploreSnapshot(inbox, applications) {
  return {
    inboxUrls: inbox.map((job) => job.url),
    evaluated: applications.map((app) => ({ n: app.n, company: app.company, role: app.role })),
  };
}
