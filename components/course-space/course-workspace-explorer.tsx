'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Folder,
  FolderPlus,
  History,
  Plus,
  Presentation,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type {
  CourseArtifactJob,
  CourseArtifactRecord,
  CourseArtifactType,
  CourseSpace,
} from '@/lib/course-space';
import type { TeacherOperationPlan } from '@/lib/course-space/teacher-agent-intent';
import { nanoid } from 'nanoid';

type Scope =
  | { type: 'course' }
  | { type: 'module'; moduleId: string }
  | { type: 'lesson'; lessonId: string };
type BrowserFile = {
  id: string;
  title: string;
  kind: 'artifact';
  artifact: CourseArtifactRecord;
  scope: Scope;
};
const artifactPriority = (artifact: CourseArtifactRecord) =>
  artifact.type === 'lesson-courseware'
    ? 3
    : artifact.classroomUrl
      ? 2
      : artifact.type === 'course-outline'
        ? 1
        : 0;

function belongsToScope(artifact: CourseArtifactRecord, scope: Scope, course: CourseSpace) {
  if (scope.type === 'course') return artifact.scope.type === 'course';
  if (scope.type === 'module')
    return artifact.scope.type === 'module' && artifact.scope.moduleId === scope.moduleId;
  if (artifact.scope.type === 'lesson') return artifact.scope.lessonId === scope.lessonId;
  const module = course.modules.find((item) =>
    item.lessons.some((lesson) => lesson.id === scope.lessonId),
  );
  return artifact.scope.type === 'module' && artifact.scope.moduleId === module?.id;
}

