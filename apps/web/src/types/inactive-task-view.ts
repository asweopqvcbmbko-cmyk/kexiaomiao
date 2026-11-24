/** Empty presentation shape for the existing screens after task data was retired. */
export type InactiveTaskView = {
  loggedIn: false
  coursesTotal?: 0
  finishedCount?: 0
  tasks?: readonly never[]
  exams?: readonly never[]
  unreadMessages?: readonly never[]
  examsAt?: string
  messagesAt?: string
  examsStale?: boolean
  messagesStale?: boolean
  examsError?: string
  messagesError?: string
  error?: string
  errors?: Array<{ course: string; reason: string }>
  unmatchedCourses?: string[]
}
