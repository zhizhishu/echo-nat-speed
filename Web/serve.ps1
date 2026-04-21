$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonCandidates = @("python", "python3", "py")

foreach ($candidate in $pythonCandidates) {
    $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($cmd) {
        & $cmd.Source (Join-Path $scriptDir "serve.py") @args
        exit $LASTEXITCODE
    }
}

Write-Error "Python 3 is required to run serve.py. Install Python and try again."
exit 1
