#!/usr/bin/env node

import { Command } from 'commander';
import { createProjectCommand } from './cli/project.js';
import { runInit } from './cli/init.js';
import { runStart } from './cli/start.js';
import { runStop } from './cli/stop.js';
import { runStatus } from './cli/status.js';
import { runLogs } from './cli/logs.js';

const program = new Command();

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

program
  .name('pilot-ai')
  .description('Personal AI agent for macOS')
  .version(pkg.version);

program
  .command('init')
  .description('Interactive setup wizard')
  .action(async () => {
    await runInit();
  });

program
  .command('start')
  .description('Start the agent (launchd)')
  .option('-f, --follow', 'Follow log output after starting')
  .action(async (opts) => {
    await runStart(opts);
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

program
  .command('daemon')
  .description('Run agent in foreground (used by launchd)')
  .action(async () => {
    const { loadConfig } = await import('./config/store.js');
    const { createMessengerAdapter } = await import('./messenger/factory.js');
    const { AgentCore } = await import('./agent/core.js');
    const { startScheduler } = await import('./agent/heartbeat.js');

    const config = await loadConfig();
    const messenger = createMessengerAdapter(config);
    const agent = new AgentCore(messenger, config);

    await agent.start();
    startScheduler();

    console.log(`[${new Date().toISOString()}] pilot-ai daemon started`);

    // Graceful shutdown
    const shutdown = async () => {
      console.log(`[${new Date().toISOString()}] pilot-ai daemon stopping...`);
      await agent.stop();
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  });

program
  .command('adduser')
  .description('Add an authorized user')
  .argument('<platform>', 'Platform: slack or telegram')
  .argument('<userId>', 'User ID to authorize')
  .action(async (platform: string, userId: string) => {
    const { addUser } = await import('./cli/user.js');
    await addUser(platform, userId);
  });

program
  .command('removeuser')
  .description('Remove an authorized user')
  .argument('<platform>', 'Platform: slack or telegram')
  .argument('<userId>', 'User ID to remove')
  .action(async (platform: string, userId: string) => {
    const { removeUser } = await import('./cli/user.js');
    await removeUser(platform, userId);
  });

program
  .command('listusers')
  .description('List all authorized users')
  .action(async () => {
    const { listUsers } = await import('./cli/user.js');
    await listUsers();
  });

program
  .command('doctor')
  .description('Diagnose system requirements and macOS permissions')
  .action(async () => {
    const { runDoctor } = await import('./cli/doctor.js');
    await runDoctor();
  });

program
  .command('tools')
  .description('List all available tools with active/inactive status')
  .action(async () => {
    const { runTools } = await import('./cli/tools.js');
    await runTools();
  });

program
  .command('addtool')
  .description('Add and configure a tool')
  .argument('<name>', 'Tool name (e.g. notion, figma, linear)')
  .action(async (name: string) => {
    const { runAddTool } = await import('./cli/tools.js');
    await runAddTool(name);
  });

program
  .command('removetool')
  .description('Remove a tool')
  .argument('<name>', 'Tool name to remove')
  .action(async (name: string) => {
    const { runRemoveTool } = await import('./cli/tools.js');
    await runRemoveTool(name);
  });

program.addCommand(createProjectCommand());

program.parse();
