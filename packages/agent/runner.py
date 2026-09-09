from __future__ import annotations
import argparse, json, os, platform, subprocess, time
from pathlib import Path
try:
    import psutil
except ImportError:
    psutil=None

ALLOWED = {
    'python': ['python','-m','pytest'],
    'git': ['git','status','diff','log'],
}

def hardware():
    return {'os':platform.platform(),'cpu':platform.processor() or 'unknown','cores':os.cpu_count(),'ram_gb':round(psutil.virtual_memory().total/2**30,1) if psutil else None}

def safe_command(argv, workspace):
    if not argv or argv[0] not in ALLOWED: raise ValueError('Command is not allowlisted')
    if argv[0]=='python' and len(argv)>=3 and argv[1]=='-m' and argv[2]=='pytest': pass
    elif argv[0]=='git' and len(argv)>=2 and argv[1] in {'status','diff','log'}: pass
    else: raise ValueError('Command is not allowlisted')
    p=subprocess.run(argv,cwd=workspace,text=True,capture_output=True,timeout=300)
    return {'returncode':p.returncode,'stdout':p.stdout[-12000:],'stderr':p.stderr[-12000:]}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--workspace',required=True);args=ap.parse_args()
    root=Path(args.workspace).resolve();root.mkdir(parents=True,exist_ok=True)
    print(json.dumps({'event':'runner_ready','workspace':str(root),'hardware':hardware()}))
    print('Builder Runner is ready. Connect a supervised agent to issue allowlisted operations.')
    while True: time.sleep(60)
if __name__=='__main__': main()
