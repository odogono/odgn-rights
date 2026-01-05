/* eslint-disable no-console */
import { Command } from 'commander';

import type { Flags } from '@/constants';

import { loadConfig } from '../helpers/config-loader';
import { parseFlags } from '../helpers/flag-parser';
import { colors, formatResult } from '../helpers/output';

export const checkCommand = new Command('check')
  .description('Test a permission check against a configuration')
  .requiredOption('-c, --config <file>', 'Path to rights configuration file')
  .requiredOption('-p, --path <path>', 'Resource path to check')
  .requiredOption(
    '-f, --flag <flag>',
    'Permission flag(s) to check (READ, WRITE, etc.)'
  )
  .option('--context <json>', 'JSON context for conditional rights')
  .option('--time <iso-date>', 'Override current time for time-based rights')
  .option('--quiet', 'Only output result (for scripting)')
  .action(options => {
    try {
      const rights = loadConfig(options.config);
      const flag = parseFlags(options.flag) as Flags;

      let context: Record<string, unknown> | undefined = undefined;
      if (options.context) {
        context = JSON.parse(options.context);
      }
      if (options.time) {
        context = { ...context, _now: new Date(options.time) };
      }

      const result = rights.has(options.path, flag, context);

      if (options.quiet) {
        process.stdout.write(result ? 'true' : 'false');
        process.exit(result ? 0 : 1);
      }

      console.log(
        `Checking ${colors.cyan(options.flag)} on ${colors.cyan(options.path)}...`
      );
      console.log(`Result: ${formatResult(result)}`);

      process.exit(result ? 0 : 1);
    } catch (error) {
      console.error(colors.red(`Error: ${(error as Error).message}`));
      process.exit(2);
    }
  });
