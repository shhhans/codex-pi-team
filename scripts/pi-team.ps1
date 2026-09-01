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
  $sharedContext = Join-Path $ProjectRoot 'AGENTS.md'
  if (-not (Test-Path -LiteralPath $sharedContext -PathType Leaf)) { Fail "shared agent context is missing: $sharedContext" }
  $sharedText = Get-Content -Raw -Encoding UTF8 -LiteralPath $sharedContext
  if ($sharedText -match '<lead-pi-team-runbook>') { Fail 'AGENTS.md must not contain the Lead-only Pi Team runbook' }
  if ($sharedText -match '(?i)Issue\s*#\s*\d+|[A-Z][A-Z0-9]+-\d{3,}|[A-Za-z]:[\\/]') { Fail 'AGENTS.md must remain task-agnostic and free of host paths' }
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
function StateRoot([bool]$Create=$true) {
  $p = Join-Path (Get-CommonDir) $StateName
  if (Test-Path -LiteralPath $p -PathType Leaf) { Fail "Pi Team state root is a file, not a directory: $p" }
  if ($Create) { try { New-Item -ItemType Directory -Force -Path $p | Out-Null } catch { Fail "cannot create Pi Team state root: $p ($($_.Exception.Message))" } }
  elseif (-not (Test-Path -LiteralPath $p -PathType Container)) { return $p }
  if (-not (Test-Path -LiteralPath $p -PathType Container)) { Fail "Pi Team state root is not a directory: $p" }
  return (Resolve-Path -LiteralPath $p).Path
}
function Read-State([string]$TaskId) { $p = Join-Path (StateRoot) "$TaskId.json"; if (-not (Test-Path -LiteralPath $p)) { Fail "unknown task: $TaskId" }; $state=Get-Content -Raw -LiteralPath $p | ConvertFrom-Json; if ($state.version -lt 2) { $legacy=$state.status; $state | Add-Member -NotePropertyName execution_status -NotePropertyValue $(if($legacy -eq 'cleaned'){'cleaned'}elseif($legacy -eq 'reclaimed'){'reclaimed'}else{'active'}) -Force; $state | Add-Member -NotePropertyName outcome -NotePropertyValue 'pending' -Force }; return $state }
function Write-State($State) { $p = Join-Path (StateRoot) "$($State.task_id).json"; $State | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 -LiteralPath $p }
function New-Id { [guid]::NewGuid().ToString() }
function Get-RoleCapabilities([string]$Role) {
  $capabilities = @{
    researcher = @('read','grep','find','ls','write','web_search','fetch_content','get_search_content','source_check','intercom','report_to_lead','blackboard_update')
    executor = @('read','grep','find','ls','bash','edit','write','intercom','report_to_lead','blackboard_update')
    reviewer = @('read','grep','find','ls','bash','edit','write','intercom','report_to_lead','blackboard_update')
  }
  if (-not $capabilities.ContainsKey($Role)) { Fail "unknown Pi Team role: $Role" }
  return @($capabilities[$Role])
}
function Assert-RelativeArtifactPath([string]$Path,[string]$Field) {
  if ([string]::IsNullOrWhiteSpace($Path) -or [IO.Path]::IsPathRooted($Path) -or $Path -match '(^|[\\/])\.\.([\\/]|$)') { Fail "$Field must be a non-empty worktree-relative path" }
}
function Assert-DelegationCapabilities($Delegation) {
  $role = [string]$Delegation.role; $available = Get-RoleCapabilities $role
  foreach ($capability in @($Delegation.required_capabilities)) { if ($available -notcontains [string]$capability) { Fail "delegation $($Delegation.id) requires capability '$capability' unavailable to role $role" } }
}
function Parse-Contract([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Fail "contract not found: $Path" }
  $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path
  $blocks = [regex]::Matches($text,'(?ms)```json\s*(.*?)\s*```')
  if ($blocks.Count -ne 1) { Fail 'contract must contain exactly one JSON fenced block' }
  try { $c = $blocks[0].Groups[1].Value | ConvertFrom-Json } catch { Fail "invalid contract JSON: $($_.Exception.Message)" }
  foreach ($n in @('version','task_id','name','description','base_ref','branch','worktree','in_scope','out_of_scope','done_criteria','delegations','constraints')) { if ($null -eq $c.$n) { Fail "contract missing field: $n" } }
  if ($c.version -ne 2) { Fail 'contract version must be 2' }
  if ($c.task_id -notmatch '^[A-Z][A-Z0-9]*-[0-9]{3,}$') { Fail 'invalid task ID' }
  if ($c.branch -notmatch '^pi-team/[A-Za-z0-9._/-]+$') { Fail 'invalid branch' }
  if (-not ([IO.Path]::IsPathRooted($c.worktree))) { Fail 'worktree must be absolute' }
  $w = [IO.Path]::GetFullPath($c.worktree); $root = [IO.Path]::GetFullPath($ProjectRoot)
  if ($w.TrimEnd('\') -ieq $root.TrimEnd('\') -or $w -like "$root\*" -or $w -like "$(Get-CommonDir)\*") { Fail 'dangerous worktree path' }
  $criterionIds = @{}
  foreach ($criterion in @($c.done_criteria)) {
    if ($null -eq $criterion.id -or [string]$criterion.id -notmatch '^C-[0-9]{3,}$') { Fail 'each done criterion needs a stable C-### id' }
    if ($criterionIds.ContainsKey([string]$criterion.id)) { Fail "duplicate done criterion id: $($criterion.id)" }; $criterionIds[[string]$criterion.id] = $true
    if ([string]::IsNullOrWhiteSpace([string]$criterion.description)) { Fail "done criterion $($criterion.id) needs a description" }
    Get-RoleCapabilities ([string]$criterion.owner) | Out-Null
    if (@($criterion.artifacts).Count -eq 0) { Fail "done criterion $($criterion.id) needs at least one artifact" }
    foreach ($artifact in @($criterion.artifacts)) { Assert-RelativeArtifactPath ([string]$artifact) "done criterion $($criterion.id) artifact" }
  }
  if ($criterionIds.Count -eq 0) { Fail 'contract needs at least one done criterion' }
  $delegationIds = @{}; $delegatedRoles = @{}
  foreach ($delegation in @($c.delegations)) {
    if ($null -eq $delegation.id -or [string]$delegation.id -notmatch '^[A-Z][A-Z0-9_-]{2,63}$') { Fail 'each delegation needs a stable ID' }
    if ($delegationIds.ContainsKey([string]$delegation.id)) { Fail "duplicate delegation id: $($delegation.id)" }; $delegationIds[[string]$delegation.id] = $true
    $role = [string]$delegation.role; Get-RoleCapabilities $role | Out-Null; $delegatedRoles[$role] = $true
    if ([string]::IsNullOrWhiteSpace([string]$delegation.objective)) { Fail "delegation $($delegation.id) needs an objective" }
    Assert-RelativeArtifactPath ([string]$delegation.artifact_path) "delegation $($delegation.id) artifact_path"
    if ($null -eq $delegation.required_capabilities -or @($delegation.required_capabilities).Count -eq 0) { Fail "delegation $($delegation.id) needs required_capabilities" }
    Assert-DelegationCapabilities $delegation
  }
  foreach ($requiredRole in @('executor','reviewer')) { if (-not $delegatedRoles.ContainsKey($requiredRole)) { Fail "contract needs a $requiredRole delegation" } }
  return $c
}
function Event($State,[string]$Role,[string]$StateName,[string]$Activity,[string]$Blocker,[string]$Next) {
  if ($State.execution_status -ne 'active') { Fail 'task is not active' }
  $seq = 1; $ep = Join-Path (StateRoot) "$($State.task_id)-$Role.jsonl"; if (Test-Path $ep) { $seq = (Get-Content $ep | Measure-Object).Count + 1 }
  [ordered]@{version=1;task_id=$State.task_id;role=$Role;agent_id=$State.sessions.$Role.agent_id;worktree=$State.worktree;sequence=$seq;at=[DateTime]::UtcNow.ToString('o');state=$StateName;activity=$Activity;blocker=$Blocker;next=$Next} | ConvertTo-Json -Compress | Add-Content -Encoding UTF8 -LiteralPath $ep
}
function Validate([string]$Path) { $c = Parse-Contract $Path; Write-Output "VALID $($c.task_id)" }
function Setup-Codex {
  $codex = if ($env:CODEX_CMD) { $env:CODEX_CMD } else { (Get-Command codex -ErrorAction SilentlyContinue).Source }
  if (-not $codex) { Fail 'Codex CLI is required to register Agent Blackboard' }
  $server = Join-Path $ProjectRoot 'plugins/agent-blackboard/server/blackboard-mcp.mjs'
  if (-not (Test-Path -LiteralPath $server -PathType Leaf)) { Fail "Blackboard MCP server is missing: $server" }
  $result = & $codex 'mcp' 'add' 'agent-blackboard' '--' 'node' $server 2>&1
  if ($LASTEXITCODE -ne 0) { Fail (($result -join "`n").Trim()) }
  Write-Output 'CODEX_MCP_READY agent-blackboard'
}
function Publish([string]$Path) {
  $c = Parse-Contract $Path
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) { Fail 'node.exe is required to publish a Blackboard task' }
  $cli = Join-Path $ProjectRoot 'plugins/agent-blackboard/server/blackboard-cli.mjs'
  if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) { Fail "Blackboard CLI is missing: $cli" }
  $contractPath = (Resolve-Path -LiteralPath $Path).Path
  $result = & $node.Source $cli 'publish' $ProjectRoot $contractPath 2>&1
  if ($LASTEXITCODE -ne 0) { Fail (($result -join "`n").Trim()) }
  Write-Output "PUBLISHED $($c.task_id)"
}
function Invoke-BlackboardLifecycle([string]$Action,[string]$TaskId,[string]$OutcomePath='') {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) { Fail 'node.exe is required to synchronize the Blackboard outcome' }
  $cli = Join-Path $ProjectRoot 'plugins/agent-blackboard/server/blackboard-cli.mjs'
  if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) { Fail "Blackboard CLI is missing: $cli" }
  $arguments = @($cli,$Action,$ProjectRoot,$TaskId)
  if ($OutcomePath) { $arguments += $OutcomePath }
  $result = & $node.Source @arguments 2>&1
  if ($LASTEXITCODE -ne 0) { Fail "Blackboard $Action failed: $(($result -join "`n").Trim())" }
}
function Doctor {
  foreach ($x in @('git','node.exe','pi.cmd','wt.exe','powershell.exe')) { if (-not (Get-Command $x -ErrorAction SilentlyContinue)) { Write-Output "MISSING $x" } else { Write-Output "OK $x" } }
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
  foreach ($file in @(Get-ChildItem (StateRoot $false) -Filter '*.json' -ErrorAction SilentlyContinue)) {
    try { $task=Get-Content -Raw -LiteralPath $file.FullName | ConvertFrom-Json } catch { Write-Output "STALE invalid task state $($file.Name)"; continue }
    if (-not $task.task_id -or -not $task.sessions) { continue }
    $execution = if ($task.execution_status) { $task.execution_status } else { $task.status }
    $outcome = if ($task.outcome) { $task.outcome } else { 'legacy-unknown' }
    foreach($role in @('executor','reviewer','researcher')) { if (-not($task.sessions.PSObject.Properties.Name -contains $role)) { continue }; $runtime=Read-Runtime $task $role; $health=if(Test-RuntimeLive $runtime){'active'}elseif($execution -eq 'active'){'stale'}else{'stopped'}; Write-Output "TASK $($task.task_id) role=$role health=$health execution=$execution outcome=$outcome last_event=$((Join-Path (StateRoot) \"$($task.task_id)-$role.jsonl\"))" }
  }
}
function Quote-WindowsArgument([string]$Value) {
  if ($Value.Length -eq 0) { return '""' }
  $result = '"'; $slashes = 0
  foreach ($character in $Value.ToCharArray()) {
    if ($character -eq '\') { $slashes++; continue }
    if ($character -eq '"') { $result += ('\' * ($slashes * 2 + 1)) + '"'; $slashes = 0; continue }
    if ($slashes -gt 0) { $result += '\' * $slashes; $slashes = 0 }
    $result += $character
  }
  if ($slashes -gt 0) { $result += '\' * ($slashes * 2) }
  return $result + '"'
}
function RuntimePath($State,[string]$Role) { return Join-Path (StateRoot) "$($State.task_id)-$Role-runtime.json" }
function Read-Runtime($State,[string]$Role) { $path=RuntimePath $State $Role; if (-not(Test-Path -LiteralPath $path)) { return $null }; try { return Get-Content -Raw -LiteralPath $path | ConvertFrom-Json } catch { return $null } }
function Test-RuntimeLive($Runtime) {
  if ($null -eq $Runtime -or $null -eq $Runtime.runtime_pid) { return $false }
  try {
    $p=Get-Process -Id ([int]$Runtime.runtime_pid) -ErrorAction Stop
    if (-not $Runtime.process_started_at) { return $false }
    $recorded=([DateTime]$Runtime.process_started_at).ToUniversalTime()
    return [Math]::Abs(($p.StartTime.ToUniversalTime() - $recorded).TotalSeconds) -lt 30
  } catch { return $false }
}
function Wait-RoleReady($State,[string]$Role,[string]$LaunchId) {
  $deadline=[DateTime]::UtcNow.AddSeconds(60)
  do { $runtime=Read-Runtime $State $Role; if ($runtime -and $runtime.launch_id -eq $LaunchId) { return $runtime }; Start-Sleep -Milliseconds 100 } while ([DateTime]::UtcNow -lt $deadline)
  Fail "role startup did not register readiness: $Role"
}
function Stop-RoleTree($Session) {
  foreach ($processId in @($Session.launcher_pid,$Session.runtime_pid) | Where-Object { $_ } | Select-Object -Unique) {
    if (-not (Get-Process -Id ([int]$processId) -ErrorAction SilentlyContinue)) { continue }
    & taskkill.exe /PID ([int]$processId) /T /F | Out-Null
  }
}
function Assert-NoLiveRoleProcesses($State) { foreach($role in @('executor','reviewer','researcher')) { if (-not($State.sessions.PSObject.Properties.Name -contains $role)) { continue }; $runtime=Read-Runtime $State $role; if (Test-RuntimeLive $runtime) { Fail "task already has live role process; refusing duplicate resume: ${role}:$($runtime.runtime_pid)" } } }
function Start-RoleProcess([string]$Executable,[string[]]$ArgumentList,[string]$WorkingDirectory,[string]$TaskId,[string]$Role,[string]$AgentId,[string]$Worktree,[string]$ScopeId,[string]$LaunchId) {
  $stateRoot = StateRoot
  $identity = [ordered]@{
    PI_TEAM_TASK_ID = $TaskId
    PI_TEAM_ROLE = $Role
    PI_TEAM_AGENT_ID = $AgentId
    PI_TEAM_WORKTREE = $Worktree
    PI_TEAM_STATE_ROOT = $stateRoot
    PI_TEAM_SCOPE_ID = $ScopeId
    PI_TEAM_LAUNCH_ID = $LaunchId
    PI_INTERCOM_STABLE_ID = "pi-team--$TaskId--$Role--$LaunchId"
  }
  $previous = @{}
  foreach ($name in $identity.Keys) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, [string]$identity[$name], 'Process')
  }
  try {
    if ($ArgumentList.Count -lt 3 -or $ArgumentList[0] -ne '-d') { Fail 'invalid Windows Terminal role command' }
    $paneDirectory = [string]$ArgumentList[1]
    $roleExecutable = [string]$ArgumentList[2]
    $roleArguments = @($ArgumentList | Select-Object -Skip 3)
    $payload = [ordered]@{identity=$identity;directory=$paneDirectory;executable=$roleExecutable;arguments=@($roleArguments)} | ConvertTo-Json -Compress -Depth 5
    $payloadBytes = [Text.Encoding]::UTF8.GetBytes($payload)
    $payloadStream = New-Object IO.MemoryStream
    $gzip = New-Object IO.Compression.GzipStream($payloadStream,[IO.Compression.CompressionMode]::Compress,$true)
    $gzip.Write($payloadBytes,0,$payloadBytes.Length); $gzip.Dispose()
    $compressedPayload = [Convert]::ToBase64String($payloadStream.ToArray()); $payloadStream.Dispose()
    $bootstrap = "`$input=[Convert]::FromBase64String('$compressedPayload');`$source=New-Object IO.MemoryStream(,`$input);`$gzip=New-Object IO.Compression.GzipStream(`$source,[IO.Compression.CompressionMode]::Decompress);`$reader=New-Object IO.StreamReader(`$gzip,[Text.Encoding]::UTF8);`$data=`$reader.ReadToEnd()|ConvertFrom-Json;`$reader.Dispose();`$gzip.Dispose();`$source.Dispose();`$data.identity.psobject.Properties|ForEach-Object { Set-Item -Path ('Env:'+`$_.Name) -Value ([string]`$_.Value) };Set-Location -LiteralPath `$data.directory;& ([string]`$data.executable) @([string[]]`$data.arguments);exit `$LASTEXITCODE"
    $encodedScript = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($bootstrap))
    $terminalArguments = @('-d',$paneDirectory,'powershell.exe','-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',$encodedScript)
    $commandLine = ($terminalArguments | ForEach-Object { Quote-WindowsArgument ([string]$_) }) -join ' '
    # Test-only isolation: when WT_CMD points at a non-wt test stub (a console-subsystem
    # binary such as fake-pi.cmd) Start-Process -WindowStyle Normal would allocate a
    # visible console window for every role launch. Use -WindowStyle Hidden so the test
    # stub spawns headlessly. The real `wt.exe` (GUI subsystem) is unaffected because the
    # conditional only fires when the executable path is NOT the real Windows Terminal.
    $windowStyle = if ($env:WT_CMD -and -not ($Executable -match '(?i)(^|[\\/])wt(\.exe)?$')) { 'Hidden' } else { 'Normal' }
    return Start-Process $Executable -WorkingDirectory $WorkingDirectory -ArgumentList $commandLine -WindowStyle $windowStyle -PassThru
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
function Launch-Role($State,[string]$Role,[string]$Prompt,[string]$SessionId,[bool]$Resume=$false) {
  $pi = if ($env:PI_CMD) {$env:PI_CMD} else {'pi.cmd'}; $wt = if ($env:WT_CMD) {$env:WT_CMD} else {'wt.exe'}
  $launchId=New-Id; $State.sessions.$Role | Add-Member -NotePropertyName launch_id -NotePropertyValue $launchId -Force
  # `--session` only selects an existing file. A role can reach resume after
  # a launcher failure that happened before Pi created its first session, so
  # use the same persisted ID with `--session-id`: Pi resumes it when present
  # and creates it with that exact ID when absent.
  $sessionArgs = if ($Resume) { @('--session-id',$SessionId) } else { @() }
  $roleSession = if ($Resume) { '' } else { $SessionId }
  $args=@('-d',$State.worktree,$pi) + $sessionArgs + @(RoleArguments $Role $Prompt $roleSession)
  $proc=Start-RoleProcess $wt $args $State.worktree $State.task_id $Role $State.sessions.$Role.agent_id $State.worktree $State.scope_id $launchId
  $State.sessions.$Role | Add-Member -NotePropertyName launcher_pid -NotePropertyValue $proc.Id -Force; $State.sessions.$Role | Add-Member -NotePropertyName launcher_started_at -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force; Write-State $State
  $runtime=Wait-RoleReady $State $Role $launchId
  $State.sessions.$Role | Add-Member -NotePropertyName runtime_pid -NotePropertyValue $runtime.runtime_pid -Force; $State.sessions.$Role | Add-Member -NotePropertyName runtime_started_at -NotePropertyValue $runtime.ready_at -Force; $State.sessions.$Role | Add-Member -NotePropertyName intercom_id -NotePropertyValue $runtime.intercom_id -Force; Write-State $State
}
function New-RoleAssignment($Contract,[string]$Role) {
  $delegation = @($Contract.delegations | Where-Object { $_.role -eq $Role })
  if ($delegation.Count -ne 1) { Fail "contract must declare exactly one delegation for role $Role" }
  $criteria = @($Contract.done_criteria | Where-Object { $_.owner -eq $Role } | ForEach-Object { "$($_.id): $($_.description) [artifacts=$($_.artifacts -join ',')]" }) -join '; '
  $context = New-RoleContext $Contract $Role 'start'
  return "$context Lead assignment. Task ID: $($Contract.task_id). Worktree: $($Contract.worktree). Role: $Role. Delegation: $($delegation[0].id). Artifact: $($delegation[0].artifact_path). Required capabilities: $($delegation[0].required_capabilities -join ', '). Objective: $($delegation[0].objective). Done criteria: $criteria."
}
function New-RoleContext($Contract,[string]$Role,[string]$Mode,[string]$Question='') {
  $delegation = @($Contract.delegations | Where-Object { $_.role -eq $Role })
  if ($delegation.Count -ne 1) { Fail "contract must declare exactly one delegation for role $Role" }
  $ownedCriteria = @($Contract.done_criteria | Where-Object { $_.owner -eq $Role } | ForEach-Object { "$($_.id): $($_.description)" })
  $scope = @($Contract.in_scope | ForEach-Object { [string]$_ }) -join '; '
  $outOfScope = @($Contract.out_of_scope | ForEach-Object { [string]$_ }) -join '; '
  if ($Mode -eq 'resume') {
    return (@(
      'Pi Team task context: --- PI TEAM TASK CONTEXT v1 ---',
      'Context mode: resume',
      'Stable project context: AGENTS.md is already present in the existing session; do not reload or rediscover it.',
      "Task ID: $($Contract.task_id)",
      "Role: $Role",
      "Branch: $($Contract.branch)",
      "Worktree: $($Contract.worktree)",
      "Delegation: $($delegation[0].id)",
      "Owned artifact: $($delegation[0].artifact_path)",
      "Visible scope: $scope",
      'Resume rule: preserve the existing task scope and session history; continue from the next uncompleted slice without rediscovering the whole repository.',
      '--- END PI TEAM TASK CONTEXT ---'
    ) -join ' ')
  }
  $lines = @(
    'Pi Team task context: --- PI TEAM TASK CONTEXT v1 ---',
    "Context mode: $Mode",
    'Stable project context: AGENTS.md is inherited; use it as the shared repository map.',
    'Context boundary: this is orientation only. The launcher, runtime policy, and Lead still enforce authorization and acceptance.',
    "Task ID: $($Contract.task_id)",
    "Role: $Role",
    "Branch: $($Contract.branch)",
    "Worktree: $($Contract.worktree)",
    "Delegation: $($delegation[0].id)",
    "Owned artifact: $($delegation[0].artifact_path)",
    "Required capabilities: $($delegation[0].required_capabilities -join ', ')",
    "Objective: $($delegation[0].objective)",
    "Visible scope: $scope",
    "Out of scope: $outOfScope",
    "Owned done criteria: $($ownedCriteria -join '; ')",
    'Normative protocol: ADR/0002-lead-subagent-collaboration-protocol.md',
    'Recommended common reads: AGENTS.md, ADR/0002-lead-subagent-collaboration-protocol.md, project_state.md'
  )
  switch ($Role) {
    'researcher' {
      $lines += 'Recommended role reads: .pi/skills/answer-research-question/SKILL.md, .pi/communication/policy.mjs, research/'
      $lines += 'Research boundary: answer one bounded question, write only the assigned research artifact, and return to waiting.'
      if (-not [string]::IsNullOrWhiteSpace($Question)) { $lines += "Research question: $((($Question -replace '\s+', ' ').Trim()))" }
    }
    'executor' {
      $lines += 'Recommended role reads: .pi/skills/execute-delegated-task/SKILL.md, scripts/pi-team.ps1, tests/run-tests.ps1, implementation_notes/'
      $lines += 'Implementation boundary: make the smallest coherent change in this worktree and request bounded research when needed.'
    }
    'reviewer' {
      $lines += 'Recommended role reads: .pi/skills/review-delegated-task/SKILL.md, implementation_notes/, tests/run-tests.ps1'
      $lines += 'Review boundary: inspect the diff and evidence; use read-only Git operations and edit only review tests or real failure artifacts.'
    }
  }
  $lines += '--- END PI TEAM TASK CONTEXT ---'
  return ($lines -join ' ')
}
function Start-Task([string]$Path) {
  Assert-Setup; $c = Parse-Contract $Path; Assert-BlackboardTask $c | Out-Null; $existing = Join-Path (StateRoot) "$($c.task_id).json"; if (Test-Path $existing) { Fail 'task already started' }
  Invoke-Native git.exe @('-C',$ProjectRoot,'worktree','add',$c.worktree,$c.branch)
  $contractSnapshot = Snapshot-Contract $Path $c.task_id
  $state = [pscustomobject]@{version=2;task_id=$c.task_id;name=$c.name;description=$c.description;execution_status='active';outcome='pending';worktree=$c.worktree;contract_path=$contractSnapshot;scope_id=(New-Id);started_at=[DateTime]::UtcNow.ToString('o');sessions=[pscustomobject]@{executor=[pscustomobject]@{agent_id=(New-Id);session_id=(New-Id);role='executor'};reviewer=[pscustomobject]@{agent_id=(New-Id);session_id=(New-Id);role='reviewer'}}}
  Write-State $state; foreach ($r in @('executor','reviewer')) { Event $state $r 'working' 'task started' '' '' }
  $executorAssignment = New-RoleAssignment $c 'executor'
  $reviewerAssignment = New-RoleAssignment $c 'reviewer'
  try { Launch-Role $state 'executor' "$executorAssignment You are Executor. Perform only the assigned slice and report progress through the configured tools." $state.sessions.executor.session_id; Launch-Role $state 'reviewer' "$reviewerAssignment You are Reviewer. Inspect the delegated work as it becomes available and report progress through the configured tools." $state.sessions.reviewer.session_id }
  catch { Stop-RoleTree $state.sessions.executor; Stop-RoleTree $state.sessions.reviewer; $state | Add-Member -NotePropertyName launch_error -NotePropertyValue $_.Exception.Message -Force; $state | Add-Member -NotePropertyName launch_failed_at -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force; Write-State $state; throw }
  Write-Output "STARTED $($c.task_id) scope=$($state.scope_id)"
}
function Status([string]$TaskId) { if ($TaskId) { $s=Read-State $TaskId; $s | ConvertTo-Json -Depth 10; foreach ($r in @('executor','reviewer','researcher')) { $p=Join-Path (StateRoot) "$TaskId-$r.jsonl"; if (Test-Path $p) { Get-Content $p | Select-Object -Last 1 } } } else { Get-ChildItem (StateRoot) -Filter '*.json' | Select-Object -ExpandProperty Name } }
function Sync-Task([string]$Path) { $c=Parse-Contract $Path; $s=Read-State $c.task_id; foreach ($n in @('branch','worktree')) { if ($c.$n -ne $s.$n) { Fail "immutable field changed: $n" } }; $s.name=$c.name; $s.description=$c.description; Write-State $s; Write-Output "SYNCED $($c.task_id)" }
function Research([string]$TaskId,[string]$QuestionId,[string]$QuestionFile) {
  Assert-Setup; $s=Read-State $TaskId
  if ($s.execution_status -ne 'active') { Fail 'task is not active' }
  if ($s.sessions.PSObject.Properties.Name -contains 'researcher') { $runtime=Read-Runtime $s 'researcher'; if (Test-RuntimeLive $runtime) { Fail 'a Researcher is already active for this task' } }
  if (-not (Test-Path $QuestionFile)) { Fail 'question file not found' }
  $contract=Parse-Contract $s.contract_path
  $delegation=@($contract.delegations | Where-Object { $_.id -eq $QuestionId -and $_.role -eq 'researcher' })
  if ($delegation.Count -ne 1) { Fail "unknown Researcher delegation: $QuestionId" }
  Assert-DelegationCapabilities $delegation[0]
  $out=Join-Path $s.worktree $delegation[0].artifact_path; New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
  $q=Get-Content -Raw -Encoding UTF8 $QuestionFile
  $researcherId = New-Id
  $assignment = "$(New-RoleContext $contract 'researcher' 'research' $q) Lead assignment. Task ID: $($s.task_id). Worktree: $($s.worktree). Research delegation: $($delegation[0].id). Research artifact: $($delegation[0].artifact_path). Required capabilities: $($delegation[0].required_capabilities -join ', '). Objective: $($delegation[0].objective). Answer exactly this question: $q"
  if (-not($s.sessions.PSObject.Properties.Name -contains 'researcher')) { $s.sessions | Add-Member -NotePropertyName researcher -NotePropertyValue ([pscustomobject]@{agent_id=$researcherId;session_id='';role='researcher';question_id=$QuestionId;artifact_path=$delegation[0].artifact_path}) }
  Launch-Role $s 'researcher' $assignment ''
  Write-Output "RESEARCH_STARTED $QuestionId"
}
function Resume-Task([string]$TaskId) {
  Assert-Setup; $s=Read-State $TaskId
  if ($s.execution_status -ne 'active') { Fail 'task is not active' }
  Assert-NoLiveRoleProcesses $s
  $contract = Parse-Contract $s.contract_path
  foreach($r in @('executor','reviewer')) {
    $context = New-RoleContext $contract $r 'resume'
    Launch-Role $s $r "$context Resume the existing Lead task session as $r and continue the assigned work." $s.sessions.$r.session_id $true
  }
  Write-Output "RESUMED $TaskId"
}
function Read-OutcomeFile([string]$Path,[string]$Expected='') { if (-not(Test-Path -LiteralPath $Path)) { Fail "outcome file not found: $Path" }; try { $x=Get-Content -Raw -Encoding UTF8 -LiteralPath $Path | ConvertFrom-Json } catch { Fail "invalid outcome file: $Path" }; if ($Expected -and $x.outcome -ne $Expected) { Fail "outcome file must declare outcome=$Expected" }; return $x }
function Assert-MissingCriteria($Contract,$Evidence) {
  if (-not $Evidence.reason -or @($Evidence.missing_done_criteria).Count -eq 0) { Fail 'incomplete closure requires reason and missing_done_criteria' }
  if ($null -eq $Contract) { return }
  $known=@{}; foreach($criterion in @($Contract.done_criteria)) { $known[[string]$criterion.id]=$true }
  foreach($id in @($Evidence.missing_done_criteria)) { if (-not $known.ContainsKey([string]$id)) { Fail "unknown missing done criterion: $id" } }
}
function Accept([string]$TaskId,[string]$EvidencePath) {
  $s=Read-State $TaskId; if ($s.execution_status -ne 'active' -or $s.outcome -ne 'pending') { Fail 'task is not awaiting acceptance' }
  $e=Read-OutcomeFile $EvidencePath 'accepted'; $p=Join-Path (StateRoot) "$TaskId-reviewer.jsonl"
  if (-not(Test-Path $p) -or -not((Get-Content $p | Select-Object -Last 1) -match '"state":"ready_for_acceptance"')) { Fail 'Reviewer is not ready_for_acceptance' }
  $contract=Parse-Contract $s.contract_path; $expected=@{}; foreach($criterion in @($contract.done_criteria)) { $expected[[string]$criterion.id]=$criterion }
  if (@($e.criteria).Count -ne $expected.Count) { Fail 'acceptance evidence must cover every done criterion exactly once' }
  $seen=@{}
  foreach($item in @($e.criteria)) {
    $id=[string]$item.criterion_id
    if (-not $expected.ContainsKey($id)) { Fail "acceptance evidence names unknown criterion: $id" }
    if ($seen.ContainsKey($id)) { Fail "acceptance evidence repeats criterion: $id" }; $seen[$id]=$true
    if (-not $item.artifacts -or @($item.artifacts).Count -eq 0) { Fail "accepted criterion $id requires an artifact" }
    $provided=@{}; foreach($artifact in @($item.artifacts)) { Assert-RelativeArtifactPath ([string]$artifact) "acceptance artifact"; if (-not(Test-Path (Join-Path $s.worktree $artifact))) { Fail "acceptance artifact not found: $artifact" }; $provided[[string]$artifact]=$true }
    foreach($requiredArtifact in @($expected[$id].artifacts)) { if (-not $provided.ContainsKey([string]$requiredArtifact)) { Fail "accepted criterion $id is missing required artifact: $requiredArtifact" } }
  }
  if ($seen.Count -ne $expected.Count) { Fail 'acceptance evidence must cover every done criterion exactly once' }
  Invoke-BlackboardLifecycle 'accept' $TaskId
  $s.outcome='accepted'; $s | Add-Member -NotePropertyName accepted_at -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force; $s | Add-Member -NotePropertyName acceptance_path -NotePropertyValue ((Resolve-Path $EvidencePath).Path) -Force; Write-State $s; Write-Output "ACCEPTED $TaskId"
}
function Close-Incomplete([string]$TaskId,[string]$ClosurePath) {
  $s=Read-State $TaskId; if ($s.outcome -ne 'pending') { Fail 'task is not awaiting closure' }; $e=Read-OutcomeFile $ClosurePath 'incomplete'
  $contract=$null; try { $contract=Parse-Contract $s.contract_path } catch { if ($s.version -ge 2) { throw } }; Assert-MissingCriteria $contract $e
  Invoke-BlackboardLifecycle 'close-incomplete' $TaskId $ClosurePath
  $s.outcome='incomplete'; $s | Add-Member -NotePropertyName incomplete_at -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force; $s | Add-Member -NotePropertyName closure_path -NotePropertyValue ((Resolve-Path $ClosurePath).Path) -Force; Write-State $s; Write-Output "INCOMPLETE $TaskId"
}
function Reconcile([string]$TaskId,[string]$ClosurePath) {
  $s=Read-State $TaskId; if ($s.version -ge 2 -and $s.outcome -ne 'pending') { Fail 'task is already reconciled' }; $e=Read-OutcomeFile $ClosurePath
  if ($e.outcome -notin @('accepted','incomplete')) { Fail 'reconcile outcome must be accepted or incomplete' }
  $legacy=$s.status; $s.version=2; if (-not($s.PSObject.Properties.Name -contains 'execution_status')) { $s | Add-Member -NotePropertyName execution_status -NotePropertyValue $(if($legacy -eq 'cleaned'){'cleaned'}elseif($legacy -eq 'reclaimed'){'reclaimed'}else{'active'}) }; if ($e.outcome -eq 'incomplete') { Assert-MissingCriteria $null $e; $s | Add-Member -NotePropertyName incomplete_at -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force } else { $s | Add-Member -NotePropertyName accepted_at -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force }; Invoke-BlackboardLifecycle 'reconcile' $TaskId $ClosurePath; $s.outcome=$e.outcome; $s | Add-Member -NotePropertyName reconciliation_path -NotePropertyValue ((Resolve-Path $ClosurePath).Path) -Force; $s | Add-Member -NotePropertyName reconciled_at -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force; Write-State $s; Write-Output "RECONCILED $TaskId outcome=$($e.outcome)"
}
function Reclaim([string]$TaskId) { $s=Read-State $TaskId; if ($s.outcome -notin @('accepted','incomplete')) { Fail 'task must be accepted or closed incomplete before reclaim' }; Assert-NoLiveRoleProcesses $s; $s.execution_status='reclaimed'; $s | Add-Member -NotePropertyName reclaimed_at -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force; Write-State $s; Invoke-BlackboardLifecycle 'archive' $TaskId; Write-Output "RECLAIMED $TaskId" }
function Cleanup([string]$TaskId) { $s=Read-State $TaskId; if ($s.execution_status -ne 'reclaimed') { Fail 'task must be reclaimed before cleanup' }; $dirty=Git @('-C',$s.worktree,'status','--porcelain'); if ($dirty) { Fail 'worktree is not clean' }; if ([IO.Path]::GetFullPath($s.worktree) -ieq [IO.Path]::GetFullPath($ProjectRoot)) { Fail 'cannot remove main worktree' }; Invoke-Native git.exe @('-C',$ProjectRoot,'worktree','remove',$s.worktree); $s.execution_status='cleaned'; Write-State $s; Write-Output "CLEANED $TaskId" }
switch ($Command.ToLowerInvariant()) { 'setup' {Setup}; 'codex-setup' {Setup-Codex}; 'doctor' {Doctor}; 'publish' {Publish $Arg1}; 'validate' {Validate $Arg1}; 'start' {Start-Task $Arg1}; 'sync' {Sync-Task $Arg1}; 'research' {Research $Arg1 $Arg2 $Arg3}; 'status' {Status $Arg1}; 'watch' {Status $Arg1}; 'resume' {Resume-Task $Arg1}; 'accept' {Accept $Arg1 $Arg2}; 'close-incomplete' {Close-Incomplete $Arg1 $Arg2}; 'reconcile' {Reconcile $Arg1 $Arg2}; 'reclaim' {Reclaim $Arg1}; 'cleanup' {Cleanup $Arg1}; default { Fail "unknown command: $Command" } }
