import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) { console.error(result.error.message, '\nInstala uv desde https://docs.astral.sh/uv/ y vuelve a ejecutar npm run audio:setup.'); process.exit(1); }
  if (result.status !== 0) process.exit(result.status || 1);
}
run('uv', ['python', 'install', '3.11']);
run('uv', ['venv', '--python', '3.11', '--allow-existing', '.venv-audio']);
const python = path.join(root, '.venv-audio', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
run('uv', ['pip', 'install', '--python', python, '-r', 'scripts/audio/requirements-lock.txt']);
run(python, ['scripts/audio/prepare.py', '--check']);
console.log('Motor local listo. El modelo se descargará al preparar la primera canción.');
