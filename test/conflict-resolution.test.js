import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createConflictResolver } from '../src/conflict-resolution.js';
import fse from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');


// Mock @actions/core to suppress log output during tests
vi.mock('@actions/core', () => ({
  info: vi.fn(),
}));


function createMockGit() {
  return {
    checkoutConflictedFile: vi.fn().mockResolvedValue(undefined),
    addFile: vi.fn().mockResolvedValue(undefined),
  };
}


async function setupTempRepo(configFixture = null) {
  const tmpDir = path.join(__dirname, '.tmp-test-' + Date.now());
  await fse.ensureDir(tmpDir);

  if (configFixture) {
    const configDir = path.join(tmpDir, '.github');
    await fse.ensureDir(configDir);
    await fse.copy(
      path.join(FIXTURES_DIR, configFixture),
      path.join(configDir, 'conflict-resolution.yml')
    );
  }

  return tmpDir;
}


async function cleanupTempRepo(tmpDir) {
  await fse.remove(tmpDir);
}


describe('conflict-resolution', () => {

  describe('config loading', () => {

    it('uses built-in defaults when no config file exists', async () => {
      const tmpDir = await setupTempRepo(null);
      const git = createMockGit();

      try {
        const resolver = await createConflictResolver(tmpDir, git);
        const result = await resolver.resolve('version.rb');

        expect(result).toBe(true);
        expect(git.checkoutConflictedFile).toHaveBeenCalledWith(tmpDir, 'version.rb', 'theirs');
      } finally {
        await cleanupTempRepo(tmpDir);
      }
    });

    it('throws error for invalid scope value', async () => {
      const tmpDir = await setupTempRepo('invalid-scope.yml');

      try {
        await expect(createConflictResolver(tmpDir, createMockGit()))
          .rejects.toThrow(/'scope' must be "file" or "lines"/);
      } finally {
        await cleanupTempRepo(tmpDir);
      }
    });

    it('throws error for invalid regex pattern', async () => {
      const tmpDir = await setupTempRepo('invalid-regex.yml');

      try {
        await expect(createConflictResolver(tmpDir, createMockGit()))
          .rejects.toThrow(/invalid regex/);
      } finally {
        await cleanupTempRepo(tmpDir);
      }
    });

  });


  describe('file-level resolution', () => {

    it('resolves file with "theirs" side', async () => {
      const tmpDir = await setupTempRepo('valid-config.yml');
      const git = createMockGit();

      try {
        const resolver = await createConflictResolver(tmpDir, git);
        const result = await resolver.resolve('db/schema.rb');

        expect(result).toBe(true);
        expect(git.checkoutConflictedFile).toHaveBeenCalledWith(tmpDir, 'db/schema.rb', 'theirs');
      } finally {
        await cleanupTempRepo(tmpDir);
      }
    });

    it('matches glob patterns and uses correct side', async () => {
      const tmpDir = await setupTempRepo('valid-config.yml');
      const git = createMockGit();

      try {
        const resolver = await createConflictResolver(tmpDir, git);
        const result = await resolver.resolve('db/migrate.rb');

        expect(result).toBe(true);
        expect(git.checkoutConflictedFile).toHaveBeenCalledWith(tmpDir, 'db/migrate.rb', 'ours');
      } finally {
        await cleanupTempRepo(tmpDir);
      }
    });

  });


  describe('line-level resolution', () => {

    it('resolves conflict when all lines match ignore patterns', async () => {
      const tmpDir = await setupTempRepo('valid-config.yml');
      const git = createMockGit();

      // Copy fixture to temp repo
      const conflictContent = await fse.readFile(
        path.join(FIXTURES_DIR, 'version-only.json'),
        'utf8'
      );
      await fse.writeFile(path.join(tmpDir, 'package.json'), conflictContent);

      try {
        const resolver = await createConflictResolver(tmpDir, git);
        const result = await resolver.resolve('package.json');

        expect(result).toBe(true);
        expect(git.addFile).toHaveBeenCalledWith(tmpDir, 'package.json');

        // Verify the resolved content
        const resolved = await fse.readFile(path.join(tmpDir, 'package.json'), 'utf8');
        expect(resolved).toContain('"version": "2.0.0"');
        expect(resolved).not.toContain('<<<<<<<');
        expect(resolved).not.toContain('>>>>>>>');
      } finally {
        await cleanupTempRepo(tmpDir);
      }
    });

    it('returns false when conflict contains non-ignorable changes', async () => {
      const tmpDir = await setupTempRepo('valid-config.yml');
      const git = createMockGit();

      // Copy fixture with non-ignorable changes
      const conflictContent = await fse.readFile(
        path.join(FIXTURES_DIR, 'version-and-other.json'),
        'utf8'
      );
      await fse.writeFile(path.join(tmpDir, 'package.json'), conflictContent);

      try {
        const resolver = await createConflictResolver(tmpDir, git);
        const result = await resolver.resolve('package.json');

        expect(result).toBe(false);
        expect(git.addFile).not.toHaveBeenCalled();
      } finally {
        await cleanupTempRepo(tmpDir);
      }
    });

  });


  describe('no matching rule', () => {

    it('returns false for files with no matching rule', async () => {
      const tmpDir = await setupTempRepo('valid-config.yml');
      const git = createMockGit();

      try {
        const resolver = await createConflictResolver(tmpDir, git);
        const result = await resolver.resolve('unknown.txt');

        expect(result).toBe(false);
        expect(git.checkoutConflictedFile).not.toHaveBeenCalled();
      } finally {
        await cleanupTempRepo(tmpDir);
      }
    });

  });

});
