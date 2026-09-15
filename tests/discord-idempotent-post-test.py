#!/usr/bin/env python3
"""Verify Discord duplicate discovery suppresses a second thread post."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('discord_idempotent_post', Path(__file__).parents[1] / 'scripts/discord-idempotent-post.py')
POSTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(POSTER)


class Response:
    def __init__(self, threads): self.threads = threads
    def read(self): return ('{"threads": ' + str(self.threads).replace("'", '"') + '}').encode()
    def __enter__(self): return self
    def __exit__(self, *_): return False


def run(threads):
    argv = ['discord-idempotent-post.py', '--channel', '1', '--title', '[1:hash]', '--file', 'report.md', '--json']
    with patch.dict(os.environ, {'DISCORD_BOT_TOKEN': 'test-token'}, clear=False), patch.object(sys, 'argv', argv), \
         patch.object(POSTER.urllib.request, 'urlopen', return_value=Response(threads)) as lookup, \
         patch.object(POSTER.subprocess, 'run', return_value=SimpleNamespace(returncode=0)) as post:
        try: POSTER.main()
        except SystemExit as error: assert error.code == 0
        return lookup, post


_, post = run([{'name': '[1:hash]'}])
assert not post.called
_, post = run([{'name': '[other]'}])
assert post.call_args.args[0][-3:] == ['--file', 'report.md', '--json']
print('discord idempotent post: duplicate suppresses post; fresh key posts once')
