/* eslint-disable no-console */
import { Command } from 'commander';

import type { Flags } from '@/constants';

import { lettersFromMask } from '../../utils';
import { loadConfig } from '../helpers/config-loader';
import { parseFlags } from '../helpers/flag-parser';
import { colors, flagName, formatResult } from '../helpers/output';

export const explainCommand = new Command('explain')
  .description('Explain why a permission is allowed or denied')
  .requiredOption('-c, --config <file>', 'Path to rights configuration file')
  .requiredOption('-p, --path <path>', 'Resource path to check')
  .requiredOption('-f, --flag <flag>', 'Permission flag(s) to explain')
  .option('--context <json>', 'JSON context for conditional rights')
  .option('--time <iso-date>', 'Override current time for time-based rights')
  .option('--json', 'Output as JSON')
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

      const explanation = rights.explain(options.path, flag, context);

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              allowed: explanation.allowed,
              details: explanation.details.map(d => ({
                allowed: d.allowed,
                flag: flagName(d.bit),
                rule: d.right?.toString()
              })),
              flag: options.flag,
              path: options.path
            },
            null,
            2
          )
        );
        process.exit(explanation.allowed ? 0 : 1);
      }

      console.log(
        `\nExplaining ${colors.cyan(options.flag)} on ${colors.cyan(options.path)}...\n`
      );
      console.log(`Result: ${formatResult(explanation.allowed)}\n`);

      console.log(colors.bold('Decision breakdown:'));
      for (const detail of explanation.details) {
        const status = detail.allowed
          ? colors.green('ALLOWED')
          : colors.red('DENIED');
        console.log(`  ${flagName(detail.bit)}: ${status}`);
        if (detail.right) {
          console.log(`    Matched by: ${colors.dim(detail.right.toString())}`);
        } else {
          console.log(
            `    ${colors.dim('No matching rule grants this permission')}`
          );
        }
      }

      // Show all matching rules
      const allRights = rights.allRights().filter(r => r.matches(options.path));
      if (allRights.length > 0) {
        console.log(`\n${colors.bold('Matching rules (by specificity):')}`);
        allRights
          .sort((a, b) => b.specificity() - a.specificity())
          .forEach((r, i) => {
            console.log(`  ${i + 1}. ${colors.cyan(r.toString())}`);
            console.log(`     Specificity: ${r.specificity()}`);
            if (r.tags.length > 0) {
              console.log(`     Tags: ${r.tags.join(', ')}`);
            }
          });
      }

      // Provide suggestions if denied
      if (!explanation.allowed) {
        console.log(
          `\n${colors.yellow('Suggestion:')} To grant ${options.flag} access, add:`
        );
        const flagLetters = lettersFromMask(flag);
        console.log(
          `  +${flagLetters}:${options.path}    ${colors.dim('(exact path)')}`
        );
        const wildcardPath = options.path.replace(/\/[^/]+$/, '/*');
        if (wildcardPath !== options.path) {
          console.log(
            `  +${flagLetters}:${wildcardPath}      ${colors.dim('(wildcard)')}`
          );
        }
      }

      process.exit(explanation.allowed ? 0 : 1);
    } catch (error) {
      console.error(colors.red(`Error: ${(error as Error).message}`));
      process.exit(2);
    }
  });
