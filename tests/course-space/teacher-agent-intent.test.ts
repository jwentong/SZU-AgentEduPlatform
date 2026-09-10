import { describe, expect, it } from 'vitest';
import { detectTeacherWorkspaceAction, planTeacherWorkspaceOperation } from '@/lib/course-space/teacher-agent-intent';
import type { CourseSpace } from '@/lib/course-space';

const course = {
  id: 'course', teacherId: 'teacher', title: '测试课程', status: 'draft', materials: [], createdAt: 1, updatedAt: 1,
  modules: [
    { id: 'm1', courseId: 'course', title: '第一章', order: 0, objectives: [], createdAt: 1, updatedAt: 1, lessons: [{ id: 'l1', moduleId: 'm1', title: '第一课时', order: 0, objectives: [], materialIds: [], createdAt: 1, updatedAt: 1 }] },
    { id: 'm2', courseId: 'course', title: '第二模块', order: 1, objectives: [], createdAt: 1, updatedAt: 1, lessons: [{ id: 'l2', moduleId: 'm2', title: '第二课时', order: 0, objectives: [], materialIds: [], createdAt: 1, updatedAt: 1 }, { id: 'l3', moduleId: 'm2', title: '第三课时', order: 1, objectives: [], materialIds: [], createdAt: 1, updatedAt: 1 }] },
  ],
} satisfies CourseSpace;

describe('teacher workspace generation routing', () => {
  it.each([
    ['请生成现代交换原理这门课的大纲', 'course-outline'],
    ['帮我写一份这节课的讲稿', 'narration'],
    ['给这节课出10道习题', 'exercise-set'],
    ['我需要一份互动课件', 'lesson-courseware'],
    ['为期末考试设计评分量规', 'assessment-rubric'],
    ['准备一份PBL项目方案', 'pbl-project'],
    ['能否帮我生成这门课的教学计划？', 'module-plan'],
    ['请完善现有课程大纲', 'course-outline'],
  ])('routes %s', (message, artifactType) => {
    expect(detectTeacherWorkspaceAction(message)?.artifactType).toBe(artifactType);
  });

  it.each([
    '这门课有几个模块？',
    '分析现有教学大纲的覆盖情况',
    '如何生成一份高质量课件？',
    '检查现有习题是否覆盖全部知识点',
  ])('keeps %s in chat', (message) => {
    expect(detectTeacherWorkspaceAction(message)).toBeUndefined();
  });
});

describe('teacher course operation planning', () => {
  it('plans a read-only module exercise audit', () => {
    const plan = planTeacherWorkspaceOperation('检查第二模块是否缺少练习。', course);
    expect(plan?.kind).toBe('inspect-exercises');
    expect(plan?.requiresConfirmation).toBe(false);
  });

  it('plans lesson reordering without mutating immediately', () => {
    const plan = planTeacherWorkspaceOperation('把第三课时调整到第二课时之前。', course);
    expect(plan?.action).toMatchObject({ type: 'reorder-lesson', lessonId: 'l3', beforeLessonId: 'l2' });
    expect(plan?.requiresConfirmation).toBe(true);
  });

  it('routes a scoped diagnostic set into the artifact workflow', () => {
    const plan = planTeacherWorkspaceOperation('为第一章生成一套课前诊断题。', course);
    expect(plan?.action).toMatchObject({ type: 'generate-artifact', artifactType: 'exercise-set', scope: { type: 'module', moduleId: 'm1' } });
  });

  it('blocks student adaptation behind the analytics tool', () => {
    expect(planTeacherWorkspaceOperation('根据学生错误率修改下一节课。', course)?.kind).toBe('adapt-next-lesson');
  });

  it('plans weekly lesson folders in the courseware module', () => {
    const weeklyCourse = { ...course, modules: [{ ...course.modules[0], title: '课件生成' }, course.modules[1]] };
    const plan = planTeacherWorkspaceOperation('请为这门课生成1-17周的课件，并建立对应课时文件夹。', weeklyCourse);
    expect(plan?.action).toMatchObject({ type: 'create-lessons', moduleId: 'm1', start: 1, end: 17 });
    expect(plan?.requiresConfirmation).toBe(true);
  });

  it('plans moving all artifacts between weekly lesson folders', () => {
    const weeklyCourse = {
      ...course,
      modules: [{
        ...course.modules[0],
        lessons: [
          { ...course.modules[0].lessons[0], id: 'week-1', title: '第1周' },
          { ...course.modules[0].lessons[0], id: 'week-2', title: '第2周', order: 1 },
        ],
      }],
    } satisfies CourseSpace;
    const plan = planTeacherWorkspaceOperation('把第一周里面的内容移到第二周。', weeklyCourse);
    expect(plan?.action).toMatchObject({ type: 'move-artifacts', fromLessonId: 'week-1', toLessonId: 'week-2' });
    expect(plan?.requiresConfirmation).toBe(true);
  });

  it('protects non-empty lesson deletion unless cascading is explicit', () => {
    const safePlan = planTeacherWorkspaceOperation('删除第一课时文件夹。', course);
    const cascadePlan = planTeacherWorkspaceOperation('删除第一课时，并连同里面的内容一起删除。', course);
    expect(safePlan?.action).toMatchObject({ type: 'delete-lesson', lessonId: 'l1', cascade: false });
    expect(cascadePlan?.action).toMatchObject({ type: 'delete-lesson', lessonId: 'l1', cascade: true });
  });

  it('plans deleting one uniquely named artifact', () => {
    const plan = planTeacherWorkspaceOperation('删除文件“第一周课程导入”。', course);
    expect(plan?.action).toMatchObject({ type: 'delete-artifact', artifactTitle: '第一周课程导入' });
    expect(plan?.requiresConfirmation).toBe(true);
  });
});
