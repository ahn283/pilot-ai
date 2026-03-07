#!/usr/bin/env node

import { Command } from 'commander';
import { createProjectCommand } from './cli/project.js';
import { runInit } from './cli/init.js';
import { runStart } from './cli/start.js';
import { runStop } from './cli/stop.js';
import { runStatus } from './cli/status.js';
import { runLogs } from './cli/logs.js';

const program = new Command();

program
  .name('pilot-ai')
  .description('Personal AI agent for macOS')
  .version('0.1.0');

program
  .command('init')
  .description('Interactive setup wizard')
  .action(async () => {
    await runInit();
  });

program
  .command('start')
  .description('Start the agent (launchd)')
  .action(async () => {
    await runStart();
  });

program
  .command('stop')
  .description('Stop the agent')
  .action(async () => {
    await runStop();
  });

program
  .command('status')
  .description('Check agent status')
  .action(async () => {
    await runStatus();
  });

program
  .command('logs')
  .description('View agent logs')
  .option('-f, --follow', 'Follow log output')
  .action(async (opts) => {
    await runLogs(opts);
  });

program.addCommand(createProjectCommand());

program.parse();
