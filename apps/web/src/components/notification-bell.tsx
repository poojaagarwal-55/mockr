"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  clearAllNotifications,
  deleteNotification,
  type Notification,
} from "@/lib/notifications";

export function NotificationBell() {
  const router = useRouter();
  const { session } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadNotifications = async () => {
    const localNotifications = getNotifications();
    let serverNotifications: Notification[] = [];
    if (session?.access_token) {
      try {
        const data = await api.get<{
          notifications: Array<{
            id: string;
            type: Notification["type"];
            title: string;
            message: string;
            href?: string | null;
            read: boolean;
            createdAt: string;
          }>;
        }>("/notifications", session.access_token);
        serverNotifications = data.notifications.map((notification) => ({
          id: notification.id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          timestamp: new Date(notification.createdAt).getTime(),
          read: notification.read,
          actionUrl: notification.type === "job_next_round" ? "/scheduled" : notification.href || undefined,
        }));
      } catch {
        serverNotifications = [];
      }
    }

    const merged = [...serverNotifications, ...localNotifications]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 50);
    setNotifications(merged);
    setUnreadCount(merged.filter((notification) => !notification.read).length);
  };

  useEffect(() => {
    loadNotifications();

    // Listen for notification updates
    const handleUpdate = () => loadNotifications();
    window.addEventListener("notificationAdded", handleUpdate);
    window.addEventListener("notificationUpdated", handleUpdate);

    return () => {
      window.removeEventListener("notificationAdded", handleUpdate);
      window.removeEventListener("notificationUpdated", handleUpdate);
    };
  }, [session?.access_token]);

  const handleNotificationClick = async (notification: Notification) => {
    markAsRead(notification.id);
    if (session?.access_token && !notification.id.startsWith("notif_")) {
      await api.patch(`/notifications/${notification.id}/read`, {}, session.access_token).catch(() => null);
      await loadNotifications();
    }
    if (notification.actionUrl) {
      router.push(notification.actionUrl);
    }
    setIsOpen(false);
  };

  const handleMarkAllRead = async () => {
    markAllAsRead();
    if (session?.access_token) {
      await api.patch("/notifications/read-all", {}, session.access_token).catch(() => null);
      await loadNotifications();
    }
  };

  const handleClearAll = async () => {
    if (session?.access_token) {
      await api.delete("/notifications", session.access_token).catch(() => null);
    }
    clearAllNotifications();
    setNotifications([]);
    setUnreadCount(0);
  };

  // Check if all notifications are read
  const allNotificationsRead = notifications.length > 0 && notifications.every(n => n.read);

  const handleDelete = async (e: React.MouseEvent, notificationId: string) => {
    e.stopPropagation();
    if (session?.access_token && !notificationId.startsWith("notif_")) {
      await api.delete(`/notifications/${notificationId}`, session.access_token).catch(() => null);
    }
    deleteNotification(notificationId);
    setNotifications((current) => {
      const updated = current.filter((notification) => notification.id !== notificationId);
      setUnreadCount(updated.filter((notification) => !notification.read).length);
      return updated;
    });
  };

  const getNotificationIcon = (type: Notification["type"]) => {
    switch (type) {
      case "interview_reminder":
        return "🎯";
      case "question_reminder":
        return "📚";
      case "report_generated":
        return "📊";
      case "welcome":
      case "job_next_round":
        return "🎉";
      default:
        return "🔔";
    }
  };

  const formatTimestamp = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  return (
    <div className="relative">
      {/* Bell Icon */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative top-[1.5px] p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
      >
        <svg
          className="w-[25px] h-[25px]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>

        {/* Unread Badge */}
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Notification Panel */}
          <div className="fixed left-4 right-4 top-[68px] md:absolute md:left-auto md:right-0 md:top-12 md:w-96 z-50 max-h-[600px] overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-4 py-3">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                Notifications
              </h3>
              {notifications.length > 0 && (
                <button
                  onClick={allNotificationsRead ? handleClearAll : handleMarkAllRead}
                  className="text-sm text-teal-600 dark:text-teal-400 hover:underline"
                >
                  {allNotificationsRead ? "Clear all" : "Mark all read"}
                </button>
              )}
            </div>

            {/* Notification List */}
            <div className="max-h-[500px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-500 dark:text-slate-400">
                 
                  <p className="text-m">No notifications yet</p>
                </div>
              ) : (
                notifications.map((notification) => (
                  <div
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`group relative border-b border-slate-200 dark:border-slate-700 px-4 py-3 cursor-pointer transition-colors ${notification.read
                        ? "bg-white dark:bg-slate-800"
                        : "bg-teal-50 dark:bg-teal-900/20"
                      } hover:bg-slate-50 dark:hover:bg-slate-700`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Icon */}
                      <div className="text-2xl flex-shrink-0">
                        {getNotificationIcon(notification.type)}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                            {notification.title}
                          </h4>
                          {!notification.read && (
                            <span className="flex-shrink-0 h-2 w-2 rounded-full bg-teal-500" />
                          )}
                        </div>
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                          {notification.message}
                        </p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                          {formatTimestamp(notification.timestamp)}
                        </p>
                      </div>

                      {/* Delete Button */}
                      <button
                        onClick={(e) => handleDelete(e, notification.id)}
                        className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-1 text-slate-400 hover:text-red-500 transition-all"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
