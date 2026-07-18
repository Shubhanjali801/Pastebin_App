import { Router } from "express";
import { config } from "../config";

export const homeRouter = Router();

// Portfolio-quality landing page for the Pastebin service. Self-contained (inline
// CSS/JS, no external requests), responsive, and light/dark aware. Server injects the
// public base URL by replacing the __BASE_URL__ token below.
const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="A production-style Pastebin demonstrating the metadata/blob split: metadata in Postgres, content in S3, hot reads cached in Redis. Built by Shubhanjali." />
  <title>Pastebin — by Shubhanjali</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📋</text></svg>" />
  <script>
    // Apply the saved theme before paint to avoid a flash of the wrong colors.
    (function () {
      try {
        var t = localStorage.getItem('pb-theme');
        if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
      } catch (e) {}
    })();
  </script>
  <style>
    :root {
      --bg: #f6f7fb;
      --surface: #ffffff;
      --surface-2: #f0f2f7;
      --border: #e4e7ef;
      --text: #1a1d26;
      --muted: #646b7d;
      --accent: #6366f1;
      --accent-600: #4f46e5;
      --accent-soft: rgba(99,102,241,.12);
      --ok: #12a150;
      --ok-soft: rgba(18,161,80,.12);
      --danger: #d9483b;
      --danger-soft: rgba(217,72,59,.12);
      --shadow: 0 1px 2px rgba(16,20,40,.04), 0 8px 24px rgba(16,20,40,.06);
      --radius: 14px;
      --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    }
    /* Dark values: applied when the user explicitly picks dark... */
    :root[data-theme="dark"] {
      --bg: #0b0d13;
      --surface: #14171f;
      --surface-2: #1b1f2a;
      --border: #262b38;
      --text: #e8eaf0;
      --muted: #9aa2b4;
      --accent: #818cf8;
      --accent-600: #6366f1;
      --accent-soft: rgba(129,140,248,.14);
      --shadow: 0 1px 2px rgba(0,0,0,.3), 0 12px 32px rgba(0,0,0,.35);
    }
    /* ...or when the OS is dark AND the user hasn't chosen a theme. */
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme]) {
        --bg: #0b0d13;
        --surface: #14171f;
        --surface-2: #1b1f2a;
        --border: #262b38;
        --text: #e8eaf0;
        --muted: #9aa2b4;
        --accent: #818cf8;
        --accent-600: #6366f1;
        --accent-soft: rgba(129,140,248,.14);
        --shadow: 0 1px 2px rgba(0,0,0,.3), 0 12px 32px rgba(0,0,0,.35);
      }
    }
    * { box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: var(--text);
      background:
        radial-gradient(1100px 500px at 15% -10%, var(--accent-soft), transparent 60%),
        radial-gradient(900px 480px at 100% 0%, rgba(139,92,246,.10), transparent 55%),
        var(--bg);
      line-height: 1.6;
      min-height: 100vh;
    }
    a { color: var(--accent-600); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .wrap { max-width: 940px; margin: 0 auto; padding: 0 20px; }

    /* header */
    header.site {
      display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
      padding: 20px 0; gap: 16px;
    }
    header.site .brand { justify-self: start; }
    header.site nav { justify-self: center; }
    header.site .header-right { justify-self: end; }
    .theme-toggle {
      appearance: none; cursor: pointer; width: 38px; height: 38px; border-radius: 9px;
      border: 1px solid var(--border); background: var(--surface); color: var(--text);
      font-size: 16px; line-height: 1; display: grid; place-items: center;
      transition: background .15s, border-color .15s, transform .08s;
    }
    .theme-toggle:hover { border-color: var(--accent); }
    .theme-toggle:active { transform: translateY(1px); }
    @media (max-width: 520px) {
      header.site { grid-template-columns: 1fr auto; }
      header.site nav { display: none; }
    }
    .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 1.05rem; letter-spacing: -.01em; }
    .brand .logo {
      width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center;
      background: linear-gradient(135deg, var(--accent), #a855f7); color: #fff; font-size: 18px;
      box-shadow: 0 4px 12px rgba(99,102,241,.35);
    }
    header.site nav { display: flex; gap: 20px; align-items: center; font-size: .92rem; }
    header.site nav a { color: var(--muted); font-weight: 500; }
    header.site nav a:hover { color: var(--text); text-decoration: none; }

    /* hero */
    .hero { padding: 26px 0 10px; }
    .badge {
      display: inline-flex; align-items: center; gap: 8px;
      font-size: .78rem; font-weight: 600; letter-spacing: .02em;
      color: var(--accent-600); background: var(--accent-soft);
      padding: 6px 12px; border-radius: 999px; margin-bottom: 18px;
    }
    .badge .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px var(--ok-soft); }
    .hero h1 {
      font-size: clamp(2rem, 5vw, 2.9rem); line-height: 1.1; letter-spacing: -.03em;
      margin: 0 0 12px;
    }
    .hero h1 .grad {
      background: linear-gradient(120deg, var(--accent), #a855f7 60%, #ec4899);
      -webkit-background-clip: text; background-clip: text; color: transparent;
    }
    .hero .lede { font-size: 1.08rem; color: var(--muted); max-width: 640px; margin: 0 0 20px; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
    .chip {
      font-size: .78rem; font-weight: 500; color: var(--muted);
      background: var(--surface); border: 1px solid var(--border);
      padding: 4px 11px; border-radius: 999px;
    }

    /* card */
    .card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius); box-shadow: var(--shadow);
      padding: 26px; margin: 22px 0;
    }
    .card h2 { margin: 0 0 4px; font-size: 1.15rem; letter-spacing: -.01em; }
    .card .card-sub { margin: 0 0 18px; color: var(--muted); font-size: .92rem; }

    /* form */
    form { display: flex; flex-direction: column; gap: 16px; }
    label { display: block; font-weight: 600; font-size: .9rem; margin-bottom: 7px; }
    label .hint { font-weight: 400; color: var(--muted); font-size: .82rem; }
    .field-head { display: flex; justify-content: space-between; align-items: baseline; }
    #counter { font-size: .8rem; color: var(--muted); font-variant-numeric: tabular-nums; }
    #counter.over { color: var(--danger); font-weight: 600; }
    textarea, input, select {
      width: 100%; font-family: inherit; font-size: .95rem; color: var(--text);
      background: var(--surface-2); border: 1px solid var(--border);
      border-radius: 10px; padding: 11px 13px; transition: border-color .15s, box-shadow .15s;
    }
    textarea {
      min-height: 150px; resize: vertical; font-family: var(--mono); font-size: .9rem; line-height: 1.55;
    }
    textarea:focus, input:focus, select:focus {
      outline: none; border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft); background: var(--surface);
    }
    .row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    @media (max-width: 560px) { .row { grid-template-columns: 1fr; } }
    .actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    button.primary {
      appearance: none; border: 0; cursor: pointer; font-weight: 600; font-size: .98rem; color: #fff;
      background: linear-gradient(135deg, var(--accent), var(--accent-600));
      padding: 12px 24px; border-radius: 10px; box-shadow: 0 6px 16px rgba(99,102,241,.3);
      transition: transform .08s, box-shadow .15s, opacity .15s;
    }
    button.primary:hover { box-shadow: 0 8px 22px rgba(99,102,241,.42); }
    button.primary:active { transform: translateY(1px); }
    button.primary:disabled { opacity: .65; cursor: default; box-shadow: none; }
    .kbd { color: var(--muted); font-size: .82rem; }
    .kbd b { font-family: var(--mono); background: var(--surface-2); border: 1px solid var(--border); border-radius: 5px; padding: 1px 6px; font-weight: 500; }

    /* result / alert */
    .out { display: none; margin-top: 18px; border-radius: 12px; padding: 16px 18px; border: 1px solid var(--border); }
    .out.show { display: block; }
    .out.info { background: var(--surface-2); color: var(--muted); }
    .out.error { background: var(--danger-soft); border-color: transparent; color: var(--danger); font-weight: 500; }
    .out.success { background: var(--ok-soft); border-color: transparent; }
    .result-row { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
    .result-label { font-weight: 700; color: var(--ok); font-size: .9rem; }
    .result-exp { color: var(--muted); font-size: .82rem; }
    .result-url { font-family: var(--mono); font-size: .95rem; word-break: break-all; margin-bottom: 12px; }
    .result-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn-sm {
      font-size: .84rem; font-weight: 600; padding: 7px 14px; border-radius: 8px; cursor: pointer;
      border: 1px solid var(--accent); background: var(--accent); color: #fff; transition: opacity .15s;
    }
    .btn-sm:hover { opacity: .9; text-decoration: none; }
    .btn-sm.ghost { background: transparent; color: var(--accent-600); }

    /* features */
    .features { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin: 22px 0; }
    @media (max-width: 640px) { .features { grid-template-columns: 1fr; } }
    .feature { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; box-shadow: var(--shadow); }
    .feature .ico { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; font-size: 20px; background: var(--accent-soft); margin-bottom: 12px; }
    .feature h3 { margin: 0 0 5px; font-size: 1rem; }
    .feature p { margin: 0; color: var(--muted); font-size: .9rem; }
    .feature code { font-family: var(--mono); font-size: .84em; background: var(--surface-2); padding: 1px 5px; border-radius: 4px; }

    /* api */
    .api table { width: 100%; border-collapse: collapse; font-size: .9rem; }
    .api th, .api td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--border); }
    .api th { color: var(--muted); font-weight: 600; font-size: .8rem; text-transform: uppercase; letter-spacing: .03em; }
    .api td .m { font-family: var(--mono); font-weight: 700; font-size: .8rem; color: var(--accent-600); }
    .api td code { font-family: var(--mono); font-size: .86em; }
    pre.curl {
      margin: 16px 0 0; background: var(--surface-2); border: 1px solid var(--border);
      border-radius: 10px; padding: 14px 16px; overflow-x: auto; font-family: var(--mono);
      font-size: .82rem; line-height: 1.6; color: var(--text);
    }
    .architecture { margin-top: 4px; color: var(--muted); font-size: .9rem; }

    footer { padding: 30px 0 44px; color: var(--muted); font-size: .86rem; border-top: 1px solid var(--border); margin-top: 26px; }
    footer .fr { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="site">
      <div class="brand"><span class="logo">📋</span> Pastebin</div>
      <nav>
        <a href="#create">Create</a>
        <a href="#how">How it works</a>
        <a href="#api">API</a>
      </nav>
      <div class="header-right">
        <button type="button" id="themeToggle" class="theme-toggle" aria-label="Toggle light or dark theme" title="Toggle theme">🌙</button>
      </div>
    </header>

    <section class="hero">
      <h1>Share text &amp; code with a <span class="grad">short link</span>.</h1>
      <p class="lede">
        A production-style pastebin built to demonstrate the <strong>metadata / blob split</strong>:
        small metadata lives in Postgres, large content lives in Amazon S3, and hot reads are
        cached in Redis. Paste something below to try it.
      </p>
      <div class="chips">
        <span class="chip">TypeScript</span>
        <span class="chip">Node · Express</span>
        <span class="chip">PostgreSQL</span>
        <span class="chip">Redis</span>
        <span class="chip">Amazon S3</span>
        <span class="chip">Docker</span>
        <span class="chip">AWS EC2</span>
      </div>
    </section>

    <section id="create" class="card">
      <h2>Create a paste</h2>
      <p class="card-sub">Content up to 10&nbsp;MB. Choose an expiry and visibility; add a custom alias if you like.</p>
      <form id="f">
        <div>
          <div class="field-head">
            <label for="content">Content</label>
            <span id="counter">0 B / 10 MB</span>
          </div>
          <textarea id="content" placeholder="Paste your code, logs, or notes here…" required></textarea>
        </div>
        <div class="row">
          <div>
            <label for="language">Language <span class="hint">optional</span></label>
            <input id="language" type="text" placeholder="python" pattern="[A-Za-z0-9+#._-]{1,32}" />
          </div>
          <div>
            <label for="expiry">Expiry</label>
            <select id="expiry">
              <option value="never">Never</option>
              <option value="10m">10 minutes</option>
              <option value="1h">1 hour</option>
              <option value="1d" selected>1 day</option>
              <option value="1w">1 week</option>
              <option value="burn">Burn after read</option>
            </select>
          </div>
          <div>
            <label for="visibility">Visibility</label>
            <select id="visibility">
              <option value="unlisted" selected>Unlisted</option>
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
          </div>
        </div>
        <div>
          <label for="alias">Custom alias <span class="hint">optional · 3–32 chars of letters, numbers, - or _</span></label>
          <input id="alias" type="text" placeholder="my-snippet" pattern="[A-Za-z0-9_-]{3,32}" />
        </div>
        <div class="actions">
          <button type="submit" id="submit" class="primary">Create paste</button>
          <span class="kbd">or press <b>Ctrl</b> + <b>Enter</b></span>
        </div>
      </form>
      <div id="out" class="out" role="status" aria-live="polite"></div>
    </section>

    <section id="how">
      <div class="features">
        <div class="feature">
          <div class="ico">🗄️</div>
          <h3>Metadata / blob split</h3>
          <p>Postgres stores only a pointer &amp; metadata; the text itself goes to S3 (gzipped). The core lesson of the design.</p>
        </div>
        <div class="feature">
          <div class="ico">⚡</div>
          <h3>Redis on the hot path</h3>
          <p>Metadata and small blobs are cached, and view counts are buffered in Redis then flushed to the DB — no write per read.</p>
        </div>
        <div class="feature">
          <div class="ico">⏳</div>
          <h3>Expiry &amp; burn-after-read</h3>
          <p>Pastes can auto-expire (<code>10m</code>–<code>1w</code>) or self-destruct on first read. A worker sweeps expired blobs.</p>
        </div>
        <div class="feature">
          <div class="ico">🛡️</div>
          <h3>Limits &amp; abuse control</h3>
          <p>A 10&nbsp;MB size cap (<code>413</code>), IP rate limiting (<code>429</code>), and server-side visibility checks.</p>
        </div>
      </div>
    </section>

    <section id="api" class="card api">
      <h2>API</h2>
      <p class="card-sub">A small REST surface — the web form above just calls it.</p>
      <table>
        <thead><tr><th>Method</th><th>Path</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td><span class="m">POST</span></td><td><code>/api/v1/pastes</code></td><td>Create a paste → <code>201 { key, url, expires_at }</code></td></tr>
          <tr><td><span class="m">GET</span></td><td><code>/api/v1/pastes/{key}</code></td><td>Read as JSON (with content)</td></tr>
          <tr><td><span class="m">GET</span></td><td><code>/{key}</code></td><td>Rendered HTML view</td></tr>
          <tr><td><span class="m">GET</span></td><td><code>/{key}/raw</code></td><td>Raw <code>text/plain</code> (for curl)</td></tr>
          <tr><td><span class="m">GET</span></td><td><code>/health</code></td><td>Health check</td></tr>
        </tbody>
      </table>
      <pre class="curl">curl -X POST __BASE_URL__/api/v1/pastes \\
  -H 'content-type: application/json' \\
  -d '{"content":"hello world","language":"text","expiry":"1d"}'</pre>
    </section>

    <footer>
      <div class="fr">
        <span>Built by <strong>Shubhanjali</strong> — a system-design study project (Pastebin).</span>
        <span>Node · TypeScript · Postgres · Redis · S3 · Docker · AWS</span>
      </div>
    </footer>
  </div>

  <script>
    (function () {
      var f = document.getElementById('f');
      var out = document.getElementById('out');
      var contentEl = document.getElementById('content');
      var counter = document.getElementById('counter');
      var submitBtn = document.getElementById('submit');
      var MAX = 10485760;

      // Theme toggle: flips light/dark, remembers the choice, and updates the icon.
      var themeToggle = document.getElementById('themeToggle');
      function currentTheme() {
        var explicit = document.documentElement.getAttribute('data-theme');
        if (explicit) return explicit;
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      function syncThemeIcon() { themeToggle.textContent = currentTheme() === 'dark' ? '☀️' : '🌙'; }
      syncThemeIcon();
      themeToggle.addEventListener('click', function () {
        var next = currentTheme() === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('pb-theme', next); } catch (e) {}
        syncThemeIcon();
      });

      function fmtBytes(n) {
        if (n < 1024) return n + ' B';
        if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1048576).toFixed(2) + ' MB';
      }
      function updateCounter() {
        var n = new Blob([contentEl.value]).size;
        counter.textContent = fmtBytes(n) + ' / 10 MB';
        counter.classList.toggle('over', n > MAX);
      }
      contentEl.addEventListener('input', updateCounter);
      updateCounter();

      contentEl.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') f.requestSubmit();
      });

      f.addEventListener('submit', async function (e) {
        e.preventDefault();
        submitBtn.disabled = true;
        var label = submitBtn.textContent;
        submitBtn.textContent = 'Creating…';
        out.className = 'out show info';
        out.textContent = 'Creating your paste…';

        var body = {
          content: contentEl.value,
          expiry: document.getElementById('expiry').value,
          visibility: document.getElementById('visibility').value
        };
        var language = document.getElementById('language').value.trim();
        if (language) body.language = language;
        var alias = document.getElementById('alias').value.trim();
        if (alias) body.custom_alias = alias;

        try {
          var res = await fetch('/api/v1/pastes', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
          });
          var data = await res.json();
          if (res.ok) {
            var exp = data.expires_at
              ? 'expires ' + new Date(data.expires_at).toLocaleString()
              : 'never expires';
            out.className = 'out show success';
            out.innerHTML =
              '<div class="result-row">' +
                '<span class="result-label">✓ Your paste is live</span>' +
                '<span class="result-exp">' + exp + '</span>' +
              '</div>' +
              '<div class="result-url"><a id="pasteLink" href="' + data.url + '" target="_blank" rel="noopener">' + data.url + '</a></div>' +
              '<div class="result-actions">' +
                '<button type="button" id="copyBtn" class="btn-sm">Copy link</button>' +
                '<a class="btn-sm ghost" href="' + data.url + '" target="_blank" rel="noopener">Open</a>' +
                '<a class="btn-sm ghost" href="' + data.url + '/raw" target="_blank" rel="noopener">Raw</a>' +
              '</div>';
            var copyBtn = document.getElementById('copyBtn');
            copyBtn.addEventListener('click', function () {
              navigator.clipboard.writeText(data.url).then(function () {
                copyBtn.textContent = 'Copied ✓';
                setTimeout(function () { copyBtn.textContent = 'Copy link'; }, 1500);
              });
            });
          } else {
            var msg = 'Error ' + res.status + ': ' + (data.error || 'request failed');
            if (Array.isArray(data.details) && data.details.length) msg += ' — ' + data.details.join('; ');
            out.className = 'out show error';
            out.textContent = msg;
          }
        } catch (err) {
          out.className = 'out show error';
          out.textContent = 'Request failed: ' + err;
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = label;
        }
      });
    })();
  </script>
</body>
</html>`;

homeRouter.get("/", (_req, res) => {
  res.type("html").send(PAGE.split("__BASE_URL__").join(config.baseUrl.replace(/\/$/, "")));
});
