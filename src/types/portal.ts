export type ArtifactKind = 'report' | 'tool';
export const ARTIFACT_ICON_VALUES = [
  'chart', 'pie', 'table', 'trend', 'activity', 'gauge',
  'file', 'clipboard', 'presentation',
  'package', 'boxes', 'truck', 'warehouse',
  'calculator', 'percent', 'search', 'sliders',
  'wrench', 'flask', 'database', 'scan', 'target', 'calendar', 'users', 'shield', 'layers', 'map', 'sparkles',
] as const;
export type ArtifactIcon = typeof ARTIFACT_ICON_VALUES[number];

const ARTIFACT_ICON_SET = new Set<string>(ARTIFACT_ICON_VALUES);

export function parseArtifactIcon(value: unknown): ArtifactIcon | undefined {
  const icon = String(value ?? '');
  return ARTIFACT_ICON_SET.has(icon) ? icon as ArtifactIcon : undefined;
}
export type UserStatus = 'pending' | 'active' | 'disabled';
export type PortalRole = 'viewer' | 'admin';
export type GrantTargetType = 'user' | 'group';

export interface PortalIdentity {
  id: string;
  tenantId: string;
  entraObjectId: string | null;
  email: string;
  displayName: string;
  role: PortalRole;
  status: UserStatus;
  /** Present on current Azure API responses; optional for older persisted development fixtures. */
  hasCompletedTour?: boolean;
}

export interface ArtifactSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  kind: ArtifactKind;
  version: string;
  owner: string;
  dataDate: string | null;
  publishedAt?: string;
  updatedAt?: string;
  entryUrl: string;
  capabilities: string[];
  datasetKeys: string[];
  accent: 'blue' | 'teal';
  icon?: ArtifactIcon;
  isFavorite?: boolean;
  source?: 'bundled' | 'uploaded';
  isActive?: boolean;
  hostedHtml?: string;
  lastOpenedAt?: string | null;
}

export const CLIENT_USAGE_EVENT_TYPES = [
  'portal_session_started', 'catalog_searched', 'artifact_opened', 'artifact_ready', 'artifact_failed',
] as const;
export type ClientUsageEventType = typeof CLIENT_USAGE_EVENT_TYPES[number];
export type ServerUsageEventType = 'favorite_changed';
export const ARTIFACT_FAILURE_CODES = [
  'DATASET_LOAD_FAILED', 'ARTIFACT_REPORTED_ERROR', 'INITIALIZATION_TIMEOUT', 'FRAME_LOAD_FAILED',
] as const;
export type ArtifactFailureCode = typeof ARTIFACT_FAILURE_CODES[number];

export interface UsageEventInput {
  id: string;
  eventType: ClientUsageEventType;
  sessionId: string;
  interactionId?: string;
  artifactId?: string;
  occurredAt: string;
  resultCount?: number;
  kindFilter?: 'all' | ArtifactKind;
  filterCount?: number;
  errorCode?: ArtifactFailureCode;
  durationMs?: number;
}

export type UsageInsightsRange = '7d' | '28d' | '90d';

export interface UsageInsights {
  range: UsageInsightsRange;
  from: string;
  to: string;
  summary: {
    weeklyActiveUsers: number;
    monthlyActiveUsers: number;
    repeatUsers: number;
    repeatUserRate: number;
    successfulLoads: number;
    failedLoads: number;
    loadSuccessRate: number;
    searches: number;
    zeroResultSearches: number;
    zeroResultRate: number;
    favoriteAdds: number;
    favoriteRemovals: number;
  };
  activation: {
    activePortalUsers: number;
    usersWithPortalSession: number;
    usersWithSuccessfulArtifact: number;
    repeatUsers: number;
  };
  daily: Array<{
    date: string;
    activeUsers: number;
    successfulLoads: number;
    failedLoads: number;
    searches: number;
    zeroResultSearches: number;
  }>;
  artifacts: Array<{
    artifactId: string;
    title: string;
    kind: ArtifactKind;
    uniqueUsers: number;
    successfulLoads: number;
    failedLoads: number;
    loadSuccessRate: number;
    lastUsedAt: string | null;
    favoriteAdds: number;
  }>;
}

export interface PortalFeatures {
  usageTelemetry: boolean;
  usageInsights: boolean;
}

export interface PortalGroup {
  id: string;
  name: string;
  description: string;
  memberCount: number;
}

export interface GroupMember {
  id: string;
  groupId: string;
  userId: string;
}

