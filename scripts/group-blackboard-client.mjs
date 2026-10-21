const names = { coordinator: ['Coordinator', '协调'], executor: ['Executor', '实现'], validator: ['Validator', '审查'] };
const processNames = { not_started: '未启动', running: '运行中', stopped: '已停止', unknown: '无法确认' };
const lifecycleNames = { ready: '入组已就绪', pending: '等待入组确认', acknowledged: '确认已收齐 · 正在收尾', failed: '入组失败', waiting_for_task: '职责更新待应用' };
const openDefinitions = new Set();
const groups = document.querySelector('#groups'), refreshState = document.querySelector('#refresh-state'), errorBanner = document.querySelector('#error');
let lastSuccess = null;
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function date(value) { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '时间未记录'; }
function badge(text, tone = '') { return el('span', `badge ${tone}`, text); }
function roleCard(role) {
  const card = el('article', 'role'); card.dataset.role = role.role;
  const head = el('div', 'role-head'), heading = el('div', 'role-heading');
  heading.append(el('h3', '', names[role.role]?.[0] || role.role), el('small', '', names[role.role]?.[1] || ''));
  const status = role.process?.status || 'unknown';
  head.append(heading, badge(processNames[status] || '无法确认', status === 'running' ? 'good' : status === 'unknown' ? 'warn' : 'off'));
  card.append(head, el('p', 'model', role.model?.id || '尚无实际运行记录'), el('p', 'provider', role.model?.provider || ''));
  card.append(el('p', 'activity-label', '最近活动 · 模型报告'), el('p', `activity${role.recent_activity ? '' : ' empty'}`, role.recent_activity?.text || '暂无活动报告'));
  if (role.recent_activity) card.append(el('p', 'activity-time', `接收于 ${date(role.recent_activity.at)}`));
  if (status === 'unknown' || role.process?.reason?.includes('复用')) card.append(el('p', 'process-note', role.process.reason));
  if (role.fault) {
    const fault = el('div', 'fault-text'); fault.append(badge('故障记录', 'fault'), el('p', '', role.fault)); card.append(fault);
  }
  return card;
}
export function renderSnapshot(data) {
  if (!data || !Array.isArray(data.groups)) throw Error('快照格式无效');
  const fragment = document.createDocumentFragment();
  for (const group of data.groups) {
    const section = el('article', 'group'); section.dataset.group = group.group_id;
    const head = el('div', 'group-head'), title = el('div'); title.append(el('h2', '', group.name || group.group_id), el('p', 'group-id', group.group_id)); head.append(title);
    const labels = el('div', 'group-labels');
    if (!group.registered) labels.append(badge('配置无效', 'fault'));
    else {
      labels.append(badge('已注册'));
      if (group.archived) labels.append(badge('已归档', 'off'));
      else if (group.role_configuration_current === false) labels.append(badge('角色配置需重新确认', 'warn'));
      else if (group.lifecycle) labels.append(badge(lifecycleNames[group.lifecycle.status] || group.lifecycle.status, group.lifecycle.status === 'ready' ? 'good' : group.lifecycle.status === 'failed' ? 'fault' : 'warn'));
    }
    head.append(labels); section.append(head);
    if (!group.registered) section.append(el('p', 'invalid', group.error || '无法读取小组配置'));
    else {
      const cards = el('div', 'roles');
      for (const role of group.roles || []) cards.append(roleCard(role));
      section.append(cards);
      const details = el('details'), summary = el('summary', '', '查看小组职责');
      details.open = openDefinitions.has(group.group_id);
      details.append(summary, el('p', 'description', group.description || '暂无职责说明'));
      details.addEventListener('toggle', () => { if (!details.isConnected) return; if (details.open) openDefinitions.add(group.group_id); else openDefinitions.delete(group.group_id); });
      section.append(details);
      if (group.lifecycle?.error) section.append(el('p', 'fault-text', group.lifecycle.error));
    }
    fragment.append(section);
  }
  if (!data.groups.length) fragment.append(el('div', 'empty-state', '当前项目尚无已注册小组。'));
  groups.replaceChildren(fragment);
  const count = data.groups.filter(group => group.registered).length;
  document.querySelector('#group-count').textContent = `${count} 个已注册小组${data.groups.length > count ? ` · ${data.groups.length - count} 个配置需检查` : ''}`;
}
export async function refresh() {
  try {
    const response = await fetch('/api/groups', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const data = await response.json(); renderSnapshot(data);
    lastSuccess = data.observed_at || new Date().toISOString();
    refreshState.textContent = `最近刷新 ${date(lastSuccess)} · 自动刷新`;
    errorBanner.hidden = true;
  } catch (error) {
    errorBanner.textContent = `刷新失败（${date(new Date().toISOString())}）：${error.message}。${lastSuccess ? `保留上次数据，成功时间 ${date(lastSuccess)}。` : '尚未取得数据，不能确认小组状态。'}`;
    errorBanner.hidden = false;
    refreshState.textContent = '连接异常 · 将自动重试';
    if (!lastSuccess) document.querySelector('#group-count').textContent = '小组状态暂不可用';
  }
}
async function poll() { await refresh(); setTimeout(poll, 2000); }
poll();
