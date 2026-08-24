[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $ResourceGroup,
  [Parameter(Mandatory)] [string] $WebAppName,
  [Parameter(Mandatory)] [string] $RegistryName,
  [Parameter(Mandatory)] [string] $SqlServerName,
  [string] $SqlDatabase = 'insight-hub',
  [ValidateSet('AcrTask', 'Crane')] [string] $BuildMethod = 'AcrTask',
  [string] $CranePath = '.tools/crane/crane.exe',
  [string] $BaseImage = 'node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436',
  [switch] $SkipDatabase
)
$ErrorActionPreference = 'Stop'

function Assert-NativeSuccess([string] $Operation) {
  if ($LASTEXITCODE -ne 0) { throw "$Operation failed with exit code $LASTEXITCODE." }
}

if (-not (Get-Command az -ErrorAction SilentlyContinue)) { throw 'Azure CLI is required.' }
$repoRoot = (Resolve-Path '.').Path
$revision = cmd /c "git -c safe.directory=`"$repoRoot`" rev-parse --short HEAD 2>nul"
if (-not $revision) {
  $revisionFiles = @(
    Get-ChildItem -File -Recurse src, server, artifacts, scripts |
      Sort-Object FullName
  ) + @(
    Get-Item Dockerfile, package.json, package-lock.json, index.html, tsconfig.json, vite.config.ts
  )
  $hashMaterial = ($revisionFiles | ForEach-Object { "$(Resolve-Path -Relative $_.FullName):$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)" }) -join "`n"
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
  $sourceHash = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($hashMaterial)) | ForEach-Object { $_.ToString('x2') })
  } finally {
    $sha.Dispose()
  }
  $revision = "src$($sourceHash.Substring(0, 12))"
}
$tag = "$revision-$((Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss'))"
$loginServer = az acr show --resource-group $ResourceGroup --name $RegistryName --query loginServer --output tsv
Assert-NativeSuccess 'Reading the ACR login server'

