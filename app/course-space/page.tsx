'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { nanoid } from 'nanoid';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CoursewareModeDialog } from '@/components/generation/courseware-mode-dialog';
import { CourseWorkspaceExplorer } from '@/components/course-space/course-workspace-explorer';
import { TeacherWorkspaceAgent } from '@/components/course-space/teacher-workspace-agent';
import { CourseCenter } from '@/components/course-space/course-center';
import type { Slide } from '@openmaic/dsl';
import type * as MaicImport from '@openmaic/importer';
import type { PptContentDraft } from '@/lib/types/generation';
import type { CoursewareConversionMode } from '@/lib/learning-skills/courseware-mode';
import { useSettingsStore } from '@/lib/store/settings';
import { useUserProfileStore } from '@/lib/store/user-profile';
import { fingerprintCoursewareFile } from '@/lib/course-governance/fingerprint';
import {
  buildFaithfulCoursewareRequirement,
  buildLearningSkillsEnhancementRequirement,
} from '@/lib/learning-skills/courseware-mode';
import {
  buildImportedPptDraft,
  removeImportedPptSlides,
  storeImportedPptSlides,
} from '@/lib/import/pptx-course';
import {
  ApiCourseSpaceRepository,
  DEFAULT_TEACHER_ID,
  type CourseArtifactJob,
  type CourseArtifactRecord,
  type CourseArtifactType,
  type CourseLesson,
  type CourseModule,
  type CourseMaterialExtraction,
  type CourseSpace,
} from '@/lib/course-space';

async function api<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { success?: boolean; error?: string };
  if (!response.ok || payload.success === false) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function buildLegacyPptDraft(extraction: CourseMaterialExtraction): PptContentDraft {
  return {
    slides: extraction.chunks.map((chunk) => {
      const lines = chunk.text.split('\n').map((line) => line.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim()).filter(Boolean);
      return {
        id: `course-material-${extraction.materialId}-${chunk.page}`,
        originalIndex: Math.max(0, chunk.page - 1),
        title: lines[0]?.slice(0, 80) || `第 ${chunk.page} 页`,
        content: lines.slice(1).join('\n'),
        speakerNotes: '',
        include: true,
        formulas: extraction.formulas.filter((formula) => formula.page === chunk.page).map((formula) => formula.latex),
        generationStrategy: extraction.formulas.some((formula) => formula.page === chunk.page)
          ? 'ai-formula-enhanced' as const
          : 'faithful' as const,
      };
    }),
    revision: 1,
    updatedAt: Date.now(),
  };
}

