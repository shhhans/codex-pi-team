$ErrorActionPreference = 'Stop'
$tsx = Join-Path $PSScriptRoot '..\.pi\npm\node_modules\.bin\tsx.cmd'
& $tsx --test (Join-Path $PSScriptRoot 'agent-communication.test.mjs') (Join-Path $PSScriptRoot 'context-management.test.mjs') (Join-Path $PSScriptRoot 'deep-research-mcp-adapter.test.mjs') (Join-Path $PSScriptRoot 'gptr-mcp-negative-control.mjs') (Join-Path $PSScriptRoot 'seed-contract.test.mjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
