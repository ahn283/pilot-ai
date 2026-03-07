import { Command } from 'commander';
import path from 'node:path';
import { addProject, removeProject, listProjects, scanProjects } from '../agent/project.js';

export function createProjectCommand(): Command {
  const cmd = new Command('project').description('프로젝트 관리');

  cmd
    .command('add <name> <path>')
    .description('프로젝트 등록')
    .action(async (name: string, projectPath: string) => {
      const resolved = path.resolve(projectPath);
      await addProject(name, resolved);
      console.log(`프로젝트 "${name}" 등록 완료: ${resolved}`);
    });

  cmd
    .command('list')
    .description('등록된 프로젝트 목록')
    .action(async () => {
      const projects = await listProjects();
      const entries = Object.entries(projects);
      if (entries.length === 0) {
        console.log('등록된 프로젝트가 없습니다.');
        return;
      }
      for (const [name, entry] of entries) {
        console.log(`  ${name} → ${entry.path}${entry.description ? ` (${entry.description})` : ''}`);
      }
    });

  cmd
    .command('scan <dirs...>')
    .description('디렉토리를 스캔하여 프로젝트 자동 감지')
    .action(async (dirs: string[]) => {
      const resolved = dirs.map((d) => path.resolve(d));
      const detected = await scanProjects(resolved);
      const entries = Object.entries(detected);
      if (entries.length === 0) {
        console.log('새로 감지된 프로젝트가 없습니다.');
        return;
      }
      console.log(`${entries.length}개 프로젝트 감지:`);
      for (const [name, p] of entries) {
        console.log(`  ${name} → ${p}`);
      }
    });

  cmd
    .command('remove <name>')
    .description('프로젝트 등록 해제')
    .action(async (name: string) => {
      const removed = await removeProject(name);
      if (removed) {
        console.log(`프로젝트 "${name}" 제거 완료.`);
      } else {
        console.log(`프로젝트 "${name}"을 찾을 수 없습니다.`);
      }
    });

  return cmd;
}
