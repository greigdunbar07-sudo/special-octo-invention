import { Bell, CheckCheck, DatabaseZap, KeyRound, Upload, UserRoundPlus, UsersRound, X, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { usePortal } from '@/hooks/PortalContext';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import type { PortalNotification } from '@/types/portal';

function relativeTime(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minute = 60_000; const hour = 60 * minute; const day = 24 * hour;
  if (elapsed < minute) return 'Just now';
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}m ago`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)}h ago`;
  if (elapsed < 7 * day) return `${Math.floor(elapsed / day)}d ago`;
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface NotificationMeta {
  Icon: LucideIcon;
  title: string;
  body: string;
  to: string;
}

function notificationMeta(item: PortalNotification): NotificationMeta {
  const artifactTo = item.artifactSlug ? `/artifacts/${item.artifactSlug}` : '/';
  switch (item.type) {
    case 'artifact_published':
      return { Icon: Upload, title: item.artifactTitle ?? 'Library item', body: 'A new version was published', to: artifactTo };
    case 'access_granted':
      return { Icon: KeyRound, title: item.artifactTitle ?? 'Library item', body: 'You now have access', to: artifactTo };
    case 'access_requested':
      return { Icon: UserRoundPlus, title: item.subjectLabel ?? 'Someone', body: 'Requested portal access', to: '/admin' };
    case 'user_joined':
      return { Icon: UsersRound, title: item.subjectLabel ?? 'A new user', body: 'Joined Launchpad for the first time', to: '/admin' };
    default:
      return { Icon: DatabaseZap, title: item.artifactTitle ?? 'Library item', body: 'Dataset refreshed', to: artifactTo };
  }
}

function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const startOfDay = (input: Date) => new Date(input.getFullYear(), input.getMonth(), input.getDate()).getTime();
  const difference = Math.round((startOfDay(today) - startOfDay(date)) / 86_400_000);
  if (difference <= 0) return 'Today';
  if (difference === 1) return 'Yesterday';
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
}

export function NotificationCenter() {
  const { notifications, notificationsLoading, notificationsError, markNotificationRead, markAllNotificationsRead } = usePortal();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [announcement, setAnnouncement] = useState('');
  const previousUnread = useRef(notifications.unreadCount);
  const root = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useFocusTrap(root, open);

  useEffect(() => {
    const previous = previousUnread.current;
    previousUnread.current = notifications.unreadCount;
    if (notifications.unreadCount > previous) {
      const newest = notifications.items.find((item) => !item.readAt);
      const meta = newest ? notificationMeta(newest) : null;
      setAnnouncement(meta ? `${meta.title}: ${meta.body}.` : 'You have a new notification.');
      const timeout = window.setTimeout(() => setAnnouncement(''), 5_000);
      return () => window.clearTimeout(timeout);
    }
  }, [notifications]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [open]);

  async function openNotification(item: PortalNotification) {
    if (!item.readAt) await markNotificationRead(item.id);
    setOpen(false);
    navigate(notificationMeta(item).to);
  }

  const visible = useMemo(
    () => filter === 'unread' ? notifications.items.filter((item) => !item.readAt) : notifications.items,
    [notifications.items, filter],
  );
  const groups = useMemo(() => {
    const result: Array<{ label: string; items: PortalNotification[] }> = [];
    for (const item of visible) {
      const label = dayLabel(item.createdAt);
      const group = result[result.length - 1];
      if (group?.label === label) group.items.push(item);
      else result.push({ label, items: [item] });
    }
    return result;
  }, [visible]);

  const badge = notifications.unreadCount > 99 ? '99+' : String(notifications.unreadCount);
  return <div className="notification-centre" ref={root}>
    <button className="icon-button notification-trigger" type="button" aria-label={`Notifications${notifications.unreadCount ? `, ${notifications.unreadCount} unread` : ''}`} aria-expanded={open} aria-controls="notification-panel" onClick={() => setOpen((value) => !value)}>
      <Bell size={19} />{notifications.unreadCount > 0 && <span className="notification-badge" aria-hidden="true">{badge}</span>}
    </button>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    {open && <section id="notification-panel" className="notification-panel" role="dialog" aria-label="Notifications">
      <header className="notification-panel-header">
        <div><p className="eyebrow">Updates</p><h2>Notifications</h2></div>
        <div className="notification-header-actions">
          {notifications.unreadCount > 0 && <button className="text-action" type="button" onClick={() => void markAllNotificationsRead()}><CheckCheck size={15} /> Mark all read</button>}
          <button className="icon-button notification-close" type="button" aria-label="Close notifications" onClick={() => setOpen(false)}><X size={18} /></button>
        </div>
      </header>
      {notifications.items.length > 0 && <div className="notification-filter" role="group" aria-label="Filter notifications">
        <button type="button" className={filter === 'all' ? 'active' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
        <button type="button" className={filter === 'unread' ? 'active' : ''} aria-pressed={filter === 'unread'} onClick={() => setFilter('unread')}>Unread{notifications.unreadCount > 0 ? ` (${badge})` : ''}</button>
      </div>}
      {notificationsLoading && notifications.items.length === 0 ? <div className="notification-state"><span className="spinner" /> Loading updates…</div> :
        notificationsError && notifications.items.length === 0 ? <div className="notification-state notification-error" role="alert">{notificationsError}</div> :
        notifications.items.length === 0 ? <div className="notification-state"><Bell size={23} /><strong>You’re all caught up</strong><span>Updates about your reports, tools, and access will appear here.</span></div> :
        visible.length === 0 ? <div className="notification-state"><CheckCheck size={23} /><strong>Nothing unread</strong><span>Switch to All to see earlier updates.</span></div> :
        <div className="notification-list">{groups.map((group) => <div className="notification-group" key={group.label}>
          <p className="notification-day">{group.label}</p>
          {group.items.map((item) => {
            const { Icon, title, body } = notificationMeta(item);
            return <button className={`notification-item${item.readAt ? '' : ' unread'}`} type="button" key={item.id} onClick={() => void openNotification(item)}>
              <span className={`notification-icon notification-icon-${item.type}`}><Icon size={18} /></span>
              <span className="notification-copy"><strong>{title}</strong><span>{body}</span><small>{relativeTime(item.createdAt)}</small></span>
              {!item.readAt && <span className="unread-dot" aria-label="Unread" />}
            </button>;
          })}
        </div>)}</div>}
      {notificationsError && notifications.items.length > 0 && <p className="notification-inline-error" role="status">Latest updates could not be checked.</p>}
    </section>}
  </div>;
}
