#!/usr/bin/env python3
"""Codex stdio MCP adapter with native MCP Apps workspace resources."""
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.parse
import urllib.request
import wiki

RESOURCE='ui://llm-wiki/workspace-v1.html'
DATA=None
READ_ROUTES=['/folders','/status','/projects','/global-project','/wiki/tree','/wiki/page','/wiki/index','/wiki/schema','/wiki/purpose','/sources','/ingest/status','/graph','/graph/config','/graph/related','/graph/communities','/graph/insights','/search','/lint','/review','/sidebar/order','/trash','/settings','/research/tasks','/memory/status']
WRITE_ROUTES=['/projects','/projects/open-existing','/global-project','/wiki/page','/wiki/page/metadata','/wiki/page/move','/wiki/asset','/wiki/schema','/wiki/purpose','/sidebar/reorder','/sidebar/move','/sources/upload','/sources/clip','/sources','/ingest/complete','/graph/config','/graph/config/type','/review/items','/review/resolve','/activity','/trash/restore','/settings','/projects/recover','/recovery/config','/memory/link','/research/tasks']
WORKSPACE_ROUTES={'/folders','/status','/projects','/projects/open-existing','/projects/recover','/global-project','/settings','/recovery/config'}


def schema(properties,required=()):
    return {'type':'object','properties':properties,'required':list(required),'additionalProperties':False}
S={'type':'string'}
def tool(name,description,properties,required=(),read=True,ui=False):
    item={'name':name,'description':description,'inputSchema':schema(properties,required),'annotations':{'readOnlyHint':read,'destructiveHint':not read,'openWorldHint':False,'idempotentHint':read}}
    if ui:
        item['title']='Agent wiki'
        item['_meta']={'ui':{'resourceUri':RESOURCE},'openai/ui':{'entrypoints':[{'type':'global'},{'type':'thread'}]}}
    return item
TOOLS=[
 tool('wiki_open','Open Agent wiki, the native notes and knowledge workspace in Codex. With data_directory, initialize the user-selected private application directory. With no directory, show setup or the already configured workspace.',{'data_directory':S},read=False,ui=True),
 tool('wiki_search','Find notes in the explicitly selected Agent wiki library. Use for questions such as what do my notes say about this topic. Returns candidates, not evidence: read the matching full pages and their cited sources before answering. Never searches other libraries or private session history.',{'project':{'type':'string','description':'Absolute path of the explicitly selected library.'},'query':{'type':'string','description':'Specific topic or phrase to find; not blank.'},'limit':{'type':'integer','minimum':1,'maximum':30}},['project','query']),
 tool('wiki_read','Read deterministic wiki data. Search returns candidates; fetch full pages before citing. Pass an explicitly opened project for library data, including the resolved global project. Query is an object encoded by this tool.',{'route':{'type':'string','enum':READ_ROUTES},'project':S,'query':{'type':'object'}},['route']),
 tool('wiki_write','Apply an authorized wiki edit, import, move, source upload, or recoverable delete. Pass project explicitly for library edits. Supply current revision for page updates; conflicts must be reread. Never mutate generated session evidence.',{'route':{'type':'string','enum':WRITE_ROUTES},'project':S,'method':{'type':'string','enum':['POST','DELETE']},'body':{'type':'object'}},['route','body'],read=False),
 tool('wiki_recall','Retrieve a missing fact from an opened wiki and its linked verified session library. Does not read personal history when context_sufficient is true.',{'project':S,'task':S,'view':{'type':'string','enum':['facts','current','documents']},'context_sufficient':{'type':'boolean'}},['task']),
 tool('wiki_link_memory','Connect a user-approved verified session evidence directory to an opened wiki. Validates through Reader, writes only a local association, and never changes generated evidence.',{'project':S,'kb':S},['project','kb'],read=False),
 tool('wiki_image_policy','Inspect or configure explicitly allowed HTTPS image origins for this native workspace. Saving updates resource CSP after the panel is reopened.',{'origins':{'type':'array','items':S,'maxItems':20}},read=False),
 tool('wiki_asset','Read a wiki attachment for the editor. Only registered wiki attachment paths are allowed.',{'project':S,'path':S,'offset':{'type':'integer','minimum':0}},['project','path']),
]

for entry in TOOLS:
    if entry['name'] in ['wiki_asset','wiki_image_policy']:entry['_meta']={'ui':{'visibility':['app']}}


def result(payload,error=False):
    return {'content':[{'type':'text','text':json.dumps(payload,ensure_ascii=False)}],'structuredContent':payload,'isError':error}


def load_config():
    config=os.environ.get('LLM_WIKI_CONFIG')
    if not config or not Path(config).is_file():return {}
    value=json.loads(Path(config).read_text())
    if not isinstance(value,dict):raise ValueError('Invalid workspace configuration')
    return value


