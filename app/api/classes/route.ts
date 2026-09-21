import { apiSuccess } from '@/lib/server/api-response';
import { DEFAULT_TEACHER_ID } from '@/lib/course-space/types';
import { listServerCourses } from '@/lib/server/course-space-storage';

export const dynamic = 'force-dynamic';

export async function GET() {
  const courses = (await listServerCourses(DEFAULT_TEACHER_ID))
    .filter((course) => course.status === 'active')
    .map((course) => ({
      id: course.id,
      title: course.title,
      subject: course.subject,
      gradeBand: course.gradeBand,
      term: course.term,
      description: course.description,
      moduleCount: course.modules.length,
      lessonCount: course.modules.reduce((count, item) => count + item.lessons.length, 0),
      studentCount: course.classStudents?.length ?? 0,
      updatedAt: course.updatedAt,
    }));
  return apiSuccess({ courses });
}
