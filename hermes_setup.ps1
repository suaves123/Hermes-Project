param(
    [ValidateSet('Local', 'Tailscale', 'Api')]
    [string]$Mode
)

$ErrorActionPreference = 'Stop'

function Resolve-Executable {
    param([string]$Name, [string[]]$Paths)
    foreach ($path in $Paths) {
        if ($path -and (Test-Path -LiteralPath $path -PathType Leaf)) {
            (Get-Item -LiteralPath $path).FullName
        }
    }
    Get-Command -Name $Name -CommandType Application -ErrorAction SilentlyContinue |
        ForEach-Object { $_.Source }
}

function Install-Package {
    param([string]$Id)
    $winget = Get-Command winget.exe -CommandType Application -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "WinGet is missing. Install or update App Installer from the Microsoft Store, then run this file again. Required package: $Id"
    }
    Write-Host "Installing $Id..."
    & $winget.Source install --id $Id --exact --source winget --accept-package-agreements --accept-source-agreements
    $result = $LASTEXITCODE
    if ($result -ne 0) {
        throw "WinGet could not install $Id (exit code $result). Check the WinGet message and run the installer again."
    }
    # Keep paths already inherited by this process and pick up changes made by installers.
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$env:Path;$machinePath;$userPath"
}

function Test-Executable {
    param([string]$Path, [string[]]$Arguments)
    $ErrorActionPreference = 'Continue'
    & $Path @Arguments 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Find-PHP {
    $paths = @($env:PHP_EXE, 'C:\php\php.exe')
    foreach ($base in @("$env:LOCALAPPDATA\Microsoft\WinGet", "$env:ProgramFiles\WinGet")) {
        $paths += "$base\Links\php.exe"
        $paths += @(Get-ChildItem -Path "$base\Packages\PHP.PHP.8.4_*" -Directory -ErrorAction SilentlyContinue |
            ForEach-Object { Get-ChildItem -Path $_.FullName -Filter php.exe -File -Recurse -ErrorAction SilentlyContinue } |
            ForEach-Object { $_.FullName })
    }
    foreach ($path in (Resolve-Executable php.exe $paths | Select-Object -Unique)) {
        if (Test-Executable $path @('-r', 'exit(PHP_VERSION_ID >= 80000 ? 0 : 1);')) { return $path }
    }
}

function Find-Python {
    $paths = @(
        "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
        "$env:ProgramFiles\Python312\python.exe"
    )
    $launcher = Get-Command py.exe -CommandType Application -ErrorAction SilentlyContinue
    if ($launcher) {
        $paths += & {
            $ErrorActionPreference = 'Continue'
            $registered = & $launcher.Source -3 -c 'import sys; print(sys.executable)' 2>$null
            if ($LASTEXITCODE -eq 0) { $registered }
        }
    }
    foreach ($path in (Resolve-Executable python.exe $paths | Select-Object -Unique)) {
        if ($path -like '*\Microsoft\WindowsApps\python.exe') { continue }
        if (Test-Executable $path @('-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)')) {
            return $path
        }
    }
}

function Initialize-Python {
    $python = Find-Python
    if (-not $python) {
        Install-Package 'Python.Python.3.12'
        $python = Find-Python
    }
    if (-not $python) { throw 'Python 3.10 or later is unavailable.' }

    $venv = Join-Path $PSScriptRoot '.venv'
    $venvPython = Join-Path $venv 'Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
        & $python -m venv $venv
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the Python virtual environment.' }
    }
    if (-not (Test-Executable $venvPython @('-c', 'import fastapi, uvicorn, requests'))) {
        & $venvPython -m pip install -r (Join-Path $PSScriptRoot 'requirements.txt')
        if ($LASTEXITCODE -ne 0 -or -not (Test-Executable $venvPython @('-c', 'import fastapi, uvicorn, requests'))) {
            throw 'Could not install the Python dependencies.'
        }
    }
    $env:HERMES_PYTHON_EXE = $venvPython
}

function Get-OllamaTags {
    param([string]$BaseUrl)
    try {
        Invoke-RestMethod -Uri "$BaseUrl/api/tags" -Method Get -TimeoutSec 3 -ErrorAction Stop
    } catch {
        return $null
    }
}

