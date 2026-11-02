#!/usr/bin/env node
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { load as loadYaml } from 'js-yaml';
import { execFileSync } from 'child_process';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import { findBlacklistEntry, loadBlacklist } from './scan.mjs';
import { localToday } from './lib/local-today.mjs';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { autoApplySubmit } from './lib/auto-apply-submit.mjs';
import { readDecisions } from './lib/auto-apply-decisions.mjs';

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = getCareerOpsRoot();
export function titleGate(title, cfg) {
  const value = String(title || '').toLowerCase();
  if ((cfg.titles?.deny || []).some(term => value.includes(String(term).toLowerCase()))) return 'title matches a deny term';
  if (!(cfg.titles?.allow || []).some(term => value.includes(String(term).toLowerCase()))) return 'title does not match the allow list';
  return null;
}
export function compensationGate(comp, cfg) {
  if (comp == null || comp === '' || comp.stated === false) return 'compensation unstated; confirmation required';
  const floor = Number(typeof comp === 'object' ? comp.floor ?? comp.min : comp);
  if (!Number.isFinite(floor)) return 'compensation is not parseable';
  if (String(comp.currency || cfg.comp.currency).toUpperCase() !== String(cfg.comp.currency).toUpperCase()) return 'compensation currency mismatch';
  return floor >= Number(cfg.comp.floor) ? null : 'compensation floor is below configured minimum';
}
export function locationGate(location, cfg) {
  const value = String(location || '').toLowerCase();
  if (!value) return 'location unstated; country confirmation required';
  if (cfg.location.reject_relocation && /relocat(?:e|ion)/i.test(value)) return 'relocation required or mentioned';
  if (cfg.location.reject_clearance && /clearance/i.test(value)) return 'security clearance wording found';
  if (cfg.location.reject_onsite && /on[- ]?site|in[- ]office|office-based/i.test(value) && !/hybrid/i.test(value)) return 'on-site role rejected';
  if (/hybrid/i.test(value)) {
    const commutable = [cfg.location.hybrid_commutable_from].flat().map(place => String(place).toLowerCase());
    return commutable.some(place => value.includes(place)) ? null : 'hybrid location not confirmed commutable';
  }
  if (/remote|work from home|telework/i.test(value) && cfg.location.remote) return null;
  if (!/united states|\busa\b|\bus\b|california|\bca\b/i.test(value)) return 'country unstated or not confirmed';
  return 'location does not meet remote/hybrid policy';
}
const US_STATE_NAMES = 'alabama|alaska|arizona|arkansas|colorado|connecticut|delaware|district of columbia|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming';
const US_STATE_CODES = 'AL|AK|AZ|AR|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY';
// A location naming a US state other than California. Codes must be uppercase so "or" in prose is not Oregon.
export function outOfState(location) {
  const value = String(location || '');
  return new RegExp(`\\b(?:${US_STATE_NAMES})\\b`, 'i').test(value) || new RegExp(`(?:^|[\\s,(])(?:${US_STATE_CODES})(?=$|[\\s,)])`).test(value);
}
export function remoteOnly(location) {
  const value = String(location || '');
  return /remote/i.test(value) && !/hybrid|on[- ]?site|in[- ]office|office-based/i.test(value);
}
// Out of state and not explicitly remote: omitted from the queue entirely.
export function outOfStateNotRemote(location) {
  return outOfState(location) && !remoteOnly(location);
}
export function atsGate(ats, url, cfg) {
  const vendor = String(ats || '').toLowerCase(), href = String(url || '').toLowerCase();
  if (cfg.submit.block_linkedin_easy_apply && /linkedin\.com/.test(href)) return 'LinkedIn Easy Apply is blocked';
  if (cfg.submit.block_workday && /workday|myworkdayjobs/.test(`${vendor} ${href}`)) return 'Workday is blocked';
  return cfg.submit.allowed_ats.includes(vendor) ? null : 'ATS is not in the allowed list';
}
export function evaluateGates(job, cfg, context = {}) {
  const gates = [[cfg.enabled === true, 'automation is disabled'], [Number(context.submissionsToday || 0) < Number(context.limit ?? cfg.daily_cap), 'daily application cap reached'], [!titleGate(job.title, cfg), titleGate(job.title, cfg)], [Number(job.score) >= Number(cfg.min_score), 'evaluation score is below minimum or missing'], [!compensationGate(job.compensation, cfg), compensationGate(job.compensation, cfg)], [!locationGate(job.location, cfg), locationGate(job.location, cfg)], [!findBlacklistEntry(context.blacklist || new Map(), job.company || '', job.url), 'company or URL is blacklisted'], [job.liveAtEmployer === true, 'posting not confirmed live at employer ATS'], [job.duplicate !== true, 'possible duplicate tracker row'], [!atsGate(job.ats, job.url, cfg), atsGate(job.ats, job.url, cfg)], [job.requiredQuestionsAnswerable === true, 'required form question is unanswerable or not source-verified'], [job.noSensitiveAnswers === true, 'sponsorship or work-authorization answer requested'], [!job.captcha && !job.loginRequired && !job.accountCreationRequired, 'CAPTCHA, login, or account creation encountered']];
  return gates.filter(([passed]) => !passed).map(([, reason]) => reason);
}
export function appendQueueEntry(path, entry) {
  if (!existsSync(path)) writeFileSync(path, '# Auto-apply confirmation queue\n\nMark an entry `resolved` after deciding in chat; entries are retained as an audit trail.\n\n| Date | Company | Role | URL | Gate | Detail | State |\n|---|---|---|---|---|---|---|\n', 'utf8');
  const cell = value => String(value ?? '').replace(/[|\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
  appendFileSync(path, `| ${cell(entry.date)} | ${cell(entry.company)} | ${cell(entry.role)} | ${cell(entry.url)} | ${cell(entry.gate)} | ${cell(entry.detail)} | open |\n`, 'utf8');
}
function submissionsToday(trackerPath, statusLogPath, today) {
  let count = 0;
  if (existsSync(statusLogPath)) count = readFileSync(statusLogPath, 'utf8').split(/\r?\n/).filter(line => { const f = line.split('\t'); return f[1] === today && /\bApplied\b/i.test(f[3] || ''); }).length;
  if (!count && existsSync(trackerPath)) count = (readFileSync(trackerPath, 'utf8').match(new RegExp(`\\|\\s*Applied\\s*\\|\\s*${today.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*\\|`, 'g')) || []).length;
  return count;
}
const atsFromUrl = url => { let h=''; try { h=new URL(url).hostname.toLowerCase(); } catch {} return /greenhouse\.io$/.test(h)?'greenhouse':/ashbyhq\.com$/.test(h)?'ashby':/lever\.co$/.test(h)?'lever':/governmentjobs\.com$|neogov\.com$/.test(h)?'governmentjobs':/myworkdayjobs\.com$|workday\.com$/.test(h)?'workday':/linkedin\.com$/.test(h)?'linkedin':'unknown'; };
const reportSummary = path => { const t=readFileSync(path,'utf8'), m=t.match(/## Machine Summary\s*\r?\n\s*```yaml\s*\r?\n([\s\S]*?)\r?\n```/i); if(!m) throw Error('Machine Summary YAML missing'); return loadYaml(m[1])||{}; };
function child(script,args) { return execFileSync(process.execPath,[join(REPO_ROOT,script),...args],{encoding:'utf8',stdio:['ignore','pipe','ignore']}); }
function answerable(summary, source) { const fields=summary.required_questions||summary.requiredQuestions||[]; return Array.isArray(fields)&&fields.every(q=>typeof q==='string'&&q.trim()&&source.toLowerCase().includes(q.toLowerCase())); }
function parseCli(args) { const at=f=>{const i=args.indexOf(f);return i<0?undefined:args[i+1];}; return {dryRun:!args.includes('--submit'),submit:args.includes('--submit'),approve:(at('--approve')||'').split(',').filter(Boolean),limit:at('--limit')?Number(at('--limit')):Infinity}; }
export async function run({ dryRun=true, submit=false, approve=[], limit=Infinity, dataRoot=DATA_ROOT, pageDriver, setStatus, runtimeChecks, onEvent }={}) {
  const emit = event => { const full={ts:new Date().toISOString(),...event}; try { mkdirSync(join(dataRoot,'output/auto-apply'),{recursive:true}); appendFileSync(join(dataRoot,'output/auto-apply/live.jsonl'),`${JSON.stringify(full)}\n`,'utf8'); } catch {} try { onEvent?.(full); } catch {} };
  emit({type:'run_start'});
  let decisions;
  try { decisions = readDecisions(dataRoot); } catch (error) { emit({type:'error',detail:String(error?.message||error)}); throw error; }
  const cfg=loadYaml(readFileSync(join(dataRoot,'config/auto-apply.yml'),'utf8')), tracker=resolveTrackerPath(dataRoot), day=localToday();
  const cap=Math.min(Number(cfg.daily_cap),Number.isFinite(limit)?limit:Number(cfg.daily_cap)); let used=submissionsToday(tracker,join(dataRoot,'data/status-log.tsv'),day);
  const out=join(dataRoot,'output'); mkdirSync(out,{recursive:true}); const lines=(existsSync(tracker)?readFileSync(tracker,'utf8'):'').split(/\r?\n/), map=resolveColumns(lines), rows=lines.map(x=>parseTrackerRow(x,map)).filter(x=>x&&x.status==='Evaluated'&&Number.parseFloat(x.score)>=Number(cfg.min_score));
  const source=['cv.md','config/profile.yml'].filter(p=>existsSync(join(dataRoot,p))).map(p=>readFileSync(join(dataRoot,p),'utf8')).join('\n');
  const blacklist=loadBlacklist(join(dataRoot,cfg.exclude_companies_file)), submitted=[], queued=[], skipped=[];
  const queue=x=>{appendQueueEntry(join(dataRoot,'data/confirm-queue.md'),{date:day,...x});queued.push(x);emit({type:'queue',...x});};
  for(const row of rows){
    const ref=row.report.match(/\((?:\.\.\/)?reports\/([^)]*)\)/i)?.[1], report=ref&&join(dataRoot,'reports',ref);
    if(!report||!existsSync(report)){skipped.push({company:row.company,role:row.role,reason:'linked report missing'});continue;}
    let s; try{s=reportSummary(report);}catch(e){skipped.push({company:row.company,role:row.role,reason:e.message});continue;}
    const text=readFileSync(report,'utf8'),url=s.url||text.match(/^\*\*URL:\*\*\s*(\S+)/m)?.[1]||row.url;
    const ad=s.advertised_comp; const vals=String(ad||'').match(/[0-9][0-9,.]*/g)||[];
    const decision=decisions.get(url);
    if(decision) emit({type:'decision-applied',url,decision});
    if(decision==='skip'){const reason='skipped by user';skipped.push({company:row.company,role:row.role,url,reason});emit({type:'evaluate',url,company:row.company,role:row.role,gate:'blocked',detail:reason});continue;}
    const job={title:row.role,score:Number.parseFloat(row.score),compensation:s.compensation??(vals.length?{stated:true,floor:Number(vals[0].replace(/,/g,'')),currency:'USD'}:null),location:s.posting_location||s.location||'',company:row.company,url,ats:atsFromUrl(url),liveAtEmployer:false,duplicate:true,requiredQuestionsAnswerable:answerable(s,source),noSensitiveAnswers:!/sponsor|work authorization/i.test(JSON.stringify(s.required_questions||s.requiredQuestions||[])),captcha:false,loginRequired:false,accountCreationRequired:false};
    if(!dryRun){try{job.liveAtEmployer=runtimeChecks?await runtimeChecks.live(job):/active/i.test(child('check-liveness.mjs',['--no-record',url]));}catch{} try{job.duplicate=runtimeChecks?await runtimeChecks.duplicate(job):JSON.parse(child('precheck-duplicate.mjs',['--company',row.company,'--title',row.role,'--url',url,'--json'])).candidates.some(c=>Number(c.num)!==Number(row.num));}catch{}}
    else {job.liveAtEmployer=true;job.duplicate=false;job.requiredQuestionsAnswerable=true;job.noSensitiveAnswers=true;}
    if(outOfStateNotRemote(job.location)){skipped.push({company:row.company,role:row.role,url,reason:'out of state and not remote'});continue;}
    const fails=evaluateGates(job,cfg,{submissionsToday:used,limit:cap,blacklist}); emit({type:'evaluate',url,company:row.company,role:row.role,gate:fails.length?'blocked':'eligible',detail:fails.join('; ')||'all gates passed'});
    const soft=fails.find(x=>/compensation unstated|location unstated|country unstated|hybrid location not confirmed commutable/i.test(x));
    if(soft){queue({company:row.company,role:row.role,url,gate:soft,detail:soft});continue;}
    if(fails.length){skipped.push({company:row.company,role:row.role,reason:fails.join('; ')});continue;}
    if(dryRun){queued.push({company:row.company,role:row.role,url,gate:"eligible",detail:"dry-run plan only; no browser launched"});continue;}
    if(job.ats==='governmentjobs'){queue({company:row.company,role:row.role,url,gate:'prepare-only',detail:'NeoGOV requires login; user submits'});continue;}
    const explicitlyApproved=approve.includes(url)||decision==='approve';
    if(!(submit&&cfg.submit.enabled===true&&(explicitlyApproved||(cfg.submit.unattended===true&&approve.length===0)))){queue({company:row.company,role:row.role,url,gate:'approval',detail:'awaiting approval'});continue;}
    if(used>=cap){skipped.push({company:row.company,role:row.role,reason:'daily application cap reached'});continue;}
    emit({type:'submit_start',url,company:row.company,role:row.role});
    let result; try { result=await autoApplySubmit(job,{dataRoot,date:day,trackerNum:row.num,pageDriver}); } catch(error) { emit({type:'error',url,company:row.company,role:row.role,detail:String(error?.message||error)}); throw error; }
    const shot=Buffer.isBuffer(result)?result:(result?.screenshot||result?.screenshotPath||result?.evidence?.screenshotPath);
    emit({type:'page_step',url,company:row.company,role:row.role,step:result?.step||'inspect',detail:'application page processed'});
    try { const dest=join(dataRoot,'output/auto-apply/live/latest.png'); mkdirSync(dirname(dest),{recursive:true}); if(Buffer.isBuffer(shot)) writeFileSync(dest,shot); else if(typeof shot==='string'&&existsSync(shot)) copyFileSync(shot,dest); } catch {}
    emit({type:'confirm',url,company:row.company,role:row.role,confirmed:result?.confirmed===true,detail:result?.confirmationText});
    if(result.captcha||result.loginRequired||result.accountCreationRequired||result.unanswerable||result.sensitiveQuestion){skipped.push({company:row.company,role:row.role,reason:result.captcha?'CAPTCHA encountered':result.loginRequired?'login required':result.accountCreationRequired?'account creation required':result.sensitiveQuestion?'sponsorship or work-authorization answer requested':'required form question is unanswerable or not source-verified'});continue;}
    if(!result.confirmed){queue({company:row.company,role:row.role,url,gate:'confirmation',detail:'submitted state unknown; check manually'});continue;}
    const note=`Auto-apply confirmation: ${result.confirmationText}`;
    if(setStatus) await setStatus(row,note); else child('set-status.mjs',['--report',String(Number(row.report.match(/\d+/)?.[0])),'Applied','--note',note]);
    submitted.push({company:row.company,role:row.role,url,evidence:result.screenshot,text:result.confirmationText}); used++;
  }
  const block=(heading,items,render)=>`## ${heading}\n\n${items.length?items.map(render).join('\n'):'None'}\n\n`;
  const summary=`# Auto-apply daily summary: ${day}\n\n- Mode: ${dryRun?'dry-run':submit?'submit':'live; approval required'}\n- Date: ${day}\n\n${block('Submitted',submitted,x=>`- ${x.company} | ${x.role} | ${x.url} | ${x.evidence} | ${x.text}`)}${block('Queued',queued,x=>`- ${x.company} | ${x.role} | ${x.gate} | ${x.detail}`)}${block('Skipped',skipped,x=>`- ${x.company} | ${x.role} | ${x.reason}`)}## Cap used\n\n- ${used}/${cap}\n`;
  writeFileSync(join(out,`auto-apply-${day}.md`),summary,'utf8'); emit({type:'run_end',submitted:submitted.length,queued:queued.length,skipped:skipped.length}); return {used,cap,submitted:submitted.length,dryRun,queued,skipped,summary};
}
if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1].replaceAll('\\','/')}`).href) console.log(JSON.stringify(await run(parseCli(process.argv.slice(2)))));
