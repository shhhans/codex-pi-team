$ErrorActionPreference = 'Stop'
Push-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
try {
$tsx = Join-Path $PWD '.pi\npm\node_modules\.bin\tsx.cmd'
if (Test-Path -LiteralPath $tsx) {
  & $tsx --test (Join-Path $PSScriptRoot 'team-contract.test.mjs') (Join-Path $PSScriptRoot 'communication-policy.test.mjs') (Join-Path $PSScriptRoot 'blackboard.test.mjs')
} else {
  & node --test (Join-Path $PSScriptRoot 'team-contract.test.mjs') (Join-Path $PSScriptRoot 'communication-policy.test.mjs') (Join-Path $PSScriptRoot 'blackboard.test.mjs')
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally { Pop-Location }
