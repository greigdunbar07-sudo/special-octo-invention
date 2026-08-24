import { AppServiceAuthService } from './AppServiceAuthService';
import type { IAuthService } from './IAuthService';
import { MockAuthService } from './MockAuthService';

/**
 * Vite development uses the in-memory fixture. Production is authenticated
 * by Azure App Service before requests reach the container.
 */
export function bootstrapAuth(): IAuthService {
  return import.meta.env.DEV ? new MockAuthService() : new AppServiceAuthService();
}
