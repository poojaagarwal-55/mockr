export function normalizeClipboardText(text: string): string {
  return text.trim().replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function clearContestCodeDrafts(contestId?: string | null) {
  if (!contestId || typeof window === "undefined") return;

  const prefix = [
    "practers",
    "contest-code-draft",
    encodeURIComponent(contestId),
  ].join(":") + ":";

  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(prefix)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore storage failures; draft cleanup should not block submission.
  }
}

export type ContestAutoSubmissionType =
  | "auto_time"
  | "auto_tab_switch"
  | "auto_window_blur"
  | "auto_focus_loss"
  | "auto_fullscreen_exit"
  | "auto_external_paste"
  | "auto_context_menu"
  | "auto_blocked_shortcut"
  | "auto_cheating";

const contestAutoSubmissionTypes = new Set<ContestAutoSubmissionType>([
  "auto_time",
  "auto_tab_switch",
  "auto_window_blur",
  "auto_focus_loss",
  "auto_fullscreen_exit",
  "auto_external_paste",
  "auto_context_menu",
  "auto_blocked_shortcut",
  "auto_cheating",
]);

export function getContestAutoSubmissionType(reason: string): ContestAutoSubmissionType {
  if (contestAutoSubmissionTypes.has(reason as ContestAutoSubmissionType)) {
    return reason as ContestAutoSubmissionType;
  }

  if (reason.includes("fullscreen")) return "auto_fullscreen_exit";
  if (reason.includes("paste")) return "auto_external_paste";
  if (reason.includes("context_menu")) return "auto_context_menu";
  if (reason.includes("tab") || reason.includes("app_switch")) return "auto_tab_switch";
  if (reason.includes("blur") || reason.includes("focus") || reason.includes("page_")) return "auto_focus_loss";
  if (reason.includes("shortcut") || reason.includes("screenshot") || reason.includes("devtools") || reason.includes("function_key")) {
    return "auto_blocked_shortcut";
  }

  return "auto_cheating";
}

export function getContestBlockedShortcutReason(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
  options: { inEditor?: boolean } = {}
): string | null {
  const key = event.key.toLowerCase();
  const primary = event.ctrlKey || event.metaKey;
  const inEditor = !!options.inEditor;

  if (key === "printscreen" || key === "print") return "auto_screenshot_printscreen";
  if (event.metaKey && event.shiftKey && ["3", "4", "5", "6"].includes(key)) return "auto_macos_screenshot";
  if (event.metaKey && event.shiftKey && key === "s") return "auto_windows_screenshot";
  if (key === "escape") return "auto_escape_fullscreen_exit_attempt";
  if (["f1", "f3", "f5", "f6", "f7", "f10", "f11", "f12"].includes(key)) return `auto_function_key_${key}`;

  if (event.altKey && key === "tab") return "auto_alt_tab";
  if (event.metaKey && key === "tab") return "auto_macos_app_switch";
  if (event.altKey && key === "escape") return "auto_alt_escape";
  if (event.altKey && key === "f4") return "auto_alt_f4";
  if (event.altKey && ["arrowleft", "arrowright", "home"].includes(key)) return "auto_browser_navigation";
  if (event.altKey && key === "d") return "auto_address_bar";

  if (event.ctrlKey && key === "tab") return event.shiftKey ? "auto_previous_tab" : "auto_next_tab";
  if (event.ctrlKey && ["pageup", "pagedown"].includes(key)) return "auto_tab_switch";
  if (primary && /^[1-9]$/.test(key)) return "auto_tab_switch";
  if (event.metaKey && key === "`") return "auto_window_switch";
  if (event.metaKey && event.shiftKey && ["[", "]"].includes(key)) return "auto_macos_tab_switch";
  if (event.metaKey && event.altKey && ["arrowleft", "arrowright"].includes(key)) return "auto_macos_tab_switch";

  if (primary && event.shiftKey && key === "n") return "auto_incognito_window";
  if (primary && event.shiftKey && key === "t") return "auto_reopen_tab";
  if (primary && event.shiftKey && key === "w") return "auto_close_window";
  if (primary && event.shiftKey && key === "r") return "auto_hard_reload_page";
  if (primary && event.shiftKey && ["i", "j", "c"].includes(key)) return "auto_devtools_shortcut";
  if (event.metaKey && event.altKey && ["i", "j", "c", "u"].includes(key)) return "auto_macos_devtools_shortcut";

  if (primary && key === "n") return "auto_new_window";
  if (primary && key === "t") return "auto_new_tab";
  if (primary && key === "w") return "auto_close_tab";
  if (primary && key === "q") return "auto_quit_browser";
  if (primary && key === "p") return "auto_print_dialog";
  if (primary && key === "s") return "auto_save_page";
  if (primary && key === "o") return "auto_open_file";
  if (primary && key === "l") return "auto_address_bar";
  if (primary && key === "r") return "auto_reload_page";
  if (primary && key === "u") return "auto_view_source";
  if (primary && ["h", "j"].includes(key)) return key === "h" ? "auto_history" : "auto_downloads";
  if (primary && ["d", "b", "e", "k"].includes(key)) return "auto_browser_chrome_shortcut";
  if (!inEditor && primary && ["a", "f", "g", "c", "x", "v"].includes(key)) return "auto_non_editor_shortcut";

  return null;
}
