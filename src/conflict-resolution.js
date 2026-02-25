import * as core from '@actions/core';
import fse from 'fs-extra';
import yaml from 'js-yaml';
import { minimatch } from 'minimatch';
import path from 'path';


const CONFIG_PATH = '.github/conflict-resolution.yml';

const BUILT_IN_RULES = [
  { pattern: 'version.rb', scope: 'file', side: 'theirs', ignore: null },
  { pattern: 'db/schema.rb', scope: 'file', side: 'theirs', ignore: null },
  { pattern: 'package.json', scope: 'lines', side: 'theirs', ignore: [/"version"\s*:/] },
];


// --- Public API ---

export async function createConflictResolver(repoDir, git) {
  const rules = await loadConfig(repoDir);

  return {
    async resolve(filePath) {
      const rule = findMatchingRule(rules, filePath);

      if (!rule) {
        core.info(`       ${filePath}: no conflict resolution rule matched`);
        return false;
      }

      if (rule.scope === 'file') {
        core.info(`       resolve with '${rule.side}' ${filePath}`);
        await git.checkoutConflictedFile(repoDir, filePath, rule.side);
        return true;
      }

      // scope === 'lines'
      return await resolveLineLevel(repoDir, filePath, rule, git);
    }
  };
}


// --- Config loading ---

async function loadConfig(repoDir) {
  const configFile = path.join(repoDir, CONFIG_PATH);

  if (!await fse.pathExists(configFile)) {
    core.info('No conflict-resolution config found, using built-in defaults');
    return BUILT_IN_RULES;
  }

  core.info(`Loading conflict resolution config from ${CONFIG_PATH}`);
  const content = await fse.readFile(configFile, 'utf8');
  const config = yaml.load(content);

  if (!config || typeof config !== 'object') {
    throw new Error(`${CONFIG_PATH} must contain a YAML mapping of pattern rules`);
  }

  const rules = [];
  for (const [pattern, rule] of Object.entries(config)) {
    if (!rule || typeof rule !== 'object') {
      throw new Error(`Rule '${pattern}': must be a YAML mapping with at least a 'scope' key`);
    }
    rules.push(validateRule(pattern, rule));
  }

  if (rules.length === 0) {
    throw new Error(`${CONFIG_PATH} must contain at least one rule`);
  }

  return rules;
}


// --- Line-level resolution ---

async function resolveLineLevel(repoDir, filePath, rule, git) {
  const fullPath = path.join(repoDir, filePath);
  const content = await fse.readFile(fullPath, 'utf8');
  const lines = content.split('\n');

  const hunks = parseConflictHunks(lines);
  if (hunks.length === 0) {
    core.info(`       ${filePath}: no valid conflict markers found`);
    return false;
  }

  for (const hunk of hunks) {
    if (!isHunkIgnorable(hunk, rule.ignore)) {
      core.info(`       ${filePath}: conflict contains non-ignorable changes`);
      return false;
    }
  }

  core.info(`       resolved ${hunks.length} conflict hunk(s) with '${rule.side}' in ${filePath}`);
  const resolved = buildResolvedContent(lines, hunks, rule.side);
  await fse.writeFile(fullPath, resolved, 'utf8');
  await git.addFile(repoDir, filePath);
  return true;
}


// --- Implementation details ---

function validateRule(pattern, rule) {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new Error(`Invalid pattern: must be a non-empty string, got '${pattern}'`);
  }

  const scope = rule.scope;
  if (scope !== 'file' && scope !== 'lines') {
    throw new Error(`Rule '${pattern}': 'scope' must be "file" or "lines", got "${scope}"`);
  }

  const side = rule.side || 'theirs';
  if (side !== 'theirs' && side !== 'ours') {
    throw new Error(`Rule '${pattern}': 'side' must be "theirs" or "ours", got "${side}"`);
  }

  let compiledIgnore = null;
  if (scope === 'lines') {
    if (!Array.isArray(rule.ignore) || rule.ignore.length === 0) {
      throw new Error(`Rule '${pattern}': 'scope: lines' requires a non-empty 'ignore' array of regex patterns`);
    }
    compiledIgnore = rule.ignore.map(pat => {
      try {
        return new RegExp(pat);
      } catch (e) {
        throw new Error(`Rule '${pattern}': invalid regex '${pat}': ${e.message}`);
      }
    });
  }

  return { pattern, scope, side, ignore: compiledIgnore };
}


function findMatchingRule(rules, filePath) {
  for (const rule of rules) {
    if (rule.pattern === filePath || minimatch(filePath, rule.pattern)) {
      return rule;
    }
  }
  return null;
}


function parseConflictHunks(lines) {
  const hunks = [];
  let i = 0;

  while (i < lines.length) {
    if (!lines[i].startsWith('<<<<<<<')) {
      i++;
      continue;
    }

    const startLine = i;
    i++;

    const oursLines = [];
    while (i < lines.length && !lines[i].startsWith('=======')) {
      oursLines.push(lines[i]);
      i++;
    }

    if (i >= lines.length) {
      // malformed — missing =======
      return [];
    }
    i++; // skip =======

    const theirsLines = [];
    while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
      theirsLines.push(lines[i]);
      i++;
    }

    if (i >= lines.length) {
      // malformed — missing >>>>>>>
      return [];
    }

    hunks.push({ startLine, endLine: i, oursLines, theirsLines });
    i++; // skip >>>>>>>
  }

  return hunks;
}


function isHunkIgnorable(hunk, ignorePatterns) {
  const allLines = [...hunk.oursLines, ...hunk.theirsLines];
  for (const line of allLines) {
    if (line.trim().length === 0) {
      continue;
    }
    const matchesAny = ignorePatterns.some(re => re.test(line));
    if (!matchesAny) {
      return false;
    }
  }
  return true;
}


function buildResolvedContent(lines, hunks, side) {
  const result = [];
  let lineIdx = 0;

  for (const hunk of hunks) {
    // add non-conflict lines before this hunk
    while (lineIdx < hunk.startLine) {
      result.push(lines[lineIdx]);
      lineIdx++;
    }
    // replace hunk with chosen side
    const replacement = side === 'theirs' ? hunk.theirsLines : hunk.oursLines;
    for (const line of replacement) {
      result.push(line);
    }
    // skip past the hunk in the original
    lineIdx = hunk.endLine + 1;
  }

  // add remaining lines after last hunk
  while (lineIdx < lines.length) {
    result.push(lines[lineIdx]);
    lineIdx++;
  }

  return result.join('\n');
}
