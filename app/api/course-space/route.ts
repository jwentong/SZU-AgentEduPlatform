import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createServerCourse, listServerCourses } from '@/lib/server/course-space-storage';
import { DEFAULT_TEACHER_ID, type CreateCourseSpaceInput } from '@/lib/course-space/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const teacherId = req.nextUrl.searchParams.get('teacherId') || DEFAULT_TEACHER_ID;
  return apiSuccess({ courses: await listServerCourses(teacherId) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<CreateCourseSpaceInput>;
  if (!body.title?.trim()) return apiError('MISSING_REQUIRED_FIELD', 400, '课程名称不能为空');
  const course = await createServerCourse({
    teacherId: body.teacherId || DEFAULT_TEACHER_ID,
    title: body.title,
    subject: body.subject,
    gradeBand: body.gradeBand,
    term: body.term,
    description: body.description,
  });
  return apiSuccess({ course }, 201);
}
