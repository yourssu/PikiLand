#!/usr/bin/env python3
"""Read-only nginx common/combined observer. Python 3.9+, standard library only.
No debug logging, web-server configuration, raw log export or production requests.
"""
import collections
import json
import os
import re
import sqlite3
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ACCESS = re.compile(r'^\S+ \S+ \S+ \[[^\]]+\] "([A-Z]+) ([^" ]+) HTTP/[0-9.]+" ([1-5][0-9]{2}) ([0-9]{1,15}|-)(?: .*)?$')
LABEL = re.compile(r'^[A-Za-z0-9_.:-]{1,80}$')
MAX_LINE = 16384
MAX_READ = 262144  # bytes per one-second tick, independently of incoming traffic
MAX_PENDING = 256


def parse_line(line):
    if len(line) > MAX_LINE:
        return None
    match = ACCESS.fullmatch(line.rstrip('\r\n'))
    if match:
        method, target, status, size = match.groups()
        if not target.startswith('/'):
            return None
        return {'method': method, 'path': target.split('?', 1)[0], 'status': int(status),
                'bytes': int(size) if size != '-' else 0}
    try:
        value = json.loads(line)
        # Optional pre-existing access JSON; never export extra fields.
        method, target = value['request_method'], value['uri']
        status, size = int(value['status']), int(value['body_bytes_sent'])
        duration = float(value['request_time']) * 1000 if 'request_time' in value else None
        if not isinstance(method, str) or not re.fullmatch('[A-Z]+', method) or not isinstance(target, str) or not target.startswith('/'):
            return None
        if not 100 <= status <= 599 or not 0 <= size <= 9007199254740991 or (duration is not None and not 0 <= duration <= 86400000):
            return None
        result = {'method': method, 'path': target.split('?', 1)[0], 'status': status, 'bytes': size}
        if duration is not None:
            result['durationMs'] = duration
        return result
    except (ValueError, KeyError, TypeError):
        return None


def validate_config(c):
    url = urllib.parse.urlsplit(c['endpoint'])
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment or url.path != '/api/production/signals':
        raise ValueError('endpoint must be an HTTPS production signals URL')
    for field in ('observerId', 'service'):
        if not LABEL.fullmatch(c[field]):
            raise ValueError('invalid identity')
    if not re.fullmatch(r'[\w.-]+/[\w.-]+', c['repository']) or not re.fullmatch(r'[A-Za-z0-9_-]{16,256}', c['token']):
        raise ValueError('invalid repository or token')
    if not os.path.isabs(c['logPath']) or not os.path.isabs(c['statePath']):
        raise ValueError('absolute paths required')
    rules = c.get('routes', [])
    if len(rules) > 32:
        raise ValueError('at most 32 configured routes')
    labels, paths = set(), set()
    for rule in rules:
        if not LABEL.fullmatch(rule['label']) or rule['label'] == 'all' or rule['label'] in labels or rule['path'] in paths:
            raise ValueError('unique route labels and paths required')
        if not rule['path'].startswith('/') or '?' in rule['path'] or len(rule['path']) > 512:
            raise ValueError('literal paths without queries required')
        if 'statuses' in rule and (not rule['statuses'] or any(type(x) is not int or not 100 <= x <= 599 for x in rule['statuses'])):
            raise ValueError('invalid expected status codes')
        for key in ('minBytes', 'maxDurationMs'):
            if key in rule and (type(rule[key]) not in (int, float) or not 0 <= rule[key] <= 86400000):
                raise ValueError('invalid response contract')
        labels.add(rule['label'])
        paths.add(rule['path'])
    return c