def save_config(value):
    config=os.environ.get('LLM_WIKI_CONFIG')
    if not config:raise ValueError('Persistent plugin configuration is unavailable in this host')
    target=Path(config);target.parent.mkdir(parents=True,exist_ok=True)
    import tempfile
    with tempfile.NamedTemporaryFile(mode='w',dir=target.parent,delete=False) as stream:
        json.dump(value,stream,ensure_ascii=False);temp=Path(stream.name)
    try:
        temp.chmod(0o600);temp.replace(target)
    finally:
        if temp.exists():temp.unlink()


def update_config(updates):
    config=os.environ.get('LLM_WIKI_CONFIG')
    if not config:raise ValueError('Persistent plugin configuration is unavailable in this host')
    # Multiple Codex conversations may run separate MCP processes. Serialize
    # read/merge/write so choosing storage cannot erase image-origin settings.
    with wiki.runtime_lock(Path(config).parent):
        value=load_config();value.update(updates);save_config(value)
    return value


def image_origins(values):
    if not isinstance(values,list) or len(values)>20:raise ValueError('Use at most 20 HTTPS origins')
    result=[]
    for value in values:
        if not isinstance(value,str):raise ValueError('Each image origin must be a string')
        value=value.strip()
        if any(ord(char)<33 or char in "\\*'\"" for char in value):raise ValueError('Use an exact HTTPS origin without spaces or wildcards')
        parsed=urllib.parse.urlsplit(value)
        if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ['', '/']:
            raise ValueError('Use an HTTPS origin only, such as https://images.example.com')
        try:port=parsed.port
        except ValueError:raise ValueError('Invalid image origin port')
        host=parsed.hostname.encode('idna').decode('ascii').lower()
        import ipaddress,re
        try:
            address=ipaddress.ip_address(host)
            if not address.is_global:raise ValueError('Local/private image origins are unsupported')
            host='['+host+']' if address.version==6 else host
        except ValueError as error:
            if 'unsupported' in str(error):raise
            if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?',host) or '.' not in host or not re.search(r'[a-z]',host.split('.')[-1]) or host.endswith(('.localhost','.local')) or any(not label or len(label)>63 or label.startswith('-') or label.endswith('-') for label in host.split('.')):
                raise ValueError('Use a valid public HTTPS hostname')
        origin='https://'+host+(':'+str(port) if port not in [None,443] else '')
        if origin not in result:result.append(origin)
    return result


def configure(directory):
    global DATA
    if not isinstance(directory,str) or not directory.strip():raise ValueError('Choose an explicit private data directory')
    candidate=Path(directory).expanduser().resolve()
    plugin_root=wiki.HERE.parents[2]
    if candidate==plugin_root or plugin_root in candidate.parents:
        raise ValueError('Choose a private data directory outside the plugin package')
    run=subprocess.run([sys.executable,str(wiki.HERE/'wiki.py'),'--data',str(candidate),'start'],capture_output=True,text=True)
    if run.returncode:raise ValueError(run.stderr.strip())
    DATA=candidate
    if os.environ.get('LLM_WIKI_CONFIG'):
        config=load_config()
        if config.get('data_directory')!=str(candidate):
            update_config({'data_directory':str(candidate)})


def invoke(name,args):
    if 'project' in args and not args['project'].strip():raise ValueError('Choose an explicit nonempty knowledge base path')
    if name=='wiki_image_policy':
        config=load_config()
        if 'origins' in args:
            config=update_config({'image_origins':image_origins(args['origins'])})
        return result({'origins':image_origins(config.get('image_origins',[])),'reopen_required':'origins' in args})
    if name=='wiki_open':
        # Reopening an approved workspace also recovers its stopped companion.
        directory=args['data_directory'] if 'data_directory' in args else (str(DATA) if DATA else load_config().get('data_directory'))
        if directory:configure(directory)
        elif 'data_directory' in args:raise ValueError('Choose an explicit private data directory')
        return result({'needs_setup':DATA is None,'status':wiki.call(DATA,'/status') if DATA else None})
    if name=='wiki_recall' and args.get('context_sufficient'):
        return result(wiki.reader(None,args['task'],sufficient=True))
    if DATA is None:raise ValueError('First call wiki_open with the user-approved private data_directory')
    if name=='wiki_search':
        query=args['query'].strip()
        if not query:raise ValueError('Provide a specific search query')
        return invoke('wiki_read',{'route':'/search','project':args['project'],'query':{'q':query,'limit':args.get('limit',8)}})
    if name in ['wiki_read','wiki_write']:
        route=args['route']
        if route not in WORKSPACE_ROUTES and not args.get('project'):
            raise ValueError('Pass the explicitly selected project; resolve /global-project first when using the default knowledge base')
        if name=='wiki_write' and route=='/memory/link':return invoke('wiki_link_memory',{'project':args['project'],'kb':args['body']['kb']})
        allowed=READ_ROUTES if name=='wiki_read' else WRITE_ROUTES
        if route not in allowed:raise ValueError('Route not allowed for this tool')
        if name=='wiki_read' and args.get('query'):route+='?'+urllib.parse.urlencode(args['query'])
        try:
            return result(wiki.call(DATA,route,'GET' if name=='wiki_read' else args.get('method','POST'),None if name=='wiki_read' else args['body'],args.get('project')))
        except ValueError as error:
            import re
            match=re.search(r'HTTP (\d+)',str(error))
            return result({'error':str(error),'status':int(match[1]) if match else None},True)
    if name in ['wiki_recall','wiki_link_memory']:
        if not args.get('project'):raise ValueError('An explicit project is required for recall')
        command='recall' if name=='wiki_recall' else 'memory-link'
        cmd=[sys.executable,str(wiki.HERE/'wiki.py'),'--data',str(DATA),command,'--project',args['project']]
        if name=='wiki_recall':
            cmd+=['--task',args['task']]
            if args.get('view'):cmd+=['--view',args['view']]
        else:cmd+=['--kb',args['kb']]
        run=subprocess.run(cmd,capture_output=True,text=True)
        if run.returncode:raise ValueError(run.stderr.strip())
        return result(json.loads(run.stdout))
    if name=='wiki_asset':
        data=wiki.call(DATA,'/wiki/asset-chunk?'+urllib.parse.urlencode({'path':args['path'],'offset':args.get('offset',0)}),project=args['project'])
        response=result({'mimeType':data['mimeType'],'total':data['total'],'offset':data['offset'],'nextOffset':data['nextOffset']})
        response['_meta']={'llmWikiAsset':data}
        return response
    raise ValueError('Unknown tool')