export interface ArtifactGrant {
  id: string;
  artifactId: string;
  targetType: GrantTargetType;
  targetId: string;
}

export interface DatasetEnvelope<T = unknown> {
  artifactId: string;
  datasetKey: string;
  schemaVersion: number;
  generatedAt: string;
  checksum: string;
  payload: T;
}

export interface DatasetRecord {
  id: string;
  artifactId: string;
  datasetKey: string;
  schemaVersion: number;
  generatedAt: string;
  checksum: string;
  sizeBytes: number;
  recordCount: number;
  status: 'active' | 'superseded';
}

export const PORTAL_NOTIFICATION_TYPES = ['dataset_refreshed', 'artifact_published', 'access_granted', 'access_requested', 'user_joined'] as const;
export type PortalNotificationType = typeof PORTAL_NOTIFICATION_TYPES[number];

export interface PortalNotification {
  id: string;
  type: PortalNotificationType;
  artifactId: string | null;
  artifactSlug: string | null;
  artifactTitle: string | null;
  artifactKind: ArtifactKind | null;
  datasetKey: string | null;
  /** Person the event is about (e.g. the requester on access_requested). */
  subjectLabel: string | null;
  generatedAt: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationFeed {
  items: PortalNotification[];
  unreadCount: number;
}

export type AccessRequestState = 'requested' | 'approved' | 'dismissed';

export interface AccessRequestRecord {
  id: string;
  email: string;
  displayName: string;
  note: string;
  status: AccessRequestState;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  occurredAt: string;
  actorEmail: string;
  action: string;
  subjectType: string;
  subjectLabel: string;
  detail: string;
}

export type QlikCleanOutput = 'qlik' | 'rows' | 'as-of-rows';
export type QlikCleanKeys = 'slug' | 'title';
export type QlikRowFilterMode = 'and' | 'or';
export type QlikRowFilterOp = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'contains' | 'empty' | 'notEmpty';

export interface QlikRowFilter {
  column: string;
  op: QlikRowFilterOp;
  value?: string;
}

export interface QlikCleanRecipe {
  output: QlikCleanOutput;
  keys: QlikCleanKeys;
  keepColumns: string[];
  dropEmptyRows: boolean;
  rowFilterMode: QlikRowFilterMode;
  rowFilters: QlikRowFilter[];
}

export const DEFAULT_QLIK_CLEAN_RECIPE: QlikCleanRecipe = {
  output: 'qlik',
  keys: 'slug',
  keepColumns: [],
  dropEmptyRows: false,
  rowFilterMode: 'and',
  rowFilters: [],
};

export interface QlikBindingInput {
  appId: string;
  objectId: string;
  refreshHourUtc: number;
  refreshMinuteUtc: number;
  enabled?: boolean;
  transform?: Partial<QlikCleanRecipe> | QlikCleanRecipe;
}

export interface QlikDatasetBinding {
  artifactId: string;
  datasetKey: string;
  appId: string;
  objectId: string;
  refreshHourUtc: number;
  refreshMinuteUtc: number;
  enabled: boolean;
  lastPulledAt: string | null;
  lastError: string | null;
  lastRecordCount: number | null;
  nextDueAt: string;
  updatedAt: string;
  transform: QlikCleanRecipe;
}

export interface QlikAppSummary {
  id: string;
  name: string;
  description: string;
  updatedAt: string | null;
}

export interface QlikTableSummary {
  objectId: string;
  title: string;
  sheetTitle: string;
  qType: string;
  columns: string[];
  rowCount: number;
}

export interface QlikPreviewColumn {
  key: string;
  title: string;
  role: 'dimension' | 'measure';
}

export interface QlikPreviewSample {
  appId: string;
  objectId: string;
  columns: QlikPreviewColumn[];
  rows: Array<Array<string | number | null>>;
  sourceRowCount: number;
  truncated: boolean;
}

export interface AdminSnapshot {
  users: PortalIdentity[];
  groups: PortalGroup[];
  memberships: GroupMember[];
  grants: ArtifactGrant[];
  artifacts: ArtifactSummary[];
  datasets: DatasetRecord[];
  qlikBindings: QlikDatasetBinding[];
  qlikConfigured: boolean;
  audit: AuditEvent[];
  accessRequests: AccessRequestRecord[];
}

export interface ArtifactCompatibilityIssue {
  code: string;
  message: string;
  source?: string;
  remediation: string;
}

export interface ArtifactCompatibilityReport {
  status: 'ready' | 'blocked';
  preflightToken?: string;
  expiresAt?: string;
  previewUrl?: string;
  inputBytes: number;
  normalizedBytes: number;
  dependencies: Array<{ url: string; sha256: string; sizeBytes: number; contentType: string }>;
  transformations: Array<{ code: string; source: string; message: string }>;
  warnings: ArtifactCompatibilityIssue[];
  blockers: ArtifactCompatibilityIssue[];
}

export interface PortalBootstrap {
  identity: PortalIdentity;
  catalog: ArtifactSummary[];
  notifications: NotificationFeed;
  features: PortalFeatures;
}

export interface QlikBindingContext {
  artifact: ArtifactSummary | null;
  binding: QlikDatasetBinding | null;
  qlikConfigured: boolean;
}

export type InviteDeliveryStatus = 'downloaded' | 'failed';
export interface InviteDelivery {
  status: InviteDeliveryStatus;
  message: string;
  filename?: string;
  eml?: string;
}

export interface PortalApi {
  setLoginHint?(email: string): void;
  connect(): Promise<void>;
  whoAmI(): Promise<PortalIdentity>;
  getBootstrap(): Promise<PortalBootstrap>;
  recordUsageEvents(events: UsageEventInput[]): Promise<void>;
  getUsageInsights(range: UsageInsightsRange): Promise<UsageInsights>;
  getMyAccessRequest(): Promise<AccessRequestRecord | null>;
  submitAccessRequest(note: string): Promise<AccessRequestRecord>;
  completeOnboarding(): Promise<void>;
  getMyCatalog(): Promise<ArtifactSummary[]>;
  setFavorite(artifactId: string, enabled: boolean): Promise<void>;
  getArtifactData(artifactId: string, datasetKey: string): Promise<DatasetEnvelope>;
  getNotifications(): Promise<NotificationFeed>;
  markNotificationRead(id: string): Promise<void>;
  markAllNotificationsRead(): Promise<void>;
  seedDataset(artifactId: string, datasetKey: string, payload: unknown): Promise<void>;
  getQlikBindingContext(artifactId: string, datasetKey: string): Promise<QlikBindingContext>;
  saveQlikBinding(artifactId: string, datasetKey: string, input: QlikBindingInput): Promise<QlikDatasetBinding>;
  deleteQlikBinding(artifactId: string, datasetKey: string): Promise<void>;
  pullQlikBinding(artifactId: string, datasetKey: string): Promise<QlikDatasetBinding>;
  listQlikApps(query?: string): Promise<QlikAppSummary[]>;
  listQlikTables(appId: string): Promise<QlikTableSummary[]>;
  previewQlikTable(input: { appId: string; objectId: string }): Promise<QlikPreviewSample>;
  getAdminSnapshot(): Promise<AdminSnapshot>;
  addUser(input: { email: string; displayName: string; role: PortalRole }): Promise<PortalIdentity & { invite: InviteDelivery }>;
  approveAccessRequest(id: string, input: { role: PortalRole }): Promise<PortalIdentity>;
  dismissAccessRequest(id: string): Promise<void>;
  resendUserInvite(id: string): Promise<InviteDelivery>;
  updateUser(id: string, patch: { status?: UserStatus; role?: PortalRole }): Promise<void>;
  deleteUser(id: string): Promise<void>;
  addGroup(input: { name: string; description: string }): Promise<PortalGroup>;
  addMembership(groupId: string, userId: string): Promise<void>;
  removeMembership(groupId: string, userId: string): Promise<void>;
  setGrant(input: { artifactId: string; targetType: GrantTargetType; targetId: string; enabled: boolean }): Promise<void>;
  preflightArtifact(input: { html?: File; zip?: File; jsonFiles?: File[] }): Promise<ArtifactCompatibilityReport>;
  publishArtifact(input: {
    title: string;
    description: string;
    kind: ArtifactKind;
    owner: string;
    dataDate?: string;
    capabilities?: string[];
    icon?: ArtifactIcon;
    slug?: string;
    html?: File;
    zip?: File;
    jsonFiles?: File[];
    preflightToken?: string;
  }): Promise<ArtifactSummary>;
  replaceArtifactBundle(id: string, input: { html?: File; zip?: File; jsonFiles?: File[] }): Promise<ArtifactSummary>;
  updatePublishedArtifact(id: string, patch: { isActive?: boolean; title?: string; description?: string; owner?: string; dataDate?: string | null; icon?: ArtifactIcon; capabilities?: string[] }): Promise<void>;
  deletePublishedArtifact(id: string): Promise<void>;
}
