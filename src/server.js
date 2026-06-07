import express from 'express';
import cookieParser from 'cookie-parser';
import { createAuthRoutes } from './routes/authRoutes.js';
import { dashboardRoutes } from './routes/dashboardRoutes.js';
import { ruleRoutes } from './routes/ruleRoutes.js';
import { logRoutes } from './routes/logRoutes.js';
import { createSessionStore } from './security/auth.js';
import { layout } from './views/html.js';

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
  app.use(dashboardRoutes({ config, db, instagramClient, poller, sessionStore }));
  app.use(ruleRoutes({ config, db, sessionStore }));
  app.use(logRoutes({ config, db, sessionStore }));

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    console.error('Unhandled request error', error);
    res.status(500).type('html').send(layout('일시적인 오류', `    <section class="card">
      <h2>일시적인 오류가 발생했습니다</h2>
      <p class="error">요청을 처리하는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.</p>
      <p><a href="/">Dashboard로 돌아가기</a></p>
    </section>`));
  });

  return app;
}
