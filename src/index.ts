#!/usr/bin/env node

import { Command } from 'commander';
import { createProjectCommand } from './cli/project.js';

const program = new Command();

program
  .name('pilot-ai')
  .description('Personal AI agent for macOS')
  .version('0.1.0');

program
  .command('init')
  .description('Interactive setup wizard')
  .action(async () => {
    console.log('pilot-ai init - coming soon');
  });

program
  .command('start')
  .description('Start the agent (launchd)')
  .action(async () => {
    console.log('pilot-ai start - coming soon');
  });

program
  .command('stop')
  .description('Stop the agent')
  .action(async () => {
    console.log('pilot-ai stop - coming soon');
  });

program
  .command('status')
  .description('Check agent status')
  .action(async () => {
    console.log('pilot-ai status - coming soon');
  });

program
  .command('logs')
  .description('View agent logs')
  .option('-f, --follow', 'Follow log output')
  .action(async () => {
    console.log('pilot-ai logs - coming soon');
  });

program.addCommand(createProjectCommand());

program.parse();
