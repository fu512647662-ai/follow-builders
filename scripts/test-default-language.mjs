import { mkdtemp, cp, rm, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';

async function runPrepareDigest(homeDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(process.cwd(), 'prepare-digest.js')],
      {
        cwd: process.cwd(),
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
      if (code !== 0) {
        reject(new Error(`prepare-digest exited with ${code}: ${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}

async function main() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'follow-builders-test-'));
  const homeDir = join(tempRoot, 'home');
  const userSkillDir = join(homeDir, '.follow-builders');
  const copiedSkillDir = join(tempRoot, 'skill');
  const originalCwd = process.cwd();

  try {
    await cp(join(process.cwd(), '..'), copiedSkillDir, { recursive: true });
    process.chdir(join(copiedSkillDir, 'scripts'));

    await mkdir(userSkillDir, { recursive: true });

    const output = await runPrepareDigest(homeDir);
    const digest = JSON.parse(output);

    if (digest.config.language !== 'zh') {
      throw new Error(`Expected default language zh, got ${digest.config.language}`);
    }

    console.log('PASS: default language is zh');
  } finally {
    process.chdir(originalCwd);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});
