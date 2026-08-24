targetScope = 'resourceGroup'

param webAppName string
param tenantId string
param clientId string
@description('Easy Auth uses the assigned managed identity as a federated client assertion instead of a client secret.')
#disable-next-line secure-secrets-in-params
param clientSecretSettingName string = 'OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID'

resource webApp 'Microsoft.Web/sites@2023-12-01' existing = { name: webAppName }

var appOrigin = 'https://${webAppName}.azurewebsites.net'

resource auth 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: webApp
  name: 'authsettingsV2'
  properties: {
    platform: { enabled: true, runtimeVersion: '~1' }
    globalValidation: {
      requireAuthentication: true
      unauthenticatedClientAction: 'RedirectToLoginPage'
      redirectToProvider: 'azureActiveDirectory'
      excludedPaths: ['/healthz']
    }
    httpSettings: { requireHttps: true }
    login: {
      allowedExternalRedirectUrls: [appOrigin]
      tokenStore: { enabled: false }
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          clientId: clientId
          clientSecretSettingName: clientSecretSettingName
          openIdIssuer: '${environment().authentication.loginEndpoint}${tenantId}/v2.0'
        }
        validation: { allowedAudiences: [clientId] }
      }
    }
  }
}
