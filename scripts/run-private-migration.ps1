[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $ResourceGroup,
  [Parameter(Mandatory)] [string] $WebAppName,
  [Parameter(Mandatory)] [string] $RegistryName,
  [Parameter(Mandatory)] [string] $SqlServerName,
  [Parameter(Mandatory)] [string] $Image,
  [string] $SqlDatabase = 'insight-hub',
  [string] $VirtualNetworkName = 'covetrus-insight-hub-vnet',
  [string] $MigrationSubnetName = 'migration-runners',
  [string] $MigrationSubnetPrefix = '10.42.3.0/24',
  [string] $AuthIdentityName = "$WebAppName-auth"
)
$ErrorActionPreference = 'Stop'

function Assert-NativeSuccess([string] $Operation) {
  if ($LASTEXITCODE -ne 0) { throw "$Operation failed with exit code $LASTEXITCODE." }
}

$azCommand = Get-Command az -ErrorAction SilentlyContinue
if (-not $azCommand) { throw 'Azure CLI is required.' }
$azPython = Join-Path (Split-Path $azCommand.Source -Parent) '..\python.exe'
$useDirectPython = Test-Path -LiteralPath $azPython -PathType Leaf
$subscriptionId = az account show --query id --output tsv
Assert-NativeSuccess 'Reading the Azure subscription'
$identity = az identity show --resource-group $ResourceGroup --name $AuthIdentityName --output json | ConvertFrom-Json
Assert-NativeSuccess 'Reading the migration managed identity'
$registry = az acr show --resource-group $ResourceGroup --name $RegistryName --output json | ConvertFrom-Json
Assert-NativeSuccess 'Reading the container registry'
$webIdentityPrincipalId = az webapp identity show --resource-group $ResourceGroup --name $WebAppName --query principalId --output tsv
Assert-NativeSuccess 'Reading the Web App managed identity'
$webIdentityClientId = az ad sp show --id $webIdentityPrincipalId --query appId --output tsv
Assert-NativeSuccess 'Resolving the Web App managed identity client ID'
$sql = az sql server show --resource-group $ResourceGroup --name $SqlServerName --output json | ConvertFrom-Json
Assert-NativeSuccess 'Reading the SQL administrator'
if (-not $sql.administrators.sid -or -not $sql.administrators.login) { throw 'The current SQL Entra administrator could not be read.' }

$containerName = "portal-db-migration-$((Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss'))"
$createdSubnet = $false
$createdAcrRole = $false
$sqlAdminChanged = $false
$migrationSucceeded = $false
$subnet = az network vnet subnet show --resource-group $ResourceGroup --vnet-name $VirtualNetworkName --name $MigrationSubnetName --output json 2>$null | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) {
  az network vnet subnet create --resource-group $ResourceGroup --vnet-name $VirtualNetworkName --name $MigrationSubnetName --address-prefixes $MigrationSubnetPrefix --delegations 'Microsoft.ContainerInstance/containerGroups' --only-show-errors | Out-Null
  Assert-NativeSuccess 'Creating the temporary migration subnet'
  $createdSubnet = $true
}

$existingAcrRole = @(az role assignment list --assignee-object-id $identity.principalId --scope $registry.id --role 'AcrPull' --output json | ConvertFrom-Json)
Assert-NativeSuccess 'Checking the migration identity ACR role'
if ($existingAcrRole.Count -eq 0) {
  az role assignment create --assignee-object-id $identity.principalId --assignee-principal-type ServicePrincipal --scope $registry.id --role 'AcrPull' --only-show-errors | Out-Null
  Assert-NativeSuccess 'Granting temporary ACR pull access'
  $createdAcrRole = $true
}

try {
  az sql server ad-admin update --resource-group $ResourceGroup --server-name $SqlServerName --display-name $AuthIdentityName --object-id $identity.principalId --only-show-errors | Out-Null
  Assert-NativeSuccess 'Temporarily setting the migration identity as SQL administrator'
  $sqlAdminChanged = $true

  $command = '/bin/sh -c "node dist-server/server/migrate.js && node dist-server/server/grant-runtime.js"'
  $containerArguments = @(
    'container', 'create', '--resource-group', $ResourceGroup, '--name', $containerName,
    '--location', $registry.location, '--image', $Image, '--registry-login-server', $registry.loginServer,
    '--acr-identity', $identity.id, '--assign-identity', $identity.id,
    '--vnet', $VirtualNetworkName, '--subnet', $MigrationSubnetName,
    '--os-type', 'Linux', '--restart-policy', 'Never', '--cpu', '1', '--memory', '1', '--command-line', $command,
    '--environment-variables', "AZURE_CLIENT_ID=$($identity.clientId)",
    "AZURE_SQL_SERVER=$($sql.fullyQualifiedDomainName)", "AZURE_SQL_DATABASE=$SqlDatabase",
    "APP_SERVICE_IDENTITY_NAME=$WebAppName", "APP_SERVICE_CLIENT_ID=$webIdentityClientId",
    '--only-show-errors'
  )
  if ($useDirectPython) {
    & $azPython -IBm azure.cli @containerArguments | Out-Null
  } else {
    az @containerArguments | Out-Null
  }
  Assert-NativeSuccess 'Starting the private migration container'

  $deadline = (Get-Date).AddMinutes(15)
  do {
    Start-Sleep -Seconds 10
    $container = az container show --resource-group $ResourceGroup --name $containerName --output json | ConvertFrom-Json
    Assert-NativeSuccess 'Reading the migration container status'
    $state = $container.containers[0].instanceView.currentState.state
  } while ($state -notin @('Terminated','Failed') -and (Get-Date) -lt $deadline)
  if ($state -notin @('Terminated','Failed')) { throw 'The private migration container did not finish within 15 minutes.' }
  $logs = az container logs --resource-group $ResourceGroup --name $containerName
  Assert-NativeSuccess 'Reading the migration logs'
  Write-Host $logs
  $exitCode = $container.containers[0].instanceView.currentState.exitCode
  if ($exitCode -ne 0) { throw "The private migration container exited with code $exitCode." }
  $migrationSucceeded = $true
} finally {
  if ($sqlAdminChanged) {
    az sql server ad-admin update --resource-group $ResourceGroup --server-name $SqlServerName --display-name $sql.administrators.login --object-id $sql.administrators.sid --only-show-errors | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Restoring the original SQL Entra administrator failed and requires immediate manual correction.' }
  }
  az container delete --resource-group $ResourceGroup --name $containerName --yes --only-show-errors 2>$null | Out-Null
  if ($createdAcrRole) {
    az role assignment delete --assignee-object-id $identity.principalId --scope $registry.id --role 'AcrPull' --only-show-errors 2>$null
  }
  if ($createdSubnet) {
    az network vnet subnet delete --resource-group $ResourceGroup --vnet-name $VirtualNetworkName --name $MigrationSubnetName --only-show-errors 2>$null
    if ($LASTEXITCODE -ne 0) { Write-Warning "Temporary subnet $MigrationSubnetName could not yet be removed; delete it after Azure finishes removing the container group." }
  }
}
if (-not $migrationSucceeded) { throw 'The private database migration did not complete.' }
Write-Host 'Private database migration and least-privilege grant completed successfully.'
