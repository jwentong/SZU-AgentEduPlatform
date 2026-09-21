'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  BookOpen,
  Bot,
  ExternalLink,
  Sparkles,
  Upload,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CourseModule, CourseStudentLearningState } from '@/lib/course-space/types';

type ClassResource = {
  id: string;
  title: string;
  origin: 'teacher' | 'agent';
  kind: 'material' | 'artifact';
  type?: string;
  status: string;
  url: string;
  activatedAt?: number;
};

type Detail = {
  course: {
    id: string;
    title: string;
    subject?: string;
    gradeBand?: string;
    term?: string;
    description?: string;
    modules: CourseModule[];
  };
  resources: ClassResource[];
  students: CourseStudentLearningState[];
};

const statusLabel: Record<CourseStudentLearningState['status'], string> = {
  'not-started': '未开始',
  learning: '学习中',
  completed: '已完成',
  'needs-attention': '需要关注',
};

export default function ClassDetailPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<Detail>();
  const [error, setError] = useState('');

  useEffect(() => {
    void fetch(`/api/classes/${courseId}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '读取班级失败');
        setDetail(data);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [courseId]);

  if (!detail) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-500">
        {error || '正在读取班级…'}
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => router.push('/classes')}>
              <ArrowLeft className="size-5" />
            </Button>
            <div>
              <h1 className="text-xl font-semibold">{detail.course.title}</h1>
              <p className="text-xs text-slate-500">
                {detail.course.subject || '课程'} · {detail.course.term || '当前学期'} · 授课中
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => router.push(`/course-space?workspace=${detail.course.id}`)}
          >
            返回教师工作台
          </Button>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-6 py-8 lg:grid-cols-[1.15fr_.85fr]">
        <section className="space-y-6">
          <div className="rounded-3xl bg-gradient-to-br from-[#B00055] to-[#78113f] p-7 text-white shadow-xl">
            <p className="text-xs font-medium tracking-widest text-white/60">CLASS OVERVIEW</p>
            <h2 className="mt-3 text-3xl font-semibold">{detail.course.title}</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75">
              {detail.course.description || '本区域汇集教师已经面向班级激活的课程资料与教学产物。'}
            </p>
            <div className="mt-6 flex gap-3 text-xs">
              <span className="rounded-full bg-white/12 px-3 py-1.5">
                {detail.course.modules.length} 个模块
              </span>
              <span className="rounded-full bg-white/12 px-3 py-1.5">
                {detail.resources.length} 项已激活资料
              </span>
            </div>
          </div>

          <div className="rounded-3xl border bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <BookOpen className="size-5 text-[#B00055]" />
              <h2 className="text-lg font-semibold">已公布课程资料</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              仅显示教师在工作台点击“激活到班级”的材料和AI产物。
            </p>
            {detail.resources.length === 0 ? (
              <div className="mt-5 rounded-2xl border border-dashed p-10 text-center text-sm text-slate-400">
                尚未激活任何班级资料。
              </div>
            ) : (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {detail.resources.map((resource) => (
                  <a
                    key={resource.id}
                    href={resource.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group rounded-2xl border p-4 transition hover:border-[#B00055]/30 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between">
                      <span
                        className={`grid size-10 place-items-center rounded-xl ${resource.origin === 'teacher' ? 'bg-blue-50 text-blue-600' : 'bg-fuchsia-50 text-fuchsia-600'}`}
                      >
                        {resource.origin === 'teacher' ? (
                          <Upload className="size-5" />
                        ) : (
                          <Sparkles className="size-5" />
                        )}
                      </span>
                      <ExternalLink className="size-4 text-slate-300 group-hover:text-[#B00055]" />
                    </div>
                    <h3 className="mt-3 line-clamp-2 font-medium">{resource.title}</h3>
                    <div className="mt-3 flex items-center gap-2 text-[11px]">
                      <span className="rounded-full bg-slate-100 px-2 py-1">
                        {resource.origin === 'teacher' ? '教师上传' : 'AI生成'}
                      </span>
                      <span className="text-slate-400">
                        {resource.kind === 'material' ? '原始材料' : '教学产物'}
                      </span>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-3xl border bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="size-5 text-[#B00055]" />
              <h2 className="text-lg font-semibold">学生与学习状态</h2>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
              {detail.students.length} 人
            </span>
          </div>
          {detail.students.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed p-10 text-center">
              <Bot className="mx-auto size-10 text-slate-300" />
              <h3 className="mt-3 font-medium">尚未同步学生名单</h3>
              <p className="mt-2 text-xs leading-5 text-slate-400">
                接入底座的班级与学生账号后，姓名、学习进度和最近活动会显示在这里。
              </p>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {detail.students.map((student) => (
                <div key={student.studentId} className="rounded-2xl border p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{student.name}</p>
                      <p className="text-[11px] text-slate-400">
                        {student.studentNumber || student.studentId} ·{' '}
                        {student.className || '当前班级'}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] ${student.status === 'needs-attention' ? 'bg-red-50 text-red-600' : student.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}
                    >
                      {statusLabel[student.status]}
                    </span>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-[#B00055]"
                        style={{ width: `${Math.min(100, Math.max(0, student.progress))}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium tabular-nums">{student.progress}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
