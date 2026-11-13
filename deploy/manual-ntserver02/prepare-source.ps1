[CmdletBinding()]
param(
    [switch]$Apply,
    [string]$ProjectRoot
)

$ErrorActionPreference = 'Stop'
if (-not $ProjectRoot) {
    $ProjectRoot = Join-Path $PSScriptRoot '..\..'
}
$projectPath = (Resolve-Path -LiteralPath $ProjectRoot).Path
$utf8 = [System.Text.UTF8Encoding]::new($false)
$relativeFiles = @(
    'frontend/public/index.html',
    'frontend/public/app.js',
    'frontend/public/avatar.js',
    'frontend/public/world.js',
    'frontend/public/voice.js',
    'frontend/public/gestures.js',
    'backend/server/index.mjs'
)
$changes = @()
$quoteCharacters = [regex]::Escape('"' + "'" + [char]96)
$rootUrlPattern = '([' + $quoteCharacters + '])/(?=(?:api|assets|maps|gestures|shared|vendor)/)'

foreach ($relativeFile in $relativeFiles) {
    $filePath = Join-Path $projectPath $relativeFile
    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
        throw "Missing file: $filePath"
    }
    $original = [IO.File]::ReadAllText($filePath)
    $updated = $original

    if ($relativeFile.StartsWith('frontend/')) {
        $updated = [regex]::Replace($updated, $rootUrlPattern, {
            param($match)
            $match.Groups[1].Value + '/aiavatar/'
        })
    }

    if ($relativeFile -eq 'frontend/public/index.html') {
        foreach ($asset in @('styles.css', 'app.js')) {
            $updated = $updated.Replace('"/' + $asset + '"', '"/aiavatar/' + $asset + '"')
        }
        if ($updated -notmatch 'href="/aiavatar/(?:v/[^/"]+/)?styles\.css(?:\?[^"]*)?"' -or
            $updated -notmatch 'src="/aiavatar/(?:v/[^/"]+/)?app\.js"') {
            throw 'index.html has an unexpected layout; no files were written.'
        }
    }

    if ($relativeFile -eq 'frontend/public/world.js') {
        $worldPattern = '(?m)^    const urlOf = file => [^\r\n]+;'
        if ([regex]::Matches($updated, $worldPattern).Count -ne 1) {
            throw 'world.js has an unexpected urlOf declaration; no files were written.'
        }
        $worldReplacement = "    const urlOf = file => file.startsWith('/aiavatar/') ? file : file.startsWith('/') ? '/aiavatar' + file : '/aiavatar/maps/' + map.id + '/' + file;"
        $updated = [regex]::Replace($updated, $worldPattern, $worldReplacement)
    }

    if ($relativeFile -eq 'backend/server/index.mjs' -and
        -not $updated.Contains('// manual-ntserver02: public deployment write guard')) {
        $anchor = "    const { pathname, searchParams } = new URL(request.url, 'http://localhost');"
        if (-not $updated.Contains($anchor)) {
            throw 'server/index.mjs has an unexpected entry point; no files were written.'
        }
        $guard = @'
    // manual-ntserver02: public deployment write guard
    if (process.env.AUTHOR_ENABLED === 'false' && (
      (request.method === 'PUT' && pathname.startsWith('/api/maps/')) ||
      (['POST', 'PATCH', 'DELETE'].includes(request.method) &&
        (pathname === '/api/gestures' || pathname.startsWith('/api/gestures/')))
    )) return json(response, 403, { error: 'Author API is disabled on this public deployment' });
'@
        $updated = $updated.Replace($anchor, $anchor + [Environment]::NewLine + $guard.TrimEnd())
    }

    if ($updated -cne $original) {
        $changes += [pscustomobject]@{
            RelativeFile = $relativeFile
            FilePath = $filePath
            Content = $updated
        }
    }
}

if ($changes.Count -eq 0) {
    Write-Host 'Already prepared for /aiavatar/. No files changed.'
    exit 0
}

Write-Host 'Files to update:'
$changes | ForEach-Object { Write-Host ('  ' + $_.RelativeFile) }
if (-not $Apply) {
    Write-Host 'Preview only. Run this script with -Apply to back up and update these files.'
    exit 0
}

$backupRoot = Join-Path $PSScriptRoot ('source-backups/' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
foreach ($change in $changes) {
    $backupPath = Join-Path $backupRoot $change.RelativeFile
    [IO.Directory]::CreateDirectory((Split-Path -Parent $backupPath)) | Out-Null
    Copy-Item -LiteralPath $change.FilePath -Destination $backupPath
}
foreach ($change in $changes) {
    [IO.File]::WriteAllText($change.FilePath, $change.Content, $utf8)
}
Write-Host ('Backup: ' + $backupRoot)
Write-Host 'Prepared /aiavatar/ URLs and AUTHOR_ENABLED=false support.'
