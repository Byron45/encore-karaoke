import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) { console.error(result.error.message, '\nInstala uv desde https://docs.astral.sh/uv/ y vuelve a ejecutar npm run audio:setup.'); process.exit(1); }
  if (result.status !== 0) process.exit(result.status || 1);
}
// With an NVIDIA GPU the engine runs separation, the melody map and speech recognition on it (about five times faster);
// --cpu installs the processor-only engine anyway.
const gpu = !process.argv.includes('--cpu') && spawnSync('nvidia-smi', ['-L'], { windowsHide: true }).status === 0;
const lock = gpu ? 'scripts/audio/requirements-gpu-lock.txt' : 'scripts/audio/requirements-lock.txt';
const index = gpu ? ['--extra-index-url', 'https://download.pytorch.org/whl/cu130', '--index-strategy', 'unsafe-best-match'] : [];
run('uv', ['python', 'install', '3.11']);
run('uv', ['venv', '--python', '3.11', '--allow-existing', '.venv-audio']);
const python = path.join(root, '.venv-audio', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
// sync, not install: the environment ends up exactly as the lock, so switching between the CPU and GPU engines leaves nothing behind.
run('uv', ['pip', 'sync', '--python', python, ...index, lock]);
// onnxruntime and onnxruntime-gpu install the same module; reinstalling the one in use repairs files a switch may have removed.
const runtime = gpu ? 'onnxruntime-gpu' : 'onnxruntime';
run('uv', ['pip', 'install', '--python', python, '--reinstall-package', runtime, `${runtime}==1.30.0`]);
run(python, ['scripts/audio/prepare.py', '--check']);
run(python, ['scripts/audio/words.py', '--check']);
run(python, ['scripts/audio/embed.py', '--check']);
console.log(`Motor local listo${gpu ? ' con la gráfica NVIDIA' : ' para el procesador'}. Los modelos se descargan al usarlos por primera vez.`);
