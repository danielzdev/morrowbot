import { createServer } from 'node:http';

const PAGES: Readonly<Record<string, string>> = {
  form: `<title>Sign in</title>
<h1>Sign in</h1>
<form id="login" onsubmit="event.preventDefault(); document.getElementById('log').textContent = 'submitted ' + new FormData(this).get('email') + ' remember=' + this.remember.checked + ' plan=' + this.plan.value + ' password-length=' + this.password.value.length;">
  <label>Email <input name="email" type="email"></label>
  <label>Password <input name="password" type="password"></label>
  <label><input name="remember" type="checkbox"> Remember me</label>
  <label>Plan <select name="plan"><option value="free">Free</option><option value="pro">Pro</option></select></label>
  <label>Avatar <input name="avatar" type="file" onchange="document.getElementById('log').textContent = 'file ' + this.files[0].name"></label>
  <button type="submit">Continue</button>
</form>
<p id="log" role="status"></p>`,
  dialog: `<title>Dialogs</title>
<button onclick="document.getElementById('log').textContent = 'confirmed=' + confirm('Delete everything?')">Delete</button>
<p id="log" role="status"></p>`,
  code: `<title>Verify</title>
<label>Email <input name="email" type="email"></label>
<label>Code <input name="code" type="text"></label>`,
  pointer: `<title>Pointer</title>
<style>.box { width: 120px; height: 60px; margin: 20px; border: 1px solid; }</style>
<div id="hover" class="box" role="button" aria-label="Hover me" onmouseenter="document.getElementById('log').textContent = 'hovered'"></div>
<div id="card" class="box" draggable="true" role="button" aria-label="Card" ondragstart="event.dataTransfer.setData('text/plain', 'card')"></div>
<div id="bin" class="box" role="region" aria-label="Bin" ondragover="event.preventDefault()" ondrop="event.preventDefault(); document.getElementById('log').textContent = 'dropped ' + event.dataTransfer.getData('text/plain')"></div>
<p id="log" role="status"></p>
<div style="height: 3000px"></div>
<button id="bottom">Bottom</button>
<div id="far" class="box" role="region" aria-label="Far bin" ondragover="event.preventDefault()" ondrop="event.preventDefault(); document.getElementById('log').textContent = 'dropped far ' + event.dataTransfer.getData('text/plain')"></div>`,
  leave: `<title>Draft</title>
<script>onbeforeunload = (event) => { event.preventDefault(); };</script>
<button onclick="this.textContent = 'Edited'">Edit</button>`,
};

/** Serves the test pages on 127.0.0.1. */
export async function servePages(): Promise<{ readonly url: (page: string) => string; readonly port: number; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    const name = (request.url ?? '/').slice(1);
    const page = PAGES[name];
    if (page === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html>${page}`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = address !== null && typeof address === 'object' ? address.port : 0;
  return {
    port,
    url: (page) => `http://127.0.0.1:${String(port)}/${page}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
