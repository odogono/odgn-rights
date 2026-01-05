/* eslint-disable no-console */
import { readFileSync } from 'node:fs';
import { Command } from 'commander';

import { Right } from '@/right';
import { Rights, type RightJSON } from '@/rights';

import { colors } from '../helpers/output';

type ValidationError = {
  detail?: string;
  index?: number;
  line?: number;
  message: string;
};

export const validateCommand = new Command('validate')
  .description('Validate a rights configuration file')
  .argument('<file>', 'Configuration file to validate')
  .option('--strict', 'Enable strict validation (warn on unusual patterns)')
  .option('--json', 'Output as JSON')
  .action((file, options) => {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    try {
      const content = readFileSync(file, 'utf8');
      const isJson = file.endsWith('.json');

      if (isJson) {
        validateJsonConfig(content, errors, warnings, options.strict);
      } else {
        validateStringConfig(content, errors, warnings, options.strict);
      }

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              errors,
              valid: errors.length === 0,
              warnings
            },
            null,
            2
          )
        );
        process.exit(errors.length > 0 ? 1 : 0);
      }

      console.log(`Validating ${colors.cyan(file)}...\n`);

      if (errors.length > 0) {
        console.log(colors.red('Errors found:\n'));
        for (const err of errors) {
          const loc =
            err.index !== undefined
              ? `Rule ${err.index + 1}`
              : `Line ${err.line}`;
          console.log(`  ${colors.red(loc)}: ${err.message}`);
          if (err.detail) {
            console.log(`    ${colors.dim(err.detail)}`);
          }
        }
        console.log(
          `\n${colors.red(`Validation failed with ${errors.length} error(s).`)}`
        );
        process.exit(1);
      }

      if (warnings.length > 0) {
        console.log(colors.yellow('Warnings:\n'));
        for (const warn of warnings) {
          const loc =
            warn.index !== undefined
              ? `Rule ${warn.index + 1}`
              : `Line ${warn.line}`;
          console.log(`  ${colors.yellow(loc)}: ${warn.message}`);
          if (warn.detail) {
            console.log(`    ${colors.dim(warn.detail)}`);
          }
        }
        console.log('');
      }

      // Parse and show summary
      const rights = isJson
        ? Rights.fromJSON(JSON.parse(content))
        : Rights.parse(content);

      const allRights = rights.allRights();
      const withTags = allRights.filter(r => r.tags.length > 0).length;
      const timeBased = allRights.filter(
        r => r.validFrom || r.validUntil
      ).length;

      console.log(colors.green('All rules are valid.\n'));
      console.log(colors.bold('Summary:'));
      console.log(`  Paths:      ${allRights.length}`);
      console.log(`  With tags:  ${withTags}`);
      console.log(`  Time-based: ${timeBased}`);

      process.exit(0);
    } catch (error) {
      if (!options.json) {
        console.error(colors.red(`Error: ${(error as Error).message}`));
      } else {
        console.log(
          JSON.stringify(
            {
              errors: [{ message: (error as Error).message }],
              valid: false,
              warnings: []
            },
            null,
            2
          )
        );
      }
      process.exit(2);
    }
  });

const validateJsonConfig = (
  content: string,
  errors: ValidationError[],
  warnings: ValidationError[],
  strict: boolean
): void => {
  let data: RightJSON[];
  try {
    data = JSON.parse(content);
  } catch (error) {
    errors.push({ detail: (error as Error).message, message: 'Invalid JSON' });
    return;
  }

  if (!Array.isArray(data)) {
    errors.push({ message: 'Configuration must be an array of rights' });
    return;
  }

  data.forEach((item, index) => {
    // Check required fields
    if (!item.path) {
      errors.push({ index, message: 'Missing required field: path' });
    }
    if (!item.allow && !item.deny) {
      errors.push({
        index,
        message: 'Must specify at least "allow" or "deny"'
      });
    }

    // Validate time range
    if (item.validFrom && item.validUntil) {
      const from = new Date(item.validFrom);
      const until = new Date(item.validUntil);
      if (from > until) {
        errors.push({
          detail: `validFrom (${item.validFrom}) is after validUntil (${item.validUntil})`,
          index,
          message: 'Invalid time range'
        });
      }
    }

    // Try to parse the right
    try {
      const init: Record<string, unknown> = {};
      if (item.validFrom) {
        init.validFrom = new Date(item.validFrom);
      }
      if (item.validUntil) {
        init.validUntil = new Date(item.validUntil);
      }
      if (item.tags) {
        init.tags = item.tags;
      }
      new Right(item.path, init);
    } catch (error) {
      errors.push({ index, message: (error as Error).message });
    }

    // Strict mode warnings
    if (strict) {
      if (item.path === '/**') {
        warnings.push({
          detail: '"/**" matches everything - ensure this is intentional',
          index,
          message: 'Overly broad pattern'
        });
      }
    }
  });
};

const validateStringConfig = (
  content: string,
  errors: ValidationError[],
  warnings: ValidationError[],
  strict: boolean
): void => {
  const lines = content.split(/\r?\n/);
  lines.forEach((line, lineNum) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    } // Skip empty/comments

    try {
      Right.parse(trimmed);
    } catch (error) {
      errors.push({
        detail: (error as Error).message,
        line: lineNum + 1,
        message: 'Invalid right definition'
      });
    }

    if (strict && trimmed.includes('/**')) {
      warnings.push({
        line: lineNum + 1,
        message: 'Overly broad pattern detected'
      });
    }
  });
};
