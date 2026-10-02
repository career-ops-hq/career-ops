#!/usr/bin/env python3
"""Post through the existing Discord helper only when its stable thread key is absent."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.request

API = 'https://discord.com/api/v10'
POSTER = '/Users/oii/.hermes/skills/automation/discord-thread-deliver/scripts/discord_thread_post.py'


def token():
    value = os.environ.get('DISCORD_BOT_TOKEN', '').strip()
    if value:
        return value
    env_file = Path.home().joinpath('.hermes/.env')
    for line in env_file.read_text().splitlines() if env_file.is_file() else []:
        if line.startswith('DISCORD_BOT_TOKEN='):
            return line.partition('=')[2].strip().strip('"\'')
    return ''


def request(path, value):
    return json.loads(urllib.request.urlopen(urllib.request.Request(
        f'{API}{path}', headers={'Authorization': f'Bot {value}',
                                 'User-Agent': 'curl/8.0'}), timeout=20).read() or '{}')


def exists(channel, title, value):
    guild = request(f'/channels/{channel}', value).get('guild_id')
    threads = request(f'/guilds/{guild}/threads/active', value).get('threads', [])
    return any(t.get('name') == title and t.get('parent_id') == channel for t in threads)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--channel', required=True)
    parser.add_argument('--title', required=True)
    args, rest = parser.parse_known_args()
    value = token()
    if not value:
        raise SystemExit('DISCORD_BOT_TOKEN not set')
    if exists(args.channel, args.title, value):
        print(json.dumps({'success': True, 'duplicate': True}))
        return
    raise SystemExit(subprocess.run([sys.executable, POSTER, '--channel', args.channel, '--title', args.title, *rest]).returncode)


if __name__ == '__main__':
    main()
