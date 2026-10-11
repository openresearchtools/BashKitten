# SPDX-License-Identifier: AGPL-3.0-only
"""Run one command against the current desktop generation supplied by its owner."""
import argparse,json,os,signal,stat,subprocess,sys
from pathlib import Path

def context():
    path=os.environ.get('BASHKITTEN_DESKTOP_CONTEXT')
    if not path:raise RuntimeError('The owning desktop has no context; start Display first')
    source=Path(path);info=source.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or info.st_mode & 0o077:
        raise RuntimeError('Desktop context is not a private owner-created regular file')
    data=json.loads(source.read_text())
    if not data.get('generation') or not isinstance(data.get('ownerPid'),int) or data['ownerPid']<=0:
        raise RuntimeError('Desktop context lacks its generation or owner')
    os.kill(data['ownerPid'],0)
    if data.get('ownerStartTime'):
        actual=Path(f"/proc/{data['ownerPid']}/stat").read_text().rsplit(') ',1)[1].split()[19]
        if actual!=str(data['ownerStartTime']):raise RuntimeError('Desktop context belongs to an expired process')
    env=data.get('environment',{})
    if not isinstance(env,dict) or not all(isinstance(env.get(k),str) and env[k] for k in ('DISPLAY','DBUS_SESSION_BUS_ADDRESS')):
        raise RuntimeError('The owning desktop or accessibility bus is unavailable')
    current=os.environ.copy()
    # Never retain a prior desktop's authentication or session bus.
    for key in ('DISPLAY','XAUTHORITY','DBUS_SESSION_BUS_ADDRESS','AT_SPI_BUS_ADDRESS','SESSION_MANAGER'):
        current.pop(key,None)
        if key in env:
            if not isinstance(env[key],str) or '\0' in env[key]:raise RuntimeError('Invalid desktop environment')
            current[key]=env[key]
    return data,current

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--timeout',type=float,default=30)
    parser.add_argument('--status',action='store_true')
    parser.add_argument('command',nargs=argparse.REMAINDER)
    args=parser.parse_args()
    import math
    if not math.isfinite(args.timeout) or args.timeout<=0:parser.error('timeout must be positive and finite')
    try:
        data,env=context()
        if args.status:
            print(json.dumps({'generation':data['generation'],'running':True,'display':env['DISPLAY']}));return 0
        command=args.command[1:] if args.command[:1]==['--'] else args.command
        if not command:parser.error('a command is required')
        process=subprocess.Popen(command,env=env,start_new_session=True)
        try:return process.wait(timeout=args.timeout)
        except (subprocess.TimeoutExpired,KeyboardInterrupt):
            os.killpg(process.pid,signal.SIGTERM)
            try:process.wait(timeout=2)
            except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
            print('Desktop operation cancelled or timed out; verify state before another operation',file=sys.stderr);return 124
    except (OSError,ValueError,RuntimeError) as error:
        print(str(error),file=sys.stderr);return 1
if __name__=='__main__':sys.exit(main())
