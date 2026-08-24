[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $ResourceGroup,
  [Parameter(Mandatory)] [string] $WebAppName,
  [Parameter(Mandatory)] [string] $MailFrom,
  [string] $PortalPublicUrl
)
$ErrorActionPreference = 'Stop'

function Assert-NativeSuccess([string] $Operation) {
  if ($LASTEXITCODE -ne 0) { throw "$Operation failed with exit code $LASTEXITCODE." }
}

if (-not (Get-Command az -ErrorAction SilentlyContinue)) { throw 'Azure CLI is required.' }

$principalId = az webapp identity show --resource-group $ResourceGroup --name $WebAppName --query principalId --output tsv
Assert-NativeSuccess 'Reading the web app managed identity'
if (-not $principalId) { throw 'The web app does not have a system-assigned managed identity.' }

$graph = az ad sp show --id 00000003-0000-0000-c000-000000000000 --output json | ConvertFrom-Json
Assert-NativeSuccess 'Resolving the Microsoft Graph service principal'
$role = @($graph.appRoles | Where-Object { $_.value -eq 'Mail.Send' -and $_.allowedMemberTypes -contains 'Application' })[0]
if (-not $role) { throw 'The Microsoft Graph Mail.Send application role could not be found.' }

$existing = az rest --method GET --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$principalId/appRoleAssignments" --output json | ConvertFrom-Json
Assert-NativeSuccess 'Listing Graph app role assignments'
$alreadyGranted = @($existing.value) | Where-Object { $_.appRoleId -eq $role.id -and $_.resourceId -eq $graph.id }
if (-not $alreadyGranted) {
  $bodyPath = Join-Path ([IO.Path]::GetTempPath()) "invite-mail-role-$([Guid]::NewGuid().ToString('N')).json"
  try {
    @{ principalId = $principalId; resourceId = $graph.id; appRoleId = $role.id } | ConvertTo-Json | Set-Content -LiteralPath $bodyPath -Encoding utf8
    az rest --method POST --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$principalId/appRoleAssignments" --headers 'Content-Type=application/json' --body "@$bodyPath" --output none
    Assert-NativeSuccess 'Granting Microsoft Graph Mail.Send to the web app identity'
  } finally {
    if (Test-Path -LiteralPath $bodyPath) { Remove-Item -LiteralPath $bodyPath -Force }
  }
}

if (-not $PortalPublicUrl) {
  $hostName = az webapp show --resource-group $ResourceGroup --name $WebAppName --query defaultHostName --output tsv
  Assert-NativeSuccess 'Reading the web app hostname'
  $PortalPublicUrl = "https://$hostName"
}

az webapp config appsettings set --resource-group $ResourceGroup --name $WebAppName --settings "INVITE_MAIL_FROM=$MailFrom" "PORTAL_PUBLIC_URL=$PortalPublicUrl" --only-show-errors | Out-Null
Assert-NativeSuccess 'Saving invite mail app settings'

Write-Host "Invite email is configured. New users will be mailed from $MailFrom with a sign-in link to $PortalPublicUrl."
Write-Host 'Restrict Graph Mail.Send to this mailbox with an Exchange application access policy if your tenant requires it:'
Write-Host "  New-ApplicationAccessPolicy -AppId <web-app-identity-app-id> -PolicyScopeGroupId $MailFrom -AccessRight RestrictAccess -Description 'Launchpad invite mail'"
