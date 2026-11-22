#!/usr/bin/env node
// ===========================================================================
// Ergalics Studio — sync the current branch to every configured remote.
//
//   npm run sync                    # commit pending changes, then push
//   npm run sync -- "commit message" # same, with a custom commit message
//
// Pushes to Gitee (`origin`) and GitHub (`github`); remotes that are not
// configured are skipped with a warning. Any failed push makes the script
// exit non-zero so CI or a chained command can catch it.
// ===========================================================================

import { execFileSync } from 'node:child_process';

/** Remotes to keep in sync, in push order. */
const REMOTES = ['origin', 'github'];

const args = process.argv.slice(2);
const message = args.join(' ').trim();

function git(argv) {
  return execFileSync('git', argv, { encoding: 'utf8' }).trim();
}

function gitInherit(argv) {
  execFileSync('git', argv, { stdio: 'inherit' });
}

function remoteExists(remote) {
  try {
    git(['remote', 'get-url', remote]);
    return true;
  } catch {
    return false;
  }
}

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch === 'HEAD') {
  console.error('当前处于分离 HEAD 状态，无法自动推送。');
  process.exit(1);
}

const dirty = git(['status', '--porcelain']).length > 0;
if (dirty) {
  // Local ISO-like stamp: YYYY-MM-DD HH:mm
  const stamp = new Date().toLocaleString('sv-SE').slice(0, 16);
  const msg = message || `chore: 同步更新 ${stamp}`;
  gitInherit(['add', '-A']);
  gitInherit(['commit', '-m', msg]);
  console.log(`已提交：${msg}`);
} else {
  console.log('工作区干净，直接推送。');
}

let failed = 0;
for (const remote of REMOTES) {
  if (!remoteExists(remote)) {
    console.warn(`跳过 ${remote}：未配置该远程。`);
    continue;
  }
  console.log(`→ 推送到 ${remote}（${branch}）`);
  try {
    gitInherit(['push', remote, branch]);
  } catch {
    failed += 1;
    console.error(`✗ ${remote} 推送失败。若远程有新提交，请先拉取合并后再运行。`);
  }
}

if (failed > 0) process.exit(1);
console.log('✓ 所有远程已同步。');