if ($BuildMethod -eq 'AcrTask') {
  # Upload an explicit, secret-free build context. This does not rely solely on
  # .dockerignore, so private-seed and local environment files never reach ACR.
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  $buildContext = Join-Path $tempRoot "insight-hub-build-$([Guid]::NewGuid().ToString('N'))"
  $resolvedContext = [IO.Path]::GetFullPath($buildContext)
  if (-not $resolvedContext.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'The temporary build context resolved outside the operating-system temp directory.' }
  New-Item -ItemType Directory -Path $resolvedContext | Out-Null
  try {
    foreach ($file in @('Dockerfile', '.dockerignore', 'package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts')) {
      Copy-Item -LiteralPath $file -Destination $resolvedContext
    }
    foreach ($directory in @('src', 'server', 'artifacts')) {
      Copy-Item -LiteralPath $directory -Destination $resolvedContext -Recurse
    }
    New-Item -ItemType Directory -Path (Join-Path $resolvedContext 'scripts') | Out-Null
    Copy-Item -LiteralPath 'scripts/build-artifacts.mjs' -Destination (Join-Path $resolvedContext 'scripts')
    Copy-Item -LiteralPath 'scripts/validate-artifacts.mjs' -Destination (Join-Path $resolvedContext 'scripts')
    Copy-Item -LiteralPath 'scripts/artifact-package.mjs' -Destination (Join-Path $resolvedContext 'scripts')
    Copy-Item -LiteralPath 'scripts/copy-runtime-package.mjs' -Destination (Join-Path $resolvedContext 'scripts')
    Copy-Item -LiteralPath 'scripts/check-runtime-packager.mjs' -Destination (Join-Path $resolvedContext 'scripts')
    az acr build --resource-group $ResourceGroup --registry $RegistryName --image "insight-hub:$tag" --file Dockerfile $resolvedContext
    Assert-NativeSuccess 'ACR remote build'
  } finally {
    if (Test-Path -LiteralPath $resolvedContext) { Remove-Item -LiteralPath $resolvedContext -Recurse -Force }
  }
} else {
  if (-not (Test-Path -LiteralPath $CranePath -PathType Leaf)) { throw "crane was not found at $CranePath." }
  # Windows can keep native development modules loaded after local tests. An
  # in-place `npm ci` then fails while trying to unlink those DLL-backed files.
  # Reconcile the build tree without deleting it, and install the production
  # dependency tree separately inside the disposable OCI layer.
  npm install --ignore-scripts --no-audit --no-fund
  Assert-NativeSuccess 'Reconciling application dependencies'
  npm run build:all
  Assert-NativeSuccess 'Building the application'

  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  $layerRoot = Join-Path $tempRoot "insight-hub-layer-$([Guid]::NewGuid().ToString('N'))"
  $resolvedLayerRoot = [IO.Path]::GetFullPath($layerRoot)
  if (-not $resolvedLayerRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'The temporary image layer resolved outside the operating-system temp directory.' }
  $appRoot = Join-Path $resolvedLayerRoot 'app'
  $layerTar = Join-Path $tempRoot "insight-hub-layer-$([Guid]::NewGuid().ToString('N')).tar"
  New-Item -ItemType Directory -Path $appRoot | Out-Null
  try {
    foreach ($file in @('package.json', 'package-lock.json')) { Copy-Item -LiteralPath $file -Destination $appRoot }
    Push-Location $appRoot
    try {
      npm ci --omit=dev --ignore-scripts --no-audit --no-fund
      Assert-NativeSuccess 'Installing isolated production dependencies'
    } finally {
      Pop-Location
    }
    foreach ($directory in @('dist', 'dist-server', 'artifacts')) { Copy-Item -LiteralPath $directory -Destination $appRoot -Recurse }
    New-Item -ItemType Directory -Path (Join-Path $appRoot 'server') | Out-Null
    Copy-Item -LiteralPath 'server/migrations' -Destination (Join-Path $appRoot 'server') -Recurse
    tar -cf $layerTar -C $resolvedLayerRoot .
    Assert-NativeSuccess 'Creating the OCI application layer'

    $acrCredential = az acr login --name $RegistryName --expose-token --output json | ConvertFrom-Json
    Assert-NativeSuccess 'Obtaining an ACR access token'
    $acrToken = $acrCredential.accessToken
    try {
      $acrToken | & $CranePath auth login $loginServer --username $acrCredential.username --password-stdin
      Assert-NativeSuccess 'Authenticating crane to ACR'
      $imageRef = "$loginServer/insight-hub:$tag"
      & $CranePath append --platform linux/amd64 --base $BaseImage --new_layer $layerTar --new_tag $imageRef
      Assert-NativeSuccess 'Appending the application layer to the Node base image'
      & $CranePath mutate --platform linux/amd64 $imageRef --tag $imageRef --user node --workdir /app --env 'NODE_ENV=production' --env 'PORT=8080' --exposed-ports '8080/tcp' --cmd node --cmd 'dist-server/server/index.js'
      Assert-NativeSuccess 'Applying the container runtime configuration'
      } finally {
      $acrToken = $null
      $acrCredential = $null
      cmd /c "`"$CranePath`" auth logout $loginServer >nul 2>&1" | Out-Null
    }
  } finally {
    if (Test-Path -LiteralPath $resolvedLayerRoot) { Remove-Item -LiteralPath $resolvedLayerRoot -Recurse -Force }
    if (Test-Path -LiteralPath $layerTar) { Remove-Item -LiteralPath $layerTar -Force }
  }
}

if (-not $SkipDatabase) {
  if ($BuildMethod -eq 'AcrTask') {
    npm ci
    Assert-NativeSuccess 'Installing migration dependencies'
    npm run build:server
    Assert-NativeSuccess 'Building the migration runner'
  }
  $clientIp = (Invoke-RestMethod -Uri 'https://api.ipify.org').Trim()
  $firewallName = "release-$((Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss'))"
  $sqlPublicAccessEnabled = $false
  try {
    az sql server update --resource-group $ResourceGroup --name $SqlServerName --enable-public-network true --only-show-errors | Out-Null
    Assert-NativeSuccess 'Temporarily enabling the SQL public endpoint for migration'
    $sqlPublicAccessEnabled = $true
    az sql server firewall-rule create --resource-group $ResourceGroup --server $SqlServerName --name $firewallName --start-ip-address $clientIp --end-ip-address $clientIp --only-show-errors | Out-Null
    Assert-NativeSuccess 'Creating the temporary SQL firewall rule'
    $env:AZURE_SQL_SERVER = "$SqlServerName.database.windows.net"
    $env:AZURE_SQL_DATABASE = $SqlDatabase
    $env:AZURE_SQL_ACCESS_TOKEN = az account get-access-token --resource 'https://database.windows.net/' --query accessToken --output tsv
    Assert-NativeSuccess 'Obtaining the Azure SQL access token'
    npm run db:migrate
    Assert-NativeSuccess 'Applying SQL migrations'
    $env:APP_SERVICE_IDENTITY_NAME = $WebAppName
    $principalId = az webapp identity show --resource-group $ResourceGroup --name $WebAppName --query principalId --output tsv
    Assert-NativeSuccess 'Reading the Web App managed identity'
    $env:APP_SERVICE_CLIENT_ID = az ad sp show --id $principalId --query appId --output tsv
    Assert-NativeSuccess 'Resolving the managed identity client ID'
    if (-not $env:APP_SERVICE_CLIENT_ID) { throw 'The managed identity client ID could not be resolved. Ask an Entra administrator for permission to read the enterprise application.' }
    npm run db:grant-runtime
    Assert-NativeSuccess 'Granting runtime database roles'
  } finally {
    Remove-Item Env:AZURE_SQL_ACCESS_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:APP_SERVICE_IDENTITY_NAME -ErrorAction SilentlyContinue
    Remove-Item Env:APP_SERVICE_CLIENT_ID -ErrorAction SilentlyContinue
    az sql server firewall-rule delete --resource-group $ResourceGroup --server $SqlServerName --name $firewallName --only-show-errors 2>$null
    if ($sqlPublicAccessEnabled) {
      az sql server update --resource-group $ResourceGroup --name $SqlServerName --enable-public-network false --only-show-errors | Out-Null
      Assert-NativeSuccess 'Disabling the SQL public endpoint after migration'
    }
  }
}

az webapp config container set --resource-group $ResourceGroup --name $WebAppName --container-image-name "$loginServer/insight-hub:$tag" --docker-registry-server-url "https://$loginServer" --only-show-errors | Out-Null
Assert-NativeSuccess 'Configuring the Web App container image'
az webapp restart --resource-group $ResourceGroup --name $WebAppName --only-show-errors
Assert-NativeSuccess 'Restarting the Web App'
Write-Host "Released $loginServer/insight-hub:$tag"
Write-Host "Verify https://$WebAppName.azurewebsites.net/healthz and complete Easy Auth configuration before cutover."
