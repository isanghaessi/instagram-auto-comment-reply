import express from 'express';
import cookieParser from 'cookie-parser';
import { createAuthRoutes } from './routes/authRoutes.js';
import { instagramAuthRoutes } from './routes/instagramAuthRoutes.js';
import { requireAdmin } from './security/auth.js';
import { layout, escapeHtml } from './views/html.js';

function dashboardHtml(poller) {
  const status = poller?.getStatus?.() ?? { running: false };
  const runningText = status.running ? 'Running' : 'Stopped';

  return layout('Dashboard', `    <section class="card">
      <h2>Dashboard</h2>
      <p>Polling status: <strong>${escapeHtml(runningText)}</strong></p>
      <p><a class="button" href="/auth/instagram/start">Connect Instagram</a></p>
    </section>`);
}

export function createServer({ config, db, instagramClient, poller }) {
  const app = express();

  app.locals.config = config;
  app.locals.db = db;
  app.locals.instagramClient = instagramClient;
  app.locals.poller = poller;

  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false }));
  app.use(createAuthRoutes(config));
  app.use(instagramAuthRoutes({ config, db, instagramClient }));

  app.get('/', requireAdmin(config), (req, res) => {
    res.type('html').send(dashboardHtml(poller));
  });

  return app;
}