class Detector:
    def __init__(self, config, now=None):
        self.config = config
        self.start = int(time.time() if now is None else now)
        self.rules = {r['path']: r for r in config.get('routes', [])}
        self.history = collections.defaultdict(lambda: collections.deque(maxlen=12))
        self.streak = collections.Counter()
        self.cooldown = {}
        self.capabilities = set()
        self.reset()
        self.complete = False  # startup observes a partial window

    def reset(self):
        self.groups = {}
        self.parsed = self.rejected = 0
        self.complete = True

    def feed(self, line):
        row = parse_line(line)
        if row is None:
            self.rejected += 1
            self.complete = False
            return
        self.parsed += 1
        self.capabilities.update(("status", "bytes"))
        if "durationMs" in row:
            self.capabilities.add("duration")
        rule = self.rules.get(row['path'])
        label = rule['label'] if rule else 'all'
        group = self.groups.setdefault(label, {'total':0, 'counts':collections.Counter(), 'samples':collections.defaultdict(list)})
        group['total'] += 1
        flags = {'http_5xx': row['status'] >= 500,
                 'redirect_shift': 300 <= row['status'] <= 399 and row['status'] != 304,
                 'empty_response_shift': row['method'] != 'HEAD' and row['status'] == 200 and row['bytes'] == 0}
        if rule:
            flags['response_contract'] = ('statuses' in rule and row['status'] not in rule['statuses']) or ('minBytes' in rule and row['method'] != 'HEAD' and row['status'] == 200 and row['bytes'] < rule['minBytes'])
            if 'maxDurationMs' in rule:
                if 'durationMs' not in row:
                    self.complete = False  # never invent missing latency
                else:
                    flags['latency_contract'] = row['durationMs'] > rule['maxDurationMs']
        for name, failed in flags.items():
            group['counts'][name] += int(failed)
            if failed and len(group['samples'][name]) < 5:
                group['samples'][name].append({k:row[k] for k in ('status','bytes','durationMs') if k in row})

    def flush(self, now=None):
        now = int(time.time() if now is None else now)
        if now - self.start < 60:
            return []
        output = []
        healthy = self.complete and self.rejected == 0 and now-self.start <= 90
        for label, g in self.groups.items():
            for name, count in g['counts'].items():
                key = (label, name)
                rate = count / g['total']
                history = self.history[key]
                baseline = sum(history)/len(history) if len(history) >= 6 else None
                enough = healthy and g['total'] >= 100
                if name.endswith('_shift'):
                    abnormal = enough and baseline is not None and rate >= max(baseline+0.2, baseline*3) and count >= 10
                else:
                    abnormal = enough and count >= 5 and rate >= 0.05
                self.streak[key] = self.streak[key]+1 if abnormal else 0
                if self.streak[key] >= 2 and now-self.cooldown.get(key, -900) >= 900:
                    output.append({'schemaVersion':1,'signalId':str(uuid.uuid4()),'observerId':self.config['observerId'],
                        'service':self.config['service'],'environment':'production','ruleId':name,'ruleVersion':1,'route':label,
                        'windowStart':self.start,'windowEnd':now,'sampleCount':g['total'],'violationCount':count,
                        'observedRate':rate,'baselineRate':baseline,'evidence':g['samples'][name],
                        'quality':{'complete':True,'parsed':self.parsed,'rejected':self.rejected}})
                    self.cooldown[key] = now
                if enough and not abnormal:
                    history.append(rate)
        # A missing route/window breaks persistence; it is not a zero-error sample.
        present = {(label, name) for label,g in self.groups.items() for name in g['counts']}
        for key in list(self.streak):
            if key not in present:
                self.streak[key] = 0
        if not healthy:
            self.history.clear()
            self.streak.clear()
        self.start = now
        self.reset()
        return output


