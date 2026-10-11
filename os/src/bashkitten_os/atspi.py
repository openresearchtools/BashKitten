# SPDX-License-Identifier: AGPL-3.0-only
"""Read the owning desktop's AT-SPI application list or selected subtree. No input."""
import argparse,json,sys,time
import gi
gi.require_version('Atspi','2.0')
from gi.repository import Atspi

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation',choices=['list','tree'])
    parser.add_argument('--application',help='Exact application name or its current index')
    parser.add_argument('--path',default='',help='Current child path, e.g. 0/2/1')
    parser.add_argument('--timeout',type=float,default=15)
    parser.add_argument('--output',help='Write complete JSON lines to this chosen file')
    args=parser.parse_args()
    import math
    if not math.isfinite(args.timeout) or args.timeout<=0:parser.error('timeout must be positive and finite')
    deadline=time.monotonic()+args.timeout
    stream=open(args.output,'w',encoding='utf-8') if args.output else sys.stdout
    def emit(value):stream.write(json.dumps(value,ensure_ascii=False)+'\n');stream.flush()
    try:
        Atspi.set_timeout(2000,2000)
        desktop=Atspi.get_desktop(0)
        apps=[desktop.get_child_at_index(i) for i in range(desktop.get_child_count())]
        if args.operation=='list':
            for i,app in enumerate(apps):
                if time.monotonic()>deadline:raise TimeoutError('Inspection deadline reached; output is incomplete')
                emit({'index':i,'name':app.get_name(),'role':app.get_role_name(),'children':app.get_child_count()})
        else:
            if args.application is None:raise RuntimeError('Select an application from list first')
            if args.application.isdigit():
                app=apps[int(args.application)]
            else:
                matches=[app for app in apps if app.get_name()==args.application]
                if len(matches)!=1:raise RuntimeError('Application name is missing or ambiguous; use a fresh list index')
                app=matches[0]
            node=app
            for index in filter(None,args.path.split('/')):node=node.get_child_at_index(int(index))
            stack=[(args.path,node)]
            while stack:
                if time.monotonic()>deadline:raise TimeoutError('Inspection deadline reached; output is incomplete')
                path,node=stack.pop()
                if node is None:continue
                value={'path':path,'name':node.get_name(),'role':node.get_role_name(),
                       'states':[state.value_nick for state in node.get_state_set().get_states()]}
                interfaces=node.get_interfaces()
                if 'Text' in interfaces:
                    text=node.get_text_iface();value['text']=text.get_text(0,text.get_character_count())
                if 'Component' in interfaces:
                    rect=node.get_component_iface().get_extents(Atspi.CoordType.SCREEN)
                    value['bounds']={'x':rect.x,'y':rect.y,'width':rect.width,'height':rect.height}
                count=node.get_child_count();value['children']=count;emit(value)
                for i in reversed(range(count)):stack.append((f'{path}/{i}'.lstrip('/'),node.get_child_at_index(i)))
        emit({'complete':True});return 0
    except Exception as error:
        emit({'complete':False,'error':str(error)});return 1
    finally:
        if stream is not sys.stdout:stream.close()
if __name__=='__main__':sys.exit(main())
