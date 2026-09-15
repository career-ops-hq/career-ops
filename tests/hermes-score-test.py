"""Verify evidence normalization, research limits, checkpoints and process-tree cleanup without model calls."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import time
import types
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('score', Path(__file__).resolve().parents[1] / 'scripts/hermes-score.py')
score = importlib.util.module_from_spec(spec)
spec.loader.exec_module(score)

assert score.parse_object('Explanation\n```json\n{"ok":true}\n```') == {'ok': True}

research = {'searched_at': '2026-09-11', 'queries': ['q'], 'compensation': {}, 'team': {}, 'company': {},
            'findings': [{'id': 'f1', 'url': 'https://example.com', 'status': 'retrieved', 'quote': 'exact source'},
                         {'id': 'f2', 'url': 'https://other.com', 'status': 'search_only', 'source': 'web9', 'quote': 'snippet'}]}
messages = [{'role': 'tool', 'content': '<untrusted_tool_result source="web_extract">\n' + json.dumps({'results': [{'url': 'https://example.com', 'content': 'Exact\nsource'}]}) + '\n</untrusted_tool_result>'}]
frozen = score.freeze_research(research, messages)
assert frozen['sources'] == [{'id': 'web1', 'text': 'Exact\nsource'}]
assert frozen['research']['findings'][1]['source'] is None
assert frozen['research']['findings'][1]['quote'] is None
frozen['research']['findings'][0]['scope'] = 'compensation'
assert score.normalize_research_scope(frozen)['research']['findings'][0]['scope'] == 'unresolved'
research['findings'].insert(0, {'id': 'bad', 'url': 'https://example.com', 'status': 'retrieved', 'quote': 'Invented source'})
frozen = score.freeze_research(research, messages)
assert [finding['id'] for finding in frozen['research']['findings']] == ['f1', 'f2']
assert frozen['sources'] == [{'id': 'web1', 'text': 'Exact\nsource'}]

for years, expected in [(0, None), (None, None), (3, 3), (False, False)]:
    evidence = score.attach_evidence({**dict.fromkeys(('company', 'role', 'complete_jd', 'liveness', 'liveness_reason', 'assessment_complete', 'core_capabilities', 'credentials', 'location', 'employment', 'compensation', 'company_size')), 'years': {'verified': years}}, {'text': 'Original JD'})
    assert evidence['prescreen']['years']['verified'] == expected
    assert evidence['jd'] == 'Original JD'

class ToolAgent:
    def __init__(self):
        self.calls = []
    def _invoke_tool(self, name, arguments, *args, **kwargs):
        self.calls.append((name, arguments))
        return '{}'
agent = ToolAgent()
score.limit_research(agent)
agent._invoke_tool('web_extract', {'urls': ['a', 'b', 'c', 'd'], 'char_limit': 50000})
assert agent.calls == [('web_extract', {'urls': ['a', 'b', 'c'], 'char_limit': 4000})]
assert 'did NOT execute' in agent._invoke_tool('web_extract', {'urls': ['e']})
for _ in range(6):
    agent._invoke_tool('web_search', {'query': 'q'})
assert len(agent.calls) == 6
score.stop_work()
assert 'did NOT execute' in agent._invoke_tool('web_search', {'query': 'q'})
score.STOPPING = False

with tempfile.TemporaryDirectory() as temporary:
    directory = Path(temporary)
    calls = []
    def produce():
        calls.append(1)
        return {'value': len(calls)}
    assert score.checkpoint(directory, 'phase', {'rules': 1}, produce) == {'value': 1}
    assert score.checkpoint(directory, 'phase', {'rules': 1}, produce) == {'value': 1}
    assert score.checkpoint(directory, 'phase', {'rules': 2}, produce) == {'value': 2}
    (directory / 'phase.json').write_text('{}')
    assert score.checkpoint(directory, 'phase', {'rules': 2}, produce) == {'value': 3}
    pid_file = directory / 'child.pid'
    script = directory / 'hang.py'
    script.write_text('import subprocess,sys,time,signal\n'
                      'signal.signal(signal.SIGUSR1, lambda *_: None)\n'
                      'p=subprocess.Popen([sys.executable,"-c","import time; time.sleep(60)"],start_new_session=True)\n'
                      f'open({str(pid_file)!r},"w").write(str(p.pid))\n'
                      'time.sleep(60)\n')
    started = time.monotonic()
    assert score.supervise([sys.executable, str(script)], soft=.3, hard=.7) == 'timeout'
    assert time.monotonic() - started < 3
    import psutil
    pid = int(pid_file.read_text())
    time.sleep(.1)
    assert not psutil.pid_exists(pid) or psutil.Process(pid).status() == psutil.STATUS_ZOMBIE
print('hermes-score: evidence, research limits, checkpoints and deadline cleanup passed')


class FakeAgent:
    responses = []
    instances = []
    def __init__(self, **kwargs):
        self.request_overrides = kwargs.get('request_overrides')
        self.closed = False
        self.instances.append(self)
    def run_conversation(self, _prompt):
        return self.responses.pop(0)
    def close(self):
        self.closed = True

hermes_modules = {
    'hermes_cli.env_loader': types.SimpleNamespace(load_hermes_dotenv=lambda: None),
    'hermes_cli.config': types.SimpleNamespace(load_config_readonly=lambda: {'model': {'default': 'test'}}),
    'hermes_cli.runtime_provider': types.SimpleNamespace(resolve_runtime_provider=lambda **_: {}),
    'run_agent': types.SimpleNamespace(AIAgent=FakeAgent),
}
with tempfile.TemporaryDirectory() as temporary, patch.dict(sys.modules, hermes_modules):
    directory = Path(temporary)
    FakeAgent.responses = [{'final_response': 'bad', 'messages': []}, {'final_response': '{"ok": true}', 'messages': []}]
    FakeAgent.instances = []
    assert score.call_agent('test', 'prompt', [], directory)[0] == {'ok': True}
    assert len(FakeAgent.instances) == 2 and all(agent.closed for agent in FakeAgent.instances)
    FakeAgent.responses = [{'final_response': 'bad', 'messages': []}, {'final_response': 'still bad', 'messages': []}]
    FakeAgent.instances = []
    try:
        score.call_agent('test', 'prompt', [], directory)
        raise AssertionError('Repeated bad JSON accepted')
    except json.JSONDecodeError:
        pass
    assert len(FakeAgent.instances) == 2 and all(agent.closed for agent in FakeAgent.instances)
print('hermes-score: bad JSON retries once with a fresh agent')


# A fresh scan snapshot reaches the evidence model without a browser subprocess.
with tempfile.TemporaryDirectory() as temporary:
    directory = Path(temporary)
    snapshot = {'url': 'https://example.com/job', 'text': 'Full JD from scan', 'retrieved_at': '2026-09-12T00:00:00Z'}
    score.save(directory / 'packet.json', {'url': snapshot['url'], 'sources': {}, 'scan_snapshot': snapshot})
    captured = []
    def evidence_call(phase, prompt, tools, directory):
        captured.append(prompt)
        return {}, 'test'
    def stop_after_evidence(*args, **kwargs):
        raise RuntimeError('prescreen reached')
    with patch.object(score.subprocess, 'run', side_effect=AssertionError('Unexpected browser launch')), \
         patch.object(score, 'call_agent', side_effect=evidence_call), \
         patch.object(score, 'attach_evidence', return_value={'complete_jd': True, 'liveness': 'active'}), \
         patch.object(score, 'node', side_effect=stop_after_evidence):
        try:
            score.worker(directory)
            assert False
        except RuntimeError as error:
            assert str(error) == 'prescreen reached'
    assert snapshot['text'] in captured[0]
    assert score.read(directory / 'browser-snapshot.json') == snapshot
print('hermes-score: scan snapshot bypasses browser capture')


# The production boundary is a scanned snapshot entering one worker attempt;
# this fixture replaces only network/model side effects and records its outputs.
def run_worker(prescreen_status):
    with tempfile.TemporaryDirectory() as temporary, patch.dict(sys.modules, hermes_modules):
        directory = Path(temporary)
        snapshot = {'url': 'https://example.com/job', 'text': 'Complete JD', 'retrieved_at': '2026-09-12T00:00:00Z'}
        score.save(directory / 'packet.json', {'url': snapshot['url'], 'sources': {}, 'scan_snapshot': snapshot})
        phases, events, review_prompts = [], [], []
        evidence = {'company': 'Example', 'role': 'Engineer', 'complete_jd': True,
                    'assessment_complete': True, 'years': {'required': 0, 'verified': None, 'evidence': ''},
                    'core_capabilities': [], 'credentials': [],
                    'location': {}, 'employment': {}, 'compensation': {}, 'company_size': {},
                    'liveness': 'active', 'liveness_reason': 'Apply is available'}

        def agent(phase, prompt, *_):
            phases.append(phase)
            if phase == 'evidence': return evidence, 'evidence-session'
            if phase == 'research': return {'sources': [], 'research': {'findings': []}}, 'research-session'
            if phase == 'assessment': return {'dimensions': {}, 'sections': {}}, 'assessment-session'
            review_prompts.append(prompt)
            return {'verdict': 'approve', 'ready': True, 'checks': {}, 'gates': {}}, 'review-session'

        def node(command, *_args, **_kwargs):
            events.append(command)
            if command == 'prescreen': return {'status': prescreen_status, 'missing': []}
            if command == 'render': return {'report_sha256': 'integrity-hash'}
            return {'status': command}

        with patch.object(score, 'call_agent', side_effect=agent), \
             patch.object(score, 'node', side_effect=node), \
             patch.object(score, 'maybe_push', side_effect=lambda _path: events.append('push')), \
             patch.object(score.subprocess, 'run', side_effect=AssertionError('unexpected browser or network subprocess')):
            score.worker(directory)
            first_phases, first_events = phases[:], events[:]
            if prescreen_status == 'pass':
                score.worker(directory)
                assert phases == first_phases
                assert score.read(directory / 'report.md.review.json')['report_sha256'] == 'integrity-hash'
                assert 'integrity-hash' in review_prompts[0]
        return first_phases, first_events


phases, events = run_worker('pass')
assert phases == ['evidence', 'research', 'assessment', 'review']
assert events == ['prescreen', 'render', 'publish', 'push']
phases, events = run_worker('fail')
assert phases == ['evidence']
assert events == ['prescreen', 'discard']
print('hermes-score: scanned qualifying and rejected opportunities follow the isolated worker contract')


# Alert delivery is purely a post-publication decision: no call below the line,
# exactly one successful poster invocation at or above it.
with tempfile.TemporaryDirectory() as temporary:
    root, directory = Path(temporary), Path(temporary) / 'job'
    directory.mkdir()
    (root / 'config').mkdir()
    (root / 'config/profile.yml').write_text('attractiveness:\n  alert_line: 4.5\n')
    score.ROOT, original_root = root, score.ROOT
    try:
        calls = []
        def post(argv, **_kwargs):
            calls.append(argv)
            return types.SimpleNamespace(returncode=0, stderr='')
        with patch.object(score.subprocess, 'run', side_effect=post):
            for lower, expected in ((4.0, 0), (4.5, 1)):
                (directory / 'report.md').write_text('## Machine Summary\n\n```yaml\ncompany: Example\nrole: Engineer\nattractiveness:\n  lower: ' + str(lower) + '\n  upper: ' + str(lower) + '\n  coverage: 1\n```\n')
                score.save(directory / 'report.md.review.json', {'gates': {}})
                score.maybe_push(directory)
                assert len(calls) == expected
    finally:
        score.ROOT = original_root
print('hermes-score: Discord alert threshold sends exactly one post only for the high score')
