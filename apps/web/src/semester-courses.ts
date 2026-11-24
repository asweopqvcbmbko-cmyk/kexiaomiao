export function courseNameKey(name: string) {
  return String(name || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase()
}

export function semesterCourseScope(table: { term?: string; courses?: { name: string }[] } | null) {
  const names = [...new Set((table?.courses || []).map((course) => courseNameKey(course.name)).filter(Boolean))].sort()
  return { names, key: names.length ? JSON.stringify([table?.term || '', names]) : '' }
}
