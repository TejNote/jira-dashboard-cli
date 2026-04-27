import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildDrivePath,
  copyToDrive,
  moveDriveFile,
  findDriveFile,
} from './drive-sync.ts';

let root: string;

beforeEach(() => {
  root = join(tmpdir(), `drive-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('buildDrivePath', () => {
  it('assembles path from drive_folder / subproject / state / filename', () => {
    const p = buildDrivePath(root, 'ceo', 'backend', 'pending', 'JIRA-CEOR-1-foo.md');
    expect(p).toBe(join(root, 'ceo', 'backend', 'pending', 'JIRA-CEOR-1-foo.md'));
  });
});

describe('copyToDrive', () => {
  it('copies source file into target path, creating directories', () => {
    const source = join(root, 'source.md');
    writeFileSync(source, 'hello');
    const target = buildDrivePath(root, 'ceo', 'backend', 'pending', 'x.md');
    copyToDrive(source, target);
    expect(readFileSync(target, 'utf8')).toBe('hello');
  });
});

describe('moveDriveFile', () => {
  it('moves a file from one state folder to another', () => {
    const from = buildDrivePath(root, 'ceo', 'backend', 'pending', 'x.md');
    mkdirSync(join(root, 'ceo', 'backend', 'pending'), { recursive: true });
    writeFileSync(from, 'hello');
    const to = buildDrivePath(root, 'ceo', 'backend', 'active', 'x.md');
    moveDriveFile(from, to);
    expect(existsSync(from)).toBe(false);
    expect(readFileSync(to, 'utf8')).toBe('hello');
  });

  it('is idempotent when target already equals source', () => {
    const same = buildDrivePath(root, 'ceo', 'backend', 'pending', 'x.md');
    mkdirSync(join(root, 'ceo', 'backend', 'pending'), { recursive: true });
    writeFileSync(same, 'hello');
    moveDriveFile(same, same);
    expect(readFileSync(same, 'utf8')).toBe('hello');
  });
});

describe('findDriveFile', () => {
  it('finds an existing plan file across state folders by JIRA key', () => {
    const p = buildDrivePath(root, 'ceo', 'backend', 'active', 'JIRA-CEOR-7-foo.md');
    mkdirSync(join(root, 'ceo', 'backend', 'active'), { recursive: true });
    writeFileSync(p, 'body');
    const found = findDriveFile(root, 'ceo', 'JIRA-CEOR-7');
    expect(found).not.toBeNull();
    expect(found!.state).toBe('active');
    expect(found!.subproject).toBe('backend');
    expect(found!.absolutePath).toBe(p);
  });

  it('returns null when no file matches', () => {
    expect(findDriveFile(root, 'ceo', 'JIRA-NOPE')).toBeNull();
  });

  it('finds a date-prefixed plan file (team convention)', () => {
    const filename = '2026-04-20-CEOR-84-ai-integration-test.md';
    const p = buildDrivePath(root, 'ceo', 'backend', 'pending', filename);
    mkdirSync(join(root, 'ceo', 'backend', 'pending'), { recursive: true });
    writeFileSync(p, 'body');
    const found = findDriveFile(root, 'ceo', 'CEOR-84');
    expect(found).not.toBeNull();
    expect(found!.filename).toBe(filename);
    expect(found!.state).toBe('pending');
  });

  it('does not match partial JIRA keys (e.g. CEOR-8 vs CEOR-84)', () => {
    const filename = '2026-04-20-CEOR-84-foo.md';
    const p = buildDrivePath(root, 'ceo', 'backend', 'pending', filename);
    mkdirSync(join(root, 'ceo', 'backend', 'pending'), { recursive: true });
    writeFileSync(p, 'body');
    expect(findDriveFile(root, 'ceo', 'CEOR-8')).toBeNull();
    expect(findDriveFile(root, 'ceo', 'CEOR-84')).not.toBeNull();
  });
});
