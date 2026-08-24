[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $ResourceGroup,
  [Parameter(Mandatory)] [string] $WebAppName,
  [Parameter(Mandatory)] [string] $SqlServerName,
  [Parameter(Mandatory)] [string] $StorageAccountName,
  [string] $SqlDatabase = 'insight-hub',
  [string] $StorageContainer = 'portal-data'
)
$ErrorActionPreference = 'Stop'

function Assert-NativeSuccess([string] $Operation) {
  if ($LASTEXITCODE -ne 0) { throw "$Operation failed with exit code $LASTEXITCODE." }
}

function Assert-SecurityControl([bool] $Condition, [string] $Message) {
  if (-not $Condition) { throw "Security validation failed: $Message" }
  Write-Host "PASS: $Message"
}

if (-not (Get-Command az -ErrorAction SilentlyContinue)) { throw 'Azure CLI is required.' }
$web = az webapp show --resource-group $ResourceGroup --name $WebAppName --output json | ConvertFrom-Json
Assert-NativeSuccess 'Reading the Web App'
$webConfig = az webapp config show --resource-group $ResourceGroup --name $WebAppName --output json | ConvertFrom-Json
Assert-NativeSuccess 'Reading the Web App configuration'
$authResource = az rest --method get --url "https://management.azure.com$($web.id)/config/authsettingsV2?api-version=2023-12-01" --output json | ConvertFrom-Json
Assert-NativeSuccess 'Reading App Service Authentication'
$auth = $authResource.properties
$sql = az sql server show --resource-group $ResourceGroup --name $SqlServerName --output json | ConvertFrom-Json
Assert-NativeSuccess 'Reading Azure SQL'
$storage = az storage account show --resource-group $ResourceGroup --name $StorageAccountName --output json | ConvertFrom-Json
Assert-NativeSuccess 'Reading Blob Storage'
$privateEndpoints = @(az network private-endpoint list --resource-group $ResourceGroup --output json | ConvertFrom-Json)
Assert-NativeSuccess 'Reading private endpoints'
$sqlFirewallRules = @(az sql server firewall-rule list --resource-group $ResourceGroup --server $SqlServerName --output json | ConvertFrom-Json)
Assert-NativeSuccess 'Reading SQL firewall rules'

Assert-SecurityControl ($web.httpsOnly -eq $true) 'Web App requires HTTPS.'
Assert-SecurityControl ($webConfig.minTlsVersion -eq '1.2') 'Web App requires TLS 1.2 or later.'
Assert-SecurityControl ($webConfig.ftpsState -eq 'Disabled') 'FTPS is disabled.'
Assert-SecurityControl (-not [string]::IsNullOrWhiteSpace($web.virtualNetworkSubnetId)) 'Web App has regional VNet integration.'
Assert-SecurityControl ($auth.platform.enabled -eq $true) 'App Service Authentication is enabled.'
Assert-SecurityControl ($auth.globalValidation.requireAuthentication -eq $true) 'Authentication is required by default.'
Assert-SecurityControl (($auth.globalValidation.excludedPaths.Count -eq 1) -and ($auth.globalValidation.excludedPaths[0] -eq '/healthz')) 'Only the shallow health check bypasses authentication.'
Assert-SecurityControl ($auth.identityProviders.azureActiveDirectory.registration.clientSecretSettingName -eq 'OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID') 'Easy Auth uses managed identity federation.'
Assert-SecurityControl ($sql.publicNetworkAccess -eq 'Disabled') 'Azure SQL public network access is disabled.'
Assert-SecurityControl ($sql.administrators.azureAdOnlyAuthentication -eq $true) 'Azure SQL accepts only Entra authentication.'
Assert-SecurityControl (@($sqlFirewallRules | Where-Object { $_.startIpAddress -eq '0.0.0.0' -and $_.endIpAddress -eq '0.0.0.0' }).Count -eq 0) 'The cross-subscription Allow Azure Services SQL firewall rule is absent.'
Assert-SecurityControl ($storage.publicNetworkAccess -eq 'Disabled') 'Storage public network access is disabled.'
Assert-SecurityControl ($storage.allowSharedKeyAccess -eq $false) 'Storage Shared Key authorization is disabled.'
Assert-SecurityControl ($storage.allowBlobPublicAccess -eq $false) 'Anonymous Blob access is disabled.'
Assert-SecurityControl ($storage.minimumTlsVersion -eq 'TLS1_2') 'Storage requires TLS 1.2 or later.'
Assert-SecurityControl (@($privateEndpoints | Where-Object { $_.privateLinkServiceConnections.privateLinkServiceId -contains $sql.id }).Count -gt 0) 'Azure SQL has a private endpoint.'
Assert-SecurityControl (@($privateEndpoints | Where-Object { $_.privateLinkServiceConnections.privateLinkServiceId -contains $storage.id }).Count -gt 0) 'Blob Storage has a private endpoint.'

$containerScope = "$($storage.id)/blobServices/default/containers/$StorageContainer"
$containerRoles = @(az role assignment list --assignee-object-id $web.identity.principalId --scope $containerScope --output json | ConvertFrom-Json)
Assert-NativeSuccess 'Reading container-scoped role assignments'
Assert-SecurityControl (@($containerRoles | Where-Object { $_.roleDefinitionName -eq 'Storage Blob Data Contributor' }).Count -gt 0) 'The runtime Blob role is scoped to the protected container.'

$webDiagnostics = @(az monitor diagnostic-settings list --resource $web.id --output json | ConvertFrom-Json)
Assert-NativeSuccess 'Reading Web App diagnostics'
$sqlDiagnostics = @(az monitor diagnostic-settings list --resource "$($sql.id)/databases/$SqlDatabase" --output json | ConvertFrom-Json)
Assert-NativeSuccess 'Reading SQL diagnostics'
Assert-SecurityControl ($webDiagnostics.Count -gt 0) 'Web App diagnostics are configured.'
Assert-SecurityControl ($sqlDiagnostics.Count -gt 0) 'SQL audit diagnostics are configured.'

Write-Host 'Azure security validation completed successfully.'
