$ErrorActionPreference = 'Stop'
$tsx = Join-Path $PSScriptRoot '..\.pi\npm\node_modules\.bin\tsx.cmd'
& $tsx --test (Join-Path $PSScriptRoot 'agent-communication.test.mjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

