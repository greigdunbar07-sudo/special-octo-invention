import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

import compression from 'compression';
import express, { type RequestHandler } from 'express';
import helmet from 'helmet';
import multer from 'multer';

import { artifactHtmlCsp, MAX_ZIP_BYTES, refreshHostShim } from '../scripts/artifact-package.mjs';
import { principalFromRequest } from './auth.js';
import { ArtifactRegistry } from './artifacts.js';
import { qlikIsConfigured, usageTelemetryEnabled, type AppConfig } from './config.js';
import { DatasetService } from './datasets.js';
import { AppError, asyncRoute, errorHandler, notFound } from './errors.js';
import { inviteFileForRequest } from './invite-mail.js';
import { QlikPullService } from './qlik.js';
import { startQlikScheduler } from './qlik-scheduler.js';
import { ArtifactPublishService } from './publish.js';
import { PortalRepository } from './repository.js';
import { concurrencyLimit, contentLengthLimit, PORTAL_CONTENT_SECURITY_POLICY, rateLimit } from './security.js';
import { PortalStorage, contentTypeFor, safeStorageKey } from './storage.js';
import { parseUsageEventBatch, parseUsageInsightsRange } from './usage.js';
import { startUsageMaintenance } from './usage-maintenance.js';

const MAX_COMBINED_UPLOAD_BYTES = 30 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ZIP_BYTES, files: 11, fields: 12, parts: 23 },
});

