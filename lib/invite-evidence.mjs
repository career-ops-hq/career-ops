/**
 * lib/invite-evidence.mjs — is this email an interview invite? An evidence pass, zero tokens (#6167).
 *
 * Phrase lists misread invites both ways. An application receipt that
 * describes the process ("if there is a match, we will invite you to an
 * interview") reads as an invite, and a real invite that is mostly a calendar
 * event or a booking link carries few invite phrases, or opens with "thank you
 * for your application" and is typed as a receipt.
 *
 * This pass ranks the evidence instead of matching one list:
 *
 *   strong (+3): a calendar invite (a `text/calendar` part or a calendar-style
 *                subject), a proposed interview date and time, a booking link
 *                (Calendly, cal.com, GoodTime, Google appointment schedules,
 *                Outlook Bookings, ATS scheduling pages…), an invite in the subject;
 *   medium (+2): a direct invitation outside a conditional sentence; a subject
 *                about an interview or call; a sender who is a person, not a no-reply box;
 *   weak   (+1): a video-meeting link; named participants; a request for availability;
 *   against (-3): receipt wording and conditional/process wording, counted only
 *                when there is no strong signal and no direct invitation.
 *
 * Invite = score ≥ 4 with at least one strong signal or a direct invitation.
 * Email text is data, never instructions: it is only scored here.
 *
 * Dates are read in English, German and Russian formats and returned as the
 * wall-clock time the email states (`YYYY-MM-DDTHH:MM`, no time zone applied).
 * A `.ics` file has its own reader: ics-interview.mjs.
 */

const low = (s) => String(s || '').toLowerCase();

