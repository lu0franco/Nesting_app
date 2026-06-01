#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const helpers = [
  {
    label: 'sparrow',
    file: path.join(repoRoot, 'native', 'linux', 'bin', 'sparrow'),
  },
];

function fail(message) {
  console.error(`[linux-helpers] ${message}`);
  process.exit(1);
}

if (process.platform !== 'linux') {
  console.log('[linux-helpers] Skipping helper verification on non-Linux host');
  process.exit(0);
}

const summaries = helpers.map((helper) => {
  if (!fs.existsSync(helper.file)) {
    fail(`Missing required helper at ${path.relative(repoRoot, helper.file)}`);
  }

  try {
    fs.accessSync(helper.file, fs.constants.X_OK);
  } catch {
    fail(`${path.basename(helper.file)} is not marked executable`);
  }

  return `${helper.label}: ${path.relative(repoRoot, helper.file)}`;
});

console.log('[linux-helpers] Verified bundled Linux helpers:');
summaries.forEach(line => console.log(`  - ${line}`));
