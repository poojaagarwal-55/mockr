// Notification System - Local Storage Based
// Stores notifications in localStorage with a max limit

export interface Notification {
  id: string;
  type: 'interview_reminder' | 'question_reminder' | 'report_generated' | 'welcome' | 'success' | 'info' | 'job_next_round';
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  actionUrl?: string;
}

const STORAGE_KEY = 'mockr_notifications';
const MAX_NOTIFICATIONS = 50; // Maximum notifications to store

/**
 * Get all notifications from localStorage
 */
export function getNotifications(): Notification[] {
  if (typeof window === 'undefined') return [];

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const notifications: Notification[] = JSON.parse(stored);
    return notifications.sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    console.error('Error reading notifications:', error);
    return [];
  }
}

/**
 * Add a new notification
 */
export function addNotification(notification: Omit<Notification, 'id' | 'timestamp' | 'read'>): void {
  if (typeof window === 'undefined') return;

  try {
    const notifications = getNotifications();

    const newNotification: Notification = {
      ...notification,
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      read: false,
    };

    // Add new notification at the beginning
    notifications.unshift(newNotification);

    // Keep only the latest MAX_NOTIFICATIONS
    const trimmedNotifications = notifications.slice(0, MAX_NOTIFICATIONS);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmedNotifications));

    // Dispatch custom event for real-time updates
    window.dispatchEvent(new CustomEvent('notificationAdded', { detail: newNotification }));
  } catch (error) {
    console.error('Error adding notification:', error);
  }
}

/**
 * Mark notification as read
 */
export function markAsRead(notificationId: string): void {
  if (typeof window === 'undefined') return;

  try {
    const notifications = getNotifications();
    const updated = notifications.map(n =>
      n.id === notificationId ? { ...n, read: true } : n
    );

    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event('notificationUpdated'));
  } catch (error) {
    console.error('Error marking notification as read:', error);
  }
}

/**
 * Mark all notifications as read
 */
export function markAllAsRead(): void {
  if (typeof window === 'undefined') return;

  try {
    const notifications = getNotifications();
    const updated = notifications.map(n => ({ ...n, read: true }));

    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event('notificationUpdated'));
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
  }
}

/**
 * Delete a notification
 */
export function deleteNotification(notificationId: string): void {
  if (typeof window === 'undefined') return;

  try {
    const notifications = getNotifications();
    const filtered = notifications.filter(n => n.id !== notificationId);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    window.dispatchEvent(new Event('notificationUpdated'));
  } catch (error) {
    console.error('Error deleting notification:', error);
  }
}

/**
 * Clear all notifications
 */
export function clearAllNotifications(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event('notificationUpdated'));
  } catch (error) {
    console.error('Error clearing notifications:', error);
  }
}

/**
 * Get unread notification count
 */
export function getUnreadCount(): number {
  const notifications = getNotifications();
  return notifications.filter(n => !n.read).length;
}

// ============================================
// Reminder System
// ============================================

const LAST_INTERVIEW_KEY = 'mockr_last_interview_date';
const LAST_QUESTION_KEY = 'mockr_last_question_date';
const REMINDER_CHECKED_KEY = 'mockr_reminder_last_checked';
const USER_SIGNUP_KEY = 'mockr_user_signup_date';

/**
 * Check if reminders should be sent
 * Call this on app load or periodically
 */
export function checkAndSendReminders(): void {
  if (typeof window === 'undefined') return;

  const now = Date.now();
  const oneDayInMs = 24 * 60 * 60 * 1000;

  // Only run the check once every 24 hours
  const lastChecked = parseInt(localStorage.getItem(REMINDER_CHECKED_KEY) || '0', 10);
  if (now - lastChecked < oneDayInMs) return;

  localStorage.setItem(REMINDER_CHECKED_KEY, now.toString());

  // Do NOT send any reminders within the first 24 hours after sign-up
  const signupDate = parseInt(localStorage.getItem(USER_SIGNUP_KEY) || '0', 10);
  if (signupDate > 0 && now - signupDate < oneDayInMs) return;

  // Check interview reminder (every 2 days)
  const lastInterview = parseInt(localStorage.getItem(LAST_INTERVIEW_KEY) || '0', 10);
  const twoDaysInMs = 2 * 24 * 60 * 60 * 1000;

  if (now - lastInterview > twoDaysInMs) {
    addNotification({
      type: 'interview_reminder',
      title: 'Time for an Interview! 🎯',
      message: "It's been 2 days since your last interview. Practice makes perfect!",
      actionUrl: '/interviews',
    });
  }

  // Check question reminder (every 24 hours)
  const lastQuestion = parseInt(localStorage.getItem(LAST_QUESTION_KEY) || '0', 10);

  if (now - lastQuestion > oneDayInMs) {
    addNotification({
      type: 'question_reminder',
      title: 'Daily Practice Reminder 📚',
      message: 'Keep your skills sharp! Solve at least one DSA question today.',
      actionUrl: '/questions',
    });
  }
}

/**
 * Update last interview date
 */
export function updateLastInterviewDate(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LAST_INTERVIEW_KEY, Date.now().toString());
}

/**
 * Update last question solved date
 */
export function updateLastQuestionDate(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LAST_QUESTION_KEY, Date.now().toString());
}

/**
 * Record the user's sign-up timestamp and send a one-time welcome notification.
 * Call this exactly once right after a successful sign-up.
 */
export function recordUserSignup(): void {
  if (typeof window === 'undefined') return;

  // Guard: only do this once (in case of re-renders)
  if (localStorage.getItem(USER_SIGNUP_KEY)) return;

  const now = Date.now();
  localStorage.setItem(USER_SIGNUP_KEY, now.toString());

  // Seed the last-checked timestamp so the reminder system waits 24 h
  localStorage.setItem(REMINDER_CHECKED_KEY, now.toString());

  // Seed both activity timestamps to NOW so the 2-day interview clock
  // and 1-day DSA clock start from signup, not from the epoch (which
  // would otherwise cause both reminders to fire the moment the 24 h
  // grace period ends).
  localStorage.setItem(LAST_INTERVIEW_KEY, now.toString());
  localStorage.setItem(LAST_QUESTION_KEY, now.toString());

  // Send the welcome notification (only once)
  addNotification({
    type: 'welcome',
    title: 'Welcome to Mockr! 🎉',
    message: 'Your account is ready. Start practising interviews and DSA questions to sharpen your skills.',
    actionUrl: '/dashboard',
  });
}

/**
 * Send report generated notification
 */
export function notifyReportGenerated(reportUrl?: string): void {
  addNotification({
    type: 'report_generated',
    title: 'Interview Report Ready! 📊',
    message: 'Your interview performance report has been generated.',
    actionUrl: reportUrl || '/interviews',
  });
}
