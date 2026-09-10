import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { callLLM } from '@/lib/ai/llm';
import { resolveModel } from '@/lib/server/resolve-model';
import {
  COURSE_SPACES_DIR,
  listCourseArtifacts,
  listCourseJobs,
  readMaterialExtraction,
  readServerCourse,
} from '@/lib/server/course-space-storage';

export type TeacherAgentMode = 'deepseek-harness' | 'deepseek-compatible';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

function safeSessionId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'teacher-workspace';
}

async function writePlugin(dir: string, name: string, description: string, content: unknown) {
  const pluginDir = path.join(dir, 'plugins', name);
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.writeFile(path.join(pluginDir, 'plugin.json'), JSON.stringify({ name, description, version: 1 }, null, 2));
  await fs.writeFile(path.join(pluginDir, 'context.json'), JSON.stringify(content, null, 2));
}

export async function refreshTeacherWorkspacePlugins(courseId: string) {
  const course = await readServerCourse(courseId);
  if (!course) throw new Error('课程不存在');
  const workspace = path.join(COURSE_SPACES_DIR, 'agent-workspaces', courseId);
  await fs.mkdir(workspace, { recursive: true });
  const [jobs, artifacts, extractions] = await Promise.all([
    listCourseJobs(courseId),
    listCourseArtifacts(courseId),
    Promise.all(course.materials.map((material) => readMaterialExtraction(material.id))),
  ]);
  await Promise.all([
    writePlugin(workspace, 'course-structure', '课程结构、课时与实时统计', {
      course: { id: course.id, title: course.title, subject: course.subject, status: course.status },
      modules: course.modules,
      statistics: {
        modules: course.modules.length,
        lessons: course.modules.reduce((sum, item) => sum + item.lessons.length, 0),
        materials: course.materials.length,
        readyMaterials: course.materials.filter((item) => item.status === 'ready').length,
        jobs: jobs.length,
        completedJobs: jobs.filter((item) => ['review', 'approved'].includes(item.status)).length,
        artifacts: artifacts.length,
      },
    }),
    writePlugin(workspace, 'course-materials', '教师上传材料的解析文本与可追溯原始页码', {
      materials: course.materials.map((material) => ({
        ...material,
        chunks: extractions.find((item) => item?.materialId === material.id)?.chunks.slice(0, 80) ?? [],
        formulas: extractions.find((item) => item?.materialId === material.id)?.formulas.slice(0, 80) ?? [],
      })),
    }),
    writePlugin(workspace, 'course-artifacts', '教学产物、审核状态和中间生成任务', {
      jobs: jobs.slice(0, 50),
      artifacts: artifacts.slice(0, 30).map((item) => ({
        id: item.id, type: item.type, title: item.title, status: item.status,
        content: item.content.slice(0, 12000), citations: item.citations,
      })),
    }),
  ]);
  return {
    workspace, course, jobs, artifacts,
    extractions: extractions.filter((item): item is NonNullable<typeof item> => item !== null),
  };
}

function runHarness(input: { workspace: string; sessionId: string; prompt: string }) {
  const python = process.env.DEEPSEEK_HARNESS_PYTHON;
  const bridge = process.env.DEEPSEEK_HARNESS_BRIDGE || path.join(process.cwd(), 'scripts', 'deepseek-harness-bridge.py');
  if (!python) return Promise.resolve<string | null>(null);
  return new Promise<string>((resolve, reject) => {
    const child = spawn(python, [bridge], {
      cwd: input.workspace,
      env: { ...process.env, DSH_WORKSPACE: input.workspace, DSH_SESSION_ID: input.sessionId },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (data) => { stdout += String(data); });
    child.stderr.on('data', (data) => { stderr += String(data); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 && stdout.trim() ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `Harness exited ${code}`)));
    child.stdin.end(input.prompt);
  });
}

export async function runTeacherWorkspaceAgent(input: {
  courseId: string;
  sessionId: string;
  message: string;
  history?: ChatMessage[];
}) {
  const context = await refreshTeacherWorkspacePlugins(input.courseId);
  const pluginSummary = [
    `课程：${context.course.title}`,
    `结构：${context.course.modules.length} 个模块，${context.course.modules.reduce((sum, item) => sum + item.lessons.length, 0)} 个课时`,
    `材料：${context.course.materials.map((item) => `${item.name}(${item.status})`).join('、') || '暂无'}`,
    `任务：${context.jobs.length} 个；产物：${context.artifacts.length} 个`,
    `插件目录：${path.join(context.workspace, 'plugins')}`,
  ].join('\n');
  const pluginEvidence = context.extractions.flatMap((extraction) =>
    extraction.chunks.slice(0, 20).map((chunk) =>
      `[material:${extraction.materialId} page:${chunk.page}] ${chunk.text.replace(/\s+/g, ' ').slice(0, 600)}`,
    ),
  ).join('\n').slice(0, 30000);
  const artifactEvidence = context.artifacts.slice(0, 12).map((item) =>
    `[artifact:${item.id} status:${item.status}] ${item.title}\n${item.content.slice(0, 1600)}`,
  ).join('\n\n').slice(0, 18000);
  const prompt = `你是教师的私人课程工作区智能体。你运行在 DeepSeek Harness 的课程隔离工作区中。\n已装入三个只读课程插件：course-structure、course-materials、course-artifacts。回答课程统计时必须依据插件；引用材料时保留 [material:材料ID page:页码]；不要声称创建了未实际创建的产物。\n禁止在对话中直接编写教学大纲、教学计划、课件、讲稿、习题、评分量规或 PBL 项目；这些生成请求由平台标准生成—审核—可视化工作流处理。对话仅负责查询、统计、分析、解释和建议。\n\n【课程结构与统计插件】\n${pluginSummary}\n\n【课程材料插件】\n${pluginEvidence || '暂无已解析材料'}\n\n【教学产物插件】\n${artifactEvidence || '暂无教学产物'}\n\n最近对话：\n${(input.history ?? []).slice(-8).map((item) => `${item.role}: ${item.content}`).join('\n')}\n\n教师：${input.message}`;
  try {
    const harnessText = await runHarness({ workspace: context.workspace, sessionId: safeSessionId(input.sessionId), prompt });
    if (harnessText) return { text: harnessText, mode: 'deepseek-harness' as TeacherAgentMode };
  } catch (error) {
    console.warn('[teacher-workspace] DeepSeek Harness unavailable, using compatible route:', error);
  }
  const { model, thinkingConfig } = await resolveModel({ stage: 'generate-classroom' });
  const result = await callLLM({ model, system: '你是严谨、简洁的教师课程工作区智能体。请基于提供的课程插件摘要回答。', prompt }, 'teacher-workspace-agent', { retries: 1 }, thinkingConfig);
  return { text: result.text.trim() || '暂时没有生成有效回复，请重试。', mode: 'deepseek-compatible' as TeacherAgentMode };
}
