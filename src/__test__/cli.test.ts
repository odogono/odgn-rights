import { resolve } from 'node:path';
import { describe, expect, it } from 'bun:test';

import { loadConfig } from '../cli/helpers/config-loader';
import { parseFlag, parseFlags } from '../cli/helpers/flag-parser';
import { colors, flagName, formatResult } from '../cli/helpers/output';
import { Flags } from '../constants';

const FIXTURES_DIR = resolve(import.meta.dir, 'fixtures');
const CLI_ENTRY = resolve(import.meta.dir, '../cli/index.ts');

const runCLI = async (
  args: string[]
): Promise<{ exitCode: number; stderr: string; stdout: string }> => {
  const proc = Bun.spawn(['bun', 'run', CLI_ENTRY, ...args], {
    cwd: import.meta.dir,
    stderr: 'pipe',
    stdout: 'pipe'
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { exitCode, stderr, stdout };
};

describe('CLI Flag Parser', () => {
  describe('parseFlag', () => {
    it('parses uppercase single flags', () => {
      expect(parseFlag('READ')).toBe(Flags.READ);
      expect(parseFlag('WRITE')).toBe(Flags.WRITE);
      expect(parseFlag('CREATE')).toBe(Flags.CREATE);
      expect(parseFlag('DELETE')).toBe(Flags.DELETE);
      expect(parseFlag('EXECUTE')).toBe(Flags.EXECUTE);
      expect(parseFlag('ALL')).toBe(Flags.ALL);
    });

    it('parses lowercase single flags', () => {
      expect(parseFlag('read')).toBe(Flags.READ);
      expect(parseFlag('write')).toBe(Flags.WRITE);
      expect(parseFlag('all')).toBe(Flags.ALL);
    });

    it('parses single-letter flags', () => {
      expect(parseFlag('R')).toBe(Flags.READ);
      expect(parseFlag('r')).toBe(Flags.READ);
      expect(parseFlag('W')).toBe(Flags.WRITE);
      expect(parseFlag('w')).toBe(Flags.WRITE);
      expect(parseFlag('C')).toBe(Flags.CREATE);
      expect(parseFlag('D')).toBe(Flags.DELETE);
      expect(parseFlag('X')).toBe(Flags.EXECUTE);
      expect(parseFlag('*')).toBe(Flags.ALL);
    });

    it('trims whitespace', () => {
      expect(parseFlag('  READ  ')).toBe(Flags.READ);
      expect(parseFlag('\tWRITE\n')).toBe(Flags.WRITE);
    });

    it('throws on unknown flag', () => {
      expect(() => parseFlag('UNKNOWN')).toThrow('Unknown flag: UNKNOWN');
      expect(() => parseFlag('Z')).toThrow('Unknown flag: Z');
      expect(() => parseFlag('')).toThrow('Unknown flag:');
    });
  });

  describe('parseFlags', () => {
    it('parses comma-separated flags', () => {
      expect(parseFlags('READ,WRITE')).toBe(Flags.READ | Flags.WRITE);
      expect(parseFlags('READ, WRITE, CREATE')).toBe(
        Flags.READ | Flags.WRITE | Flags.CREATE
      );
      expect(parseFlags('R,W,C,D,X')).toBe(Flags.ALL);
    });

    it('parses combined letter flags', () => {
      expect(parseFlags('RW')).toBe(Flags.READ | Flags.WRITE);
      expect(parseFlags('RWCDX')).toBe(Flags.ALL);
      expect(parseFlags('rw')).toBe(Flags.READ | Flags.WRITE);
    });

    it('parses single flags', () => {
      expect(parseFlags('READ')).toBe(Flags.READ);
      expect(parseFlags('ALL')).toBe(Flags.ALL);
      expect(parseFlags('*')).toBe(Flags.ALL);
    });
  });
});

describe('CLI Config Loader', () => {
  describe('loadConfig', () => {
    it('loads JSON config with auto-detection', () => {
      const rights = loadConfig(`${FIXTURES_DIR}/rights.json`);

      expect(rights.read('/')).toBe(true);
      expect(rights.write('/')).toBe(false);
      expect(rights.read('/users/123')).toBe(true);
      expect(rights.write('/users/123')).toBe(true);
      expect(rights.all('/admin/settings')).toBe(true);
    });

    it('loads string config with auto-detection', () => {
      const rights = loadConfig(`${FIXTURES_DIR}/rights.txt`);

      expect(rights.read('/')).toBe(true);
      expect(rights.write('/')).toBe(false);
      expect(rights.read('/users/123')).toBe(true);
      expect(rights.write('/users/123')).toBe(true);
      expect(rights.all('/admin/settings')).toBe(true);
    });

    it('respects explicit format parameter', () => {
      const rights = loadConfig(`${FIXTURES_DIR}/rights.json`, 'json');

      expect(rights.read('/')).toBe(true);
    });

    it('throws on non-existent file', () => {
      expect(() => loadConfig(`${FIXTURES_DIR}/nonexistent.json`)).toThrow();
    });
  });
});

describe('CLI Output Utilities', () => {
  describe('formatResult', () => {
    it('formats allowed result in green', () => {
      const result = formatResult(true);

      expect(result).toContain('ALLOWED');
      expect(result).toContain('\u001b[32m'); // green ANSI code
    });

    it('formats denied result in red', () => {
      const result = formatResult(false);

      expect(result).toContain('DENIED');
      expect(result).toContain('\u001b[31m'); // red ANSI code
    });
  });

  describe('flagName', () => {
    it('returns single flag names', () => {
      expect(flagName(Flags.READ)).toBe('READ');
      expect(flagName(Flags.WRITE)).toBe('WRITE');
      expect(flagName(Flags.CREATE)).toBe('CREATE');
      expect(flagName(Flags.DELETE)).toBe('DELETE');
      expect(flagName(Flags.EXECUTE)).toBe('EXECUTE');
    });

    it('returns combined flag names', () => {
      expect(flagName(Flags.READ | Flags.WRITE)).toBe('READ | WRITE');
      // Order follows flagName implementation: READ, WRITE, CREATE, DELETE, EXECUTE
      expect(flagName(Flags.ALL)).toContain('READ');
      expect(flagName(Flags.ALL)).toContain('WRITE');
      expect(flagName(Flags.ALL)).toContain('CREATE');
      expect(flagName(Flags.ALL)).toContain('DELETE');
      expect(flagName(Flags.ALL)).toContain('EXECUTE');
    });

    it('returns NONE for zero', () => {
      expect(flagName(0)).toBe('NONE');
    });
  });

  describe('colors', () => {
    it('wraps strings with ANSI codes', () => {
      expect(colors.green('test')).toBe('\u001b[32mtest\u001b[0m');
      expect(colors.red('test')).toBe('\u001b[31mtest\u001b[0m');
      expect(colors.yellow('test')).toBe('\u001b[33mtest\u001b[0m');
      expect(colors.cyan('test')).toBe('\u001b[36mtest\u001b[0m');
      expect(colors.dim('test')).toBe('\u001b[2mtest\u001b[0m');
      expect(colors.bold('test')).toBe('\u001b[1mtest\u001b[0m');
    });
  });
});

// Integration tests for CLI commands
describe('CLI Integration', () => {
  describe('check command', () => {
    it('returns exit code 0 when permission is allowed', async () => {
      const { exitCode, stdout } = await runCLI([
        'check',
        '-c',
        `${FIXTURES_DIR}/rights.json`,
        '-p',
        '/users/123',
        '-f',
        'READ'
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('ALLOWED');
    });

    it('returns exit code 1 when permission is denied', async () => {
      const { exitCode, stdout } = await runCLI([
        'check',
        '-c',
        `${FIXTURES_DIR}/rights.json`,
        '-p',
        '/users/123',
        '-f',
        'DELETE'
      ]);

      expect(exitCode).toBe(1);
      expect(stdout).toContain('DENIED');
    });

    it('supports quiet mode for scripting', async () => {
      const { exitCode, stdout } = await runCLI([
        'check',
        '-c',
        `${FIXTURES_DIR}/rights.json`,
        '-p',
        '/',
        '-f',
        'READ',
        '--quiet'
      ]);

      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('true');
    });

    it('returns exit code 2 on invalid config file', async () => {
      const { exitCode, stderr } = await runCLI([
        'check',
        '-c',
        `${FIXTURES_DIR}/nonexistent.json`,
        '-p',
        '/',
        '-f',
        'READ'
      ]);

      expect(exitCode).toBe(2);
      expect(stderr).toContain('Error');
    });

    it('supports combined flags like RW', async () => {
      const { exitCode } = await runCLI([
        'check',
        '-c',
        `${FIXTURES_DIR}/rights.json`,
        '-p',
        '/users/123',
        '-f',
        'RW'
      ]);

      expect(exitCode).toBe(0);
    });

    it('supports comma-separated flags', async () => {
      const { exitCode } = await runCLI([
        'check',
        '-c',
        `${FIXTURES_DIR}/rights.json`,
        '-p',
        '/users/123',
        '-f',
        'READ,WRITE'
      ]);

      expect(exitCode).toBe(0);
    });
  });

  describe('validate command', () => {
    it('returns exit code 0 for valid JSON config', async () => {
      const { exitCode, stdout } = await runCLI([
        'validate',
        `${FIXTURES_DIR}/rights.json`
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('All rules are valid');
    });

    it('returns exit code 0 for valid string config', async () => {
      const { exitCode, stdout } = await runCLI([
        'validate',
        `${FIXTURES_DIR}/rights.txt`
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('All rules are valid');
    });

    it('returns exit code 1 for invalid JSON config', async () => {
      const { exitCode, stdout } = await runCLI([
        'validate',
        `${FIXTURES_DIR}/invalid.json`
      ]);

      expect(exitCode).toBe(1);
      expect(stdout).toContain('error');
    });

    it('returns exit code 1 for invalid string config', async () => {
      const { exitCode, stdout } = await runCLI([
        'validate',
        `${FIXTURES_DIR}/invalid.txt`
      ]);

      expect(exitCode).toBe(1);
      expect(stdout).toContain('error');
    });

    it('shows warnings in strict mode for broad patterns', async () => {
      const { exitCode, stdout } = await runCLI([
        'validate',
        '--strict',
        `${FIXTURES_DIR}/broad-pattern.json`
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Warning');
    });

    it('outputs JSON format when requested', async () => {
      const { exitCode, stdout } = await runCLI([
        'validate',
        '--json',
        `${FIXTURES_DIR}/rights.json`
      ]);

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);

      expect(parsed.valid).toBe(true);
      expect(parsed.errors).toEqual([]);
    });

    it('shows summary with paths, tags, and time-based counts', async () => {
      const { exitCode, stdout } = await runCLI([
        'validate',
        `${FIXTURES_DIR}/rights.json`
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Paths:');
      expect(stdout).toContain('With tags:');
      expect(stdout).toContain('Time-based:');
    });
  });

  describe('explain command', () => {
    it('returns exit code 0 when permission is allowed', async () => {
      const { exitCode, stdout } = await runCLI([
        'explain',
        '-c',
        `${FIXTURES_DIR}/rights.json`,
        '-p',
        '/users/123',
        '-f',
        'READ'
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('ALLOWED');
      expect(stdout).toContain('Decision breakdown');
    });

    it('returns exit code 1 when permission is denied', async () => {
      const { exitCode, stdout } = await runCLI([
        'explain',
        '-c',
        `${FIXTURES_DIR}/rights.json`,
        '-p',
        '/users/123',
        '-f',
        'DELETE'
      ]);

      expect(exitCode).toBe(1);
      expect(stdout).toContain('DENIED');
      expect(stdout).toContain('Suggestion');
    });

    it('shows matching rules by specificity', async () => {
      const { exitCode, stdout } = await runCLI([
        'explain',
        '-c',
        `${FIXTURES_DIR}/rights.json`,
        '-p',
        '/users/123',
        '-f',
        'READ'
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Matching rules');
      expect(stdout).toContain('Specificity');
    });

    it('outputs JSON format when requested', async () => {
      const { exitCode, stdout } = await runCLI([
        'explain',
        '-c',
        `${FIXTURES_DIR}/rights.json`,
        '-p',
        '/users/123',
        '-f',
        'READ',
        '--json'
      ]);

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);

      expect(parsed.allowed).toBe(true);
      expect(parsed.path).toBe('/users/123');
      expect(parsed.flag).toBe('READ');
      expect(Array.isArray(parsed.details)).toBe(true);
    });
  });

  describe('help output', () => {
    it('shows help for main command', async () => {
      const { exitCode, stdout } = await runCLI(['--help']);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('odgn-rights');
      expect(stdout).toContain('check');
      expect(stdout).toContain('explain');
      expect(stdout).toContain('validate');
    });

    it('shows help for check command', async () => {
      const { exitCode, stdout } = await runCLI(['check', '--help']);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('--config');
      expect(stdout).toContain('--path');
      expect(stdout).toContain('--flag');
    });

    it('shows help for explain command', async () => {
      const { exitCode, stdout } = await runCLI(['explain', '--help']);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('--config');
      expect(stdout).toContain('--path');
      expect(stdout).toContain('--flag');
      expect(stdout).toContain('--json');
    });

    it('shows help for validate command', async () => {
      const { exitCode, stdout } = await runCLI(['validate', '--help']);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('--strict');
      expect(stdout).toContain('--json');
    });
  });
});
