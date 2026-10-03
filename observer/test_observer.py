import json
import os
import tempfile
import unittest
from unittest.mock import patch
from observer import Detector, Spool, Tail, parse_line, validate_config

CONFIG={'endpoint':'https://example.com/api/production/signals','repository':'owner/repo','token':'safe-token-12345678','observerId':'web-1','service':'nginx','logPath':'/var/log/nginx/access.log','statePath':'/tmp/spool.sqlite','routes':[]}
def line(status=200,size=123,method='GET',target='/search?token=SECRET'):
    return f'192.0.2.1 - alice [02/Oct/2026:10:00:00 +0900] "{method} {target} HTTP/1.1" {status} {size} "https://secret.example/" "private-agent"'
def window(d,t,status=200,size=123,method='GET'):
    for _ in range(100):d.feed(line(status,size,method))
    return d.flush(t)
class ObserverTest(unittest.TestCase):
    def test_combined_common_and_json(self):
        self.assertEqual(parse_line(line())['path'],'/search')
        self.assertEqual(parse_line(line().split(' "https:')[0])['status'],200)
        self.assertEqual(parse_line(json.dumps({'request_method':'GET','uri':'/x?a=b','status':200,'body_bytes_sent':1,'request_time':'0.15'}))['durationMs'],150)
        self.assertIsNone(parse_line('ERROR access token is secret'))
        self.assertIsNone(parse_line('x'*20000))
    def test_200_behavior_without_error_tag_and_no_raw_export(self):
        d=Detector(CONFIG,0)
        for t in range(60,481,60):self.assertEqual(window(d,t),[])
        self.assertEqual(window(d,540,size=0),[])
        signals=window(d,600,size=0)
        self.assertEqual(signals[0]['ruleId'],'empty_response_shift')
        payload=json.dumps(signals)
        for secret in ['SECRET','192.0.2.1','alice','/search','private-agent']:self.assertNotIn(secret,payload)
    def test_startup_low_traffic_and_missing_windows_do_not_confirm(self):
        d=Detector(CONFIG,0)
        self.assertEqual(window(d,60,500),[])
        self.assertEqual(window(d,120,500),[])
        self.assertEqual(d.flush(180),[])
        self.assertEqual(window(d,240,500),[])
        self.assertEqual(window(d,300,500)[0]['ruleId'],'http_5xx')
    def test_head_and_no_content_not_empty_failure(self):
        d=Detector(CONFIG,0)
        for t in range(60,600,60):self.assertEqual(window(d,t,200,0,'HEAD'),[])
    def test_gap_or_invalid_format_suppresses_and_resets_baseline(self):
        d=Detector(CONFIG,0)
        window(d,60);window(d,120,500)
        d.feed('not an access log')
        self.assertEqual(window(d,180,500),[])
        self.assertEqual(window(d,240,500),[])
    def test_explicit_contract_and_missing_timing(self):
        cfg={**CONFIG,'routes':[{'path':'/search','label':'search','statuses':[200],'minBytes':1}]}
        d=Detector(cfg,0)
        window(d,60);window(d,120,size=0)
        self.assertEqual(window(d,180,size=0)[0]['ruleId'],'response_contract')
        d=Detector({**CONFIG,'routes':[{'path':'/search','label':'search','maxDurationMs':100}]},0)
        for t in range(60,600,60):self.assertEqual(window(d,t),[])
    def test_spool_survives_restart_and_bounded(self):
        with tempfile.TemporaryDirectory() as temp:
            p=os.path.join(temp,'state.sqlite');s=Spool(p)
            s.add([{'signalId':str(i)} for i in range(300)],100)
            self.assertEqual(s.db.execute('select count(*) from pending').fetchone()[0],256)
            s.db.close();s=Spool(p)
            self.assertEqual(s.db.execute('select count(*) from pending').fetchone()[0],256)
            s.add([],90000)
            self.assertEqual(s.db.execute('select count(*) from pending').fetchone()[0],0)
            s.db.close()
    def test_tail_skips_history_handles_append_and_rotation(self):
        with tempfile.TemporaryDirectory() as temp:
            p=os.path.join(temp,'access.log')
            with open(p,'w') as f:f.write(line()+'\n')
            d=Detector(CONFIG,0);tail=Tail(p);tail.tick(d)
            self.assertEqual(d.parsed,0)
            with open(p,'a') as f:f.write(line()+'\n')
            tail.tick(d);self.assertEqual(d.parsed,1)
            os.rename(p,p+'.1')
            with open(p,'w') as f:f.write(line()+'\n')
            tail.tick(d);tail.tick(d);self.assertEqual(d.parsed,2)
            tail.file.close()
    def test_invalid_configuration_rejected(self):
        for change in [{'endpoint':'http://example.com/api/production/signals'},{'endpoint':'https://a:b@example.com/api/production/signals'},{'observerId':'private\nvalue'}]:
            with self.assertRaises(ValueError):validate_config({**CONFIG,**change})
    def test_sender_checks_https_and_keeps_unacknowledged_candidate(self):
        with tempfile.TemporaryDirectory() as temp:
            s=Spool(os.path.join(temp,'state.sqlite'));s.add([{'signalId':'a'}],100)
            with patch('urllib.request.OpenerDirector.open',side_effect=OSError('offline')):s.send_one(CONFIG)
            self.assertEqual(s.db.execute('select count(*) from pending').fetchone()[0],1)
            s.db.close()
if __name__=='__main__':unittest.main()