class Spool:
    def __init__(self, path):
        self.dropped = 0
        self.db = sqlite3.connect(path)
        os.chmod(path, 0o600)
        self.db.execute('CREATE TABLE IF NOT EXISTS pending (id TEXT PRIMARY KEY, body TEXT NOT NULL, created INTEGER NOT NULL)')

    def add(self, signals, now):
        with self.db:
            self.db.execute('DELETE FROM pending WHERE created < ?', (now-86400,))
            for s in signals:
                if self.db.execute('SELECT count(*) FROM pending').fetchone()[0] >= MAX_PENDING:
                    self.dropped += 1
                    continue  # fixed disk budget; never backpressure the web server
                self.db.execute('INSERT OR IGNORE INTO pending VALUES (?,?,?)',(s['signalId'],json.dumps(s),now))

    def send_one(self, config):
        row = self.db.execute('SELECT id,body FROM pending ORDER BY created LIMIT 1').fetchone()
        if not row:
            return
        request = urllib.request.Request(config['endpoint'],data=row[1].encode(),headers={
            'Content-Type':'application/json','Authorization':'Bearer '+config['token'],'X-Pikiland-Repo':config['repository']})
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context()))
        try:
            with opener.open(request,timeout=3) as response:
                accepted = response.status == 202
        except urllib.error.HTTPError as e:
            # Invalid/stale messages cannot recover. Never log payloads or credentials.
            accepted = e.code in (400,413)
        except (OSError, urllib.error.URLError):
            accepted = False
        if accepted:
            with self.db:
                self.db.execute('DELETE FROM pending WHERE id=?',(row[0],))


class Tail:
    def __init__(self, path):
        self.path = path
        self.file = None
        self.buffer = b''
        self.discarding = False
        self.first = True

    def tick(self, detector):
        try:
            stat = os.stat(self.path)
            if self.file is None:
                self.file = open(self.path,'rb')
                if self.first:
                    self.file.seek(0,2)  # do not replay historical traffic as live evidence
                    self.first = False
                detector.complete = False
            current = os.fstat(self.file.fileno())
            if current.st_size < self.file.tell():
                self.file.seek(0)
                self.buffer = b''
                detector.complete = False
            chunk = self.file.read(MAX_READ)
            if len(chunk) == MAX_READ:
                detector.complete = False  # lag means this window cannot establish behavior
            parts = (self.buffer+chunk).split(b'\n')
            self.buffer = parts.pop()
            for part in parts:
                if self.discarding:
                    self.discarding = False
                    continue
                detector.feed(part.decode('utf-8',errors='replace'))
            if len(self.buffer) > MAX_LINE:
                self.buffer = b''
                self.discarding = True
                detector.complete = False
            if not chunk and (stat.st_dev,stat.st_ino) != (current.st_dev,current.st_ino):
                self.file.close()
                self.file = None
                self.buffer = b''
                detector.complete = False
        except OSError:
            detector.complete = False


def send_health(config, health):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    request = urllib.request.Request(config['endpoint'].replace('/signals','/health'),data=json.dumps(health).encode(),
        headers={'Content-Type':'application/json','Authorization':'Bearer '+config['token'],'X-Pikiland-Repo':config['repository']})
    try:
        opener=urllib.request.build_opener(NoRedirect(),urllib.request.HTTPSHandler(context=ssl.create_default_context()))
        with opener.open(request,timeout=3):
            pass
    except (OSError, urllib.error.URLError):
        pass  # bounded best effort; coordinator marks missing heartbeats stale


def main():
    os.umask(0o077)
    with open(sys.argv[1],encoding='utf-8') as f:
        config = validate_config(json.load(f))
    if os.geteuid() == 0:
        raise SystemExit('Run as an unprivileged observer user with existing log read access')
    detector, tail, spool = Detector(config), Tail(config['logPath']), Spool(config['statePath'])
    last_send = last_health = 0
    while True:
        tick = time.monotonic()
        tail.tick(detector)
        now = int(time.time())
        if now-last_health >= 60:
            health = {'observerId':config['observerId'],'parsed':detector.parsed,'rejected':detector.rejected,
                'complete':detector.complete,'pending':spool.db.execute('SELECT count(*) FROM pending').fetchone()[0],
                'dropped':spool.dropped,'capabilities':sorted(detector.capabilities)}
            send_health(config,health)
            last_health = now
        spool.add(detector.flush(now),now)
        if now-last_send >= 10:
            spool.send_one(config)
            last_send = now
        time.sleep(max(0.1,1-(time.monotonic()-tick)))


if __name__ == '__main__':
    main()
