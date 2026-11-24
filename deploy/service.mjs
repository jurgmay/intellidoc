// Installs, removes and controls IntelliDoc's two Windows services: the API (which also serves the web app) and the folder watcher.
//   node service.mjs print       show what would be installed (works anywhere, changes nothing)
//   node service.mjs install     install both and start them        (run in an Administrator terminal)
//   node service.mjs uninstall | start | stop | restart
// Optional: add `api` or `watcher` at the end to act on one service only.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Each service runs `node --import tsx --env-file=.env <script>` in its own folder, so the .env files there are the configuration. */
export function definitions(base = root) {
  const common = { nodeOptions: ['--import=tsx', '--env-file=.env'], wait: 5, grow: 0.25, maxRestarts: 25, stopparentfirst: true, stoptimeout: 30 };
  return [
    { key: 'api', ...common, name: 'IntelliDocApi', description: 'IntelliDoc web app and API (serves the web app from web/dist on API_PORT)', dir: join(base, 'api'), script: join(base, 'api', 'src', 'server.ts'),
      needs: [join(base, 'api', '.env'), join(base, 'web', 'dist', 'index.html')] },
    { key: 'watcher', ...common, name: 'IntelliDocWatcher', description: 'IntelliDoc folder watcher: imports XML and PDF files, makes print files and records Activity', dir: join(base, 'ingest'), script: join(base, 'ingest', 'src', 'watch.ts'),
      needs: [join(base, 'ingest', '.env')] },
  ];
}

function preflight(defs) {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const problems = [];
  if (major < 20 || (major === 20 && minor < 6)) problems.push(`Node ${process.versions.node} is too old: 20.6 or newer is needed (for --env-file).`);
  for (const d of defs) {
    if (!existsSync(join(d.dir, 'node_modules', 'tsx'))) problems.push(`${d.dir}: run "npm install" there first.`);
    for (const f of d.needs) if (!existsSync(f)) problems.push(`Missing ${f}${f.endsWith('index.html') ? ' (run "npm run build" in the web folder)' : ' (copy .env.example to .env and fill it in)'}`);
  }
  return problems;
}

const [, , command, only] = process.argv;
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const defs = definitions().filter((d) => !only || d.key === only);
  if (!['print', 'install', 'uninstall', 'start', 'stop', 'restart'].includes(command ?? '') || (only && defs.length === 0)) {
    console.error('Usage: node service.mjs print|install|uninstall|start|stop|restart [api|watcher]'); process.exit(2);
  }
  if (command === 'print') { for (const d of defs) console.log(JSON.stringify({ ...d, needs: undefined }, null, 2)); process.exit(0); }
  if (process.platform !== 'win32') { console.error('Windows services can only be managed on Windows. Use "print" to see what would be installed.'); process.exit(2); }
  if (command === 'install') { const problems = preflight(defs); if (problems.length) { console.error(`Not installed:\n- ${problems.join('\n- ')}`); process.exit(1); } }

  const nw = (await import('node-windows')).default;
  const wait = (svc, ...events) => new Promise((resolve) => { for (const e of events) svc.on(e, (...a) => resolve({ event: e, args: a })); });
  for (const d of defs) {
    const svc = new nw.Service({ name: d.name, description: d.description, script: d.script, nodeOptions: d.nodeOptions, workingdirectory: d.dir, wait: d.wait, grow: d.grow, maxRestarts: d.maxRestarts, stopparentfirst: d.stopparentfirst, stoptimeout: d.stoptimeout });
    svc.directory(join(root, 'deploy', 'services')); // the service wrapper files and the logs (services\daemon) go here, not beside the program's code
    svc.on('error', (e) => console.error(`${d.name}: ${e}`));
    if (command === 'install') {
      const done = wait(svc, 'install', 'alreadyinstalled', 'invalidinstallation');
      svc.install();
      const r = await Promise.race([done, new Promise((res) => setTimeout(() => res({ event: 'timeout' }), 90_000))]);
      if (r.event === 'install') {
        // If the program ever stops (for instance the database was not up yet at boot), Windows starts it again after a minute.
        try { execFileSync('sc.exe', ['failure', svc.id ?? d.name.toLowerCase(), 'reset=', '86400', 'actions=', 'restart/60000/restart/60000/restart/60000'], { stdio: 'ignore' }); } catch { console.warn(`${d.name}: could not set the restart-on-failure recovery; set it in Services > ${d.name} > Recovery.`); }
        svc.start(); console.log(`${d.name} installed and started.`);
      } else console.log(`${d.name}: ${r.event === 'alreadyinstalled' ? 'already installed (use uninstall first to change it)' : r.event === 'timeout' ? 'no answer from Windows after 90 seconds. Is this an Administrator terminal? Check Get-Service *intellidoc* before trying again.' : r.event}`);
    } else if (!svc.exists && command !== 'uninstall') {
      console.error(`${d.name} is not installed. Run "npm run install-services" first.`);
    } else if (command === 'uninstall') {
      svc.uninstall(); await wait(svc, 'uninstall', 'alreadyuninstalled'); console.log(`${d.name} removed.`);
    } else if (command === 'start') { svc.start(); console.log(`${d.name}: start requested.`); }
    else if (command === 'stop') { svc.stop(); await wait(svc, 'stop', 'alreadystopped'); console.log(`${d.name} stopped.`); }
    else if (command === 'restart') { svc.stop(); await wait(svc, 'stop', 'alreadystopped'); svc.start(); console.log(`${d.name}: restarted.`); }
  }
  setTimeout(() => process.exit(0), 1500);
}