export function CourseWorkspaceExplorer({
  course,
  artifacts,
  onGenerate,
  onCourseChange,
  onRefresh,
}: {
  course: CourseSpace;
  artifacts: CourseArtifactRecord[];
  onGenerate: (type: CourseArtifactType, scope?: CourseArtifactJob['scope']) => void;
  onCourseChange: (course: CourseSpace) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const firstLesson = course.modules.flatMap((item) => item.lessons)[0];
  const initialArtifact = [...artifacts].sort(
    (a, b) => artifactPriority(b) - artifactPriority(a) || b.updatedAt - a.updatedAt,
  )[0];
  const [scope, setScope] = useState<Scope>(
    initialArtifact?.scope ??
      (firstLesson ? { type: 'lesson', lessonId: firstLesson.id } : { type: 'course' }),
  );
  const [expanded, setExpanded] = useState(() => new Set(course.modules.map((item) => item.id)));
  const [expandedFolders, setExpandedFolders] = useState(
    () => new Set(course.modules.flatMap((item) => item.folders?.map((folder) => folder.id) ?? [])),
  );
  const [courseFilesExpanded, setCourseFilesExpanded] = useState(true);
  const [selectedFileId, setSelectedFileId] = useState('');
  const initializedFromArtifacts = useRef(false);

  useEffect(() => {
    if (initializedFromArtifacts.current || artifacts.length === 0) return;
    initializedFromArtifacts.current = true;
    const preferred = [...artifacts].sort(
      (a, b) => artifactPriority(b) - artifactPriority(a) || b.updatedAt - a.updatedAt,
    )[0];
    if (preferred) setScope(preferred.scope);
  }, [artifacts]);
  const files = useMemo<BrowserFile[]>(() => {
    const latestCourseware = artifacts
      .filter((item) => item.type === 'lesson-courseware' && belongsToScope(item, scope, course))
      .sort((a, b) => artifactPriority(b) - artifactPriority(a) || b.updatedAt - a.updatedAt)[0];
    return latestCourseware
      ? [
          {
            id: latestCourseware.id,
            title: latestCourseware.title,
            kind: 'artifact',
            artifact: latestCourseware,
            scope,
          },
        ]
      : [];
  }, [artifacts, course, scope]);
  const explicitlySelectedArtifact = artifacts.find((item) => item.id === selectedFileId);
  const selectedFile = explicitlySelectedArtifact
    ? {
        id: explicitlySelectedArtifact.id,
        title: explicitlySelectedArtifact.title,
        kind: 'artifact' as const,
        artifact: explicitlySelectedArtifact,
        scope: explicitlySelectedArtifact.scope,
      }
    : files[0];
  const selectScope = (next: Scope) => {
    setScope(next);
    setSelectedFileId('');
  };
  const addModule = async () => {
    const title = window.prompt('请输入新模块名称');
    if (!title?.trim()) return;
    const now = Date.now();
    const moduleId = nanoid(10);
    await onCourseChange({
      ...course,
      updatedAt: now,
      modules: [
        ...course.modules,
        {
          id: moduleId,
          courseId: course.id,
          title: title.trim(),
          order: course.modules.length + 1,
          objectives: [],
          lessons: [],
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    setExpanded((items) => new Set(items).add(moduleId));
    selectScope({ type: 'module', moduleId });
  };
  const addFolder = async (moduleId: string) => {
    const title = window.prompt('请输入分组文件夹名称，例如“第1–15周”');
    if (!title?.trim()) return;
    const target = course.modules.find((item) => item.id === moduleId);
    if (!target) return;
    const now = Date.now();
    const folderId = nanoid(10);
    await onCourseChange({
      ...course,
      updatedAt: now,
      modules: course.modules.map((item) =>
        item.id === moduleId
          ? {
              ...item,
              updatedAt: now,
              folders: [
                ...(item.folders ?? []),
                {
                  id: folderId,
                  moduleId,
                  title: title.trim(),
                  order: (item.folders?.length ?? 0) + 1,
                  createdAt: now,
                  updatedAt: now,
                },
              ],
            }
          : item,
      ),
    });
    setExpanded((items) => new Set(items).add(moduleId));
    setExpandedFolders((items) => new Set(items).add(folderId));
  };
  const addLesson = async (moduleId: string, folderId?: string) => {
    const title = window.prompt('请输入课时文件夹名称，例如“第1周”');
    if (!title?.trim()) return;
    const target = course.modules.find((item) => item.id === moduleId);
    if (!target) return;
    const now = Date.now();
    const lessonId = nanoid(10);
    await onCourseChange({
      ...course,
      updatedAt: now,
      modules: course.modules.map((item) =>
        item.id === moduleId
          ? {
              ...item,
              updatedAt: now,
              lessons: [
                ...item.lessons,
                {
                  id: lessonId,
                  moduleId,
                  folderId,
                  title: title.trim(),
                  order: item.lessons.length + 1,
                  objectives: [],
                  materialIds: [],
                  createdAt: now,
                  updatedAt: now,
                },
              ],
            }
          : item,
      ),
    });
    setExpanded((items) => new Set(items).add(moduleId));
    if (folderId) setExpandedFolders((items) => new Set(items).add(folderId));
    selectScope({ type: 'lesson', lessonId });
  };
  const createStructureWithAgent = async () => {
    const message = window.prompt(
      '告诉课程操作智能体要创建什么，例如：\n生成1-17周的课件，并在课件生成模块下建立对应课时文件夹',
    );
    if (!message?.trim()) return;
    const planned = await fetch(`/api/course-space/${course.id}/agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, sessionId: `teacher-${course.id}-default` }),
    });
    const plannedResult = (await planned.json()) as {
      success?: boolean;
      error?: string;
      text?: string;
      plan?: TeacherOperationPlan;
    };
    if (!planned.ok || !plannedResult.plan) {
      window.alert(plannedResult.error || plannedResult.text || '智能体未形成可执行的课程结构计划');
      return;
    }
    if (
      !window.confirm(
        `${plannedResult.plan.title}\n\n${plannedResult.plan.summary}\n\n确认执行吗？`,
      )
    )
      return;
    const executed = await fetch(`/api/course-space/${course.id}/agent/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: plannedResult.plan }),
    });
    const executedResult = (await executed.json()) as {
      success?: boolean;
      error?: string;
      plan?: { result?: string };
    };
    if (!executed.ok) {
      window.alert(executedResult.error || '课程结构创建失败');
      return;
    }
    await onRefresh();
    window.alert(executedResult.plan?.result || '课程结构已更新');
  };

  return (
    <div className="overflow-hidden rounded-[26px] border border-white/80 bg-white/90 shadow-[0_28px_80px_-42px_rgba(15,23,42,.45)] backdrop-blur-xl">
      {/* Course tree + the real OpenMAIC Pro workspace. The embedded classroom
        owns the per-page outline rail and narration/action timeline. */}
      <div className="grid h-[790px] min-h-0 grid-cols-[220px_minmax(0,1fr)] max-[900px]:grid-cols-[190px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-r bg-[#faf8fb] p-3">
          <div className="mb-3 rounded-xl bg-[#B00055] px-3 py-3 text-white">
            <div className="flex items-center gap-2">
              <BookOpen className="size-4" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{course.title}</p>
                <p className="text-[10px] text-white/65">课程文件空间</p>
              </div>
              <button
                title="让智能体创建课程结构"
                aria-label="让智能体创建课程结构"
                onClick={() => void createStructureWithAgent()}
                className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/15 hover:bg-white/25"
              >
                <Sparkles className="size-3.5" />
              </button>
            </div>
          </div>
          <div className="mb-1 flex items-center gap-1">
            <button
              className="p-1 text-slate-400"
              onClick={() => setCourseFilesExpanded((value) => !value)}
            >
              {courseFilesExpanded ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
            </button>
            <button
              onClick={() => selectScope({ type: 'course' })}
              className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left text-xs ${scope.type === 'course' && !selectedFileId ? 'bg-[#B00055]/10 text-[#8F0046]' : 'hover:bg-slate-100'}`}
            >
              <Folder className="size-4" />
              课程级文件
            </button>
            <button
              title="添加模块"
              aria-label="添加模块"
              onClick={() => void addModule()}
              className="grid size-7 shrink-0 place-items-center rounded-lg border bg-white text-[#B00055] hover:bg-[#B00055]/5"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
          {courseFilesExpanded && (
            <div className="mb-2 ml-6 max-h-56 space-y-0.5 overflow-y-auto border-l pl-2">
              <div className="flex items-center gap-2 px-2 py-1.5 text-[10px] font-medium text-slate-400">
                <History className="size-3" />
                历史教学产物 · {artifacts.length}
              </div>
              {artifacts.map((artifact) => (
                <button
                  key={artifact.id}
                  title={artifact.title}
                  onClick={() => {
                    setScope(artifact.scope);
                    setSelectedFileId(artifact.id);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] ${selectedFileId === artifact.id ? 'bg-[#B00055]/10 font-medium text-[#8F0046]' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  {artifact.classroomUrl ? (
                    <Presentation className="size-3.5 shrink-0 text-[#B00055]" />
                  ) : (
                    <FileText className="size-3.5 shrink-0 text-blue-500" />
                  )}
                  <span className="truncate">{artifact.title}</span>
                </button>
              ))}
            </div>
          )}
          <div className="space-y-1">
            {course.modules.map((module) => (
              <div key={module.id}>
                <div className="group/module flex items-center">
                  <button
                    title={`在“${module.title}”下添加分组文件夹`}
                    aria-label={`在“${module.title}”下添加分组文件夹`}
                    onClick={() => void addFolder(module.id)}
                    className="grid size-6 shrink-0 place-items-center rounded-md text-slate-400 opacity-60 hover:bg-[#B00055]/10 hover:text-[#B00055] group-hover/module:opacity-100"
                  >
                    <FolderPlus className="size-3.5" />
                  </button>
                  <button
                    className="p-1 text-slate-400"
                    onClick={() =>
                      setExpanded((items) => {
                        const next = new Set(items);
                        next.has(module.id) ? next.delete(module.id) : next.add(module.id);
                        return next;
                      })
                    }
                  >
                    {expanded.has(module.id) ? (
                      <ChevronDown className="size-3.5" />
                    ) : (
                      <ChevronRight className="size-3.5" />
                    )}
                  </button>
                  <button
                    onClick={() => selectScope({ type: 'module', moduleId: module.id })}
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left text-xs ${scope.type === 'module' && scope.moduleId === module.id ? 'bg-[#B00055]/10 font-medium text-[#8F0046]' : 'hover:bg-slate-100'}`}
                  >
                    <Folder className="size-4 shrink-0 text-amber-500" />
                    <span className="truncate">{module.title}</span>
                  </button>
                  <button
                    title={`在“${module.title}”下添加课时文件夹`}
                    aria-label={`在“${module.title}”下添加课时文件夹`}
                    onClick={() => void addLesson(module.id)}
                    className="mr-1 grid size-6 shrink-0 place-items-center rounded-md text-slate-400 opacity-60 hover:bg-[#B00055]/10 hover:text-[#B00055] group-hover/module:opacity-100"
                  >
                    <Plus className="size-3.5" />
                  </button>
                </div>
                {expanded.has(module.id) && (
                  <div className="ml-6 border-l pl-2">
                    {module.lessons
                      .filter((lesson) => !lesson.folderId)
                      .map((lesson) => (
                        <button
                          key={lesson.id}
                          onClick={() => selectScope({ type: 'lesson', lessonId: lesson.id })}
                          className={`my-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs ${scope.type === 'lesson' && scope.lessonId === lesson.id ? 'bg-[#B00055]/10 font-medium text-[#8F0046]' : 'text-slate-600 hover:bg-slate-100'}`}
                        >
                          <Presentation className="size-3.5 shrink-0" />
                          <span className="truncate">{lesson.title}</span>
                        </button>
                      ))}
                    {(module.folders ?? [])
                      .sort((a, b) => a.order - b.order)
                      .map((folder) => (
                        <div key={folder.id}>
                          <div className="group/folder flex items-center">
                            <button
                              className="p-1 text-slate-400"
                              onClick={() =>
                                setExpandedFolders((items) => {
                                  const next = new Set(items);
                                  next.has(folder.id)
                                    ? next.delete(folder.id)
                                    : next.add(folder.id);
                                  return next;
                                })
                              }
                            >
                              {expandedFolders.has(folder.id) ? (
                                <ChevronDown className="size-3" />
                              ) : (
                                <ChevronRight className="size-3" />
                              )}
                            </button>
                            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-2 text-xs font-medium text-slate-700">
                              <Folder className="size-3.5 shrink-0 text-[#B00055]" />
                              <span className="truncate">{folder.title}</span>
                            </div>
                            <button
                              title={`在“${folder.title}”下添加课时`}
                              aria-label={`在“${folder.title}”下添加课时`}
                              onClick={() => void addLesson(module.id, folder.id)}
                              className="mr-1 grid size-6 shrink-0 place-items-center rounded-md text-slate-400 opacity-60 hover:bg-[#B00055]/10 hover:text-[#B00055] group-hover/folder:opacity-100"
                            >
                              <Plus className="size-3.5" />
                            </button>
                          </div>
                          {expandedFolders.has(folder.id) && (
                            <div className="ml-5 border-l pl-2">
                              {module.lessons
                                .filter((lesson) => lesson.folderId === folder.id)
                                .sort((a, b) => a.order - b.order)
                                .map((lesson) => (
                                  <button
                                    key={lesson.id}
                                    onClick={() =>
                                      selectScope({ type: 'lesson', lessonId: lesson.id })
                                    }
                                    className={`my-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs ${scope.type === 'lesson' && scope.lessonId === lesson.id ? 'bg-[#B00055]/10 font-medium text-[#8F0046]' : 'text-slate-600 hover:bg-slate-100'}`}
                                  >
                                    <Presentation className="size-3.5 shrink-0" />
                                    <span className="truncate">{lesson.title}</span>
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </aside>
        <section className="flex min-h-0 min-w-0 flex-col bg-[#f5f6f8]">
          <div className="flex h-11 shrink-0 items-center justify-between border-b bg-white px-4">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-slate-700">
                {selectedFile?.title || '课程文件'}
              </p>
            </div>
            {selectedFile?.artifact?.classroomUrl && (
              <Button size="sm" variant="outline" asChild>
                <a href={selectedFile.artifact.classroomUrl} target="_blank" rel="noreferrer">
                  全屏打开
                  <ExternalLink className="ml-1 size-3.5" />
                </a>
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1 p-2">
            {selectedFile?.artifact?.classroomUrl ? (
              <iframe
                title={selectedFile.title}
                src={`${selectedFile.artifact.classroomUrl}?embedded=course-workspace`}
                className="h-full w-full rounded-xl border bg-white shadow-sm"
              />
            ) : selectedFile?.artifact ? (
              <iframe
                title={selectedFile.title}
                srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px/1.75 system-ui;color:#172033;max-width:960px;margin:0 auto;padding:42px}h1,h2,h3{color:#101828}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px}</style></head><body>${selectedFile.artifact.htmlContent || `<h1>${selectedFile.artifact.title}</h1><pre>${selectedFile.artifact.content}</pre>`}</body></html>`}
                className="h-full w-full rounded-xl border bg-white shadow-sm"
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed bg-white text-sm text-slate-400">
                <Presentation className="mb-3 size-9 opacity-40" />
                <p>当前范围还没有课件</p>
                <p className="mt-1 text-xs">可通过课程操作入口启动标准课件生成流程</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
