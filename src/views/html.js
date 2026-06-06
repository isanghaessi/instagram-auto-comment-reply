const htmlEscapes = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => htmlEscapes[character]);
}

export function layout(title, body) {
  const safeTitle = escapeHtml(title);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f6f7fb; color: #172033; }
    header { background: #172033; color: white; padding: 1rem 1.5rem; }
    header h1 { margin: 0 0 0.75rem; font-size: 1.35rem; }
    nav { display: flex; gap: 1rem; flex-wrap: wrap; }
    nav a { color: white; text-decoration: none; font-weight: 600; }
    nav a:hover { text-decoration: underline; }
    nav form { margin: 0; }
    nav button { appearance: none; background: none; border: 0; color: white; cursor: pointer; font: inherit; font-weight: 600; padding: 0; }
    nav button:hover { text-decoration: underline; }
    main { max-width: 960px; margin: 2rem auto; padding: 0 1rem; }
    .card { background: white; border-radius: 0.75rem; box-shadow: 0 0.25rem 1rem rgb(23 32 51 / 10%); padding: 1.5rem; }
    .button { display: inline-block; background: #405de6; color: white; padding: 0.65rem 1rem; border-radius: 0.5rem; text-decoration: none; font-weight: 700; }
    .error { color: #b00020; font-weight: 700; }
    label { display: block; margin-bottom: 0.75rem; font-weight: 700; }
    input[type="password"] { display: block; width: min(100%, 24rem); margin-top: 0.35rem; padding: 0.55rem; font: inherit; }
    button { padding: 0.6rem 1rem; font: inherit; font-weight: 700; cursor: pointer; }
  </style>
</head>
<body>
  <header>
    <h1>${safeTitle}</h1>
    <nav aria-label="Admin navigation">
      <a href="/">Dashboard</a>
      <a href="/rules">Rules</a>
      <a href="/logs">Logs</a>
      <form method="post" action="/logout"><button type="submit">Logout</button></form>
    </nav>
  </header>
  <main>
${body}
  </main>
</body>
</html>`;
}
