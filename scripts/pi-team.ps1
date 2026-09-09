[CmdletBinding()]
param([Parameter(Position=0)][string]$Command,[Parameter(Position=1)][string]$Arg1,[Parameter(Position=2,ValueFromRemainingArguments=$true)][string[]]$Remaining)
$ErrorActionPreference = 'Stop'
$Remaining = @($Remaining)
$Arg2 = if ($Remaining.Count -ge 1) { [string]$Remaining[0] } else { $null }
$Arg3 = if ($Remaining.Count -ge 2) { [string]$Remaining[1] } else { $null }
$Arg4 = if ($Remaining.Count -ge 3) { [string]$Remaining[2] } else { $null }
$Arg5 = if ($Remaining.Count -ge 4) { [string]$Remaining[3] } else { $null }
$projectRootHint = if ($env:PI_TEAM_PROJECT_ROOT) { $env:PI_TEAM_PROJECT_ROOT } else { Join-Path $PSScriptRoot '..' }
$ProjectRoot = (Resolve-Path $projectRootHint).Path
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot '.git'))) { throw "Pi Team project root is not a Git checkout: $ProjectRoot" }
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
function Read-State([string]$TaskId) { $p = Join-Path (StateRoot) "$TaskId.json"; if (-not (Test-Path -LiteralPath $p)) { Fail "unknown task: $TaskId" }; $state=Get-Content -Raw -Encoding UTF8 -LiteralPath $p | ConvertFrom-Json; if ($state.version -lt 2) { $legacy=$state.status; $state | Add-Member -NotePropertyName execution_status -NotePropertyValue $(if($legacy -eq 'cleaned'){'cleaned'}elseif($legacy -eq 'reclaimed'){'reclaimed'}else{'active'}) -Force; $state | Add-Member -NotePropertyName outcome -NotePropertyValue 'pending' -Force }; return $state }
function Write-State($State) {
  $root = StateRoot
  $p = Join-Path $root "$($State.task_id).json"
  $tmp = Join-Path $root (".$($State.task_id)." + [guid]::NewGuid().ToString('N') + '.tmp')
  try {
    $State | ConvertTo-Json -Depth 30 | Set-Content -Encoding UTF8 -LiteralPath $tmp
    Move-Item -LiteralPath $tmp -Destination $p -Force
  } finally {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
  }
}
function New-Id { [guid]::NewGuid().ToString() }
function New-FinalizationState([string]$TargetBranch) {
  return [pscustomobject]@{status='pending';phase='preflight';integration_commit=$null;merged_to_target=$false;target_branch=$TargetBranch;target_branch_source='contract';worktree_removed=$false;branch_removed=$false;terminals_reclaimed=$false;blackboard_archived=$false;github_issue_synced=$false;github_issue_number=$null;github_sync_mode=$null;tests_passed=$false;warnings=@();integration=[pscustomobject]@{status='pending';commit=$null;merged=$false};tests=[pscustomobject]@{status='pending';passed=$false;skipped=$false;output=''};cleanup=[pscustomobject]@{status='pending';terminals_reclaimed=$false;worktree_removed=$false;branch_removed=$false};blackboard=[pscustomobject]@{status='pending';state='unknown';archived=$false};github=[pscustomobject]@{status='pending';synced=$false;issue_number=$null;mode=$null};rollback=[pscustomobject]@{status='available';action='retry_from_last_completed_phase'};failure_reason=$null}
}
function Ensure-FinalizationShape($Finalization,[string]$ContractTarget) {
  if (-not $Finalization) { return (New-FinalizationState $ContractTarget) }
  $defaults = [ordered]@{
    phase='preflight'; target_branch_source='contract'; warnings=@();
    integration=[pscustomobject]@{status=if($Finalization.merged_to_target){'succeeded'}else{'pending'};commit=$Finalization.integration_commit;merged=[bool]$Finalization.merged_to_target};
    tests=[pscustomobject]@{status=if($Finalization.tests_passed){'passed'}else{'pending'};passed=[bool]$Finalization.tests_passed;skipped=$false;output=''};
    cleanup=[pscustomobject]@{status=if($Finalization.worktree_removed -and $Finalization.branch_removed){'succeeded'}else{'pending'};terminals_reclaimed=[bool]$Finalization.terminals_reclaimed;worktree_removed=[bool]$Finalization.worktree_removed;branch_removed=[bool]$Finalization.branch_removed};
    blackboard=[pscustomobject]@{status=if($Finalization.blackboard_archived){'succeeded'}else{'pending'};state='unknown';archived=[bool]$Finalization.blackboard_archived};
    github=[pscustomobject]@{status=if($Finalization.github_issue_synced){'succeeded'}else{'pending'};synced=[bool]$Finalization.github_issue_synced;issue_number=$Finalization.github_issue_number;mode=$Finalization.github_sync_mode};
    rollback=[pscustomobject]@{status='available';action='retry_from_last_completed_phase'}
  }
  foreach ($name in $defaults.Keys) { if (-not ($Finalization.PSObject.Properties.Name -contains $name)) { $Finalization | Add-Member -NotePropertyName $name -NotePropertyValue $defaults[$name] } }
  if ($null -eq $Finalization.warnings) { $Finalization.warnings=@() }
  if ([string]::IsNullOrWhiteSpace([string]$Finalization.target_branch)) { $Finalization.target_branch=$ContractTarget }
  return $Finalization
}
function Assert-KnownRole([string]$Role) {
  if (@('researcher','executor','reviewer') -notcontains $Role) { Fail "unknown Pi Team role: $Role" }
}
function Assert-RelativeArtifactPath([string]$Path,[string]$Field) {
  if ([string]::IsNullOrWhiteSpace($Path) -or [IO.Path]::IsPathRooted($Path) -or $Path -match '(^|[\\/])\.\.([\\/]|$)') { Fail "$Field must be a non-empty worktree-relative path" }
}
function Assert-StringArray($Value,[string]$Field,[int]$Minimum=0,[int]$Maximum=2147483647) {
  if ($Value -is [string] -or $null -eq $Value) { Fail "$Field must be an array of strings" }
  $items = @($Value)
  if ($items.Count -lt $Minimum -or $items.Count -gt $Maximum) { Fail "$Field must contain between $Minimum and $Maximum items" }
  foreach ($item in $items) { if ($item -isnot [string] -or [string]::IsNullOrWhiteSpace($item)) { Fail "$Field must contain only non-empty strings" } }
  return $items
}
function Parse-Contract([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Fail "contract not found: $Path" }
  $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path
  $blocks = [regex]::Matches($text,'(?ms)```json\s*(.*?)\s*```')
  if ($blocks.Count -ne 1) { Fail 'contract must contain exactly one JSON fenced block' }
  try { $c = $blocks[0].Groups[1].Value | ConvertFrom-Json } catch { Fail "invalid contract JSON: $($_.Exception.Message)" }
  foreach ($n in @('version','task_id','name','objective','base_ref','branch','worktree','acceptance')) { if ($null -eq $c.$n) { Fail "contract missing field: $n" } }
  if ($c.version -ne 3) { Fail 'contract version must be 3' }
  foreach ($legacy in @('description','in_scope','out_of_scope','done_criteria','delegations','constraints')) {
    if ($c.PSObject.Properties.Name -contains $legacy) { Fail "v3 contract must not contain legacy field: $legacy" }
  }
  if ($c.task_id -notmatch '^[A-Z][A-Z0-9]*-[0-9]{3,}$') { Fail 'invalid task ID' }
  if ([string]::IsNullOrWhiteSpace([string]$c.name)) { Fail 'contract name must be non-empty' }
  if ([string]::IsNullOrWhiteSpace([string]$c.objective)) { Fail 'contract objective must be non-empty' }
  Assert-StringArray $c.acceptance 'acceptance' 2 5 | Out-Null
  if ($c.PSObject.Properties.Name -contains 'context') { Assert-StringArray $c.context 'context' | Out-Null }
  if ($c.PSObject.Properties.Name -contains 'deliverables') { Assert-StringArray $c.deliverables 'deliverables' | Out-Null }
  if ($c.branch -notmatch '^pi-team/[A-Za-z0-9._/-]+$') { Fail 'invalid branch' }
  if (-not ([IO.Path]::IsPathRooted($c.worktree))) { Fail 'worktree must be absolute' }
  $w = [IO.Path]::GetFullPath($c.worktree); $root = [IO.Path]::GetFullPath($ProjectRoot)
  if ($w.TrimEnd('\') -ieq $root.TrimEnd('\') -or $w -like "$root\*" -or $w -like "$(Get-CommonDir)\*") { Fail 'dangerous worktree path' }
  return $c
}
function Event($State,[string]$Role,[string]$StateName,[string]$Activity,[string]$Blocker,[string]$Next) {
  if ($State.execution_status -ne 'active') { Fail 'task is not active' }
  $seq = 1; $ep = Join-Path (StateRoot) "$($State.task_id)-$Role.jsonl"; if (Test-Path $ep) { $seq = (Get-Content $ep | Measure-Object).Count + 1 }
  [ordered]@{version=1;task_id=$State.task_id;role=$Role;agent_id=$State.sessions.$Role.agent_id;worktree=$State.worktree;sequence=$seq;at=[DateTime]::UtcNow.ToString('o');state=$StateName;activity=$Activity;blocker=$Blocker;next=$Next} | ConvertTo-Json -Compress | Add-Content -Encoding UTF8 -LiteralPath $ep
}
function Redact-SensitiveText([string]$Text) {
  if ($null -eq $Text) { return '' }
  return ($Text -replace '(?im)(api[_-]?key|auth[_-]?token|authorization|secret|password)\s*[:=]\s*[^\s,;]+', '$1=<redacted>')
}
function Preflight([string]$IssueNumber,[string]$ProposalPath) {
  if ($IssueNumber -notmatch '^[0-9]+$' -or [int]$IssueNumber -lt 1) { Fail 'preflight requires a positive GitHub issue number' }
  if ([string]::IsNullOrWhiteSpace($ProposalPath)) { $ProposalPath = Join-Path $ProjectRoot "plans/ISSUE-$IssueNumber-proposal.md" }
  $proposal = [IO.Path]::GetFullPath($ProposalPath)
  $issue = $null; $lookupError = ''
  $gh = Get-Command gh.exe -ErrorAction SilentlyContinue
  if (-not $gh) { $lookupError = 'gh CLI is unavailable' }
  else {
    $raw = @(& $gh.Source 'issue' 'view' $IssueNumber '--json' 'number,state,title,body,updatedAt,url' 2>&1)
    if ($LASTEXITCODE -eq 0) {
      try { $issue = ($raw -join "`n") | ConvertFrom-Json } catch { $lookupError = 'gh returned invalid JSON' }
    } else { $lookupError = Redact-SensitiveText (($raw -join "`n").Trim()) }
  }
  $developHead = ''
  try { $developHead = Git @('-C',$ProjectRoot,'rev-parse','develop') } catch { $developHead = 'unavailable' }
  $state = if ($null -eq $issue) { 'missing' } elseif ([string]$issue.state -eq 'OPEN') { 'open' } else { 'closed' }
  $decision = if ($state -eq 'missing') { 'blocked' } elseif ($state -eq 'closed') { 'needs_user_review' } else { 'lead_fact_check_required' }
  $title = if ($issue) { Redact-SensitiveText ([string]$issue.title) } else { '' }
  $body = if ($issue) { Redact-SensitiveText ([string]$issue.body) } else { '' }
  $parent = Split-Path -Parent $proposal
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $json = [ordered]@{ issue_number=[int]$IssueNumber; lookup_state=$state; decision=$decision; develop_head=$developHead; issue_url=if($issue){[string]$issue.url}else{''}; issue_updated_at=if($issue){[string]$issue.updatedAt}else{''}; lookup_error=$lookupError; fact_verification='Lead must verify the reported behavior on develop before start'; generated_at=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Depth 5
  $doc = @("# GitHub Issue #$IssueNumber preflight/proposal",'',"Generated: $([DateTime]::UtcNow.ToString('o'))",'', '```json', $json, '```','', "## Issue state", "- State: $state", "- Decision: $decision", "- Lead decision: pending", "- Title: $title", "- URL: $(if($issue){$issue.url}else{'unavailable'})", "- Updated: $(if($issue){$issue.updatedAt}else{'unavailable'})", "- Develop HEAD: $developHead", "- Lookup error: $lookupError",'', '## Lead fact check', '- Verify the issue is still reproducible or has concrete current evidence on `develop`.', '- If the issue is stale, missing, or the behavior is already fixed, do not start a duplicate task.', '- If the issue changes architecture/ADR, product behavior, security, compatibility, or an irreversible decision, wait for user review.', '- Change `Lead decision: pending` to `Lead decision: ready` only after the fact check and any required User review are complete.', '', '## Issue body (redacted)', $body) -join "`r`n"
  [IO.File]::WriteAllText($proposal,$doc,(New-Object Text.UTF8Encoding($false)))
  [ordered]@{status='PREFLIGHT'; issue_number=[int]$IssueNumber; state=$state; decision=$decision; proposal=$proposal; develop_head=$developHead; lookup_error=$lookupError } | ConvertTo-Json -Compress
}
function Validate([string]$Path) { $c = Parse-Contract $Path; Write-Output "VALID $($c.task_id)" }
function Assert-IssuePreflightReady($Contract) {
  $number = Get-ContractGitHubIssue $Contract
  if ($null -eq $number) { return }
  $proposal = Join-Path $ProjectRoot "plans/ISSUE-$number-proposal.md"
  if (-not (Test-Path -LiteralPath $proposal -PathType Leaf)) { Fail "issue #$number requires preflight proposal: $proposal" }
  $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $proposal
  if ($text -notmatch '(?im)^-\s*Lead decision:\s*ready\s*$') { Fail "issue #$number preflight is not Lead-approved; complete the fact check and proposal review first" }
}
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
function Get-BlackboardTask([string]$TaskId) {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) { Fail 'node.exe is required to read Blackboard task state' }
  $cli = Join-Path $ProjectRoot 'plugins/agent-blackboard/server/blackboard-cli.mjs'
  if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) { Fail "Blackboard CLI is missing: $cli" }
  $result = & $node.Source $cli 'snapshot' $ProjectRoot 2>&1
  if ($LASTEXITCODE -ne 0) { Fail "Blackboard snapshot failed: $(($result -join "`n").Trim())" }
  try { $snapshot = ($result -join "`n") | ConvertFrom-Json } catch { Fail 'Blackboard snapshot returned invalid JSON' }
  $tasks = @($snapshot.tasks | Where-Object { $_.task_id -eq $TaskId })
  if ($tasks.Count -ne 1) { Fail "Blackboard task not found or ambiguous: $TaskId" }
  return $tasks[0]
}
function Assert-ReviewerReadyForAcceptance([string]$TaskId) {
  $task = Get-BlackboardTask $TaskId
  $reviewer = @($task.agents | Where-Object { $_.role -eq 'reviewer' })
  if ($reviewer.Count -ne 1 -or $reviewer[0].state -ne 'ready_for_acceptance') { Fail 'Reviewer is not ready_for_acceptance' }
}
function Get-RoleRuntimeConfig([string]$Role) {
  if ($Role -notin @('researcher','executor','reviewer')) { Fail "unknown Pi Team role: $Role" }
  $path = Join-Path $ProjectRoot ".pi/agents/$Role.md"
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Fail "role definition is missing: $path" }
  $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $path
  if ($text -match '(?im)^\s*(?:api[_-]?key|auth[_-]?token|secret)\s*:') {
    Fail "role definition must not contain credentials: $path"
  }
  $match = [regex]::Match($text, '(?ms)^---\s*\r?\n(.*?)\r?\n---\s*')
  if (-not $match.Success) { Fail "role definition has no valid frontmatter: $path" }
  $frontmatter = $match.Groups[1].Value
  $values = @{}
  foreach ($field in @('provider','model')) {
    $fieldMatch = [regex]::Match($frontmatter, "(?m)^${field}:\s*([^\r\n#]+?)\s*$")
    if (-not $fieldMatch.Success) { Fail "$path must declare $field" }
    $value = $fieldMatch.Groups[1].Value.Trim()
    if ($value -match '[\"''\s]' -or $value -notmatch '^[A-Za-z0-9][A-Za-z0-9._:/+@-]*$') {
      Fail "$path $field must be a simple provider/model identifier"
    }
    $values[$field] = $value
  }
  return [pscustomobject]@{ role=$Role; provider=$values['provider']; model=$values['model']; path=$path }
}
function Invoke-ProviderAuthCheck($Config) {
  $pi = if ($env:PI_CMD) { $env:PI_CMD } else { 'pi.cmd' }
  $command = Get-Command $pi -ErrorAction SilentlyContinue
  if (-not $command) { return [pscustomobject]@{ success=$false; exit_code=127; output=@("Pi command is unavailable: $pi") } }
  $output = @(& $command.Source 'auth' 'check' '--provider' $Config.provider '--model' $Config.model '--json' '--no-refresh' 2>&1)
  return [pscustomobject]@{ success=($LASTEXITCODE -eq 0); exit_code=$LASTEXITCODE; output=$output }
}
function Assert-RoleProviderReady($Config) {
  $check = Invoke-ProviderAuthCheck $Config
  if (-not $check.success) {
    $detail = (($check.output -join ' ') -replace '(?i)(api[_-]?key|auth[_-]?token|secret)\s*[:=]\s*\S+', '$1=<redacted>')
    if ([string]::IsNullOrWhiteSpace($detail)) { $detail = "exit code $($check.exit_code)" }
    Fail "provider is not ready for role $($Config.role) ($($Config.provider)/$($Config.model)): $detail"
  }
}
function Doctor {
  foreach ($x in @('git','node.exe','pi.cmd','wt.exe','powershell.exe')) { if (-not (Get-Command $x -ErrorAction SilentlyContinue)) { Write-Output "MISSING $x" } else { Write-Output "OK $x" } }
  foreach ($role in @('researcher','executor','reviewer')) {
    try {
      $config = Get-RoleRuntimeConfig $role
      Write-Output "ROLE $role provider=$($config.provider) model=$($config.model)"
      $check = Invoke-ProviderAuthCheck $config
      if ($check.success) { Write-Output "OK role $role provider authentication" }
      else { Write-Output "MISSING role $role provider authentication (exit=$($check.exit_code))" }
    } catch { Write-Output "MISSING role $role configuration: $($_.Exception.Message)" }
  }
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
function Inventory([string]$OutputPath) {
  if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $ProjectRoot 'plans/pi-team-resource-inventory.json' }
  $output = [IO.Path]::GetFullPath($OutputPath)
  $tasks = @()
  foreach ($file in @(Get-ChildItem (StateRoot $false) -Filter '*.json' -ErrorAction SilentlyContinue)) {
    try { $task = Get-Content -Raw -Encoding UTF8 -LiteralPath $file.FullName | ConvertFrom-Json } catch { continue }
    if (-not $task.task_id) { continue }
    if (-not $task.sessions -and -not ($task.PSObject.Properties.Name -contains 'execution_status') -and -not ($task.PSObject.Properties.Name -contains 'status') -and -not ($task.PSObject.Properties.Name -contains 'outcome')) { continue }
    $contract = $null; $branch = ''
    if ($task.contract_path -and (Test-Path -LiteralPath $task.contract_path)) { try { $contract = Parse-Contract $task.contract_path; $branch = [string]$contract.branch } catch {} }
    $roles = @()
    foreach ($role in @('executor','reviewer','researcher')) {
      if (-not $task.sessions -or -not ($task.sessions.PSObject.Properties.Name -contains $role)) { continue }
      $runtime = Read-Runtime $task $role
      $roles += [ordered]@{ role=$role; health=if(Test-RuntimeLive $runtime){'active'}elseif(($task.execution_status -or $task.status) -eq 'active'){'stale'}else{'stopped'}; runtime_pid=if($runtime){$runtime.runtime_pid}else{$null} }
    }
    $dirty = $false; $worktreeExists = $false
    if ($task.worktree) {
      $worktreeExists = Test-Path -LiteralPath ([string]$task.worktree) -PathType Container
      if ($worktreeExists) { $dirty = [bool](Git @('-C',[string]$task.worktree,'status','--porcelain','--untracked-files=all')) }
    }
    $tasks += [ordered]@{ task_id=[string]$task.task_id; execution_status=if($task.execution_status){[string]$task.execution_status}else{[string]$task.status}; outcome=if($task.outcome){[string]$task.outcome}else{'legacy-unknown'}; branch=$branch; worktree=[string]$task.worktree; worktree_exists=$worktreeExists; worktree_dirty=$dirty; roles=$roles }
  }
  $worktrees = @(); $current = $null
  foreach ($line in @(git.exe '-C' $ProjectRoot 'worktree' 'list' '--porcelain')) {
    if ($line -match '^worktree (.*)$') { if($current){$worktrees += $current}; $current=[ordered]@{path=$Matches[1];head='';branch=''} }
    elseif ($current -and $line -match '^HEAD (.*)$') { $current.head=$Matches[1] }
    elseif ($current -and $line -match '^branch refs/heads/(.*)$') { $current.branch=$Matches[1] }
  }
  if ($current) { $worktrees += $current }
  $branchText = Git @('-C',$ProjectRoot,'branch','--format=%(refname:short)')
  $branches = @($branchText -split "`r?`n" | Where-Object { $_ })
  $manifest = [ordered]@{ generated_at=[DateTime]::UtcNow.ToString('o'); project_root=$ProjectRoot; tasks=$tasks; worktrees=$worktrees; branches=$branches; mutation_performed=$false; cleanup_required='review manifest before any deletion' }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $output) | Out-Null
  $manifest | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 -LiteralPath $output
  $manifest | ConvertTo-Json -Depth 20
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
  # Adaptive backoff so we react quickly to a fast-ready role, then settle
  # into a coarser poll once the boot sequence is underway. The 60 s
  # bounded deadline and the error message that Fail raises on timeout are
  # unchanged so callers and observers see the same contract.
  $deadline=[DateTime]::UtcNow.AddSeconds(60)
  $startMs=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  while ([DateTime]::UtcNow -lt $deadline) {
    $runtime=Read-Runtime $State $Role
    if ($runtime -and $runtime.launch_id -eq $LaunchId) { return $runtime }
    $elapsedMs=([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) - $startMs
    if ($elapsedMs -lt 1000) { $sleepMs = 50 }
    elseif ($elapsedMs -lt 5000) { $sleepMs = 200 }
    elseif ($elapsedMs -lt 20000) { $sleepMs = 500 }
    else { $sleepMs = 1000 }
    Start-Sleep -Milliseconds $sleepMs
  }
  Fail "role startup did not register readiness: $Role"
}
function Test-RecordedProcessLive([int]$ProcessId,[string]$StartedAt) {
  if (-not $ProcessId -or [string]::IsNullOrWhiteSpace($StartedAt)) { return $false }
  try {
    $p = Get-Process -Id $ProcessId -ErrorAction Stop
    $recorded = ([DateTime]$StartedAt).ToUniversalTime()
    return [Math]::Abs(($p.StartTime.ToUniversalTime() - $recorded).TotalSeconds) -lt 30
  } catch { return $false }
}
function Stop-RoleTree($Session) {
  $records = @(
    [pscustomobject]@{ pid=$Session.launcher_pid; started=$Session.launcher_started_at },
    [pscustomobject]@{ pid=$Session.runtime_pid; started=if($Session.runtime_started_at){$Session.runtime_started_at}else{$Session.ready_at} }
  )
  foreach ($record in $records | Where-Object { $_.pid } | Sort-Object pid -Unique) {
    if (-not (Test-RecordedProcessLive ([int]$record.pid) ([string]$record.started))) { continue }
    & taskkill.exe /PID ([int]$record.pid) /T /F | Out-Null
  }
}
function Assert-NoLiveRoleProcesses($State) { foreach($role in @('executor','reviewer','researcher')) { if (-not($State.sessions.PSObject.Properties.Name -contains $role)) { continue }; $runtime=Read-Runtime $State $role; if (Test-RuntimeLive $runtime) { Fail "task already has live role process; refusing duplicate resume: ${role}:$($runtime.runtime_pid)" } } }
function Start-RoleProcess([string]$Executable,[string[]]$ArgumentList,[string]$WorkingDirectory,[string]$TaskId,[string]$Role,[string]$AgentId,[string]$Worktree,[string]$ScopeId,[string]$LaunchId,[string]$AllowedDelegations) {
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
    PI_TEAM_ALLOWED_DELEGATIONS = $AllowedDelegations
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
    # Identity env vars are already set by the outer PowerShell and
    # inherited by the child process; the bootstrap only carries the
    # fields it must forward verbatim (directory, executable, arguments).
    $payload = [ordered]@{identity=$identity;directory=$paneDirectory;executable=$roleExecutable;arguments=@($roleArguments)} | ConvertTo-Json -Compress -Depth 5
    $payloadBytes = [Text.Encoding]::UTF8.GetBytes($payload)
    $payloadStream = New-Object IO.MemoryStream
    $gzip = New-Object IO.Compression.GzipStream($payloadStream,[IO.Compression.CompressionMode]::Compress,$true)
    $gzip.Write($payloadBytes,0,$payloadBytes.Length); $gzip.Dispose()
    $compressedPayload = [Convert]::ToBase64String($payloadStream.ToArray()); $payloadStream.Dispose()
    $bootstrap = "`$input=[Convert]::FromBase64String('$compressedPayload');`$source=New-Object IO.MemoryStream(,`$input);`$gzip=New-Object IO.Compression.GzipStream(`$source,[IO.Compression.CompressionMode]::Decompress);`$reader=New-Object IO.StreamReader(`$gzip,[Text.Encoding]::UTF8);`$data=`$reader.ReadToEnd()|ConvertFrom-Json;`$reader.Dispose();`$gzip.Dispose();`$source.Dispose();Set-Location -LiteralPath `$data.directory;& ([string]`$data.executable) @([string[]]`$data.arguments);exit `$LASTEXITCODE"
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
function RoleArguments([string]$Role,[string]$InitialPromptFile,[string]$SessionId,[string]$Provider,[string]$Model) {
  $tools = @{
    researcher = 'read,grep,find,ls,write,web_search,fetch_content,get_search_content,source_check,pi_team_intercom,blackboard_update'
    executor = 'read,grep,find,ls,bash,edit,write,pi_team_intercom,blackboard_update'
    reviewer = 'read,grep,find,ls,bash,edit,write,pi_team_intercom,blackboard_update'
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
  $compressionExtension = Join-Path $ProjectRoot '.pi/communication/extensions/compression.ts'
  $blackboardExtension = Join-Path $ProjectRoot '.pi/communication/extensions/blackboard-update.ts'
  $skill = Join-Path $ProjectRoot ".pi/skills/$($skills[$Role])/SKILL.md"
  if ([string]::IsNullOrWhiteSpace($Provider) -or [string]::IsNullOrWhiteSpace($Model)) { Fail "missing frozen provider/model for role $Role" }
  # --no-extensions disables role-card auto-loading, so compression is passed explicitly.
  $args = @('--approve','--provider',$Provider,'--model',$Model,'--name',$Role,'--no-extensions','--no-skills','--tools',$tools[$Role],'--skill',$skill,'--append-system-prompt',$roleFile,'--extension',$intercom,'--extension',$roleExtension,'--extension',$compressionExtension,'--extension',$blackboardExtension)
  if ($Role -eq 'researcher') { $args += @('--extension',(Join-Path (Get-PiAgentDir) 'npm/node_modules/pi-web-access/index.ts')) }
  if ($SessionId) { $args += @('--session-id',$SessionId) }
  # Pi expands an @file argument after Windows has completed command-line
  # parsing. Passing a JSON-bearing prompt directly through pi.cmd loses its
  # embedded double quotes; use a task-private prompt file to preserve the
  # exact Lead contract text.
  if ($InitialPromptFile) { $args += "@$InitialPromptFile" }
  return $args
}
function Write-RolePrompt([string]$TaskId,[string]$Role,[string]$LaunchId,[string]$Prompt) {
  $directory = Join-Path (StateRoot) 'prompts'
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  $path = Join-Path $directory "$TaskId-$Role-$LaunchId.md"
  Set-Content -LiteralPath $path -Value $Prompt -Encoding UTF8
  return $path
}
function Launch-Role($State,[string]$Role,[string]$Prompt,[string]$SessionId,[string]$Provider,[string]$Model,[bool]$Resume=$false,[string]$AllowedDelegations='') {
  $pi = if ($env:PI_CMD) {$env:PI_CMD} else {'pi.cmd'}; $wt = if ($env:WT_CMD) {$env:WT_CMD} else {'wt.exe'}
  $launchId=New-Id; $State.sessions.$Role | Add-Member -NotePropertyName launch_id -NotePropertyValue $launchId -Force
  # `--session` only selects an existing file. A role can reach resume after
  # a launcher failure that happened before Pi created its first session, so
  # use the same persisted ID with `--session-id`: Pi resumes it when present
  # and creates it with that exact ID when absent.
  $sessionArgs = if ($Resume) { @('--session-id',$SessionId) } else { @() }
  $roleSession = if ($Resume) { '' } else { $SessionId }
  $promptFile = Write-RolePrompt $State.task_id $Role $launchId $Prompt
  $args=@('-d',$State.worktree,$pi) + $sessionArgs + @(RoleArguments $Role $promptFile $roleSession $Provider $Model)
  $proc=Start-RoleProcess $wt $args $State.worktree $State.task_id $Role $State.sessions.$Role.agent_id $State.worktree $State.scope_id $launchId $AllowedDelegations
  $State.sessions.$Role | Add-Member -NotePropertyName launcher_pid -NotePropertyValue $proc.Id -Force; $State.sessions.$Role | Add-Member -NotePropertyName launcher_started_at -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force; Write-State $State
  $runtime=Wait-RoleReady $State $Role $launchId
  $State.sessions.$Role | Add-Member -NotePropertyName runtime_pid -NotePropertyValue $runtime.runtime_pid -Force; $State.sessions.$Role | Add-Member -NotePropertyName runtime_started_at -NotePropertyValue $runtime.ready_at -Force; $State.sessions.$Role | Add-Member -NotePropertyName intercom_id -NotePropertyValue $runtime.intercom_id -Force; Write-State $State
}
function New-ContractDescription($Contract) {
  $context = @($Contract.context) -join ' '
  $text = [string]$Contract.objective
  if (-not [string]::IsNullOrWhiteSpace($context)) { $text = "$text Context: $context" }
  return $text
}
function New-RoleAssignment($Contract,[string]$Role) {
  $context = New-RoleContext $Contract $Role 'start'
  return "$context Lead assignment. Perform the general $Role responsibility for this task and report evidence through the configured tools."
}
function Get-ToolRuntimeMetadata {
  $version = [Environment]::OSVersion.VersionString
  $architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  $platform = if ([Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([Runtime.InteropServices.OSPlatform]::Windows)) { 'Windows' } elseif ([Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([Runtime.InteropServices.OSPlatform]::Linux)) { 'Linux' } elseif ([Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([Runtime.InteropServices.OSPlatform]::OSX)) { 'macOS' } else { [Environment]::OSVersion.Platform.ToString() }
  $interpreter = if ($PSVersionTable) { "PowerShell $($PSVersionTable.PSEdition) $($PSVersionTable.PSVersion)" } elseif ($env:SHELL) { [string]$env:SHELL } elseif ($env:ComSpec) { Split-Path -Leaf $env:ComSpec } else { 'unknown' }
  $examples = if ($PSVersionTable) { 'Get-ChildItem -Force (or the ls tool), semicolons, $env:NAME; avoid ls -la, &&, and $NAME' } else { 'follow the detected interpreter syntax; prefer the dedicated ls, read, grep, and find tools for inspection' }
  return "Tool runtime metadata: os_family=$platform; os_version=$version; os_architecture=$architecture; command_interpreter=$interpreter; path_separator=$([IO.Path]::DirectorySeparatorChar); command_syntax_examples=$examples. Builtin bash-tool contract: its legacy name does not define command syntax; use command_interpreter and command_syntax_examples above."
}
function New-RoleContext($Contract,[string]$Role,[string]$Mode,[string]$Question='') {
  $context = @($Contract.context) -join '; '
  $acceptance = @($Contract.acceptance) -join '; '
  $deliverables = @($Contract.deliverables) -join '; '
  if ($Mode -eq 'resume') {
    return (@(
      'Pi Team task context: --- PI TEAM TASK CONTEXT v1 ---',
      'Context mode: resume',
      'Stable project context: AGENTS.md is already present in the existing session; do not reload or rediscover it.',
      "Task ID: $($Contract.task_id)",
      "Role: $Role",
      "Branch: $($Contract.branch)",
      "Worktree: $($Contract.worktree)",
      "Base ref: $($Contract.base_ref)",
      "Objective: $($Contract.objective)",
      "Context: $context",
      "Acceptance: $acceptance",
      "Deliverables: $deliverables",
      (Get-ToolRuntimeMetadata),
      'Resume rule: preserve the existing task objective and session history; continue from the next uncompleted slice without rediscovering the whole repository.',
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
    "Base ref: $($Contract.base_ref)",
    "Objective: $($Contract.objective)",
    "Context: $context",
    "Acceptance: $acceptance",
    "Deliverables: $deliverables",
    (Get-ToolRuntimeMetadata),
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
  Assert-Setup; $c = Parse-Contract $Path
  Assert-IssuePreflightReady $c
  $roleConfigs = @{}
  foreach ($role in @('researcher','executor','reviewer')) { $roleConfigs[$role] = Get-RoleRuntimeConfig $role }
  foreach ($role in @('executor','reviewer')) { Assert-RoleProviderReady $roleConfigs[$role] }
  Assert-BlackboardTask $c | Out-Null; $existing = Join-Path (StateRoot) "$($c.task_id).json"; if (Test-Path $existing) { Fail 'task already started' }
  Invoke-Native git.exe @('-C',$ProjectRoot,'worktree','add',$c.worktree,$c.branch)
  $contractSnapshot = Snapshot-Contract $Path $c.task_id
  $frozenRoleConfigs = [pscustomobject]@{ researcher=[pscustomobject]@{provider=$roleConfigs['researcher'].provider;model=$roleConfigs['researcher'].model}; executor=[pscustomobject]@{provider=$roleConfigs['executor'].provider;model=$roleConfigs['executor'].model}; reviewer=[pscustomobject]@{provider=$roleConfigs['reviewer'].provider;model=$roleConfigs['reviewer'].model} }
  $runtimeDelegations = [pscustomobject]@{executor="EXECUTOR-$($c.task_id)";reviewer="REVIEWER-$($c.task_id)"}
  $settings = Read-UserSettings
  $frozenProvider = ''; $frozenModel = ''
  if ($null -ne $settings) {
    $frozenProvider = [string]$settings.defaultProvider
    $frozenModel = [string]$settings.defaultModel
  }
  $frozenPair = $null
  if (-not [string]::IsNullOrWhiteSpace($frozenProvider) -and -not [string]::IsNullOrWhiteSpace($frozenModel)) {
    $frozenPair = [pscustomobject]@{provider=$frozenProvider;model=$frozenModel}
  }
  $state = [pscustomobject]@{version=3;task_id=$c.task_id;name=$c.name;description=(New-ContractDescription $c);execution_status='active';outcome='pending';worktree=$c.worktree;contract_path=$contractSnapshot;scope_id=(New-Id);started_at=[DateTime]::UtcNow.ToString('o');role_configs=$frozenRoleConfigs;runtime_delegations=$runtimeDelegations;research_sequence=0;frozen_provider_model=$frozenPair;finalization=(New-FinalizationState $c.base_ref);sessions=[pscustomobject]@{executor=[pscustomobject]@{agent_id=(New-Id);session_id=(New-Id);role='executor';provider=$frozenRoleConfigs.executor.provider;model=$frozenRoleConfigs.executor.model};reviewer=[pscustomobject]@{agent_id=(New-Id);session_id=(New-Id);role='reviewer';provider=$frozenRoleConfigs.reviewer.provider;model=$frozenRoleConfigs.reviewer.model}}}
  Write-State $state; foreach ($r in @('executor','reviewer')) { Event $state $r 'working' 'task started' '' '' }
  $executorAssignment = New-RoleAssignment $c 'executor'
  $reviewerAssignment = New-RoleAssignment $c 'reviewer'
  $allowedDelegations = @($runtimeDelegations.executor,$runtimeDelegations.reviewer) -join ','
  try { Launch-Role $state 'executor' "$executorAssignment You are Executor. Perform only the assigned slice and report progress through the configured tools." $state.sessions.executor.session_id $state.sessions.executor.provider $state.sessions.executor.model $false $allowedDelegations; Launch-Role $state 'reviewer' "$reviewerAssignment You are Reviewer. Inspect the delegated work as it becomes available and report progress through the configured tools." $state.sessions.reviewer.session_id $state.sessions.reviewer.provider $state.sessions.reviewer.model $false $allowedDelegations }
  catch { Stop-RoleTree $state.sessions.executor; Stop-RoleTree $state.sessions.reviewer; $state | Add-Member -NotePropertyName launch_error -NotePropertyValue $_.Exception.Message -Force; $state | Add-Member -NotePropertyName launch_failed_at -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force; Write-State $state; throw }
  Write-Output "STARTED $($c.task_id) scope=$($state.scope_id)"
}
function Status([string]$TaskId) { if ($TaskId) { $s=Read-State $TaskId; $s | ConvertTo-Json -Depth 10; foreach ($r in @('executor','reviewer','researcher')) { $p=Join-Path (StateRoot) "$TaskId-$r.jsonl"; if (Test-Path $p) { Get-Content $p | Select-Object -Last 1 } } } else { Get-ChildItem (StateRoot) -Filter '*.json' | Select-Object -ExpandProperty Name } }
function Sync-Task([string]$Path) { $c=Parse-Contract $Path; $s=Read-State $c.task_id; foreach ($n in @('branch','worktree')) { if ($c.$n -ne $s.$n) { Fail "immutable field changed: $n" } }; $s.name=$c.name; $s.description=(New-ContractDescription $c); Write-State $s; Write-Output "SYNCED $($c.task_id)" }
function Research([string]$TaskId,[string]$QuestionFile) {
  Assert-Setup; $s=Read-State $TaskId
  if ($s.execution_status -ne 'active') { Fail 'task is not active' }
  if ($s.sessions.PSObject.Properties.Name -contains 'researcher') { $runtime=Read-Runtime $s 'researcher'; if (Test-RuntimeLive $runtime) { Fail 'a Researcher is already active for this task' } }
  if (-not (Test-Path $QuestionFile)) { Fail 'question file not found' }
  $contract=Parse-Contract $s.contract_path
  $sequence = [int]$s.research_sequence + 1
  Add-StateProperty $s 'research_sequence' $sequence
  $researchId = "RESEARCH-$($s.task_id)-$sequence"
  $artifactPath = "research/$($s.task_id)-$sequence.md"
  $out=Join-Path $s.worktree $artifactPath; New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
  $q=Get-Content -Raw -Encoding UTF8 $QuestionFile
  $researcherId = New-Id
  $assignment = "$(New-RoleContext $contract 'researcher' 'research' $q) Answer exactly this bounded research question: $q. Write the result to $artifactPath."
  if (-not $s.role_configs -or -not($s.role_configs.PSObject.Properties.Name -contains 'researcher') -or [string]::IsNullOrWhiteSpace($s.role_configs.researcher.provider) -or [string]::IsNullOrWhiteSpace($s.role_configs.researcher.model)) { Fail 'task state lacks frozen provider/model for role researcher; refusing silent model change' }
  $researcherConfig = [pscustomobject]@{role='researcher';provider=$s.role_configs.researcher.provider;model=$s.role_configs.researcher.model}
  Assert-RoleProviderReady $researcherConfig
  if (-not($s.sessions.PSObject.Properties.Name -contains 'researcher')) { $s.sessions | Add-Member -NotePropertyName researcher -NotePropertyValue ([pscustomobject]@{agent_id=$researcherId;session_id='';role='researcher';question_id=$researchId;delegation_id=$researchId;artifact_path=$artifactPath;provider=$researcherConfig.provider;model=$researcherConfig.model}) }
  $s.runtime_delegations | Add-Member -NotePropertyName researcher -NotePropertyValue $researchId -Force
  Write-State $s
  $allowedDelegations = @($s.runtime_delegations.PSObject.Properties | ForEach-Object { [string]$_.Value }) -join ','
  Launch-Role $s 'researcher' $assignment '' $researcherConfig.provider $researcherConfig.model $false $allowedDelegations
  Write-Output "RESEARCH_STARTED $researchId artifact=$artifactPath"
}
function Resume-Task([string]$TaskId) {
  Assert-Setup; $s=Read-State $TaskId
  if ($s.execution_status -ne 'active') { Fail 'task is not active' }
  Assert-NoLiveRoleProcesses $s
  # Resource-cap stops persist last_stop_reason / last_checkpoint_path on the
  # task state. A plain `resume` must refuse in that case so the Lead uses
  # the explicit `resume-checkpoint` path (which mints a new session ID and
  # reuses the frozen provider/model).
  $resourceLimitCodes = @('tool_call_segment_limit','compact_retry_limit','output_token_limit_exceeded')
  $hasConstrainedState = $false
  foreach ($role in @('executor','reviewer')) {
    if (-not ($s.PSObject.Properties.Name -contains 'last_stop_reason')) { continue }
    $reason = $s.last_stop_reason
    if ($null -ne $reason -and ($resourceLimitCodes -contains ([string]$reason.code))) { $hasConstrainedState = $true; break }
    if ($s.PSObject.Properties.Name -contains 'last_checkpoint_path' -and $null -ne $s.last_checkpoint_path) { $hasConstrainedState = $true; break }
    if ($s.PSObject.Properties.Name -contains 'resumed_from_checkpoint') { $hasConstrainedState = $true; break }
  }
  if ($hasConstrainedState) {
    Fail "task was stopped by a resource limit (or a previous resume-checkpoint); plain resume would silently reuse a constrained session. Use 'pi-team.cmd resume-checkpoint <task-id> <checkpoint-path> <executor|reviewer>' to mint a new session ID and reuse the frozen provider/model."
  }
  $contract = Parse-Contract $s.contract_path
  foreach($r in @('executor','reviewer')) {
    $context = New-RoleContext $contract $r 'resume'
    if (-not($s.sessions.$r.PSObject.Properties.Name -contains 'provider') -or -not($s.sessions.$r.PSObject.Properties.Name -contains 'model')) { Fail "task state lacks frozen provider/model for role $r; refusing silent model change" }
    $allowedDelegations = @($s.runtime_delegations.PSObject.Properties | ForEach-Object { [string]$_.Value }) -join ','
    Launch-Role $s $r "$context Resume the existing Lead task session as $r and continue the assigned work." $s.sessions.$r.session_id $s.sessions.$r.provider $s.sessions.$r.model $true $allowedDelegations
  }
  Write-Output "RESUMED $TaskId"
}
function Read-Checkpoint([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Fail "checkpoint file not found: $Path" }
  try { $doc = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path | ConvertFrom-Json } catch { Fail "invalid checkpoint JSON: $Path" }
  if ($null -eq $doc.version -or $doc.version -ne 1) { Fail 'checkpoint version must be 1' }
  foreach ($f in @('task_id','role','agent_id','frozen_policy','frozen_provider_model','stats','stop_reason','injected_artifacts','contract_path','contract_version','resume_allowed')) {
    if ($null -eq $doc.$f) { Fail "checkpoint missing field: $f" }
  }
  return $doc
}
function Resume-From-Checkpoint([string]$TaskId,[string]$CheckpointPath,[string]$Role) {
  Assert-Setup; $s = Read-State $TaskId
  if ($s.execution_status -ne 'active') { Fail 'task is not active' }
  if ($s.PSObject.Properties.Name -notcontains 'frozen_provider_model' -or $null -eq $s.frozen_provider_model) { Fail 'task state is missing frozen_provider_model; resume-checkpoint requires a frozen provider/model' }
  Assert-NoLiveRoleProcesses $s
  $doc = Read-Checkpoint $CheckpointPath
  if ($doc.task_id -ne $TaskId) { Fail "checkpoint task_id mismatch: expected $TaskId, got $($doc.task_id)" }
  if ($doc.resume_allowed -ne $true) { Fail 'checkpoint does not allow resume' }
  if ($Role -notin @('executor','reviewer')) { Fail "resume-checkpoint role must be executor or reviewer; got $Role" }
  $frozen = $s.frozen_provider_model
  $docFrozen = $doc.frozen_provider_model
  if ($docFrozen.provider -ne $frozen.provider -or $docFrozen.model -ne $frozen.model) { Fail "checkpoint frozen provider/model does not match task state: checkpoint=$($docFrozen.provider)/$($docFrozen.model), state=$($frozen.provider)/$($frozen.model)" }
  # New session ID for the resumed role; old sessions are intentionally retired.
  $oldSession = $s.sessions.$Role.session_id
  $s.sessions.$Role | Add-Member -NotePropertyName session_id -NotePropertyValue (New-Id) -Force
  $s.sessions.$Role | Add-Member -NotePropertyName previous_session_id -NotePropertyValue $oldSession -Force
  $s | Add-Member -NotePropertyName resumed_from_checkpoint -NotePropertyValue ([IO.Path]::GetFullPath($CheckpointPath)) -Force
  $s | Add-Member -NotePropertyName resumed_at -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
  Write-State $s
  $contract = Parse-Contract $s.contract_path
  $context = New-RoleContext $contract $Role 'resume'
  $artifacts = ($doc.injected_artifacts | ForEach-Object { [string]$_ }) -join '; '
  $summary = "Resume from checkpoint $($doc.stop_reason.code): $($doc.stop_reason.message). Frozen policy: threshold_percent=$($doc.frozen_policy.threshold_percent), max_tool_calls_per_segment=$($doc.frozen_policy.max_tool_calls_per_segment), max_compact_retries=$($doc.frozen_policy.max_compact_retries), output_token_limit=$($doc.frozen_policy.output_token_limit). Stats: tool_calls=$($doc.stats.tool_calls_in_segment), compaction_attempts=$($doc.stats.compaction_attempts), compaction_completed=$($doc.stats.compaction_completed), segment_count=$($doc.stats.segment_count). Injected artifacts: $artifacts. Contract snapshot: $((Split-Path $s.contract_path -Leaf)). Frozen provider/model: $($frozen.provider)/$($frozen.model). New session_id has been minted; previous session id was retired."
  $prompt = "$context $summary You are $Role. Lead-initiated explicit checkpoint resume: continue the assigned work using the injected contract snapshot, the frozen provider/model, the frozen policy, and the listed worktree-relative artifacts. Do not request a different provider or model."
  $allowedDelegations = @($s.runtime_delegations.PSObject.Properties | ForEach-Object { [string]$_.Value }) -join ','
  Launch-Role $s $Role $prompt $s.sessions.$Role.session_id $frozen.provider $frozen.model $false $allowedDelegations
  Event $s $Role 'working' "resume from checkpoint $($doc.stop_reason.code)" '' ''
  Write-Output "RESUMED_CHECKPOINT $TaskId role=$Role previous_session=$oldSession new_session=$($s.sessions.$Role.session_id)"
}
function Read-OutcomeFile([string]$Path,[string]$Expected='') { if (-not(Test-Path -LiteralPath $Path)) { Fail "outcome file not found: $Path" }; try { $x=Get-Content -Raw -Encoding UTF8 -LiteralPath $Path | ConvertFrom-Json } catch { Fail "invalid outcome file: $Path" }; if ($Expected -and $x.outcome -ne $Expected) { Fail "outcome file must declare outcome=$Expected" }; return $x }
function Assert-MissingCriteria($Contract,$Evidence) {
  if ([string]::IsNullOrWhiteSpace([string]$Evidence.reason)) { Fail 'incomplete closure requires reason' }
  if ([string]::IsNullOrWhiteSpace([string]$Evidence.next_step)) { Fail 'incomplete closure requires next_step' }
}
function Accept([string]$TaskId,[string]$EvidencePath) {
  $s=Read-State $TaskId; if ($s.execution_status -ne 'active' -or $s.outcome -ne 'pending') { Fail 'task is not awaiting acceptance' }
  $e=Read-OutcomeFile $EvidencePath 'accepted'; $reviewerWarning=$null
  try { Assert-ReviewerReadyForAcceptance $TaskId } catch { $reviewerWarning = "reviewer_gate_not_converged:$($_.Exception.Message)" }
  if ([string]::IsNullOrWhiteSpace([string]$e.rationale)) { Fail 'accepted outcome requires rationale' }
  if ($e.PSObject.Properties.Name -contains 'inspect_path' -and -not [string]::IsNullOrWhiteSpace([string]$e.inspect_path)) { Assert-RelativeArtifactPath ([string]$e.inspect_path) 'inspect_path' }
  Invoke-BlackboardLifecycle 'accept' $TaskId
  $s.outcome='accepted'; $s | Add-Member -NotePropertyName accepted_at -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force; $s | Add-Member -NotePropertyName acceptance_path -NotePropertyValue ((Resolve-Path $EvidencePath).Path) -Force; if($reviewerWarning){Add-StateProperty $s 'acceptance_warnings' @($reviewerWarning)}; Write-State $s; Write-Output "ACCEPTED $TaskId"
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
function Add-StateProperty($State,[string]$Name,$Value) {
  if ($State.PSObject.Properties.Name -contains $Name) { $State.$Name = $Value }
  else { $State | Add-Member -NotePropertyName $Name -NotePropertyValue $Value }
}
function Get-TaskLockPath([string]$TaskId) { return Join-Path (StateRoot) "$TaskId.finalize.lock" }
function Enter-TaskFinalizeLock([string]$TaskId) {
  $lock = Get-TaskLockPath $TaskId
  if (Test-Path -LiteralPath $lock) {
    $ownerPath = Join-Path $lock 'owner.json'
    $owner = $null
    try { if (Test-Path -LiteralPath $ownerPath) { $owner = Get-Content -Raw -LiteralPath $ownerPath | ConvertFrom-Json } } catch { $owner = $null }
    $ownerLive = $false
    if ($owner -and $owner.pid) { $ownerLive = $null -ne (Get-Process -Id ([int]$owner.pid) -ErrorAction SilentlyContinue) }
    if ($ownerLive) { Fail "finalize already running for task $TaskId (pid=$($owner.pid))" }
    Remove-Item -LiteralPath $lock -Recurse -Force -ErrorAction SilentlyContinue
  }
  try { New-Item -ItemType Directory -Path $lock -ErrorAction Stop | Out-Null } catch { Fail "unable to acquire finalize lock for task $TaskId" }
  [ordered]@{task_id=$TaskId;pid=$PID;started_at=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Compress | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $lock 'owner.json')
  return $lock
}
function Exit-TaskFinalizeLock([string]$Lock) { if ($Lock -and (Test-Path -LiteralPath $Lock)) { Remove-Item -LiteralPath $Lock -Recurse -Force -ErrorAction SilentlyContinue } }
function Get-WorktreeChanges([string]$Worktree) {
  $lines = @(git.exe '-C' $Worktree 'status' '--porcelain=v1' '--untracked-files=all' 2>&1)
  if ($LASTEXITCODE -ne 0) { Fail (($lines -join "`n").Trim()) }
  $changes = @()
  foreach ($line in $lines) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line.Length -lt 4) { Fail "unable to parse worktree status: $line" }
    $path = $line.Substring(3).Trim()
    if ($path.StartsWith('"') -or $path -match ' -> ') { Fail "unsupported quoted or renamed path in worktree status: $path" }
    $changes += [pscustomobject]@{ status=$line.Substring(0,2); path=($path -replace '\\','/') }
  }
  return @($changes)
}
function Get-ContractGitHubIssue($Contract) {
  if ($Contract.PSObject.Properties.Name -contains 'github_issue' -and [string]$Contract.github_issue -match '^[0-9]+$') { return [int]$Contract.github_issue }
  if ($Contract.PSObject.Properties.Name -contains 'source' -and $Contract.source -and $Contract.source.number -match '^[0-9]+$') { return [int]$Contract.source.number }
  $text = "$($Contract.name)`n$($Contract.objective)"
  if ($text -match '(?i)(?:GitHub\s+)?Issue\s*#\s*([0-9]+)') { return [int]$Matches[1] }
  return $null
}
function Save-FinalizeReport($State) {
  $dir = Join-Path (StateRoot) 'finalization'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $path = Join-Path $dir "$($State.task_id).json"
  $State.finalization | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 -LiteralPath $path
  return $path
}
function Set-FinalizationState($State,$Finalization,[string]$Status,[string]$Reason='') {
  $Finalization.status = $Status
  if ($Status -in @('running','succeeded')) { $Finalization.failure_reason = $null }
  if ($Reason) { $Finalization.failure_reason = $Reason }
  Add-StateProperty $State 'finalization' $Finalization
  Write-State $State
  Save-FinalizeReport $State | Out-Null
}
function Sync-FinalizeGitHubIssue($Contract,[string]$TaskId,[string]$Commit) {
  $number = Get-ContractGitHubIssue $Contract
  if ($null -eq $number) { return [pscustomobject]@{ synced=$true; mode='not_applicable'; state='none'; issue_number=$null; error='' } }
  $gh = Get-Command gh.exe -ErrorAction SilentlyContinue
  if (-not $gh) { return [pscustomobject]@{ synced=$false; mode='blocked'; state='unknown'; issue_number=$number; error='gh CLI is unavailable' } }
  $raw = @(& $gh.Source 'issue' 'view' "$number" '--json' 'state,title,url' 2>&1)
  if ($LASTEXITCODE -ne 0) { return [pscustomobject]@{ synced=$false; mode='blocked'; state='missing'; issue_number=$number; error=(Redact-SensitiveText (($raw -join "`n").Trim())) } }
  try { $issue = ($raw -join "`n") | ConvertFrom-Json } catch { return [pscustomobject]@{ synced=$false; mode='blocked'; state='unknown'; issue_number=$number; error='gh returned invalid JSON' } }
  if ([string]$issue.state -eq 'CLOSED') { return [pscustomobject]@{ synced=$true; mode='closed_externally'; state='closed'; issue_number=$number; error='' } }
  $comment = "Pi Team task $TaskId was accepted and integrated in commit $Commit. Tests and lifecycle cleanup completed by pi-team finalizer."
  $result = @(& $gh.Source 'issue' 'close' "$number" '--comment' $comment 2>&1)
  if ($LASTEXITCODE -ne 0) { return [pscustomobject]@{ synced=$false; mode='blocked'; state='open'; issue_number=$number; error=(Redact-SensitiveText (($result -join "`n").Trim())) } }
  return [pscustomobject]@{ synced=$true; mode='closed'; state='closed'; issue_number=$number; error='' }
}
function Invoke-FinalizeTests([string]$Worktree) {
  $runner = Join-Path $Worktree 'tests/run-tests.ps1'
  if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) { return [pscustomobject]@{ passed=$true; skipped=$true; output='tests/run-tests.ps1 not found' } }
  $previousProjectRoot = $env:PI_TEAM_PROJECT_ROOT
  Push-Location $Worktree
  try {
    Remove-Item Env:PI_TEAM_PROJECT_ROOT -ErrorAction SilentlyContinue
    $output = @(& powershell.exe '-NoLogo' '-NoProfile' '-ExecutionPolicy' 'Bypass' '-File' $runner 2>&1)
    $text = ($output -join "`n")
    return [pscustomobject]@{ passed=($LASTEXITCODE -eq 0); skipped=$false; output=$text.Substring(0,[Math]::Min(4000,$text.Length)) }
  } finally {
    if ($null -eq $previousProjectRoot) { Remove-Item Env:PI_TEAM_PROJECT_ROOT -ErrorAction SilentlyContinue } else { $env:PI_TEAM_PROJECT_ROOT = $previousProjectRoot }
    Pop-Location
  }
}
function New-InspectCheck([string]$Status,[string]$Detail,[object]$Data=$null) {
  $x=[ordered]@{status=$Status;detail=$Detail}; if ($null -ne $Data) { $x.data=$Data }; return [pscustomobject]$x
}
function Read-BlackboardObservation([string]$TaskId) {
  try {
    $task=Get-BlackboardTask $TaskId
    $warnings=@(); $agents=@($task.agents)
    foreach ($agent in $agents) { if ([string]$agent.state -in @('working','reviewing','ready_for_review','ready_for_acceptance','blocked')) { $warnings += "blackboard_agent_state:$($agent.role)=$($agent.state)" } }
    if ([string]$task.status -ne 'active') { $warnings += "blackboard_task_status=$($task.status)" }
    return [pscustomobject]@{status=if($warnings.Count -gt 0){'warning'}else{'observed'};state=[string]$task.status;agents=$agents;warnings=$warnings;error=$null}
  } catch {
    return [pscustomobject]@{status='warning';state='unavailable';agents=@();warnings=@('blackboard_observation_unavailable');error=(Redact-SensitiveText $_.Exception.Message)}
  }
}
function Save-InspectionOutput([string]$Path,$Result) {
  $full=[IO.Path]::GetFullPath($Path); $dir=Split-Path -Parent $full; New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $tmp=Join-Path $dir ('.inspect.'+[guid]::NewGuid().ToString('N')+'.tmp')
  try { $Result | ConvertTo-Json -Depth 30 | Set-Content -Encoding UTF8 -LiteralPath $tmp; Move-Item -LiteralPath $tmp -Destination $full -Force } finally { if(Test-Path -LiteralPath $tmp){Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue} }
  return $full
}
function Inspect([string]$TaskId,[string]$Option1,[string]$Option2,[string]$Option3,[string]$Option4) {
  $json=$false; $skipTests=$false; $outputPath=$null; $options=@($Option1,$Option2,$Option3,$Option4) | Where-Object { $_ -ne $null -and $_ -ne '' }
  for($i=0;$i -lt $options.Count;$i++) {
    switch ([string]$options[$i]) {
      '--json' { $json=$true }
      '--skip-tests' { $skipTests=$true }
      '--output' { $i++; if($i -ge $options.Count){Fail '--output requires a path'}; $outputPath=[string]$options[$i] }
      default { Fail "unknown inspect option: $($options[$i])" }
    }
  }
  $failures=@(); $warnings=@(); $checks=[ordered]@{}; $s=$null; $contract=$null
  try { $s=Read-State $TaskId; $checks.state=New-InspectCheck 'passed' "outcome=$($s.outcome), execution_status=$($s.execution_status)" } catch { $failures += $_.Exception.Message; $checks.state=New-InspectCheck 'failed' $_.Exception.Message }
  if($s) {
    try { $contract=Parse-Contract $s.contract_path; $checks.contract=New-InspectCheck 'passed' 'contract parsed' } catch { $failures += $_.Exception.Message; $checks.contract=New-InspectCheck 'failed' $_.Exception.Message }
  }
  if($s -and $contract) {
    $currentBranch=Git @('-C',$ProjectRoot,'branch','--show-current'); $taskBranch=''; $targetExists=$false; $baseCompatible=$false
    try { $taskBranch=Git @('-C',$s.worktree,'branch','--show-current') } catch { $taskBranch='' }
    try { Git @('-C',$ProjectRoot,'rev-parse','--verify',"refs/heads/$($contract.base_ref)") | Out-Null; $targetExists=$true } catch {}
    try { Git @('-C',$s.worktree,'merge-base','--is-ancestor',$contract.base_ref,'HEAD') | Out-Null; $baseCompatible=$true } catch {}
    if($currentBranch -ne [string]$contract.base_ref){$failures += "current branch $currentBranch does not match contract base_ref $($contract.base_ref)"}
    if(-not $targetExists){$failures += "contract base_ref does not exist: $($contract.base_ref)"}
    if(-not $baseCompatible){$failures += "task branch is not based on contract base_ref: $($contract.base_ref)"}
    $checks.branch=New-InspectCheck $(if($failures | Where-Object {$_ -match 'branch|base_ref'}){'failed'}else{'passed'}) "target=$currentBranch task_branch=$taskBranch base_ref=$($contract.base_ref)" ([pscustomobject]@{target_branch=$currentBranch;task_branch=$taskBranch;base_ref=$contract.base_ref;base_compatible=$baseCompatible})
    if(-not (Test-Path -LiteralPath $s.worktree -PathType Container)){ $failures += "task worktree missing: $($s.worktree)"; $checks.worktree=New-InspectCheck 'failed' 'worktree missing' } else { $checks.worktree=New-InspectCheck 'passed' $s.worktree }
    $targetDirty=Git @('-C',$ProjectRoot,'status','--porcelain','--untracked-files=all'); if($targetDirty){$failures += 'target worktree is dirty'}; $checks.target_clean=New-InspectCheck $(if($targetDirty){'failed'}else{'passed'}) $(if($targetDirty){'target worktree has uncommitted changes'}else{'target worktree clean'})
    if(Test-Path -LiteralPath $s.worktree -PathType Container){
      $changes=@(Get-WorktreeChanges $s.worktree)
      $checks.changes=New-InspectCheck 'observed' "changes=$($changes.Count)" ([pscustomobject]@{changes=$changes})
      $artifactRoots=@('implementation_notes','research','reports','failures')
      $artifacts=@(); foreach($root in $artifactRoots){$full=Join-Path $s.worktree $root; if(Test-Path -LiteralPath $full -PathType Container){$artifacts += @(Get-ChildItem -LiteralPath $full -File -Recurse | ForEach-Object { $_.FullName.Substring($s.worktree.Length).TrimStart('\','/') -replace '\\','/' })}}
      $checks.artifacts=New-InspectCheck 'observed' "artifacts=$($artifacts.Count)" ([pscustomobject]@{declared=$contract.deliverables;observed=$artifacts})
    }
    $contaminated=@(); foreach($path in @('AGENTS.md','README.md','architect.md','goal.md','project_state.md','plugins/agent-blackboard/skills/pi-team-lead/SKILL.md')) { $full=Join-Path $s.worktree $path; if(Test-Path -LiteralPath $full -PathType Leaf){ $text=Get-Content -Raw -Encoding UTF8 -LiteralPath $full; if($text -match [regex]::Escape($TaskId) -or $text -match [regex]::Escape((Split-Path $s.worktree -Leaf))){$contaminated += $path} } }; if($contaminated.Count){$failures += 'reusable content contains task-specific identifiers'}; $checks.reusable_content=New-InspectCheck $(if($contaminated.Count){'failed'}else{'passed'}) "contaminated=$($contaminated.Count)" $contaminated
    if($skipTests){$warnings += 'tests_skipped'; $checks.tests=New-InspectCheck 'skipped' 'tests skipped by Lead option'} else { $test=Invoke-FinalizeTests $s.worktree; if(-not $test.passed -and -not $test.skipped){$failures += 'standard tests failed'}; $checks.tests=New-InspectCheck $(if($test.skipped){'skipped'}elseif($test.passed){'passed'}else{'failed'}) $(if($test.skipped){$test.output}elseif($test.passed){'standard tests passed'}else{'standard tests failed'}) ([pscustomobject]@{passed=$test.passed;skipped=$test.skipped;output=$test.output}) }
    $processes=@(); foreach($role in @('executor','reviewer','researcher')) { if($s.sessions.PSObject.Properties.Name -contains $role){ $runtime=Read-Runtime $s $role; $live=Test-RuntimeLive $runtime; $processes += [pscustomobject]@{role=$role;live=$live;pid=$runtime.runtime_pid}; if($live){$warnings += "live_task_process:$role"} } }; $checks.processes=New-InspectCheck $(if(@($processes|Where-Object live).Count){'warning'}else{'passed'}) 'task-owned process inventory' $processes
    $bb=Read-BlackboardObservation $TaskId; $warnings += @($bb.warnings); $checks.blackboard=New-InspectCheck $bb.status "state=$($bb.state)" $bb
    $issue=Get-ContractGitHubIssue $contract; if($null -ne $issue){$gh=Get-Command gh.exe -ErrorAction SilentlyContinue; if($gh){$raw=@(& $gh.Source 'issue' 'view' "$issue" '--json' 'state,title,url' 2>&1); if($LASTEXITCODE -eq 0){$checks.github=New-InspectCheck 'passed' "issue #$issue read" (($raw -join "`n")|ConvertFrom-Json)}else{$warnings += 'github_issue_unavailable';$checks.github=New-InspectCheck 'warning' "issue #$issue unavailable"}}else{$warnings += 'github_cli_unavailable';$checks.github=New-InspectCheck 'warning' 'gh CLI unavailable'}}
  }
  $status=if($failures.Count){'blocked'}elseif($warnings.Count){'warnings'}else{'ready'}; $result=[pscustomobject][ordered]@{task_id=$TaskId;status=$status;checks=$checks;warnings=@($warnings|Sort-Object -Unique);failures=@($failures|Sort-Object -Unique);test_result=$checks.tests;blackboard=$checks.blackboard}
  if($outputPath){$saved=Save-InspectionOutput $outputPath $result; $result | Add-Member -NotePropertyName output_path -NotePropertyValue $saved }
  if($json){$result|ConvertTo-Json -Depth 30}else{ Write-Output "INSPECT $TaskId status=$status"; foreach($name in $checks.Keys){Write-Output ("- {0}: {1} ({2})" -f $name,$checks[$name].status,$checks[$name].detail)}; if($warnings.Count){Write-Output ("Warnings: "+(@($warnings|Sort-Object -Unique)-join '; '))}; if($failures.Count){Write-Output ("Failures: "+(@($failures|Sort-Object -Unique)-join '; '))}; if($outputPath){Write-Output "Report: $outputPath"} }
  if($status -eq 'blocked'){$global:LASTEXITCODE=1}else{$global:LASTEXITCODE=0}
}
function Finalize-Task([string]$TaskId,[string]$Option,[string]$TargetBranchArg) {
  $lock=$null; $s=$null; $finalization=$null; $contract=$null; $hardFailure=$null
  try {
    $requested=$null; if($Option){if($Option -ne '--target-branch'){Fail "unknown finalize option: $Option"}; if([string]::IsNullOrWhiteSpace($TargetBranchArg)){Fail '--target-branch requires a branch'}; $requested=$TargetBranchArg}
    $lock=Enter-TaskFinalizeLock $TaskId; $s=Read-State $TaskId
    if($s.finalization -and $s.finalization.status -eq 'succeeded' -and -not $requested){return $s.finalization}
    if($s.outcome -notin @('accepted','incomplete')){Fail 'task must be accepted or closed incomplete before finalize'}
    $contract=Parse-Contract $s.contract_path
    if([IO.Path]::GetFullPath($s.worktree) -ieq [IO.Path]::GetFullPath($ProjectRoot)){Fail 'cannot finalize the main worktree'}
    $finalization=Ensure-FinalizationShape $s.finalization ([string]$contract.base_ref); Add-StateProperty $s 'finalization' $finalization
    $target=[string]$contract.base_ref; $source='contract'
    if($requested){$target=$requested; $source='lead_override'}
    elseif($finalization.target_branch_source -eq 'lead_override' -and $finalization.target_branch){$target=[string]$finalization.target_branch; $source='lead_override'}
    if($finalization.target_branch_source -eq 'lead_override' -and $finalization.target_branch -and $target -ne [string]$finalization.target_branch){Fail "finalize target branch is frozen to $($finalization.target_branch)"}
    $finalization.target_branch=$target; $finalization.target_branch_source=$source; $finalization.phase='preflight'; Set-FinalizationState $s $finalization 'running'
    try { Git @('-C',$ProjectRoot,'rev-parse','--verify',"refs/heads/$target") | Out-Null } catch { Fail "target branch does not exist: $target" }
    $current=Git @('-C',$ProjectRoot,'branch','--show-current'); if($current -ne $target){Fail "finalize must run from target branch $target (current=$current)"}
    if(Git @('-C',$ProjectRoot,'status','--porcelain','--untracked-files=all')){Fail 'target worktree is dirty; refusing integration'}
    $bb=Read-BlackboardObservation $TaskId; $finalization.blackboard.status=$bb.status; $finalization.blackboard.state=$bb.state; $finalization.blackboard.archived=$false; if($bb.warnings.Count){$finalization.warnings=@($finalization.warnings+$bb.warnings|Sort-Object -Unique)}
    $finalization.phase='resource_reclaim'; Stop-RoleTree $s.sessions.executor; Stop-RoleTree $s.sessions.reviewer; if($s.sessions.PSObject.Properties.Name -contains 'researcher'){Stop-RoleTree $s.sessions.researcher}; $finalization.terminals_reclaimed=$true; $finalization.cleanup.terminals_reclaimed=$true; Add-StateProperty $s 'finalization' $finalization; Write-State $s
    $needsWorktree=-not [bool]$finalization.worktree_removed -and -not [bool]$finalization.merged_to_target
    if($needsWorktree -and -not(Test-Path -LiteralPath $s.worktree -PathType Container)){Fail "task worktree is missing: $($s.worktree)"}
    $changes=if($needsWorktree){@(Get-WorktreeChanges $s.worktree)}else{@()}; $branch=[string]$contract.branch
    if($needsWorktree){try{Git @('-C',$s.worktree,'merge-base','--is-ancestor',$contract.base_ref,'HEAD')|Out-Null}catch{Fail "task branch is not based on contract base_ref: $($contract.base_ref)"}}
    $ahead=if($needsWorktree){[int](Git @('-C',$s.worktree,'rev-list','--count',"$target..HEAD"))}else{0}
    if($s.outcome -eq 'accepted'){
      if(-not $finalization.merged_to_target){
        if($ahead -gt 0){Fail 'task branch already contains commits; finalizer will not rewrite agent commits'}
        if($changes.Count -eq 0){Fail 'accepted task has no worktree changes to integrate'}
        $finalization.phase='integration_commit'; foreach($change in $changes){Invoke-Native git.exe @('-C',$s.worktree,'add','--',$change.path)|Out-Null}; $staged=@(Git @('-C',$s.worktree,'diff','--cached','--name-only')); if($staged.Count -eq 0){Fail 'accepted task has no staged changes to integrate'}
        Invoke-Native git.exe @('-C',$s.worktree,'commit','-m',"pi-team: integrate $TaskId")|Out-Null; $commit=Git @('-C',$s.worktree,'rev-parse','HEAD'); $finalization.integration_commit=$commit; $finalization.integration.commit=$commit; $finalization.integration.status='committed'; Add-StateProperty $s 'finalization' $finalization; Write-State $s
        $finalization.phase='integration_merge'; try{Invoke-Native git.exe @('-C',$ProjectRoot,'merge','--no-ff','--no-edit',$branch)|Out-Null}catch{try{& git.exe '-C' $ProjectRoot 'merge' '--abort' 2>&1|Out-Null}catch{};throw}; $finalization.merged_to_target=$true; $finalization.integration.merged=$true; $finalization.integration.status='succeeded'
      }
      if(-not $finalization.tests_passed){$finalization.phase='tests'; $test=Invoke-FinalizeTests $ProjectRoot; $finalization.tests.passed=$test.passed; $finalization.tests.skipped=$test.skipped; $finalization.tests.output=$test.output; $finalization.tests.status=if($test.skipped){'skipped'}elseif($test.passed){'passed'}else{'failed'}; $finalization.tests_passed=$test.passed; if(-not $test.passed -and -not $test.skipped){Fail "integration tests failed: $($test.output)"}}
    } else {if($changes.Count -gt 0){Fail 'incomplete task has uncommitted changes; preserve worktree for manual recovery'}; $finalization.tests_passed=$true; $finalization.tests.status='not_applicable'}
    $finalization.phase='cleanup'; if(-not $finalization.worktree_removed){Invoke-Native git.exe @('-C',$ProjectRoot,'worktree','remove',$s.worktree)|Out-Null; $finalization.worktree_removed=$true; $finalization.cleanup.worktree_removed=$true}; if(-not $finalization.branch_removed){$exists=Git @('-C',$ProjectRoot,'branch','--list',$branch); if($exists){Invoke-Native git.exe @('-C',$ProjectRoot,'branch','-d',$branch)|Out-Null}; $finalization.branch_removed=$true; $finalization.cleanup.branch_removed=$true}; $finalization.cleanup.status='succeeded'
    $finalization.phase='github'; $github=Sync-FinalizeGitHubIssue $contract $TaskId ([string]$finalization.integration_commit); $finalization.github_issue_number=$github.issue_number; $finalization.github_issue_synced=$github.synced; $finalization.github_sync_mode=$github.mode; $finalization.github.issue_number=$github.issue_number; $finalization.github.synced=$github.synced; $finalization.github.mode=$github.mode; $finalization.github.status=if($github.synced){'succeeded'}else{'blocked'}; if(-not $github.synced){$hardFailure="GitHub synchronization failed: $($github.error)"}
    $finalization.phase='blackboard'; try{Invoke-BlackboardLifecycle 'archive' $TaskId; $finalization.blackboard_archived=$true; $finalization.blackboard.archived=$true; $finalization.blackboard.status='succeeded'}catch{$finalization.warnings=@($finalization.warnings+'blackboard_archive_failed'|Sort-Object -Unique);$finalization.blackboard.status='warning'}
    $s.execution_status='cleaned'; Add-StateProperty $s 'finalization' $finalization; if($hardFailure){Set-FinalizationState $s $finalization 'blocked' $hardFailure}else{Set-FinalizationState $s $finalization 'succeeded'}; return $finalization
  } catch { $hardFailure=Redact-SensitiveText $_.Exception.Message; if($s -and $finalization){$finalization.failure_reason=$hardFailure; $finalization.rollback.status='available'; Set-FinalizationState $s $finalization 'blocked' $hardFailure}; if($finalization){return $finalization}; return [pscustomobject][ordered]@{status='blocked';task_id=$TaskId;warnings=@();failures=@($hardFailure);rollback=[pscustomobject]@{status='available';action='retry_from_last_completed_phase'}}
  } finally {Exit-TaskFinalizeLock $lock}
}
function Reclaim([string]$TaskId) { $s=Read-State $TaskId; if ($s.outcome -notin @('accepted','incomplete')) { Fail 'task must be accepted or closed incomplete before reclaim' }; Assert-NoLiveRoleProcesses $s; $s.execution_status='reclaimed'; $s | Add-Member -NotePropertyName reclaimed_at -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force; Write-State $s; Invoke-BlackboardLifecycle 'archive' $TaskId; Write-Output "RECLAIMED $TaskId" }
function Cleanup([string]$TaskId) { $s=Read-State $TaskId; if ($s.execution_status -ne 'reclaimed') { Fail 'task must be reclaimed before cleanup' }; $dirty=Git @('-C',$s.worktree,'status','--porcelain'); if ($dirty) { Fail 'worktree is not clean' }; if ([IO.Path]::GetFullPath($s.worktree) -ieq [IO.Path]::GetFullPath($ProjectRoot)) { Fail 'cannot remove main worktree' }; Invoke-Native git.exe @('-C',$ProjectRoot,'worktree','remove',$s.worktree); $s.execution_status='cleaned'; Write-State $s; Write-Output "CLEANED $TaskId" }
switch ($Command.ToLowerInvariant()) { 'setup' {Setup}; 'codex-setup' {Setup-Codex}; 'doctor' {Doctor}; 'inventory' {Inventory $Arg1}; 'preflight' {Preflight $Arg1 $Arg2}; 'publish' {Publish $Arg1}; 'validate' {Validate $Arg1}; 'start' {Start-Task $Arg1}; 'sync' {Sync-Task $Arg1}; 'research' {Research $Arg1 $Arg2}; 'status' {Status $Arg1}; 'watch' {Status $Arg1}; 'inspect' {Inspect $Arg1 $Arg2 $Arg3 $Arg4 $Arg5}; 'resume' {Resume-Task $Arg1}; 'resume-checkpoint' {Resume-From-Checkpoint $Arg1 $Arg2 $Arg3}; 'accept' {Accept $Arg1 $Arg2}; 'close-incomplete' {Close-Incomplete $Arg1 $Arg2}; 'reconcile' {Reconcile $Arg1 $Arg2}; 'finalize' {$result=Finalize-Task $Arg1 $Arg2 $Arg3; $result|ConvertTo-Json -Depth 30; if($result.status -eq 'blocked'){exit 1}}; 'reclaim' {Reclaim $Arg1}; 'cleanup' {Cleanup $Arg1}; default { Fail "unknown command: $Command" } }