// ── Signals ────────────────────────────────────────────────────────────
const CAL_SUBJECT = /^(invitation|updated invitation|einladung|aktualisierte einladung|приглашение|обновленное приглашение|назначена встреча|meeting invite|meeting updated|time confirmed|interview confirmation)\b|interview (scheduled|confirmation|confirmed)|confirmation:? your interview|termin(bestätigung| bestätigt)/i;
// Booking pages, matched on the parsed host (a label boundary, never a substring:
// "local.com/privacy" is not cal.com) and, where one host serves more than
// booking pages, on the path.
const BOOKING_HOSTS = [
  ['calendly.com'], ['cal.com'], ['goodtime.io'], ['roosterinc.com'], ['calendar.app.google'],
  ['youcanbook.me'], ['doodle.com'], ['zcal.co'], ['savvycal.com'], ['tidycal.com'], ['chilipiper.com'],
  ['meetings.hubspot.com'], ['meetings-eu1.hubspot.com'], ['hubspot.com', /^\/meetings\//],
  ['calendar.google.com', /^\/calendar\/appointments/],
  ['outlook.office.com', /^\/(owa\/calendar|book)/i], ['outlook.office365.com', /^\/(owa\/calendar|book)/i],
  ...['greenhouse.io', 'ashbyhq.com', 'lever.co', 'workable.com', 'personio.de', 'personio.com', 'teamtailor.com',
    'smartrecruiters.com', 'recruitee.com', 'join.com'].map((h) => [h, /schedul|availability|slot|book|interview/i]),
];
const onHost = (host, h) => host === h || host.endsWith(`.${h}`);
const linkOn = (hosts) => (raw) => {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  const host = u.hostname.toLowerCase();
  return hosts.some(([h, path]) => onHost(host, h) && (!path || path.test(u.pathname)));
};
// Microsoft Bookings pages are on outlook.office(365).com/book/..., listed above;
// a host that only starts with "bookings." is not evidence of one.
const isBookingLink = linkOn(BOOKING_HOSTS);
const CAL_EVENT = /^https:\/\/calendar\.google\.com\/calendar\/event\?/i;
// Words that tie a proposed time to an interview.
const ABOUT_INTERVIEW = /interview|call|chat|meeting|conversation|gespr(ä|ae)ch|termin|kennenlern|einladung|invit|собеседован|встреч|звонок/i;
// Video-meeting links, matched on the parsed host and its meeting route (a
// provider name in a query string or a path elsewhere is not a meeting link).
const VIDEO_HOSTS = [
  ['teams.microsoft.com', /^\/l\/meetup-join\//i], ['teams.live.com', /^\/meet\//i],
  ['meet.google.com', /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\b/i],
  ['zoom.us', /^\/(j|my|w)\//i], ['webex.com', /^\/(meet|join|[^/]+\/j\.php)/i], ['whereby.com', /^\/[^/]+/],
];
const isMeetingLink = linkOn(VIDEO_HOSTS);
const DIRECT = [
  /(would|'d) (like|love) to invite you/, /(we are|we're) (happy|pleased|delighted|excited) to invite you/, /i (would like|want) to invite you/,
  /invite you (to|for) (an? |the |your )?(first |initial |second |2nd |next |virtual |video |personal |short )*(interview|call|chat|conversation|meeting|round|get[- ]to[- ]know)/,
  /(m(ö|oe)chten|w(ü|ue)rden) (sie|dich) (gern|gerne)? ?(zu|zum|für)? ?[^.]{0,60}einladen/, /laden (sie|dich) (gern|gerne)? ?[^.]{0,40}ein/,
  /(please|kindly) (select|choose|pick|book) (a|your|the)? ?(time|slot|date)/, /schedule (your|a|an) (chat|call|interview|meeting)/,
  /(bitte|gerne) (wählen|buchen) (sie|du) (einen|einen passenden)? ?termin/, /i am confirming your interview/, /thank you for scheduling/,
  /looking forward to (meeting|speaking with|talking to) you (on|at)/, /(freuen uns|freue mich) (auf|darauf)[^.]{0,40}(gespräch|kennenlernen|sie kennenzulernen)/,
];
const SUBJECT_INVITE = /(invitation|einladung|invite)\s+(to|for|zu|zum|zur)\b[^|]{0,40}(interview|gespr(ä|ae)ch|call|meeting|conversation|kennenlernen|chat)|interview[- ]?(invitation|einladung|request)|your (upcoming )?interview with|(intro|initial|first|1st|second|2nd|third|3rd|next|final)[- ](call|conversation|interview|round|meeting|chat|gespr(ä|ae)ch)|(erst|kennenlern|vorstellungs)gespr(ä|ae)ch/i;
const SUBJECT_TOPIC = /interview|intro|call|chat|meet|kennenlern|gespr(ä|ae)ch|einladung|invitation|termin|round|runde|screening|conversation|get to know|приглашение|встреча/i;
const NOREPLY = /(no-?reply|noreply|do-?not-?reply|notifications?@|mailer|jobs?@|careers?@|recruiting@|talent@|hr@|bewerbung@|-jobs@)/i;
const PERSON = /\b(with|mit|mit herrn|mit frau)\s+[A-ZÄÖÜ][a-zäöüß]+(\s[A-ZÄÖÜ][a-zäöüß]+)?\b/;
const AVAILABILITY = /(your availability|available (for|on)|suitable (time|date|slot)|time slots?|which (time|date) (works|suits)|let (me|us) know (when|if) you|terminvorschl(ä|ae)g|zeitfenster|passt (es )?(ihnen|dir)|verfügbarkeit)/i;
const RECEIPT = /(received your application|we('ve| have) (got|received) (it|your application)|thank(s| you) for (your )?(applying|application)|application (was|has been) (sent|received|submitted)|(bewerbung|unterlagen)[^.]{0,40}(eingegangen|erhalten)|eingangsbestätigung|vielen dank für (ihre|deine) bewerbung|successfully (received|submitted))/i;
const CONDITIONAL = /(if (there('s| is) a (match|fit)|your (profile|experience|background) (matches|fits|is a match)|we (see|think) (a|there is a) (match|fit)|you('re| are) (shortlisted|selected))|should (your|we|there)|in case (your|we)|(sollte|sollten|falls|wenn) (ihr|dein|wir|sie|du)[^.]{0,40}(passen|profil|überzeug|interesse)|we('ll| will) (be in touch|contact you|reach out|get back)|our (hiring |recruiting )?process|next steps? (in our process|would be|are)|here is a (quick )?look at our process|we will invite)/i;

const sentences = (t) => String(t).split(/(?<=[.!?])\s+|\n+/);
const directOutsideConditional = (t) => sentences(low(t)).some((s) => !CONDITIONAL.test(s) && DIRECT.some((r) => r.test(s)));

// ── Proposed date and time ─────────────────────────────────────────────
const MON = { jan: 1, feb: 2, mar: 3, mär: 3, apr: 4, may: 5, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, dez: 12,
  янв: 1, фев: 2, мар: 3, апр: 4, мая: 5, май: 5, июн: 6, июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12 };
const MONTH_ABBREVIATION = /\s(?:jan|feb|mar|mär|apr|jun|jul|aug|sep|sept|oct|okt|nov|dec|dez|янв|фев|мар|апр|июн|июл|авг|сен|окт|ноя|дек)$/iu;
const monthOf = (w) => MON[low(w).slice(0, 3)] || 0;
const hour24 = (h, ampm) => { let n = +h; const a = low(ampm); if (a === 'pm' && n < 12) n += 12; if (a === 'am' && n === 12) n = 0; return n; };
const TAIL = '[^\\s\\d.,()]*'; // rest of a month word; \w does not match Cyrillic
const MONW = `(jan${TAIL}|feb${TAIL}|m(?:a|ä)r${TAIL}|apr${TAIL}|ma[iy]|jun${TAIL}|jul${TAIL}|aug${TAIL}|sep${TAIL}|o[ck]t${TAIL}|nov${TAIL}|de[cz]${TAIL}|янв${TAIL}|фев${TAIL}|мар${TAIL}|апр${TAIL}|ма[яй]|июн${TAIL}|июл${TAIL}|авг${TAIL}|сен${TAIL}|окт${TAIL}|ноя${TAIL}|дек${TAIL})`;
// am/pm may stand only at the end of a range: "1:00 - 1:30 pm".
const TIME = '(?<h>\\d{1,2})(?:[:.](?<mi>\\d{2}))?\\s*(?<ap>am|pm|uhr|h)?(?:\\s*[-–]\\s*\\d{1,2}(?:[:.]\\d{2})?\\s*(?<ap2>am|pm))?';
const WEEKDAY = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0, mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6, so: 0, пн: 1, вт: 2, ср: 3, чт: 4, пт: 5, сб: 6, вс: 0 };
// 16 янв 2026 ⋅ 14:00 · 20th of March at 12 pm · 4. November 2026, 10:00
const DAY_MONTH_WHEN = new RegExp(`(?<!\\d)(?<dateWords>(?<d>\\d{1,2})(?:st|nd|rd|th|\\.)?\\s+(?:of\\s+)?(?<mon>${MONW}))\\.?,?\\s*(?<y>\\d{4})?(?<dateToTime>[^\\d]{0,12}?)${TIME}`, 'giu');
const WHEN_RES = [
  // 08.03.2026 at 01:00 pm · am 05.11.2026 um 14:00 Uhr · 13-11-2026 10:30 am · Wed, 12/10/25 Time: 1:00 - 1:30 pm
  new RegExp(`(?<wd>[a-zа-я]{2,3})?[a-zа-я]*,?\\s*(?<a>\\d{1,2})(?<sep>[./-])(?<b>\\d{1,2})\\k<sep>(?<y>\\d{2,4})(?<dateToTime>[^\\d]{1,20}?)${TIME}`, 'giu'),
  DAY_MONTH_WHEN,
  // March 20(th)(, 2026) at 12:00 pm
  new RegExp(`(?<mon>${MONW})\\s+(?<d>\\d{1,2})(?:st|nd|rd|th)?,?\\s*(?<y>\\d{4})?\\s*(?:at|@|,|-)\\s*${TIME}`, 'giu'),
];
// "12/10/25" is day/month or month/day (US-style ATS mails): a second part over 12
// can only be the day ("11/20/26"); otherwise a weekday before the date decides, else day/month.
function dayMonth(g) {
  if (g.d) return [+g.d, monthOf(g.mon)];
  const a = +g.a, b = +g.b;
  let y = +g.y; if (y < 100) y += 2000;
  if (b > 12 && a <= 12) return [b, a];
  const wd = WEEKDAY[low(g.wd || '').slice(0, 3)] ?? WEEKDAY[low(g.wd || '').slice(0, 2)];
  if (g.sep === '/' && wd != null && a <= 12 && new Date(y, a - 1, b).getDay() === wd && new Date(y, b - 1, a).getDay() !== wd) return [b, a];
  return [a, b];
}

/**
 * The first plausible date with a time in the text (in text order, whatever
 * the format), from 2 days before to 90 days after `ref` (the email's date).
 * A bare number with no minutes and no am/pm is not a time ("a 12 month
 * contract"), and a day the month does not have ("31.11.") is not a date.
 * @returns {{y: number, mo: number, d: number, h: number, mi: number}|null}
 */
export function parseProposedTime(text, ref = new Date()) {
  const t = String(text || '').slice(0, 20000);
  const matches = WHEN_RES.flatMap((re) => [...t.matchAll(re)]).sort((x, z) => x.index - z.index);
  for (const m of matches) {
    const g = m.groups;
    const [d, mo] = dayMonth(g);
    let y = g.y ? +g.y : 0;
    if (y && y < 100) y += 2000;
    const ap = g.ap || g.ap2;
    const h = hour24(g.h, ap), mi = +(g.mi || 0);
    if (!mo || mo > 12 || !d || d > 31 || h > 23 || mi > 59) continue;
    if (!g.mi && !ap) continue;
    if (!y) { y = ref.getFullYear(); if (new Date(y, mo - 1, d) < new Date(ref.getTime() - 30 * 864e5)) y++; }
    const at = new Date(y, mo - 1, d, h, mi);
    if (at.getFullYear() !== y || at.getMonth() !== mo - 1 || at.getDate() !== d) continue;
    const days = (at - ref) / 864e5;
    if (days < -2 || days > 90) continue;
    return { y, mo, d, h, mi };
  }
  return null;
}

// With an explicit invitation subject, a body consisting of a date and time
// can supply the time. The permissive date parser also accepts words between
// the date and time, so limit this fallback to ordinary date separators.
function parseBareProposedTime(body, ref) {
  const text = body.trim().replace(/\.$/, '');
  if (/[\r\n]/.test(text)) return null;
  const bare = WHEN_RES.some((re) => [...text.matchAll(re)].some((match) =>
    match[0].trim() === text && (!match.groups.a || /^\d/.test(text))
    && /^[ \t,·⋅@–-]*(?:(?:at|um|в)[ \t]+)?$/iu.test(match.groups.dateToTime || '')));
  return bare ? parseProposedTime(text, ref) : null;
}

const pad = (n) => String(n).padStart(2, '0');
export const formatWallTime = (w) => (w ? `${w.y}-${pad(w.mo)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}` : '');

/**
 * @param {{subject?: string, text?: string, from?: string, links?: string[], hasCalendar?: boolean, date?: Date}} email
 *   hasCalendar: the email carries a `text/calendar` part or an `.ics` attachment.
 * @returns {{invite: boolean, score: number, reasons: string[], strong: number, receipt: boolean,
 *   when: string, bookingLink: string, calendarLink: string, meetingLink: string}}
 *   `receipt` is true when receipt or conditional wording was counted against an invite.
 */
export function inviteEvidence({ subject = '', text = '', from = '', links = [], hasCalendar = false, date = new Date() } = {}) {
  const subj = String(subject || '').trim();
  const body = String(text || '').slice(0, 20000);
  const reasons = [];
  let score = 0, strong = 0, receipt = false;
  const add = (n, why, isStrong = false) => { score += n; reasons.push(`${n > 0 ? '+' : ''}${n} ${why}`); if (isStrong) strong++; };
  const all = `${subj}\n${body}`;
  const urls = [...links, ...(body.match(/https?:\/\/[^\s<>")\]]+/g) || [])].map((u) => String(u).replace(/&amp;/g, '&'));

  const calendar = !!hasCalendar || CAL_SUBJECT.test(subj);
  if (calendar) add(3, 'calendar invite', true);
  const subjectInvite = SUBJECT_INVITE.test(subj) && !RECEIPT.test(subj);
  const meeting = urls.find(isMeetingLink) || '';
  // Prefer a time tied to the interview over unrelated dates in the same mail.
  const bodyLines = body.split(/\r?\n/);
  // Keep a date such as "24. Nov." together inside an interview sentence.
  const dateContext = all.replace(DAY_MONTH_WHEN, (match, dateWords) => {
    let afterMonth = match.slice(dateWords.length);
    if (MONTH_ABBREVIATION.test(dateWords)) {
      // Lowercase time connectors continue the date. "At" can start a new sentence.
      afterMonth = afterMonth.replace(/^\.(?=[ \t,]*(?:\d|(?:at|um|в)[ \t]))/u, '');
    }
    return dateWords.replace(/^(\d{1,2})\.(?=[ \t])/, '$1') + afterMonth;
  });
  const when = sentences(dateContext)
    .filter((s) => ABOUT_INTERVIEW.test(s) && !CONDITIONAL.test(low(s)))
    .map((s) => parseProposedTime(s, date)).find(Boolean)
    // Plain-text confirmations can put an explicitly labeled date on the next line.
    || bodyLines.filter((line, i) => /^\s*(?:date|when):/i.test(line)
      && /^\s*(?:your|the) interview (?:is|has been) (?:confirmed|scheduled|booked)[.!]?\s*$/i.test(bodyLines[i - 1] || ''))
      .map((line) => parseProposedTime(line, date)).find(Boolean)
    || (subjectInvite && parseBareProposedTime(body, date))
    // Calendar notices and video invitations can put the time anywhere.
    || ((calendar || meeting) && (parseProposedTime(subj, date) || parseProposedTime(body, date)));
  if (when) add(3, `proposed time ${formatWallTime(when).replace('T', ' ')}`, true);
  if (subjectInvite) add(3, 'invite in the subject', true);
  const booking = urls.find(isBookingLink) || '';
  if (booking) add(3, 'booking link', true);
  const direct = directOutsideConditional(all);
  if (direct) add(2, 'direct invitation');
  if (!subjectInvite && SUBJECT_TOPIC.test(subj) && !RECEIPT.test(subj)) add(2, 'subject about an interview or call');
  const fromName = (String(from).match(/^"?([^"<]+?)"?\s*</) || [])[1] || '';
  if (!NOREPLY.test(from) && /^[A-ZÄÖÜ][\wäöüß'-]+[ ,]+[A-ZÄÖÜ]/.test(fromName.trim())) add(2, 'sent by a person');
  if (meeting) add(1, 'video-meeting link');
  if (PERSON.test(all)) add(1, 'participants named');
  if (AVAILABILITY.test(all)) add(1, 'asks for availability');
  // Many invites open with "thank you for your application": receipt and
  // conditional wording count against only when nothing invites.
  const noInvite = !calendar && !booking && !when && !subjectInvite && !direct;
  if (RECEIPT.test(all) && noInvite) { add(-3, 'application receipt wording'); receipt = true; }
  const cond = sentences(all).find((s) => CONDITIONAL.test(low(s)));
  if (cond && noInvite) { add(-3, `conditional wording: "${cond.trim().slice(0, 80)}"`); receipt = true; }

  const invite = score >= 4 && (strong > 0 || direct);
  return {
    invite, score, reasons, strong, receipt,
    when: invite ? formatWallTime(when) : '',
    bookingLink: invite ? booking : '',
    calendarLink: invite ? (urls.find((u) => CAL_EVENT.test(u)) || '') : '',
    meetingLink: invite ? meeting : '',
  };
}
