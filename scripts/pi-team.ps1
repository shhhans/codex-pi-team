[CmdletBinding()]
param([Parameter(Position=0,ValueFromRemainingArguments=$true)][string[]]$Arguments)
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'pi-team-v2.mjs') @Arguments
exit $LASTEXITCODE
