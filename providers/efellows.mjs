// @ts-check
// e-fellows.net job board, job_boards: provider: efellows.
// The old www.e-fellows.net/Jobs redirects here. Fixed settled host only.
// robots checked 2026-10-28: /api/gmapi excluded, /jobs allowed, delay 10s.
import { jobiqoBoard, parseJobiqoPage } from './_jobiqo-board.mjs';
export const parseEfellowsPage = html => parseJobiqoPage(html, 'https://jobs.e-fellows.net', 'efellows');
/** @type {import('./_types.js').Provider} */
export default jobiqoBoard('efellows', 'https://jobs.e-fellows.net');
