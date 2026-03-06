#!/usr/bin/env node

import { Command } from 'commander';

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

const projectCmd = program.command('project').description('Manage projects');

projectCmd
  .command('add <name> <path>')
  .description('Register a project')
  .action(async (name: string, path: string) => {
    console.log(`pilot-ai project add ${name} ${path} - coming soon`);
  });

projectCmd
  .command('list')
  .description('List registered projects')
  .action(async () => {
    console.log('pilot-ai project list - coming soon');
  });

projectCmd
  .command('scan <dirs...>')
  .description('Auto-detect projects in directories')
  .action(async (dirs: string[]) => {
    console.log(`pilot-ai project scan ${dirs.join(' ')} - coming soon`);
  });

projectCmd
  .command('remove <name>')
  .description('Remove a project from registry')
  .action(async (name: string) => {
    console.log(`pilot-ai project remove ${name} - coming soon`);
  });

program.parse();
