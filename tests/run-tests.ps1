$ErrorActionPreference = 'Stop'
Push-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
try {
# Wipe leftover state files and orphan branches from any interrupted
# previous runs so the deterministic suite can start from a clean slate.
& node (Join-Path $PSScriptRoot 'cleanup.mjs')
if ($LASTEXITCODE -ne 0) { Fail "test cleanup failed: $LASTEXITCODE" }
$tsx = Join-Path $PWD '.pi\npm\node_modules\.bin\tsx.cmd'
if (Test-Path -LiteralPath $tsx) {
  & $tsx --test (Join-Path $PSScriptRoot 'team-contract.test.mjs') (Join-Path $PSScriptRoot 'communication-policy.test.mjs') (Join-Path $PSScriptRoot 'blackboard.test.mjs') (Join-Path $PSScriptRoot 'compression.test.mjs') (Join-Path $PSScriptRoot 'automatic-compression.test.mjs') (Join-Path $PSScriptRoot 'blackboard-protocol.test.mjs')
} else {
  & node --test (Join-Path $PSScriptRoot 'team-contract.test.mjs') (Join-Path $PSScriptRoot 'communication-policy.test.mjs') (Join-Path $PSScriptRoot 'blackboard.test.mjs') (Join-Path $PSScriptRoot 'compression.test.mjs') (Join-Path $PSScriptRoot 'automatic-compression.test.mjs') (Join-Path $PSScriptRoot 'blackboard-protocol.test.mjs')
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally { Pop-Location }
