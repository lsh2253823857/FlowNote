param(
    [Parameter(Mandatory=$true)][string]$Recording,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-z0-9]+(-[a-z0-9]+)*$')][string]$Name,
    [string]$Output = (Join-Path $env:USERPROFILE '.codex\skills')
)
$ErrorActionPreference = 'Stop'
$runtime = Get-Command python -ErrorAction SilentlyContinue
$bundled = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (Test-Path -LiteralPath $bundled) { $pythonPath = $bundled }
elseif ($runtime) { $pythonPath = $runtime.Source }
else { throw 'Python 3.10+ is required. Ask Codex to locate its bundled Python runtime, or install Python.' }
& $pythonPath (Join-Path $PSScriptRoot 'recording_to_skill.py') $Recording --name $Name --output $Output
if ($LASTEXITCODE -ne 0) { throw 'Conversion failed. See the error above.' }