function Find-Ollama {
    Resolve-Executable ollama.exe @("$env:LOCALAPPDATA\Programs\Ollama\ollama.exe", "$env:ProgramFiles\Ollama\ollama.exe") |
        Select-Object -First 1
}

function Initialize-Ollama {
    if ($env:HERMES_AI -eq '0') {
        Write-Host 'AI is disabled by HERMES_AI=0.'
        return
    }
    $url = 'http://127.0.0.1:11434'
    if ($env:HERMES_OLLAMA_URL) { $url = $env:HERMES_OLLAMA_URL.TrimEnd('/') }
    $model = if ($env:HERMES_OLLAMA_MODEL) { $env:HERMES_OLLAMA_MODEL } else { 'llama3.2' }
    $tag = if (($model -split '/')[-1].Contains(':')) { $model } else { "${model}:latest" }
    $defaultLocal = $url -in @('http://127.0.0.1:11434', 'http://localhost:11434')
    $tags = Get-OllamaTags $url
    if ($tags -and $tag -in @($tags.models.name)) { return }
    if (-not $defaultLocal) {
        throw "Check the server configured in HERMES_OLLAMA_URL and download the $model model on that host."
    }
    $ollama = Find-Ollama
    if (-not $ollama) {
        Install-Package 'Ollama.Ollama'
        $ollama = Find-Ollama
    }
    if (-not $ollama) { throw 'Could not find ollama.exe after installation.' }

    $env:OLLAMA_HOST = '127.0.0.1:11434'
    if (-not $tags) {
        Write-Host 'Starting the local Ollama service...'
        Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden
        $deadline = (Get-Date).AddSeconds(45)
        do {
            Start-Sleep -Seconds 1
            $tags = Get-OllamaTags $url
        } until ($tags -or (Get-Date) -ge $deadline)
    }
    if (-not $tags) { throw "Ollama did not respond at $url/api/tags. Open Ollama from the Start menu and run the installer again." }
    if ($tag -notin @($tags.models.name)) {
        Write-Host "Downloading the $model model..."
        & $ollama pull $model
        if ($LASTEXITCODE -ne 0) { throw "Could not download the $model model." }
        $tags = Get-OllamaTags $url
        if (-not $tags -or $tag -notin @($tags.models.name)) {
            throw "Ollama did not list the $tag model after the download."
        }
    }
}

function Find-Tailscale {
    Resolve-Executable tailscale.exe @("$env:ProgramFiles\Tailscale\tailscale.exe") |
        Select-Object -First 1
}

try {
    Set-Location -LiteralPath $PSScriptRoot
    if (-not $Mode) {
        Write-Host 'HERMES - Setup and launch'
        Write-Host '  1. Run locally with AI'
        Write-Host '  2. Publish with Tailscale Funnel and AI'
        Write-Host '  3. Run locally with AI and the Python API'
        Write-Host '  0. Exit'
        do {
            $choice = Read-Host 'Choose an option'
        } until ($choice -in @('0','1','2','3'))
        if ($choice -eq '0') { exit 0 }
        $Mode = @{ '1' = 'Local'; '2' = 'Tailscale'; '3' = 'Api' }[$choice]
    }

    $php = Find-PHP
    if (-not $php) {
        Install-Package 'PHP.PHP.8.4'
        $php = Find-PHP
    }
    if (-not $php) { throw 'Could not find a working PHP 8.0 or later executable.' }
    $env:PHP_EXE = $php

    Initialize-Ollama
    $launcher = 'START.bat'
    switch ($Mode) {
        'Tailscale' {
            $tailscale = Find-Tailscale
            if (-not $tailscale) {
                Install-Package 'Tailscale.Tailscale'
                $tailscale = Find-Tailscale
            }
            if (-not $tailscale) { throw 'Could not find tailscale.exe after installation.' }
            $env:Path = "$(Split-Path -Parent $tailscale);$env:Path"
            Write-Host 'If Tailscale asks you to sign in or authorize Funnel, complete that step in your browser.'
            $launcher = 'START_TAILSCALE.bat'
        }
        'Api' {
            Initialize-Python
            $launcher = 'START_WITH_PYTHON.bat'
        }
    }
    Write-Host 'Launching HERMES...'
    & (Join-Path $PSScriptRoot $launcher)
    exit $LASTEXITCODE
} catch {
    Write-Host ("HERMES: " + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
