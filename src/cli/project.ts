import { Command } from 'commander';
import path from 'node:path';
import { addProject, removeProject, listProjects, scanProjects } from '../agent/project.js';

export function createProjectCommand(): Command {
  const cmd = new Command('project').description('Project management');

  cmd
    .command('add <name> <path>')
    .description('Register a project')
    .action(async (name: string, projectPath: string) => {
      const resolved = path.resolve(projectPath);
      await addProject(name, resolved);
      console.log(`Project "${name}" registered: ${resolved}`);
    });

  cmd
    .command('list')
    .description('List registered projects')
    .action(async () => {
      const projects = await listProjects();
      const entries = Object.entries(projects);
      if (entries.length === 0) {
        console.log('No projects registered.');
        return;
      }
      for (const [name, entry] of entries) {
        console.log(`  ${name} → ${entry.path}${entry.description ? ` (${entry.description})` : ''}`);
      }
    });

  cmd
    .command('scan <dirs...>')
    .description('Scan directories to auto-detect projects')
    .action(async (dirs: string[]) => {
      const resolved = dirs.map((d) => path.resolve(d));
      const detected = await scanProjects(resolved);
      const entries = Object.entries(detected);
      if (entries.length === 0) {
        console.log('No new projects found.');
        return;
      }
      console.log(`${entries.length} project(s) detected:`);
      for (const [name, p] of entries) {
        console.log(`  ${name} → ${p}`);
      }
    });

  cmd
    .command('remove <name>')
    .description('Remove a project')
    .action(async (name: string) => {
      const removed = await removeProject(name);
      if (removed) {
        console.log(`Project "${name}" removed.`);
      } else {
        console.log(`Project "${name}" not found.`);
      }
    });

  return cmd;
}
