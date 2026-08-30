export const DASHBOARD_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AgentHub</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background:#f4f6f8; color:#17202a; }
    body { margin:0; }
    main { max-width:1080px; margin:0 auto; padding:32px 20px 64px; }
    header { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-bottom:24px; }
    h1 { margin:0; font-size:30px; letter-spacing:-.03em; }
    .subtle { color:#65717d; font-size:14px; }
    .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; margin-bottom:24px; }
    .card, section { background:#fff; border:1px solid #dce2e7; border-radius:12px; box-shadow:0 4px 16px rgba(24,39,55,.04); }
    .card { padding:18px; }
    .metric { font-size:28px; font-weight:700; margin-top:6px; }
    section { margin-top:16px; overflow:hidden; }
    h2 { font-size:16px; margin:0; padding:16px 18px; border-bottom:1px solid #e7ebee; }
    table { width:100%; border-collapse:collapse; font-size:14px; }
    th,td { text-align:left; padding:12px 18px; border-bottom:1px solid #edf0f2; }
    th { color:#65717d; font-weight:600; background:#fafbfc; }
    .pill { display:inline-flex; border-radius:999px; padding:3px 8px; font-size:12px; background:#e8edf1; }
    .online { color:#086b43; background:#dff6ea; }
    .offline { color:#7a263a; background:#fae3e8; }
    #error { color:#9b1c31; white-space:pre-wrap; }
    @media (max-width:720px) { .wide { display:none; } th,td { padding:10px; } }
  </style>
</head>
<body>
<main>
  <header><div><h1>AgentHub</h1><div class="subtle">局域网 Agent 连接与会话绑定状态</div></div><div id="updated" class="subtle"></div></header>
  <div id="error"></div>
  <div class="cards">
    <div class="card"><div class="subtle">Runner 在线</div><div id="runnerMetric" class="metric">-</div></div>
    <div class="card"><div class="subtle">Agent 在线</div><div id="agentMetric" class="metric">-</div></div>
  </div>
  <section><h2>Runner</h2><table><thead><tr><th>名称</th><th>机器</th><th>状态</th><th class="wide">最后心跳</th></tr></thead><tbody id="runners"></tbody></table></section>
  <section><h2>Agent</h2><table><thead><tr><th>项目 / 角色</th><th>Provider</th><th>权限</th><th>Session</th><th>状态</th></tr></thead><tbody id="agents"></tbody></table></section>
</main>
<script>
  let token = sessionStorage.getItem('agenthub-token') || '';
  function cell(text, className) { const td=document.createElement('td'); td.textContent=String(text); if(className) td.className=className; return td; }
  function pill(text, status) { const span=document.createElement('span'); span.textContent=text; span.className='pill '+(status==='online'?'online':status==='offline'?'offline':''); return span; }
  function rows(targetId, values, render) { const target=document.getElementById(targetId); target.textContent=''; for(const value of values){ target.appendChild(render(value)); } }
  async function load() {
    const headers = token ? { Authorization: 'Bearer '+token } : {};
    let response = await fetch('/api/v1/dashboard', { headers });
    if (response.status === 401) {
      token = window.prompt('请输入 AgentHub Token') || '';
      if (token) sessionStorage.setItem('agenthub-token', token);
      response = await fetch('/api/v1/dashboard', { headers:{ Authorization:'Bearer '+token } });
    }
    if (!response.ok) throw new Error('状态读取失败: HTTP '+response.status);
    const data = await response.json();
    document.getElementById('runnerMetric').textContent=data.status.runners.online+' / '+data.status.runners.total;
    document.getElementById('agentMetric').textContent=data.status.agents.online+' / '+data.status.agents.total;
    document.getElementById('updated').textContent='更新于 '+new Date(data.status.serverTime).toLocaleTimeString();
    rows('runners', data.runners, item => { const tr=document.createElement('tr'); tr.append(cell(item.name)); tr.append(cell(item.machineName)); const s=cell(''); s.append(pill(item.status,item.status)); tr.append(s); tr.append(cell(new Date(item.lastSeenAt).toLocaleString(),'wide')); return tr; });
    rows('agents', data.agents, item => { const tr=document.createElement('tr'); tr.append(cell(item.projectKey+' / '+item.role)); tr.append(cell(item.provider)); tr.append(cell(item.permissionMode)); tr.append(cell(item.sessionBindingStatus)); const s=cell(''); s.append(pill(item.status,item.status)); tr.append(s); return tr; });
    document.getElementById('error').textContent='';
  }
  load().catch(error => document.getElementById('error').textContent=error.message);
  setInterval(() => load().catch(error => document.getElementById('error').textContent=error.message), 5000);
</script>
</body>
</html>`;
