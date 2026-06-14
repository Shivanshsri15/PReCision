const SKIP_DIR_SEGMENTS = [
  'node_modules',
  'vendor',
  'dist',
  'build',
  '.git',
  '__pycache__',
  '.venv',
  'venv',
  'target',
];

const LOCKFILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'poetry.lock',
  'Pipfile.lock',
  'composer.lock',
  'Gemfile.lock',
]);

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.zip',
  '.tar',
  '.gz',
  '.jar',
  '.class',
  '.exe',
  '.dll',
  '.so',
  '.bin',
]);

const MAX_FILE_BYTES = 500 * 1024;

export function shouldIndex(path: string, sizeBytes?: number): boolean {
  const normalized = path.replace(/\\/g, '/');
  const segments = normalized.split('/');

  if (segments.some((segment) => SKIP_DIR_SEGMENTS.includes(segment))) {
    return false;
  }

  const basename = segments[segments.length - 1] ?? path;
  if (LOCKFILES.has(basename)) {
    return false;
  }

  const dot = basename.lastIndexOf('.');
  if (dot !== -1) {
    const ext = basename.slice(dot).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      return false;
    }
  }

  if (sizeBytes !== undefined && sizeBytes > MAX_FILE_BYTES) {
    return false;
  }

  return true;
}
