import { mkdtemp, cp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';
import { pathToFileURL } from 'url';

async function runPrepareDigest(homeDir, preloadPath, scriptPath, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', pathToFileURL(preloadPath).href, scriptPath],
      {
        cwd,
        env: {
          ...process.env,
          HOME: homeDir,
          USERPROFILE: homeDir
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', code => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function main() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'follow-builders-fallback-'));
  const originalCwd = process.cwd();

  try {
    const copiedSkillDir = join(tempRoot, 'skill');
    const homeDir = join(tempRoot, 'home');
    const userSkillDir = join(homeDir, '.follow-builders');

    await cp(join(process.cwd(), '..'), copiedSkillDir, { recursive: true });
    await mkdir(userSkillDir, { recursive: true });

    const preloadPath = join(tempRoot, 'mock-fetch.mjs');
    const feedX = JSON.stringify(JSON.parse(await readFile(join(copiedSkillDir, 'feed-x.json'), 'utf-8')));
    const feedPodcasts = JSON.stringify(JSON.parse(await readFile(join(copiedSkillDir, 'feed-podcasts.json'), 'utf-8')));
    const feedBlogs = JSON.stringify(JSON.parse(await readFile(join(copiedSkillDir, 'feed-blogs.json'), 'utf-8')));

    await writeFile(
      preloadPath,
      `const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const value = String(url);
  if (value.endsWith('/feed-x.json')) {
    return new Response(${JSON.stringify(feedX)}, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (value.endsWith('/feed-podcasts.json')) {
    return new Response(${JSON.stringify(feedPodcasts)}, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (value.endsWith('/feed-blogs.json')) {
    return new Response(${JSON.stringify(feedBlogs)}, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (value.includes('/prompts/')) {
    const error = new TypeError('fetch failed');
    error.cause = { code: 'UND_ERR_CONNECT_TIMEOUT', message: 'mock timeout' };
    throw error;
  }
  return originalFetch(url, options);
};`
    );

    const result = await runPrepareDigest(
      homeDir,
      preloadPath,
      'prepare-digest.js',
      join(copiedSkillDir, 'scripts')
    );

    if (result.code !== 0) {
      throw new Error(`Expected success exit code, got ${result.code}: ${result.stderr}`);
    }

    const output = JSON.parse(result.stdout);

    if (output.status !== 'ok') {
      throw new Error(`Expected status ok, got ${output.status}`);
    }

    if (!output.prompts || !output.prompts.digest_intro || !output.prompts.translate) {
      throw new Error('Expected local prompt fallback to populate prompts');
    }

    console.log('PASS: remote prompt failures fall back to local prompts');
  } finally {
    process.chdir(originalCwd);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});
