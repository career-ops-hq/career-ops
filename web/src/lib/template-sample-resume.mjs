/**
 * The resume every template preview is filled with: invented end to end, so a
 * gallery card, a demo and an empty install all show a complete layout across
 * every section without anyone's real data in it. Names, employers and contact
 * details are fictional; the email uses the reserved example.com domain.
 *
 * Shaped for build-cv-html.mjs (lib/cv-payload-schema.mjs, format "html").
 */
export const SAMPLE_CV_PAYLOAD = {
  lang: "en",
  page_format: "letter",
  candidate: {
    name: "Jordan Rivera",
    phone: "+1 555 010 0142",
    email: "jordan.rivera@example.com",
    location: "Springfield, USA",
  },
  summary:
    "Operations leader who builds small teams and the systems they run on. Eight years turning unclear processes into dependable ones, with a record of shipping on schedule.",
  competencies: ["Process design", "Team leadership", "Budgeting", "Vendor management", "Reporting"],
  experience: [
    {
      company: "Harbor & Pine Labs",
      role: "Director of Operations",
      location: "Remote",
      context: "Mid-size product company, 120 people.",
      dates: "2021 - Present",
      bullets: [
        "Rebuilt the quarterly planning cycle, cutting planning time from six weeks to three.",
        "Led a team of 14 across support, logistics and finance operations.",
        "Consolidated four vendor contracts into two, saving 18% of the annual spend.",
      ],
    },
    {
      company: "Cedar Row Trading",
      role: "Operations Manager",
      location: "Springfield, USA",
      dates: "2016 - 2021",
      bullets: [
        "Introduced weekly metrics reviews that the leadership team kept using after the first year.",
        "Opened a second fulfilment site on budget and two weeks early.",
      ],
    },
  ],
  projects: [
    {
      name: "Onboarding playbook",
      badge: "Internal",
      tech: "Docs, checklists",
      description: "A one-page-per-role guide that cut new-hire ramp time from 90 days to 60.",
    },
  ],
  education: [
    {
      title: "BA in Business Administration",
      org: "Springfield State University",
      location: "Springfield, USA",
      year: "2016",
      description: "Graduated with honors.",
    },
  ],
  certifications: [{ title: "Project Management Professional", org: "Sample Institute", year: "2019" }],
  awards: [{ title: "Operations Excellence Award", org: "Harbor & Pine Labs", year: "2023" }],
  skills: [
    { category: "Tools", items: "Spreadsheets, SQL, workflow automation" },
    { category: "Languages", items: ["English", "Spanish"] },
  ],
  interests: ["Trail running", "Board games", "Woodworking"],
};

/**
 * The cover letter every cover template preview is filled with. Same person as
 * SAMPLE_CV_PAYLOAD, an invented employer, and the shape generate-cover-letter.mjs
 * takes (candidate + letter).
 */
export const SAMPLE_COVER_PAYLOAD = {
  candidate: { ...SAMPLE_CV_PAYLOAD.candidate },
  letter: {
    company: "Northwind Example Co.",
    location: "Springfield, USA",
    role_title: "Head of Operations",
    greeting: "Dear Hiring Team,",
    opening:
      "I am writing about the Head of Operations role. Running operations for a growing company is the work I have done for the last eight years.",
    profile_intro:
      "At Harbor & Pine Labs I rebuilt the planning cycle and led a team of 14. Before that I opened a second fulfilment site on budget and two weeks early.",
    achievements: [
      { lead: "Planning", impact: "cut the quarterly cycle from six weeks to three." },
      { lead: "Vendors", impact: "consolidated four contracts into two, saving 18% of annual spend." },
    ],
    closing: "I would welcome a conversation about how I can help your team.",
    signature: { valediction: "Sincerely," },
  },
};
