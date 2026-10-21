import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function present(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'ESRCH' ? false : null; }
}

// Read-only OS observation. A PID alone never proves session identity.
export function observeProcesses(pids) {
  const result = new Map(), pending = [];
  for (const pid of new Set(pids)) {
    if (!Number.isInteger(pid) || pid < 1) { result.set(pid, { status: 'unknown', reason: '进程编号无效' }); continue; }
    const exists = present(pid);
    if (exists === false) result.set(pid, { status: 'stopped', reason: '记录的进程已退出' });
    else if (exists === null) result.set(pid, { status: 'unknown', reason: '无法读取进程状态' });
    else pending.push(pid);
  }
  if (!pending.length) return result;
  if (process.platform === 'win32') {
    try {
      const script = `$items=@(Get-Process -Id ${pending.join(',')} -ErrorAction SilentlyContinue | ForEach-Object {try {@{pid=$_.Id;stamp=$_.StartTime.ToUniversalTime().Ticks.ToString()}} catch {@{pid=$_.Id}}});ConvertTo-Json -InputObject $items -Compress`;
      const rows = JSON.parse(execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }).trim() || '[]');
      const records = new Map(rows.map(row => [row.pid, row]));
      for (const pid of pending) {
        const row = records.get(pid);
        result.set(pid, row?.stamp ? { status: 'running', stamp: row.stamp } : !row && present(pid) === false ? { status: 'stopped', reason: '记录的进程已退出' } : { status: 'unknown', reason: '无法核实进程身份' });
      }
    } catch {
      for (const pid of pending) result.set(pid, { status: 'unknown', reason: '进程查询失败或超时' });
    }
  } else {
    for (const pid of pending) {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
        result.set(pid, { status: 'running', stamp: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] });
      } catch { result.set(pid, present(pid) === false ? { status: 'stopped', reason: '记录的进程已退出' } : { status: 'unknown', reason: '无法核实进程身份' }); }
    }
  }
  return result;
}

export function processStartStamp(pid) { return observeProcesses([pid]).get(pid)?.stamp || null; }
