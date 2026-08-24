import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ApiError } from '@/services/HttpPortalApi';
import { portalApi } from '@/services/portalApi';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import type { ArtifactSummary, NotificationFeed, PortalFeatures, PortalIdentity } from '@/types/portal';
import { usageTelemetry } from '@/services/usageTelemetry';

const emptyNotifications: NotificationFeed = { items: [], unreadCount: 0 };

interface PortalContextValue {
  identity: PortalIdentity | null;
  catalog: ArtifactSummary[];
  notifications: NotificationFeed;
  notificationsLoading: boolean;
  notificationsError: string | null;
  loading: boolean;
  error: string | null;
  /** Structured code from the last bootstrap failure, e.g. PORTAL_ACCESS_REQUIRED. */
  errorCode: string | null;
  refresh: () => Promise<void>;
  refreshCatalog: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  toggleFavorite: (artifactId: string) => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  connect: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  features: PortalFeatures;
  markArtifactUsed: (artifactId: string, occurredAt?: string) => void;
}

const PortalContext = createContext<PortalContextValue | null>(null);

export function PortalProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [identity, setIdentity] = useState<PortalIdentity | null>(null);
  const [catalog, setCatalog] = useState<ArtifactSummary[]>([]);
  const [notifications, setNotifications] = useState<NotificationFeed>(emptyNotifications);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [features, setFeatures] = useState<PortalFeatures>({ usageTelemetry: false, usageInsights: false });

  const refreshNotifications = useCallback(async () => {
    setNotificationsLoading(true); setNotificationsError(null);
    try { setNotifications(await portalApi.getNotifications()); }
    catch (caught) { setNotificationsError(caught instanceof Error ? caught.message : 'Notifications could not be loaded.'); }
    finally { setNotificationsLoading(false); }
  }, []);

  const refreshCatalog = useCallback(async () => {
    try { setCatalog(await portalApi.getMyCatalog()); setError(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'The library could not be refreshed.'); }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null); setErrorCode(null);
    setNotificationsLoading(true); setNotificationsError(null);
    try {
      // A single bootstrap round trip: the server binds first-time identities
      // before reading the catalog and notifications, so ordering is preserved.
      const next = await portalApi.getBootstrap();
      setIdentity(next.identity); setCatalog(next.catalog); setNotifications(next.notifications);
      const nextFeatures = next.features ?? { usageTelemetry: false, usageInsights: false };
      setFeatures(nextFeatures); usageTelemetry.configure(nextFeatures.usageTelemetry); usageTelemetry.startSession();
    } catch (caught) {
      usageTelemetry.configure(false); setFeatures({ usageTelemetry: false, usageInsights: false });
      setError(caught instanceof Error ? caught.message : 'The portal could not be loaded.');
      setErrorCode(caught instanceof ApiError ? caught.code : null);
    } finally { setLoading(false); setNotificationsLoading(false); }
  }, []);

  const markNotificationRead = useCallback(async (id: string) => {
    const readAt = new Date().toISOString();
    setNotifications((current) => ({
      items: current.items.map((item) => item.id === id ? { ...item, readAt: item.readAt ?? readAt } : item),
      unreadCount: Math.max(0, current.unreadCount - (current.items.some((item) => item.id === id && !item.readAt) ? 1 : 0)),
    }));
    try { await portalApi.markNotificationRead(id); }
    catch (caught) { setNotificationsError(caught instanceof Error ? caught.message : 'The notification could not be updated.'); await refreshNotifications(); }
  }, [refreshNotifications]);

  const toggleFavorite = useCallback(async (artifactId: string) => {
    const current = catalog.find((item) => item.id === artifactId);
    if (!current) return;
    const enabled = !current.isFavorite;
    setCatalog((items) => items.map((item) => item.id === artifactId ? { ...item, isFavorite: enabled } : item));
    try { await portalApi.setFavorite(artifactId, enabled); }
    catch (caught) {
      // Revert the optimistic change and mention it quietly; a failed star is
      // no reason to replace the whole library with an error page.
      setCatalog((items) => items.map((item) => item.id === artifactId ? { ...item, isFavorite: !enabled } : item));
      toast({ kind: 'error', title: 'The favourite could not be saved.', body: caught instanceof Error ? caught.message : 'Try again in a moment.' });
    }
  }, [catalog, toast]);

  const markAllNotificationsRead = useCallback(async () => {
    const readAt = new Date().toISOString();
    setNotifications((current) => ({ items: current.items.map((item) => ({ ...item, readAt: item.readAt ?? readAt })), unreadCount: 0 }));
    try { await portalApi.markAllNotificationsRead(); }
    catch (caught) { setNotificationsError(caught instanceof Error ? caught.message : 'Notifications could not be updated.'); await refreshNotifications(); }
  }, [refreshNotifications]);

  const connect = useCallback(async () => { await portalApi.connect(); await refresh(); }, [refresh]);
  const completeOnboarding = useCallback(async () => {
    await portalApi.completeOnboarding();
    setIdentity((current) => current ? { ...current, hasCompletedTour: true } : current);
  }, []);
  const markArtifactUsed = useCallback((artifactId: string, occurredAt = new Date().toISOString()) => {
    if (!features.usageTelemetry) return;
    setCatalog((items) => items.map((item) => item.id === artifactId ? { ...item, lastOpenedAt: occurredAt } : item));
  }, [features.usageTelemetry]);

  useEffect(() => { if (user?.email) portalApi.setLoginHint?.(user.email); void refresh(); }, [user?.email, refresh]);
  useEffect(() => {
    if (!user?.email) return;
    const refreshContent = () => { if (!document.hidden) void Promise.all([refreshCatalog(), refreshNotifications()]); };
    const poll = window.setInterval(refreshContent, 60_000);
    const visible = () => refreshContent();
    document.addEventListener('visibilitychange', visible);
    return () => { window.clearInterval(poll); document.removeEventListener('visibilitychange', visible); };
  }, [user?.email, refreshCatalog, refreshNotifications]);
  const value = useMemo(() => ({
    identity, catalog, notifications, notificationsLoading, notificationsError, loading, error, errorCode,
    refresh, refreshCatalog, refreshNotifications, toggleFavorite, markNotificationRead, markAllNotificationsRead, connect, completeOnboarding, features, markArtifactUsed,
  }), [identity, catalog, notifications, notificationsLoading, notificationsError, loading, error, errorCode, refresh, refreshCatalog, refreshNotifications, toggleFavorite, markNotificationRead, markAllNotificationsRead, connect, completeOnboarding, features, markArtifactUsed]);
  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePortal() {
  const context = useContext(PortalContext);
  if (!context) throw new Error('usePortal must be used inside PortalProvider');
  return context;
}
