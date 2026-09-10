'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bot, CheckCircle2, Circle, ImagePlus, LoaderCircle, Play, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CourseArtifactJob, CourseArtifactType, CourseSpace } from '@/lib/course-space';
import type { TeacherOperationPlan } from '@/lib/course-space/teacher-agent-intent';

type Message = { role: 'user' | 'assistant'; content: string; plan?: TeacherOperationPlan };
type ScreenshotAttachment = { name: string; mimeType: string; dataUrl: string };

const actions: Array<{ type: CourseArtifactType; label: string }> = [
  { type: 'course-outline', label: '教学大纲' },
  { type: 'module-plan', label: '教学计划' },
  { type: 'lesson-courseware', label: '课件' },
  { type: 'narration', label: '讲稿' },
  { type: 'exercise-set', label: '习题' },
  { type: 'assessment-rubric', label: '评分量规' },
];

export function TeacherWorkspaceAgent({
  course,
  onGenerate,
  onOperationComplete,
}: {
  course: CourseSpace;
  onGenerate: (type: CourseArtifactType, scope?: CourseArtifactJob['scope']) => void;
  onOperationComplete?: () => void | Promise<void>;
}) {
  const sessionId = useMemo(() => `teacher-${course.id}-default`, [course.id]);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: `你好，我是“${course.title}”的课程操作智能体。课程材料、结构、知识图谱与中间产物已作为插件接入。我可以按你的要求启动教学大纲、教学计划、课件、讲稿、习题和评分量规工作，也可以创建、移动或删除课程文件。生成任务会直接进入标准生成—审核—可视化流程；结构变更与删除操作会先提交计划供你确认。`,
    },
  ]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ScreenshotAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('DeepSeek Harness');
  const addImageFiles = (incoming: File[]) => {
    const files = incoming
      .filter(
        (file) =>
          ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) &&
          file.size <= 5 * 1024 * 1024,
      )
      .slice(0, Math.max(0, 3 - attachments.length));
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        if (typeof dataUrl !== 'string') return;
        setAttachments((items) =>
          [
            ...items,
            {
              name: file.name || `粘贴截图-${Date.now()}.png`,
              mimeType: file.type,
              dataUrl,
            },
          ].slice(0, 3),
        );
      };
      reader.readAsDataURL(file);
    }
  };
  useEffect(() => {
    let active = true;
    void fetch(`/api/course-space/${course.id}/agent?sessionId=${encodeURIComponent(sessionId)}`, {
      cache: 'no-store',
    })
      .then((response) => response.json())
      .then((data: { messages?: Message[] }) => {
        if (active && data.messages?.length) setMessages(data.messages);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [course.id, sessionId]);
  const send = async (preset?: string) => {
    const content = (preset ?? input).trim();
    if (!content || loading) return;
    const next = [...messages, { role: 'user' as const, content }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const response = await fetch(`/api/course-space/${course.id}/agent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, message: content, history: messages, attachments }),
      });
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error(data.error || '智能体响应失败');
      let responseText = data.text;
      let responsePlan = data.plan as TeacherOperationPlan | undefined;
      if (
        responsePlan?.action &&
        responsePlan.status === 'planned' &&
        !responsePlan.requiresConfirmation
      ) {
        const operationResponse = await fetch(`/api/course-space/${course.id}/agent/operations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ plan: responsePlan }),
        });
        const operation = await operationResponse.json();
        if (!operationResponse.ok || operation.success === false)
          throw new Error(operation.error || '启动标准生成工作流失败');
        responsePlan = operation.plan;
        responseText =
          operation.plan.result ||
          (operation.dispatch === 'artifact-workflow'
            ? '已根据教师指令启动标准生成工作流。生成结果将进入审核与可视化页面。'
            : '已根据教师指令完成课程操作。');
        if (
          operation.dispatch === 'artifact-workflow' &&
          operation.plan.action?.type === 'generate-artifact'
        )
          onGenerate(operation.plan.action.artifactType, operation.plan.action.scope);
        else await onOperationComplete?.();
      }
      setMessages([...next, { role: 'assistant', content: responseText, plan: responsePlan }]);
      setAttachments([]);
      setMode(
        data.mode === 'course-operator'
          ? '课程操作智能体'
          : data.mode === 'deepseek-harness'
            ? 'DeepSeek Harness'
            : 'DeepSeek 兼容模式',
      );
    } catch (error) {
      setMessages([
        ...next,
        {
          role: 'assistant',
          content: `暂时无法完成：${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };
  const executePlan = async (messageIndex: number, plan: TeacherOperationPlan) => {
    if (loading) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/course-space/${course.id}/agent/operations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error(data.error || '执行课程操作失败');
      setMessages((items) =>
        items.map((item, index) =>
          index === messageIndex
            ? {
                ...item,
                content:
                  data.plan.result ||
                  (data.dispatch === 'artifact-workflow'
                    ? '计划已确认，正在进入标准生成工作流。'
                    : '操作已完成。'),
                plan: data.plan,
              }
            : item,
        ),
      );
      if (data.dispatch === 'artifact-workflow' && data.plan.action?.type === 'generate-artifact')
        onGenerate(data.plan.action.artifactType, data.plan.action.scope);
      else await onOperationComplete?.();
    } catch (error) {
      setMessages((items) => [
        ...items,
        {
          role: 'assistant',
          content: `操作执行失败：${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="flex h-full min-h-[600px] flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-slate-100 bg-white/80 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-gradient-to-br from-[#B00055]/15 to-[#B00055]/5 p-2.5 text-[#B00055]">
            <Bot className="size-5" />
          </div>
          <div>
            <h3 className="font-semibold">备课工作智能体</h3>
            <p className="text-xs text-muted-foreground">
              DeepSeek Harness · 课程材料、结构、知识图谱与产物已连接
            </p>
          </div>
        </div>
        <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-700">
          {mode}
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(176,0,85,0.06),transparent_38%),#fbfcfe] p-5">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`max-w-[86%] ${message.role === 'user' ? '' : 'space-y-2'}`}>
              <div
                className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? 'rounded-br-md bg-[#B00055] text-white shadow-sm' : 'rounded-bl-md border border-slate-200 bg-white text-slate-700 shadow-sm'}`}
              >
                {message.content}
              </div>
              {message.plan && (
                <div className="rounded-2xl border border-[#B00055]/15 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">{message.plan.title}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        {message.plan.summary}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-[#B00055]/8 px-2 py-1 text-[10px] text-[#B00055]">
                      {message.plan.status === 'planned'
                        ? '待执行'
                        : message.plan.status === 'completed'
                          ? '已完成'
                          : '已暂停'}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {message.plan.steps.map((step) => (
                      <div key={step.id} className="flex items-center gap-2 text-xs text-slate-600">
                        {step.status === 'completed' ? (
                          <CheckCircle2 className="size-4 text-emerald-500" />
                        ) : (
                          <Circle
                            className={`size-4 ${step.status === 'blocked' ? 'text-amber-500' : 'text-slate-300'}`}
                          />
                        )}
                        <span>{step.label}</span>
                        <code className="ml-auto text-[10px] text-slate-400">{step.tool}</code>
                      </div>
                    ))}
                  </div>
                  {message.plan.result && (
                    <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-700">
                      {message.plan.result}
                    </p>
                  )}
                  {message.plan.requiresConfirmation && message.plan.status === 'planned' && (
                    <Button
                      size="sm"
                      variant={
                        message.plan.action?.type.startsWith('delete') ? 'destructive' : 'default'
                      }
                      className="mt-3 rounded-full"
                      onClick={() => void executePlan(index, message.plan!)}
                    >
                      <Play className="mr-1 size-3.5" />
                      {message.plan.action?.type.startsWith('delete') ? '确认删除' : '确认执行'}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            正在形成操作计划或调用课程工具…
          </div>
        )}
      </div>
      <div className="border-t border-slate-100 bg-white/90 p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          {actions.map((item) => (
            <button
              key={item.type}
              onClick={() => onGenerate(item.type)}
              className="rounded-full border border-[#B00055]/20 bg-[#B00055]/5 px-3 py-1.5 text-xs text-[#B00055] hover:bg-[#B00055]/10"
            >
              {item.label}
            </button>
          ))}
        </div>
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((attachment, index) => (
              <div
                key={`${attachment.name}-${index}`}
                className="relative overflow-hidden rounded-xl border border-[#B00055]/15 bg-white p-1 shadow-sm"
              >
                <img
                  src={attachment.dataUrl}
                  alt={attachment.name}
                  className="h-16 w-24 rounded-lg object-cover"
                />
                <button
                  type="button"
                  aria-label={`移除截图 ${attachment.name}`}
                  onClick={() =>
                    setAttachments((items) => items.filter((_, itemIndex) => itemIndex !== index))
                  }
                  className="absolute right-1 top-1 rounded-full bg-slate-900/70 p-1 text-white"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-2xl border bg-slate-50/80 p-2 focus-within:border-[#B00055]/30 focus-within:ring-2 focus-within:ring-[#B00055]/10">
          <label
            className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-xl text-slate-500 hover:bg-white hover:text-[#B00055]"
            title="上传截图"
          >
            <ImagePlus className="size-4" />
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="sr-only"
              onChange={(event) => {
                addImageFiles(Array.from(event.target.files ?? []));
                event.target.value = '';
              }}
            />
          </label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(event) => {
              const images = Array.from(event.clipboardData.items)
                .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
                .map((item) => item.getAsFile())
                .filter((file): file is File => Boolean(file));
              if (!images.length) return;
              event.preventDefault();
              addImageFiles(images);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            className="min-h-16 flex-1 resize-none bg-transparent px-2 py-1 text-sm outline-none"
            placeholder="例如：把第一周内容移到第二周、删除空课时文件夹，或生成本周课件…"
          />
          <Button
            size="icon"
            className="size-10 shrink-0 rounded-xl"
            disabled={loading || !input.trim()}
            onClick={() => void send()}
          >
            <Send className="size-4" />
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          可上传或 Ctrl+V 粘贴截图 · 最多 3 张 PNG/JPEG/WebP（单张 5MB） · Enter 发送
        </p>
      </div>
    </div>
  );
}
