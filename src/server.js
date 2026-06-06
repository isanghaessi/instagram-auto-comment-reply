import express from 'express';
import cookieParser from 'cookie-parser';
import { createAuthRoutes } from './routes/authRoutes.js';
import { instagramAuthRoutes } from './routes/instagramAuthRoutes.js';
import { dashboardRoutes } from './routes/dashboardRoutes.js';
import { ruleRoutes } from './routes/ruleRoutes.js';
import { createSessionStore } from './security/auth.js';

export function createServer({ config, db, instagramClient, poller }) {
  const app = express();

  app.locals.config = config;
  app.locals.db = db;
  app.locals.instagramClient = instagramClient;
  const sessionStore = createSessionStore();

  app.locals.poller = poller;
  app.locals.sessionStore = sessionStore;

  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false }));
  app.use(createAuthRoutes(config, sessionStore));
  app.use(instagramAuthRoutes({ config, db, instagramClient, sessionStore }));
  app.use(dashboardRoutes({ config, db, instagramClient, poller, sessionStore }));
  app.use(ruleRoutes({ config, db, sessionStore }));

  return app;
}
