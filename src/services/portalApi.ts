import { HttpPortalApi } from './HttpPortalApi';
import { MockPortalApi } from './MockPortalApi';
import type { PortalApi } from '@/types/portal';

export function createPortalApi(): PortalApi {
  return import.meta.env.DEV ? new MockPortalApi() : new HttpPortalApi();
}

export const portalApi = createPortalApi();
