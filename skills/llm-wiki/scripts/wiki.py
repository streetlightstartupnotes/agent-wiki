#!/usr/bin/env python3
"""Local workspace lifecycle, deterministic wiki API, and verified memory bridge."""
import argparse
import errno
import tempfile
import hashlib
from contextlib import contextmanager
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = Path(__file__).resolve().parent
READER = HERE.parents[1] / 'agent-knowledge-reader/scripts/read_knowledge.py'
_OWNED_PROCESSES = {}


def state_path(data):
    return data / '.runtime.json'


def runtime(data):
    info = json.loads(state_path(data).read_text())
    if Path(info.get('data', '')).resolve() != data.resolve():
        raise ValueError('Runtime directory mismatch')
    parsed = urllib.parse.urlparse(info['url'])
    if parsed.hostname != '127.0.0.1' or parsed.scheme != 'http' or not parsed.port:
        raise ValueError('Invalid local runtime URL')
    if isinstance(info.get('pid'), bool) or not isinstance(info.get('pid'), int) or info['pid'] <= 0:
        raise ValueError('Invalid local runtime PID')
    if not isinstance(info.get('token'), str) or not info['token']:
        raise ValueError('Invalid local runtime token')
    return info


def call(data, route, method='GET', body=None, project=None, timeout=180):
    if not route.startswith('/') or route.startswith('//') or '#' in route:
        raise ValueError('Use a relative API route such as /wiki/tree')
    info = runtime(data)
    headers = {'X-LLM-Wiki-Token': info['token']}
    if project:
        headers['X-LLM-Wiki-Project-Uri'] = urllib.parse.quote(str(Path(project).expanduser().resolve()), safe='')
    raw = None
    if body is not None:
        raw = json.dumps(body, ensure_ascii=False).encode()
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(info['url'] + '/api/wiki' + route, data=raw, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        raise ValueError(f'HTTP {exc.code}: {exc.read().decode()}') from exc


def reader(kb, task, view=None, sufficient=False):
    cmd = [sys.executable, str(READER), 'query', '--task', task]
    if sufficient:
        cmd += ['--context-sufficient']
    else:
        cmd += ['--kb', str(kb), '--emit-content', '--base-context', 'none']
        if view:
            cmd += ['--view', view]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode:
        raise ValueError(result.stderr.strip() or result.stdout.strip() or 'Reader rejected this library')
    payload = json.loads(result.stdout)
    return payload


@contextmanager
def runtime_lock(data):
    data.mkdir(parents=True,exist_ok=True,mode=0o700)
    with open(data/'.lifecycle.lock','a+b') as stream:
        if os.name=='nt':
            import msvcrt
            stream.seek(0);stream.write(b'0');stream.flush();stream.seek(0)
            msvcrt.locking(stream.fileno(),msvcrt.LK_LOCK,1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(),fcntl.LOCK_EX)
        try:yield
        finally:
            if os.name=='nt':
                stream.seek(0);msvcrt.locking(stream.fileno(),msvcrt.LK_UNLCK,1)
            else:fcntl.flock(stream.fileno(),fcntl.LOCK_UN)


def runtime_fingerprint():
    digest=hashlib.sha256()
    digest.update(str(HERE.resolve()).encode())
    for path in [HERE/'server.rb',HERE/'../assets/workspace/package.json',*sorted((HERE/'../assets/workspace/api').resolve().rglob('*.rb'))]:
        digest.update(path.name.encode());digest.update(path.read_bytes())
    return digest.hexdigest()


def process_running(pid):
    """Check liveness without ever sending a terminating signal to an unknown PID."""
    child = _OWNED_PROCESSES.get(pid)
    if child is not None:
        if child.poll() is None:
            return True
        _OWNED_PROCESSES.pop(pid, None)
        return False
    if os.name == 'nt':
        # os.kill(pid, 0) is not a portable Windows liveness probe.
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.OpenProcess(0x100000, False, pid)  # SYNCHRONIZE only
        if not handle:
            if ctypes.get_last_error() == 87:  # ERROR_INVALID_PARAMETER: no such PID
                return False
            raise ValueError('Cannot verify the saved process; runtime receipt was preserved')
        try:
            status = kernel.WaitForSingleObject(handle, 0)
            if status == 0:
                return False
            if status == 258:
                return True
            raise ValueError('Cannot verify the saved process; runtime receipt was preserved')
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def probe_runtime(data, info, timeout=2):
    """Return authenticated identity, or None only for a confirmed exited process."""
    request = urllib.request.Request(
        info['url'] + '/api/wiki/health',
        headers={'X-LLM-Wiki-Token': info['token']},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            identity = json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            raise ValueError('The existing workspace predates the identity health check. Stop it using its original launcher, then retry; no process was replaced.') from error
        raise ValueError('Existing workspace identity could not be verified; runtime receipt was preserved') from error
    except (urllib.error.URLError, OSError) as error:
        reason = error.reason if isinstance(error, urllib.error.URLError) else error
        refused = isinstance(reason, ConnectionRefusedError) or getattr(reason, 'errno', None) == errno.ECONNREFUSED
        if refused and not process_running(info['pid']):
            return None
        # A busy or unreachable listener is not proof that its process exited.
        raise ValueError('Existing workspace is busy or unreachable; no replacement was started and its receipt was preserved. Retry after its active operation finishes.') from error
    if not isinstance(identity, dict) or identity.get('pid') != info['pid']:
        raise ValueError('Workspace PID identity mismatch; runtime receipt was preserved')
    if Path(identity.get('data', '')).resolve() != data.resolve():
        raise ValueError('Workspace directory identity mismatch; runtime receipt was preserved')
    if not isinstance(identity.get('fingerprint'), str) or not identity['fingerprint']:
        raise ValueError('Workspace code identity is unavailable; runtime receipt was preserved')
    return identity


def terminate_verified_runtime(info):
    """Called only after /health authenticated this PID and data directory."""
    try:
        os.kill(info['pid'], 15)
    except ProcessLookupError:
        return
    for _ in range(100):
        if not process_running(info['pid']):
            return
        time.sleep(.1)
    raise ValueError('Previous workspace is still stopping; its receipt was preserved. Retry after its active operation finishes.')


def stop_runtime(data):
    with runtime_lock(data):
        if not state_path(data).exists():
            return {'stopped': True, 'already_stopped': True}
        info = runtime(data)
        identity = probe_runtime(data, info)
        if identity is not None:
            terminate_verified_runtime(info)
        # Cooperating start/stop calls share the same lifecycle lock.
        state_path(data).unlink(missing_ok=True)
        return {'stopped': True}


def start_runtime(data):
    with runtime_lock(data):
        data.mkdir(parents=True, exist_ok=True, mode=0o700)
        fingerprint=runtime_fingerprint()
        if state_path(data).exists():
            existing = runtime(data)
            identity = probe_runtime(data, existing)
            if identity is not None:
                if existing.get('fingerprint') == identity['fingerprint'] == fingerprint:
                    return {'running': True, 'launch_url': existing['launch_url']}
                # Only the authenticated /health identity authorizes this PID.
                # Wait for exit, not just a closed listening socket: in-flight
                # operations must finish before another runtime can take over.
                terminate_verified_runtime(existing)
        ruby = shutil.which('ruby')
        if not ruby:
            raise ValueError('Ruby with WEBrick is needed for the visual workspace; no software was installed')
        probe = subprocess.run([ruby, '-rwebrick', '-e', 'exit'], capture_output=True)
        if probe.returncode:
            raise ValueError('WEBrick is unavailable in this Ruby. Install it only with user permission.')
        ready = state_path(data)
        ready.unlink(missing_ok=True)
        with open(data / 'workspace.log', 'ab') as log:
            proc = subprocess.Popen([ruby, str(HERE/'server.rb'), '--data', str(data), '--ready', str(ready), '--fingerprint', fingerprint], stdout=log, stderr=log, start_new_session=True)
        _OWNED_PROCESSES[proc.pid] = proc
        for _ in range(100):
            if proc.poll() is not None:
                raise ValueError('Workspace failed to start; inspect workspace.log')
            if ready.exists():
                try:
                    info = runtime(data)
                    identity = probe_runtime(data, info)
                    if identity is None:
                        raise ValueError('Workspace exited before becoming ready')
                    return {'running': True, 'launch_url': runtime(data)['launch_url'], 'data': str(data)}
                except (OSError, ValueError):
                    pass
            time.sleep(.1)
        proc.terminate()
        raise ValueError('Workspace did not become ready within 10 seconds')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=Path, help='Explicit private application directory')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('start')
    sub.add_parser('status')
    sub.add_parser('stop')
    req = sub.add_parser('api')
    req.add_argument('route')
    req.add_argument('--method', default='GET', choices=['GET', 'POST', 'DELETE'])
    req.add_argument('--body-file', type=Path)
    req.add_argument('--project', type=Path)
    link = sub.add_parser('memory-link')
    link.add_argument('--project', type=Path, required=True)
    link.add_argument('--kb', type=Path, required=True)
    recall = sub.add_parser('recall')
    recall.add_argument('--project', type=Path)
    recall.add_argument('--task', required=True)
    recall.add_argument('--view', choices=['facts', 'current', 'documents'])
    recall.add_argument('--context-sufficient', action='store_true')
    args = parser.parse_args()
    if args.command == 'recall' and args.context_sufficient:
        return reader(None, args.task, sufficient=True)
    if not args.data:
        parser.error('--data is required; choose a private directory first')
    data = args.data.expanduser().resolve()
    if args.command == 'start':
        return start_runtime(data)
    if args.command == 'status':
        return call(data, '/status')
    if args.command == 'stop':
        return stop_runtime(data)
    if args.command == 'api':
        body = json.loads(args.body_file.read_text()) if args.body_file else None
        return call(data, args.route, args.method, body, args.project)
    project = args.project.expanduser().resolve() if args.project else None
    if not project:
        raise ValueError('--project is required')
    # Verify registration/access before reading any memory association.
    call(data, '/wiki/purpose', project=project)
    config = project / '.llm-wiki/session-memory.json'
    if args.command == 'memory-link':
        kb = args.kb.expanduser().resolve()
        result = reader(kb, 'Check library publication integrity')
        config.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode='w',dir=config.parent,delete=False) as stream:
            temp=Path(stream.name)
            json.dump({'version': 1, 'kb': str(kb), 'mode': 'verified-read-only'}, stream)
        temp.chmod(0o600)
        temp.replace(config)
        return {'linked': True, 'mode': 'verified-read-only', 'publication_check': result.get('status')}
    memory = None
    if config.exists():
        kb = Path(json.loads(config.read_text())['kb'])
        memory = reader(kb, args.task, args.view)
    wiki = call(data, '/search?' + urllib.parse.urlencode({'q':args.task, 'limit':8}), project=project)
    return {'wiki': wiki, 'session_memory': memory, 'memory_linked': config.exists(), 'note':'Wiki matches are navigation candidates; open their full pages before making claims. Session memory retains the Reader gates and receipts.'}


if __name__ == '__main__':
    try:
        print(json.dumps(main(), ensure_ascii=False, indent=2))
    except (OSError, ValueError, KeyError) as exc:
        print(json.dumps({'error':str(exc)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
