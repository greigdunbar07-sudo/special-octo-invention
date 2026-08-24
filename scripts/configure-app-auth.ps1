[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $ResourceGroup,
  [Parameter(Mandatory)] [string] $WebAppName,
  [Parameter(Mandatory)] [string] $TenantId,
  [Parameter(Mandatory)] [string] $ClientId,
  [string] $AuthIdentityName = "$WebAppName-auth",
  [switch] $RemoveLegacySecret
)
$ErrorActionPreference = 'Stop'

function Assert-NativeSuccess([string] $Operation) {
  if ($LASTEXITCODE -ne 0) { throw "$Operation failed with exit code $LASTEXITCODE." }
}

if (-not (Get-Command az -ErrorAction SilentlyContinue)) { throw 'Azure CLI is required.' }
$identity = az identity show --resource-group $ResourceGroup --name $AuthIdentityName --output json | ConvertFrom-Json
Assert-NativeSuccess 'Reading the authentication managed identity'
$appObjectId = az ad app show --id $ClientId --query id --output tsv
Assert-NativeSuccess 'Resolving the Entra application object ID'
if (-not $appObjectId) { throw 'The Entra application could not be resolved. An Application Administrator may need to run this script.' }

$credentialName = "fabric-portal-$($identity.clientId.Substring(0, 8))"
$existingCredential = az ad app federated-credential list --id $appObjectId --query "[?name=='$credentialName'].id | [0]" --output tsv
Assert-NativeSuccess 'Checking the federated identity credential'
$credentialPath = Join-Path ([IO.Path]::GetTempPath()) "fabric-portal-fic-$([Guid]::NewGuid().ToString('N')).json"
try {
  if (-not $existingCredential) {
    @{
      name = $credentialName
      issuer = "https://login.microsoftonline.com/$TenantId/v2.0"
      subject = $identity.principalId
      description = 'Trust the Fabric Portal authentication managed identity.'
      audiences = @('api://AzureADTokenExchange')
    } | ConvertTo-Json | Set-Content -LiteralPath $credentialPath -Encoding utf8NoBOM
    az ad app federated-credential create --id $appObjectId --parameters $credentialPath --only-show-errors | Out-Null
    Assert-NativeSuccess 'Creating the federated identity credential'
  }
  az webapp identity assign --resource-group $ResourceGroup --name $WebAppName --identities $identity.id --only-show-errors | Out-Null
  Assert-NativeSuccess 'Assigning the authentication managed identity'
  az webapp config appsettings set --resource-group $ResourceGroup --name $WebAppName --settings "OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID=$($identity.clientId)" --only-show-errors | Out-Null
  Assert-NativeSuccess 'Configuring the managed identity client assertion'
  az deployment group create --resource-group $ResourceGroup --template-file infra/auth.bicep --parameters "webAppName=$WebAppName" "tenantId=$TenantId" "clientId=$ClientId" --only-show-errors | Out-Null
  Assert-NativeSuccess 'Configuring App Service Authentication'
  if ($RemoveLegacySecret) {
    az webapp config appsettings delete --resource-group $ResourceGroup --name $WebAppName --setting-names MICROSOFT_PROVIDER_AUTHENTICATION_SECRET --only-show-errors | Out-Null
    Assert-NativeSuccess 'Removing the legacy authentication secret setting'
  }
} finally {
  if (Test-Path -LiteralPath $credentialPath) { Remove-Item -LiteralPath $credentialPath -Force }
}
Write-Host "App Service Authentication configured for $WebAppName with managed identity federation."
if (-not $RemoveLegacySecret) { Write-Host 'After verifying a fresh sign-in, run this script again with -RemoveLegacySecret and delete the credential from the Entra app registration.' }
