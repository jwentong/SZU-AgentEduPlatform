import { NextRequest, NextResponse } from 'next/server';
import { runTeacherWorkspaceAgent } from '@/lib/server/teacher-workspace-agent';
import { planTeacherWorkspaceOperation, type TeacherOperationPlan } from '@/lib/course-space/teacher-agent-intent';
import { readServerCourse } from '@/lib/server/course-space-storage';
import { executeReadOnlyTeacherPlan } from '@/lib/server/teacher-course-operations';
import {
  getCourseSpaceStorageAdapter,
  type TeacherAgentTurnLease,
} from '@/lib/server/course-space-storage-adapter';

export const runtime = 'nodejs';
export const maxDuration = 180;

const storage = getCourseSpaceStorageAdapter();

export async function GET(request: NextRequest, context: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await context.params;
  const sessionId = request.nextUrl.searchParams.get('sessionId')?.trim();
  if (!sessionId) return NextResponse.json({ success: false, error: '缺少 sessionId' }, { status: 400 });
  const session = await storage.getTeacherSession(sessionId);
  if (!session) return NextResponse.json({ success: true, session: null, events: [], messages: [] });
  if (session.stageId !== courseId) {
    return NextResponse.json({ success: false, error: '会话不属于当前课程' }, { status: 403 });
  }
  const events = await storage.readTeacherEvents(sessionId);
  const messages: Array<{ role: 'user' | 'assistant'; content: string; eventId: number; plan?: TeacherOperationPlan }> = [];
  for (const event of events) {
    const data = event.data && typeof event.data === 'object'
      ? event.data as Record<string, unknown>
      : {};
    if (event.type === 'user_message' && typeof data.text === 'string') {
      messages.push({ role: 'user', content: data.text, eventId: event.id });
    }
    if (event.type === 'message_end' && typeof data.text === 'string') {
      messages.push({ role: 'assistant', content: data.text, eventId: event.id, plan: data.plan as TeacherOperationPlan | undefined });
    }
  }
  return NextResponse.json({ success: true, session, events, messages });
}

export async function POST(request: NextRequest, context: { params: Promise<{ courseId: string }> }) {
  let lease: TeacherAgentTurnLease | undefined;
  try {
    const { courseId } = await context.params;
    const body = await request.json() as { sessionId?: string; message?: string; history?: Array<{ role: 'user'|'assistant'; content: string }> };
    if (!body.message?.trim()) return NextResponse.json({ success: false, error: '请输入问题' }, { status: 400 });
    const course = await readServerCourse(courseId);
    if (!course) return NextResponse.json({ success: false, error: '课程不存在' }, { status: 404 });
    const sessionId = body.sessionId || `teacher-${courseId}-default`;
    lease = await storage.beginTeacherTurn({
      sessionId,
      teacherId: course.teacherId,
      courseId,
      message: body.message.trim(),
    });
    let plan = planTeacherWorkspaceOperation(body.message, course);
    if (plan) {
      if (!plan.requiresConfirmation) plan = await executeReadOnlyTeacherPlan(courseId, plan);
      const text = plan.requiresConfirmation ? '已形成结构化操作计划，请确认后执行。' : (plan.result || '课程操作检查已完成。');
      await storage.completeTeacherTurn(lease, { text, mode: 'course-operator', plan });
      return NextResponse.json({
        success: true,
        mode: 'course-operator',
        plan,
        text,
      });
    }
    const result = await runTeacherWorkspaceAgent({ courseId, sessionId, message: body.message.trim(), history: body.history });
    await storage.completeTeacherTurn(lease, result);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    await storage.failTeacherTurn(lease, error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
