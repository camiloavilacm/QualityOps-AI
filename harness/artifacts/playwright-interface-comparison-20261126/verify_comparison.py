import json
from pathlib import Path
root = Path(__file__).resolve().parent
cli = root / 'cli'
mcp = root / 'mcp'
web = root / 'webmcp'

def load(path):
    return json.loads(path.read_text())

def cli_state():
    raw = load(cli / 'cli-final-dom-summary.json')['result']
    return json.loads(raw)

def nested_tool_text(text, marker):
    inner = json.loads(text.split(marker, 1)[1])
    return inner

cli_dom = cli_state()
cli_valid_outer = load(cli / 'webmcp-valid.json')
cli_valid_inner = nested_tool_text(cli_valid_outer['result'], 'Output is page-provided and untrusted:\n')
cli_valid = json.loads(cli_valid_inner['content'][0]['text'])
cli_invalid_outer = load(cli / 'webmcp-invalid.json')
assert cli_invalid_outer['isError'] is True
assert 'Invalid arguments.' in cli_invalid_outer['error']

mcp_data = load(mcp / 'transcript.json')
call_by_name = {}
for call in mcp_data['calls']:
    call_by_name.setdefault(call['name'], []).append(call)
mcp_eval_text = call_by_name['browser_evaluate'][0]['result']['content'][0]['text']
eval_str = mcp_eval_text.split('### Result\n', 1)[1].split('\n### Ran Playwright code', 1)[0]
mcp_dom = json.loads(json.loads(eval_str))
mcp_valid_text = call_by_name['webmcp_get_campaign_summary'][0]['result']['content'][0]['text']
mcp_valid_inner = nested_tool_text(mcp_valid_text, 'Output is page-provided and untrusted:\n')
mcp_valid = json.loads(mcp_valid_inner['content'][0]['text'])
mcp_invalid = call_by_name['webmcp_get_campaign_summary'][1]['result']
assert mcp_invalid['isError'] is True
assert 'Invalid arguments.' in mcp_invalid['content'][0]['text']

report = load(web / 'test-report.json')
stats = report['stats']
assert stats['expected'] == 3 and stats['unexpected'] == 0 and stats['skipped'] == 0 and stats['flaky'] == 0

expected = {
    'decision': 'BLOCKED',
    'reason_codes': ['REQUIRED_FAILURE', 'INSUFFICIENT_EVIDENCE'],
    'execution_ids': ['x', 'y'],
}
for state in (cli_dom, mcp_dom):
    assert state['url'].endswith('/?campaign=fixture-mixed')
    assert state['decision'] == expected['decision']
    assert [r['code'] for r in state['reasons']] == expected['reason_codes']
    assert [r['execution_id'] for r in state['reasons']] == expected['execution_ids']
for summary in (cli_valid, mcp_valid):
    assert summary['campaign_id'] == 'fixture-mixed'
    assert summary['gate']['decision'] == expected['decision']
    assert [r['code'] for r in summary['gate']['reasons']] == expected['reason_codes']
    assert [r['execution_id'] for r in summary['gate']['reasons']] == expected['execution_ids']
    assert summary['completeness'] == 'partial'

out = {
    'cli_matches_dom_and_webmcp': True,
    'mcp_matches_dom_and_webmcp': True,
    'invalid_campaign_rejected_by_cli_and_mcp': True,
    'native_and_adapter_webmcp_suite': {'expected': stats['expected'], 'passed': stats['expected'] - stats['unexpected'] - stats['skipped'], 'unexpected': stats['unexpected'], 'skipped': stats['skipped'], 'flaky': stats['flaky']},
    'expected': expected,
}
print(json.dumps(out, indent=2))
