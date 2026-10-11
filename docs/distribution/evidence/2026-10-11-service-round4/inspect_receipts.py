"""Read-only, candidate-bound inspection of the retained exact482 service evidence."""
import hashlib
import json
import subprocess
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent
repo = root.parents[3]
sha = '482e95cbaed55be6e4f01916b0095c77979d2fdc'
source = 'b82c37c4fb9a3e18d1cb222c6d56d3fef852096f'
load = lambda path: json.loads(path.read_bytes())
hash_bytes = lambda data: hashlib.sha256(data).hexdigest()
inventory = load(root / 'inventory.json')
api = load(root / 'artifacts-api.json.raw')['artifacts'][0]
run = load(root / 'run-api.json.raw')
job = load(root / 'job-api.json.raw')
assert run['id'] == 38135977321 and run['head_sha'] == sha
assert run['status'] == 'completed' and run['conclusion'] == 'success'
assert job['id'] == 114459805179 and job['head_sha'] == sha
assert job['status'] == 'completed' and job['conclusion'] == 'success'
assert all(step['conclusion'] == 'success' for step in job['steps'])
assert api['id'] == 11700339615 and api['workflow_run']['head_sha'] == sha
archive_hash = hash_bytes((root / 'artifact.zip').read_bytes())
assert 'sha256:' + archive_hash == api['digest']
assert archive_hash == inventory['archiveSha256']
with zipfile.ZipFile(root / 'artifact.zip') as archive:
    names = {item.filename for item in archive.infolist() if not item.is_dir()}
    assert names == {item['archivePath'] for item in inventory['files']}
    assert len(names) == 94
    for item in inventory['files']:
        data = archive.read(item['archivePath'])
        assert data == (root / item['retainedPath']).read_bytes()
        assert len(data) == item['bytes'] and hash_bytes(data) == item['sha256']

raw = root / 'raw'
main = load(raw / 'receipt.json.raw')
assert main['passed'] is True and main['cleanup'] is True
assert main['survivors'] == []
assert len(main['retainedDefinitionBackups']) == 2 and len(main['retainedBackupNames']) == 1
assert any(backup['sha256'] == hash_bytes(main['workerDefinition'].encode())
           for backup in main['retainedDefinitionBackups'])
assert len(main['assertions']) == 7
assert main['crashBackoffMs'] >= 9000
exhaustion = main['exhaustion']
p = exhaustion['properties']
assert p['ActiveState'] == 'failed' and p['SubState'] == 'failed'
assert p['MainPID'] == '0' and p['ControlPID'] == '0' and p['Job'] in ['', '0']
assert p['StartLimitBurst'] == '3' and p['StartLimitIntervalUSec'] == '2min'
assert p['RestartUSec'] == '10s' and int(p['NRestarts']) >= 3
assert exhaustion['stableMs'] > 10000
assert any(event.get('USER_UNIT', event.get('_SYSTEMD_USER_UNIT')) == exhaustion['unit']
           and 'Start request repeated too quickly.' in event.get('MESSAGE', '')
           for event in map(json.loads, exhaustion['journal'].splitlines()))
helper_fields = {'harnessSha256': 'linux-user-service.mjs',
                 'protocolSha256': 'service-protocol.mjs',
                 'commandHarnessSha256': 'owned-command.mjs',
                 'cleanupHarnessSha256': 'owned-cleanup.mjs'}
helpers = {filename: main[field] for field, filename in helper_fields.items()}
helpers.update(main['ownershipHelperSha256'])
for filename, expected in helpers.items():
    data = subprocess.check_output(['git', 'show', f'{sha}:docs/distribution/acceptance/{filename}'], cwd=repo)
    assert hash_bytes(data) == expected

matrix = load(raw / 'cancellation-matrix.json.raw')
expected_cases = {(phase, signal, False) for phase in ['initial-install', 'manager-mutation', 'healthy-managed-fixture']
                  for signal in ['SIGINT', 'SIGTERM']}
expected_cases.add(('manager-mutation', 'SIGTERM', True))
assert {(x['phase'], x['signal'], x['outerTimeout']) for x in matrix} == expected_cases
summary = []
receipts = [main]
for outcome in matrix:
    phase, signal, outer = outcome['phase'], outcome['signal'], outcome['outerTimeout']
    name = f"cancel-{phase}-{'outer-timeout' if outer else signal}.json.raw"
    receipt = load(raw / name)
    receipts.append(receipt)
    assert outcome['passed'] is True
    assert outcome['status'] == (130 if signal == 'SIGINT' else 143)
    assert not outcome.get('commandCleanupError') and not outcome.get('cleanupError')
    assert receipt['passed'] is False and receipt['cleanup'] is True
    assert receipt['survivors'] == [] and receipt['retainedDefinitionBackups'] == []
    assert receipt['retainedBackupNames'] == []
    assert receipt['interrupted'] == signal and receipt['interruptPhase'] == phase
    assert not receipt.get('cleanupError') and not receipt.get('outerCleanupErrors')
    if phase != 'healthy-managed-fixture':
        assert receipt['lateMutation'] is False
        boundary = json.loads(receipt['managerBoundary'])
        assert boundary[0] == '--user'
        assert boundary[1] == ('daemon-reload' if phase == 'initial-install' else 'start')
        if phase == 'manager-mutation':
            assert boundary[2].endswith('.service')
            assert f"({boundary[2].removesuffix('.service')})" in receipt['workerDefinition']
    if outer:
        assert receipt['outerTimedOut'] is True
        assert 'Command timed out:' in receipt['outerError']
        assert 'Command timed out:' in outcome['commandError']
    summary.append({'receipt': name, 'status': outcome['status'], 'phase': phase,
                    'signal': signal, 'outerTimeout': outer, 'cleanup': True, 'survivors': []})
for receipt in receipts:
    assert receipt['harnessSha'] == sha and receipt['source'] == source
    for field in helper_fields:
        assert receipt[field] == main[field]
    assert receipt['ownershipHelperSha256'] == main['ownershipHelperSha256']
    for filename in receipt['diagnostics']:
        assert (raw / (filename + '.raw')).is_file()
log = (root / 'job.log.raw').read_text()
assert '"candidateDigest":"ca323a599f606523965d996ff871eeee784d7f5a419ce9158675077b3e4e43ec"' in log
assert '"archiveSha256":"d75afb47d49de95e87832c9eb987277375de8d112d794e041534883dda7b6c62"' in log
print(json.dumps({'harnessSha': sha, 'runtimeSource': source, 'runId': run['id'], 'jobId': job['id'],
                  'artifactId': api['id'], 'archiveSha256': archive_hash, 'originalFiles': len(names),
                  'main': {'passed': True, 'cleanup': True, 'survivors': [],
                           'assertions': main['assertions'], 'crashBackoffMs': main['crashBackoffMs'],
                           'exhaustion': {k: v for k, v in exhaustion.items() if k != 'journal'}},
                  'helpers': helpers, 'cases': summary}, indent=2))
