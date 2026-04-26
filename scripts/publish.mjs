#!/usr/bin/env node

/**
 * publish.mjs - Copy built artifacts to the shared distribution folder.
 *
 * macOS: copies *.dmg files
 * Windows: copies *.exe files (the NSIS installer)
 *
 * Usage:
 *   node scripts/publish.mjs
 */

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { platform } from 'node:os';

const DESTINATIONS = {
    darwin: '/Users/deqiang.li/SyncShare/LogScope',
    win32: 'D:/SyncShare/LogScope'
};

const ROOT_DIR = resolve(import.meta.dirname, '..');
const BUNDLE_DIR = join(ROOT_DIR, 'src-tauri', 'target');

/**
 * Recursively find files matching given extensions under a directory.
 */
function findFiles(dir, extensions) {
    const results = [];
    if (!existsSync(dir)) return results;

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...findFiles(fullPath, extensions));
        } else if (extensions.some(ext => entry.name.endsWith(ext))) {
            results.push(fullPath);
        }
    }
    return results;
}

function main() {
    const os = platform();
    const dest = DESTINATIONS[os];
    if (!dest) {
        console.error(`Unsupported platform: ${os}`);
        process.exit(1);
    }

    // Determine which file extensions to look for
    const extensions = os === 'darwin' ? ['.dmg'] : ['.exe'];
    const label = os === 'darwin' ? 'DMG' : 'EXE';

    console.log(`Platform: ${os}`);
    console.log(`Looking for ${label} files in ${BUNDLE_DIR} ...`);

    // Only search inside release/bundle to avoid picking up random build artifacts
    const bundleSearchDir = join(BUNDLE_DIR);
    const files = findFiles(bundleSearchDir, extensions)
        .filter(f => f.includes('release') && f.includes('bundle'));

    if (files.length === 0) {
        console.error(`No ${label} files found. Did you run the build first?`);
        console.error(`  macOS:   yarn package:macos`);
        console.error(`  Windows: yarn package:windows`);
        process.exit(1);
    }

    // Ensure destination exists
    if (!existsSync(dest)) {
        mkdirSync(dest, { recursive: true });
        console.log(`Created destination directory: ${dest}`);
    }

    // Copy each artifact
    for (const src of files) {
        const filename = basename(src);
        const target = join(dest, filename);
        const sizeMB = (statSync(src).size / (1024 * 1024)).toFixed(1);
        console.log(`  ${filename} (${sizeMB} MB) -> ${dest}`);
        cpSync(src, target);
    }

    console.log(`\nDone! ${files.length} file(s) published to ${dest}`);
}

main();