export function createApp(config: AppConfig, options: { enableQlikScheduler?: boolean; enableUsageMaintenance?: boolean } = {}) {
  const app = express();
  const registry = new ArtifactRegistry(config.artifactRoot);
  const repository = new PortalRepository(config, registry);
  const storage = new PortalStorage(config);
  const datasets = new DatasetService(registry, repository, storage);
  const qlik = new QlikPullService(config, repository, datasets);
  const publisher = new ArtifactPublishService(registry, repository, datasets, storage);
  const param = (value: string | string[]): string => Array.isArray(value) ? value[0] : value;

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(compression());
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use((_request, response, next) => {
    response.setHeader('Content-Security-Policy', PORTAL_CONTENT_SECURITY_POLICY);
    response.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(), payment=(), usb=()');
    next();
  });
  app.get('/healthz', (_request, response) => response.status(200).json({ status: 'ok' }));
  app.use('/api', (_request, response, next) => { response.setHeader('Cache-Control', 'private, no-store'); next(); });
  app.use('/api/usage', contentLengthLimit(64 * 1024, 'The usage event batch exceeds the service limit.', 'USAGE_BATCH_TOO_LARGE'));
  app.use('/api', (request, response, next) => {
    if (String(request.headers['content-type'] ?? '').includes('multipart/form-data')) return next();
    express.json({ limit: '11mb', strict: true })(request, response, next);
  });

  const principal: RequestHandler = (request, response, next) => {
    try { response.locals.principal = principalFromRequest(request, config.tenantId); next(); }
    catch (error) { next(error); }
  };
  const portalUser: RequestHandler = asyncRoute(async (_request, response, next) => {
    response.locals.user = await repository.resolveUser(response.locals.principal);
    next();
  });
  const admin: RequestHandler = (_request, response, next) => {
    try { repository.requireAdmin(response.locals.user); next(); } catch (error) { next(error); }
  };
  const uploadKey = (_request: express.Request, response: express.Response) => String(response.locals.user?.id ?? 'anonymous');
  const qlikKey = (_request: express.Request, response: express.Response) => `qlik:${response.locals.user?.id ?? 'anonymous'}`;
  const uploadRateLimit = rateLimit({ max: 20, windowMs: 10 * 60_000, key: uploadKey });
  const uploadConcurrencyLimit = concurrencyLimit({ max: 1, key: uploadKey });
  const uploadSizeLimit = contentLengthLimit(MAX_COMBINED_UPLOAD_BYTES);
  const qlikCatalogLimit = rateLimit({
    max: 40,
    windowMs: 10 * 60_000,
    key: qlikKey,
    message: 'Too many Qlik catalog requests. Wait before trying again.',
  });
  const qlikCatalogBusy = concurrencyLimit({
    max: 2,
    key: qlikKey,
    message: 'The Qlik catalog is busy. Try again shortly.',
  });
  // Any authenticated tenant identity can submit an access request, so keep it
  // tightly throttled per principal.
  const accessRequestLimit = rateLimit({
    max: 5,
    windowMs: 10 * 60_000,
    key: (_request, response) => `access-request:${response.locals.principal?.objectId ?? 'anonymous'}`,
    message: 'Too many access requests. Wait before trying again.',
  });
  const usageRateLimit = rateLimit({
    max: 120,
    windowMs: 10 * 60_000,
    key: (_request, response) => `usage:${response.locals.user?.id ?? 'anonymous'}`,
    message: 'Too many usage event batches. Wait before trying again.',
  });
  const telemetry: RequestHandler = (_request, response, next) => {
    if (usageTelemetryEnabled(config, response.locals.user.role)) return next();
    next(new AppError(404, 'FEATURE_DISABLED', 'Usage telemetry is not enabled.'));
  };
  const insights: RequestHandler = (_request, _response, next) => {
    if (config.usageInsightsEnabled) return next();
    next(new AppError(404, 'FEATURE_DISABLED', 'Usage insights are not enabled.'));
  };

  app.get('/api/auth/me', principal, (_request, response) => {
    const item = response.locals.principal;
    response.json({ id: item.objectId, email: item.email, name: item.name });
  });
  app.get('/api/portal/me', principal, portalUser, asyncRoute(async (_request, response) => {
    if (response.locals.user.role === 'admin') await repository.ensureArtifacts(response.locals.user);
    response.json(response.locals.user);
  }));
  app.put('/api/portal/onboarding', principal, portalUser, asyncRoute(async (_request, response) => {
    await repository.completeOnboarding(response.locals.user);
    response.status(204).end();
  }));
  // Access requests authenticate with the Easy Auth principal alone: the whole
  // point is that the caller has no PortalUser row yet, so resolveUser would 403.
  app.get('/api/portal/access-request', principal, asyncRoute(async (_request, response) => {
    response.json(await repository.getAccessRequest(response.locals.principal));
  }));
  app.post('/api/portal/access-request', principal, accessRequestLimit, asyncRoute(async (request, response) => {
    response.status(201).json(await repository.submitAccessRequest(response.locals.principal, request.body?.note));
  }));
  app.get('/api/portal/bootstrap', principal, portalUser, asyncRoute(async (_request, response) => {
    const user = response.locals.user;
    if (user.role === 'admin') await repository.ensureArtifacts(user);
    const [catalog, notifications] = await Promise.all([repository.catalog(user), repository.notifications(user)]);
    response.json({
      identity: user, catalog, notifications,
      features: { usageTelemetry: usageTelemetryEnabled(config, user.role), usageInsights: user.role === 'admin' && config.usageInsightsEnabled },
    });
  }));
  app.post('/api/usage/events', principal, portalUser, telemetry, usageRateLimit, asyncRoute(async (request, response) => {
    await repository.recordUsageEvents(response.locals.user, parseUsageEventBatch(request.body));
    response.status(204).end();
  }));
  app.get('/api/catalog', principal, portalUser, asyncRoute(async (_request, response) => {
    response.setHeader('Cache-Control', 'private, no-cache');
    response.json(await repository.catalog(response.locals.user));
  }));
  app.put('/api/favorites/:artifactId', principal, portalUser, asyncRoute(async (request, response) => { await repository.setFavorite(response.locals.user, param(request.params.artifactId), request.body.enabled === true); response.status(204).end(); }));
  app.get('/api/notifications', principal, portalUser, asyncRoute(async (_request, response) => {
    response.setHeader('Cache-Control', 'private, no-cache');
    response.json(await repository.notifications(response.locals.user));
  }));
  app.put('/api/notifications/read-all', principal, portalUser, asyncRoute(async (_request, response) => { await repository.markAllNotificationsRead(response.locals.user); response.status(204).end(); }));
  app.put('/api/notifications/:notificationId/read', principal, portalUser, asyncRoute(async (request, response) => { await repository.markNotificationRead(response.locals.user, param(request.params.notificationId)); response.status(204).end(); }));
  app.get('/api/artifacts/:artifactId/datasets/:datasetKey', principal, portalUser, asyncRoute(async (request, response) => {
    const result = await datasets.downloadIfChanged(response.locals.user, param(request.params.artifactId), param(request.params.datasetKey), request.get('if-none-match'));
    response.setHeader('Cache-Control', 'private, no-cache');
    response.setHeader('ETag', result.etag);
    if (!result.envelope) {
      response.status(304).end();
      return;
    }
    response.json(result.envelope);
  }));

  app.get('/api/admin/snapshot', principal, portalUser, admin, asyncRoute(async (_request, response) => response.json(await repository.adminSnapshot(response.locals.user))));
  app.get('/api/admin/usage-insights', principal, portalUser, admin, insights, asyncRoute(async (request, response) => {
    response.json(await repository.usageInsights(response.locals.user, parseUsageInsightsRange(request.query.range)));
  }));
  app.post('/api/admin/users', principal, portalUser, admin, asyncRoute(async (request, response) => {
    const user = await repository.addUser(response.locals.user, request.body);
    const invite = inviteFileForRequest(config, request, { user, invitedBy: response.locals.user });
    response.status(201).json({ ...user, invite });
  }));
  app.post('/api/admin/users/:id/invite', principal, portalUser, admin, asyncRoute(async (request, response) => {
    const user = await repository.getUser(response.locals.user, param(request.params.id));
    const invite = inviteFileForRequest(config, request, { user, invitedBy: response.locals.user });
    response.json(invite);
  }));
  app.post('/api/admin/access-requests/:id/approve', principal, portalUser, admin, asyncRoute(async (request, response) => {
    const role = request.body?.role === 'admin' ? 'admin' : 'viewer';
    response.json(await repository.approveAccessRequest(response.locals.user, param(request.params.id), role));
  }));
  app.post('/api/admin/access-requests/:id/dismiss', principal, portalUser, admin, asyncRoute(async (request, response) => {
    await repository.dismissAccessRequest(response.locals.user, param(request.params.id));
    response.status(204).end();
  }));
  app.patch('/api/admin/users/:id', principal, portalUser, admin, asyncRoute(async (request, response) => { await repository.updateUser(response.locals.user, param(request.params.id), request.body); response.status(204).end(); }));
  app.delete('/api/admin/users/:id', principal, portalUser, admin, asyncRoute(async (request, response) => { await repository.deleteUser(response.locals.user, param(request.params.id)); response.status(204).end(); }));
  app.post('/api/admin/groups', principal, portalUser, admin, asyncRoute(async (request, response) => response.status(201).json(await repository.addGroup(response.locals.user, request.body))));
  app.put('/api/admin/groups/:groupId/members/:userId', principal, portalUser, admin, asyncRoute(async (request, response) => { await repository.setMembership(response.locals.user, param(request.params.groupId), param(request.params.userId), true); response.status(204).end(); }));
  app.delete('/api/admin/groups/:groupId/members/:userId', principal, portalUser, admin, asyncRoute(async (request, response) => { await repository.setMembership(response.locals.user, param(request.params.groupId), param(request.params.userId), false); response.status(204).end(); }));
  app.put('/api/admin/grants/:artifactId/:targetType/:targetId', principal, portalUser, admin, asyncRoute(async (request, response) => {
    const targetType = param(request.params.targetType);
    if (targetType !== 'user' && targetType !== 'group') throw new AppError(400, 'INVALID_GRANT', 'The grant target is invalid.');
    await repository.setGrant(response.locals.user, { artifactId: param(request.params.artifactId), targetType, targetId: param(request.params.targetId), enabled: request.body.enabled === true });
    response.status(204).end();
  }));
  app.post('/api/admin/artifacts/:artifactId/datasets/:datasetKey', principal, portalUser, admin, uploadRateLimit, uploadConcurrencyLimit, uploadSizeLimit, asyncRoute(async (request, response) => {
    await datasets.upload(response.locals.user, param(request.params.artifactId), param(request.params.datasetKey), request.body);
    response.status(204).end();
  }));
  app.get('/api/admin/artifacts/:artifactId/datasets/:datasetKey/qlik', principal, portalUser, admin, asyncRoute(async (request, response) => {
    const artifactId = param(request.params.artifactId);
    const [record, binding] = await Promise.all([
      repository.getArtifactById(artifactId),
      repository.getQlikBinding(artifactId, param(request.params.datasetKey)),
    ]);
    response.json({ artifact: record?.summary ?? null, binding, qlikConfigured: qlikIsConfigured(config) });
  }));
  app.put('/api/admin/artifacts/:artifactId/datasets/:datasetKey/qlik', principal, portalUser, admin, asyncRoute(async (request, response) => {
    response.json(await qlik.save(response.locals.user, param(request.params.artifactId), param(request.params.datasetKey), request.body ?? {}));
  }));
  app.delete('/api/admin/artifacts/:artifactId/datasets/:datasetKey/qlik', principal, portalUser, admin, asyncRoute(async (request, response) => {
    await qlik.remove(response.locals.user, param(request.params.artifactId), param(request.params.datasetKey));
    response.status(204).end();
  }));
  app.post('/api/admin/artifacts/:artifactId/datasets/:datasetKey/qlik/pull', principal, portalUser, admin, asyncRoute(async (request, response) => {
    response.json(await qlik.pull(response.locals.user, param(request.params.artifactId), param(request.params.datasetKey)));
  }));
  app.get('/api/admin/qlik/apps', principal, portalUser, admin, qlikCatalogLimit, qlikCatalogBusy, asyncRoute(async (request, response) => {
    response.json(await qlik.listApps(response.locals.user, String(request.query.query ?? '')));
  }));
  app.get('/api/admin/qlik/apps/:appId/tables', principal, portalUser, admin, qlikCatalogLimit, qlikCatalogBusy, asyncRoute(async (request, response) => {
    response.json(await qlik.listTables(response.locals.user, param(request.params.appId)));
  }));
  app.post('/api/admin/qlik/preview', principal, portalUser, admin, qlikCatalogLimit, qlikCatalogBusy, asyncRoute(async (request, response) => {
    const body = (request.body ?? {}) as { appId?: string; objectId?: string };
    response.json(await qlik.preview(response.locals.user, { appId: String(body.appId ?? ''), objectId: String(body.objectId ?? '') }));
  }));
  app.post('/api/admin/artifacts/preflight', principal, portalUser, admin, uploadRateLimit, uploadConcurrencyLimit, uploadSizeLimit, upload.fields([{ name: 'file', maxCount: 1 }, { name: 'json', maxCount: 10 }]), asyncRoute(async (request, response) => {
    response.json(await publisher.preflight(response.locals.user, filesFrom(request)));
  }));
  app.get('/api/admin/artifacts/preflight/:token/preview', principal, portalUser, admin, asyncRoute(async (request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Content-Security-Policy', artifactHtmlCsp(false));
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(await publisher.preview(response.locals.user, param(request.params.token)));
  }));
  app.post('/api/admin/artifacts', principal, portalUser, admin, uploadRateLimit, uploadConcurrencyLimit, uploadSizeLimit, upload.fields([{ name: 'file', maxCount: 1 }, { name: 'json', maxCount: 10 }]), asyncRoute(async (request, response) => {
    response.status(201).json(await publisher.publish(response.locals.user, fieldsFrom(request.body), filesFrom(request)));
  }));
  app.post('/api/admin/artifacts/:id/bundle', principal, portalUser, admin, uploadRateLimit, uploadConcurrencyLimit, uploadSizeLimit, upload.fields([{ name: 'file', maxCount: 1 }, { name: 'json', maxCount: 10 }]), asyncRoute(async (request, response) => {
    response.json(await publisher.replaceBundle(response.locals.user, param(request.params.id), filesFrom(request)));
  }));
  app.patch('/api/admin/artifacts/:id', principal, portalUser, admin, asyncRoute(async (request, response) => {
    await repository.updateUploadedArtifact(response.locals.user, param(request.params.id), request.body);
    response.status(204).end();
  }));
  app.delete('/api/admin/artifacts/:id', principal, portalUser, admin, asyncRoute(async (request, response) => {
    await publisher.delete(response.locals.user, param(request.params.id));
    response.status(204).end();
  }));

  app.use('/api', notFound);

  app.get('/artifacts/:slug/:file', asyncRoute(async (request, response, next) => {
    const slug = param(request.params.slug);
    const file = safeArtifactFile(param(request.params.file));
    const bundled = registry.tryBySlug(slug);
    if (bundled && bundled.manifest.datasets.length > 0) {
      const path = bundledFile(config, slug, file);
      if (!path) throw new AppError(404, 'BUNDLE_MISSING', 'The artifact file was not found.');
      sendArtifactFile(response, file, readFileSync(path), bundled.manifest.capabilities.includes('downloads'));
      return;
    }
    response.locals.principal = principalFromRequest(request, config.tenantId);
    response.locals.user = await repository.resolveUser(response.locals.principal);
    if (bundled) {
      await repository.canReadArtifact(response.locals.user, bundled.databaseId);
      const path = bundledFile(config, slug, file);
      if (!path) throw new AppError(404, 'BUNDLE_MISSING', 'The artifact file was not found.');
      sendArtifactFile(response, file, readFileSync(path), bundled.manifest.capabilities.includes('downloads'));
      return;
    }
    const record = await repository.getArtifactBySlug(slug);
    if (!record || !record.isActive || record.summary.source !== 'uploaded' || !record.bundleLocation) return next();
    if (record.summary.datasetKeys.length === 0) await repository.canReadArtifact(response.locals.user, record.summary.id);
    const storageKey = safeStorageKey(record.bundleLocation, file);
    if (['.html', '.htm'].includes(extname(file).toLowerCase())) {
      const html = (await storage.get(storageKey)).toString('utf8');
      sendArtifactFile(response, file, Buffer.from(refreshHostShim(html)), record.summary.capabilities.includes('downloads'));
      return;
    }
    sendArtifactStream(response, file, await storage.stream(storageKey), record.summary.capabilities.includes('downloads'));
  }));

  const staticRoot = resolve(config.staticRoot);
  app.use(express.static(staticRoot, {
    index: false,
    maxAge: config.production ? '1h' : 0,
    setHeaders: (response, path) => {
      if (extname(path).toLowerCase() === '.html') {
        response.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      } else if (config.production && path.includes(`${sep}assets${sep}`)) {
        // Vite content-hashes everything under assets/, so these files are immutable.
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
  app.use((request, response, next) => {
    if (request.method !== 'GET') return next();
    response.sendFile(resolve(staticRoot, 'index.html'), { headers: { 'Cache-Control': 'private, no-cache, no-store, must-revalidate' } });
  });
  app.use(errorHandler);
  if (options.enableQlikScheduler) app.locals.stopQlikScheduler = startQlikScheduler(repository, qlik);
  if (options.enableUsageMaintenance && config.usageTelemetryMode !== 'off') {
    app.locals.stopUsageMaintenance = startUsageMaintenance(repository, config.usageEventRetentionDays);
  }
  app.locals.closeQlikSessions = () => qlik.close();
  return app;
}

function fieldsFrom(body: Record<string, unknown>) {
  const downloads = body.downloads === true || body.downloads === 'true' || body.downloads === 'on';
  return {
    title: String(body.title ?? ''),
    description: String(body.description ?? ''),
    kind: String(body.kind ?? ''),
    owner: String(body.owner ?? ''),
    dataDate: String(body.dataDate ?? ''),
    slug: String(body.slug ?? ''),
    preflightToken: String(body.preflightToken ?? ''),
    capabilities: downloads ? ['downloads'] : [],
    icon: String(body.icon ?? ''),
  };
}

function filesFrom(request: express.Request) {
  const uploaded = request.files as Record<string, Express.Multer.File[]> | undefined;
  const primary = uploaded?.file?.[0];
  const json = (uploaded?.json ?? []).map((file) => ({ name: file.originalname, bytes: file.buffer }));
  const isZip = primary && (primary.mimetype === 'application/zip' || primary.originalname.toLowerCase().endsWith('.zip'));
  return {
    html: primary && !isZip ? primary.buffer : undefined,
    zip: primary && isZip ? primary.buffer : undefined,
    json,
  };
}

function bundledFile(config: AppConfig, slug: string, file: string): string | undefined {
  const candidates = [
    resolve(config.staticRoot, 'artifacts', slug, file),
    resolve('public/artifacts', slug, file),
    resolve(config.artifactRoot, slug, file),
  ];
  return candidates.find((path) => existsSync(path));
}

function safeArtifactFile(value: string): string {
  const file = value.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!file || file.includes('..') || file.includes('/') || /[^a-zA-Z0-9._-]/.test(file)) {
    throw new AppError(400, 'INVALID_BUNDLE_PATH', 'The artifact file path is invalid.');
  }
  return file;
}

function setArtifactFileHeaders(response: express.Response, file: string, allowDownloads: boolean) {
  response.setHeader('Content-Type', contentTypeFor(file));
  response.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  if (extname(file).toLowerCase() === '.html' || extname(file).toLowerCase() === '.htm') {
    response.setHeader('Content-Security-Policy', artifactHtmlCsp(allowDownloads));
    response.setHeader('X-Content-Type-Options', 'nosniff');
  }
}

function sendArtifactFile(response: express.Response, file: string, bytes: Buffer, allowDownloads: boolean) {
  setArtifactFileHeaders(response, file, allowDownloads);
  response.send(bytes);
}

function sendArtifactStream(response: express.Response, file: string, stream: NodeJS.ReadableStream, allowDownloads: boolean) {
  setArtifactFileHeaders(response, file, allowDownloads);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
}
