#!/usr/bin/env node
import { Command } from 'commander';

import pkg from '../../package.json';
import { checkCommand } from './commands/check';
import { explainCommand } from './commands/explain';
import { validateCommand } from './commands/validate';

const program = new Command();

program
  .name('odgn-rights')
  .description('CLI tool for testing and debugging permission configurations')
  .version(pkg.version);

program.addCommand(checkCommand);
program.addCommand(explainCommand);
program.addCommand(validateCommand);

program.parse();