def handle(message):
    method=message.get('method');params=message.get('params') or {}
    if method=='initialize':
        return {'protocolVersion':params.get('protocolVersion') if params.get('protocolVersion') in ['2025-06-18','2025-11-25'] else '2025-11-25','serverInfo':{'name':'llm-wiki','version':'0.2.2'},'capabilities':{'tools':{},'resources':{}},'instructions':'Agent wiki is a local knowledge workspace. Use wiki_search for a question about the selected library; use wiki_recall only when a historical fact is missing. Use wiki_open with an explicitly selected private directory before other operations. Read before writing, preserve revision conflicts, and keep verified session evidence separate from editable wiki pages. Native UI clicks use the active host conversation.'}
    if method=='ping':return {}
    if method=='tools/list':return {'tools':TOOLS}
    if method=='tools/call':
        try:
            args=params.get('arguments',{})
            t=next((x for x in TOOLS if x['name']==params['name']),None)
            if t is None:raise ValueError('Unknown tool')
            if not isinstance(args,dict):raise ValueError('arguments must be an object')
            for k in t['inputSchema']['required']:
                if k not in args:raise ValueError('Missing argument: '+k)
            if set(args)-set(t['inputSchema']['properties']):raise ValueError('Unknown argument')
            kinds={'string':str,'object':dict,'boolean':bool,'integer':int,'array':list}
            for key,value in args.items():
                definition=t['inputSchema']['properties'][key]
                if not isinstance(value,kinds[definition['type']]):raise ValueError('Invalid type: '+key)
                if definition['type']=='integer' and (isinstance(value,bool) or value<definition.get('minimum',value) or value>definition.get('maximum',value)):raise ValueError('Invalid value: '+key)
                if definition['type']=='array' and (len(value)>definition.get('maxItems',100) or any(not isinstance(item,str) for item in value)):raise ValueError('Invalid list: '+key)
                if 'enum' in definition and value not in definition['enum']:raise ValueError('Invalid value: '+key)
            return invoke(params['name'],args)
        except Exception as e:return result({'error':str(e)},True)
    if method=='resources/list':return {'resources':[{'uri':RESOURCE,'name':'Agent wiki','mimeType':'text/html;profile=mcp-app'}]}
    if method=='resources/read':
        if params.get('uri')!=RESOURCE:raise ValueError('Unknown resource')
        code=(wiki.HERE/'../assets/workspace/panels/wiki-app/view.js').resolve().read_text().replace('</script','<\\/script')
        html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent wiki</title><style>html,body,#root{margin:0;height:100%;}.llm-wiki-root{height:100vh!important}</style></head><body><div id="root"></div><script>'+code+'</script></body></html>'
        return {'contents':[{'uri':RESOURCE,'mimeType':'text/html;profile=mcp-app','text':html,'_meta':{'ui':{'prefersBorder':False,'csp':{'connectDomains':[],'resourceDomains':image_origins(load_config().get('image_origins',[]))}},'openai/ui':{'availableDisplayModes':['inline','fullscreen']}}}]}
    raise ValueError('Unsupported method')


def main():
    for line in sys.stdin:
        message=None
        try:
            if len(line)>40*1024*1024:raise ValueError('Message too large')
            message=json.loads(line)
            if 'id' not in message:continue
            reply={'jsonrpc':'2.0','id':message['id'],'result':handle(message)}
        except Exception as e:
            reply={'jsonrpc':'2.0','id':message.get('id') if isinstance(message,dict) else None,'error':{'code':-32603,'message':str(e)}}
        print(json.dumps(reply,ensure_ascii=False),flush=True)

if __name__=='__main__':main()
