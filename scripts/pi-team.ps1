[CmdletBinding()]
param([Parameter(Position=0)][string]$Command,[Parameter(Position=1)][string]$Arg1,[Parameter(Position=2)][string]$Arg2,[Parameter(Position=3)][string]$Arg3,[Parameter(Position=4)][string]$Arg4)
$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$StateName = 'pi-team/v1'
$RequiredPackages = [ordered]@{
  'pi-subagents' = '0.56.0'
  'pi-intercom' = '0.11.0'
  'pi-web-access' = '0.24.2'
}
function Fail([string]$Message) { throw $Message }
function Invoke-Native {
  param([Parameter(Position=0)][string]$File,[Parameter(Position=1,ValueFromRemainingArguments=$true)][object[]]$NativeArgs)
  $flatArgs = @()
  foreach ($arg in @($NativeArgs)) { if ($arg -is [array]) { $flatArgs += @($arg) } else { $flatArgs += [string]$arg } }
  & $File @flatArgs
  if ($LASTEXITCODE -ne 0) { Fail "$File failed ($LASTEXITCODE)" }
}
function Git([string[]]$GitArgs) { $x = & git.exe @GitArgs 2>&1; if ($LASTEXITCODE -ne 0) { Fail (($x -join "`n")) }; return (($x -join "`n").Trim()) }
function Get-PiAgentDir {
  if ($env:PI_CODING_AGENT_DIR) { return [IO.Path]::GetFullPath($env:PI_CODING_AGENT_DIR) }
  return Join-Path ([Environment]::GetFolderPath('UserProfile')) '.pi\agent'
}
function Get-PackageSource($Entry) {
  if ($Entry -is [string]) { return [string]$Entry }
  if ($null -ne $Entry -and $null -ne $Entry.source) { return [string]$Entry.source }
  return ''
}
function Get-PackageNameFromSource([string]$Source) {
  if ($Source -match '^npm:(pi-(?:subagents|intercom|web-access))(?:@.*)?$') { return $Matches[1] }
  return ''
}
function Read-UserSettings {
  $path = Join-Path (Get-PiAgentDir) 'settings.json'
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
  try { return Get-Content -Raw -Encoding UTF8 -LiteralPath $path | ConvertFrom-Json } catch { Fail "invalid Pi user settings: $path ($($_.Exception.Message))" }
}
function Test-WebAccessAutoloadDisabled($Settings) {
  if ($null -eq $Settings) { return $false }
  foreach ($entry in @($Settings.packages)) {
    if ((Get-PackageNameFromSource (Get-PackageSource $entry)) -ne 'pi-web-access') { continue }
    if ($entry -is [string]) { return $false }
    return ($entry.PSObject.Properties.Name -contains 'extensions') -and @($entry.extensions).Count -eq 0
  }
  return $false
}
function Get-SetupIssues {
  $issues = @()
  $agentDir = Get-PiAgentDir
  $settings = Read-UserSettings
  foreach ($name in $RequiredPackages.Keys) {
    $expected = $RequiredPackages[$name]
    $manifest = Join-Path $agentDir "npm\node_modules\$name\package.json"
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
      $issues += "missing $name@$expected"
    } else {
      try { $actual = (Get-Content -Raw -Encoding UTF8 -LiteralPath $manifest | ConvertFrom-Json).version } catch { $actual = $null }
      if ($actual -ne $expected) { $issues += "wrong $name version (expected $expected, got $actual)" }
    }
    $expectedSource = "npm:$name@$expected"
    $configured = @($settings.packages | Where-Object { (Get-PackageNameFromSource (Get-PackageSource $_)) -eq $name })
    if ($configured.Count -ne 1 -or (Get-PackageSource $configured[0]) -ne $expectedSource) {
      $issues += "missing exact user registration $expectedSource"
    }
  }
  if (-not (Test-WebAccessAutoloadDisabled $settings)) { $issues += 'pi-web-access user autoload is not disabled' }
  return $issues
}
function Set-WebAccessAutoloadDisabled {
  $agentDir = Get-PiAgentDir
  $path = Join-Path $agentDir 'settings.json'
  $settings = Read-UserSettings
  if ($null -eq $settings) { Fail "Pi did not create user settings: $path" }
  $source = "npm:pi-web-access@$($RequiredPackages['pi-web-access'])"
  $packages = @()
  $inserted = $false
  foreach ($entry in @($settings.packages)) {
    if ((Get-PackageNameFromSource (Get-PackageSource $entry)) -eq 'pi-web-access') {
      if (-not $inserted) { $packages += [pscustomobject][ordered]@{source=$source;extensions=@()}; $inserted = $true }
    } else { $packages += $entry }
  }
  if (-not $inserted) { $packages += [pscustomobject][ordered]@{source=$source;extensions=@()} }
  if ($settings.PSObject.Properties.Name -contains 'packages') { $settings.packages = $packages }
  else { $settings | Add-Member -NotePropertyName packages -NotePropertyValue $packages }
  New-Item -ItemType Directory -Force -Path $agentDir | Out-Null
  $json = $settings | ConvertTo-Json -Depth 50
  [IO.File]::WriteAllText($path, $json, (New-Object Text.UTF8Encoding($false)))
}
function Assert-Setup {
  $issues = @(Get-SetupIssues)
  if ($issues.Count -gt 0) { Fail "Pi shared dependencies are not ready: $($issues -join '; '). Run pi-team.cmd setup." }
  foreach ($path in @(
    (Join-Path $ProjectRoot '.pi/communication/extensions/blackboard-update.ts'),
    (Join-Path $ProjectRoot 'plugins/agent-blackboard/server/blackboard-core.mjs')
  )) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Fail "Pi Team runtime file is missing: $path" }
  }
}
function Setup {
  $pi = if($env:PI_CMD){$env:PI_CMD}else{'pi.cmd'}
  $settings = Read-UserSettings
  $agentDir = Get-PiAgentDir
  foreach ($name in $RequiredPackages.Keys) {
    $version = $RequiredPackages[$name]
    $source = "npm:$name@$version"
    $manifest = Join-Path $agentDir "npm\node_modules\$name\package.json"
    $installed = $false
    if (Test-Path -LiteralPath $manifest -PathType Leaf) {
      try { $installed = ((Get-Content -Raw -Encoding UTF8 -LiteralPath $manifest | ConvertFrom-Json).version -eq $version) } catch { $installed = $false }
    }
    $registered = @($settings.packages | Where-Object { (Get-PackageNameFromSource (Get-PackageSource $_)) -eq $name -and (Get-PackageSource $_) -eq $source }).Count -eq 1
    if (-not ($installed -and $registered)) { Invoke-Native $pi 'install' $source; $settings = Read-UserSettings }
  }
  Set-WebAccessAutoloadDisabled
  $issues = @(Get-SetupIssues)
  if ($issues.Count -gt 0) { Fail "setup verification failed: $($issues -join '; ')" }
  Write-Output "SETUP_OK $agentDir"
}
function Get-CommonDir {
  $p = Git @('-C',$ProjectRoot,'rev-parse','--git-common-dir')
  if (-not [IO.Path]::IsPathRooted($p)) { $p = Join-Path $ProjectRoot $p }
  if (-not (Test-Path -LiteralPath $p -PathType Container)) { Fail "Git common directory is not a directory: $p" }
  return (Resolve-Path -LiteralPath $p).Path
}
function StateRoot {
  $p = Join-Path (Get-CommonDir) $StateName
  if (Test-Path -LiteralPath $p -PathType Leaf) { Fail "Pi Team state root is a file, not a directory: $p" }
  try { New-Item -ItemType Directory -Force -Path $p | Out-Null } catch { Fail "cannot create Pi Team state root: $p ($($_.Exception.Message))" }
  if (-not (Test-Path -LiteralPath $p -PathType Container)) { Fail "Pi Team state root is not a directory: $p" }
  return (Resolve-Path -LiteralPath $p).Path
}
function Read-State([string]$TaskId) { $p = Join-Path (StateRoot) "$TaskId.json"; if (-not (Test-Path -LiteralPath $p)) { Fail "unknown task: $TaskId" }; return Get-Content -Raw -LiteralPath $p | ConvertFrom-Json }
function Write-State($State) { $p = Join-Path (StateRoot) "$($State.task_id).json"; $State | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 -LiteralPath $p }
function New-Id { [guid]::NewGuid().ToString() }
function Parse-Contract([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Fail "contract not found: $Path" }
  $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path
  $blocks = [regex]::Matches($text,'(?ms)```json\s*(.*?)\s*```')
  if ($blocks.Count -ne 1) { Fail 'contract must contain exactly one JSON fenced block' }
  try { $c = $blocks[0].Groups[1].Value | ConvertFrom-Json } catch { Fail "invalid contract JSON: $($_.Exception.Message)" }
  foreach ($n in @('version','task_id','name','description','base_ref','branch','worktree','in_scope','out_of_scope','done_criteria','constraints')) { if ($null -eq $c.$n) { Fail "contract missing field: $n" } }
  if ($c.version -ne 1) { Fail 'contract version must be 1' }
  if ($c.task_id -notmatch '^[A-Z][A-Z0-9]*-[0-9]{3,}$') { Fail 'invalid task ID' }
  if ($c.branch -notmatch '^pi-team/[A-Za-z0-9._/-]+$') { Fail 'invalid branch' }
  if (-not ([IO.Path]::IsPathRooted($c.worktree))) { Fail 'worktree must be absolute' }
  $w = [IO.Path]::GetFullPath($c.worktree); $root = [IO.Path]::GetFullPath($ProjectRoot)
  if ($w.TrimEnd('\') -ieq $root.TrimEnd('\') -or $w -like "$root\*" -or $w -like "$(Get-CommonDir)\*") { Fail 'dangerous worktree path' }
  return $c
}
function Event($State,[string]$Role,[string]$StateName,[string]$Activity,[string]$Blocker,[string]$Next) {
  if ($State.status -ne 'active') { Fail 'task is not active' }
  $seq = 1; $ep = Join-Path (StateRoot) "$($State.task_id)-$Role.jsonl"; if (Test-Path $ep) { $seq = (Get-Content $ep | Measure-Object).Count + 1 }
  [ordered]@{version=1;task_id=$State.task_id;role=$Role;agent_id=$State.sessions.$Role.agent_id;worktree=$State.worktree;sequence=$seq;at=[DateTime]::UtcNow.ToString('o');state=$StateName;activity=$Activity;blocker=$Blocker;next=$Next} | ConvertTo-Json -Compress | Add-Content -Encoding UTF8 -LiteralPath $ep
}
function Validate([string]$Path) { $c = Parse-Contract $Path; Write-Output "VALID $($c.task_id)" }
function Doctor {
  foreach ($x in @('git','pi.cmd','wt.exe','powershell.exe')) { if (-not (Get-Command $x -ErrorAction SilentlyContinue)) { Write-Output "MISSING $x" } else { Write-Output "OK $x" } }
  $s = Get-Content -Raw (Join-Path $ProjectRoot '.pi/settings.json') | ConvertFrom-Json; if ($s.defaultProvider -ne 'minimax-cn' -or $s.defaultModel -ne 'MiniMax-M3') { Write-Output 'MISSING MiniMax configuration' } else { Write-Output 'OK MiniMax configuration' }
  $setupIssues = @(Get-SetupIssues)
  if ($setupIssues.Count -eq 0) { Write-Output 'OK shared Pi dependencies' }
  else { foreach ($issue in $setupIssues) { Write-Output "MISSING $issue" }; Write-Output 'FIX run pi-team.cmd setup' }
  foreach ($r in @('researcher','executor','reviewer')) {
    $rolePath = Join-Path $ProjectRoot ".pi/agents/$r.md"
    if (-not (Test-Path $rolePath)) { Write-Output "MISSING role $r"; continue }
    $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $rolePath
    $isolated = $text -match '(?m)^extensions:\s*$' -and $text -match '(?m)^\s*-\s+~/.pi/agent/npm/node_modules/pi-intercom/index\.ts\s*$'
    if ($r -eq 'researcher') { $isolated = $isolated -and $text -match '(?m)^\s*-\s+~/.pi/agent/npm/node_modules/pi-web-access/index\.ts\s*$' }
    else { $isolated = $isolated -and $text -notmatch 'pi-web-access' }
    if ($isolated) { Write-Output "OK role $r isolation" } else { Write-Output "MISSING role $r isolation" }
  }
}
function Start-RoleProcess([string]$Executable,[string[]]$ArgumentList,[string]$WorkingDirectory,[string]$TaskId,[string]$Role,[string]$AgentId,[string]$Worktree,[string]$ScopeId) {
  $stateRoot = StateRoot
  $identity = [ordered]@{
    PI_TEAM_TASK_ID = $TaskId
    PI_TEAM_ROLE = $Role
    PI_TEAM_AGENT_ID = $AgentId
    PI_TEAM_WORKTREE = $Worktree
    PI_TEAM_STATE_ROOT = $stateRoot
    PI_TEAM_SCOPE_ID = $ScopeId
  }
  $previous = @{}
  foreach ($name in $identity.Keys) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, [string]$identity[$name], 'Process')
  }
  try {
    return Start-Process $Executable -WorkingDirectory $WorkingDirectory -ArgumentList $ArgumentList -WindowStyle Normal -PassThru
  } finally {
    foreach ($name in $identity.Keys) {
      [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
    }
  }
}
function BlackboardRoot { return (Join-Path (Get-CommonDir) 'harness-blackboard/v1') }
function Assert-BlackboardTask($Contract) {
  $path = Join-Path (BlackboardRoot) "$($Contract.task_id).json"
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    Fail "Lead must create Blackboard task $($Contract.task_id) before start"
  }
  try { $task = Get-Content -Raw -Encoding UTF8 -LiteralPath $path | ConvertFrom-Json }
  catch { Fail "invalid Blackboard task state: $path ($($_.Exception.Message))" }
  if ($task.task_id -ne $Contract.task_id) { Fail "Blackboard task identity mismatch: $path" }
  if ($task.status -ne 'active') { Fail "Blackboard task $($Contract.task_id) is not active" }
  return $task
}
function Snapshot-Contract([string]$Path,[string]$TaskId) {
  $directory = Join-Path (StateRoot) 'contracts'
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  $snapshot = Join-Path $directory "$TaskId.md"
  Copy-Item -LiteralPath $Path -Destination $snapshot -Force
  return $snapshot
}
function RoleArguments([string]$Role,[string]$InitialPrompt,[string]$SessionId) {
  $tools = @{
    researcher = 'read,grep,find,ls,write,web_search,fetch_content,get_search_content,source_check,intercom,report_to_lead,blackboard_update'
    executor = 'read,grep,find,ls,bash,edit,write,intercom,report_to_lead,blackboard_update'
    reviewer = 'read,grep,find,ls,bash,edit,write,intercom,report_to_lead,blackboard_update'
  }
  $skills = @{
    researcher = 'answer-research-question'
    executor = 'execute-delegated-task'
    reviewer = 'review-delegated-task'
  }
  if (-not $tools.ContainsKey($Role)) { Fail "unknown Pi Team role: $Role" }
  $roleFile = Join-Path $ProjectRoot ".pi/agents/$Role.md"
  $intercom = Join-Path (Get-PiAgentDir) 'npm/node_modules/pi-intercom/index.ts'
  $roleExtension = Join-Path $ProjectRoot ".pi/communication/extensions/$Role.ts"
  $reportExtension = Join-Path $ProjectRoot '.pi/communication/extensions/report-to-lead.ts'
  $blackboardExtension = Join-Path $ProjectRoot '.pi/communication/extensions/blackboard-update.ts'
  $skill = Join-Path $ProjectRoot ".pi/skills/$($skills[$Role])/SKILL.md"
  $args = @('--approve','--name',$Role,'--no-extensions','--no-skills','--tools',$tools[$Role],'--skill',$skill,'--append-system-prompt',$roleFile,'--extension',$intercom,'--extension',$roleExtension,'--extension',$reportExtension,'--extension',$blackboardExtension)
  if ($Role -eq 'researcher') { $args += @('--extension',(Join-Path (Get-PiAgentDir) 'npm/node_modules/pi-web-access/index.ts')) }
  if ($SessionId) { $args += @('--session-id',$SessionId) }
  if ($InitialPrompt) { $args += $InitialPrompt }
  return $args
}
function Start-Task([string]$Path) {
  Assert-Setup; $c = Parse-Contract $Path; Assert-BlackboardTask $c | Out-Null; $existing = Join-Path (StateRoot) "$($c.task_id).json"; if (Test-Path $existing) { Fail 'task already started' }
  Invoke-Native git.exe @('worktree','add',$c.worktree,$c.branch)
  $contractSnapshot = Snapshot-Contract $Path $c.task_id
  $state = [pscustomobject]@{version=1;task_id=$c.task_id;name=$c.name;description=$c.description;status='active';worktree=$c.worktree;contract_path=$contractSnapshot;scope_id=(New-Id);started_at=[DateTime]::UtcNow.ToString('o');sessions=[pscustomobject]@{executor=[pscustomobject]@{agent_id=(New-Id);session_id=(New-Id);role='executor';process_id=$null;process_started_at=$null};reviewer=[pscustomobject]@{agent_id=(New-Id);session_id=(New-Id);role='reviewer';process_id=$null;process_started_at=$null}}}
  Write-State $state; foreach ($r in @('executor','reviewer')) { Event $state $r 'working' 'task started' '' '' }
  $pi = if ($env:PI_CMD) {$env:PI_CMD} else {'pi.cmd'}; $wt = if ($env:WT_CMD) {$env:WT_CMD} else {'wt.exe'}
  $assignment = "Lead assignment. Task ID: $($c.task_id). Worktree: $($c.worktree). Frozen task contract: $contractSnapshot. Read that exact contract before acting. Objective: $($c.description) Done criteria: $($c.done_criteria -join '; '). Constraints: $($c.constraints -join '; ')."
  $common = @('-d',$c.worktree,$pi) + @(RoleArguments 'executor' "$assignment You are Executor. Perform only the assigned slice and report progress through the configured tools." $state.sessions.executor.session_id)
  $review = @('-d',$c.worktree,$pi) + @(RoleArguments 'reviewer' "$assignment You are Reviewer. Inspect the delegated work as it becomes available and report progress through the configured tools." $state.sessions.reviewer.session_id)
  $executorProc = Start-RoleProcess $wt $common $c.worktree $state.task_id 'executor' $state.sessions.executor.agent_id $state.worktree $state.scope_id
  $reviewerProc = Start-RoleProcess $wt $review $c.worktree $state.task_id 'reviewer' $state.sessions.reviewer.agent_id $state.worktree $state.scope_id
  $state.sessions.executor.process_id=$executorProc.Id; $state.sessions.executor.process_started_at=[DateTime]::UtcNow.ToString('o')
  $state.sessions.reviewer.process_id=$reviewerProc.Id; $state.sessions.reviewer.process_started_at=[DateTime]::UtcNow.ToString('o'); Write-State $state
  Write-Output "STARTED $($c.task_id) scope=$($state.scope_id)"
}
function Status([string]$TaskId) { if ($TaskId) { $s=Read-State $TaskId; $s | ConvertTo-Json -Depth 10; foreach ($r in @('executor','reviewer','researcher')) { $p=Join-Path (StateRoot) "$TaskId-$r.jsonl"; if (Test-Path $p) { Get-Content $p | Select-Object -Last 1 } } } else { Get-ChildItem (StateRoot) -Filter '*.json' | Select-Object -ExpandProperty Name } }
function Sync-Task([string]$Path) { $c=Parse-Contract $Path; $s=Read-State $c.task_id; foreach ($n in @('branch','worktree')) { if ($c.$n -ne $s.$n) { Fail "immutable field changed: $n" } }; $s.name=$c.name; $s.description=$c.description; Write-State $s; Write-Output "SYNCED $($c.task_id)" }
function Research([string]$TaskId,[string]$QuestionId,[string]$QuestionFile) {
  Assert-Setup; $s=Read-State $TaskId
  if (-not (Test-Path $QuestionFile)) { Fail 'question file not found' }
  $out=Join-Path $s.worktree "research/$QuestionId.md"; New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
  $q=Get-Content -Raw -Encoding UTF8 $QuestionFile; $pi=if($env:PI_CMD){$env:PI_CMD}else{'pi.cmd'}
  $researcherId = New-Id
  $assignment = "Lead assignment. Task ID: $($s.task_id). Worktree: $($s.worktree). Research artifact: research/$QuestionId.md. Objective: $($s.description). Answer exactly this question: $q"
  Start-RoleProcess $pi (RoleArguments 'researcher' $assignment '') $s.worktree $s.task_id 'researcher' $researcherId $s.worktree $s.scope_id | Out-Null
  Write-Output "RESEARCH_STARTED $QuestionId"
}
function Resume-Task([string]$TaskId) {
  Assert-Setup; $s=Read-State $TaskId
  if ($s.status -ne 'active') { Fail 'task is not active' }
  $pi=if($env:PI_CMD){$env:PI_CMD}else{'pi.cmd'}
  foreach($r in @('executor','reviewer')) {
    Start-RoleProcess $pi (@('--session',$s.sessions.$r.session_id) + @(RoleArguments $r "Resume Lead task $($s.task_id) as $r. Re-read the frozen task contract at $($s.contract_path) and continue the assigned work." '')) $s.worktree $s.task_id $r $s.sessions.$r.agent_id $s.worktree $s.scope_id | Out-Null
  }
  Write-Output "RESUMED $TaskId"
}
function Accept([string]$TaskId) { $s=Read-State $TaskId; $p=Join-Path (StateRoot) "$TaskId-reviewer.jsonl"; if (-not(Test-Path $p) -or -not((Get-Content $p | Select-Object -Last 1) -match '"state":"ready_for_acceptance"')) { Fail 'Reviewer is not ready_for_acceptance' }; $s.status='accepted'; $s.accepted_at=[DateTime]::UtcNow.ToString('o'); Write-State $s; Write-Output "ACCEPTED $TaskId" }
function Reclaim([string]$TaskId) { $s=Read-State $TaskId; if ($s.status -ne 'accepted') { Fail 'task must be accepted before reclaim' }; $s.status='reclaimed'; $s.reclaimed_at=[DateTime]::UtcNow.ToString('o'); Write-State $s; Write-Output "RECLAIMED $TaskId" }
function Cleanup([string]$TaskId) { $s=Read-State $TaskId; if ($s.status -ne 'reclaimed') { Fail 'task must be reclaimed before cleanup' }; $dirty=Git @('-C',$s.worktree,'status','--porcelain'); if ($dirty) { Fail 'worktree is not clean' }; if ([IO.Path]::GetFullPath($s.worktree) -ieq [IO.Path]::GetFullPath($ProjectRoot)) { Fail 'cannot remove main worktree' }; Invoke-Native git.exe @('worktree','remove',$s.worktree); $s.status='cleaned'; Write-State $s; Write-Output "CLEANED $TaskId" }
switch ($Command.ToLowerInvariant()) { 'setup' {Setup}; 'doctor' {Doctor}; 'validate' {Validate $Arg1}; 'start' {Start-Task $Arg1}; 'sync' {Sync-Task $Arg1}; 'research' {Research $Arg1 $Arg2 $Arg3}; 'status' {Status $Arg1}; 'watch' {Status $Arg1}; 'resume' {Resume-Task $Arg1}; 'accept' {Accept $Arg1}; 'reclaim' {Reclaim $Arg1}; 'cleanup' {Cleanup $Arg1}; default { Fail "unknown command: $Command" } }
