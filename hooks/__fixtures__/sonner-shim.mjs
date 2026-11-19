// 测试桩：renderHook 环境没有 <Toaster>，sonner 的 toast 在这里只做记录。
// useAgentSession 的 addNotice 经它发通知；断言用 toastCalls()/resetToastCalls()。
export const toastCalls = [];

const record = (type) => (message, opts = {}) => {
  toastCalls.push({ type, message, id: opts.id, duration: opts.duration });
  return opts.id;
};

export const toast = Object.assign(record("info"), {
  info: record("info"),
  success: record("success"),
  warning: record("warning"),
  error: record("error"),
  message: record("info"),
  loading: record("info"),
  custom: record("custom"),
  dismiss: (id) => toastCalls.push({ type: "dismiss", id }),
});

export const resetToastCalls = () => {
  toastCalls.length = 0;
};
