[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $SubscriptionId,
  [string] $ResourceGroup = 'rg-covetrus-insight-hub',
  [string] $Location = 'uksouth',
  [string] $SqlLocation = $Location,
  [string] $NamePrefix = 'covetrus-insight-hub'
)
$ErrorActionPreference = 'Stop'

if (-not (Get-Command az -ErrorAction SilentlyContinue)) { throw 'Azure CLI is required. Install it or run this script in Azure Cloud Shell.' }
az account show --only-show-errors | Out-Null
az account set --subscription $SubscriptionId
$account = az account show --output json | ConvertFrom-Json
$signedIn = az ad signed-in-user show --output json | ConvertFrom-Json
if (-not $signedIn.id) { throw 'The signed-in user object ID could not be read. Ask an Azure administrator to supply SQL Entra administrator details.' }

az group create --name $ResourceGroup --location $Location --only-show-errors | Out-Null
$parameters = @(
  "namePrefix=$NamePrefix", "location=$Location", "sqlLocation=$SqlLocation", "tenantId=$($account.tenantId)",
  "sqlAdministratorObjectId=$($signedIn.id)", "sqlAdministratorLogin=$($account.user.name)"
)
az deployment group what-if --resource-group $ResourceGroup --template-file infra/main.bicep --parameters $parameters
az deployment group create --name "insight-hub-$((Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss'))" --resource-group $ResourceGroup --template-file infra/main.bicep --parameters $parameters --output json
