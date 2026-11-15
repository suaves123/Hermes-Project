"""Run reproducible browser checks with isolated test data. Requires PHP, Node, Playwright, Chromium, and Python API dependencies."""
from pathlib import Path
import json, os, subprocess, sys, time, urllib.request, tempfile, math
from datetime import datetime, timedelta, timezone
root=Path(__file__).resolve().parents[1]
php=os.getenv('PHP_EXE', 'php')
qa=Path(os.getenv('HERMES_QA_DIR', str(root/'test-results')));qa.mkdir(parents=True,exist_ok=True)
env=dict(os.environ,HERMES_QA_DIR=str(qa),HERMES_API_URL='http://127.0.0.1:8000',HERMES_API_KEY='hermes-local-demo-key')
servers=[]

def get(url, body=None, key=False):
 headers={'Content-Type':'application/json'}
 if key: headers['X-API-Key']='hermes-local-demo-key'
 req=urllib.request.Request(url, data=json.dumps(body).encode() if body else None, headers=headers)
 with urllib.request.urlopen(req,timeout=20) as r:return json.load(r)

def start(cmd, name, extra=None):
 f=open(qa/(name+'.log'),'w');p=subprocess.Popen(cmd,cwd=root,env=dict(env,**(extra or {})),stdout=f,stderr=subprocess.STDOUT);servers.append((p,f));return p

try:
 with tempfile.TemporaryDirectory(prefix='hermes-test-') as folder:
  storage=Path(folder)/'storage';storage.mkdir()
  p=start([php,'-n','-S','127.0.0.1:8080','-t','web'],'php-local',{'HERMES_STORAGE_DIR':str(storage),'HERMES_DATA_SOURCE':'local'})
  for attempt in range(50):
   try: first=get('http://127.0.0.1:8080/data.php?astro=1');break
   except Exception:time.sleep(.1)
  else:raise RuntimeError('PHP did not start')
  assert first['apiOnline'],first
  now=datetime.now(timezone.utc)
  # A reproducible historical fixture tests more than one transfer page without a 40-minute wait.
  records=[]
  for i in range(2205):
   row=dict(first['record'],id=100000+i,recorded_at=(now-timedelta(seconds=2400-i)).strftime('%Y-%m-%d %H:%M:%S'),heart_rate=70+round(math.sin(i/20)*5,2),steps=4000+i,calories=1000+i)
   records.append(row)
  files={}
  for row in records:
   path=storage/'history'/('crew-1-'+row['recorded_at'][:10]+'.jsonl');files.setdefault(path,[]).append(row)
  for path,rows in files.items():
   existing=path.read_text() if path.exists() else ''
   path.write_text(''.join(json.dumps(r)+'\n' for r in rows)+existing)
  hist=get('http://127.0.0.1:8080/history.php?astro=1&limit=1000')
  assert len(hist['records'])==1000 and hist['has_more'],hist.keys()
  seen=[];before=None
  while True:
   data=get('http://127.0.0.1:8080/history.php?astro=1&limit=1000'+('&before_id='+str(before) if before else ''))
   seen+=data['records']
   if not data['has_more']:break
   before=data['next_before_id']
  assert len(seen)>=2206 and len({r['id'] for r in seen})==len(seen)
  assert all(len(r)>=30 for r in seen)
  r=get('http://127.0.0.1:8080/data.php?astro=1',{'scenario':'4'})
  assert r['scenario']=='4' and r['scenarioResult']['ok'],r
  assert 'Critically' in json.dumps(r['html']) or 'Scenario' in json.dumps(r['html'])
  # Restart the actual PHP process and verify old history remains available.
  p.terminate();p.wait(timeout=10)
  start([php,'-n','-S','127.0.0.1:8080','-t','web'],'php-local-restart',{'HERMES_STORAGE_DIR':str(storage),'HERMES_DATA_SOURCE':'local'})
  time.sleep(.3)
  assert get('http://127.0.0.1:8080/history.php?astro=1&after_id=99999&before_id=100002')['records']
  start([sys.executable,'-m','uvicorn','server.api:app','--host','127.0.0.1','--port','8000'],'api',{'HERMES_DB_PATH':str(Path(folder)/'api.db')})
  for attempt in range(50):
   try:get('http://127.0.0.1:8000/health');break
   except Exception:time.sleep(.1)
  else:raise RuntimeError('API did not start')
  # Match the real generator schema: integer fields stay integers.
  for i in range(0,len(records),100):
   reply=get('http://127.0.0.1:8000/api/telemetry/batch',{'source':'browser-fixture','records':records[i:i+100]},True)
   assert reply['inserted']==len(records[i:i+100])
  crew2=dict(records[0],astronaut_id=2,id=999999)
  get('http://127.0.0.1:8000/api/telemetry/batch',{'source':'browser-fixture','records':[crew2]},True)
  start([php,'-n','-S','127.0.0.1:8081','-t','web'],'php-api',{'HERMES_DATA_SOURCE':'api'})
  time.sleep(.3)
  assert get('http://127.0.0.1:8081/data.php?astro=1')['apiOnline']
  subprocess.run(['node','tests/browser.cjs'],cwd=root,env=env,check=True)
  print('All backend and browser checks passed.',flush=True)
finally:
 for p,f in servers:
  if p.poll() is None:p.terminate()
 for p,f in servers:
  try:p.wait(timeout=10)
  except subprocess.TimeoutExpired:p.kill()
  f.close()