export default function CourseSpacePage() {
  const router = useRouter();
  const repository = useMemo(() => new ApiCourseSpaceRepository(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [courses, setCourses] = useState<CourseSpace[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [jobs, setJobs] = useState<CourseArtifactJob[]>([]);
  const [artifacts, setArtifacts] = useState<CourseArtifactRecord[]>([]);
  const [newCourseTitle, setNewCourseTitle] = useState('');
  const [newModuleTitle, setNewModuleTitle] = useState('');
  const [newLessonTitle, setNewLessonTitle] = useState('');
  const [lessonModuleId, setLessonModuleId] = useState('');
  const [generationScope, setGenerationScope] = useState('course');
  const [message, setMessage] = useState('');
  const [coursewareModeOpen, setCoursewareModeOpen] = useState(false);
  const [coursewareMaterialId, setCoursewareMaterialId] = useState('');
  const [launchingCourseware, setLaunchingCourseware] = useState(false);
  const [workspaceCourseId, setWorkspaceCourseId] = useState<string | null | undefined>();
  const selected = courses.find((course) => course.id === selectedId);

  const refresh = useCallback(async (preferredId?: string) => {
    const items = await repository.listByTeacher(DEFAULT_TEACHER_ID);
    const id = preferredId ?? selectedId ?? items[0]?.id;
    setCourses(items);
    setSelectedId(id);
    if (id) {
      const detail = await api<{ course: CourseSpace; jobs: CourseArtifactJob[]; artifacts: CourseArtifactRecord[] }>(
        await fetch(`/api/course-space/${id}`, { cache: 'no-store' }),
      );
      setCourses((current) => current.map((item) => item.id === id ? detail.course : item));
      setJobs(detail.jobs);
      setArtifacts(detail.artifacts);
    }
  }, [repository, selectedId]);

  useEffect(() => {
    const requestedCourseId = new URLSearchParams(window.location.search).get('workspace');
    setWorkspaceCourseId(requestedCourseId);
    if (!requestedCourseId) return;
    const timer = window.setTimeout(() => void refresh(requestedCourseId), 0);
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const active = selected?.materials.some((item) => item.status === 'parsing') || jobs.some((job) => ['queued', 'running'].includes(job.status));
    if (!selected || !active) return;
    const timer = window.setInterval(() => void refresh(selected.id), 2500);
    return () => window.clearInterval(timer);
  }, [jobs, refresh, selected]);

  const createCourse = async () => {
    if (!newCourseTitle.trim()) return;
    const course = await repository.create({ teacherId: DEFAULT_TEACHER_ID, title: newCourseTitle });
    setNewCourseTitle('');
    setWorkspaceCourseId(course.id);
    window.history.replaceState(null, '', `/course-space?workspace=${course.id}`);
    await refresh(course.id);
  };

  const saveStructure = async (course: CourseSpace) => {
    await repository.save(course);
    await refresh(course.id);
  };

  const addModule = async () => {
    if (!selected || !newModuleTitle.trim()) return;
    const now = Date.now();
    const courseModule: CourseModule = {
      id: nanoid(10), courseId: selected.id, title: newModuleTitle.trim(), order: selected.modules.length + 1,
      objectives: [], lessons: [], createdAt: now, updatedAt: now,
    };
    setNewModuleTitle('');
    await saveStructure({ ...selected, modules: [...selected.modules, courseModule], updatedAt: now });
  };

  const addLesson = async () => {
    if (!selected || !lessonModuleId || !newLessonTitle.trim()) return;
    const now = Date.now();
    const target = selected.modules.find((item) => item.id === lessonModuleId);
    if (!target) return;
    const lesson: CourseLesson = {
      id: nanoid(10), moduleId: target.id, title: newLessonTitle.trim(), order: target.lessons.length + 1,
      objectives: [], materialIds: [], createdAt: now, updatedAt: now,
    };
    setNewLessonTitle('');
    await saveStructure({
      ...selected,
      modules: selected.modules.map((item) => item.id === target.id ? { ...item, lessons: [...item.lessons, lesson], updatedAt: now } : item),
      updatedAt: now,
    });
  };

  const uploadMaterials = async (files: File[]) => {
    if (!selected) return;
    try {
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        await api(await fetch(`/api/course-space/${selected.id}/materials`, { method: 'POST', body: form }));
      }
      setMessage('材料已保存到课程空间。不会自动解析或生成，请由教师继续操作。');
      await refresh(selected.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  const parseMaterial = async (materialId: string) => {
    if (!selected) return;
    try {
      await api(await fetch(`/api/course-space/${selected.id}/materials/${materialId}/parse`, { method: 'POST' }));
      setMessage('材料解析任务已启动，页码、公式和来源指纹将写入课程知识底座。');
      await refresh(selected.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  const resolveGenerationScope = (): CourseArtifactJob['scope'] => generationScope === 'course'
    ? { type: 'course' }
    : generationScope.startsWith('module:')
      ? { type: 'module', moduleId: generationScope.slice(7) }
      : { type: 'lesson', lessonId: generationScope.slice(7) };

  const coursewareMaterials = selected?.materials.filter((item) =>
    item.status === 'ready' && /\.pptx?$/i.test(item.name),
  ) ?? [];
  const selectedCoursewareMaterial = coursewareMaterials.find((item) => item.id === coursewareMaterialId)
    ?? coursewareMaterials[0];
  const latestJob = [...jobs].sort((a, b) => b.createdAt - a.createdAt)[0];

  const scopeTitle = () => {
    if (!selected) return '课程课件';
    const scope = resolveGenerationScope();
    if (scope.type === 'course') return selected.title;
    if (scope.type === 'module') return selected.modules.find((item) => item.id === scope.moduleId)?.title || selected.title;
    for (const courseModule of selected.modules) {
      const lesson = courseModule.lessons.find((item) => item.id === scope.lessonId);
      if (lesson) return `${courseModule.title} / ${lesson.title}`;
    }
    return selected.title;
  };

  const launchCoursewareFlow = async (mode: CoursewareConversionMode) => {
    if (!selected || !selectedCoursewareMaterial) return;
    if (mode === 'faithful' && !selectedCoursewareMaterial.name.toLowerCase().endsWith('.pptx')) {
      setMessage('旧版 .ppt 无法保留可编辑视觉画布，请上传 .pptx，或选择 AI 增强课件。');
      return;
    }
    setCoursewareModeOpen(false);
    setLaunchingCourseware(true);
    let importStorageKey: string | undefined;
    try {
      const materialResponse = await fetch(`/api/course-space/${selected.id}/materials/${selectedCoursewareMaterial.id}`, { cache: 'no-store' });
      if (!materialResponse.ok) throw new Error('读取课程原始材料失败');
      const file = new File([await materialResponse.blob()], selectedCoursewareMaterial.name, {
        type: selectedCoursewareMaterial.mimeType,
        lastModified: selectedCoursewareMaterial.updatedAt,
      });
      let draft: PptContentDraft;
      let sourceFingerprint;
      if (file.name.toLowerCase().endsWith('.pptx')) {
        const parserUrl = '/vendor/maic-importer/index.js';
        const parserProbe = await fetch(parserUrl, { method: 'HEAD' });
        if (!parserProbe.ok) throw new Error('PPTX 解析器尚未部署');
        const importer = (await import(
          /* webpackIgnore: true */
          /* turbopackIgnore: true */
          /* @vite-ignore */
          parserUrl
        )) as typeof MaicImport;
        const slides = (await importer.importPptx(file)) as Slide[];
        if (slides.length === 0) throw new Error('PPTX 中没有可用页面');
        sourceFingerprint = await fingerprintCoursewareFile(file, slides.length);
        draft = buildImportedPptDraft(slides);
        // Match the quick-generation workflow: retain the visual canvas for
        // both routes. AI enhancement still redraws when the model succeeds;
        // this canvas prevents a text-only degradation when it does not.
        importStorageKey = `course-space-pptx-${nanoid()}`;
        await storeImportedPptSlides(importStorageKey, slides, sourceFingerprint);
      } else {
        const extraction = (await api<{ extraction: CourseMaterialExtraction }>(await fetch(
          `/api/course-space/${selected.id}/materials/${selectedCoursewareMaterial.id}/extraction`,
          { cache: 'no-store' },
        ))).extraction;
        draft = buildLegacyPptDraft(extraction);
        sourceFingerprint = {
          algorithm: 'SHA-256' as const,
          sha256: selectedCoursewareMaterial.sha256 || extraction.sourceSha256,
          fileName: selectedCoursewareMaterial.name,
          mimeType: selectedCoursewareMaterial.mimeType,
          byteLength: selectedCoursewareMaterial.size,
          lastModified: selectedCoursewareMaterial.updatedAt,
          pageCount: extraction.pageCount,
          importedAt: Date.now(),
        };
      }

      const settings = useSettingsStore.getState();
      settings.setTTSEnabled(true);
      settings.setTTSProvider('qwen-tts');
      const profile = useUserProfileStore.getState();
      const target = scopeTitle();
      const requirement = mode === 'faithful'
        ? `${buildFaithfulCoursewareRequirement('pptx', draft.slides.length)}\n\n课程空间范围：${target}`
        : buildLearningSkillsEnhancementRequirement(`围绕“${target}”生成课时 PPT 或互动课件。`, 'pptx');
      sessionStorage.setItem('generationSession', JSON.stringify({
        sessionId: nanoid(),
        requirements: {
          requirement,
          userNickname: profile.nickname || undefined,
          userBio: profile.bio || undefined,
          webSearch: false,
          interactiveMode: false,
        },
        pdfText: '', pdfImages: [], imageStorageIds: [], sceneOutlines: undefined,
        pptContentDraft: draft, currentStep: 'generating', previewPhase: 'ppt-review',
        sourceType: mode === 'faithful' ? 'pptx-faithful' : 'learning-skills-enhanced',
        conversionMode: mode, pptxImportStorageKey: importStorageKey, sourceFingerprint,
        courseSpaceContext: {
          courseId: selected.id,
          materialId: selectedCoursewareMaterial.id,
          scope: resolveGenerationScope(),
        },
      }));
      router.push('/generation-preview');
    } catch (error) {
      await removeImportedPptSlides(importStorageKey).catch(() => undefined);
      setMessage(error instanceof Error ? error.message : String(error));
      setLaunchingCourseware(false);
    }
  };

  const requestGeneration = async (requestedType: CourseArtifactType, requestedScope?: CourseArtifactJob['scope']) => {
    const artifactTypes = [requestedType];
    if (!selected) return;
    const scope = requestedScope ?? resolveGenerationScope();
    if (requestedScope) setGenerationScope(requestedScope.type === 'course' ? 'course' : requestedScope.type === 'module' ? `module:${requestedScope.moduleId}` : `lesson:${requestedScope.lessonId}`);
    const includesCourseware = artifactTypes.includes('lesson-courseware');
    const backgroundArtifacts = artifactTypes.filter((type) => type !== 'lesson-courseware');
    try {
      let jobCount = 0;
      let createdJob: CourseArtifactJob | undefined;
      if (backgroundArtifacts.length > 0) {
        const result = await api<{ jobs: CourseArtifactJob[] }>(await fetch(`/api/course-space/${selected.id}/jobs`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scope, artifactTypes: backgroundArtifacts }),
        }));
        jobCount = result.jobs.length;
        createdJob = result.jobs[0];
        await refresh(selected.id);
      }
      if (includesCourseware) {
        if (!selectedCoursewareMaterial) throw new Error('请先上传并解析一份 PPT 或 PPTX 课程材料');
        setCoursewareMaterialId(selectedCoursewareMaterial.id);
        setCoursewareModeOpen(true);
        setMessage(jobCount ? `已创建 ${jobCount} 个资料类任务；请继续选择课件转换路径。` : '请选择高保真还原或 AI 增强课件。');
      } else {
        setMessage(`已创建 ${jobCount} 个后台任务。生成结果必须经过教师审核后才能发布。`);
        if (createdJob) router.push(`/course-space/${selected.id}/jobs/${createdJob.id}`);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  if (workspaceCourseId === undefined) return <main className="flex min-h-screen items-center justify-center bg-slate-50 text-muted-foreground">正在打开课程中心…</main>;
  if (workspaceCourseId === null) return <CourseCenter/>;

  return <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_28%_8%,rgba(59,130,246,0.10),transparent_28%),radial-gradient(circle_at_72%_88%,rgba(176,0,85,0.08),transparent_30%),linear-gradient(to_bottom,#f8fafc,#f3f6fa)] text-slate-900">
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/70 bg-white/75 px-6 py-3 backdrop-blur-xl">
      <div className="flex items-center gap-3"><Button variant="ghost" size="icon" className="rounded-full" onClick={() => router.push(`/course-space/${selected?.id || workspaceCourseId}`)}><ArrowLeft /></Button><img src="/mentra-icon.svg" alt="MENTRA" className="size-9"/><div className="h-7 w-px bg-slate-200"/><div><h1 className="text-lg font-semibold">教师课程工作区</h1><p className="text-xs text-muted-foreground">课程结构、智能体协作与历史教学产物</p></div></div>
      <div className="flex items-center gap-3"><Button variant="outline" className="rounded-full bg-white/70" onClick={() => router.push('/')}>快速生成课件</Button><div className="rounded-full border bg-white/70 px-3 py-1.5 text-xs text-muted-foreground">默认教师</div></div>
    </header>
    <div className="p-4">{selected && <div className="mx-auto max-w-[1760px] space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1"><div><h2 className="text-xl font-semibold">{selected.title}</h2><p className="text-xs text-muted-foreground">按课程—模块—课时浏览课件、知识点与教学文件</p></div><div className="flex items-center gap-2 text-xs"><span className="rounded-full border bg-white px-3 py-1.5">{selected.modules.length} 模块</span><span className="rounded-full border bg-white px-3 py-1.5">{artifacts.length} 产物</span>{latestJob && <Button variant="outline" size="sm" onClick={() => router.push(`/course-space/${selected.id}/jobs/${latestJob.id}`)}>最近任务</Button>}</div></div>
      <CourseWorkspaceExplorer course={selected} artifacts={artifacts} onGenerate={(type, scope) => void requestGeneration(type, scope)} onCourseChange={saveStructure} onRefresh={() => refresh(selected.id)}/>
      <section className="rounded-[26px] border border-white/80 bg-white/75 p-3 shadow-sm backdrop-blur-xl"><TeacherWorkspaceAgent course={selected} onGenerate={(type, scope) => void requestGeneration(type, scope)} onOperationComplete={() => refresh(selected.id)}/></section>
      {message && <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{message}</div>}
    </div>}</div>
    <CoursewareModeDialog
      open={coursewareModeOpen}
      onOpenChange={setCoursewareModeOpen}
      onSelect={(mode) => void launchCoursewareFlow(mode)}
      sourceLabel="PPT / PPTX"
      faithfulDisabledReason={selectedCoursewareMaterial?.name.toLowerCase().endsWith('.ppt')
        ? '旧版 .ppt 不包含可直接复用的 OOXML 视觉画布；请上传 .pptx，或选择 AI 增强。'
        : undefined}
    />
  </main>;
}
